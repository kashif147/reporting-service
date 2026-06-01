const {
  ingestMembershipEvent,
} = require("../../services/membershipIngest.service");

async function handleMembershipEvent(payload, eventType, exchange) {
  await ingestMembershipEvent(payload, eventType, exchange);
}

module.exports = { handleMembershipEvent };
