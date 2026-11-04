"use strict";
// PDP rollout P2 (bounded-pdp proposal §4 Q4) — per-family reporting permissions + requireCrmUser.
//
// Every reporting / dashboard / Save View route asks the PDP for exactly one family:
//   reporting.statistics:read  dashboard POST / and /membership, /statistics, /year-reconciliation,
//                              /compare, /live-stats, /workplace-breakdown
//   reporting.listings:read    /preset/:reportType, /listing
//   reporting.finance:read     /creditors-list, /debtors-list
//   reporting.templates:read   GET /api/templates, /default, /:templateId
//   reporting.templates:write  POST/PUT/DELETE /api/templates
//   reporting:write            /snapshots/build (no catalogue code -> ASU only)
// and every router refuses a non-CRM caller (PORTAL or missing userType) before the PDP is asked.
//
// The real routers + real auth middleware run; the controllers are stubs and the PDP is a small model of
// the CURRENT user-service evaluator (ASU own-tenant rule; UNKNOWN_RESOURCE when the resource has no
// catalogue code; category CRM vs userType; exact resource:action or "*"), with the P1 catalogue codes.
// Native node:test. Run: node --test tests/reportingFamilies.p2.test.js
const os = require("os");
const path = require("path");
const fs = require("fs");
process.env.LOG_ROOT = process.env.LOG_ROOT || fs.mkdtempSync(path.join(os.tmpdir(), "rep-families-"));
process.env.NODE_ENV = process.env.NODE_ENV || "test";
process.env.JWT_SECRET = "test-secret-reporting-p2";

const test = require("node:test");
const assert = require("node:assert");
const http = require("http");
const express = require("express");
const jwt = require("jsonwebtoken");

const ROOT = path.join(__dirname, "..");
const TENANT = "aaaaaaaaaaaaaaaaaaaaaaaa";
const inject = (rel, exports) => {
  const p = require.resolve(path.join(ROOT, rel));
  require.cache[p] = { id: p, filename: p, loaded: true, exports };
};

// ----------------------------------------------------------------- PDP model
// P1 catalogue (bounded-pdp proposal §2a): the reporting family codes, all category CRM. There is NO
// `reporting` resource code, so `reporting:*` is UNKNOWN_RESOURCE for every non-ASU caller.
const CATALOGUE = {
  "reporting.statistics": "CRM",
  "reporting.listings": "CRM",
  "reporting.finance": "CRM",
  "reporting.templates": "CRM",
};
const pdpCalls = [];
function pdpDecide(user, resource, action) {
  if ((user.roles || []).includes("ASU")) return "PERMIT"; // Rule 1: ASU own-tenant admin
  const category = CATALOGUE[resource];
  if (!category) return "DENY"; // UNKNOWN_RESOURCE
  const userCategory = { CRM: "CRM", PORTAL: "PORTAL", MEMBER: "PORTAL" }[user.userType] || "GENERAL";
  if (category !== userCategory) return "DENY"; // INVALID_USER_TYPE
  const perms = user.permissions || [];
  return perms.includes(`${resource}:${action}`) || perms.includes("*") ? "PERMIT" : "DENY";
}
const fakePolicy = {
  requirePermission: (resource, action) => (req, res, next) => {
    pdpCalls.push(`${resource}:${action}`);
    return pdpDecide(req.user || {}, resource, action) === "PERMIT"
      ? next()
      : res.status(403).json({ error: { code: "PERMISSION_DENIED", resource, action } });
  },
};
inject("middlewares/policy.middleware.js", Object.assign(fakePolicy, { defaultPolicyMiddleware: fakePolicy }));
inject("middlewares/requireMongo.js", (req, res, next) => next());

const stub = () =>
  new Proxy({}, { get: (_t, name) => (req, res) => res.status(200).json({ handler: String(name) }) });
inject("controllers/dashboard.controller.js", stub());
inject("controllers/membershipReport.controller.js", stub());
inject("controllers/grid.filter.template.controller.js", stub());

