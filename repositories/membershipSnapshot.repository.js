const { pool } = require("../db/postgres");
const { memberSegmentFromCategory } = require("../lib/memberSegment");

async function buildPeriodSnapshotFromListing(tenantId, snapshotDate) {
  const res = await pool.query(
    `INSERT INTO membership_period_snapshot (
      tenant_id, snapshot_date, subscription_id, profile_id, membership_number,
      full_name, membership_status, membership_movement, start_date, expiry_date,
      cancelled_at, resigned_at, processed_at, membership_category, grade,
      work_location, branch, region, section, payment_type, payment_frequency,
      subscription_year, member_segment, is_current
    )
    SELECT
      tenant_id, $2::date, subscription_id, profile_id, membership_number,
      full_name, membership_status, membership_movement, start_date, expiry_date,
      cancelled_at, resigned_at, processed_at, membership_category, grade,
      work_location, branch, region, section, payment_type, payment_frequency,
      subscription_year,
      CASE
        WHEN LOWER(COALESCE(membership_category, '')) LIKE '%honorary%' THEN 'honorary'
        WHEN LOWER(COALESCE(membership_category, '')) LIKE '%student%' THEN 'student'
        ELSE 'paid'
      END,
      is_current
    FROM membership_listing
    WHERE tenant_id = $1
    ON CONFLICT (tenant_id, snapshot_date, subscription_id) DO UPDATE SET
      membership_status = EXCLUDED.membership_status,
      membership_movement = EXCLUDED.membership_movement,
      membership_category = EXCLUDED.membership_category,
      grade = EXCLUDED.grade,
      work_location = EXCLUDED.work_location,
      branch = EXCLUDED.branch,
      region = EXCLUDED.region,
      section = EXCLUDED.section,
      member_segment = EXCLUDED.member_segment,
      is_current = EXCLUDED.is_current,
      cancelled_at = EXCLUDED.cancelled_at,
      resigned_at = EXCLUDED.resigned_at,
      created_at = NOW()`,
    [tenantId, snapshotDate]
  );
  return res.rowCount;
}

async function hasPeriodSnapshot(tenantId, snapshotDate) {
  const { rows } = await pool.query(
    `SELECT 1 FROM membership_period_snapshot
     WHERE tenant_id = $1 AND snapshot_date = $2::date LIMIT 1`,
    [tenantId, snapshotDate]
  );
  return rows.length > 0;
}

module.exports = {
  buildPeriodSnapshotFromListing,
  hasPeriodSnapshot,
  memberSegmentFromCategory,
};
