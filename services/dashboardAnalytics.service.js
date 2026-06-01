const { pool } = require("../db/postgres");
const {
  resolvePeriod,
  currentMonthPeriod,
  previousMonthPeriod,
  yearToDateEnd,
  lastYearToDateEnd,
  monthRange,
} = require("../lib/reportingPeriods");
const { appendSegmentFilter } = require("../lib/memberSegment");
const {
  normalizeMembershipDimensionFilters,
  hasDimensionFilters,
  appendDimensionFilters,
} = require("../lib/membershipDimensionFilters");
const { ensurePeriodSnapshot } = require("./snapshotBuild.service");
const { hasPeriodSnapshot } = require("../repositories/membershipSnapshot.repository");
const {
  getDimensionBreakdownFromSnapshot,
  getKpiFromSnapshot,
  getSnapshotKpiIfExists,
  getMonthMovementKpiFromSnapshot,
} = require("../repositories/membershipAnalytics.repository");

function compareKpi(current, prior) {
  const n = (v) => Number(v) || 0;
  const c = n(current);
  const p = n(prior);
  return {
    current: c,
    prior: p,
    change: c - p,
    changePct: p === 0 ? (c === 0 ? 0 : 100) : Math.round(((c - p) / p) * 1000) / 10,
  };
}

function isCurrentCalendarMonth(year, month) {
  const now = new Date();
  return year === now.getUTCFullYear() && month === now.getUTCMonth() + 1;
}

function resolveDashboardPeriods(filters = {}) {
  const year = Number(filters.year);
  const month = Number(filters.month);
  if (year >= 2000 && month >= 1 && month <= 12) {
    const ref = new Date(Date.UTC(year, month - 1, 15));
    const cur = resolvePeriod({ type: "month_end", year, month });
    const prev = previousMonthPeriod(ref);
    const ytd = resolvePeriod({ type: "custom", date: cur.asOfDate });
    const lytd = lastYearToDateEnd(new Date(cur.asOfDate));
    return {
      cur,
      prev,
      ytd,
      lytd,
      isCurrentMonth: isCurrentCalendarMonth(year, month),
    };
  }

  const cur = currentMonthPeriod();
  return {
    cur,
    prev: previousMonthPeriod(),
    ytd: yearToDateEnd(),
    lytd: lastYearToDateEnd(),
    isCurrentMonth: true,
  };
}

