// scripts/sync-member-creditors.js: internal S2S headers only, asOf required on the wire, full
// paging with consistency checks, and an all-or-nothing replacement of one tenant's
// member_creditor rows.
// The http client is faked. The Postgres part runs against a real throwaway database when
// CREDITORS_TEST_PG_URL is set (e.g. a local `postgres:16-alpine` container) and is skipped
// otherwise.
// Run: node --test --test-force-exit tests/syncMemberCreditors.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const script = require("../scripts/sync-member-creditors");

const TENANT = "68cbf7806080b4621d469d34";
const OTHER = "6acdf7806080b4621d461ae0";
const FORBIDDEN = /^(authorization|x-jwt-verified|x-auth-source|x-user-.*|x-api-key)$/i;
const BASE = "http://account-service:4000";

/** Fake account-service: `all` creditor rows, paged by offset/limit; records each request. */
function fakeHttp(all, { asOfDate, mutate } = {}) {
  const calls = [];
  return {
    calls,
    post: async (url, body, opts) => {
      calls.push({ url, body, headers: opts.headers });
      const n = calls.length;
      const rows = mutate ? mutate(n, all) : all;
      return {
        status: 200,
        data: {
          success: true,
          data: {
            asOfDate: asOfDate || body.asOf,
            total: rows.length,
            offset: body.offset,
            limit: body.limit,
            rows: rows.slice(body.offset, body.offset + body.limit),
          },
        },
      };
    },
  };
}
const rowsOf = (n) => Array.from({ length: n }, (_, i) => ({ memberId: `M-${String(i + 1).padStart(4, "0")}`, amountCents: 100 + i }));

test("headers are exactly the internal contract", () => {
  const h = script.buildCreditorsHeaders(TENANT);
  assert.deepEqual(h, { "Content-Type": "application/json", "x-internal-request": "true", "x-tenant-id": TENANT });
  for (const k of Object.keys(h)) assert.ok(!FORBIDDEN.test(k), `unexpected header ${k}`);
});

test("tenant / asOf / URL validation happens before any request", async () => {
  for (const bad of [undefined, "", "tenant-A", "default", `${TENANT}0`]) {
    assert.throws(() => script.validateTenantId(bad));
  }
  assert.throws(() => script.resolveAsOf("02/11/2026"), /YYYY-MM-DD/);
  assert.equal(script.resolveAsOf(undefined, new Date("2026-11-03T10:00:00Z")), "2026-11-03");
  const http = fakeHttp(rowsOf(1));
  await assert.rejects(script.fetchCreditorsSnapshot({ baseUrl: "", tenantId: TENANT, asOf: "2026-11-02", http }), /ACCOUNT_SERVICE_URL/);
  assert.equal(http.calls.length, 0);
});

test("sends asOf and pages until total; every request carries only the internal headers", async () => {
  const http = fakeHttp(rowsOf(7));
  const snap = await script.fetchCreditorsSnapshot({ baseUrl: `${BASE}/`, tenantId: TENANT, asOf: "2026-11-02", http, pageLimit: 3 });
  assert.equal(snap.total, 7);
  assert.equal(snap.rows.length, 7);
  assert.deepEqual(http.calls.map((c) => c.body.offset), [0, 3, 6]);
  for (const c of http.calls) {
    assert.equal(c.url, `${BASE}/api/reports/creditors-list`);
    assert.equal(c.body.asOf, "2026-11-02");
    assert.deepEqual(Object.keys(c.headers).sort(), ["Content-Type", "x-internal-request", "x-tenant-id"]);
  }
  assert.deepEqual(Object.keys(snap.rows[0]).sort(), ["amountCents", "memberId"]);
});

test("aborts (nothing to write) when the snapshot changes between pages or is inconsistent", async () => {
  const grow = fakeHttp(rowsOf(4), { mutate: (n, all) => (n === 1 ? all : rowsOf(5)) });
  await assert.rejects(script.fetchCreditorsSnapshot({ baseUrl: BASE, tenantId: TENANT, asOf: "2026-11-02", http: grow, pageLimit: 2 }), /changed between pages/);
  const wrongDate = fakeHttp(rowsOf(2), { asOfDate: "2026-11-01" });
  await assert.rejects(script.fetchCreditorsSnapshot({ baseUrl: BASE, tenantId: TENANT, asOf: "2026-11-02", http: wrongDate }), /asOfDate/);
  const dup = fakeHttp([{ memberId: "M-1", amountCents: 1 }, { memberId: "M-1", amountCents: 2 }]);
  await assert.rejects(script.fetchCreditorsSnapshot({ baseUrl: BASE, tenantId: TENANT, asOf: "2026-11-02", http: dup }), /duplicate/);
  const bad = fakeHttp([{ memberId: "M-1", amountCents: 0 }]);
  await assert.rejects(script.fetchCreditorsSnapshot({ baseUrl: BASE, tenantId: TENANT, asOf: "2026-11-02", http: bad }), /invalid row/);
  const denied = { post: async () => ({ status: 401, data: { code: "UNAUTHORIZED" } }) };
  await assert.rejects(script.fetchCreditorsSnapshot({ baseUrl: BASE, tenantId: TENANT, asOf: "2026-11-02", http: denied }), /401/);
});

