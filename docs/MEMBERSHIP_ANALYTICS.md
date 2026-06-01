# Membership analytics (comparison, live stats, dashboard)

## Data model

| Table | Purpose |
|-------|---------|
| `membership_period_snapshot` | Member-level **as-of** copy for a calendar date (month-end, year-end, or today) |
| `membership_kpi_monthly` | Monthly headline KPIs (active, joiners, leavers, paid/student/honorary) |
| `membership_dimension_monthly` | Monthly counts by category, grade, branch, region, section |

Snapshots are built from **`membership_listing`** (current state). Historical comparisons only work for dates you have snapshotted.

## Student / honorary filters

`member_segment` on each snapshot row:

- `student` — category name contains `student`
- `honorary` — category contains `honorary`
- `paid` — everything else

API flags: `includeStudents`, `includeHonorary` (default both **false** = paid only).

## 1. Comparison report

`POST /reports/membership/compare`

**Year-end 2025 vs May 2026:**

```json
{
  "periodA": { "type": "year_end", "year": 2025 },
  "periodB": { "type": "month_end", "year": 2026, "month": 5 },
  "includeStudents": false,
  "includeHonorary": false,
  "dimensions": ["membershipCategory", "grade", "branch", "region"]
}
```

**April 2026 vs May 2026:**

```json
{
  "periodA": { "type": "month_end", "year": 2026, "month": 4 },
  "periodB": { "type": "month_end", "year": 2026, "month": 5 }
}
```

**May 2025 vs May 2026:**

```json
{ "preset": "same_month_last_year" }
```

Or explicit periods as above with `year: 2025, month: 5` and `year: 2026, month: 5`.

Response includes `periodA`, `periodB`, `kpiChange`, and `breakdown` per dimension (count A, count B, change).

## 2. Live stats (monthly)

`POST /reports/membership/live-stats`

```json
{
  "years": [2025, 2026],
  "months": [4, 5],
  "dimensions": ["membershipCategory", "grade", "branch", "region", "section"],
  "includeStudents": false,
  "includeHonorary": false,
  "recompute": true
}
```

`recompute: true` rebuilds snapshots + aggregates for each year/month before returning rows.

Each row: `periodYear`, `periodMonth`, `dimension`, `dimensionValue`, `activeCount`, `cancelledInMonth`, `resignedInMonth`, `joinersInMonth`, `leaversInMonth`.

## 3. Dashboard

`POST /dashboard/` (unified dashboard body)

```json
{
  "includeStudents": true,
  "includeHonorary": false
}
```

Returns:

- KPIs with **current vs prior** (`totalActiveMembers`, `paidMembers`, `studentMembers`, `honoraryMembers`, `ytdActive`, `thisMonthVsLastMonth`)
- MTD **joiners / leavers / net** from live `membership_listing`
- **Distributions** (active count) by category, grade, section, workLocation, branch, region for current month-end snapshot

## Building snapshots

```bash
# One month
TENANT_ID=your-tenant npm run snapshot -- 2025 12

# Or API (requires reporting:write)
POST /reports/membership/snapshots/build
{ "period": { "type": "month_end", "year": 2025, "month": 12 } }
```

Run month-end snapshots on a schedule (e.g. 1st of month for previous month) for accurate comparisons.

## Limitations

- Comparisons are **as-of snapshot** counts, not full event replay.
- Without snapshots for a date, the API **auto-builds** from current listing (accurate only if listing reflects that date — use scheduled snapshots for history).
- Joiners/leavers in a month use movement dates + cancel/resign timestamps on the **month-end snapshot** row.