async function countMtdFromListing(
  tenantId,
  segmentOpts,
  year,
  month,
  dimensionOpts = {}
) {
  const y = year ?? new Date().getUTCFullYear();
  const m = month ?? new Date().getUTCMonth() + 1;
  const { start, end } = monthRange(y, m);
  const monthStart = `${y}-${String(m).padStart(2, "0")}-01`;
  const today = new Date().toISOString().slice(0, 10);
  const asOfDay =
    isCurrentCalendarMonth(y, m) ? today : `${y}-${String(m).padStart(2, "0")}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;

  const where = ["tenant_id = $1"];
  const params = [tenantId];
  appendSegmentFilter(where, params, segmentOpts);
  appendDimensionFilters(where, params, dimensionOpts);
  const pMonthStart = params.length + 1;
  params.push(monthStart);
  const pToday = params.length + 1;
  params.push(asOfDay);
  const pRangeStart = params.length + 1;
  params.push(start);
  const pRangeEnd = params.length + 1;
  params.push(end);

  const { rows } = await pool.query(
    `SELECT
      COUNT(*) FILTER (WHERE membership_status = 'Active')::int AS "activeTotal",
      COUNT(*) FILTER (WHERE membership_status = 'Active' AND member_segment = 'paid')::int AS "paidActive",
      COUNT(*) FILTER (WHERE membership_status = 'Active' AND member_segment = 'student')::int AS "studentActive",
      COUNT(*) FILTER (WHERE membership_status = 'Active' AND member_segment = 'honorary')::int AS "honoraryActive",
      COUNT(*) FILTER (
        WHERE membership_movement IN ('NewJoin', 'Rejoin', 'Reinstate')
          AND start_date >= $${pMonthStart}::date AND start_date <= $${pToday}::date
      )::int AS joiners,
      COUNT(*) FILTER (
        WHERE (cancelled_at >= $${pRangeStart}::timestamptz AND cancelled_at < $${pRangeEnd}::timestamptz)
           OR (resigned_at >= $${pRangeStart}::timestamptz AND resigned_at < $${pRangeEnd}::timestamptz)
      )::int AS leavers
    FROM membership_listing
    WHERE ${where.join(" AND ")}`,
    params
  );
  const r = rows[0] || {};
  return {
    activeTotal: r.activeTotal || 0,
    paidActive: r.paidActive || 0,
    studentActive: r.studentActive || 0,
    honoraryActive: r.honoraryActive || 0,
    joiners: r.joiners || 0,
    leavers: r.leavers || 0,
    netGrowth: (r.joiners || 0) - (r.leavers || 0),
  };
}

async function getMonthlyKpiRow(tenantId, year, month) {
  try {
    const { rows } = await pool.query(
      `SELECT joiners, leavers, net_growth FROM membership_kpi_monthly
       WHERE tenant_id = $1 AND period_year = $2 AND period_month = $3`,
      [tenantId, year, month]
    );
    return rows[0] || {};
  } catch {
    return {};
  }
}

async function getUnifiedDashboard(tenantId, filters = {}) {
  const segmentOpts = {
    includeStudents: filters.includeStudents === true,
    includeHonorary: filters.includeHonorary === true,
  };
  const dimensionOpts = normalizeMembershipDimensionFilters(filters);
  const useDimensionFilters = hasDimensionFilters(dimensionOpts);

  const { cur, prev, ytd, lytd, isCurrentMonth } = resolveDashboardPeriods(filters);

  const [hasPriorMonthSnapshot, hasPriorYearSnapshot] = await Promise.all([
    hasPeriodSnapshot(tenantId, prev.asOfDate),
    hasPeriodSnapshot(tenantId, lytd.asOfDate),
  ]);

  await Promise.all([
    ensurePeriodSnapshot(tenantId, cur.asOfDate),
    ensurePeriodSnapshot(tenantId, ytd.asOfDate),
  ]);

  const [liveKpi, snapCur, snapPrev, snapYtd, snapLytd] = await Promise.all([
    countMtdFromListing(
      tenantId,
      segmentOpts,
      cur.year,
      cur.month,
      dimensionOpts
    ),
    getKpiFromSnapshot(tenantId, cur.asOfDate, segmentOpts, dimensionOpts),
    getSnapshotKpiIfExists(tenantId, prev.asOfDate, segmentOpts, dimensionOpts),
    getKpiFromSnapshot(tenantId, ytd.asOfDate, segmentOpts, dimensionOpts),
    getSnapshotKpiIfExists(tenantId, lytd.asOfDate, segmentOpts, dimensionOpts),
  ]);

  const prevMonthKpi = useDimensionFilters
    ? await getMonthMovementKpiFromSnapshot(
        tenantId,
        prev.asOfDate,
        prev.year,
        prev.month,
        segmentOpts,
        dimensionOpts
      )
    : await getMonthlyKpiRow(tenantId, prev.year, prev.month);
  const selectedMonthKpi =
    isCurrentMonth || useDimensionFilters
      ? useDimensionFilters && !isCurrentMonth
        ? await getMonthMovementKpiFromSnapshot(
            tenantId,
            cur.asOfDate,
            cur.year,
            cur.month,
            segmentOpts,
            dimensionOpts
          )
        : {}
      : await getMonthlyKpiRow(tenantId, cur.year, cur.month);

  const periodKpi = isCurrentMonth
    ? liveKpi
    : {
        activeTotal: snapCur?.activeTotal ?? 0,
        paidActive: snapCur?.paidActive ?? 0,
        studentActive: snapCur?.studentActive ?? 0,
        honoraryActive: snapCur?.honoraryActive ?? 0,
        joiners: Number(selectedMonthKpi.joiners) || 0,
        leavers: Number(selectedMonthKpi.leavers) || 0,
        netGrowth: Number(selectedMonthKpi.net_growth) || 0,
      };

  const kpis = {
    totalActiveMembers: compareKpi(periodKpi.activeTotal, snapPrev?.activeTotal),
    newJoiners: compareKpi(
      periodKpi.joiners,
      Number(prevMonthKpi.joiners) || 0
    ),
    leavers: compareKpi(
      periodKpi.leavers,
      Number(prevMonthKpi.leavers) || 0
    ),
    netGrowth: compareKpi(
      periodKpi.netGrowth,
      Number(prevMonthKpi.net_growth) || 0
    ),
    paidMembers: compareKpi(periodKpi.paidActive, snapPrev?.paidActive),
    studentMembers: compareKpi(periodKpi.studentActive, snapPrev?.studentActive),
    honoraryMembers: compareKpi(periodKpi.honoraryActive, snapPrev?.honoraryActive),
    ytdActive: compareKpi(snapYtd?.activeTotal, snapLytd?.activeTotal),
    thisMonthVsLastMonth: {
      active: compareKpi(snapCur?.activeTotal, snapPrev?.activeTotal),
      joiners: compareKpi(periodKpi.joiners, Number(prevMonthKpi.joiners) || 0),
      leavers: compareKpi(periodKpi.leavers, Number(prevMonthKpi.leavers) || 0),
      netGrowth: compareKpi(
        periodKpi.netGrowth,
        Number(prevMonthKpi.net_growth) || 0
      ),
    },
  };

  const chartDimensions = [
    "membershipCategory",
    "grade",
    "section",
    "workLocation",
    "branch",
    "region",
  ];
  const distributions = {};
  await Promise.all(
    chartDimensions.map(async (dim) => {
      distributions[dim] = await getDimensionBreakdownFromSnapshot(
        tenantId,
        cur.asOfDate,
        dim,
        segmentOpts,
        dimensionOpts
      );
    })
  );

  const dashboardFilters = mapDashboardFilters(filters);

  return {
    kpis,
    distributions,
    asOfDate: cur.asOfDate,
    periodYear: cur.year,
    periodMonth: cur.month,
    filtersApplied: dashboardFilters,
    hasPriorMonthSnapshot,
    hasPriorYearSnapshot,
  };
}

function mapDashboardFilters(filters) {
  const out = {
    includeStudents: filters.includeStudents === true,
    includeHonorary: filters.includeHonorary === true,
  };
  if (filters.year) out.year = Number(filters.year);
  if (filters.month) out.month = Number(filters.month);
  Object.assign(out, normalizeMembershipDimensionFilters(filters));
  return out;
}

module.exports = { getUnifiedDashboard, compareKpi };
