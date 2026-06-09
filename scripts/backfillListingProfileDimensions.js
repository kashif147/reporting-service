/**
 * Backfill membership_listing name/grade/branch/region/work_location from profile-service.
 *
 * Usage (from reporting-service):
 *   node scripts/backfillListingProfileDimensions.js [--tenant-id=xxx] [--dry-run]
 */
require("dotenv").config({ path: ".env.staging" });
const axios = require("axios");
const { pool } = require("../db/postgres");
const { profileDimensionsPatch } = require("../lib/membershipRow.mapper");

const PROFILE_SERVICE_URL =
  process.env.PROFILE_SERVICE_URL || "http://localhost/profile-service/api";

function parseArgs() {
  const args = process.argv.slice(2);
  let tenantId = process.env.TENANT_ID || null;
  let dryRun = false;
  for (const arg of args) {
    if (arg.startsWith("--tenant-id=")) tenantId = arg.split("=")[1];
    if (arg === "--dry-run") dryRun = true;
  }
  return { tenantId, dryRun };
}

async function fetchProfiles(profileIds, tenantId) {
  if (!profileIds.length) return [];
  const url = `${PROFILE_SERVICE_URL}/profile/batch`;
  const res = await axios.get(url, {
    params: { profileIds: profileIds.join(",") },
    headers: {
      "x-tenant-id": tenantId,
      "x-internal-request": "true",
    },
    timeout: 30000,
  });
  return res.data?.data || [];
}

async function main() {
  const { tenantId, dryRun } = parseArgs();
  if (!tenantId) {
    console.error("Provide --tenant-id=... or TENANT_ID in env");
    process.exit(1);
  }

  const { rows } = await pool.query(
    `SELECT subscription_id, profile_id, membership_number, full_name, grade, branch, region, work_location
     FROM membership_listing
     WHERE tenant_id = $1
       AND (
         full_name IS NULL OR full_name = ''
         OR grade IS NULL OR grade = ''
         OR branch IS NULL OR branch = ''
         OR region IS NULL OR region = ''
         OR work_location IS NULL OR work_location = ''
         OR full_address IS NULL OR full_address = ''
       )
     ORDER BY updated_at DESC`,
    [tenantId]
  );

  console.log(`Found ${rows.length} listing row(s) with missing dimensions`);
  if (!rows.length) return;

  const profileIds = [...new Set(rows.map((r) => r.profile_id).filter(Boolean))];
  const profiles = await fetchProfiles(profileIds, tenantId);
  const profileById = new Map(profiles.map((p) => [String(p._id), p]));

  let patched = 0;
  for (const row of rows) {
    const profile = profileById.get(String(row.profile_id));
    if (!profile) {
      console.warn("No profile for listing row", row.subscription_id, row.profile_id);
      continue;
    }
    const patch = profileDimensionsPatch(profile);
    const hasData =
      patch.full_name ||
      patch.full_address ||
      patch.grade ||
      patch.branch ||
      patch.region ||
      patch.work_location;
    if (!hasData) {
      console.warn("Profile has no dimension data", row.profile_id);
      continue;
    }

    console.log(
      dryRun ? "[dry-run] would patch" : "patching",
      row.membership_number || row.subscription_id,
      patch
    );

    if (!dryRun) {
      await pool.query(
        `UPDATE membership_listing SET
           membership_number = COALESCE($3, membership_number),
           full_name = COALESCE($4, full_name),
           full_address = COALESCE($5, full_address),
           grade = COALESCE($6, grade),
           branch = COALESCE($7, branch),
           region = COALESCE($8, region),
           work_location = COALESCE($9, work_location),
           section = COALESCE($10, section),
           updated_at = NOW()
         WHERE tenant_id = $1 AND subscription_id = $2`,
        [
          tenantId,
          row.subscription_id,
          patch.membership_number ?? null,
          patch.full_name ?? null,
          patch.full_address ?? null,
          patch.grade ?? null,
          patch.branch ?? null,
          patch.region ?? null,
          patch.work_location ?? null,
          patch.section ?? null,
        ]
      );
    }
    patched++;
  }

  console.log(`${dryRun ? "Would patch" : "Patched"} ${patched} row(s)`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
