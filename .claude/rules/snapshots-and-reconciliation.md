# Snapshots, cron, and why "listing" != "reconciliation"

`membership_listing` is always **current-state only** (one row per subscription's live status) —
it cannot answer "how many were active in June." `membership_period_snapshot` plus
`membership_kpi_monthly`/`membership_dimension_monthly` are the point-in-time layer built on top of
it (`services/snapshotBuild.service.js`, `repositories/membershipSnapshot.repository.js`,
`repositories/membershipAnalytics.repository.js`).

`jobs/scheduledSnapshots.js` (gated by `ENABLE_REPORTING_CRON`, default on) runs daily current-day
snapshots plus a monthly previous-month close, iterating every distinct `tenant_id` present in
`membership_listing` (falling back to `DEFAULT_TENANT_ID` if none exist yet — relevant right after a
fresh deploy with no ingested data).

Before doing any calculation that needs "how many members were active as of a past date," use the
snapshot tables, not `membership_listing` — using `membership_listing` for that produces a
current-state answer mislabeled as historical. See `docs/MEMBERSHIP_ANALYTICS.md`'s "Year
reconciliation" section for the exact opening + movements − leavers = closing formula; this distinction
trips people up because both `membership_listing` and the snapshot tables look like generic
"membership data" APIs.
