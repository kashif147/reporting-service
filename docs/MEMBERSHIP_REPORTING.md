# Membership reporting warehouse

## End-to-end flow

1. **subscription-service** publishes `members.subscription.reporting.snapshot.v1` (+ lifecycle events) to RabbitMQ.
2. **reporting-service** consumers write `membership_event` + `membership_listing`, refresh today’s snapshot/metrics.
3. **Cron** (02:00 UTC daily, 03:00 UTC on 1st) builds period snapshots + monthly aggregates.
4. **Frontend** calls reporting-service via `REACT_APP_REPORTING_SERVICE_URL` (gateway: `…/reporting-service/api`; upstream paths are `/api/dashboard`, `/api/reports/membership`).

**502 from gateway:** OpenResty cannot reach `reporting-service:4005` — container down or not on `gateway_app-net`. On the VM: `docker ps`, `docker logs reporting-service`, then `docker compose build --no-cache reporting-service && docker compose up -d reporting-service`.

**CORS duplicate `Access-Control-Allow-Origin`:** Set CORS only once on the gateway (server/https block). Do not repeat `add_header Access-Control-*` inside `/reporting-service/api/` location. Set `GATEWAY_HANDLES_CORS=true` on reporting-service and use `proxy_hide_header Access-Control-*` on that location. Include `X-Tenant-Id` in `Access-Control-Allow-Headers`.

### Frontend routes

| Screen | URL |
|--------|-----|
| Membership Dashboard | `/MembershipDashboard` |
| New Members | `/NewMembersReport` |
| Joiners | `/JoinersReport` |
| Resigned | `/ResignedMembersReport` |
| Cancelled | `/CancelledMembersReport` |
| Comparison | `/ComparisonReport` |
| Live Stats | `/LiveStatsReport` |
| Membership Listing | `/MembershipListingReport` |
| Statistics | `/StatisticsReport` |

Requires policy permission **`reporting:read`** on membership report routes and dashboard. Save View templates for Membership Listing use **`reporting:write`** on `POST/PUT/DELETE /api/templates` (stored in reporting-service MongoDB — set `MONGO_URI` on the service).

Frontend report standard (columns, filters, CSV/XLSX/PDF/print, row chrome): `frontend/ProjectShell-1/docs/MEMBERSHIP_REPORT_STANDARD.md`.

## Overview

`reporting_db` stores membership data for dashboards and listing reports:

| Table | Purpose |
|-------|---------|
| `reports.membership_event` | Append-only log of every consumed RabbitMQ event |
| `reports.membership_listing` | Denormalized row per subscription (filterable listing reports) |

Data is ingested from RabbitMQ (not written by the CRM API directly).

## Events consumed

**`membership.events`**

- `members.subscription.reporting.snapshot.v1` — full row upsert (primary source)
- `members.subscription.changed.v1` — upsert from `after` subscription document
- `members.subscription.resigned.v1` / `cancelled.v1` — patch status and dates
- Other membership lifecycle keys — stored in `membership_event` only

**`profile.events`**

- `profile.created` / `profile.updated` — patch name, grade, branch, region, work location on all listing rows for that profile

## Publishing snapshots (subscription-service)

`publishReportingSnapshotForSubscription()` runs after:

- Subscription create (upsert listener)
- CRM subscription update (`updateSubscriptionById`)
- Resign / cancel

## API

### Statistics (year movement)

`POST /reports/membership/statistics` (requires `reporting:read`)

Membership **Statistics** report: summary reconciliation for a calendar year plus breakdowns by **fee type** (`payment_type`) and **region**. Body: `{ "year": 2025, "throughMonth": 12, "includeStudents": false, "includeHonorary": false }` plus optional dashboard dimension filters (`regions`, `grades`, …).

By default the endpoint **reads existing snapshots and monthly aggregates** only (no rebuild). Pass `"recompute": true` or `"ensureSnapshots": true` to trigger snapshot/metric builds for the opening/closing periods and YTD months (use sparingly; e.g. after ETL or from an admin job).

### Workplace membership breakdown

`POST /reports/membership/workplace-breakdown` (requires `reporting:read`)

Rolling monthly member counts per **work location**, grouped by **region**, with MoM/YoY deltas and **official (IRO)** from `membership_location_lookup` (sync via `node scripts/sync-location-lookups.js --tenant=TENANT_ID`).

Body example:

