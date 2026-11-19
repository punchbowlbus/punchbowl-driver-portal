# Dispatch bulk duty status

Test branch: feature/dispatch-bulk-status. Based on the released dispatch improvements.

Checkboxes are separate from the saved Select drivers filter. Select all shown includes only visible drivers with duty spans on the selected date. The review lists every duty that will change and skips duties already at the target status. Drivers with multiple duties have all relevant spans included. Selections are never persisted and clear on date/driver-filter changes. Sort changes retain selections.

The existing individual driver status controls remain. Bulk updates use one Firestore client transaction (maximum 400 duty spans) and reject deleted, missing, reassigned, moved, rescheduled or status-changed reviewed records. The UI also checks the entire plan again after confirmation. No jobs, buses, breaks or duty times are written. The existing acknowledgment rule is preserved: Pending and Cancelled reset driverAcknowledgment to Pending; Assigned preserves it. Existing notification triggers are unchanged and may notify for each changed duty under their current rules.

Validation: node --test tests/*.test.cjs (install functions-yard dependencies first). DOM integration: install jsdom outside the repository, then JSDOM_MODULE=/path/to/jsdom node tests/dispatch-bulk-status.dom.cjs. The DOM integration uses the real board source with mocked data transport and covers review cancellation, successful changes, skipped no-ops, stale data, error/retry, and existing individual controls. Browser harness: PLAYWRIGHT_MODULE=/path/to/playwright CHROMIUM_PATH=/path/to/chromium node tests/dispatch-bulk-status.browser.cjs. Chromium launch is blocked in the agent environment, so visual browser verification remains for local testing.

Local Hosting-only testing still connects to the configured live Firestore database: confirming status changes writes real duties and may trigger notifications. Review and Back make no writes. Use an approved test duty for write testing. No Firebase Functions or database-rule deployment is part of this change.
