#!/usr/bin/env node
/**
 * Sync work-location officers from user-service MongoDB into reporting PG.
 * Usage: node scripts/sync-location-lookups.js [--tenant=TENANT_ID]
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const {
  syncLocationLookupsForTenant,
  closeUserServiceMongoConnection,
} = require("../services/locationLookupSync.service");

async function main() {
  const tenantArg = process.argv.find((a) => a.startsWith("--tenant="));
  const tenantId =
    tenantArg?.split("=")[1] ||
    process.env.DEFAULT_TENANT_ID ||
    process.env.TENANT_ID;

  if (!tenantId) {
    console.error("Tenant required: --tenant=ID or DEFAULT_TENANT_ID env");
    process.exit(1);
  }

  const result = await syncLocationLookupsForTenant(tenantId, { forScript: true });
  console.log(`Synced ${result.upserted} location lookup rows for tenant ${tenantId}`);
  await closeUserServiceMongoConnection();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
