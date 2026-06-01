# Membership reporting warehouse

## End-to-end flow

1. **subscription-service** publishes `members.subscription.reporting.snapshot.v1` (+ lifecycle events) to RabbitMQ.
2. **reporting-service** consumers write `membership_event` + `membership_listing`, refresh today’s snapshot/metrics.
3. **Cron** (02:00 UTC daily, 03:00 UTC on 1st) builds period snapshots + monthly aggregates.
4. **Frontend** calls reporting-service via `REACT_APP_REPORTING_SERVICE_URL` (gateway: `…/reporting-service/api`; upstream paths are `/api/dashboard`, `/api/reports/membership`).

**502 from gateway:** OpenResty cannot reach `reporting-service:4005` — container down or not on `gateway_app-net`. On the VM: `docker ps`, `docker logs reporting-service`, then `docker compose build --no-cache reporting-service && docker compose up -d reporting-service`.

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

Requires policy permission **`reporting:read`** on membership report routes and dashboard.

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

## Backfill

Existing MongoDB subscriptions are not auto-imported. Options:

1. One-off export script from subscription + profile services into `membership_listing`
2. Replay from audit logs if available
3. Re-publish snapshots from a maintenance job in subscription-service
