const {
  buildPeriodSnapshotFromListing,
  hasPeriodSnapshot,
} = require("../repositories/membershipSnapshot.repository");
const {
  computeAndStoreMonthlyMetrics,
  hasMonthlyKpiRow,
  monthlyMetricsNeedRecompute,
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

/** Ensure snapshot + monthly aggregates exist for one calendar month. */
async function ensureMonthlyMetricsForPeriod(tenantId, year, month) {
  const resolved = resolvePeriod({ type: "month_end", year, month });
  await ensurePeriodSnapshot(tenantId, resolved.asOfDate);
  const needsMetrics =
    !(await hasMonthlyKpiRow(tenantId, year, month)) ||
    (await monthlyMetricsNeedRecompute(tenantId, year, month));
  if (needsMetrics) {
    await computeAndStoreMonthlyMetrics(tenantId, year, month);
  }
  return resolved;
}

/** Last 12 months ending at refYear/refMonth — for dashboard movement trend. */
async function ensureTrendMonthlyMetrics(tenantId, refYear, refMonth) {
  const anchor = new Date(Date.UTC(refYear, refMonth - 1, 1));
  const jobs = [];
  for (let i = 11; i >= 0; i -= 1) {
    const d = new Date(
      Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() - i, 1)
    );
    jobs.push(
      ensureMonthlyMetricsForPeriod(
        tenantId,
        d.getUTCFullYear(),
        d.getUTCMonth() + 1
      )
    );
  }
  return Promise.all(jobs);
}

module.exports = {
  ensurePeriodSnapshot,
  ensureMonthlyMetricsForPeriod,
  ensureTrendMonthlyMetrics,
  buildSnapshotAndMetrics,
  buildPeriodSnapshotFromListing,
};
