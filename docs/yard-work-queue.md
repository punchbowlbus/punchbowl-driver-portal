# Yard Work Queue

Development branch: `feature/yard-man-jobs`. Release preparation authorised on 23 October 2026. Git release does not deploy Firebase Hosting or Functions.

## Staff setup and operation

In Employees, give yard staff Role **Yard Man**, Access Level **Yard Man**, Department **Yard** (or Workshop), Status **Active**, and their own Google sign-in email. Their main portal login redirects to `yard.html`. All yard staff see the full active fleet, with depot/search filters; the displayed depot comes from fleet records and does not establish physical presence.

The Fleet Manager uses Workshop Management → **Yard Work Queue**, replacing “Safety Checks Next”. A separate **Yard View** link in the left menu opens the tablet page under the current signed-in account; work is recorded under that account. Managers retain their current Admin/Workshop Manager access. Yard staff do not receive manager controls.

- Exterior washing is required **at least once every seven days**, with extra washes whenever conditions require. Any employee may start another wash even if the bus was washed today. Interior cleaning/mopping is independently due every seven days. Each latest actual completion date sets its next due date seven days later; due today and overdue are shown separately. Unknown dates show **Not recorded**, never a fabricated completion date.
- Start claims one task under the signed-in employee. Two people cannot claim the same task. They can perform different tasks on the same bus.
- A task can be released with a reason. Its audit record keeps the previous worker. No automatic reassignment to a different employee is allowed.
- Cleaning completion requires all checklist items and an actual date, then is **Completed immediately without Fleet Manager approval**. Staff identity, completion date, recorded time, notes and photos remain in history. Backdated work never replaces a newer latest-clean date. The manager can flag an early priority wash. No cleaning Approve/Return controls remain.
- Daily checks cover applicable oil/coolant levels, tyres, EV charge and charging status. Problem/incomplete checks need notes and are immediately visible. Manager review acknowledges the report; it does not mark the bus safe, clear a defect or update mechanical service tracking.
- Photos are optional, up to three per update, resized in the browser and validated again on the server. Staff name, employee number and timestamps are recorded automatically.
- My Work shows the signed-in employee’s active cleaning. Team Activity and bus history retain all employees’ recorded actions. The latest 150 updates plus every outstanding daily-check review load on the board; Full Bus History retrieves older records.
- Lists refresh every 20 seconds while visible, and immediately after saves. Failed refreshes show a stale-data warning.

EV oil checks default to N/A. Fleet fields `yardOilCheckApplicable: false` and `yardCoolantCheckApplicable: false` can explicitly disable the corresponding check. Confirm the fleet’s applicable checks before production use. No oil/coolant top-up procedures or automatic vehicle safety decisions are introduced.

## Shared tablet and morning / afternoon handover

Use one tablet with separate employee Google accounts. The employee name stays visible at the top. **Sign out / Change employee** ends the app session; the next sign-in explicitly offers Google account selection. There is no shared yard identity or unverified name picker in production.

Before leaving unfinished work, tap **Hand over** and describe what is complete and what remains. Cleaning becomes available for another employee to start. The receiving employee explicitly accepts/starts under their own account. All start, handover and completion actions retain each person's name and timestamps. Daily checks remain visible across shifts with their date and performer; additional checks can be recorded. The Daily Checks view labels previous-date results.

## General yard tasks

In Workshop Management → Yard Work Queue, **Assign Yard Task** creates work such as yard cleaning, rubbish removal or tree trimming. Enter title, location, instructions, normal/urgent priority, due date, optional photos, and one or more active Yard Man employees from Employees. Leave employees unchecked for anyone available. A bus number is not required.

The **Yard Tasks** tab is available to manager and employees. Only an assigned employee (or a manager) can claim a restricted task. One employee owns active work at a time; multiple selected assignees support sequential shift handover. Others can see progress and ownership. Staff can start/accept, hand over with notes, report a blocking problem, or submit completion with date, notes and photos. General tasks await manager review, with approve or return-for-further-work actions. This review does not apply to bus cleaning. Full task activity loads on opening a task, including older updates beyond the board's latest 150.

## Backend and access

The isolated `functions-yard` codebase exports `pbcYardBoard`, `pbcYardHistory`, and `pbcYardUpdate` in `australia-southeast1`. The server verifies the current active employee/manager record for every request, rejects duplicate employee emails, validates check inputs and enforces task ownership and manager-only general task assignment/review. Task state and history writes occur in one Firestore transaction.

New data: `yardFleet/{busId}` for summaries, `yardRecords/{recordId}` for audit/completion/check records, `yardTasks/{taskId}` for general yard tasks, `yard-photos/{recordId}/{imageId}` in Storage. Existing buses are read for fleet identity/applicability; this feature never writes buses, workshopJobs, dutySpans or defectReports. Photos use Firebase download-token links, like other attachment links; anyone possessing such a link can view that photo.

