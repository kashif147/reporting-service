// Phase 2B: the issue_listing projection must never let an OLDER issue-service snapshot
// overwrite a NEWER row (out-of-order delivery, DLQ replay). Ordering key = the source's
// lastUpdated (issue-service: max(lastActivityAt, updatedAt)), never receive time.
// Drives the real listener (handleIssuesEvent) against a real Postgres schema built by
// db/runMigrations.js. Needs REPORTING_TEST_DB_URL (a throwaway database); skips without it.
const test = require("node:test");
const assert = require("node:assert");

const url = process.env.REPORTING_TEST_DB_URL;
const skip = url ? false : "REPORTING_TEST_DB_URL unset (needs a throwaway Postgres)";
if (url) process.env.REPORTING_DB_URL = url;

const A = "aaaaaaaaaaaaaaaaaaaaaaaa";
const B = "bbbbbbbbbbbbbbbbbbbbbbbb";
const SNAPSHOT = "issues.issue.reporting.snapshot.v1";
let handleIssuesEvent, pool;
let seq = 0;

function snapshot(tenantId, issueId, lastUpdated, extra = {}) {
  seq += 1;
  return {
    eventId: `evt-${tenantId.slice(0, 1)}-${issueId}-${seq}`,
    eventType: SNAPSHOT,
    tenantId,
    timestamp: new Date().toISOString(), // receive/publish time: must NOT decide ordering
    data: {
      tenantId, issueId, issueType: "COMPLAINT", priority: "MEDIUM", issueStatus: "ACTIVE",
      memberIds: [], isCurrent: true, lastUpdated, ...extra,
    },
  };
}
const deliver = (p) => handleIssuesEvent(p, SNAPSHOT, "issues.events");
async function row(tenantId, issueId) {
  const { rows } = await pool.query(
    "select issue_status, priority, last_updated, last_event_id from reports.issue_listing where tenant_id=$1 and issue_id=$2",
    [tenantId, issueId],
  );
  return rows;
}

test.before(async () => {
  if (skip) return;
  ({ pool } = require("../db/postgres"));
  await pool.query("DROP SCHEMA IF EXISTS reports CASCADE");
  await require("../db/runMigrations").runMigrations();
  ({ handleIssuesEvent } = require("../rabbitMQ/listeners/issues.listener"));
});
test.after(async () => { if (!skip) await pool.end(); });

test("1 first snapshot creates the row", { skip }, async () => {
  await deliver(snapshot(A, "i-1", "2026-09-24T10:57:07.349Z", { issueStatus: "ACTIVE" }));
  const r = await row(A, "i-1");
  assert.equal(r.length, 1);
  assert.equal(r[0].issue_status, "ACTIVE");
});

test("2 a newer snapshot updates the row", { skip }, async () => {
  await deliver(snapshot(A, "i-1", "2026-09-24T11:04:16.248Z", { issueStatus: "IN_PROGRESS", priority: "HIGH" }));
  const r = await row(A, "i-1");
  assert.equal(r[0].issue_status, "IN_PROGRESS");
  assert.equal(r[0].priority, "HIGH");
  assert.equal(new Date(r[0].last_updated).toISOString(), "2026-09-24T11:04:16.248Z");
});

test("3 an older snapshot arriving later does not overwrite the newer row", { skip }, async () => {
  await deliver(snapshot(A, "i-1", "2026-09-24T10:57:07.349Z", { issueStatus: "ACTIVE", priority: "LOW" }));
  const r = await row(A, "i-1");
  assert.equal(r.length, 1);
  assert.equal(r[0].issue_status, "IN_PROGRESS", "stale snapshot must not roll status back");
  assert.equal(r[0].priority, "HIGH");
  assert.equal(new Date(r[0].last_updated).toISOString(), "2026-09-24T11:04:16.248Z");
});

test("4 replaying the same snapshot (equal lastUpdated) is idempotent", { skip }, async () => {
  const p = snapshot(A, "i-2", "2026-10-01T09:00:00.000Z", { issueStatus: "ACTIVE" });
  await deliver(p);
  await deliver(p);
  await deliver({ ...p, eventId: `${p.eventId}-redelivered` });
  const r = await row(A, "i-2");
  assert.equal(r.length, 1);
  assert.equal(r[0].issue_status, "ACTIVE");
  const ev = await pool.query("select count(*)::int n from reports.issue_event where event_id=$1", [p.eventId]);
  assert.equal(ev.rows[0].n, 1, "event log stays deduplicated by event_id");
});

test("5 another tenant with the same issue id is isolated", { skip }, async () => {
  await deliver(snapshot(B, "i-1", "2026-09-01T00:00:00.000Z", { issueStatus: "CLOSED" }));
  assert.equal((await row(B, "i-1"))[0].issue_status, "CLOSED");
  const a = await row(A, "i-1");
  assert.equal(a[0].issue_status, "IN_PROGRESS", "tenant A untouched by tenant B's (older) snapshot");
});

test("6 a missing or invalid lastUpdated never overwrites an existing row, and is not stamped with receive time", { skip }, async () => {
  for (const bad of [undefined, null, "", "not-a-date"]) {
    await deliver(snapshot(A, "i-1", bad, { issueStatus: "CLOSED" }));
  }
  const a = await row(A, "i-1");
  assert.equal(a[0].issue_status, "IN_PROGRESS");
  assert.equal(new Date(a[0].last_updated).toISOString(), "2026-09-24T11:04:16.248Z");
  // First snapshot for an issue without a usable lastUpdated: row created, last_updated NULL,
  // so the next valid snapshot (whatever its date) still applies.
  await deliver(snapshot(A, "i-3", undefined, { issueStatus: "ACTIVE" }));
  assert.equal((await row(A, "i-3"))[0].last_updated, null);
  await deliver(snapshot(A, "i-3", "2020-01-01T00:00:00.000Z", { issueStatus: "IN_PROGRESS" }));
  assert.equal((await row(A, "i-3"))[0].issue_status, "IN_PROGRESS");
});
