/**
 * Refresh reporting_db.reports.member_creditor for ONE tenant from account-service
 * POST /api/reports/creditors-list (GL credit balances as at a date). Manual, operator-run;
 * nothing schedules it. Does NOT run at report read time.
 *
 * Usage:
 *   TENANT_ID=<24-hex tenant id> node scripts/sync-member-creditors.js [asOf YYYY-MM-DD]
 *   TENANT_ID=... AS_OF=2026-12-31 ACCOUNT_SERVICE_URL=http://<account-service internal address> node scripts/sync-member-creditors.js
 *
 * Auth: a genuine internal service-to-service call - `x-internal-request: true` plus an
 * explicit 24-hex `x-tenant-id` and NOTHING else (no Authorization, no x-jwt-verified /
 * x-auth-source, no x-user-*). account-service admits that on POST /api/reports/creditors-list
 * only when no user identity is present. The public gateway strips x-internal-request, so
 * ACCOUNT_SERVICE_URL must reach account-service directly (internal network) and is required.
 *
 * Replacement is safe:
 *  1. every page is fetched first (offset/limit until `total`), for one fixed asOf date; the run
 *     aborts with NOTHING written if a page is malformed, `total`/`asOfDate` change between pages,
 *     a memberId repeats, or the collected count differs from `total`;
 *  2. then ONE Postgres transaction upserts every snapshot row and deletes only this tenant's rows
 *     that are not in the snapshot; any error rolls the whole refresh back, so the table is never
 *     left empty or partial.
 * account-service returns only { memberId, amountCents }: `cause` / `refund_processed` /
 * `full_name` already on a row (from MEMBER_CREDIT_UPDATED ingestion) are kept; a new row gets
 * the table defaults ("Overpayment", false). `subscription_year` is the asOf year.
 * Output: counts only.
 */
require("dotenv").config();
const axios = require("axios");

const HEX_OBJECT_ID = /^[a-fA-F0-9]{24}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const PAGE_LIMIT = 5000;
const MAX_PAGES = 1000;

/** Returns the trimmed tenant id, or throws if missing / not a 24-hex id. */
function validateTenantId(tenantId) {
  const t = tenantId == null ? "" : String(tenantId).trim();
  if (!t) throw new Error("TENANT_ID is required (env or first arg)");
  if (!HEX_OBJECT_ID.test(t)) throw new Error("TENANT_ID must be a 24-hex id");
  return t;
}

/** asOf defaults to today (UTC); otherwise must be YYYY-MM-DD. */
function resolveAsOf(asOf, now = new Date()) {
  const raw = asOf == null ? "" : String(asOf).trim();
  if (!raw) return now.toISOString().slice(0, 10);
  if (!ISO_DATE.test(raw) || Number.isNaN(new Date(`${raw}T00:00:00Z`).getTime())) {
    throw new Error("asOf must be YYYY-MM-DD");
  }
  return raw;
}

function requireAccountServiceUrl(url) {
  const u = url == null ? "" : String(url).trim();
  if (!u) throw new Error("ACCOUNT_SERVICE_URL is required (account-service internal address)");
  return u.replace(/\/$/, "");
}

/** Exactly the internal S2S headers: no gateway, user or Authorization headers. */
function buildCreditorsHeaders(tenantId) {
  return {
    "Content-Type": "application/json",
    "x-internal-request": "true",
    "x-tenant-id": validateTenantId(tenantId),
  };
}

/**
 * Fetch the full creditors snapshot (all pages) for one tenant and asOf date.
 * Throws (nothing to write) on any inconsistency.
 */
