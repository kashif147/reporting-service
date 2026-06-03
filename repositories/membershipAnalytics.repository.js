const { pool } = require("../db/postgres");
const { appendSegmentFilter, segmentFilterSql } = require("../lib/memberSegment");
const {
  appendDimensionFilters,
  hasDimensionFilters,
} = require("../lib/membershipDimensionFilters");
const { monthRange, resolvePeriod } = require("../lib/reportingPeriods");
const { hasPeriodSnapshot } = require("./membershipSnapshot.repository");

const EMPTY_SNAPSHOT_KPI = {
  activeTotal: 0,
  paidActive: 0,
  studentActive: 0,
  honoraryActive: 0,
};

const DIMENSION_COLUMNS = {
  membershipCategory: "membership_category",
  grade: "grade",
  branch: "branch",
  region: "region",
  section: "section",
  workLocation: "work_location",
  paymentType: "payment_type",
};

async function ensureSnapshot(tenantId, asOfDate, buildFn) {
  const { rows } = await pool.query(
    `SELECT 1 FROM membership_period_snapshot
     WHERE tenant_id = $1 AND snapshot_date = $2::date LIMIT 1`,
    [tenantId, asOfDate]
  );
  if (!rows.length && buildFn) {
    await buildFn(tenantId, asOfDate);
  }
}

