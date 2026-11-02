/**
 * Backfill reporting_db.gl_journal_entry from account-service GL.
 *
 * Usage:
 *   TENANT_ID=<24-hex tenant id> node scripts/sync-gl-journal-entries.js
 *   TENANT_ID=... ACCOUNT_SERVICE_URL=http://<account-service internal address> node scripts/sync-gl-journal-entries.js
 *
 * Auth: a genuine internal service-to-service call - `x-internal-request: true` plus an
 * explicit `x-tenant-id` and NOTHING else (no Authorization, no x-jwt-verified /
 * x-auth-source, no x-user-*). account-service admits that on
 * POST /api/reports/gl-journal-replication only when no user identity is present.
 * The SYNC_AUTH_TOKEN / INTERNAL_AUTH_TOKEN Bearer option and the self-asserted gateway
 * headers were removed: account-service rejects them (401 "Invalid gateway request"), and a
 * user token would make the call a user call, not an internal one.
 * Per the platform contract the public gateway strips x-internal-request, so ACCOUNT_SERVICE_URL must reach
 * account-service directly (internal network), not through the public gateway.
 */
require("dotenv").config({ path: ".env.staging" });
require("dotenv").config();
const axios = require("axios");

const TENANT_ID = process.env.TENANT_ID || process.env.DEFAULT_TENANT_ID;
const ACCOUNT_SERVICE_URL =
  process.env.ACCOUNT_SERVICE_URL ||
  "http://projectshell-vm.northeurope.cloudapp.azure.com/account-service";

const HEX_OBJECT_ID = /^[a-fA-F0-9]{24}$/;

/** Returns the trimmed tenant id, or throws if missing / not a 24-hex id. */
function validateTenantId(tenantId) {
  const t = tenantId == null ? "" : String(tenantId).trim();
  if (!t) throw new Error("TENANT_ID (or DEFAULT_TENANT_ID) is required");
  if (!HEX_OBJECT_ID.test(t)) throw new Error("TENANT_ID must be a 24-hex id");
  return t;
}

/** Exactly the internal S2S headers: no gateway, user or Authorization headers. */
function buildReplicationHeaders(tenantId) {
  return {
    "Content-Type": "application/json",
    "x-internal-request": "true",
    "x-tenant-id": validateTenantId(tenantId),
  };
}

async function fetchReplicationPage(cursor, tenantId = TENANT_ID, http = axios) {
  const base = ACCOUNT_SERVICE_URL.replace(/\/$/, "");
  const headers = buildReplicationHeaders(tenantId);

  const response = await http.post(
    `${base}/api/reports/gl-journal-replication`,
    { cursor, limit: 200 },
    { headers, timeout: 120000 },
  );
  return response.data?.data || response.data;
}

async function main() {
  let tenantId;
  try {
    tenantId = validateTenantId(TENANT_ID);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
  const { pool } = require("../db/postgres");
  const { upsertGlJournalLines } = require("../repositories/glJournalEntry.repository");

  console.log(`Backfilling gl_journal_entry for tenant ${tenantId}...`);

  let cursor = null;
  let totalLines = 0;
  let pages = 0;

  for (;;) {
    const page = await fetchReplicationPage(cursor, tenantId);
    const lines = Array.isArray(page?.lines) ? page.lines : [];
    if (lines.length) {
      const inserted = await upsertGlJournalLines(lines);
      totalLines += inserted;
    }
    pages += 1;
    console.log(
      `Page ${pages}: docs=${page?.documentCount ?? 0}, lines=${lines.length}, totalUpserted=${totalLines}`,
    );

    cursor = page?.nextCursor || null;
    if (!cursor) break;
  }

  console.log(`Done. Upserted ${totalLines} GL lines across ${pages} page(s).`);
  await pool.end();
}

if (require.main === module) {
  main().catch(async (err) => {
    console.error(err);
    try {
      const { pool } = require("../db/postgres");
      await pool.end();
    } catch (_) {
      /* ignore */
    }
    process.exit(1);
  });
}

module.exports = { validateTenantId, buildReplicationHeaders, fetchReplicationPage };