const dashboardRoutes = require("../routes/dashboard.routes");
const membershipReportRoutes = require("../routes/membershipReport.routes");
const gridFilterTemplateRoutes = require("../routes/grid.filter.template.routes");

// Same mounts as app.js (/api/* for the gateway + the bare duplicates).
const app = express();
app.use(express.json());
for (const prefix of ["/api", ""]) {
  app.use(`${prefix}/dashboard`, dashboardRoutes);
  app.use(`${prefix}/reports/membership`, membershipReportRoutes);
  app.use(`${prefix}/templates`, gridFilterTemplateRoutes);
}

let server;
let base;
test.before(async () => {
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => new Promise((r) => server.close(r)));

async function call(method, url, headers) {
  const res = await fetch(base + url, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: method === "GET" ? undefined : "{}",
  });
  let json = null;
  try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, json };
}
const bearer = (claims) => ({
  authorization: `Bearer ${jwt.sign({ sub: "U1", tenantId: TENANT, roles: [], permissions: [], ...claims }, process.env.JWT_SECRET, { algorithm: "HS256", expiresIn: "5m" })}`,
});
const gateway = ({ userType, roles = [], permissions = [] }) => ({
  "x-jwt-verified": "true",
  "x-auth-source": "gateway",
  "x-user-id": "U1",
  "x-tenant-id": TENANT,
  ...(userType ? { "x-user-type": userType } : {}),
  "x-user-roles": JSON.stringify(roles),
  "x-user-permissions": JSON.stringify(permissions),
  authorization: "Bearer gw-token",
});

// --------------------------------------------------------------- route table
const ROUTES = [
  ["POST", "/api/dashboard", "reporting.statistics:read"],
  ["POST", "/api/dashboard/membership", "reporting.statistics:read"],
  ["POST", "/api/reports/membership/statistics", "reporting.statistics:read"],
  ["POST", "/api/reports/membership/year-reconciliation", "reporting.statistics:read"],
  ["POST", "/api/reports/membership/compare", "reporting.statistics:read"],
  ["POST", "/api/reports/membership/live-stats", "reporting.statistics:read"],
  ["POST", "/api/reports/membership/workplace-breakdown", "reporting.statistics:read"],
  ["POST", "/api/reports/membership/preset/new-members", "reporting.listings:read"],
  ["POST", "/api/reports/membership/listing", "reporting.listings:read"],
  ["POST", "/api/reports/membership/creditors-list", "reporting.finance:read"],
  ["POST", "/api/reports/membership/debtors-list", "reporting.finance:read"],
  ["GET", "/api/templates", "reporting.templates:read"],
  ["GET", "/api/templates/default", "reporting.templates:read"],
  ["GET", "/api/templates/600000000000000000000003", "reporting.templates:read"],
  ["POST", "/api/templates", "reporting.templates:write"],
  ["PUT", "/api/templates/600000000000000000000003", "reporting.templates:write"],
  ["DELETE", "/api/templates/600000000000000000000003", "reporting.templates:write"],
];
const FAMILIES = [
  "reporting.statistics:read",
  "reporting.listings:read",
  "reporting.finance:read",
  "reporting.templates:read",
  "reporting.templates:write",
];
// Bare (non-/api) duplicates share the same router objects (app.js) - exercised for every route below too.
const bare = (url) => url.replace(/^\/api/, "");

