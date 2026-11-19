const { createHash, randomUUID } = require('node:crypto');
const MAX_ATTEMPTS = 5;
const MAX_EVENT_AGE_MS = 24 * 60 * 60 * 1000;
const LEASE_MS = 120000;
const terminal = new Set(['accepted', 'sent', 'skipped', 'failed']);
const retryCodes = new Set([
  'messaging/internal-error', 'messaging/server-unavailable', 'messaging/unknown-error',
  'messaging/quota-exceeded', 'messaging/message-rate-exceeded',
  'messaging/device-message-rate-exceeded', 'messaging/topics-message-rate-exceeded',
  'app/network-error', 'app/network-timeout'
]);
function isRetryableMessagingError(code) { return retryCodes.has(String(code)); }
function dutyVersion(duty) {
  if (!duty) return 'missing';
  return JSON.stringify(['driverEmployeeNumber','dispatchStatus','deleted','serviceDate','date','startMin','endMin','assignedBus','dutyNumber','dutyType','startLocation','endLocation','routeNumber','routePdfUrl','breaks'].map(key => duty[key] ?? null));
}
function isCurrentNotification(notification, after, current) {
  const employee = String(notification.employeeNumber || '');
  const visibleToEmployee = current && !current.deleted && String(current.dispatchStatus || '').toLowerCase() === 'assigned' && String(current.driverEmployeeNumber || '') === employee;
  if (['removed','reassigned-away'].includes(notification.eventType)) return !visibleToEmployee;
  if (notification.eventType === 'withdrawn') return current && !current.deleted && String(current.dispatchStatus || '').toLowerCase() === 'pending' && String(current.driverEmployeeNumber || '') === employee;
  return dutyVersion(after) === dutyVersion(current);
}
function retryError() { return new Error('Duty notification delivery is pending a bounded retry.'); }

