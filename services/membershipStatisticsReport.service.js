const { getYearReconciliation } = require("./membershipYearReconciliation.service");
const {
  getStatisticsBreakdown,
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

  const [byFeeType, byRegion] = await Promise.all([
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
  ]);

  return {
    reportTitle: "Statistics",
    year: reconciliation.year,
    throughMonth: reconciliation.throughMonth,
    period: {
      opening: reconciliation.opening,
      closing: reconciliation.closing,
      monthsIncluded: reconciliation.movements.monthsIncluded,
    },
    summary,
    breakdowns: {
      byFeeType,
      byRegion,
    },
    notes: [
      "Opening active is measured at the prior 31 Dec snapshot (start of 1 Jan).",
      "Joined = new members + re-joined; lapsed = cancelled in period.",
      "Renewed members are not counted as joiners — they were already active at opening.",
      "Each breakdown row should satisfy: opening + joined + reinstatements − resigned − lapsed = calculated closing.",
    ],
    filters: reconciliation.filters,
  };
}

module.exports = { getMembershipStatistics };
