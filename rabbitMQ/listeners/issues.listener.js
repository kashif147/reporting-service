const {
  recordEvent,
  applyIssueSnapshot,
  REPORTING_SNAPSHOT,
} = require("../../services/issuesIngest.service");

async function handleIssuesEvent(payload, eventType, exchange) {
  await recordEvent(payload, eventType, exchange);

  if (eventType === REPORTING_SNAPSHOT) {
    const data = payload.data || payload;
    await applyIssueSnapshot(data, {
      eventId: payload.eventId,
      eventType,
      tenantId: payload.tenantId,
    });
  }
}

module.exports = { handleIssuesEvent };
