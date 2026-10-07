# Fatigue safety audit — 7 October 2026

Scope: Dispatch Board, duty creation/editing, direct block assignment, duty transfers, Bulk Duty Spans CSV, Driver Monitor, Operations Dashboard, Fatigue Tracking, Driver My Work/Duty Sheet and notification consumers. Yard Work Queue and bus-wash development are excluded.

## Outcome

This update aligns **scheduled planning checks and messages**. It is not legal-compliance certification or an approved electronic work diary. Do not interpret an absence of planning alerts as confirmation of actual rest or fitness to drive.

| Area | Finding and correction |
| --- | --- |
| Short windows | Check each recorded work resumption, including later breaks and split duties; qualify rest inside the counted window. Preserve independent work-limit and minimum-rest checks. |
| Work versus qualifying rest | A recorded non-work break below 15 minutes reduces scheduled work but provides no minimum-rest credit. Overlapping/clipped breaks are merged without duplicate credit. Meal pay deductions are also clipped and merged. |
| 24-hour work | Use rolling base-clock work totals, including across service dates; do not equate a 36-hour duty's total work with work in one 24-hour period. Label these as scheduled risks, not statutory counting periods. |
| Stationary rest | Removed the inferred `24h minus duty span` stationary-rest pass. Legacy rest-result fields are unknown. The planned-rest report now calculates 24-hour/7-day/28-day rest from duty-span gaps under the operator’s confirmed no-duty/no-work policy. Actual stationary rest and statutory counting periods remain separate verification matters. |
| Hours option | Consult employee fatigue category. BFM, AFM, unknown or missing categories receive hours-option review; the Bus and Coach Standard Hours limits are not applied to those profiles. A Standard employee category alone does not establish that the bus/coach hours option legally applies. |
| Company turnaround | Shared calculation compares working-day boundaries, including extended overnight duties across skipped dates and nested overlaps. Messages identify the company 8-hour rule and scheduled base-clock gap. |
| Creation, CSV and transfer | Check surrounding service dates (three days each side for the entry UI's extended time range). Recalculate the target driver's roster before transfer and persist warnings atomically with the transfer. Direct block assignment now records calculated fatigue warnings. Legacy creation cannot silently default to unchecked OK. |
| Live screens | Recompute from surrounding roster and employee data, so assignment/deletion/cancellation/profile changes replace generated stale warnings. Preserve unrelated operator warnings. |
| Report | Render Standard Hours checks even with no turnaround rows. Clear stale results on load failure. Keep separate review dates rather than hiding all but one date per driver/rule. Invalid times cannot produce a compliant turnaround. |
| Messages | Dispatch uses PLAN ALERT, REVIEW and NO DUTY ALERT. Turnaround pass says COMPANY GAP MET. REVIEW and DATA REVIEW do not claim a confirmed legal breach. Driver Duty Sheet identifies scheduled times and tells the driver to contact Dispatch if fatigued or unable to complete safely. |
| Driver and notifications | Assignment confirmation/acknowledgment is not fatigue approval. No notification or Cloud Function asserts a fatigue-compliance result; no notification functions were changed. |

## Rule reference used

The planning profile is solo Bus and Coach Standard Hours: 5½h/5¼h work/15 continuous minutes rest; 8h/7½h work/30 minutes rest in qualifying blocks; 11h/10h work/60 minutes rest in qualifying blocks; 24h/12h work/7 continuous hours stationary rest; six night rests in seven days; 288h work and four 24-hour stationary rests in 28 days. These thresholds are not sufficient by themselves to establish a statutory breach.

Reviewed NHVR primary sources on 7 October 2026:

- https://www.nhvr.gov.au/safety-accreditation-compliance/fatigue-management/work-and-rest-hours
- https://www.nhvr.gov.au/safety-accreditation-compliance/fatigue-management/counting-time
- https://www.nhvr.gov.au/document/251
- https://www.nhvr.gov.au/safety-accreditation-compliance/fatigue-management

The current counting guidance requires statutory periods of 24 hours or longer to be anchored to the applicable major-rest end. Schedule-only rolling windows are expressly labelled planning indicators. Base time, actual activity and the diary's counting/rounding method must be verified separately.

## Verification

55 Node regression cases cover overnight/net-work limits, later and split-duty windows, short non-work rest versus qualifying rest, incomplete windows, clipped/overlapping breaks and pay, invalid times, cancelled/deleted records, profile loading, BFM/AFM/unknown profiles, stale warnings, operator-warning preservation, extended overnight turnaround, nested conflicts, automatic creation, invalid assignment, DB fallback and atomic transfer fields.

Additional planned-rest cases cover empty roster days, normal duties, overnight occupancy, following-day early starts, night-rest/24-hour alternatives without duplicate credit, 48-hour rest, exact seven-hour boundaries, cancelled/deleted records, overlapping duty breaks, missing coverage, invalid times and active drivers without any duties.

Headless browser smoke checks use mocked Firestore data in Australia/Sydney timezone for Fatigue Tracking, Driver Monitor, Operations Dashboard, Dispatch Board and Bulk Duty Spans. They check module loading and key rendered warnings, including Fatigue Tracking load failure. Imports, syntax and whitespace checks also pass. These are not tests against production driver work diaries, Firestore permissions or NHVR certification.

## Remaining operational requirements

- Verify the operator's applicable hours option, actual non-work/stationary rest, night-rest or 24-hour-rest alternatives, other work, major-rest anchors and complete diary history.
- Verify actual elapsed time across daylight-saving changes. This planner uses service-date base-clock coordinates.
- Apply the required written-work-diary rounding when using a written diary. Minute-precision scheduling does not turn this portal into an approved EWD.
- Employee records currently offer Standard/BFM/AFM only; ACH/permit/other options require review rather than guessed limits.
- Roster saves are snapshot checks, not a transactional prevention of every concurrent roster conflict. Manager review remains necessary.
- The existing workflow permits saving/importing risky duties for review. This update does not introduce an operational approval or allocation-blocking workflow.

No production driver records were rewritten by this audit. Publishing requires the separate Firebase Hosting deployment.

## Confirmed roster policy update — 7 October 2026

The operator confirmed that all work is represented by daily duty spans, and no active duty span means no scheduled work. The report now treats covered gaps as planned rest, without duplicate entry. It shows PLANNED PASS / PLANNED SHORTFALL and the calculated totals rather than a blanket rest-data warning.

Daily rolling planning reviews end at 08:00 on the following day so the final overnight rest and any following-day early start are included. Work is unioned across all service dates and recorded non-work breaks are subtracted; overlaps cannot manufacture rest. Night-rest and 24-hour alternatives use non-overlapping blocks. Continuous 24-hour rest blocks are counted only within the covered 28-day window. Every shortfall date is retained; positive totals are shown for the latest review date per driver.

The report loads 31 previous service dates and the following service date. Effective coverage excludes the leading margin needed for extended overnight duties. Rest is never inferred beyond successful query coverage, and invalid duty times retain DATA REVIEW. Employee hours-option review remains in place for unsupported or missing categories. Planned results remain separate from actual stationary rest, fitness to drive and statutory major-rest counting anchors.