**Production rules prerequisite:** deployed Firestore/Storage rules are absent from this repository. Verify they deny browser access to `yardFleet`, `yardRecords`, `yardTasks` and `yard-photos`; only these server callables should write the new records. Merge explicit client-deny matches into the current rules if needed, and examine overlapping broad allows (allow matches combine with OR). Do not replace the existing portal rules with a new standalone file. Production permission integration remains unverified until the real rules are available.

The new functions are separate from charter and notifications. `firebase.yard.json` selects only the `yard` codebase; the existing configurations are untouched. Deploy this codebase separately before Hosting using the release steps below. This avoids deploying or deleting the other portal function codebases.

## Local test without Java or administrator access

Run from your project folder:

```powershell
node tools/yard-local.cjs
```

No additional packages or Firebase login are required. Leave the terminal open and visit:

- Yard: `http://127.0.0.1:5050/yard.html`
- Manager: `http://127.0.0.1:5050/yard.html?managerView=1`

Click **Sign in**, enter **1** for AM Yard — **K SOTHISWARAN**, **2** for PM Yard — **Palad-im**, or **3** for Fleet Manager. Use separate browser profiles/private windows to test employees working at the same time. Sign out to switch employees; open the Manager view when signed in as the manager. Bus cleaning needs no approval. The manager reviews completed **general yard tasks**.

This server uses the actual Yard UI and task service with sample buses and local sessions. It loads no Firebase SDK and makes no requests to the real project. Only Yard page assets are served; other portal pages are excluded. It listens on your own PC at port 5050. Updates and photo evidence persist in `tools/yard-local-data.json` (excluded from Git). Stop the server with Ctrl+C. To reset sample data, stop the server and delete that file, then restart.

This is for workflow and layout testing. It does not test real Google sign-in, Firestore transactions/rules or Firebase Storage. Those integrations still require emulator or staging tests before live deployment.

## Isolated local test

1. `npm --prefix functions-yard ci`
2. With Firebase CLI and Java installed: `firebase emulators:start --config firebase.yard.json --project demo-pbc-yard`
3. In another terminal: `node tests/seed-yard-emulator.cjs`
4. Open `http://127.0.0.1:5000/yard.html?yardEmulator=1`.
5. Use the Auth emulator Google sign-in dialog with `yard1@example.test` or `yard2@example.test`. For the manager view, open `yard.html?yardEmulator=1&managerView=1` and sign in as `manager@example.test`.

The `yardEmulator=1` mode uses a named Firebase app connected only to the **demo-pbc-yard** Auth/Functions emulators. The backend emulator automatically uses that demo project’s Firestore/Storage emulators. No real Firebase credentials or live fleet writes are needed. Without this parameter, the normal portal Firebase connection is used; the new backend must be available for the feature to load.

## Validation

`node --test tests/yard-local.test.cjs` checks local sessions, task ownership, immediate cleaning completion and data persistence across restarts. `node tests/yard-local.browser.cjs` (with Playwright installed) tests real local sign-in, completion with photo evidence, reload, shift handover, shared tablet employee switching, general task assignment/completion/review, tablet layout and absence of external requests. Neither command needs Java or Firebase.

`node --test tests/yard.test.cjs` checks permissions, competing claims, ownership, immediate cleaning completion, shift handover, general task assignment/review, rolling weekly deadlines, actual-date tracking, EV/diesel input validation, backdated check handling and Sydney dates using an in-memory transaction fixture.

`node tests/yard.browser.cjs` (with Playwright installed) runs the actual UI against the yard service and an in-memory database. It checks full-fleet browsing, cleaning completion, EV checks, manager review, performer history and tablet layout. Authentication and callable transport are stubbed; these tests do not certify deployed Firebase permissions or Storage integration. Run the emulator workflow and test photo uploads before production deployment.

## October 2026 development update

The latest master changes have been merged into this development branch so driver job visibility, fatigue planning, workshop stability and filtered fleet printing remain current. Master and live hosting are not changed by this Yard work. Standalone detailed/deep cleaning frequency and a physical bus-in-yard tracking system remain outside this update.

## Live release from an authorised PC

The Node demo's sample employees and sample buses are never seeded into production. Production reads your existing fleet and Employees. For K SOTHISWARAN and Palad-im, use their existing employee records and actual Google sign-in emails, active status, and Yard Man role/access. Do not create duplicate employee records or use the example.test demo emails. Confirm production Firestore/Storage access rules as described above before staff use, and verify one actual sign-in and photo upload after backend deployment.

From a clean checkout of the release commit, deploy backend first:

```powershell
npm --prefix functions-yard ci
firebase deploy --config firebase.yard.json --only functions:yard --project punchbowl-driver-portal
```

Stop on any error. After a successful backend deployment, publish Hosting using the original portal config to preserve its rewrites:

```powershell
firebase deploy --config firebase.json --only hosting --project punchbowl-driver-portal
```

Open the live Workshop page and check **Yard Work Queue** and **Yard View**. The tablet page is `/yard.html`. Each employee uses Google sign-in and must only receive yard controls. Verify the real fleet, one cleaning completion with the correct employee/date and one photo. Verify the other employee can sign out/in and receive a handover. Actual Google authentication, deployed access rules and Storage remain unverified by the local browser tests.