test("a fetch failure never opens a transaction", async () => {
  let connected = 0;
  const pool = { connect: async () => { connected += 1; throw new Error("must not connect"); } };
  const denied = { post: async () => ({ status: 500, data: {} }) };
  await assert.rejects(script.syncMemberCreditors({ tenantId: TENANT, asOf: "2026-11-02", baseUrl: BASE, pool, http: denied }), /500/);
  assert.equal(connected, 0);
});

// ---- real Postgres (optional) ----
const PG_URL = process.env.CREDITORS_TEST_PG_URL;
test("Postgres: one-transaction replacement keeps other tenants, keeps ingested cause, removes stale rows; failure rolls back", { skip: !PG_URL && "CREDITORS_TEST_PG_URL not set" }, async () => {
  const { Pool } = require("pg");
  const pool = new Pool({ connectionString: PG_URL });
  try {
    await pool.query("CREATE SCHEMA IF NOT EXISTS reports");
    await pool.query("DROP TABLE IF EXISTS reports.member_creditor");
    const fs = require("node:fs");
    const path = require("node:path");
    await pool.query(fs.readFileSync(path.join(__dirname, "..", "db", "migrations", "006_member_creditor.sql"), "utf8"));
    await pool.query(
      `INSERT INTO reports.member_creditor (tenant_id, membership_number, full_name, amount_cents, cause, refund_processed)
       VALUES ($1,'M-0001','Kept Name',999,'Duplicate payment',true), ($1,'STALE',null,50,'Overpayment',false),
              ($2,'M-0001',null,777,'Overpayment',false)`,
      [TENANT, OTHER],
    );
    const res = await script.syncMemberCreditors({ tenantId: TENANT, asOf: "2026-11-02", baseUrl: BASE, pool, http: fakeHttp(rowsOf(3)) });
    assert.deepEqual({ upserted: res.upserted, deleted: res.deleted, total: res.total }, { upserted: 3, deleted: 1, total: 3 });
    const mine = (await pool.query("SELECT * FROM reports.member_creditor WHERE tenant_id=$1 ORDER BY membership_number", [TENANT])).rows;
    assert.deepEqual(mine.map((r) => [r.membership_number, r.amount_cents]), [["M-0001", 100], ["M-0002", 101], ["M-0003", 102]]);
    assert.equal(mine[0].cause, "Duplicate payment");
    assert.equal(mine[0].refund_processed, true);
    assert.equal(mine[0].full_name, "Kept Name");
    assert.equal(mine[1].cause, "Overpayment");
    assert.equal(mine[1].subscription_year, 2026);
    const other = (await pool.query("SELECT amount_cents FROM reports.member_creditor WHERE tenant_id=$1", [OTHER])).rows;
    assert.deepEqual(other, [{ amount_cents: 777 }]);

    // A failure inside the transaction (DELETE fails) leaves the previous state intact.
    const before = (await pool.query("SELECT * FROM reports.member_creditor ORDER BY tenant_id, membership_number")).rows;
    const failing = {
      connect: async () => {
        const c = await pool.connect();
        const q = c.query;
        const release = c.release;
        c.query = (...args) =>
          /^\s*DELETE/.test(String(args[0])) ? Promise.reject(new Error("simulated failure")) : q.apply(c, args);
        c.release = (...args) => {
          c.query = q;
          c.release = release;
          return release.apply(c, args);
        };
        return c;
      },
    };
    await assert.rejects(
      script.syncMemberCreditors({ tenantId: TENANT, asOf: "2026-11-02", baseUrl: BASE, pool: failing, http: fakeHttp([]) }),
      /simulated failure/,
    );
    const afterFail = (await pool.query("SELECT * FROM reports.member_creditor ORDER BY tenant_id, membership_number")).rows;
    assert.deepEqual(afterFail, before);

    // An empty snapshot (no creditors) clears only this tenant, atomically.
    const empty = await script.syncMemberCreditors({ tenantId: TENANT, asOf: "2026-11-02", baseUrl: BASE, pool, http: fakeHttp([]) });
    assert.deepEqual([empty.upserted, empty.deleted], [0, 3]);
    assert.equal((await pool.query("SELECT count(*)::int n FROM reports.member_creditor WHERE tenant_id=$1", [OTHER])).rows[0].n, 1);
  } finally {
    await pool.end();
  }
});
