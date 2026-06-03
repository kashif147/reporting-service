const { pool } = require("../db/postgres");
const { appendSegmentFilter } = require("../lib/memberSegment");
const { appendDimensionFilters } = require("../lib/membershipDimensionFilters");

/** Breakdown axes for Statistics report (stored in membership_dimension_monthly.dimension). */
const STATISTICS_BREAKDOWN_AXES = {
  feeType: { dimension: "paymentType", column: "payment_type", label: "Fee type" },
  region: { dimension: "region", column: "region", label: "Region" },
};

async function getActiveCountsByColumn(
  tenantId,
  asOfDate,
  column,
  segmentOpts,
  dimensionOpts = {},
) {
  const where = ["tenant_id = $1", "snapshot_date = $2::date"];
  const params = [tenantId, asOfDate];
  appendSegmentFilter(where, params, segmentOpts);
  appendDimensionFilters(where, params, dimensionOpts);

  const { rows } = await pool.query(
    `SELECT
      COALESCE(NULLIF(TRIM(${column}::text), ''), '(blank)') AS name,
      COUNT(*) FILTER (WHERE membership_status = 'Active')::int AS active
    FROM membership_period_snapshot
    WHERE ${where.join(" AND ")}
    GROUP BY 1
    ORDER BY active DESC, name`,
    params,
  );

  const map = new Map();
  for (const row of rows) {
    map.set(row.name, Number(row.active) || 0);
  }
  return map;
}

async function sumYtdMovementsByDimension(
  tenantId,
  year,
  throughMonth,
  dimension,
  segmentOpts,
) {
  const where = [
    "tenant_id = $1",
    "period_year = $2",
    "period_month <= $3",
    "dimension = $4",
  ];
  const params = [tenantId, year, throughMonth, dimension];
  appendSegmentFilter(where, params, segmentOpts);

  const { rows } = await pool.query(
    `SELECT
      dimension_value AS name,
      COALESCE(SUM(new_join_in_month), 0)::int AS new_join,
      COALESCE(SUM(rejoin_in_month), 0)::int AS rejoin,
      COALESCE(SUM(reinstate_in_month), 0)::int AS reinstate,
      COALESCE(SUM(resigned_in_month), 0)::int AS resigned,
      COALESCE(SUM(cancelled_in_month), 0)::int AS cancelled
    FROM membership_dimension_monthly
    WHERE ${where.join(" AND ")}
    GROUP BY dimension_value
    ORDER BY name`,
    params,
  );

  const map = new Map();
  for (const row of rows) {
    map.set(row.name, {
      newJoin: row.new_join || 0,
      rejoin: row.rejoin || 0,
      reinstate: row.reinstate || 0,
      resigned: row.resigned || 0,
      cancelled: row.cancelled || 0,
    });
  }
  return map;
}

function buildBreakdownRows(openingMap, movementMap, closingMap) {
  const names = new Set([
    ...openingMap.keys(),
    ...movementMap.keys(),
    ...closingMap.keys(),
  ]);

  const rows = [...names].map((name) => {
    const openingActive = openingMap.get(name) || 0;
    const mov = movementMap.get(name) || {
      newJoin: 0,
      rejoin: 0,
      reinstate: 0,
      resigned: 0,
      cancelled: 0,
    };
    const joined = mov.newJoin + mov.rejoin;
    const reinstatements = mov.reinstate;
    const resigned = mov.resigned;
    const lapsed = mov.cancelled;
    const leavers = resigned + lapsed;
    const calculatedClosing =
      openingActive + joined + reinstatements - leavers;
    const closingActive = closingMap.get(name) || 0;
    const variance = closingActive - calculatedClosing;

    return {
      name,
      openingActive,
      newJoin: mov.newJoin,
      rejoin: mov.rejoin,
      joined,
      reinstatements,
      resigned,
      lapsed,
      leavers,
      closingActive,
      calculatedClosing,
      variance,
      balances: Math.abs(variance) <= 0,
    };
  });

  rows.sort((a, b) => b.closingActive - a.closingActive || a.name.localeCompare(b.name));
  return rows;
}

async function getStatisticsBreakdown(
  tenantId,
  axisKey,
  openingDate,
  closingDate,
  year,
  throughMonth,
  segmentOpts,
  dimensionOpts = {},
) {
  const axis = STATISTICS_BREAKDOWN_AXES[axisKey];
  if (!axis) throw new Error(`Unknown statistics axis: ${axisKey}`);

  const [openingMap, movementMap, closingMap] = await Promise.all([
    getActiveCountsByColumn(
      tenantId,
      openingDate,
      axis.column,
      segmentOpts,
      dimensionOpts,
    ),
    sumYtdMovementsByDimension(
      tenantId,
      year,
      throughMonth,
      axis.dimension,
      segmentOpts,
    ),
    getActiveCountsByColumn(
      tenantId,
      closingDate,
      axis.column,
      segmentOpts,
      dimensionOpts,
    ),
  ]);

  return {
    label: axis.label,
    dimension: axis.dimension,
    rows: buildBreakdownRows(openingMap, movementMap, closingMap),
  };
}

module.exports = {
  STATISTICS_BREAKDOWN_AXES,
  getStatisticsBreakdown,
  buildBreakdownRows,
};
