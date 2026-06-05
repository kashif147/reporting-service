const { pool } = require("../db/postgres");
const { segmentFilterSql } = require("../lib/memberSegment");

const LISTING_COLUMNS = [
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
  "processed_at",
  "membership_category",
  "grade",
  "work_location",
  "branch",
  "region",
  "section",
  "payment_type",
  "payment_frequency",
  "subscription_year",
  "is_current",
  "member_segment",
  "last_event_id",
  "last_event_type",
];

async function upsertMembershipListing(row) {
  const values = LISTING_COLUMNS.map((c) => row[c] ?? null);
  const placeholders = LISTING_COLUMNS.map((_, i) => `$${i + 1}`).join(", ");
  const updates = LISTING_COLUMNS.filter(
    (c) => c !== "tenant_id" && c !== "subscription_id"
  )
    .map((c) => `${c} = EXCLUDED.${c}`)
    .join(", ");

  await pool.query(
    `INSERT INTO membership_listing (${LISTING_COLUMNS.join(", ")}, updated_at)
     VALUES (${placeholders}, NOW())
     ON CONFLICT (tenant_id, subscription_id) DO UPDATE SET
       ${updates},
       updated_at = NOW()`,
    values
  );
}

async function patchListingBySubscription(tenantId, subscriptionId, patch) {
  const sets = [];
  const params = [tenantId, subscriptionId];
  let i = 3;
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    sets.push(`${key} = $${i++}`);
    params.push(value);
  }
  if (!sets.length) return { rowCount: 0 };
  sets.push("updated_at = NOW()");
  const res = await pool.query(
    `UPDATE membership_listing SET ${sets.join(", ")}
     WHERE tenant_id = $1 AND subscription_id = $2`,
    params
  );
  return res;
}

async function patchListingByProfile(tenantId, profileId, patch) {
  const sets = [];
  const params = [tenantId, profileId];
  let i = 3;
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    sets.push(`${key} = $${i++}`);
    params.push(value);
  }
  if (!sets.length) return;
  sets.push("updated_at = NOW()");
  await pool.query(
    `UPDATE membership_listing SET ${sets.join(", ")}
     WHERE tenant_id = $1 AND profile_id = $2`,
    params
  );
}

const MOVEMENT_ALIASES = {
  "new joiners": "NewJoin",
  "new joiner": "NewJoin",
  "new join": "NewJoin",
  new: "NewJoin",
  newjoin: "NewJoin",
  "re-joiners": "Rejoin",
  rejoin: "Rejoin",
  "re-joiner": "Rejoin",
  "re-instated": "Reinstate",
  reinstate: "Reinstate",
  renewed: "Renewed",
};

const DATE_RANGE_FIELDS = {
  startDate: "start_date",
  expiryDate: "expiry_date",
  cancelledAt: "cancelled_at",
  resignedAt: "resigned_at",
  processedAt: "processed_at",
};

function normalizeMovements(movements) {
  if (!Array.isArray(movements) || !movements.length) return [];
  return movements.map((m) => {
    const key = String(m).trim().toLowerCase();
    return MOVEMENT_ALIASES[key] || m;
  });
}

async function queryMembershipListing(tenantId, filters = {}) {
  const {
    membershipStatuses = [],
    membershipMovements = [],
    membershipCategories = [],
    grades = [],
    workLocations = [],
    branches = [],
    regions = [],
    paymentTypes = [],
    paymentFrequencies = [],
    subscriptionYears = [],
    isCurrent,
    dateRange,
    search,
    limit = 500,
    offset = 0,
    includeStudents,
    includeHonorary,
  } = filters;

  const where = ["tenant_id = $1"];
  const params = [tenantId];
  let idx = 2;

  const seg = segmentFilterSql(
    { includeStudents: includeStudents === true, includeHonorary: includeHonorary === true },
    "member_segment",
    idx
  );
  if (seg.sql) {
    where.push(seg.sql);
    params.push(...seg.params);
    idx += seg.params.length;
  }

  const addAny = (column, values) => {
    if (!values?.length) return;
    where.push(`${column} = ANY($${idx++})`);
    params.push(values);
  };

  addAny("membership_status", membershipStatuses);
  addAny("membership_movement", normalizeMovements(membershipMovements));
  addAny("membership_category", membershipCategories);
  addAny("grade", grades);
  addAny("work_location", workLocations);
  addAny("branch", branches);
  addAny("region", regions);
  addAny("payment_type", paymentTypes);
  addAny("payment_frequency", paymentFrequencies);
  addAny("subscription_year", subscriptionYears);

  if (isCurrent === true || isCurrent === false) {
    where.push(`is_current = $${idx++}`);
    params.push(isCurrent);
  }

  if (dateRange?.field && dateRange.from && dateRange.to) {
    const col = DATE_RANGE_FIELDS[dateRange.field];
    if (col) {
      where.push(`${col}::date BETWEEN $${idx++}::date AND $${idx++}::date`);
      params.push(dateRange.from, dateRange.to);
    }
  }

  if (search && String(search).trim()) {
    const q = `%${String(search).trim()}%`;
    where.push(
      `(membership_number ILIKE $${idx} OR full_name ILIKE $${idx})`
    );
    params.push(q);
    idx++;
  }

  const whereSql = where.join(" AND ");
  const countRes = await pool.query(
    `SELECT COUNT(*)::int AS total FROM membership_listing WHERE ${whereSql}`,
    params
  );

  params.push(Math.min(Number(limit) || 500, 5000));
  params.push(Number(offset) || 0);

  const rowsRes = await pool.query(
    `SELECT
       subscription_id AS "subscriptionId",
       profile_id AS "profileId",
       membership_number AS "membershipNo",
       full_name AS "fullName",
       membership_status AS "membershipStatus",
       membership_movement AS "membershipMovement",
       start_date AS "startDate",
       expiry_date AS "expiryDate",
       cancelled_at AS "cancelledAt",
       resigned_at AS "resignedAt",
       processed_at AS "processedAt",
       membership_category AS "membershipCategory",
       grade,
       work_location AS "workLocation",
       branch,
       region,
       section,
       payment_type AS "paymentType",
       payment_frequency AS "paymentFrequency",
       subscription_year AS "subscriptionYear",
       is_current AS "isCurrent",
       updated_at AS "updatedAt"
     FROM membership_listing
     WHERE ${whereSql}
     ORDER BY membership_number NULLS LAST, start_date DESC
     LIMIT $${idx++} OFFSET $${idx}`,
    params
  );

  return {
    total: countRes.rows[0]?.total ?? 0,
    rows: rowsRes.rows,
    limit: Math.min(Number(limit) || 500, 5000),
    offset: Number(offset) || 0,
  };
}

module.exports = {
  upsertMembershipListing,
  patchListingBySubscription,
  patchListingByProfile,
  queryMembershipListing,
};
