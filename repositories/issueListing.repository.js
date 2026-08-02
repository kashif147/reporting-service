const { pool } = require("../db/postgres");

const LISTING_COLUMNS = [
  "tenant_id",
  "issue_id",
  "issue_type",
  "internal_reference_number",
  "case_file_number",
  "member_ids",
  "priority",
  "issue_status",
  "owner_team",
  "owner_user_id",
  "date_received",
  "date_resolved",
  "due_date",
  "resolution",
  "last_updated",
  "is_current",
  "last_event_id",
  "last_event_type",
];

async function upsertIssueListing(row) {
  const values = LISTING_COLUMNS.map((c) =>
    c === "member_ids" ? JSON.stringify(row[c] ?? []) : row[c] ?? null
  );
  const placeholders = LISTING_COLUMNS.map((c, i) =>
    c === "member_ids" ? `$${i + 1}::jsonb` : `$${i + 1}`
  ).join(", ");
  const updates = LISTING_COLUMNS.filter(
    (c) => c !== "tenant_id" && c !== "issue_id"
  )
    .map((c) => `${c} = EXCLUDED.${c}`)
    .join(", ");

  await pool.query(
    `INSERT INTO issue_listing (${LISTING_COLUMNS.join(", ")}, updated_at)
     VALUES (${placeholders}, NOW())
     ON CONFLICT (tenant_id, issue_id) DO UPDATE SET
       ${updates},
       updated_at = NOW()`,
    values
  );
}

module.exports = { upsertIssueListing };
