// Phase A / A5 — reporting event ids are unique per tenant: UNIQUE(tenant_id, event_id) replaces the
// global UNIQUE(event_id), and ingest conflicts are resolved on (tenant_id, event_id).
// Unit part always runs; the DB part needs REPORTING_TEST_DB_URL (a throwaway Postgres) and skips without it.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const MIG = path.join(__dirname, "..", "db", "migrations");
const read = (f) => fs.readFileSync(path.join(MIG, f), "utf8");
const statements = (sql) => sql.replace(/--[^\n]*\n/g, "\n").split(";").map((s) => s.trim()).filter(Boolean);

test("011/012 create the tenant-aware unique indexes, one CONCURRENTLY statement per file", () => {
  for (const [f, table, idx] of [
    ["011_membership_event_tenant_event_uidx.sql", "reports.membership_event", "uq_membership_event_tenant_event"],
    ["012_issue_event_tenant_event_uidx.sql", "reports.issue_event", "uq_issue_event_tenant_event"],
  ]) {
    const st = statements(read(f));
    assert.strictEqual(st.length, 1, `${f} must hold exactly one statement`);
    assert.match(st[0], new RegExp(`CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS ${idx} ON ${table.replace(".", "\\.")} \\(tenant_id, event_id\\)`));
  }
});

test("013 drops only the global event_id constraints (idempotent) and sorts after 011/012", () => {
  const st = statements(read("013_drop_global_event_id_unique.sql"));
  assert.deepStrictEqual(st, [
    "ALTER TABLE reports.membership_event DROP CONSTRAINT IF EXISTS membership_event_event_id_key",
    "ALTER TABLE reports.issue_event DROP CONSTRAINT IF EXISTS issue_event_event_id_key",
  ]);
  const files = fs.readdirSync(MIG).filter((f) => f.endsWith(".sql")).sort();
  assert.ok(files.indexOf("013_drop_global_event_id_unique.sql") > files.indexOf("012_issue_event_tenant_event_uidx.sql"));
});

test("ingest inserts resolve conflicts on (tenant_id, event_id)", async () => {
  const db = require("../db/postgres");
  const seen = [];
  const orig = db.pool.query;
  db.pool.query = async (sql, params) => { seen.push({ sql, params }); return { rowCount: 1 }; };
  try {
    const { insertMembershipEvent } = require("../repositories/membershipEvent.repository");
    const { insertIssueEvent } = require("../repositories/issueEvent.repository");
    await insertMembershipEvent({ eventId: "e1", eventType: "t", tenantId: "A", occurredAt: new Date() });
    await insertIssueEvent({ eventId: "e1", eventType: "t", tenantId: "B", occurredAt: new Date() });
  } finally { db.pool.query = orig; }
  assert.strictEqual(seen.length, 2);
  for (const s of seen) {
    assert.match(s.sql, /ON CONFLICT \(tenant_id, event_id\) DO NOTHING/);
    assert.doesNotMatch(s.sql, /ON CONFLICT \(event_id\)/);
  }
  await db.pool.end().catch(() => {});
});

const url = process.env.REPORTING_TEST_DB_URL;
test("DB: same event_id in two tenants -> 2 rows; same tenant twice -> 1 row", { skip: url ? false : "REPORTING_TEST_DB_URL unset" }, async () => {
  const { Pool } = require("pg");
  const pool = new Pool({ connectionString: url });
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const ins = (t) => c.query(`INSERT INTO reports.membership_event (event_id, event_type, tenant_id, occurred_at, payload)
      VALUES ('a5-e1','t',$1,now(),'{}'::jsonb) ON CONFLICT (tenant_id, event_id) DO NOTHING`, [t]);
    await ins("TA"); await ins("TB"); await ins("TA");
    const r = await c.query("SELECT tenant_id FROM reports.membership_event WHERE event_id='a5-e1' ORDER BY 1");
    assert.deepStrictEqual(r.rows.map((x) => x.tenant_id), ["TA", "TB"]);
  } finally { await c.query("ROLLBACK"); c.release(); await pool.end(); }
});
