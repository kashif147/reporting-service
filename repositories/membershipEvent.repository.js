const { pool } = require("../db/postgres");

async function insertMembershipEvent({
  eventId,
  eventType,
  tenantId,
  subscriptionId,
  profileId,
  membershipNumber,
  occurredAt,
  sourceService,
  correlationId,
  payload,
}) {
  await pool.query(
    `INSERT INTO membership_event (
      event_id, event_type, tenant_id, subscription_id, profile_id,
      membership_number, occurred_at, source_service, correlation_id, payload
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)
    ON CONFLICT (event_id) DO NOTHING`,
    [
      eventId,
      eventType,
      tenantId,
      subscriptionId || null,
      profileId || null,
      membershipNumber || null,
      occurredAt,
      sourceService || null,
      correlationId || null,
      JSON.stringify(payload || {}),
    ]
  );
}

module.exports = { insertMembershipEvent };
