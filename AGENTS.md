\# Punchbowl Driver Portal - Agent Instructions



\## Project

Punchbowl Driver Portal is a Firebase Hosting, Firestore, Auth, Cloud Messaging, Storage, and Functions app for bus dispatch and driver duty sheets.



\## Tech stack

\- Firebase Hosting

\- Firestore

\- Firebase Auth with Google Sign-In

\- Firebase Cloud Messaging

\- Firebase Storage

\- Firebase Functions

\- Vanilla JavaScript ES Modules

\- No React

\- No build step



\## Important files

\- public/js/main.js

\- public/js/admin\_v2.js

\- public/js/db.js

\- public/js/dispatch\_board.js

\- public/js/dispatch\_assignments.js

\- public/js/ui.js

\- public/js/state.js

\- functions/index.js



\## Safety rules

\- Do not deploy without explicit approval from Nalin.

\- Do not expose API keys in frontend JavaScript.

\- Google Maps / Routes API must be called from Firebase Functions, not public/js.

\- Always run git status before changing files.

\- Make small focused commits.

\- Do not remove working notification code.

\- Do not remove driver acknowledgment logic.

\- Do not change Firestore schema without explaining migration impact.

\- Preserve current live behaviour unless the task explicitly changes it.

\- Prefer small step-by-step changes that can be tested locally before deployment.



\## Workflow

1\. Explain the plan first.

2\. List files that will change.

3\. Make the smallest safe change.

4\. Show the diff.

5\. Provide local test steps.

6\. Wait for approval before deployment.



\## Current feature state

Multi-stop blocks:

\- Return same route creates separate Forward and Return blocks.

\- Forward and Return blocks can be assigned separately.

\- generatedLegs are saved on blocks.

\- Blocks By Date displays generatedLegs.

\- Blocks By Date can edit generatedLegs.

\- Duty Sheet displays generatedLegs.

\- Duty Sheet has a Return Trip divider.

\- Duty Sheet highlights arrival rows.



\## Current next improvement

Use Firebase Functions and Google Routes API to auto-calculate forward and return leg travel times, so dispatchers do not need to manually edit 50-100 generated return blocks.

