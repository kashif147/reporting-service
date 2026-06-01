#!/usr/bin/env node
/**
 * Verifies reporting_db has listing + snapshots + monthly aggregates for the dashboard.
 *
 * Usage:
 *   TENANT_ID=... npm run verify:dashboard
 *   TENANT_ID=... node scripts/verifyDashboardReadiness.js --backfill-months=12
 */
require("dotenv").config();
const { pool } = require("../db/postgres");
const {
  ensureTrendMonthlyMetrics,
  ensureMonthlyMetricsForPeriod,
} = require("../services/snapshotBuild.service");
const { resolvePeriod, currentMonthPeriod } = require("../lib/reportingPeriods");

async function countListing(tenantId) {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS n FROM membership_listing WHERE tenant_id = $1`,
    [tenantId]
  );
  return rows[0]?.n || 0;
}

async function countSnapshots(tenantId) {
  const { rows } = await pool.query(
    `SELECT COUNT(DISTINCT snapshot_date)::int AS n
     FROM membership_period_snapshot WHERE tenant_id = $1`,
    [tenantId]
  );
  return rows[0]?.n || 0;
}

async function countKpiMonths(tenantId) {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS n FROM membership_kpi_monthly WHERE tenant_id = $1`,
    [tenantId]
  );
  return rows[0]?.n || 0;
}

async function main() {
  const tenantId = process.env.TENANT_ID;
  if (!tenantId) {
    console.error("TENANT_ID is required");
    process.exit(1);
  }

  const backfillArg = process.argv.find((a) => a.startsWith("--backfill-months="));
  const backfillMonths = backfillArg
    ? Number(backfillArg.split("=")[1])
    : 0;

  const listing = await countListing(tenantId);
  const snapshots = await countSnapshots(tenantId);
  const kpiMonths = await countKpiMonths(tenantId);

  console.log("Dashboard readiness for tenant", tenantId);
  console.log("  membership_listing rows:", listing);
  console.log("  distinct snapshot dates:", snapshots);
  console.log("  membership_kpi_monthly rows:", kpiMonths);

  const cur = currentMonthPeriod();

  if (listing === 0) {
    console.warn(
      "\n⚠ No listing rows. Ingest subscriptions or run: npm run seed:dashboard"
    );
  }

  if (backfillMonths > 0) {
    console.log(`\nBackfilling last ${backfillMonths} month(s) of snapshots + metrics…`);
    for (let i = backfillMonths - 1; i >= 0; i -= 1) {
      const d = new Date(
        Date.UTC(cur.year, cur.month - 1 - i, 1)
      );
      const y = d.getUTCFullYear();
      const m = d.getUTCMonth() + 1;
      await ensureMonthlyMetricsForPeriod(tenantId, y, m);
      console.log("  ✓", resolvePeriod({ type: "month_end", year: y, month: m }).label);
    }
  } else {
    await ensureTrendMonthlyMetrics(tenantId, cur.year, cur.month);
    console.log("\n✓ Ensured 12-month trend snapshots + metrics (current period).");
  }

  const snapshotsAfter = await countSnapshots(tenantId);
  const kpiAfter = await countKpiMonths(tenantId);
  console.log("\nAfter ensure:");
  console.log("  distinct snapshot dates:", snapshotsAfter);
  console.log("  membership_kpi_monthly rows:", kpiAfter);

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
