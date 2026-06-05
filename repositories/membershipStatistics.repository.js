const { pool } = require("../db/postgres");
const { appendSegmentFilter } = require("../lib/memberSegment");
const { appendDimensionFilters } = require("../lib/membershipDimensionFilters");
const {
  sumYtdMovementsByDimension,
} = require("./membershipMovementAnalytics.repository");

/** Breakdown axes for Statistics report (stored in membership_dimension_monthly.dimension). */
const STATISTICS_BREAKDOWN_AXES = {
  membershipCategory: {
    dimension: "membershipCategory",
    column: "membership_category",
    label: "Membership category",
  },
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

async function getStatusCountsByColumn(
  tenantId,
  asOfDate,
  column,
  status,
  segmentOpts,
  dimensionOpts = {},
) {
  const where = [
    "tenant_id = $1",
    "snapshot_date = $2::date",
    `membership_status = $3`,
  ];
  const params = [tenantId, asOfDate, status];
  appendSegmentFilter(where, params, segmentOpts);
  appendDimensionFilters(where, params, dimensionOpts);

  const { rows } = await pool.query(
    `SELECT
      COALESCE(NULLIF(TRIM(${column}::text), ''), '(blank)') AS name,
      COUNT(*)::int AS cnt
    FROM membership_period_snapshot
    WHERE ${where.join(" AND ")}
    GROUP BY 1`,
    params,
  );

  const map = new Map();
  for (const row of rows) {
    map.set(row.name, Number(row.cnt) || 0);
  }
  return map;
}

async function sumYtdReinstateSplitByColumn(
  tenantId,
  year,
  closingDate,
  column,
  segmentOpts,
  dimensionOpts = {},
) {
  const yearStart = `${year}-01-01`;
  const where = [
    "tenant_id = $1",
    "membership_movement = 'Reinstate'",
    "start_date IS NOT NULL",
  ];
  const params = [tenantId];
  appendSegmentFilter(where, params, segmentOpts);
  appendDimensionFilters(where, params, dimensionOpts);

  const pYearStart = params.length + 1;
  params.push(yearStart);
  const pClosing = params.length + 1;
  params.push(closingDate);

  const { rows } = await pool.query(
    `WITH candidates AS (
      SELECT DISTINCT ON (subscription_id)
        subscription_id,
        tenant_id,
        COALESCE(NULLIF(TRIM(${column}::text), ''), '(blank)') AS name,
        start_date
      FROM membership_period_snapshot
      WHERE ${where.join(" AND ")}
        AND start_date >= $${pYearStart}::date
        AND start_date <= $${pClosing}::date
      ORDER BY subscription_id, snapshot_date DESC
    ),
    with_prior AS (
      SELECT
        c.name,
        UPPER(COALESCE(prev.membership_status, '')) AS prior_status
      FROM candidates c
      LEFT JOIN LATERAL (
        SELECT membership_status
        FROM membership_period_snapshot p
        WHERE p.tenant_id = c.tenant_id
          AND p.subscription_id = c.subscription_id
          AND p.snapshot_date < c.start_date
        ORDER BY p.snapshot_date DESC
        LIMIT 1
      ) prev ON true
    )
    SELECT
      name,
      COUNT(*) FILTER (WHERE prior_status = 'SUSPENDED')::int AS from_suspended,
      COUNT(*) FILTER (WHERE prior_status = 'ARCHIVED')::int AS from_archived
    FROM with_prior
    GROUP BY name`,
    params,
  );

  const map = new Map();
  for (const row of rows) {
    map.set(row.name, {
      fromSuspended: row.from_suspended || 0,
      fromArchived: row.from_archived || 0,
    });
  }
  return map;
}

async function getWorkLocationHierarchyMeta(
  tenantId,
  asOfDate,
  segmentOpts,
  dimensionOpts = {},
) {
  const where = ["tenant_id = $1", "snapshot_date = $2::date"];
  const params = [tenantId, asOfDate];
  appendSegmentFilter(where, params, segmentOpts);
  appendDimensionFilters(where, params, dimensionOpts);

  const { rows } = await pool.query(
    `SELECT DISTINCT
      COALESCE(NULLIF(TRIM(region::text), ''), '(blank)') AS region,
      COALESCE(NULLIF(TRIM(branch::text), ''), '(blank)') AS branch,
      COALESCE(NULLIF(TRIM(work_location::text), ''), '(blank)') AS work_location
    FROM membership_period_snapshot
    WHERE ${where.join(" AND ")}
    ORDER BY region, branch, work_location`,
    params,
  );
  return rows;
}

function sumMovementFields(mov = {}) {
  const newJoin = mov.newJoin || 0;
  const rejoin = mov.rejoin || 0;
  const reinstateFromSuspended = mov.reinstateFromSuspended || mov.reinstatedFromSuspended || 0;
  const reinstateFromArchived = mov.reinstateFromArchived || mov.reinstatedFromArchived || 0;
  const reinstate =
    mov.reinstate ||
    reinstateFromSuspended + reinstateFromArchived;
  const resigned = mov.resigned || 0;
  const cancelled = mov.cancelled || 0;
  const joined = newJoin + rejoin;
  const leavers = resigned + cancelled;
  const newTotal = joined + reinstate;
  const joiners = newTotal;
  return {
    newJoin,
    rejoin,
    joined,
    reinstate,
    reinstateFromSuspended,
    reinstateFromArchived,
    reinstatedFromSuspended: reinstateFromSuspended,
    reinstatedFromArchived: reinstateFromArchived,
    resigned,
    cancelled,
    leavers,
    newTotal,
    joiners,
    leaversTotal: leavers,
  };
}

function addMovementTotals(target, source) {
  const keys = [
    "newJoin",
    "rejoin",
    "joined",
    "reinstate",
    "reinstateFromSuspended",
    "reinstateFromArchived",
    "resigned",
    "cancelled",
    "leavers",
    "newTotal",
    "joiners",
    "leaversTotal",
  ];
  for (const key of keys) {
    target[key] = (target[key] || 0) + (source[key] || 0);
  }
}

function buildLocationHierarchyGroups(metaRows, movementMap) {
  const regionMap = new Map();

  for (const meta of metaRows) {
    const workLocation = meta.work_location;
    const mov = sumMovementFields(movementMap.get(workLocation));
    if (
      mov.newTotal === 0 &&
      mov.leaversTotal === 0 &&
      !movementMap.has(workLocation)
    ) {
      continue;
    }

    const regionKey = meta.region;
    const branchKey = meta.branch;
    if (!regionMap.has(regionKey)) {
      regionMap.set(regionKey, { region: regionKey, branches: new Map(), totals: {} });
    }
    const regionGroup = regionMap.get(regionKey);
    if (!regionGroup.branches.has(branchKey)) {
      regionGroup.branches.set(branchKey, {
        branch: branchKey,
        rows: [],
        totals: {},
      });
    }
    const branchGroup = regionGroup.branches.get(branchKey);
    branchGroup.rows.push({
      name: workLocation,
      region: regionKey,
      branch: branchKey,
      ...mov,
    });
    addMovementTotals(branchGroup.totals, mov);
    addMovementTotals(regionGroup.totals, mov);
  }

  const groups = [...regionMap.values()]
    .map((regionGroup) => ({
      region: regionGroup.region,
      label: regionGroup.region,
      branches: [...regionGroup.branches.values()]
        .map((branchGroup) => ({
          ...branchGroup,
          rows: branchGroup.rows.sort((a, b) =>
            a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
          ),
        }))
        .sort((a, b) =>
          a.branch.localeCompare(b.branch, undefined, { sensitivity: "base" }),
        ),
      totals: regionGroup.totals,
    }))
    .sort((a, b) =>
      a.region.localeCompare(b.region, undefined, { sensitivity: "base" }),
    );

  const grandTotal = {};
  for (const group of groups) {
    addMovementTotals(grandTotal, group.totals);
  }

  return { groups, grandTotal };
}

async function getLocationHierarchyBreakdown(
  tenantId,
  closingDate,
  year,
  throughMonth,
  segmentOpts,
  dimensionOpts = {},
) {
  const [metaRows, movementMap, reinstateSplitMap] = await Promise.all([
    getWorkLocationHierarchyMeta(
      tenantId,
      closingDate,
      segmentOpts,
      dimensionOpts,
    ),
    sumYtdMovementsByDimension(
      tenantId,
      year,
      throughMonth,
      "workLocation",
      segmentOpts,
      dimensionOpts,
    ),
    sumYtdReinstateSplitByColumn(
      tenantId,
      year,
      closingDate,
      "work_location",
      segmentOpts,
      dimensionOpts,
    ),
  ]);

  for (const [name, mov] of movementMap.entries()) {
    const split = reinstateSplitMap.get(name) || {};
    mov.reinstatedFromSuspended = split.fromSuspended || 0;
    mov.reinstatedFromArchived = split.fromArchived || 0;
  }

  const { groups, grandTotal } = buildLocationHierarchyGroups(
    metaRows,
    movementMap,
  );

  return {
    label: "Region / branch / work location",
    groups,
    grandTotal,
  };
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
    const cancelled = mov.cancelled;
    const leavers = resigned + cancelled;
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
      reinstatedFromSuspended: 0,
      reinstatedFromArchived: 0,
      joiners: joined + reinstatements,
      resigned,
      cancelled,
      lapsed: cancelled,
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

  const [
    openingMap,
    movementMap,
    closingMap,
    suspendedMap,
    archivedMap,
    reinstateSplitMap,
  ] = await Promise.all([
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
      dimensionOpts,
    ),
    getActiveCountsByColumn(
      tenantId,
      closingDate,
      axis.column,
      segmentOpts,
      dimensionOpts,
    ),
    getStatusCountsByColumn(
      tenantId,
      closingDate,
      axis.column,
      "Suspended",
      segmentOpts,
      dimensionOpts,
    ),
    getStatusCountsByColumn(
      tenantId,
      closingDate,
      axis.column,
      "Archived",
      segmentOpts,
      dimensionOpts,
    ),
    sumYtdReinstateSplitByColumn(
      tenantId,
      year,
      closingDate,
      axis.column,
      segmentOpts,
      dimensionOpts,
    ),
  ]);

  const rows = buildBreakdownRows(openingMap, movementMap, closingMap).map(
    (row) => {
      const split = reinstateSplitMap.get(row.name) || {};
      const fromSuspended = split.fromSuspended || 0;
      const fromArchived = split.fromArchived || 0;
      const trackedReinstate = fromSuspended + fromArchived;
      const reinstatements =
        trackedReinstate > 0 ? trackedReinstate : row.reinstatements;
      const joined = row.joined ?? row.newJoin + row.rejoin;

      return {
        ...row,
        reinstatements,
        reinstatedFromSuspended: fromSuspended,
        reinstatedFromArchived: fromArchived,
        joiners: joined + reinstatements,
        suspended: suspendedMap.get(row.name) || 0,
        archived: archivedMap.get(row.name) || 0,
      };
    },
  );

  return {
    label: axis.label,
    dimension: axis.dimension,
    rows,
  };
}

module.exports = {
  STATISTICS_BREAKDOWN_AXES,
  getStatisticsBreakdown,
  getLocationHierarchyBreakdown,
  buildBreakdownRows,
  buildLocationHierarchyGroups,
};
