const { ingestProfileEvent } = require("../../services/membershipIngest.service");

async function handleProfileEvent(payload, eventType) {
  await ingestProfileEvent(payload, eventType);
}

module.exports = { handleProfileEvent };