async function fetchCreditorsSnapshot({ baseUrl, tenantId, asOf, http = axios, pageLimit = PAGE_LIMIT }) {
  const url = `${requireAccountServiceUrl(baseUrl)}/api/reports/creditors-list`;
  const headers = buildCreditorsHeaders(tenantId);
  const rows = [];
  const seen = new Set();
  let total = null;
  let asOfDate = null;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const response = await http.post(
      url,
      { asOf, offset: rows.length, limit: pageLimit },
      { headers, timeout: 120000, validateStatus: (s) => s < 600 },
    );
    if (response.status >= 400) {
      throw new Error(
        `account-service creditors-list returned ${response.status}` +
          (response.data?.code || response.data?.error?.code ? ` ${response.data?.code || response.data?.error?.code}` : ""),
      );
    }
    const data = response.data?.data ?? response.data;
    if (!data || !Array.isArray(data.rows) || !Number.isInteger(data.total) || data.total < 0) {
      throw new Error("creditors-list response is malformed");
    }
    if (total == null) {
      total = data.total;
      asOfDate = data.asOfDate;
      if (asOfDate !== asOf) throw new Error("creditors-list asOfDate does not match the requested asOf");
    } else if (data.total !== total || data.asOfDate !== asOfDate) {
      throw new Error("creditors-list total/asOf changed between pages; aborting without writing");
    }
    for (const row of data.rows) {
      const memberId = String(row?.memberId ?? "").trim();
      const amountCents = Number(row?.amountCents);
      if (!memberId || !Number.isInteger(amountCents) || amountCents <= 0) {
        throw new Error("creditors-list returned an invalid row");
      }
      if (seen.has(memberId)) throw new Error("creditors-list returned a duplicate memberId across pages");
      seen.add(memberId);
      rows.push({ memberId, amountCents });
    }
    if (rows.length >= total || data.rows.length === 0) break;
  }
  if (total == null || rows.length !== total) {
    throw new Error(`creditors-list paging incomplete (${rows.length} of ${total})`);
  }
  return { asOfDate, total, rows };
}

/**
 * Replace this tenant's member_creditor rows with the snapshot inside ONE transaction.
 * `client` is a checked-out pg client (pool.connect()).
 */
async function replaceTenantCreditors(client, { tenantId, asOfDate, rows }) {
  const tid = validateTenantId(tenantId);
  const year = Number(String(asOfDate).slice(0, 4)) || null;
  const ids = rows.map((r) => r.memberId);
  const amounts = rows.map((r) => r.amountCents);
  await client.query("BEGIN");
  try {
    const up = await client.query(
      `INSERT INTO reports.member_creditor (
         tenant_id, membership_number, amount_cents, cause, refund_processed,
         subscription_year, last_event_type, updated_at
       )
       SELECT $1, s.membership_number, s.amount_cents, 'Overpayment', false, $4, 'sync-member-creditors', NOW()
       FROM unnest($2::text[], $3::int[]) AS s(membership_number, amount_cents)
       ON CONFLICT (tenant_id, membership_number) DO UPDATE SET
         amount_cents = EXCLUDED.amount_cents,
         subscription_year = EXCLUDED.subscription_year,
         last_event_type = EXCLUDED.last_event_type,
         updated_at = NOW()`,
      [tid, ids, amounts, year],
    );
    const del = await client.query(
      `DELETE FROM reports.member_creditor
       WHERE tenant_id = $1 AND NOT (membership_number = ANY($2::text[]))`,
      [tid, ids],
    );
    await client.query("COMMIT");
    return { upserted: up.rowCount, deleted: del.rowCount };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
}

async function syncMemberCreditors({ tenantId, asOf, baseUrl, pool, http = axios, log = () => {} }) {
  const tid = validateTenantId(tenantId);
  const asOfDate = resolveAsOf(asOf);
  const snapshot = await fetchCreditorsSnapshot({ baseUrl, tenantId: tid, asOf: asOfDate, http });
  log(`snapshot asOf=${snapshot.asOfDate} creditors=${snapshot.total}`);
  const client = await pool.connect();
  try {
    const result = await replaceTenantCreditors(client, { tenantId: tid, asOfDate: snapshot.asOfDate, rows: snapshot.rows });
    log(`committed upserted=${result.upserted} deleted=${result.deleted}`);
    return { ...result, total: snapshot.total, asOfDate: snapshot.asOfDate };
  } finally {
    client.release();
  }
}

if (require.main === module) {
  (async () => {
    const { pool } = require("../db/postgres");
    try {
      await syncMemberCreditors({
        tenantId: process.env.TENANT_ID || process.argv[2],
        asOf: process.env.AS_OF || process.argv[3],
        baseUrl: process.env.ACCOUNT_SERVICE_URL,
        pool,
        log: (l) => console.log(`[sync-member-creditors] ${l}`),
      });
    } finally {
      await pool.end();
    }
  })().catch((err) => {
    console.error(`[sync-member-creditors] FAILED (nothing committed): ${err.message || err}`);
    process.exit(1);
  });
}

module.exports = {
  validateTenantId,
  resolveAsOf,
  buildCreditorsHeaders,
  fetchCreditorsSnapshot,
  replaceTenantCreditors,
  syncMemberCreditors,
};
