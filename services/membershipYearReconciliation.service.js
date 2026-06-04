const { resolvePeriod } = require("../lib/reportingPeriods");
const {
  normalizeMembershipDimensionFilters,
} = require("../lib/membershipDimensionFilters");
const {
  hasPeriodSnapshot,
} = require("../repositories/membershipSnapshot.repository");
const {
  getSnapshotKpiIfExists,
} = require("../repositories/membershipAnalytics.repository");
const { sumYtdMovementBreakdown } = require("../repositories/membershipMovementAnalytics.repository");
const {
  ensurePeriodSnapshot,
  ensureMonthlyMetricsForPeriod,
} = require("./snapshotBuild.service");

/**
 * Year reconciliation: opening active (prior year-end) + joiners − leavers ≈ closing active (year-end).
 * Opening is the 31 Dec (year−1) snapshot — same population as start of 1 Jan.
 */
async function getYearReconciliation(tenantId, filters = {}) {
  const year = Number(filters.year);
  if (!year || year < 2000) {
    const err = new Error("year is required (e.g. 2025)");
    err.statusCode = 400;
    throw err;
  }

  const now = new Date();
  const isCurrentYear = year === now.getUTCFullYear();
  const throughMonth = Math.min(
    Math.max(
      Number(filters.throughMonth) ||
        (isCurrentYear ? now.getUTCMonth() + 1 : 12),
      1,
    ),
    12,
  );

  const segmentOpts = {
    includeStudents: filters.includeStudents !== false,
    includeHonorary: filters.includeHonorary !== false,
  };
  const dimensionOpts = normalizeMembershipDimensionFilters(filters);

  const openingPeriod = resolvePeriod({ type: "year_end", year: year - 1 });
  const closingPeriod = resolvePeriod({
    type: "month_end",
    year,
    month: throughMonth,
  });

  const shouldEnsureSnapshots =
    filters.recompute === true || filters.ensureSnapshots === true;

  if (shouldEnsureSnapshots) {
    await Promise.all([
      ensurePeriodSnapshot(tenantId, openingPeriod.asOfDate),
      ensurePeriodSnapshot(tenantId, closingPeriod.asOfDate),
      ...Array.from({ length: throughMonth }, (_, i) =>
        ensureMonthlyMetricsForPeriod(tenantId, year, i + 1),
      ),
    ]);
  }

  const [hasOpeningSnapshot, hasClosingSnapshot, openingKpi, closingKpi, movements] =
    await Promise.all([
      hasPeriodSnapshot(tenantId, openingPeriod.asOfDate),
      hasPeriodSnapshot(tenantId, closingPeriod.asOfDate),
      getSnapshotKpiIfExists(
        tenantId,
        openingPeriod.asOfDate,
        segmentOpts,
        dimensionOpts,
      ),
      getSnapshotKpiIfExists(
        tenantId,
        closingPeriod.asOfDate,
        segmentOpts,
        dimensionOpts,
      ),
      sumYtdMovementBreakdown(
        tenantId,
        year,
        throughMonth,
        segmentOpts,
        dimensionOpts,
      ),
    ]);

  const openingActive = Number(openingKpi?.activeTotal) || 0;
  const closingActive = Number(closingKpi?.activeTotal) || 0;
  const calculatedClosing =
    openingActive + movements.joinersTotal - movements.leaversTotal;
  const variance = closingActive - calculatedClosing;

  return {
    year,
    throughMonth,
    opening: {
      label: `1 Jan ${year} (prior year-end snapshot)`,
      asOfDate: openingPeriod.asOfDate,
      activeTotal: openingActive,
      snapshotAvailable: hasOpeningSnapshot,
    },
    movements: {
      newJoin: movements.newJoin,
      rejoin: movements.rejoin,
      reinstate: movements.reinstate,
      joinersTotal: movements.joinersTotal,
      cancelled: movements.cancelled,
      resigned: movements.resigned,
      leaversTotal: movements.leaversTotal,
      netChange: movements.netChange,
      monthsIncluded: throughMonth,
      note: "Renewed subscriptions are excluded; they were already in opening active.",
    },
    closing: {
      label:
        throughMonth === 12
          ? `31 Dec ${year}`
          : `Month-end ${closingPeriod.label}`,
      asOfDate: closingPeriod.asOfDate,
      activeTotal: closingActive,
      snapshotAvailable: hasClosingSnapshot,
    },
    reconciliation: {
      formula:
        "opening + newJoin + rejoin + reinstate − cancelled − resigned = calculatedClosing",
      calculatedClosing,
      actualClosing: closingActive,
      variance,
      balances:
        Math.abs(variance) <= 0,
    },
    filters: {
      includeStudents: segmentOpts.includeStudents,
      includeHonorary: segmentOpts.includeHonorary,
      dimensions: dimensionOpts,
    },
  };
}

module.exports = { getYearReconciliation };
