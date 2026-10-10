#!/usr/bin/env node
/**
 * Sync work-location hierarchy + officers from user-service (HTTP API) into reporting PG.
 *
 * Usage:
 *   OPERATOR_BEARER_TOKEN=<CRM user JWT> node scripts/sync-location-lookups.js [--tenant=TENANT_ID]
 *
 * The tenant comes from the verified token (JWT_SECRET); --tenant / TENANT_ID, if given,
 * must match it. USER_SERVICE_URL (or POLICY_SERVICE_URL) selects the user-service base URL.
 * No user-service MongoDB access.
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const { syncLocationLookupsForRequest } = require("../services/locationLookupSync.service");
const { buildOperatorRequest } = require("./lib/operatorRequest");
const { pool } = require("../db/postgres");

async function main() {
  const tenantArg = process.argv.find((a) => a.startsWith("--tenant="));
  const requestedTenantId = tenantArg?.split("=")[1] || process.env.TENANT_ID || null;

  const req = buildOperatorRequest({ requestedTenantId });
  const result = await syncLocationLookupsForRequest(req);
  console.log(`Synced ${result.upserted} location lookup rows for tenant ${req.tenantId}`);
}

main()
  .catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end().catch(() => {}));
