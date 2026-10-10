"use strict";
// Phase 2B Stream 3B — reporting-service: user-service lookup sync over HTTP (no
// cross-service Mongo), tenant A/B isolation of membership_location_lookup writes,
// officer data minimisation, legacy /dashboard/* removal, report routes still mounted,
// verified Bearer fallback.
// Native node:test. Run: node --test tests/locationLookupSync.http.test.js
const os = require("os");
const path = require("path");
const fs = require("fs");
process.env.LOG_ROOT =
  process.env.LOG_ROOT || fs.mkdtempSync(path.join(os.tmpdir(), "rep-lookupsync-"));
process.env.NODE_ENV = process.env.NODE_ENV || "test";
process.env.JWT_SECRET = "test-secret-reporting-3b";
process.env.USER_SERVICE_URL = "http://user-service.test:5001";
process.env.ENABLE_REPORTING_CRON = "false";
delete process.env.USER_SERVICE_MONGO_URI;
delete process.env.USER_SERVICE_MONGODB_URI;

const test = require("node:test");
const assert = require("node:assert");
const http = require("http");
const jwt = require("jsonwebtoken");

const ROOT = path.join(__dirname, "..");
const TENANT_A = "aaaaaaaaaaaaaaaaaaaaaaaa";
const TENANT_B = "bbbbbbbbbbbbbbbbbbbbbbbb";
const OFFICER_EMAIL = "officer.secret@example.test";

// ---------------------------------------------------------------- mongoose spy
const mongoose = require("mongoose");
const mongoCalls = [];
const origCreateConnection = mongoose.createConnection;
const origConnect = mongoose.connect;
mongoose.createConnection = (...args) => {
  mongoCalls.push(["createConnection", args[0]]);
  throw new Error("mongoose.createConnection must not be called by lookup sync");
};
mongoose.connect = (...args) => {
  mongoCalls.push(["connect", args[0]]);
  return Promise.reject(new Error("mongoose.connect must not be called in tests"));
};

// ------------------------------------------------------------- fake Postgres
// Real repositories run against this fake pool; membership_location_lookup is an
// in-memory table keyed by (tenant_id, work_location).
const lookupTable = new Map();
const pgQueries = [];
function rowsForTenant(tenantId) {
  return [...lookupTable.values()].filter((r) => r.tenant_id === tenantId);
}
const fakePool = {
  query: async (sql, params = []) => {
    pgQueries.push(sql);
    if (/INSERT INTO membership_location_lookup/.test(sql)) {
      const [tenant_id, work_location, branch, region, lookup_id, officer_user_id,
        officer_initials, officer_display_name, branch_officer_user_id,
        region_officer_user_id] = params;
      lookupTable.set(`${tenant_id}|${work_location}`, {
        tenant_id, work_location, branch, region, lookup_id, officer_user_id,
        officer_initials, officer_display_name, branch_officer_user_id,
        region_officer_user_id,
      });
      return { rows: [], rowCount: 1 };
    }
    if (/COUNT\(\*\)::int AS count FROM membership_location_lookup/.test(sql)) {
      return { rows: [{ count: rowsForTenant(params[0]).length }] };
    }
    if (/FROM membership_location_lookup/.test(sql)) {
      return { rows: rowsForTenant(params[0]).map(({ tenant_id, ...r }) => r) };
    }
    return { rows: [], rowCount: 0 };
  },
  on: () => {},
  end: async () => {},
};
const pgPath = require.resolve(path.join(ROOT, "db", "postgres.js"));
require.cache[pgPath] = {
  id: pgPath, filename: pgPath, loaded: true,
  exports: { pool: fakePool, testConnection: async () => {} },
};

// -------------------------------------------------------- fake policy (PDP)
// "pass" → next(); "marker" → 299 with the resource/action (proves the route is mounted).
let policyMode = "pass";
const policyPath = require.resolve(path.join(ROOT, "middlewares", "policy.middleware.js"));
const fakePolicy = {
  requirePermission: (resource, action) => (req, res, next) =>
    policyMode === "marker"
      ? res.status(299).json({ mounted: true, resource, action })
      : next(),
};
require.cache[policyPath] = {
  id: policyPath, filename: policyPath, loaded: true,
  exports: Object.assign(fakePolicy, { defaultPolicyMiddleware: fakePolicy }),
};

