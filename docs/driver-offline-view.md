# Driver offline viewing — development release

This release adds a separate, read-only saved-work page for ordinary active drivers. It is not full offline operation and has not been deployed to production.

## What is saved

Open My Work while connected to download the current two-week roster. Only server-confirmed Assigned and Cancelled duties belonging to the signed-in employee are saved. Open each duty sheet online to download its resolved job sections, routes/stops and scheduled breaks. Merely downloading the roster does not download job details. Pending, deleted and other drivers' duties are excluded. Job details are saved only after the existing duty-assignment resolution succeeds.

The driver sees a saved-work link and counts above the portal. The separate `/offline.html` page uses local assets only; it has no Firebase/CDN dependency and no update controls. It labels roster and detail save times in Sydney time, distinguishes missing job details and saved cancellations, and warns that changes cannot arrive offline. PDFs, attachments, notices, reports, uploads, allocations and push notifications are not downloaded for offline use. No offline change queue or global Firestore persistence is introduced.

## Device and retention behaviour

The copy is stored in this browser's local storage, up to 200 duties and 750,000 JSON characters. Anyone with access to the same unlocked browser can view downloaded work: use a driver's own device. Admin and company Yard tablet logins do not create a driver copy. This release does not add Yard offline operation.

Copies expire 72 hours after roster sync; individually saved job details also expire after 72 hours even when the roster is refreshed. Duty edits invalidate that duty's downloaded details; an unchanged roster does not pretend old details were refreshed. A job-only change is downloaded the next time that duty sheet is opened online. Saved copies may therefore be stale, even when the device is connected. Consult live My Work for current information.

Sign-out immediately removes the copy before notification cleanup. Switching users or employee identity, or signing in without eligible Driver access, removes the previous copy. A device-owner marker stops delayed callbacks in another tab from recreating a signed-out user's copy. Remove saved work is also available on the saved-work page. Opening My Work again while signed in downloads a new copy. Storage failures do not prevent normal online work.

When an open eligible driver portal detects offline status, a modal offers the saved-work page and prevents interacting with the underlying page until connectivity returns. Acknowledgment writes reject known-offline requests. The separate saved page never sends writes. Browser online status is only a connectivity hint; this release does not guarantee that every live form can detect an unreachable server before a request.

## Local testing (Windows, existing repository)

Use a separate worktree so local changes in the existing project are preserved. These commands do not deploy anything:

```powershell
git fetch origin
git worktree add --detach ..\driver-offline-test origin/feature/driver-offline-view
cd ..\driver-offline-test
firebase serve --only hosting --project punchbowl-driver-portal --port 5000
```

If that sibling folder already exists, use another new folder name. Stop any previous server using port 5000 first. This uses the existing Firebase CLI and needs no admin installation. Open `http://localhost:5000/index.html?page=myWork`.

**Local hosting still connects to the configured live Firebase backend. Use the existing test driver and do not create/edit real duties merely to test offline viewing.** There are no backend/rules/schema changes in this release.

1. While online, sign in as an ordinary active driver. Open My Work and wait for the saved roster count.
2. Open a duty with multiple job sections; check that the saved sheet count increases. Open another duty if available.
3. Open View saved work. Check dates, bus, times, sections, stops and breaks against live work. Check that unopened duties say job details not downloaded.
4. Return online and wait for `navigator.serviceWorker.ready` in the browser console. Refresh once to ensure the new worker controls the page.
5. Use browser Developer Tools Network → Offline, or airplane mode on a phone after serving this development build over HTTPS. Reopen the app and reload. The saved-work page must open without Firebase/CDN requests being needed.
6. Verify there are no confirmation/report/assignment controls. Return to live My Work is blocked when the browser reports offline.
7. Reconnect, return to live My Work, and compare current work. Open the duty again to refresh its downloaded details.
8. Sign out online, then reopen offline: no saved duties should remain. Repeat with a different test account and with a second tab; no previous driver's work should appear.
9. Test Remove saved work and a browser that denies local storage. Online My Work must still function.

## Verification

- Node unit/regression suite: `NODE_PATH=<existing functions-yard/node_modules> node --test tests/*.test.cjs` (NODE_PATH is needed only when the SDK dependencies are not installed in this checkout).
- DOM checks: install jsdom in a temporary folder and run `JSDOM_PATH=<jsdom package path> node tests/driver-offline.dom.cjs`.
- Added coverage for ownership, withdrawals, cancellation, stale render rejection, expiry, quota/storage failure, worker fallback and optional-asset failures, and read-only DOM behaviour.
- A real Chromium session could not launch in the execution environment. Browser service-worker installation, a full reopen in airplane mode, iOS/Android behaviour and production Hosting remain manual acceptance checks. DOM/worker mocks are not evidence of a real offline device test.

Do not deploy this branch until the local/device checks have been reviewed. No Cloud Functions deployment is needed for this feature.
