const { pool } = require("../db/postgres");
const {
  currentMonthPeriod,
  previousMonthPeriod,
  yearToDateEnd,
  lastYearToDateEnd,
  monthRange,
} = require("../lib/reportingPeriods");
const { segmentFilterSql } = require("../lib/memberSegment");
const { ensurePeriodSnapshot } = require("./snapshotBuild.service");
const {
  getDimensionBreakdownFromSnapshot,
  getKpiFromSnapshot,
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

async function countMtdFromListing(tenantId, segmentOpts) {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth() + 1;
  const { start, end } = monthRange(y, m);
  const seg = segmentFilterSql(segmentOpts, "member_segment", 2);
  const monthStart = `${y}-${String(m).padStart(2, "0")}-01`;
  const today = now.toISOString().slice(0, 10);

  const { rows } = await pool.query(
    `SELECT
      COUNT(*) FILTER (WHERE membership_status = 'Active')::int AS "activeTotal",
      COUNT(*) FILTER (WHERE membership_status = 'Active' AND member_segment = 'paid')::int AS "paidActive",
      COUNT(*) FILTER (WHERE membership_status = 'Active' AND member_segment = 'student')::int AS "studentActive",
      COUNT(*) FILTER (WHERE membership_status = 'Active' AND member_segment = 'honorary')::int AS "honoraryActive",
      COUNT(*) FILTER (
        WHERE membership_movement IN ('NewJoin', 'Rejoin', 'Reinstate')
          AND start_date >= $4::date AND start_date <= $5::date
      )::int AS joiners,
      COUNT(*) FILTER (
        WHERE (cancelled_at >= $6::timestamptz AND cancelled_at < $7::timestamptz)
           OR (resigned_at >= $6::timestamptz AND resigned_at < $7::timestamptz)
      )::int AS leavers
    FROM membership_listing
    WHERE tenant_id = $1 AND ${seg.sql}`,
    [tenantId, ...seg.params, monthStart, today, start, end]
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

async function getUnifiedDashboard(tenantId, filters = {}) {
  const segmentOpts = {
    includeStudents: filters.includeStudents === true,
    includeHonorary: filters.includeHonorary === true,
  };

  const cur = currentMonthPeriod();
  const prev = previousMonthPeriod();
  const ytd = yearToDateEnd();
  const lytd = lastYearToDateEnd();

  await Promise.all([
    ensurePeriodSnapshot(tenantId, cur.asOfDate),
    ensurePeriodSnapshot(tenantId, prev.asOfDate),
    ensurePeriodSnapshot(tenantId, ytd.asOfDate),
    ensurePeriodSnapshot(tenantId, lytd.asOfDate),
  ]);

  const [liveKpi, snapCur, snapPrev, snapYtd, snapLytd] = await Promise.all([
    countMtdFromListing(tenantId, segmentOpts),
    getKpiFromSnapshot(tenantId, cur.asOfDate, segmentOpts),
    getKpiFromSnapshot(tenantId, prev.asOfDate, segmentOpts),
    getKpiFromSnapshot(tenantId, ytd.asOfDate, segmentOpts),
    getKpiFromSnapshot(tenantId, lytd.asOfDate, segmentOpts),
  ]);

  let prevMonthKpi = {};
  try {
    const { rows } = await pool.query(
      `SELECT joiners, leavers, net_growth FROM membership_kpi_monthly
       WHERE tenant_id = $1 AND period_year = $2 AND period_month = $3`,
      [tenantId, prev.year, prev.month]
    );
    prevMonthKpi = rows[0] || {};
  } catch {
    prevMonthKpi = {};
  }

  const kpis = {
    totalActiveMembers: compareKpi(liveKpi.activeTotal, snapPrev?.activeTotal),
    newJoiners: compareKpi(
      liveKpi.joiners,
      Number(prevMonthKpi.joiners) || 0
    ),
    leavers: compareKpi(
      liveKpi.leavers,
      Number(prevMonthKpi.leavers) || 0
    ),
    netGrowth: compareKpi(
      liveKpi.netGrowth,
      Number(prevMonthKpi.net_growth) || 0
    ),
    paidMembers: compareKpi(liveKpi.paidActive, snapPrev?.paidActive),
    studentMembers: compareKpi(liveKpi.studentActive, snapPrev?.studentActive),
    honoraryMembers: compareKpi(liveKpi.honoraryActive, snapPrev?.honoraryActive),
    ytdActive: compareKpi(snapYtd?.activeTotal, snapLytd?.activeTotal),
    thisMonthVsLastMonth: {
      active: compareKpi(snapCur?.activeTotal, snapPrev?.activeTotal),
      joiners: compareKpi(liveKpi.joiners, Number(prevMonthKpi.joiners) || 0),
      leavers: compareKpi(liveKpi.leavers, Number(prevMonthKpi.leavers) || 0),
      netGrowth: compareKpi(
        liveKpi.netGrowth,
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
        segmentOpts
      );
    })
  );

  const dashboardFilters = mapDashboardFilters(filters);

  return {
    kpis,
    distributions,
    asOfDate: cur.asOfDate,
    filtersApplied: dashboardFilters,
  };
}

function mapDashboardFilters(filters) {
  const out = {
    includeStudents: filters.includeStudents === true,
    includeHonorary: filters.includeHonorary === true,
  };
  const dimMap = {
    "Membership Category": "membershipCategories",
    Grade: "grades",
    "Section (Primary Section)": "sections",
    Region: "regions",
    Branch: "branches",
    "Work Location": "workLocations",
  };
  for (const [label, key] of Object.entries(dimMap)) {
    if (filters[label]?.length) out[key] = filters[label];
  }
  return out;
}

module.exports = { getUnifiedDashboard, compareKpi };
