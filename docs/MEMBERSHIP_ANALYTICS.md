# Membership analytics (dashboard, comparison, movement)

## Data model (`reporting_db` / schema `reports`)

| Table                          | Purpose                                                                                                                                          |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `membership_listing`           | Current denormalised member rows (source for snapshots)                                                                                          |
| `membership_period_snapshot`   | Member-level **as-of** copy for a calendar date                                                                                                  |
| `membership_kpi_monthly`       | Monthly headline KPIs + movement split (`new_join_in_month`, `rejoin_in_month`, `reinstate_in_month`, `cancelled_in_month`, `resigned_in_month`) |
| `membership_dimension_monthly` | Same metrics by dimension (`membershipCategory`, `grade`, `branch`, `region`, `section`, `workLocation`) and `member_segment`                    |

Run migrations before deploy:

```bash
cd backend/reporting-service
npm run migrate
```

Migration `004_movement_breakdown_columns.sql` adds movement columns required for **Membership Analytics** stacked charts.

## Ingest

Live rows come from RabbitMQ (`membership` / `profile` listeners) into `membership_listing`. Without listing data, dashboards return zeros.

## Snapshots & monthly aggregates

Historical months need **month-end snapshots** plus **monthly aggregates**:

```bash
TENANT_ID=your-tenant npm run snapshot -- 2025 12
# or
POST /reports/membership/snapshots/build
{ "period": { "type": "month_end", "year": 2025, "month": 12 } }
```

`POST /dashboard/membership` automatically:

1. Ensures snapshot + `membership_kpi_monthly` / `membership_dimension_monthly` for the **selected month**
2. Ensures the **last 12 months** used by the analytics trend chart
3. Ensures prior month / YTD snapshot dates for KPI chips

Verify / backfill:

```bash
TENANT_ID=your-tenant npm run verify:dashboard
TENANT_ID=your-tenant node scripts/verifyDashboardReadiness.js --backfill-months=12
```

## Student / honorary filters

`member_segment` on snapshots: `paid` | `student` | `honorary`.

API flags: `includeStudents`, `includeHonorary` (default **false** = paid only).

## Executive dashboard API

`POST /dashboard/membership`  
Permission: `reporting:read`  
Header: `x-tenant-id`, `Authorization`

### Request body (`filters` object or top-level)

| Field                  | Type     | Description                                 |
| ---------------------- | -------- | ------------------------------------------- |
| `year`                 | number   | Selected calendar year (e.g. 2026)          |
| `month`                | number   | Selected month 1–12                         |
| `includeStudents`      | boolean  | Include student segment                     |
| `includeHonorary`      | boolean  | Include honorary segment                    |
| `membershipCategories` | string[] | Filter (toolbar label: Membership Category) |
| `grades`               | string[] | Filter                                      |
| `sections`             | string[] | Filter (Section Primary)                    |
| `regions`              | string[] | Filter                                      |
| `branches`             | string[] | Filter                                      |

Toolbar labels are also accepted: `"Membership Category"`, `Grade`, etc.

Example:

```json
{
  "filters": {
    "year": 2026,
    "month": 5,
    "includeStudents": false,
    "includeHonorary": false,
    "regions": ["Dublin"]
  }
}
```

### Response (`data` after unwrap)

| Block                                           | Content                                                                                                                                                     |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `kpis`                                          | Headline compare objects (`totalActiveMembers`, `newJoiners`, `leavers`, `netGrowth`, segment counts, `ytdActive`, `ytdJoiners`, `thisMonthVsLastMonth`, …) |
| `distributions`                                 | Active count by category, grade, section, branch, region (middle-row charts)                                                                                |
| `movementAnalytics`                             | **Membership Analytics** section                                                                                                                            |
| `movementAnalytics.headline`                    | Selected month totals: `active`, `newJoin`, `rejoin`, `reinstate`, `resigned`, `cancelled`                                                                  |
| `movementAnalytics.byCategory`                  | Stacked breakdown by membership category                                                                                                                    |
| `movementAnalytics.byBranch`                    | By branch                                                                                                                                                   |
| `movementAnalytics.byGrade`                     | By grade                                                                                                                                                    |
| `movementAnalytics.bySection`                   | By section                                                                                                                                                  |
| `movementAnalytics.trend12Months`               | Last 12 months ending at selected month (same six metrics)                                                                                                  |
| `asOfDate`, `periodYear`, `periodMonth`         | Selected period                                                                                                                                             |
| `hasPriorMonthSnapshot`, `hasPriorYearSnapshot` | KPI chip hints                                                                                                                                              |