async function computeAndStoreMonthlyMetrics(tenantId, year, month) {
  const { start, end } = monthRange(year, month);
  const asOfDate = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  const monthStart = `${year}-${String(month).padStart(2, "0")}-01`;

  await pool.query(
    `DELETE FROM membership_dimension_monthly
     WHERE tenant_id = $1 AND period_year = $2 AND period_month = $3`,
    [tenantId, year, month]
  );

  for (const [dimension, col] of Object.entries(DIMENSION_COLUMNS)) {
    await pool.query(
      `      INSERT INTO membership_dimension_monthly (
        tenant_id, period_year, period_month, dimension, dimension_value,
        member_segment, active_count, cancelled_in_month, resigned_in_month,
        joiners_in_month, leavers_in_month,
        new_join_in_month, rejoin_in_month, reinstate_in_month
      )
      SELECT
        $1, $2, $3, $4,
        COALESCE(NULLIF(TRIM(${col}::text), ''), '(blank)'),
        member_segment,
        COUNT(*) FILTER (WHERE membership_status = 'Active'),
        COUNT(*) FILTER (
          WHERE cancelled_at >= $5::timestamptz AND cancelled_at < $6::timestamptz
        ),
        COUNT(*) FILTER (
          WHERE resigned_at >= $5::timestamptz AND resigned_at < $6::timestamptz
        ),
        COUNT(*) FILTER (
          WHERE membership_movement IN ('NewJoin', 'Rejoin', 'Reinstate')
            AND start_date >= $7::date AND start_date <= $8::date
        ),
        COUNT(*) FILTER (
          WHERE (cancelled_at >= $5::timestamptz AND cancelled_at < $6::timestamptz)
             OR (resigned_at >= $5::timestamptz AND resigned_at < $6::timestamptz)
        ),
        COUNT(*) FILTER (
          WHERE membership_movement = 'NewJoin'
            AND start_date >= $7::date AND start_date <= $8::date
        ),
        COUNT(*) FILTER (
          WHERE membership_movement = 'Rejoin'
            AND start_date >= $7::date AND start_date <= $8::date
        ),
        COUNT(*) FILTER (
          WHERE membership_movement = 'Reinstate'
            AND start_date >= $7::date AND start_date <= $8::date
        )
      FROM membership_period_snapshot
      WHERE tenant_id = $1 AND snapshot_date = $8::date
      GROUP BY member_segment, COALESCE(NULLIF(TRIM(${col}::text), ''), '(blank)')`,
      [tenantId, year, month, dimension, start, end, monthStart, asOfDate]
    );
  }

  const kpiRes = await pool.query(
    `SELECT
      COUNT(*) FILTER (WHERE membership_status = 'Active')::int AS active_total,
      COUNT(*) FILTER (WHERE membership_status = 'Active' AND member_segment = 'paid')::int AS paid_active,
      COUNT(*) FILTER (WHERE membership_status = 'Active' AND member_segment = 'student')::int AS student_active,
      COUNT(*) FILTER (WHERE membership_status = 'Active' AND member_segment = 'honorary')::int AS honorary_active,
      COUNT(*) FILTER (
        WHERE membership_movement IN ('NewJoin', 'Rejoin', 'Reinstate')
          AND start_date >= $3::date AND start_date <= $4::date
      )::int AS joiners,
      COUNT(*) FILTER (
        WHERE (cancelled_at >= $5::timestamptz AND cancelled_at < $6::timestamptz)
           OR (resigned_at >= $5::timestamptz AND resigned_at < $6::timestamptz)
      )::int AS leavers,
      COUNT(*) FILTER (
        WHERE cancelled_at >= $5::timestamptz AND cancelled_at < $6::timestamptz
      )::int AS cancelled_in_month,
      COUNT(*) FILTER (
        WHERE resigned_at >= $5::timestamptz AND resigned_at < $6::timestamptz
      )::int AS resigned_in_month,
      COUNT(*) FILTER (
        WHERE membership_movement = 'NewJoin'
          AND start_date >= $3::date AND start_date <= $4::date
      )::int AS new_join_in_month,
      COUNT(*) FILTER (
        WHERE membership_movement = 'Rejoin'
          AND start_date >= $3::date AND start_date <= $4::date
      )::int AS rejoin_in_month,
      COUNT(*) FILTER (
        WHERE membership_movement = 'Reinstate'
          AND start_date >= $3::date AND start_date <= $4::date
      )::int AS reinstate_in_month
    FROM membership_period_snapshot
    WHERE tenant_id = $1 AND snapshot_date = $2::date`,
    [tenantId, asOfDate, monthStart, asOfDate, start, end]
  );

  const k = kpiRes.rows[0] || {};
  const joiners = k.joiners || 0;
  const leavers = k.leavers || 0;

  await pool.query(
    `INSERT INTO membership_kpi_monthly (
      tenant_id, period_year, period_month,
      active_total, joiners, leavers, net_growth,
      paid_active, student_active, honorary_active,
      cancelled_in_month, resigned_in_month,
      new_join_in_month, rejoin_in_month, reinstate_in_month,
      computed_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,NOW())
    ON CONFLICT (tenant_id, period_year, period_month) DO UPDATE SET
      active_total = EXCLUDED.active_total,
      joiners = EXCLUDED.joiners,
      leavers = EXCLUDED.leavers,
      net_growth = EXCLUDED.net_growth,
      paid_active = EXCLUDED.paid_active,
      student_active = EXCLUDED.student_active,
      honorary_active = EXCLUDED.honorary_active,
      cancelled_in_month = EXCLUDED.cancelled_in_month,
      resigned_in_month = EXCLUDED.resigned_in_month,
      new_join_in_month = EXCLUDED.new_join_in_month,
      rejoin_in_month = EXCLUDED.rejoin_in_month,
      reinstate_in_month = EXCLUDED.reinstate_in_month,
      computed_at = NOW()`,
    [
      tenantId,
      year,
      month,
      k.active_total || 0,
      joiners,
      leavers,
      joiners - leavers,
      k.paid_active || 0,
      k.student_active || 0,
      k.honorary_active || 0,
      k.cancelled_in_month || 0,
      k.resigned_in_month || 0,
      k.new_join_in_month || 0,
      k.rejoin_in_month || 0,
      k.reinstate_in_month || 0,
    ]
  );
}

async function getKpiForPeriod(tenantId, year, month, segmentOpts) {
  const seg = segmentFilterSql(segmentOpts, "member_segment", 4);
  const { rows } = await pool.query(
    `SELECT
      period_year AS "periodYear",
      period_month AS "periodMonth",
      SUM(active_total) FILTER (WHERE TRUE) AS "activeTotal",
      SUM(joiners) AS joiners,
      SUM(leavers) AS leavers,
      SUM(net_growth) AS "netGrowth",
      SUM(paid_active) AS "paidActive",
      SUM(student_active) AS "studentActive",
      SUM(honorary_active) AS "honoraryActive",
      SUM(cancelled_in_month) AS "cancelledInMonth",
      SUM(resigned_in_month) AS "resignedInMonth"
    FROM membership_kpi_monthly k
    WHERE k.tenant_id = $1 AND k.period_year = $2 AND k.period_month = $3`,
    [tenantId, year, month]
  );
  return rows[0] || null;
}