// ------------------------------------------------------ fake user-service (axios)
const axiosCalls = [];
let userServiceFailStatus = null;
const TYPES = [
  { _id: "t-region", code: "REGION", lookuptype: "Region", isdeleted: false },
  { _id: "t-branch", code: "BRANCH", lookuptype: "Branch", isdeleted: false },
  { _id: "t-wl", code: "WORKLOC", lookuptype: "Work Location", isdeleted: false },
  { _id: "t-old", code: "WORKLOC", lookuptype: "Work Location", isdeleted: true },
];
const officer = (id, first, last) => ({
  _id: id, userEmail: OFFICER_EMAIL, userFirstName: first, userLastName: last,
  userFullName: `${first} ${last}`,
});
const BY_TYPE = {
  "t-region": [{ lookup: { _id: "r1", lookupname: "North", Parentlookupid: null, officer: officer("u-r", "Rita", "Region") }, hierarchy: [] }],
  "t-branch": [{ lookup: { _id: "b1", lookupname: "Branch One", Parentlookupid: "r1", officer: officer("u-b", "Ben", "Branch") }, hierarchy: [] }],
  "t-wl": [
    { lookup: { _id: "w1", DisplayName: "St Mary's", lookupname: "stmary", Parentlookupid: { _id: "b1" }, officer: officer("u-w", "Olive", "Officer") }, hierarchy: [] },
    { lookup: { _id: "w2", lookupname: "Clinic Two", Parentlookupid: "b1", officer: null }, hierarchy: [] },
  ],
};
const axiosPath = require.resolve("axios");
const fakeAxios = {
  get: async (url, config = {}) => {
    axiosCalls.push({ url, headers: { ...(config.headers || {}) }, params: config.params });
    if (userServiceFailStatus) return { status: userServiceFailStatus, data: { error: "x" } };
    if (url.endsWith("/api/lookuptype")) return { status: 200, data: TYPES };
    const m = url.match(/\/api\/lookup\/by-type\/([^/]+)\/hierarchy$/);
    if (m) return { status: 200, data: { totalCount: 0, results: BY_TYPE[decodeURIComponent(m[1])] || [] } };
    return { status: 404, data: {} };
  },
  post: async () => ({ status: 404, data: {} }),
};
require.cache[axiosPath] = { id: axiosPath, filename: axiosPath, loaded: true, exports: fakeAxios };

const sync = require("../services/locationLookupSync.service");
const app = require("../app");

function reset() {
  lookupTable.clear();
  axiosCalls.length = 0;
  pgQueries.length = 0;
  userServiceFailStatus = null;
  policyMode = "pass";
}
function bearerReq(tenantId, extra = {}) {
  return {
    headers: { authorization: `Bearer tok-${tenantId}` },
    tenantId,
    ctx: { tenantId },
    ...extra,
  };
}
function gatewayHeaders(tenantId, userId = "U1") {
  return {
    "x-jwt-verified": "true",
    "x-auth-source": "gateway",
    "x-user-id": userId,
    "x-tenant-id": tenantId,
    "x-user-email": "caller@example.test",
    "x-user-roles": "[]",
    "x-user-permissions": "[]",
    authorization: `Bearer gw-${tenantId}`,
  };
}

