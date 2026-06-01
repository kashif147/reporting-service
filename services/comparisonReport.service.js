const {
  resolvePeriod,
  currentMonthPeriod,
  previousMonthPeriod,
} = require("../lib/reportingPeriods");
const { ensurePeriodSnapshot } = require("./snapshotBuild.service");
const { hasPeriodSnapshot } = require("../repositories/membershipSnapshot.repository");
const {
  getComparisonPeriodKpis,
  getComparisonByDimension,
  DIMENSION_COLUMNS,
} = require("../repositories/membershipAnalytics.repository");

function kpiDelta(a, b) {
  const num = (v) => Number(v) || 0;
  return {
    activeTotal: num(b?.activeTotal) - num(a?.activeTotal),
    paidActive: num(b?.paidActive) - num(a?.paidActive),
    studentActive: num(b?.studentActive) - num(a?.studentActive),
    honoraryActive: num(b?.honoraryActive) - num(a?.honoraryActive),
    joiners: num(b?.joiners) - num(a?.joiners),
    leavers: num(b?.leavers) - num(a?.leavers),
    netGrowth: num(b?.netGrowth) - num(a?.netGrowth),
  };
}

function resolvePresetPeriods(body) {
  let periodA = body.periodA;
  let periodB = body.periodB;
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth() + 1;

  if (body.preset === "last_month_vs_current") {
    const prev = previousMonthPeriod();
    const cur = currentMonthPeriod();
    periodA = { type: "month_end", year: prev.year, month: prev.month };
    periodB = { type: "month_end", year: cur.year, month: cur.month };
  } else if (body.preset === "same_month_last_year") {
    periodB = { type: "month_end", year: y, month: m };
    periodA = { type: "month_end", year: y - 1, month: m };
  } else if (body.preset === "year_end_vs_current") {
    periodA = { type: "year_end", year: y - 1 };
    periodB = { type: "month_end", year: y, month: m };
  }

  return { periodA, periodB };
}

/**
 * Comparison presets:
 * - year_end_vs_current: prior calendar year-end vs current month-end
 * - last_month_vs_current: previous month vs current month
 * - same_month_last_year: same month last year vs current month
 */
async function runComparisonReport(tenantId, body) {
  const segmentOpts = {
    includeStudents: body.includeStudents === true,
    includeHonorary: body.includeHonorary === true,
  };

  const { periodA, periodB } = resolvePresetPeriods(body);
  const resolvedA = resolvePeriod(periodA);
  const resolvedB = resolvePeriod(periodB);

  const hadB = await hasPeriodSnapshot(tenantId, resolvedB.asOfDate);
  if (!hadB) {
    await ensurePeriodSnapshot(tenantId, resolvedB.asOfDate);
  }

  const [periodAKpis, periodBKpis] = await Promise.all([
    getComparisonPeriodKpis(tenantId, resolvedA, segmentOpts),
    getComparisonPeriodKpis(tenantId, resolvedB, segmentOpts),
  ]);

  const dimensions = body.dimensions || ["membershipCategory"];
  const breakdown = {};
  for (const dim of dimensions) {
    if (!DIMENSION_COLUMNS[dim]) continue;
    breakdown[dim] = await getComparisonByDimension(
      tenantId,
      resolvedA.asOfDate,
      resolvedB.asOfDate,
      dim,
      segmentOpts
    );
  }

  return {
    preset: body.preset || null,
    periodA: {
      ...resolvedA,
      kpis: periodAKpis,
      hasSnapshot: await hasPeriodSnapshot(tenantId, resolvedA.asOfDate),
    },
    periodB: {
      ...resolvedB,
      kpis: periodBKpis,
      hasSnapshot: true,
    },
    kpiChange: kpiDelta(periodAKpis, periodBKpis),
    breakdown,
  };
}

async function runDualComparisonReport(tenantId, body) {
  const base = {
    includeStudents: body.includeStudents === true,
    includeHonorary: body.includeHonorary === true,
    dimensions: body.dimensions || ["membershipCategory"],
  };
  const [sameMonthLastYear, yearEndVsCurrent] = await Promise.all([
    runComparisonReport(tenantId, {
      ...base,
      preset: "same_month_last_year",
    }),
    runComparisonReport(tenantId, {
      ...base,
      preset: "year_end_vs_current",
    }),
  ]);
  return { sameMonthLastYear, yearEndVsCurrent };
}

module.exports = { runComparisonReport, runDualComparisonReport };
