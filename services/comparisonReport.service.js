const { resolvePeriod } = require("../lib/reportingPeriods");
const { ensurePeriodSnapshot } = require("./snapshotBuild.service");
const {
  getComparisonKpis,
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
  };
}

/**
 * Comparison presets:
 * - year_end_vs_month: { periodA: { type:'year_end', year:2025 }, periodB: { type:'month_end', year:2026, month:5 } }
 * - last_month_vs_current: periodA = previous month, periodB = current month
 * - same_month_last_year: periodA = May 2025, periodB = May 2026 (pass months explicitly)
 */
async function runComparisonReport(tenantId, body) {
  const segmentOpts = {
    includeStudents: body.includeStudents === true,
    includeHonorary: body.includeHonorary === true,
  };

  let periodA = body.periodA;
  let periodB = body.periodB;

  if (body.preset === "last_month_vs_current") {
    const {
      currentMonthPeriod,
      previousMonthPeriod,
    } = require("../lib/reportingPeriods");
    periodA = { type: "month_end", year: previousMonthPeriod().year, month: previousMonthPeriod().month };
    periodB = { type: "month_end", year: currentMonthPeriod().year, month: currentMonthPeriod().month };
  } else if (body.preset === "same_month_last_year") {
    const now = new Date();
    periodB = {
      type: "month_end",
      year: now.getUTCFullYear(),
      month: now.getUTCMonth() + 1,
    };
    periodA = {
      type: "month_end",
      year: now.getUTCFullYear() - 1,
      month: now.getUTCMonth() + 1,
    };
  }

  const resolvedA = resolvePeriod(periodA);
  const resolvedB = resolvePeriod(periodB);

  await Promise.all([
    ensurePeriodSnapshot(tenantId, resolvedA.asOfDate),
    ensurePeriodSnapshot(tenantId, resolvedB.asOfDate),
  ]);

  const dimensions = body.dimensions || ["membershipCategory"];
  const kpis = await getComparisonKpis(
    tenantId,
    resolvedA.asOfDate,
    resolvedB.asOfDate,
    segmentOpts
  );

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

  const periodAKpis = kpis.periodA || {};
  const periodBKpis = kpis.periodB || {};

  return {
    periodA: { ...resolvedA, kpis: periodAKpis },
    periodB: { ...resolvedB, kpis: periodBKpis },
    kpiChange: kpiDelta(periodAKpis, periodBKpis),
    breakdown,
  };
}

module.exports = { runComparisonReport };
