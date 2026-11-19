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
