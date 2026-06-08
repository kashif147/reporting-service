/**
 * One-off / scheduled ETL: populate reporting_db.member_creditor from account-service.
 * Does NOT run at report read time — use after migration or to refresh warehouse data.
 *
 * Usage:
 *   TENANT_ID=... node scripts/sync-member-creditors.js
 *   TENANT_ID=... ACCOUNT_SERVICE_URL=http://localhost/account-service node scripts/sync-member-creditors.js
 */
require("dotenv").config();
const axios = require("axios");
const { pool } = require("../db/postgres");
const {
  upsertMemberCreditor,
  deleteMemberCreditor,
} = require("../repositories/memberCreditor.repository");

const TENANT_ID = process.env.TENANT_ID || process.argv[2];
const ACCOUNT_SERVICE_URL =
  process.env.ACCOUNT_SERVICE_URL ||
  "http://projectshell-vm.northeurope.cloudapp.azure.com/account-service";

async function fetchCreditorsFromAccountService(tenantId) {
  const base = ACCOUNT_SERVICE_URL.replace(/\/$/, "");
  const url = `${base}/api/reports/creditors-list`;
  const response = await axios.post(
    url,
    { offset: 0, limit: 5000 },
    {
      headers: {
        "Content-Type": "application/json",
        "x-tenant-id": tenantId,
        "x-internal-request": "true",
      },
      timeout: 120000,
      validateStatus: (s) => s < 500,
    },
  );
  if (response.status >= 400) {
    throw new Error(
      response.data?.message ||
        response.data?.error?.message ||
        `Account service returned ${response.status}`,
    );
  }
  return response.data?.data || response.data;
}

async function main() {
  if (!TENANT_ID) {
    console.error("TENANT_ID required (env or first arg)");
    process.exit(1);
  }

  console.log(`Syncing member_creditor for tenant ${TENANT_ID}...`);
  const data = await fetchCreditorsFromAccountService(TENANT_ID);
  const rows = Array.isArray(data?.rows) ? data.rows : [];

  await pool.query(`DELETE FROM member_creditor WHERE tenant_id = $1`, [
    TENANT_ID,
  ]);

  let upserted = 0;
  for (const row of rows) {
    const memberId = String(row.memberId || "").trim();
    if (!memberId) continue;
    await upsertMemberCreditor({
      tenant_id: TENANT_ID,
      membership_number: memberId,
      amount_cents: row.amountCents,
      cause: row.cause,
      refund_processed: row.refundProcessed,
      subscription_year: data.year ?? null,
      last_event_type: "sync-member-creditors",
    });
    upserted += 1;
  }

  console.log(`Done. Upserted ${upserted} creditor row(s).`);
  await pool.end();
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
