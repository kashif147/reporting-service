#!/usr/bin/env node
/**
 * Build month-end snapshots + KPI/dimension aggregates.
 * Usage: TENANT_ID=xxx node scripts/buildMonthlySnapshots.js 2025 12
 *        TENANT_ID=xxx node scripts/buildMonthlySnapshots.js 2026 5
 */
require("dotenv").config({ path: ".env.staging" });

const { pool } = require("../db/postgres");
const { buildSnapshotAndMetrics } = require("../services/snapshotBuild.service");

async function main() {
  const tenantId = process.env.TENANT_ID;
  const year = Number(process.argv[2]);
  const month = Number(process.argv[3]);

  if (!tenantId || !year || !month) {
    console.error(
      "Usage: TENANT_ID=<id> node scripts/buildMonthlySnapshots.js <year> <month>"
    );
    process.exit(1);
  }

  const result = await buildSnapshotAndMetrics(tenantId, {
    type: "month_end",
    year,
    month,
  });
  console.log("Built:", result);
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
