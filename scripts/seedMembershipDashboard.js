#!/usr/bin/env node
/**
 * Seed membership_listing with demo regions/categories and rebuild period snapshots.
 *
 * Usage:
 *   TENANT_ID=<tenant> node scripts/seedMembershipDashboard.js
 *   TENANT_ID=<tenant> node scripts/seedMembershipDashboard.js --count=850 --clear
 *
 * Docker (from reporting-service directory):
 *   docker compose exec reporting-service node scripts/seedMembershipDashboard.js
 */
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env.staging") });
require("dotenv").config({
  path: path.join(__dirname, "..", "..", "..", "config", ".env.common"),
});

const { pool } = require("../db/postgres");
const { memberSegmentFromCategory } = require("../lib/memberSegment");
const { buildPeriodSnapshotFromListing } = require("../repositories/membershipSnapshot.repository");
const { computeAndStoreMonthlyMetrics } = require("../repositories/membershipAnalytics.repository");
const {
  currentMonthPeriod,
  previousMonthPeriod,
  sameMonthLastYear,
  yearToDateEnd,
  lastYearToDateEnd,
} = require("../lib/reportingPeriods");

const SEED_PREFIX = "seed-dashboard-";

const CATEGORIES = [
  { name: "General All Grades", weight: 72 },
  { name: "Associate", weight: 12 },
  { name: "Undergraduate Student", weight: 6 },
  { name: "Postgraduate Student", weight: 2 },
  { name: "Honorary Member", weight: 3 },
  { name: "Retired Member", weight: 5 },
];

const REGIONS = [
  { name: "Dublin", weight: 35, branches: ["Dublin North", "Dublin South", "Dublin Central"] },
  { name: "Cork", weight: 18, branches: ["Cork City", "Cork County"] },
  { name: "Galway", weight: 12, branches: ["Galway West", "Galway East"] },
  { name: "Limerick", weight: 10, branches: ["Limerick City"] },
  { name: "Waterford", weight: 8, branches: ["Waterford"] },
  { name: "Donegal", weight: 7, branches: ["Letterkenny", "Donegal Town"] },
  { name: "Kilkenny", weight: 5, branches: ["Kilkenny"] },
  { name: "Midlands", weight: 5, branches: ["Athlone", "Tullamore"] },
];

const GRADES = [
  "Staff Nurse",
  "Clinical Nurse Manager",
  "Registered Nurse",
  "Healthcare Assistant",
  "Midwife",
  "Public Health Nurse",
];

const SECTIONS = ["Acute", "Community", "Mental Health", "Older Persons", "Paediatrics"];
const WORK_LOCATIONS = [
  "Beaumont Hospital",
  "Cork University Hospital",
  "Galway University Hospital",
  "University Hospital Limerick",
  "Waterford University Hospital",
  "Community Care",
];

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

function weightedPick(items) {
  const total = items.reduce((s, i) => s + i.weight, 0);
  let r = Math.random() * total;
  for (const item of items) {
    r -= item.weight;
    if (r <= 0) return item;
  }
  return items[items.length - 1];
}

function pickBranch(region) {
  const list = region.branches || [region.name];
  return list[Math.floor(Math.random() * list.length)];
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
    monthStart: start.toISOString().slice(0, 10),
    monthEnd: end.toISOString().slice(0, 10),
    sampleDay: mid.toISOString().slice(0, 10),
    year: y,
    month: m + 1,
  };
}

function buildMembers(tenantId, totalCount) {
  const { monthStart, monthEnd, sampleDay, year } = monthBoundsUtc();
  const joinerCount = Math.max(15, Math.round(totalCount * 0.04));
  const leaverCount = Math.max(10, Math.round(totalCount * 0.025));
  const activeCount = totalCount - joinerCount - leaverCount;
  const rows = [];
  let n = 0;

  const push = (overrides) => {
    const i = n++;
    const category = overrides.membership_category || weightedPick(CATEGORIES).name;
    const region = overrides.region
      ? REGIONS.find((r) => r.name === overrides.region) || weightedPick(REGIONS)
      : weightedPick(REGIONS);
    const regionName = typeof region === "string" ? region : region.name;
    const branch =
      overrides.branch ||
      pickBranch(typeof region === "string" ? weightedPick(REGIONS) : region);

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
      grade: overrides.grade || GRADES[i % GRADES.length],
      work_location:
        overrides.work_location || WORK_LOCATIONS[i % WORK_LOCATIONS.length],
      branch,
      region: regionName,
      section: overrides.section || SECTIONS[i % SECTIONS.length],
      payment_type: "Salary Deduction",
      payment_frequency: "Monthly",
      subscription_year: year,
      member_segment: memberSegmentFromCategory(category),
      is_current: overrides.is_current !== false,
    });
  };

  for (let i = 0; i < activeCount; i += 1) push({});
  for (let i = 0; i < joinerCount; i += 1) {
    push({
      membership_movement: "NewJoin",
      start_date: sampleDay,
    });
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

  return { rows, monthStart, monthEnd };
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
  const periods = [
    currentMonthPeriod(),
    previousMonthPeriod(),
    sameMonthLastYear(),
    yearToDateEnd(),
    lastYearToDateEnd(),
  ];
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

  if (opts.clear) {
    await clearSeedData(tenantId);
    console.log("  cleared prior seed-dashboard-* rows");
  }

  const { rows } = buildMembers(tenantId, opts.count);
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
  .finally(() => pool.end());
