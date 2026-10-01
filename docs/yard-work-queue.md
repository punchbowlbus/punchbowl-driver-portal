# Yard Work Queue

Development branch: `feature/yard-man-jobs`. No production deployment is part of this change.

## Staff setup and operation

In Employees, give yard staff Role **Yard Man**, Access Level **Yard Man**, Department **Yard** (or Workshop), Status **Active**, and their own Google sign-in email. Their main portal login redirects to `yard.html`. All yard staff see the full active fleet, with depot/search filters; the displayed depot comes from fleet records and does not establish physical presence.

The Fleet Manager uses Workshop Management → **Yard Work Queue**, replacing “Safety Checks Next”. Managers retain their current Admin/Workshop Manager access. Yard staff do not receive manager controls.

- Exterior washing and interior cleaning/mopping are independently due every seven days. Extra cleaning can be started at any time. Unknown dates show **Not recorded**, never a fabricated completion date.
- Start claims one task under the signed-in employee. Two people cannot claim the same task. They can perform different tasks on the same bus.
- A task can be released with a reason. Its audit record keeps the previous worker. No automatic reassignment to a different employee is allowed.
- Completion requires all checklist items and an actual date, then awaits manager approval. Approval records the performer’s actual date; the approval date does not replace it. Returned work stays outstanding and retains both submission and review history.
- Daily checks cover applicable oil/coolant levels, tyres, EV charge and charging status. Problem/incomplete checks need notes and are immediately visible. Manager review acknowledges the report; it does not mark the bus safe, clear a defect or update mechanical service tracking.
- Photos are optional, up to three per update, resized in the browser and validated again on the server. Staff name, employee number and timestamps are recorded automatically.
- My Work shows the signed-in employee’s active/submitted cleaning. Team Activity and bus history retain all employees’ recorded actions. The latest 150 updates plus every outstanding review load on the board; Full Bus History retrieves older records.
- Lists refresh every 20 seconds while visible, and immediately after saves. Failed refreshes show a stale-data warning.

EV oil checks default to N/A. Fleet fields `yardOilCheckApplicable: false` and `yardCoolantCheckApplicable: false` can explicitly disable the corresponding check. Confirm the fleet’s applicable checks before production use. No oil/coolant top-up procedures or automatic vehicle safety decisions are introduced.

## Backend and access

The isolated `functions-yard` codebase exports `pbcYardBoard`, `pbcYardHistory`, and `pbcYardUpdate` in `australia-southeast1`. The server verifies the current active employee/manager record for every request, rejects duplicate employee emails, validates check inputs and enforces task ownership and manager-only approval. Task state and history writes occur in one Firestore transaction.

New data: `yardFleet/{busId}` for summaries, `yardRecords/{recordId}` for audit/completion/check records, `yard-photos/{recordId}/{imageId}` in Storage. Existing buses are read for fleet identity/applicability; this feature never writes buses, workshopJobs, dutySpans or defectReports. Photos use Firebase download-token links, like other attachment links; anyone possessing such a link can view that photo.

**Production rules prerequisite:** deployed Firestore/Storage rules are absent from this repository. Verify they deny browser access to `yardFleet`, `yardRecords` and `yard-photos`; only these server callables should write the new records. Merge explicit client-deny matches into the current rules if needed, and examine overlapping broad allows (allow matches combine with OR). Do not replace the existing portal rules with a new standalone file. Production permission integration remains unverified until the real rules are available.

The new functions are separate from charter and notifications. `firebase.yard.json` selects only the `yard` codebase; the existing configurations are untouched. Deploying these backend functions eventually requires an authorised Firebase account and user confirmation. Do not run a hosting or whole-project deployment during local review.

## Isolated local test

1. `npm --prefix functions-yard ci`
2. With Firebase CLI and Java installed: `firebase emulators:start --config firebase.yard.json --project demo-pbc-yard`
3. In another terminal: `node tests/seed-yard-emulator.cjs`
4. Open `http://127.0.0.1:5000/yard.html?yardEmulator=1`.
5. Use the Auth emulator Google sign-in dialog with `yard1@example.test` or `yard2@example.test`. For the manager view, open `yard.html?yardEmulator=1&managerView=1` and sign in as `manager@example.test`.

The `yardEmulator=1` mode uses a named Firebase app connected only to the **demo-pbc-yard** Auth/Functions emulators. The backend emulator automatically uses that demo project’s Firestore/Storage emulators. No real Firebase credentials or live fleet writes are needed. Without this parameter, the normal portal Firebase connection is used; the new backend must be available for the feature to load.

## Validation

`node --test tests/yard.test.cjs` checks permissions, competing claims, ownership, approval/return, actual-date tracking, EV/diesel input validation, backdated check handling and Sydney dates using an in-memory transaction fixture.

`node tests/yard.browser.cjs` (with Playwright installed) runs the actual UI against the yard service and an in-memory database. It checks full-fleet browsing, cleaning completion, EV checks, manager review, performer history and tablet layout. Authentication and callable transport are stubbed; these tests do not certify deployed Firebase permissions or Storage integration. Run the emulator workflow and test photo uploads before production deployment.
