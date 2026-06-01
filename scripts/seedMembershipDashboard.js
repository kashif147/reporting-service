#!/usr/bin/env node
/**
 * Seed membership_listing using user-service lookup/product data, then rebuild snapshots.
 *
 * Usage:
 *   MONGO_URI=<user-service-db> TENANT_ID=<tenant> node scripts/seedMembershipDashboard.js
 *   TENANT_ID=<tenant> node scripts/seedMembershipDashboard.js --clear --count=850
 *
 * Docker:
 *   docker compose exec -e MONGO_URI="$MONGO_URI" reporting-service node scripts/seedMembershipDashboard.js --clear
 */
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env.staging") });
require("dotenv").config({
  path: path.join(__dirname, "..", "..", "..", "config", ".env.common"),
});
require("dotenv").config({
  path: path.join(__dirname, "..", "..", "user-service", ".env.staging"),
});

const { pool } = require("../db/postgres");
const { memberSegmentFromCategory } = require("../lib/memberSegment");
const { buildPeriodSnapshotFromListing } = require("../repositories/membershipSnapshot.repository");
const { computeAndStoreMonthlyMetrics } = require("../repositories/membershipAnalytics.repository");
const {
  currentMonthPeriod,
  previousMonthPeriod,
  yearToDateEnd,
  lastYearToDateEnd,
  sameMonthLastYear,
} = require("../lib/reportingPeriods");
const {
  loadSeedLookups,
  weightedPick,
  pickLocation,
  disconnectMongo,
} = require("./lib/loadSeedLookups");

const SEED_PREFIX = "seed-dashboard-";

function parseArgs() {
  const opts = { clear: false, count: 850 };
  for (const arg of process.argv.slice(2)) {
    if (arg === "--clear") opts.clear = true;
    else if (arg.startsWith("--count=")) opts.count = Number(arg.slice(8));
  }
  if (!Number.isFinite(opts.count) || opts.count < 50) {
    throw new Error("--count must be a number >= 50");
  }
  return opts;
}

function monthBoundsUtc() {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const start = new Date(Date.UTC(y, m, 1));
  const end = new Date(Date.UTC(y, m + 1, 0));
  const day = Math.min(now.getUTCDate(), end.getUTCDate());
  const mid = new Date(Date.UTC(y, m, Math.max(1, Math.floor(day / 2))));
  return {
    sampleDay: mid.toISOString().slice(0, 10),
    year: y,
  };
}

function buildMembers(tenantId, totalCount, lookups) {
  const { sampleDay, year } = monthBoundsUtc();
  const joinerCount = Math.max(15, Math.round(totalCount * 0.04));
  const leaverCount = Math.max(10, Math.round(totalCount * 0.025));
  const activeCount = totalCount - joinerCount - leaverCount;
  const rows = [];
  let n = 0;

  const push = (overrides = {}) => {
    const i = n++;
    const category =
      overrides.membership_category || weightedPick(lookups.categories).name;
    const loc = overrides.region
      ? {
          region: overrides.region,
          branch: overrides.branch,
          work_location: overrides.work_location,
        }
      : pickLocation(lookups.locations);

    rows.push({
      tenant_id: tenantId,
      subscription_id: `${SEED_PREFIX}${String(i + 1).padStart(6, "0")}`,
      profile_id: `${SEED_PREFIX}profile-${String(i + 1).padStart(6, "0")}`,
      membership_number: `SD${String(100000 + i)}`,
      full_name: `Seed Member ${i + 1}`,
      membership_status: overrides.membership_status || "Active",
      membership_movement: overrides.membership_movement || "Renewed",
      start_date: overrides.start_date || "2020-06-15",
      expiry_date: overrides.expiry_date || `${year + 1}-12-31`,
      cancelled_at: overrides.cancelled_at ?? null,
      resigned_at: overrides.resigned_at ?? null,
      membership_category: category,
      grade: overrides.grade || weightedPick(lookups.grades).name,
      work_location: overrides.work_location || loc.work_location,
      branch: overrides.branch || loc.branch,
      region: overrides.region || loc.region,
      section: overrides.section || weightedPick(lookups.sections).name,
      payment_type:
        overrides.payment_type || weightedPick(lookups.paymentTypes).name,
      payment_frequency: "Monthly",
      subscription_year: year,
      member_segment: memberSegmentFromCategory(category),
      is_current: overrides.is_current !== false,
    });
  };

  for (let i = 0; i < activeCount; i += 1) push();
  for (let i = 0; i < joinerCount; i += 1) {
    push({ membership_movement: "NewJoin", start_date: sampleDay });
  }
  for (let i = 0; i < leaverCount; i += 1) {
    if (i % 2 === 0) {
      push({
        membership_status: "Cancelled",
        membership_movement: "Cancelled",
        cancelled_at: `${sampleDay}T12:00:00.000Z`,
        is_current: false,
      });
    } else {
      push({
        membership_status: "Resigned",
        membership_movement: "Resigned",
        resigned_at: `${sampleDay}T12:00:00.000Z`,
        is_current: false,
      });
    }
  }

  return { rows };
}

async function clearSeedData(tenantId) {
  const like = `${SEED_PREFIX}%`;
  await pool.query(
    `DELETE FROM membership_period_snapshot
     WHERE tenant_id = $1 AND subscription_id LIKE $2`,
    [tenantId, like]
  );
  await pool.query(
    `DELETE FROM membership_listing
     WHERE tenant_id = $1 AND subscription_id LIKE $2`,
    [tenantId, like]
  );
}

