"use strict";
// Phase 1A adoption — reporting-service tenant-context guard (WARN MODE).
// Native node:test.  Run: node --test tests/tenantContext.adoption.test.js
const os = require("os");
const path = require("path");
const fs = require("fs");
process.env.LOG_ROOT =
  process.env.LOG_ROOT || fs.mkdtempSync(path.join(os.tmpdir(), "rep-tenantctx-"));
process.env.NODE_ENV = process.env.NODE_ENV || "test";

const test = require("node:test");
const assert = require("node:assert");
const policyMw = require("@membership/policy-middleware");
const { tenantContextMiddleware } = policyMw;

const TRUSTED = "68cbf7806080b4621d469d34";
const OTHER = "aaaaaaaaaaaaaaaaaaaaaaaa";
const tenantContextWarn = tenantContextMiddleware({ mode: "warn" });

function gatewayReq(o = {}) {
  return {
    method: "GET", url: "/api/dashboard", originalUrl: "/api/dashboard",
    headers: { "x-jwt-verified": "true", "x-auth-source": "gateway", "x-user-id": "U1", "x-tenant-id": TRUSTED, ...(o.headers || {}) },
    ctx: o.ctx !== undefined ? o.ctx : { tenantId: TRUSTED, userId: "U1" },
    tenantId: o.tenantId, body: o.body, query: o.query, params: o.params,
  };
}
function mkRes() { const r = { statusCode: null, _s: [] }; r.status = (c) => (r.statusCode = c, r._s.push(c), r); r.json = () => r; return r; }
function run(req) {
  const res = mkRes(); const orig = process.stdout.write.bind(process.stdout); const chunks = [];
  process.stdout.write = (s) => (chunks.push(typeof s === "string" ? s : s.toString()), true);
  let n = 0; try { tenantContextWarn(req, res, () => (n += 1)); } finally { process.stdout.write = orig; }
  const rows = chunks.join("").split("\n").map((l) => l.trim()).filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  return { req, res, nextCount: n, rows };
}
const read = (rel) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");

test("1 tenantContextWarn exists (exported)", () => {
  const a = require("../middlewares/auth");
  assert.equal(typeof a.tenantContextWarn, "function");
});
test("2 mode is warn; no enforce", () => {
  const a = read(path.join("middlewares", "auth.js"));
  assert.match(a, /tenantContextMiddleware\(\{\s*mode:\s*"warn"\s*\}\)/);
  assert.ok(!/mode:\s*"enforce"/.test(a));
});
test("3 dashboard uses router.use(authenticate, tenantContextWarn)", () => { assert.match(read(path.join("routes", "dashboard.routes.js")), /router\.use\(authenticate,\s*tenantContextWarn\)/); });
test("4 membershipReport uses the same boundary", () => { assert.match(read(path.join("routes", "membershipReport.routes.js")), /router\.use\(authenticate,\s*tenantContextWarn\)/); });
test("5 grid-template uses the same boundary", () => { assert.match(read(path.join("routes", "grid.filter.template.routes.js")), /router\.use\(authenticate,\s*tenantContextWarn\)/); });
test("6 tenantContextWarn runs before requireTenant in each router", () => {
  for (const f of ["dashboard.routes.js", "membershipReport.routes.js", "grid.filter.template.routes.js"]) {
    const s = read(path.join("routes", f));
    const iWarn = s.indexOf("router.use(authenticate, tenantContextWarn)");
    const iReq = s.indexOf("router.use(requireTenant)");
    assert.ok(iWarn > -1 && iReq > iWarn, `${f}: guard must precede requireTenant`);
  }
});
test("7 trusted tenant remains authoritative; next() called", () => { const { req, nextCount, res } = run(gatewayReq()); assert.equal(req.tenantId, TRUSTED); assert.equal(nextCount, 1); assert.equal(res.statusCode, null); });
test("8 query mismatch cannot override trusted tenant", () => { const { req, nextCount } = run(gatewayReq({ query: { tenantId: OTHER } })); assert.equal(req.tenantId, TRUSTED); assert.equal(nextCount, 1); });
test("9 body mismatch cannot override trusted tenant", () => { const { req, nextCount } = run(gatewayReq({ body: { tenantId: OTHER } })); assert.equal(req.tenantId, TRUSTED); assert.equal(nextCount, 1); });
test("10 mismatch emits TenantContextMismatch (mode=warn, outcome=ignored, trusted, suppliedSources); no 403", () => {
  const { rows, res } = run(gatewayReq({ query: { tenantId: OTHER } }));
  const row = rows.find((r) => r.eventType === "TenantContextMismatch");
  assert.ok(row); assert.equal(row.mode, "warn"); assert.equal(row.outcome, "ignored");
  assert.equal(row.trustedTenantId, TRUSTED); assert.ok(row.suppliedSources.includes("query"));
  assert.ok(!res._s.includes(403));
});
test("11 matching tenant emits no mismatch", () => { const { rows } = run(gatewayReq({ body: { tenantId: TRUSTED } })); assert.equal(rows.find((r) => r.eventType === "TenantContextMismatch"), undefined); });
test("12 /health remains public/unadopted (app.js has no guard)", () => {
  const app = read("app.js");
  assert.ok(app.includes('app.get("/health"'));
  assert.ok(!app.includes("tenantContextWarn") && !app.includes("ensureAuthenticatedWithTenantContext"));
});
test("13 /api/system-logs remains unadopted (mounted before any guard)", () => {
  const app = read("app.js");
  assert.ok(app.includes("createSystemLogsRouter"));
});
test("14 jobs/consumers not changed (no guard reference)", () => {
  for (const rel of ["jobs/scheduledSnapshots.js", "rabbitMQ/index.js"]) {
    const s = read(rel);
    assert.ok(!s.includes("tenantContextWarn"), `${rel} must not reference the guard`);
  }
});
test("15 WARN only across routers; no enforce", () => {
  for (const f of ["dashboard.routes.js", "membershipReport.routes.js", "grid.filter.template.routes.js"]) {
    assert.ok(!/enforce/.test(read(path.join("routes", f))));
  }
});
test("16 legacy jwt.decode enforce-blocker preserved in auth.js", () => {
  const a = read(path.join("middlewares", "auth.js"));
  assert.match(a, /jwt\.decode\(/, "jwt.decode fallback must still be present (unfixed, documented as enforce blocker)");
  assert.match(a, /ENFORCE BLOCKER/i);
});
test("17 installed package exposes tenantContextMiddleware + resolveTenantContext", () => {
  assert.equal(typeof policyMw.tenantContextMiddleware, "function");
  assert.equal(typeof policyMw.resolveTenantContext, "function");
});
