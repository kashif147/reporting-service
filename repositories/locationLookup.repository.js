const { pool } = require("../db/postgres");

async function upsertLocationLookups(tenantId, rows = []) {
  if (!rows.length) return { upserted: 0 };

  let upserted = 0;
  for (const row of rows) {
    await pool.query(
      `INSERT INTO membership_location_lookup (
        tenant_id, work_location, branch, region, lookup_id,
        officer_user_id, officer_initials, officer_display_name,
        branch_officer_user_id, region_officer_user_id, synced_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
      ON CONFLICT (tenant_id, work_location) DO UPDATE SET
        branch = EXCLUDED.branch,
        region = EXCLUDED.region,
        lookup_id = EXCLUDED.lookup_id,
        officer_user_id = EXCLUDED.officer_user_id,
        officer_initials = EXCLUDED.officer_initials,
        officer_display_name = EXCLUDED.officer_display_name,
        branch_officer_user_id = EXCLUDED.branch_officer_user_id,
        region_officer_user_id = EXCLUDED.region_officer_user_id,
        synced_at = NOW()`,
      [
        tenantId,
        row.work_location,
        row.branch || null,
        row.region || null,
        row.lookup_id || null,
        row.officer_user_id || null,
        row.officer_initials || null,
        row.officer_display_name || null,
        row.branch_officer_user_id || null,
        row.region_officer_user_id || null,
      ],
    );
    upserted += 1;
  }
  return { upserted };
}

async function getLocationLookupsForTenant(tenantId) {
  const { rows } = await pool.query(
    `SELECT
      work_location,
      branch,
      region,
      lookup_id,
      officer_user_id,
      officer_initials,
      officer_display_name,
      branch_officer_user_id,
      region_officer_user_id
    FROM membership_location_lookup
    WHERE tenant_id = $1`,
    [tenantId],
  );
  return rows;
}

async function getLocationLookupMap(tenantId) {
  const rows = await getLocationLookupsForTenant(tenantId);
  return new Map(rows.map((r) => [r.work_location, r]));
}

module.exports = {
  upsertLocationLookups,
  getLocationLookupsForTenant,
  getLocationLookupMap,
};
