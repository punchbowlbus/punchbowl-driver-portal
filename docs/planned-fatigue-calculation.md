# Planned fatigue calculation

The PBC policy supplied on 9 October 2026 is the Bus and Coach Standard Hours table: 315 work minutes / 15 continuous rest minutes in 330 minutes; 450 / 30 in 480; 600 / 60 in 660; 720 work minutes and 420 continuous stationary-rest minutes in 1440; six night-rest breaks in seven days; 17280 work minutes and four continuous 1440-minute rests in 28 days. PBC additionally requires 480 minutes between the final duty of one service date and the first duty of the next working service date. Same-date split duties do not require this gap.

## Inputs and assumptions

All work must be represented in active duty spans. Pending duties count as planned work; cancelled and deleted duties do not. Meal and crib entries represent time free from work, whether paid or unpaid. Overlapping work intervals are merged, and a break cannot cancel overlapping work in another duty. Service-date grouping identifies the parts of a broken shift. Payroll calculations retain their existing meal/crib convention.

## Shared engine

`fatigue_schedule.js` supplies work/rest risks to Dispatch Board, bulk CSV validation, automatic duty creation, driver transfer, Driver Monitor, Operations Dashboard and Fatigue Tracking. Daily contexts now load 31 preceding service dates and two following dates. The first three historical dates protect against overnight duties crossing the declared coverage boundary. Bulk validation loads a continuous range across the file dates. Queries must succeed before coverage is declared.

Short periods begin at work resumptions. Long periods begin at the end of observed qualifying planned rest: seven continuous hours for 24 hours, a night-rest/24-hour alternative for seven days, and 24 continuous hours for 28 days. Earlier periods remain active after subsequent major rest. When the required rest is absent, observed rest resumptions are used only after a complete preceding period is available. Shifted work endpoints and arbitrary 08:00 rolling windows are no longer used for long-period alerts.

Incomplete periods may show a work excess already incurred, but cannot establish a rest pass or shortfall. Missing history, invalid duty/break records, unsupported employee hours options and unavailable anchors require review. A completely loaded history with no work shows NO SCHEDULED WORK, rather than inventing counting-period rest totals. Independent operator warnings are preserved and recognized stale calculator warnings are refreshed without rewriting historical Firestore documents.

## Regression example

H XU895 on 12 October: 07:33–09:02 and 13:25–20:32, meal 15:05–15:53. On 13 October: 05:55–16:45, meals 10:26–10:59 and 13:57–14:53. The planned 24-hour period beginning 12 October at 07:33 includes 566 work minutes (9h26). The inter-day company gap is 563 minutes (9h23). The arbitrary window beginning at 13:25 is not a qualifying major-rest anchor and no longer causes the 13h16 warning. This example is not a certificate of actual legal compliance.

## Validation and limits

Run `node --test tests/dispatch-fatigue-hotfix.test.cjs tests/fatigue-entry-paths.test.cjs tests/fatigue-tracking-hotfix.test.cjs`. The 62 cases include split/overnight duties, exact turnaround boundaries, an earlier overlapping 24-hour excess despite another eight-hour rest, incomplete periods, malformed breaks, and a completed 28-day excess/rest shortfall.

This remains a minute-precision planned schedule calculator. The coordinates are nominal service-date base-clock minutes; daylight-saving elapsed time, driver base-zone differences, actual stationary rest, outside work and written-work-diary rounding are not verified. The application is not an approved electronic work diary. No live deployment or live Firestore verification is included. Check the affected screens locally before merging to master or deploying.

Reference: https://www.nhvr.gov.au/safety-accreditation-compliance/fatigue-management/counting-time and https://www.nhvr.gov.au/safety-accreditation-compliance/fatigue-management/work-and-rest-hours
