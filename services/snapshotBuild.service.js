const {
  buildPeriodSnapshotFromListing,
  hasPeriodSnapshot,
} = require("../repositories/membershipSnapshot.repository");
const {
  computeAndStoreMonthlyMetrics,
} = require("../repositories/membershipAnalytics.repository");
const { resolvePeriod } = require("../lib/reportingPeriods");

async function ensurePeriodSnapshot(tenantId, asOfDate) {
  const exists = await hasPeriodSnapshot(tenantId, asOfDate);
  if (!exists) {
    await buildPeriodSnapshotFromListing(tenantId, asOfDate);
  }
}

async function buildSnapshotAndMetrics(tenantId, period) {
  const resolved = resolvePeriod(period);
  await buildPeriodSnapshotFromListing(tenantId, resolved.asOfDate);
  await computeAndStoreMonthlyMetrics(
    tenantId,
    resolved.year,
    resolved.month
  );
  return resolved;
}

module.exports = {
  ensurePeriodSnapshot,
  buildSnapshotAndMetrics,
  buildPeriodSnapshotFromListing,
};
