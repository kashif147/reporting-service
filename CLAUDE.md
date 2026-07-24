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
npm run seed:dashboard          # scripts/seedMembershipDashboard.js (needs TENANT_ID + user-service MONGO_URI)
npm run verify:dashboard        # scripts/verifyDashboardReadiness.js
npm run sync:creditors          # scripts/sync-member-creditors.js
npm run sync:gl-journals        # scripts/sync-gl-journal-entries.js
```

`npm test` is a stub — there is no test suite. `scripts/export-import-db.sh` plus
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

Reporting and dashboard routes require the `reporting:read` policy permission; grid template writes
(`POST/PUT/DELETE /api/templates`) require `reporting:write`. Auth mechanics themselves are the
platform-standard gateway-header/Bearer-JWT pattern validated via `@membership/policy-middleware` —
see that package's own `CLAUDE.md` for how the validation works.
