const { pool } = require("../db/postgres");
const { buildPeriodSnapshotFromListing } = require("../repositories/membershipSnapshot.repository");
const { computeAndStoreMonthlyMetrics } = require("../repositories/membershipAnalytics.repository");
const { resolvePeriod, lastDayOfMonth } = require("../lib/reportingPeriods");

async function listTenantIds() {
  const { rows } = await pool.query(
    `SELECT DISTINCT tenant_id FROM membership_listing WHERE tenant_id IS NOT NULL`
  );
  if (rows.length) return rows.map((r) => r.tenant_id);
  if (process.env.DEFAULT_TENANT_ID) return [process.env.DEFAULT_TENANT_ID];
  return [];
}

async function runDailySnapshots() {
  const today = new Date();
  const asOf = today.toISOString().slice(0, 10);
  const tenants = await listTenantIds();
  for (const tenantId of tenants) {
    await buildPeriodSnapshotFromListing(tenantId, asOf);
    await computeAndStoreMonthlyMetrics(
      tenantId,
      today.getUTCFullYear(),
      today.getUTCMonth() + 1
    );
  }
  console.log(`[reporting-cron] daily snapshots: ${tenants.length} tenant(s) as-of ${asOf}`);
}

async function runPreviousMonthClose() {
  const now = new Date();
  const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const year = prev.getUTCFullYear();
  const month = prev.getUTCMonth() + 1;
  const { asOfDate } = resolvePeriod({ type: "month_end", year, month });
  const tenants = await listTenantIds();
  for (const tenantId of tenants) {
    await buildPeriodSnapshotFromListing(tenantId, asOfDate);
    await computeAndStoreMonthlyMetrics(tenantId, year, month);
  }
  console.log(
    `[reporting-cron] month-close ${year}-${month}: ${tenants.length} tenant(s)`
  );
}

function startScheduledSnapshots() {
  let cron;
  try {
    cron = require("node-cron");
  } catch {
    console.warn("[reporting-cron] node-cron not installed; scheduled snapshots disabled");
    return;
  }

  cron.schedule("0 2 * * *", () => {
    runDailySnapshots().catch((e) =>
      console.error("[reporting-cron] daily failed:", e.message)
    );
  });

  cron.schedule("0 3 1 * *", () => {
    runPreviousMonthClose().catch((e) =>
      console.error("[reporting-cron] month-close failed:", e.message)
    );
  });

  console.log("[reporting-cron] scheduled: daily 02:00 UTC, month-close 03:00 UTC on 1st");
}

module.exports = {
  startScheduledSnapshots,
  runDailySnapshots,
  runPreviousMonthClose,
};
