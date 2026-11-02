// scripts/sync-gl-journal-entries.js calls account-service POST /api/reports/gl-journal-replication
// as a genuine internal S2S call: x-internal-request + an explicit, validated x-tenant-id, and NO
// gateway / user / Authorization headers. No network, no Postgres (http client is faked).
// Run: node --test --test-force-exit tests/syncGlJournalEntries.internal.test.js
const test = require("node:test");
const assert = require("node:assert/strict");

delete process.env.SYNC_AUTH_TOKEN;
delete process.env.INTERNAL_AUTH_TOKEN;
const script = require("../scripts/sync-gl-journal-entries");

const TENANT = "68cbf7806080b4621d469d34";
const FORBIDDEN = /^(authorization|x-jwt-verified|x-auth-source|x-user-.*|x-api-key)$/i;

test("buildReplicationHeaders: exactly the internal contract headers", () => {
  const h = script.buildReplicationHeaders(TENANT);
  assert.deepEqual(h, {
    "Content-Type": "application/json",
    "x-internal-request": "true",
    "x-tenant-id": TENANT,
  });
  for (const k of Object.keys(h)) assert.ok(!FORBIDDEN.test(k), `unexpected header ${k}`);
});

test("SYNC_AUTH_TOKEN / INTERNAL_AUTH_TOKEN no longer add a Bearer", () => {
  process.env.SYNC_AUTH_TOKEN = "should-not-be-sent";
  process.env.INTERNAL_AUTH_TOKEN = "should-not-be-sent";
  try {
    const h = script.buildReplicationHeaders(TENANT);
    assert.equal(Object.keys(h).some((k) => k.toLowerCase() === "authorization"), false);
  } finally {
    delete process.env.SYNC_AUTH_TOKEN;
    delete process.env.INTERNAL_AUTH_TOKEN;
  }
});

test("missing / malformed tenant is refused before any request", async () => {
  for (const bad of [undefined, null, "", "   "]) {
    assert.throws(() => script.validateTenantId(bad), /required/);
  }
  for (const bad of ["abc", "tenant-A", `${TENANT}0`, "zzzzzzzzzzzzzzzzzzzzzzzz", TENANT.slice(0, 23)]) {
    assert.throws(() => script.validateTenantId(bad), /24-hex/, String(bad));
    assert.throws(() => script.buildReplicationHeaders(bad), /24-hex/, String(bad));
  }
  assert.equal(script.validateTenantId(` ${TENANT} `), TENANT);

  let posted = 0;
  const http = { post: async () => { posted += 1; return { data: { data: {} } }; } };
  await assert.rejects(script.fetchReplicationPage(null, "", http), /required/);
  await assert.rejects(script.fetchReplicationPage(null, "not-a-tenant", http), /24-hex/);
  assert.equal(posted, 0, "no request may be sent without a valid tenant");
});

test("fetchReplicationPage posts to gl-journal-replication with only the internal headers", async () => {
  const calls = [];
  const http = {
    post: async (url, body, opts) => {
      calls.push({ url, body, opts });
      return { data: { data: { lines: [], nextCursor: null } } };
    },
  };
  const page = await script.fetchReplicationPage("c1", TENANT, http);
  assert.deepEqual(page, { lines: [], nextCursor: null });
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/api\/reports\/gl-journal-replication$/);
  assert.deepEqual(calls[0].body, { cursor: "c1", limit: 200 });
  assert.deepEqual(calls[0].opts.headers, {
    "Content-Type": "application/json",
    "x-internal-request": "true",
    "x-tenant-id": TENANT,
  });
});