async function getKpiFromSnapshot(tenantId, asOfDate, segmentOpts, dimensionOpts = {}) {
  const where = ["tenant_id = $1", "snapshot_date = $2::date"];
  const params = [tenantId, asOfDate];
  appendSegmentFilter(where, params, segmentOpts);
  appendDimensionFilters(where, params, dimensionOpts);
  const { rows } = await pool.query(
    `SELECT
      COUNT(*) FILTER (WHERE membership_status = 'Active')::int AS "activeTotal",
      COUNT(*) FILTER (WHERE membership_status = 'Active' AND member_segment = 'paid')::int AS "paidActive",
      COUNT(*) FILTER (WHERE membership_status = 'Active' AND member_segment = 'student')::int AS "studentActive",
      COUNT(*) FILTER (WHERE membership_status = 'Active' AND member_segment = 'honorary')::int AS "honoraryActive"
    FROM membership_period_snapshot
    WHERE ${where.join(" AND ")}`,
    params
  );
  return rows[0];
}

async function getSnapshotKpiIfExists(tenantId, asOfDate, segmentOpts, dimensionOpts = {}) {
  if (!(await hasPeriodSnapshot(tenantId, asOfDate))) {
    return { ...EMPTY_SNAPSHOT_KPI };
  }
  return getKpiFromSnapshot(tenantId, asOfDate, segmentOpts, dimensionOpts);
}

async function getMonthMovementKpiFromSnapshot(
  tenantId,
  asOfDate,
  year,
  month,
  segmentOpts,
  dimensionOpts = {}
) {
  const { start, end } = monthRange(year, month);
  const monthStart = `${year}-${String(month).padStart(2, "0")}-01`;
  const where = ["tenant_id = $1", "snapshot_date = $2::date"];
  const params = [tenantId, asOfDate];
  appendSegmentFilter(where, params, segmentOpts);
  appendDimensionFilters(where, params, dimensionOpts);
  const pMonthStart = params.length + 1;
  params.push(monthStart);
  const pAsOf = params.length + 1;
  params.push(asOfDate);
  const pRangeStart = params.length + 1;
  params.push(start);
  const pRangeEnd = params.length + 1;
  params.push(end);

  const { rows } = await pool.query(
    `SELECT
      COUNT(*) FILTER (
        WHERE membership_movement IN ('NewJoin', 'Rejoin', 'Reinstate')
          AND start_date >= $${pMonthStart}::date AND start_date <= $${pAsOf}::date
      )::int AS joiners,
      COUNT(*) FILTER (
        WHERE (cancelled_at >= $${pRangeStart}::timestamptz AND cancelled_at < $${pRangeEnd}::timestamptz)
           OR (resigned_at >= $${pRangeStart}::timestamptz AND resigned_at < $${pRangeEnd}::timestamptz)
      )::int AS leavers
    FROM membership_period_snapshot
    WHERE ${where.join(" AND ")}`,
    params
  );
  const r = rows[0] || {};
  const joiners = r.joiners || 0;
  const leavers = r.leavers || 0;
  return {
    joiners,
    leavers,
    net_growth: joiners - leavers,
  };
}

async function sumYtdMovementFromMonthlyAggregates(
  tenantId,
  year,
  throughMonth,
  segmentOpts
) {
  const where = [
    "tenant_id = $1",
    "period_year = $2",
    "period_month <= $3",
    "dimension = 'membershipCategory'",
  ];
  const params = [tenantId, year, throughMonth];
  appendSegmentFilter(where, params, segmentOpts);
  const { rows } = await pool.query(
    `SELECT
      COALESCE(SUM(new_join_in_month), 0)::int AS new_join,
      COALESCE(SUM(rejoin_in_month), 0)::int AS rejoin,
      COALESCE(SUM(reinstate_in_month), 0)::int AS reinstate,
      COALESCE(SUM(cancelled_in_month), 0)::int AS cancelled,
      COALESCE(SUM(resigned_in_month), 0)::int AS resigned,
      COALESCE(SUM(leavers_in_month), 0)::int AS leavers
    FROM membership_dimension_monthly
    WHERE ${where.join(" AND ")}`,
    params
  );
  const r = rows[0] || {};
  const joiners =
    (r.new_join || 0) + (r.rejoin || 0) + (r.reinstate || 0);
  const leavers = r.leavers || (r.cancelled || 0) + (r.resigned || 0);
  return {
    joiners,
    leavers,
    net_growth: joiners - leavers,
  };
}