```json
{
  "endYear": 2024,
  "endMonth": 4,
  "rollingMonths": 12,
  "membershipStatuses": ["Active"],
  "includeStudents": false,
  "includeHonorary": false,
  "audienceScope": "full",
  "ensureSnapshots": true,
  "syncLookups": true
}
```

Optional filters: `regions`, `branches`, `workLocations`, `grades`, `membershipCategories`, `officials`, `excludeGrades`. Audience scoping: `audienceScope` (`full` | `official` | `manager`) with `scopeUserId` — **official** filters to workplaces where the user is IRO; **manager** filters to workplaces where the user is branch officer or region officer (from lookup hierarchy).

Response includes `summary` (org KPIs), `officialSummary` (grouped by IRO), `trendSeries` (org trend, top workplaces, MoM movers), and `period.yoyColumn` metadata. YoY compares the end month to the same calendar month one year prior (YoY snapshot date is fetched even when outside the rolling display window).

Run migration `005_workplace_breakdown.sql` before first use (`npm run migrate` in reporting-service).

### Year reconciliation (API only)

`POST /reports/membership/year-reconciliation` (requires `reporting:read`)

Summary-only variant used internally by Statistics. See `docs/MEMBERSHIP_ANALYTICS.md` § Year reconciliation.

### Membership listing

`POST /reports/membership/listing` (requires `reporting:read`)

Body example:

```json
{
  "membershipStatuses": ["Active"],
  "membershipMovements": ["NewJoin", "Renewed"],
  "membershipCategories": ["General All Grades"],
  "grades": ["Staff Nurse"],
  "regions": ["Dublin"],
  "branches": ["Dublin North"],
  "workLocations": ["Hospital A"],
  "paymentTypes": ["Salary Deduction"],
  "paymentFrequencies": ["Monthly"],
  "subscriptionYears": [2025],
  "isCurrent": true,
  "dateRange": {
    "field": "startDate",
    "from": "2025-01-01",
    "to": "2025-12-31"
  },
  "search": "Smith",
  "limit": 500,
  "offset": 0
}
```

`dateRange.field`: `startDate` | `expiryDate` | `cancelledAt` | `resignedAt` | `processedAt`

Movement filter accepts enum values (`NewJoin`, `Rejoin`, `Reinstate`, `Renewed`) or labels (`New Joiners`, `Re-Joiners`, etc.).

## Operations

```bash
# Run migrations (local / deploy once)
RUN_REPORTING_MIGRATIONS=true npm run migrate
# or
npm run migrate

# Requires RABBIT_URL for live ingestion
```

### Seed dashboard demo data (regions + categories)

Populates `membership_listing` with `seed-dashboard-*` rows using **live lookup data** from user-service MongoDB (membership category products, regions/branches/work locations, grades, primary sections, payment types), then rebuilds snapshots and monthly aggregates.

Requires `MONGO_URI` (user-service database). The seed script also loads `backend/user-service/.env.staging` when present.

```bash
cd backend/reporting-service

# Local
TENANT_ID=your-tenant-id npm run seed:dashboard

# Replace existing seed rows
TENANT_ID=your-tenant-id node scripts/seedMembershipDashboard.js --clear --count=850

# Docker on VM (pass Mongo URI from user-service)
docker compose exec \
  -e MONGO_URI='mongodb+srv://...' \
  -e TENANT_ID=68cbf7806080b4621d469d34 \
  reporting-service node scripts/seedMembershipDashboard.js --clear
```

Optional env:

| Variable | Purpose |
|----------|---------|
| `MEMBERSHIP_CATEGORY_PRODUCT_TYPE_ID` | Product type for categories (default `68dae613c5b15073d66b891f`) |
| `SEED_LOOKUPS_FIXTURE` | Path to JSON fallback if Mongo is unreachable |
| `SEED_LOOKUPS_FIXTURE_ONLY=true` | Skip Mongo; use fixture only |

Use the same `TENANT_ID` / `DEFAULT_TENANT_ID` as the frontend sends on dashboard API calls. Remove demo data with `--clear` (deletes only `subscription_id` like `seed-dashboard-%`).

## Backfill

Existing MongoDB subscriptions are not auto-imported. Options:

1. One-off export script from subscription + profile services into `membership_listing`
2. Replay from audit logs if available
3. Re-publish snapshots from a maintenance job in subscription-service