/** Remove comparison snapshots that were backfilled from current listing (misleading KPIs). */
async function clearBackfilledPriorYearSnapshots(tenantId) {
  const dates = [
    previousMonthPeriod().asOfDate,
    lastYearToDateEnd().asOfDate,
    sameMonthLastYear().asOfDate,
  ];
  const res = await pool.query(
    `DELETE FROM membership_period_snapshot
     WHERE tenant_id = $1 AND snapshot_date = ANY($2::date[])`,
    [tenantId, dates]
  );
  if (res.rowCount > 0) {
    console.log(`  removed ${res.rowCount} backfilled prior-year snapshot row(s)`);
  }
}

async function upsertListingRows(rows) {
  const cols = [
    "tenant_id",
    "subscription_id",
    "profile_id",
    "membership_number",
    "full_name",
    "membership_status",
    "membership_movement",
    "start_date",
    "expiry_date",
    "cancelled_at",
    "resigned_at",
    "membership_category",
    "grade",
    "work_location",
    "branch",
    "region",
    "section",
    "payment_type",
    "payment_frequency",
    "subscription_year",
    "member_segment",
    "is_current",
  ];
  const batchSize = 100;
  let inserted = 0;

  for (let offset = 0; offset < rows.length; offset += batchSize) {
    const batch = rows.slice(offset, offset + batchSize);
    const values = [];
    const params = [];
    let p = 1;

    for (const row of batch) {
      const placeholders = cols.map(() => `$${p++}`);
      values.push(`(${placeholders.join(", ")})`);
      for (const col of cols) params.push(row[col]);
    }

    const updates = cols
      .filter((c) => c !== "tenant_id" && c !== "subscription_id")
      .map((c) => `${c} = EXCLUDED.${c}`)
      .join(", ");

    await pool.query(
      `INSERT INTO membership_listing (${cols.join(", ")})
       VALUES ${values.join(", ")}
       ON CONFLICT (tenant_id, subscription_id) DO UPDATE SET
         ${updates},
         updated_at = NOW()`,
      params
    );
    inserted += batch.length;
  }
  return inserted;
}

async function rebuildSnapshots(tenantId) {
  // Current month + YTD only — do not backfill prior month/year from today's listing.
  const periods = [currentMonthPeriod(), yearToDateEnd()];
  const seenMonths = new Set();

  for (const period of periods) {
    const count = await buildPeriodSnapshotFromListing(tenantId, period.asOfDate);
    const key = `${period.year}-${period.month}`;
    if (!seenMonths.has(key)) {
      seenMonths.add(key);
      await computeAndStoreMonthlyMetrics(tenantId, period.year, period.month);
    }
    console.log(
      `  snapshot ${period.asOfDate}: ${count} row(s); metrics ${period.year}-${String(period.month).padStart(2, "0")}`
    );
  }
}

async function main() {
  const opts = parseArgs();
  const tenantId = process.env.TENANT_ID || process.env.DEFAULT_TENANT_ID;
  if (!tenantId) {
    console.error("Set TENANT_ID or DEFAULT_TENANT_ID");
    process.exit(1);
  }

  console.log(`Seeding tenant ${tenantId} (${opts.count} members, clear=${opts.clear})`);

  console.log("  loading lookup data from user-service…");
  const lookups = await loadSeedLookups(tenantId);
  console.log(`  source: ${lookups.source}`);

  if (opts.clear) {
    await clearSeedData(tenantId);
    await clearBackfilledPriorYearSnapshots(tenantId);
    console.log("  cleared prior seed-dashboard-* rows");
  }

  const { rows } = buildMembers(tenantId, opts.count, lookups);
  const inserted = await upsertListingRows(rows);
  console.log(`  upserted ${inserted} listing row(s)`);

  console.log("  rebuilding period snapshots + monthly metrics…");
  await rebuildSnapshots(tenantId);

  const cur = currentMonthPeriod();
  const { rows: sample } = await pool.query(
    `SELECT
      COALESCE(NULLIF(TRIM(membership_category), ''), '(blank)') AS category,
      COUNT(*)::int AS n
     FROM membership_period_snapshot
     WHERE tenant_id = $1 AND snapshot_date = $2::date AND membership_status = 'Active'
     GROUP BY 1 ORDER BY n DESC LIMIT 8`,
    [tenantId, cur.asOfDate]
  );
  const { rows: regions } = await pool.query(
    `SELECT
      COALESCE(NULLIF(TRIM(region), ''), '(blank)') AS region,
      COUNT(*)::int AS n
     FROM membership_period_snapshot
     WHERE tenant_id = $1 AND snapshot_date = $2::date AND membership_status = 'Active'
     GROUP BY 1 ORDER BY n DESC LIMIT 8`,
    [tenantId, cur.asOfDate]
  );

  console.log("\nActive by category (current month-end):");
  for (const r of sample) console.log(`  ${r.category}: ${r.n}`);
  console.log("\nActive by region:");
  for (const r of regions) console.log(`  ${r.region}: ${r.n}`);
  console.log("\nDone. Open the executive dashboard with X-Tenant-Id:", tenantId);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await disconnectMongo().catch(() => {});
    await pool.end();
  });