async function sumYtdMovementFromSnapshots(
  tenantId,
  year,
  throughMonth,
  segmentOpts,
  dimensionOpts = {}
) {
  let joiners = 0;
  let leavers = 0;
  for (let month = 1; month <= throughMonth; month += 1) {
    const resolved = resolvePeriod({ type: "month_end", year, month });
    const mov = await getMonthMovementKpiFromSnapshot(
      tenantId,
      resolved.asOfDate,
      year,
      month,
      segmentOpts,
      dimensionOpts
    );
    joiners += mov.joiners || 0;
    leavers += mov.leavers || 0;
  }
  return {
    joiners,
    leavers,
    net_growth: joiners - leavers,
  };
}

async function sumYtdMovement(
  tenantId,
  year,
  throughMonth,
  segmentOpts,
  dimensionOpts = {}
) {
  if (hasDimensionFilters(dimensionOpts)) {
    return sumYtdMovementFromSnapshots(
      tenantId,
      year,
      throughMonth,
      segmentOpts,
      dimensionOpts
    );
  }
  return sumYtdMovementFromMonthlyAggregates(
    tenantId,
    year,
    throughMonth,
    segmentOpts
  );
}

async function hasMonthlyKpiRow(tenantId, year, month) {
  const { rows } = await pool.query(
    `SELECT 1 FROM membership_kpi_monthly
     WHERE tenant_id = $1 AND period_year = $2 AND period_month = $3`,
    [tenantId, year, month]
  );
  return rows.length > 0;
}

/** True when KPI row is missing or movement split columns were not backfilled. */
async function monthlyMetricsNeedRecompute(tenantId, year, month) {
  const { rows } = await pool.query(
    `SELECT joiners, new_join_in_month, rejoin_in_month, reinstate_in_month
     FROM membership_kpi_monthly
     WHERE tenant_id = $1 AND period_year = $2 AND period_month = $3`,
    [tenantId, year, month]
  );
  if (!rows.length) return true;
  const r = rows[0];
  const split =
    (Number(r.new_join_in_month) || 0) +
    (Number(r.rejoin_in_month) || 0) +
    (Number(r.reinstate_in_month) || 0);
  const joiners = Number(r.joiners) || 0;
  return joiners > 0 && split === 0;
}

async function getMonthlyHeadlineKpi(tenantId, year, month) {
  const { rows } = await pool.query(
    `SELECT active_total, joiners, leavers, net_growth
     FROM membership_kpi_monthly
     WHERE tenant_id = $1 AND period_year = $2 AND period_month = $3`,
    [tenantId, year, month]
  );
  return rows[0] || null;
}

async function getDimensionBreakdownFromSnapshot(
  tenantId,
  asOfDate,
  dimension,
  segmentOpts,
  dimensionOpts = {}
) {
  const col = DIMENSION_COLUMNS[dimension];
  if (!col) throw new Error(`Unknown dimension: ${dimension}`);
  const where = ["tenant_id = $1", "snapshot_date = $2::date"];
  const params = [tenantId, asOfDate];
  appendSegmentFilter(where, params, segmentOpts);
  appendDimensionFilters(where, params, dimensionOpts);
  const { rows } = await pool.query(
    `SELECT
      COALESCE(NULLIF(TRIM(${col}::text), ''), '(blank)') AS name,
      COUNT(*) FILTER (WHERE membership_status = 'Active')::int AS count
    FROM membership_period_snapshot
    WHERE ${where.join(" AND ")}
    GROUP BY 1
    ORDER BY count DESC, name`,
    params
  );
  return rows;
}

async function getLiveStatsMonthly(tenantId, filters) {
  const {
    years = [],
    months = [],
    dimensions = ["membershipCategory"],
    includeStudents = false,
    includeHonorary = false,
  } = filters;

  const seg = segmentFilterSql(
    { includeStudents, includeHonorary },
    "member_segment",
    2
  );
  const params = [tenantId, ...seg.params];
  const where = [`tenant_id = $1`, seg.sql];
  let idx = params.length + 1;

  if (years.length) {
    where.push(`period_year = ANY($${idx++})`);
    params.push(years);
  }
  if (months.length) {
    where.push(`period_month = ANY($${idx++})`);
    params.push(months);
  }
  if (dimensions.length) {
    where.push(`dimension = ANY($${idx++})`);
    params.push(dimensions);
  }

  const { rows } = await pool.query(
    `SELECT
      period_year AS "periodYear",
      period_month AS "periodMonth",
      dimension,
      dimension_value AS "dimensionValue",
      member_segment AS "memberSegment",
      active_count AS "activeCount",
      cancelled_in_month AS "cancelledInMonth",
      resigned_in_month AS "resignedInMonth",
      joiners_in_month AS "joinersInMonth",
      leavers_in_month AS "leaversInMonth"
    FROM membership_dimension_monthly
    WHERE ${where.join(" AND ")}
    ORDER BY period_year, period_month, dimension, dimension_value`,
    params
  );
  return rows;
}

