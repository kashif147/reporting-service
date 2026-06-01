const { pool } = require("../db/postgres");
const { appendSegmentFilter } = require("../lib/memberSegment");
const {
  appendDimensionFilters,
  hasDimensionFilters,
} = require("../lib/membershipDimensionFilters");
const { monthRange, resolvePeriod } = require("../lib/reportingPeriods");
const { DIMENSION_COLUMNS } = require("./membershipAnalytics.repository");

function useSnapshotMovementQueries(dimensionOpts) {
  return hasDimensionFilters(dimensionOpts);
}

const MOVEMENT_COUNT_SQL = `
  COUNT(*) FILTER (WHERE membership_status = 'Active')::int AS active,
  COUNT(*) FILTER (
    WHERE membership_movement = 'NewJoin'
      AND start_date >= $MONTH_START::date AND start_date <= $AS_OF_DAY::date
  )::int AS new_join,
  COUNT(*) FILTER (
    WHERE membership_movement = 'Rejoin'
      AND start_date >= $MONTH_START::date AND start_date <= $AS_OF_DAY::date
  )::int AS rejoin,
  COUNT(*) FILTER (
    WHERE membership_movement = 'Reinstate'
      AND start_date >= $MONTH_START::date AND start_date <= $AS_OF_DAY::date
  )::int AS reinstate,
  COUNT(*) FILTER (
    WHERE resigned_at >= $RANGE_START::timestamptz AND resigned_at < $RANGE_END::timestamptz
  )::int AS resigned,
  COUNT(*) FILTER (
    WHERE cancelled_at >= $RANGE_START::timestamptz AND cancelled_at < $RANGE_END::timestamptz
  )::int AS cancelled`;

function mapMovementRow(row, name = "Total") {
  return {
    name: row?.name ?? name,
    active: Number(row?.active) || 0,
    newJoin: Number(row?.new_join) || 0,
    rejoin: Number(row?.rejoin) || 0,
    reinstate: Number(row?.reinstate) || 0,
    resigned: Number(row?.resigned) || 0,
    cancelled: Number(row?.cancelled) || 0,
  };
}

function movementAsOfDay(year, month, asOfDate) {
  const now = new Date();
  if (
    year === now.getUTCFullYear() &&
    month === now.getUTCMonth() + 1
  ) {
    return new Date().toISOString().slice(0, 10);
  }
  return asOfDate;
}

function buildMovementQueryParts(tenantId, asOfDate, year, month, segmentOpts, dimensionOpts) {
  const { start, end } = monthRange(year, month);
  const monthStart = `${year}-${String(month).padStart(2, "0")}-01`;
  const asOfDay = movementAsOfDay(year, month, asOfDate);

  const where = ["tenant_id = $1", "snapshot_date = $2::date"];
  const params = [tenantId, asOfDate];
  appendSegmentFilter(where, params, segmentOpts);
  appendDimensionFilters(where, params, dimensionOpts);

  const pMonthStart = params.length + 1;
  params.push(monthStart);
  const pAsOfDay = params.length + 1;
  params.push(asOfDay);
  const pRangeStart = params.length + 1;
  params.push(start);
  const pRangeEnd = params.length + 1;
  params.push(end);

  const countsSql = MOVEMENT_COUNT_SQL.replace(/\$MONTH_START/g, `$${pMonthStart}`)
    .replace(/\$AS_OF_DAY/g, `$${pAsOfDay}`)
    .replace(/\$RANGE_START/g, `$${pRangeStart}`)
    .replace(/\$RANGE_END/g, `$${pRangeEnd}`);

  return { where, params, countsSql };
}

async function getMovementHeadlineFromMonthlyAggregates(
  tenantId,
  year,
  month,
  segmentOpts
) {
  const where = [
    "tenant_id = $1",
    "period_year = $2",
    "period_month = $3",
    "dimension = 'membershipCategory'",
  ];
  const params = [tenantId, year, month];
  appendSegmentFilter(where, params, segmentOpts);
  const { rows } = await pool.query(
    `SELECT
      COALESCE(SUM(active_count), 0)::int AS active,
      COALESCE(SUM(new_join_in_month), 0)::int AS new_join,
      COALESCE(SUM(rejoin_in_month), 0)::int AS rejoin,
      COALESCE(SUM(reinstate_in_month), 0)::int AS reinstate,
      COALESCE(SUM(resigned_in_month), 0)::int AS resigned,
      COALESCE(SUM(cancelled_in_month), 0)::int AS cancelled
    FROM membership_dimension_monthly
    WHERE ${where.join(" AND ")}`,
    params
  );
  return mapMovementRow(rows[0]);
}

async function getMovementBreakdownFromMonthlyAggregates(
  tenantId,
  year,
  month,
  dimension,
  segmentOpts,
  { limit = 15 } = {}
) {
  const where = [
    "tenant_id = $1",
    "period_year = $2",
    "period_month = $3",
    "dimension = $4",
  ];
  const params = [tenantId, year, month, dimension];
  appendSegmentFilter(where, params, segmentOpts);
  const { rows } = await pool.query(
    `SELECT
      dimension_value AS name,
      COALESCE(SUM(active_count), 0)::int AS active,
      COALESCE(SUM(new_join_in_month), 0)::int AS new_join,
      COALESCE(SUM(rejoin_in_month), 0)::int AS rejoin,
      COALESCE(SUM(reinstate_in_month), 0)::int AS reinstate,
      COALESCE(SUM(resigned_in_month), 0)::int AS resigned,
      COALESCE(SUM(cancelled_in_month), 0)::int AS cancelled
    FROM membership_dimension_monthly
    WHERE ${where.join(" AND ")}
    GROUP BY dimension_value
    ORDER BY active DESC, name
    LIMIT $${params.length + 1}`,
    [...params, Math.min(Math.max(Number(limit) || 15, 1), 50)]
  );
  return rows.map((r) => mapMovementRow(r));
}