for (const [method, url, family] of ROUTES) {
  test(`${method} ${url} -> asks the PDP for exactly ${family}`, async () => {
    for (const u of [url, bare(url)]) {
      pdpCalls.length = 0;
      const r = await call(method, u, bearer({ userType: "CRM", permissions: [family] }));
      assert.equal(r.status, 200, `${method} ${u} family held -> ${r.status}`);
      assert.deepStrictEqual(pdpCalls, [family], `${method} ${u}`);
    }
  });

  test(`${method} ${url}: other families only -> 403`, async () => {
    const others = FAMILIES.filter((f) => f !== family);
    for (const u of [url, bare(url)]) {
      const r = await call(method, u, bearer({ userType: "CRM", permissions: others }));
      assert.equal(r.status, 403, `${method} ${u} other families -> ${r.status}`);
    }
    // The old generic code no longer opens anything.
    const legacy = await call(method, url, bearer({ userType: "CRM", permissions: ["reporting:read", "reporting:write"] }));
    assert.equal(legacy.status, 403);
  });

  test(`${method} ${url}: no permission -> 403`, async () => {
    const r = await call(method, url, bearer({ userType: "CRM", permissions: [] }));
    assert.equal(r.status, 403);
  });

  test(`${method} ${url}: PORTAL token holding the family -> 403 before the PDP`, async () => {
    for (const headers of [
      bearer({ userType: "PORTAL", permissions: [family] }),
      gateway({ userType: "PORTAL", permissions: [family] }),
      bearer({ permissions: [family] }), // no userType at all
      gateway({ permissions: [family] }),
    ]) {
      pdpCalls.length = 0;
      const r = await call(method, url, headers);
      assert.equal(r.status, 403);
      assert.equal(r.json.error.code, "CRM_USER_REQUIRED");
      assert.deepStrictEqual(pdpCalls, [], "the PDP is not consulted for a non-CRM caller");
    }
  });

  test(`${method} ${url}: ASU passes; gateway CRM caller with the family passes`, async () => {
    const asu = await call(method, url, bearer({ userType: "CRM", roles: ["ASU"], permissions: ["*"] }));
    assert.equal(asu.status, 200);
    const gw = await call(method, url, gateway({ userType: "CRM", permissions: [family] }));
    assert.equal(gw.status, 200);
  });
}

test("snapshot build: ASU / internal only - every family code is not enough", async () => {
  for (const u of ["/api/reports/membership/snapshots/build", "/reports/membership/snapshots/build"]) {
    pdpCalls.length = 0;
    const all = await call("POST", u, bearer({ userType: "CRM", permissions: [...FAMILIES, "*"] }));
    assert.equal(all.status, 403, `${u} non-ASU with every family (+"*") -> ${all.status}`);
    assert.deepStrictEqual(pdpCalls, ["reporting:write"]);
    const asu = await call("POST", u, bearer({ userType: "CRM", roles: ["ASU"], permissions: ["*"] }));
    assert.equal(asu.status, 200);
    const portalAsu = await call("POST", u, bearer({ userType: "PORTAL", roles: ["ASU"], permissions: ["*"] }));
    assert.equal(portalAsu.status, 403);
  }
});

test("unauthenticated callers still get 401", async () => {
  for (const [method, url] of ROUTES) {
    const r = await call(method, url, {});
    assert.equal(r.status, 401, `${method} ${url}`);
  }
});

test("source: every route in the three routers names a reporting family (no generic reporting:read left)", () => {
  const src = ["dashboard.routes.js", "membershipReport.routes.js", "grid.filter.template.routes.js"]
    .map((f) => fs.readFileSync(path.join(ROOT, "routes", f), "utf8"))
    .join("\n");
  assert.ok(!/requirePermission\("reporting",\s*"read"\)/.test(src));
  assert.equal((src.match(/requirePermission\("reporting",\s*"write"\)/g) || []).length, 1, "only snapshot build");
  for (const f of ["dashboard.routes.js", "membershipReport.routes.js", "grid.filter.template.routes.js"]) {
    const s = fs.readFileSync(path.join(ROOT, "routes", f), "utf8");
    const iTenant = s.indexOf("router.use(requireTenant)");
    const iCrm = s.indexOf("router.use(requireCrmUser)");
    assert.ok(iTenant > -1 && iCrm > iTenant, `${f}: requireCrmUser after requireTenant`);
  }
  const appSrc = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");
  for (const [mount, router] of [["dashboard", "dashboardRoutes"], ["reports/membership", "membershipReportRoutes"], ["templates", "gridFilterTemplateRoutes"]]) {
    assert.ok(appSrc.includes(`app.use("/api/${mount}", ${router})`), `/api/${mount}`);
    assert.ok(appSrc.includes(`app.use("/${mount}", ${router})`), `/${mount} (bare duplicate shares the router)`);
  }
});