async function getComparisonPeriodKpis(
  tenantId,
  resolved,
  segmentOpts,
  dimensionOpts = {}
) {
  const snap = await getSnapshotKpiIfExists(
    tenantId,
    resolved.asOfDate,
    segmentOpts,
    dimensionOpts
  );
  let joiners;
  let leavers;
  let netGrowth;
  if (hasDimensionFilters(dimensionOpts)) {
    const mov = await getMonthMovementKpiFromSnapshot(
      tenantId,
      resolved.asOfDate,
      resolved.year,
      resolved.month,
      segmentOpts,
      dimensionOpts
    );
    joiners = mov.joiners;
    leavers = mov.leavers;
    netGrowth = mov.net_growth;
  } else {
    const monthly = await getMonthlyHeadlineKpi(
      tenantId,
      resolved.year,
      resolved.month
    );
    joiners = Number(monthly?.joiners) || 0;
    leavers = Number(monthly?.leavers) || 0;
    netGrowth =
      monthly?.net_growth != null
        ? Number(monthly.net_growth)
        : joiners - leavers;
  }
  return {
    activeTotal: snap?.activeTotal ?? 0,
    paidActive: snap?.paidActive ?? 0,
    studentActive: snap?.studentActive ?? 0,
    honoraryActive: snap?.honoraryActive ?? 0,
    joiners,
    leavers,
    netGrowth,
  };
}

async function getComparisonKpis(tenantId, asOfDateA, asOfDateB, segmentOpts) {
  const [a, b] = await Promise.all([
    getSnapshotKpiIfExists(tenantId, asOfDateA, segmentOpts),
    getSnapshotKpiIfExists(tenantId, asOfDateB, segmentOpts),
  ]);
  return { periodA: a, periodB: b };
}

async function getComparisonByDimension(
  tenantId,
  asOfDateA,
  asOfDateB,
  dimension,
  segmentOpts,
  dimensionOpts = {}
) {
  const [rowsA, rowsB] = await Promise.all([
    getDimensionBreakdownFromSnapshot(
      tenantId,
      asOfDateA,
      dimension,
      segmentOpts,
      dimensionOpts
    ),
    getDimensionBreakdownFromSnapshot(
      tenantId,
      asOfDateB,
      dimension,
      segmentOpts,
      dimensionOpts
    ),
  ]);
  const mapA = new Map(
    rowsA.map((r) => [r.name, Number(r.count) || 0])
  );
  const mapB = new Map(
    rowsB.map((r) => [r.name, Number(r.count) || 0])
  );
  const names = new Set([...mapA.keys(), ...mapB.keys()]);
  return [...names]
    .map((name) => {
      const periodA = mapA.get(name) ?? 0;
      const periodB = mapB.get(name) ?? 0;
      return { name, periodA, periodB, change: periodB - periodA };
    })
    .sort(
      (a, b) =>
        Math.abs(b.change) - Math.abs(a.change) ||
        b.periodB - a.periodB ||
        a.name.localeCompare(b.name)
    );
}

module.exports = {
  ensureSnapshot,
  computeAndStoreMonthlyMetrics,
  getKpiForPeriod,
  getKpiFromSnapshot,
  getSnapshotKpiIfExists,
  getMonthlyHeadlineKpi,
  sumYtdMovement,
  hasMonthlyKpiRow,
  monthlyMetricsNeedRecompute,
  getComparisonPeriodKpis,
  getMonthMovementKpiFromSnapshot,
  getDimensionBreakdownFromSnapshot,
  getLiveStatsMonthly,
  getComparisonKpis,
  getComparisonByDimension,
  DIMENSION_COLUMNS,
  EMPTY_SNAPSHOT_KPI,
};
