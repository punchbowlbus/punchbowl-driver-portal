# Notification improvements — step 1

Branch: fix/notification-event-rules. Not deployed.

This step only changes duty notification event classification in functions-notifications/index.js. It does not change dispatch writes, driver acknowledgment, fatigue, push registration, defect/general push, token storage, retry policy or delivery URLs.

- Pending/new drafts cancelled before assignment do not send cancellation alerts. An Assigned duty changed to Cancelled still alerts its driver.
- Soft deletion or physical deletion of an Assigned duty alerts the original driver once through the existing removal event. Creating, editing, or physically deleting an already deleted record is silent.
- Simultaneous deletion/reassignment routes removal only to the original owner. Simultaneous cancellation/reassignment does not notify an unpublished new owner.
- Restoration as Assigned is a fresh assignment; restoration as Pending remains silent.
- Ordinary assignment, Assigned-duty edits, normal transfer (both drivers), withdrawal to Pending, driver Yes/No response suppression and bulk no-op suppression remain covered.

Validation: node --test tests/duty-notification-events.test.cjs — 24 checks. Tests execute the actual classifier and Firestore handler with mocked Firebase/Messaging; no production push is sent. The full repository unit suite passed 187 checks. Hosting-only local testing cannot exercise the deployed Firestore notification trigger. Actual Functions deployment/version and phone delivery still require separate verification.

Next steps: duplicate-event/stale-event protection and a bounded retry strategy, then job-change alerts, multi-device registration and management delivery visibility. Retry must not simply be enabled before duplicate protection exists. A Messaging acceptance response must not be presented as driver receipt or reading.

## Step 2 — delivery reliability (same test branch, not deployed)

The duty trigger now uses a transactional event/recipient journal under dutyNotificationDeliveries/{eventId}/recipients/{recipientHash}. A 120-second lease prevents concurrent workers from sending the same recipient alert; the trigger timeout remains 60 seconds. Accepted, skipped and permanently failed recipients are terminal. Previously completed legacy delivery records are adopted without resending. Journal records retain creation and update times and per-recipient attempts/results.

Before each send, the current duty is checked. Superseded assignment/update/cancellation alerts are skipped, acknowledgment-only changes do not invalidate them, and old removal/withdrawal messages are suppressed when the current driver state makes them obsolete. This is a pre-send check, not an atomic transaction with Messaging: duty changes immediately after the check remain possible.

Temporary Messaging failures (server/internal/network errors and rate/quota errors) use platform event redelivery with 1/2/4/8-minute minimum backoff and at most five processing attempts per recipient. Events older than 24 hours stop processing; incomplete logs are marked expired when logging is available. A live lease or not-yet-due backoff throws for later redelivery without consuming another attempt. Infrastructure failures before a journal claim cannot be counted in Firestore; event age still bounds these platform retries. Invalid tokens, inactive staff, missing devices and permanent send errors do not retry. Token cleanup transactionally removes only the exact token that failed, preserving a newer registration.

“accepted” means Firebase Messaging returned a message ID; it does not prove phone receipt or reading. Exactly-once external delivery is not guaranteed: a process can stop after Messaging acceptance but before recording it, or Messaging itself can accept a request whose response is lost. A recovered lease may resend in that narrow case. Existing notification tags still group repeated alerts.

Validation: 37 notification-specific checks and 200 total repository unit checks passed. Coverage includes simultaneous invocation, repeat invocation, backoff, retry exhaustion, partial transfer retry, stale events, terminal skips, legacy-log migration, lease recovery, Step 1 event rules and invalid-token replacement races. The actual Functions module also loaded after a clean install of its exact locked dependencies (Admin 14.4.0 / Functions 7.3.2) in a demo project configuration, showing all five exports, retry enabled and a 60-second timeout; no network sends were invoked. Actual deployed phone delivery still requires separate validation.

Only the duty notification trigger and its sender changed. Defect/general push, token registration, driver acknowledgment writes, scheduling, dispatch, Yard, and driver UI are unchanged. No live deployment or production test push occurred. A future release needs the isolated notifications Functions configuration; Hosting-only deployment cannot activate it. Next: job-change alerts, multi-device registration and management delivery visibility.

## Step 3 — assigned-job alerts (same test branch, not deployed)

A new notifyDriverOnDutyJobWritten trigger watches blocks/{blockId}. Driver-visible block changes generate job-added, job-removed or job-updated notifications linked to the affected Duty Sheet, only when that duty is currently Assigned. A job moved between two Assigned duties alerts the previous and new recipients. Pending/Cancelled/deleted duties are excluded. The existing whole-duty transfer leaves its destination Pending, so its block changes do not generate extra job alerts. Newly created duties already include their jobs in the assignment alert; same-batch/newer duty creation is excluded when commit timestamps are available.

Explicit job links are resolved with driver/date validation. Legacy/unlinked jobs follow the existing Duty Sheet approach: matching driver/date/times and exactly one current matching duty; ambiguous cases stay silent. Job additions/edits are checked against the current block again before sending. Removal alerts are suppressed if the job was put back. Timestamp-only block writes do not alert.

Recipient plans are frozen under dutyJobNotificationEvents/{eventId}, including silent plans, so retry/replay cannot redirect the original event to a different driver or publish an old Pending-only job event. Per-recipient delivery then uses the Step 2 journal, stale checks and retries. Stored plans and delivery logs are new backend records; no duty, job, bus, acknowledgment, fatigue, driver UI or Yard data is changed. Shared job-group master record edits are not watched in this step. Multiple separate job changes may generate multiple pushes; the existing notification tag groups the same duty/event type on the device. This is not a daily digest.

Validation: 23 job-specific checks and 223 repository unit checks passed. The backend loaded all six exported functions with its exact installed locked dependencies; both duty and job triggers advertise retries. All sends were mocked; actual deployed phone delivery is unverified. No live deployment occurred. Releasing this stage requires adding the new isolated notification trigger along with the updated duty trigger; Hosting alone does not activate backend changes. Remaining steps: multi-device registration and management delivery visibility.