function createDutyDeliveryHandler({db, FieldValue, classify, send, isRelevant = async () => true, now = Date.now, leaseId = randomUUID}) {
  return async function handle(event) {
    const before = event.data?.before?.exists ? event.data.before.data() || {} : null;
    const after = event.data?.after?.exists ? event.data.after.data() || {} : null;
    const duty = after || before;
    if (!duty) return;
    const notifications = classify(before, after);
    if (!notifications.length) return;
    if (!event.id || !event.params?.dutySpanId) throw new Error('Missing notification event identity.');
    const eventTime = Date.parse(event.time);
    // Stop platform retries too, even if Firestore itself was unavailable.
    const logRef = db.collection('dutyNotificationDeliveries').doc(String(event.id));
    if (Number.isFinite(eventTime) && now() - eventTime > MAX_EVENT_AGE_MS) {
      try {
        const log = await logRef.get();
        if (!log.exists || log.data().status !== 'complete') await logRef.set({eventId:event.id,dutySpanId:event.params.dutySpanId,status:'expired',reason:'event-window-expired',updatedAt:FieldValue.serverTimestamp()}, {merge:true});
      } catch (error) {
        console.error('Expired duty delivery could not be logged', {eventId:event.id,code:error?.code || 'unknown'});
      }
      return;
    }
    const results = [];
    let pending = false;
    for (const notification of notifications) {
      const key = createHash('sha256').update(notification.employeeNumber + ':' + notification.eventType).digest('hex');
      const recipientRef = logRef.collection('recipients').doc(key);
      const owner = leaseId();
      const claim = await db.runTransaction(async tx => {
        const [snapshot, parent] = await Promise.all([tx.get(recipientRef), tx.get(logRef)]);
        const previous = snapshot.exists ? snapshot.data() : {};
        if (terminal.has(previous.status)) return {result:previous};
        // Respect records produced by the previous sender when an old event replays.
        const legacy = parent.exists && !parent.data().deliveryVersion && (parent.data().results || []).find(result => result.employeeNumber === notification.employeeNumber);
        if (legacy) {
          const migrated = {...legacy, status:legacy.status === 'sent' ? 'accepted' : legacy.status, eventType:notification.eventType};
          tx.set(recipientRef, migrated);
          return {result:migrated};
        }
        const currentTime = now();
        if ((previous.status === 'processing' && previous.leaseUntil > currentTime) || previous.nextAttemptAt > currentTime) return {busy:true};
        if ((previous.attempts || 0) >= MAX_ATTEMPTS || (previous.firstAttemptAt && currentTime - previous.firstAttemptAt > MAX_EVENT_AGE_MS)) {
          const result = {...previous, status:'failed', reason:'retry-limit', employeeNumber:notification.employeeNumber, eventType:notification.eventType};
          tx.set(recipientRef, result);
          return {result};
        }
        const attempts = (previous.attempts || 0) + 1;
        if (!parent.exists) tx.set(logRef, {createdAt:FieldValue.serverTimestamp(),updatedAt:FieldValue.serverTimestamp(),eventId:event.id,dutySpanId:event.params.dutySpanId,dutyNumber:String(duty.dutyNumber||''),serviceDate:String(duty.serviceDate||duty.date||''),eventTypes:notifications.map(n=>n.eventType),recipientEmployeeNumbers:notifications.map(n=>n.employeeNumber),status:'processing'}, {merge:true});
        tx.set(recipientRef, {status:'processing', attempts, firstAttemptAt:previous.firstAttemptAt ?? currentTime, leaseUntil:currentTime + LEASE_MS, owner, employeeNumber:notification.employeeNumber, eventType:notification.eventType});
        return {attempts};
      });
      if (claim.result) { results.push(claim.result); continue; }
      if (claim.busy) { pending = true; continue; }
      let result;
      try {
        const latest = await db.collection('dutySpans').doc(event.params.dutySpanId).get();
        const current = latest.exists ? latest.data() : null;
        result = isCurrentNotification(notification, after, current) && await isRelevant({notification, current})
          ? await send({dutySpanId:event.params.dutySpanId, duty, notification, deliveryRef:recipientRef})
          : {status:'skipped', reason:'stale-event', employeeNumber:notification.employeeNumber};
      } catch (error) {
        // Firestore/network failures outside the Messaging send are retried within the same bound.
        result = {status:'retryable', errorCode:String(error?.code || 'delivery-check-failed'), employeeNumber:notification.employeeNumber};
      }
      result = {...result, eventType:notification.eventType};
      if (result.status === 'retryable' && claim.attempts >= MAX_ATTEMPTS) result = {...result,status:'failed',reason:'retry-limit'};
      const finalized = await db.runTransaction(async tx => {
        const snapshot = await tx.get(recipientRef);
        if (!snapshot.exists || snapshot.data().owner !== owner) return false;
        tx.set(recipientRef, {...result, attempts:claim.attempts, leaseUntil:0, nextAttemptAt:result.status === 'retryable' ? now() + Math.min(15 * 60000, 60000 * (2 ** (claim.attempts - 1))) : 0, updatedAt:FieldValue.serverTimestamp()}, {merge:true});
        return true;
      });
      if (!finalized || result.status === 'retryable') pending = true;
      results.push(result);
    }
    await logRef.set({deliveryVersion:2,eventId:event.id,dutySpanId:event.params.dutySpanId,serviceDate:String(duty.serviceDate || duty.date || ''),dutyNumber:String(duty.dutyNumber||''),eventTypes:notifications.map(n=>n.eventType),recipientEmployeeNumbers:notifications.map(n=>n.employeeNumber),status:pending?'pending-retry':'complete',results,updatedAt:FieldValue.serverTimestamp()}, {merge:true});
    if (pending) throw retryError();
    return results;
  };
}
module.exports = {createDutyDeliveryHandler,isRetryableMessagingError,isCurrentNotification,MAX_ATTEMPTS,MAX_EVENT_AGE_MS};
