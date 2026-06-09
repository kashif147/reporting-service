const { pool } = require("../db/postgres");

function centsToEuro(amountCents) {
  const cents = Number(amountCents) || 0;
  return Math.round((cents / 100) * 100) / 100;
}

async function resolveFullNameFromListing(tenantId, membershipNumber) {
  if (!tenantId || !membershipNumber) return null;
  const res = await pool.query(
    `SELECT full_name
     FROM membership_listing
     WHERE tenant_id = $1 AND membership_number = $2
     ORDER BY updated_at DESC NULLS LAST
     LIMIT 1`,
    [tenantId, membershipNumber],
  );
  return res.rows[0]?.full_name || null;
}

/**
 * Upsert a creditor row from an accounts event or backfill.
 */
async function upsertMemberCreditor(row) {
  const tenantId = String(row.tenant_id || row.tenantId || "").trim();
  const membershipNumber = String(
    row.membership_number || row.membershipNumber || row.memberId || "",
  ).trim();
  if (!tenantId || !membershipNumber) return;

  const amountCents = Math.max(0, Math.floor(Number(row.amount_cents ?? row.amountCents) || 0));
  if (amountCents <= 0) {
    await deleteMemberCreditor(tenantId, membershipNumber);
    return;
  }

  let fullName =
    row.full_name || row.fullName || null;
  if (!fullName) {
    fullName = await resolveFullNameFromListing(tenantId, membershipNumber);
  }

  await pool.query(
    `INSERT INTO member_creditor (
       tenant_id, membership_number, full_name, amount_cents, cause,
       refund_processed, subscription_year, last_event_id, last_event_type, updated_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
     ON CONFLICT (tenant_id, membership_number) DO UPDATE SET
       full_name = COALESCE(EXCLUDED.full_name, member_creditor.full_name),
       amount_cents = EXCLUDED.amount_cents,
       cause = EXCLUDED.cause,
       refund_processed = EXCLUDED.refund_processed,
       subscription_year = COALESCE(EXCLUDED.subscription_year, member_creditor.subscription_year),
       last_event_id = EXCLUDED.last_event_id,
       last_event_type = EXCLUDED.last_event_type,
       updated_at = NOW()`,
    [
      tenantId,
      membershipNumber,
      fullName,
      amountCents,
      String(row.cause || "Overpayment"),
      Boolean(row.refund_processed ?? row.refundProcessed),
      row.subscription_year ?? row.subscriptionYear ?? null,
      row.last_event_id || row.lastEventId || null,
      row.last_event_type || row.lastEventType || null,
    ],
  );
}

async function deleteMemberCreditor(tenantId, membershipNumber) {
  const tid = String(tenantId || "").trim();
  const mid = String(membershipNumber || "").trim();
  if (!tid || !mid) return;
  await pool.query(
    `DELETE FROM member_creditor WHERE tenant_id = $1 AND membership_number = $2`,
    [tid, mid],
  );
}

async function queryMemberCreditors(tenantId, filters = {}) {
  const {
    offset = 0,
    limit = 5000,
    search,
    causes = [],
    refundProcessed = [],
  } = filters;

  const where = ["c.tenant_id = $1", "c.amount_cents > 0"];
  const params = [tenantId];
  let idx = 2;

  if (Array.isArray(causes) && causes.length) {
    where.push(`c.cause = ANY($${idx++})`);
    params.push(causes.map((c) => String(c).trim()).filter(Boolean));
  }

  if (Array.isArray(refundProcessed) && refundProcessed.length) {
    const wantsYes = refundProcessed.some(
      (v) => String(v).trim().toLowerCase() === "yes",
    );
    const wantsNo = refundProcessed.some(
      (v) => String(v).trim().toLowerCase() === "no",
    );
    if (wantsYes && !wantsNo) {
      where.push("c.refund_processed = true");
    } else if (wantsNo && !wantsYes) {
      where.push("c.refund_processed = false");
    }
  }

  const searchTerm = String(search ?? "").trim();
  if (searchTerm) {
    where.push(
      `(c.membership_number ILIKE $${idx} OR COALESCE(c.full_name, '') ILIKE $${idx})`,
    );
    params.push(`%${searchTerm}%`);
    idx++;
  }

  const whereSql = where.join(" AND ");
  const countRes = await pool.query(
    `SELECT COUNT(*)::int AS total FROM member_creditor c WHERE ${whereSql}`,
    params,
  );

  const safeLimit = Math.min(Math.max(1, Number(limit) || 5000), 5000);
  const safeOffset = Math.max(0, Number(offset) || 0);
  params.push(safeLimit);
  params.push(safeOffset);

  const rowsRes = await pool.query(
    `SELECT
       c.membership_number AS "membershipNo",
       COALESCE(c.full_name, ml.full_name) AS "fullName",
       c.amount_cents AS "amountCents",
       c.cause,
       c.refund_processed AS "refundProcessed",
       c.subscription_year AS "subscriptionYear",
       c.updated_at AS "updatedAt"
     FROM member_creditor c
     LEFT JOIN LATERAL (
       SELECT full_name
       FROM membership_listing ml
       WHERE ml.tenant_id = c.tenant_id
         AND ml.membership_number = c.membership_number
       ORDER BY ml.updated_at DESC NULLS LAST
       LIMIT 1
     ) ml ON true
     WHERE ${whereSql}
     ORDER BY c.membership_number NULLS LAST, c.amount_cents DESC
     LIMIT $${idx++} OFFSET $${idx}`,
    params,
  );

  const rows = (rowsRes.rows || []).map((row, index) => ({
    id: row.membershipNo || `creditor-${index}`,
    memberId: row.membershipNo,
    membershipNo: row.membershipNo || "—",
    fullName: row.fullName || "—",
    amount: centsToEuro(row.amountCents),
    cause: row.cause || "—",
    refundProcessed: Boolean(row.refundProcessed),
    refundProcessedLabel: row.refundProcessed ? "Yes" : "No",
  }));

  return {
    rows,
    total: countRes.rows[0]?.total ?? rows.length,
    offset: safeOffset,
    limit: safeLimit,
  };
}

async function lookupMemberNamesByMembershipNumbers(tenantId, membershipNumbers) {
  const ids = [
    ...new Set(
      (membershipNumbers || [])
        .map((id) => String(id || "").trim())
        .filter(Boolean),
    ),
  ];
  const map = new Map();
  if (!tenantId || !ids.length) return map;

  const res = await pool.query(
    `SELECT DISTINCT ON (membership_number)
       membership_number,
       full_name,
       full_address,
       grade,
       work_location
     FROM membership_listing
     WHERE tenant_id = $1
       AND membership_number = ANY($2)
     ORDER BY membership_number, is_current DESC, updated_at DESC NULLS LAST`,
    [tenantId, ids],
  );

  for (const row of res.rows || []) {
    const key = String(row.membership_number || "").trim();
    if (!key) continue;
    map.set(key, {
      membershipNo: key,
      fullName: row.full_name || null,
      fullAddress: row.full_address || null,
      grade: row.grade || null,
      workLocation: row.work_location || null,
    });
  }

  return map;
}

module.exports = {
  lookupMemberNamesByMembershipNumbers,
  resolveFullNameFromListing,
  upsertMemberCreditor,
  deleteMemberCreditor,
  queryMemberCreditors,
};
