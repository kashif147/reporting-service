const {
  ingestAccountsEvent,
} = require("../../services/accountsIngest.service");

async function handleAccountsEvent(payload, eventType, exchange) {
  await ingestAccountsEvent(payload, eventType, exchange);
}

module.exports = { handleAccountsEvent };
