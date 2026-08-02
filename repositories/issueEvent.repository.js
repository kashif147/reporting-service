const { pool } = require("../db/postgres");

async function insertIssueEvent({
  eventId,
  eventType,
  tenantId,
  issueId,
  occurredAt,
  sourceService,
  correlationId,
  payload,
}) {
  await pool.query(
    `INSERT INTO issue_event (
      event_id, event_type, tenant_id, issue_id,
      occurred_at, source_service, correlation_id, payload
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
    ON CONFLICT (event_id) DO NOTHING`,
    [
      eventId,
      eventType,
      tenantId,
      issueId || null,
      occurredAt,
      sourceService || null,
      correlationId || null,
      JSON.stringify(payload || {}),
    ]
  );
}

module.exports = { insertIssueEvent };