Movement definitions (from month-end `membership_period_snapshot`):

- **active** — `membership_status = 'Active'` at snapshot date
- **newJoin** — `membership_movement = 'NewJoin'` with `start_date` in month
- **rejoin** — `Rejoin` in month
- **reinstate** — `Reinstate` in month
- **resigned** — `resigned_at` in month range
- **cancelled** — `cancelled_at` in month range

When toolbar dimension filters are set, movement queries scan snapshots. Otherwise aggregates come from `membership_dimension_monthly` (faster).

## Comparison report

`POST /reports/membership/compare`

Same filter fields as dashboard (`referenceYear` / `referenceMonth` for period anchor).

```json
{
  "dual": true,
  "referenceYear": 2026,
  "referenceMonth": 5,
  "includeStudents": false,
  "includeHonorary": false,
  "membershipCategories": ["General All Grades"],
  "dimensions": ["membershipCategory", "grade", "region", "branch", "section"]
}
```

Presets: `same_month_last_year`, `year_end_vs_current`, `last_month_vs_current`.

## Live stats

`POST /reports/membership/live-stats` — monthly rows from `membership_dimension_monthly` (`recompute: true` rebuilds snapshots + aggregates).

## Statistics report (UI: `/StatisticsReport`)

`POST /reports/membership/statistics` — year movement summary and breakdowns by fee type and region. Same reconciliation rules as below; fee type maps to warehouse `payment_type` (e.g. Full fee, Reduced fee, No fee).

## Year reconciliation (full-year active count)

Use this when you need:

**Opening active (1 Jan)** + **new join** + **rejoin** + **reinstate** − **cancelled** − **resigned** ≈ **closing active (31 Dec)**

`POST /reports/membership/year-reconciliation`  
Permission: `reporting:read`

```json
{
  "year": 2025,
  "includeStudents": false,
  "includeHonorary": false,
  "regions": ["Dublin"]
}
```

Optional: `throughMonth` (1–12). Defaults to 12 for past years, or the current month for the current calendar year.

### How opening and closing are defined

| Term | Source |
|------|--------|
| Opening (1 Jan) | Active count on the **31 Dec (year−1)** month-end snapshot — same membership population at the start of 1 Jan |
| Movements | Sum of monthly counts Jan–`throughMonth` from `membership_dimension_monthly` (or snapshot scans when dimension filters are set) |
| Closing | Active count on the **month-end snapshot** for `throughMonth` (31 Dec when `throughMonth` is 12) |

**Renewed** is not in the formula: those members were already active in opening.

### Response

- `opening`, `movements`, `closing` — counts and `asOfDate`
- `reconciliation.calculatedClosing` — formula result
- `reconciliation.variance` — `actualClosing − calculatedClosing` (should be 0 when snapshots and aggregates are complete)
- `reconciliation.balances` — `true` when variance is 0

Build prior-year and year-end snapshots if `snapshotAvailable` is false:

```bash
POST /reports/membership/snapshots/build
{ "period": { "type": "year_end", "year": 2024 } }
```

### Membership listing report vs reconciliation

`POST /reports/membership/listing` returns **one row per subscription in its current state**. Filtering by dates (e.g. start date in 2025) does **not** produce opening + movements − leavers. Use **year-reconciliation** or the executive dashboard YTD movement totals instead.

## Scheduled jobs

`jobs/scheduledSnapshots.js` — configure cron to snapshot prior month-end after listing is stable.

## Limitations

- Auto-built snapshots from **current** listing only approximate history; use scheduled month-end builds for accurate trends.
- First dashboard load after deploy may take longer while 12 months of metrics are ensured.
- Re-run `npm run migrate` and `--backfill-months=12` after upgrading to populate movement columns on existing KPI rows.
