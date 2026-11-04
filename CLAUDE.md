# CLAUDE.md

`reporting-service` is an event-sourced reporting warehouse: RabbitMQ events from other services are
ingested into Postgres (`reporting_db`, schema `reports`) as denormalized/append-only tables, which
the CRM's dashboard and reporting screens query. It does **not** write membership or finance data
directly — everything in Postgres here is a read-optimized replica built from events, never the
source of truth. Port `4005`. `README.md` is a one-line placeholder — ignore it.

**Two docs here are the real, current, detailed reference — read them before changing reporting
logic, don't duplicate their content by re-deriving it from code:**
- `docs/MEMBERSHIP_REPORTING.md` — the membership warehouse: ingestion, `membership_event`/
  `membership_listing` tables, the Membership Listing report API, seeding/backfill.
- `docs/MEMBERSHIP_ANALYTICS.md` — dashboard/analytics: snapshot & monthly-aggregate model,
  executive dashboard API, comparison report, year reconciliation, scheduled jobs.

This file and its imports cover what those two don't: the finance/GL replication pipeline
(undocumented elsewhere), the Postgres+Mongo hybrid storage model, and infra facts before touching
deployment.

## Commands

```bash
npm start                    # node bin/reporting-service.js
npm run dev                   # nodemon
npm run migrate                # db/runMigrations.js — runs db/migrations/*.sql in order
npm run snapshot -- <year> <month>   # scripts/buildMonthlySnapshots.js
npm run seed:dashboard          # scripts/seedMembershipDashboard.js (needs OPERATOR_BEARER_TOKEN; reads user-service over HTTP)
npm run verify:dashboard        # scripts/verifyDashboardReadiness.js
npm run sync:creditors          # scripts/sync-member-creditors.js
npm run sync:gl-journals        # scripts/sync-gl-journal-entries.js
```

`npm test` is a stub — run the node:test suite directly: `node --test tests/*.test.js` (set `LOG_ROOT`
to an absolute temp dir). `scripts/export-import-db.sh` plus
`scripts/DB_EXPORT_IMPORT.md`/`BACKUP_RESTORE.md` cover Postgres dump/restore for this database —
**`DB_EXPORT_IMPORT.md`'s example commands embed a real local Postgres password; treat that file as
sensitive and don't paste its contents elsewhere.**

### Datastores (Postgres required, Mongo optional)
@.claude/rules/datastores.md

### RabbitMQ ingestion pipelines
@.claude/rules/rabbitmq-ingestion.md

### Snapshots, cron, and reconciliation
@.claude/rules/snapshots-and-reconciliation.md

### Shared Postgres infra
@.claude/rules/shared-postgres-infra.md

## Auth

Every route is CRM-only (`requireCrmUser` in `middlewares/auth.js`: a PORTAL or missing `userType` is
403 before the PDP is asked) and asks the PDP for one reporting family (PDP rollout P2, no generic
`reporting:read`): `reporting.statistics:read` (dashboards, statistics, compare, live-stats,
workplace-breakdown, year-reconciliation), `reporting.listings:read` (presets, listing),
`reporting.finance:read` (creditors/debtors lists), `reporting.templates:read|write` (Save View
`/api/templates`). `POST /snapshots/build` keeps `reporting:write`, which has no catalogue code, so only
ASU passes. `tests/reportingFamilies.p2.test.js` pins the route -> family table. Auth mechanics themselves are the
platform-standard gateway-header/Bearer-JWT pattern validated via `@membership/policy-middleware` —
see that package's own `CLAUDE.md` for how the validation works.