async function getMovementTrendFromMonthlyAggregates(
  tenantId,
  refYear,
  refMonth,
  segmentOpts
) {
  const anchor = new Date(Date.UTC(refYear, refMonth - 1, 1));
  const monthSlots = [];
  for (let i = 11; i >= 0; i -= 1) {
    const d = new Date(
      Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() - i, 1)
    );
    monthSlots.push({
      year: d.getUTCFullYear(),
      month: d.getUTCMonth() + 1,
    });
  }

  const rows = await Promise.all(
    monthSlots.map(async ({ year, month }) => {
      const resolved = resolvePeriod({ type: "month_end", year, month });
      const row = await getMovementHeadlineFromMonthlyAggregates(
        tenantId,
        year,
        month,
        segmentOpts
      );
      return {
        ...row,
        year,
        month,
        periodLabel: resolved.label,
        monthLabel: new Date(Date.UTC(year, month - 1, 1)).toLocaleString(
          "en-IE",
          { month: "short", year: "2-digit", timeZone: "UTC" }
        ),
      };
    })
  );
  return rows;
}

async function getMovementHeadlineForMonthFromSnapshot(
  tenantId,
  asOfDate,
  year,
  month,
  segmentOpts,
  dimensionOpts = {}
) {
  const { where, params, countsSql } = buildMovementQueryParts(
    tenantId,
    asOfDate,
    year,
    month,
    segmentOpts,
    dimensionOpts
  );

  const { rows } = await pool.query(
    `SELECT ${countsSql}
     FROM membership_period_snapshot
     WHERE ${where.join(" AND ")}`,
    params
  );
  return mapMovementRow(rows[0]);
}

async function getMovementHeadlineForMonth(
  tenantId,
  asOfDate,
  year,
  month,
  segmentOpts,
  dimensionOpts = {}
) {
  if (useSnapshotMovementQueries(dimensionOpts)) {
    return getMovementHeadlineForMonthFromSnapshot(
      tenantId,
      asOfDate,
      year,
      month,
      segmentOpts,
      dimensionOpts
    );
  }
  return getMovementHeadlineFromMonthlyAggregates(
    tenantId,
    year,
    month,
    segmentOpts
  );
}

async function getMovementBreakdownByDimensionFromSnapshot(
  tenantId,
  asOfDate,
  year,
  month,
  dimension,
  segmentOpts,
  dimensionOpts = {},
  { limit = 15 } = {}
) {
  const col = DIMENSION_COLUMNS[dimension];
  if (!col) throw new Error(`Unknown dimension: ${dimension}`);

  const { where, params, countsSql } = buildMovementQueryParts(
    tenantId,
    asOfDate,
    year,
    month,
    segmentOpts,
    dimensionOpts
  );

  const { rows } = await pool.query(
    `SELECT
      COALESCE(NULLIF(TRIM(${col}::text), ''), '(blank)') AS name,
      ${countsSql}
    FROM membership_period_snapshot
    WHERE ${where.join(" AND ")}
    GROUP BY 1
    ORDER BY active DESC, name
    LIMIT $${params.length + 1}`,
    [...params, Math.min(Math.max(Number(limit) || 15, 1), 50)]
  );

  return rows.map((r) => mapMovementRow(r));
}

async function getMovementBreakdownByDimension(
  tenantId,
  asOfDate,
  year,
  month,
  dimension,
  segmentOpts,
  dimensionOpts = {},
  options = {}
) {
  if (useSnapshotMovementQueries(dimensionOpts)) {
    return getMovementBreakdownByDimensionFromSnapshot(
      tenantId,
      asOfDate,
      year,
      month,
      dimension,
      segmentOpts,
      dimensionOpts,
      options
    );
  }
  return getMovementBreakdownFromMonthlyAggregates(
    tenantId,
    year,
    month,
    dimension,
    segmentOpts,
    options
  );
}

async function getMovementTrend12Months(
  tenantId,
  refYear,
  refMonth,
  segmentOpts,
  dimensionOpts = {}
) {
  if (useSnapshotMovementQueries(dimensionOpts)) {
    const anchor = new Date(Date.UTC(refYear, refMonth - 1, 1));
    const monthSlots = [];
    for (let i = 11; i >= 0; i -= 1) {
      const d = new Date(
        Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() - i, 1)
      );
      const year = d.getUTCFullYear();
      const month = d.getUTCMonth() + 1;
      const resolved = resolvePeriod({ type: "month_end", year, month });
      monthSlots.push({ year, month, resolved });
    }

    return Promise.all(
      monthSlots.map(({ year, month, resolved }) =>
        getMovementHeadlineForMonthFromSnapshot(
          tenantId,
          resolved.asOfDate,
          year,
          month,
          segmentOpts,
          dimensionOpts
        ).then((row) => ({
          ...row,
          year,
          month,
          periodLabel: resolved.label,
          monthLabel: new Date(Date.UTC(year, month - 1, 1)).toLocaleString(
            "en-IE",
            { month: "short", year: "2-digit", timeZone: "UTC" }
          ),
        }))
      )
    );
  }

  return getMovementTrendFromMonthlyAggregates(
    tenantId,
    refYear,
    refMonth,
    segmentOpts
  );
}

module.exports = {
  mapMovementRow,
  getMovementHeadlineForMonth,
  getMovementBreakdownByDimension,
  getMovementTrend12Months,
};
