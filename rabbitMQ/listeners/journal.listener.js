const { ingestJournalEvent } = require("../../services/journalIngest.service");

async function handleJournalEvent(payload, eventType, exchange) {
  await ingestJournalEvent(payload, eventType, exchange);
}

module.exports = { handleJournalEvent };