let server;
let baseUrl;
test.before(async () => {
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => {
  await new Promise((r) => server.close(r));
  mongoose.createConnection = origCreateConnection;
  mongoose.connect = origConnect;
});

async function call(method, urlPath, { headers = {}, body } = {}) {
  const res = await fetch(baseUrl + urlPath, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, json };
}

// ------------------------------------------------------------------ static
test("S1 sync service + client never import mongoose or read a user-service Mongo URI", () => {
  for (const rel of ["services/locationLookupSync.service.js", "lib/userServiceClient.js",
    "scripts/sync-location-lookups.js", "scripts/lib/loadSeedLookups.js", "scripts/lib/operatorRequest.js"]) {
    const src = fs.readFileSync(path.join(ROOT, rel), "utf8");
    assert.ok(!/require\(["']mongoose["']\)/.test(src), `${rel} must not require mongoose`);
    assert.ok(!/createConnection/.test(src), `${rel} must not call createConnection`);
    assert.ok(!/USER_SERVICE_MONGO(DB)?_URI/.test(src), `${rel} must not use USER_SERVICE_MONGO_URI`);
  }
  assert.ok(!fs.existsSync(path.join(ROOT, "scripts/lib/mongoLookupModels.js")));
});

test("S2 no runtime/script file references USER_SERVICE_MONGO_URI or loads user-service .env", () => {
  const offenders = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (["node_modules", ".git", "logs", "backups", "tests"].includes(e.name)) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(js|cjs|mjs)$/.test(e.name)) {
        const s = fs.readFileSync(p, "utf8");
        if (/USER_SERVICE_MONGO(DB)?_URI/.test(s) || /user-service["'],\s*["']\.env/.test(s)) offenders.push(p);
      }
    }
  };
  walk(ROOT);
  assert.deepStrictEqual(offenders, []);
});

// --------------------------------------------------------------- sync unit
test("U1 sync uses HTTP with forwarded identity + trusted tenant; no Mongo connection", async () => {
  reset();
  const req = bearerReq(TENANT_A);
  req.headers["x-tenant-id"] = TENANT_B; // spoofed inbound header must not be forwarded
  const out = await sync.syncLocationLookupsForRequest(req);
  assert.equal(out.upserted, 2);
  assert.ok(axiosCalls.length >= 4);
  assert.ok(axiosCalls[0].url.startsWith("http://user-service.test:5001/api/lookuptype"));
  for (const c of axiosCalls) {
    assert.equal(c.headers.authorization, `Bearer tok-${TENANT_A}`);
    assert.equal(c.headers["x-tenant-id"], TENANT_A);
    assert.equal(c.headers["x-internal-request"], undefined);
    assert.equal(c.headers["x-api-key"], undefined);
  }
  assert.ok(axiosCalls.some((c) => /\/api\/lookup\/by-type\/t-wl\/hierarchy$/.test(c.url)));
  assert.ok(!axiosCalls.some((c) => /t-old/.test(c.url)), "deleted lookup type ignored");
  assert.deepStrictEqual(mongoCalls, []);
});

test("U2 hierarchy, officer initials/display name resolved; officer email never persisted", async () => {
  reset();
  await sync.syncLocationLookupsForRequest(bearerReq(TENANT_A));
  const row = lookupTable.get(`${TENANT_A}|St Mary's`);
  assert.equal(row.branch, "Branch One");
  assert.equal(row.region, "North");
  assert.equal(row.lookup_id, "w1");
  assert.equal(row.officer_user_id, "u-w");
  assert.equal(row.officer_initials, "OO");
  assert.equal(row.officer_display_name, "Olive Officer");
  assert.equal(row.branch_officer_user_id, "u-b");
  assert.equal(row.region_officer_user_id, "u-r");
  const row2 = lookupTable.get(`${TENANT_A}|Clinic Two`);
  assert.equal(row2.officer_user_id, null);
  assert.ok(!JSON.stringify([...lookupTable.values()]).includes(OFFICER_EMAIL));
  assert.ok(!JSON.stringify([...lookupTable.values()]).toLowerCase().includes("email"));
});

test("A/B-1 tenant A sync writes only tenant A rows", async () => {
  reset();
  await sync.syncLocationLookupsForRequest(bearerReq(TENANT_A));
  const tenants = new Set([...lookupTable.values()].map((r) => r.tenant_id));
  assert.deepStrictEqual([...tenants], [TENANT_A]);
});

test("A/B-2 tenant B request with A in body/query/header cannot write A rows", async () => {
  reset();
  const req = bearerReq(TENANT_B, { body: { tenantId: TENANT_A }, query: { tenantId: TENANT_A } });
  req.headers["x-tenant-id"] = TENANT_A;
  await sync.syncLocationLookupsForRequest(req);
  assert.equal(rowsForTenant(TENANT_A).length, 0);
  assert.equal(rowsForTenant(TENANT_B).length, 2);
  for (const c of axiosCalls) assert.equal(c.headers["x-tenant-id"], TENANT_B);
});

test("A/B-3 ctx/tenantId disagreement or missing tenant/identity → rejected, nothing written", async () => {
  reset();
  await assert.rejects(sync.syncLocationLookupsForRequest({
    headers: { authorization: "Bearer t" }, tenantId: TENANT_A, ctx: { tenantId: TENANT_B },
  }));
  await assert.rejects(sync.syncLocationLookupsForRequest({ headers: { authorization: "Bearer t" } }));
  await assert.rejects(sync.syncLocationLookupsForRequest({ headers: {}, tenantId: TENANT_A, ctx: { tenantId: TENANT_A } }));
  assert.equal(lookupTable.size, 0);
  assert.equal(axiosCalls.length, 0);
});

test("U3 user-service 403 → sync throws, nothing written", async () => {
  reset();
  userServiceFailStatus = 403;
  await assert.rejects(sync.syncLocationLookupsForRequest(bearerReq(TENANT_A)), (e) => e.upstreamStatus === 403);
  assert.equal(lookupTable.size, 0);
});

// ------------------------------------------------------- HTTP through app
test("H1 POST workplace-breakdown (tenant B, body tenant A, syncLookups) syncs only B; forwards identity; no email in output", async () => {
  reset();
  const r = await call("POST", "/api/reports/membership/workplace-breakdown", {
    headers: gatewayHeaders(TENANT_B),
    body: { tenantId: TENANT_A, syncLookups: true, includeEmptyRows: true },
  });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(rowsForTenant(TENANT_A).length, 0);
  assert.equal(rowsForTenant(TENANT_B).length, 2);
  for (const c of axiosCalls) {
    assert.equal(c.headers["x-tenant-id"], TENANT_B);
    assert.equal(c.headers["x-jwt-verified"], "true");
    assert.equal(c.headers["x-user-id"], "U1");
    assert.equal(c.headers.authorization, `Bearer gw-${TENANT_B}`);
  }
  const text = JSON.stringify(r.json);
  assert.ok(text.includes("Olive Officer"));
  assert.ok(!text.includes(OFFICER_EMAIL));
  assert.deepStrictEqual(mongoCalls, []);
  assert.ok(pgQueries.filter((q) => /membership_location_lookup/.test(q)).length > 0);
});

test("H2 tenant A report output only shows tenant A lookups after B synced", async () => {
  reset();
  await sync.syncLocationLookupsForRequest(bearerReq(TENANT_B));
  lookupTable.set(`${TENANT_A}|Only A`, {
    tenant_id: TENANT_A, work_location: "Only A", branch: "BA", region: "RA",
    lookup_id: "x", officer_user_id: null, officer_initials: null, officer_display_name: null,
    branch_officer_user_id: null, region_officer_user_id: null,
  });
  axiosCalls.length = 0;
  const r = await call("POST", "/api/reports/membership/workplace-breakdown", {
    headers: gatewayHeaders(TENANT_A), body: { includeEmptyRows: true },
  });
  assert.equal(r.status, 200);
  const text = JSON.stringify(r.json);
  assert.ok(text.includes("Only A"));
  assert.ok(!text.includes("St Mary's"), "tenant B rows must not appear in tenant A output");
  assert.equal(axiosCalls.length, 0, "A already has rows → no sync");
});

test("H3 user-service failure → report still 200 with a generic note (no upstream detail)", async () => {
  reset();
  userServiceFailStatus = 403;
  const r = await call("POST", "/api/reports/membership/workplace-breakdown", {
    headers: gatewayHeaders(TENANT_A), body: { syncLookups: true },
  });
  assert.equal(r.status, 200);
  const text = JSON.stringify(r.json);
  assert.ok(/lookup sync failed/i.test(text));
  assert.ok(!/USER_SERVICE_MONGO_URI/.test(text));
  assert.equal(lookupTable.size, 0);
});

const LEGACY = ["overview", "trends", "joiners", "leavers", "net", "categories", "grades", "sections", "workplaces", "regions"];
test("D1 removed legacy /dashboard/* GET routes return 404 (both mounts), even with permission", async () => {
  reset();
  policyMode = "marker";
  for (const prefix of ["/api/dashboard", "/dashboard"]) {
    for (const name of LEGACY) {
      const r = await call("GET", `${prefix}/${name}`, { headers: gatewayHeaders(TENANT_A) });
      assert.equal(r.status, 404, `${prefix}/${name} → ${r.status}`);
    }
  }
  assert.ok(!fs.existsSync(path.join(ROOT, "services", "dashboard.service.js")));
  const ctrl = require("../controllers/dashboard.controller");
  for (const fn of ["getOverview", "getTrends", "getJoiners", "getLeavers", "getNetChange",
    "getCategoryDistribution", "getGradeDistribution", "getSectionDistribution",
    "getWorkplaceSummary", "getRegionBranchSummary"]) {
    assert.equal(ctrl[fn], undefined, fn);
  }
});

test("D2 surviving endpoints still mount with their permission", async () => {
  reset();
  policyMode = "marker";
  const posts = ["/api/dashboard", "/api/dashboard/membership",
    "/api/reports/membership/preset/x", "/api/reports/membership/listing",
    "/api/reports/membership/compare", "/api/reports/membership/live-stats",
    "/api/reports/membership/statistics", "/api/reports/membership/workplace-breakdown",
    "/api/reports/membership/creditors-list", "/api/reports/membership/debtors-list",
    "/api/reports/membership/year-reconciliation",
    "/reports/membership/listing", "/dashboard/membership"];
  for (const p of posts) {
    const r = await call("POST", p, { headers: gatewayHeaders(TENANT_A), body: {} });
    assert.equal(r.status, 299, `${p} → ${r.status}`);
    assert.equal(r.json.resource, "reporting");
    assert.equal(r.json.action, "read");
  }
  const sb = await call("POST", "/api/reports/membership/snapshots/build", { headers: gatewayHeaders(TENANT_A), body: {} });
  assert.equal(sb.status, 299);
  assert.equal(sb.json.action, "write");
  // Template routes are gated by requireMongo first (no Mongo in tests) — mounted, not 404.
  const t = await call("GET", "/api/templates", { headers: gatewayHeaders(TENANT_A) });
  assert.notEqual(t.status, 404);
});

test("D3 unauthenticated callers still get 401 on dashboard/report routers", async () => {
  reset();
  for (const p of ["/api/dashboard/overview", "/api/reports/membership/listing"]) {
    const r = await call(p.endsWith("overview") ? "GET" : "POST", p, {});
    assert.equal(r.status, 401);
  }
});

// ------------------------------------------------------------- Bearer verify
test("J1 Bearer fallback: forged (unsigned/wrong-secret) token rejected 401", async () => {
  reset();
  policyMode = "marker";
  const forged = jwt.sign({ sub: "U9", tenantId: TENANT_A }, "wrong-secret");
  const none = jwt.sign({ sub: "U9", tenantId: TENANT_A }, null, { algorithm: "none" });
  for (const tok of [forged, none]) {
    const r = await call("POST", "/api/reports/membership/listing", {
      headers: { authorization: `Bearer ${tok}` }, body: {},
    });
    assert.equal(r.status, 401);
    assert.ok(!JSON.stringify(r.json).match(/signature|jwt (malformed|expired)/i));
  }
});

test("J2 Bearer fallback: valid HS256 token accepted; tenant from verified claim", async () => {
  reset();
  policyMode = "marker";
  const tok = jwt.sign({ sub: "U9", tenantId: TENANT_A }, process.env.JWT_SECRET, { algorithm: "HS256" });
  const r = await call("POST", "/api/reports/membership/listing", {
    headers: { authorization: `Bearer ${tok}` }, body: { tenantId: TENANT_B },
  });
  assert.equal(r.status, 299);
  const expired = jwt.sign({ sub: "U9", tenantId: TENANT_A, exp: Math.floor(Date.now() / 1000) - 3600 }, process.env.JWT_SECRET);
  const r2 = await call("POST", "/api/reports/membership/listing", {
    headers: { authorization: `Bearer ${expired}` }, body: {},
  });
  assert.equal(r2.status, 401);
});

test("J3 Bearer fallback fails closed when JWT_SECRET is unset", async () => {
  reset();
  policyMode = "marker";
  const tok = jwt.sign({ sub: "U9", tenantId: TENANT_A }, process.env.JWT_SECRET);
  const saved = process.env.JWT_SECRET;
  delete process.env.JWT_SECRET;
  try {
    const r = await call("POST", "/api/reports/membership/listing", {
      headers: { authorization: `Bearer ${tok}` }, body: {},
    });
    assert.equal(r.status, 401);
  } finally {
    process.env.JWT_SECRET = saved;
  }
});

// ------------------------------------------------------------ operator scripts
test("O1 operator request: tenant from verified token; mismatched --tenant refused", () => {
  const { buildOperatorRequest } = require("../scripts/lib/operatorRequest");
  const tok = jwt.sign({ sub: "OP", tenantId: TENANT_A }, process.env.JWT_SECRET);
  process.env.OPERATOR_BEARER_TOKEN = tok;
  try {
    const req = buildOperatorRequest({});
    assert.equal(req.tenantId, TENANT_A);
    assert.equal(req.headers.authorization, `Bearer ${tok}`);
    assert.throws(() => buildOperatorRequest({ requestedTenantId: TENANT_B }), /does not match/);
    process.env.OPERATOR_BEARER_TOKEN = jwt.sign({ tenantId: TENANT_A }, "wrong");
    assert.throws(() => buildOperatorRequest({}), /failed verification/);
    delete process.env.OPERATOR_BEARER_TOKEN;
    assert.throws(() => buildOperatorRequest({}), /OPERATOR_BEARER_TOKEN is required/);
  } finally {
    delete process.env.OPERATOR_BEARER_TOKEN;
  }
});
