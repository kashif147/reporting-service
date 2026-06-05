const { getYearReconciliation } = require("./membershipYearReconciliation.service");
const {
  getStatisticsBreakdown,
  getLocationHierarchyBreakdown,
} = require("../repositories/membershipStatistics.repository");

function buildSummaryFromReconciliation(reconciliation) {
  const openingActive = reconciliation.opening.activeTotal;
  const closingActive = reconciliation.closing.activeTotal;
  const m = reconciliation.movements;

  const joined = m.newJoin + m.rejoin;
  const reinstatements = m.reinstate;
  const resigned = m.resigned;
  const lapsed = m.cancelled;
  const leavers = m.leaversTotal;
  const calculatedClosing = reconciliation.reconciliation.calculatedClosing;
  const variance = reconciliation.reconciliation.variance;

  return {
    openingActive,
    newJoin: m.newJoin,
    rejoin: m.rejoin,
    joined,
    reinstatements,
    resigned,
    lapsed,
    leavers,
    closingActive,
    calculatedClosing,
    variance,
    balances: reconciliation.reconciliation.balances,
    formula: reconciliation.reconciliation.formula,
  };
}

/**
 * Membership Statistics report — year movement summary with fee type and region breakdowns.
 */
async function getMembershipStatistics(tenantId, filters = {}) {
  const reconciliation = await getYearReconciliation(tenantId, filters);
  const summary = buildSummaryFromReconciliation(reconciliation);

  const segmentOpts = {
    includeStudents: reconciliation.filters.includeStudents,
    includeHonorary: reconciliation.filters.includeHonorary,
  };
  const dimensionOpts = reconciliation.filters.dimensions || {};

  const [
    byMembershipCategory,
    byFeeType,
    byRegion,
    byLocation,
  ] = await Promise.all([
    getStatisticsBreakdown(
      tenantId,
      "membershipCategory",
      reconciliation.opening.asOfDate,
      reconciliation.closing.asOfDate,
      reconciliation.year,
      reconciliation.throughMonth,
      segmentOpts,
      dimensionOpts,
    ),
    getStatisticsBreakdown(
      tenantId,
      "feeType",
      reconciliation.opening.asOfDate,
      reconciliation.closing.asOfDate,
      reconciliation.year,
      reconciliation.throughMonth,
      segmentOpts,
      dimensionOpts,
    ),
    getStatisticsBreakdown(
      tenantId,
      "region",
      reconciliation.opening.asOfDate,
      reconciliation.closing.asOfDate,
      reconciliation.year,
      reconciliation.throughMonth,
      segmentOpts,
      dimensionOpts,
    ),
    getLocationHierarchyBreakdown(
      tenantId,
      reconciliation.closing.asOfDate,
      reconciliation.year,
      reconciliation.throughMonth,
      segmentOpts,
      dimensionOpts,
    ),
  ]);

  return {
    reportTitle: "Live Membership Statistics Report",
    year: reconciliation.year,
    throughMonth: reconciliation.throughMonth,
    period: {
      opening: reconciliation.opening,
      closing: reconciliation.closing,
      monthsIncluded: reconciliation.movements.monthsIncluded,
    },
    summary,
    breakdowns: {
      byMembershipCategory,
      byFeeType,
      byRegion,
      byLocation,
    },
    notes: [
      "Opening active is the active count at 01 Jan (prior 31 Dec snapshot). Movements are year-to-date through the selected month.",
      "Joined = new members + re-joined; lapsed = cancelled in period.",
      "Renewed members are not counted as joiners — they were already active at opening.",
      "Each breakdown row should satisfy: opening + joined + reinstatements − resigned − lapsed = calculated closing.",
    ],
    filters: reconciliation.filters,
  };
}

module.exports = { getMembershipStatistics };
