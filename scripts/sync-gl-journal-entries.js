/**
 * Backfill reporting_db.gl_journal_entry from account-service GL.
 *
 * Usage:
 *   TENANT_ID=... node scripts/sync-gl-journal-entries.js
 *   TENANT_ID=... ACCOUNT_SERVICE_URL=http://localhost/account-service node scripts/sync-gl-journal-entries.js
 */
require("dotenv").config({ path: ".env.staging" });
require("dotenv").config();
const axios = require("axios");
const { pool } = require("../db/postgres");
const { upsertGlJournalLines } = require("../repositories/glJournalEntry.repository");

const TENANT_ID = process.env.TENANT_ID || process.env.DEFAULT_TENANT_ID;
const ACCOUNT_SERVICE_URL =
  process.env.ACCOUNT_SERVICE_URL ||
  "http://projectshell-vm.northeurope.cloudapp.azure.com/account-service";
const AUTH_TOKEN = process.env.SYNC_AUTH_TOKEN || process.env.INTERNAL_AUTH_TOKEN;
const ACCOUNTS_API_KEY = process.env.ACCOUNTS_API_KEY || "";

async function fetchReplicationPage(cursor) {
  const base = ACCOUNT_SERVICE_URL.replace(/\/$/, "");
  const headers = {
    "Content-Type": "application/json",
    "x-tenant-id": TENANT_ID,
    "x-internal-request": "true",
    "x-jwt-verified": "true",
    "x-auth-source": "gateway",
  };
  if (AUTH_TOKEN) headers.Authorization = `Bearer ${AUTH_TOKEN}`;
  if (ACCOUNTS_API_KEY) headers["x-api-key"] = ACCOUNTS_API_KEY;

  const response = await axios.post(
    `${base}/api/reports/gl-journal-replication`,
    { cursor, limit: 200 },
    { headers, timeout: 120000 },
  );
  return response.data?.data || response.data;
}

async function main() {
  if (!TENANT_ID) {
    console.error("TENANT_ID (or DEFAULT_TENANT_ID) is required");
    process.exit(1);
  }

  console.log(`Backfilling gl_journal_entry for tenant ${TENANT_ID}...`);

  let cursor = null;
  let totalLines = 0;
  let pages = 0;

  for (;;) {
    const page = await fetchReplicationPage(cursor);
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

main().catch(async (err) => {
  console.error(err);
  try {
    await pool.end();
  } catch (_) {
    /* ignore */
  }
  process.exit(1);
});
