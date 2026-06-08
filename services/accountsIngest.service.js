const { insertMembershipEvent } = require("../repositories/membershipEvent.repository");
const {
  upsertMemberCreditor,
  deleteMemberCreditor,
} = require("../repositories/memberCreditor.repository");

const MEMBER_CREDIT_UPDATED = "accounts.member.credit.updated.v1";

async function recordAccountsEvent(payload, eventType, exchange) {
  const data = payload.data || payload;
  const tenantId = data.tenantId || payload.tenantId;
  if (!tenantId) return;

  const membershipNumber = data.memberId || data.membershipNumber || null;
  const occurredAt = new Date(
    payload.occurredAt || payload.timestamp || Date.now(),
  );

  await insertMembershipEvent({
    eventId: payload.eventId || `${eventType}-${Date.now()}`,
    eventType,
    tenantId: String(tenantId),
    subscriptionId: null,
    profileId: data.profileId ? String(data.profileId) : null,
    membershipNumber: membershipNumber ? String(membershipNumber) : null,
    occurredAt,
    sourceService:
      payload.sourceService || payload.metadata?.service || "account-service",
    correlationId: payload.correlationId || null,
    payload: { data, exchange, eventType },
  });
}

async function applyMemberCreditUpdated(data, meta) {
  const tenantId = String(data.tenantId || meta.tenantId || "").trim();
  const membershipNumber = String(
    data.memberId || data.membershipNumber || "",
  ).trim();
  if (!tenantId || !membershipNumber) return;

  const amountCents = Math.floor(Number(data.amountCents) || 0);
  if (amountCents <= 0) {
    await deleteMemberCreditor(tenantId, membershipNumber);
    return;
  }

  await upsertMemberCreditor({
    tenant_id: tenantId,
    membership_number: membershipNumber,
    full_name: data.fullName || null,
    amount_cents: amountCents,
    cause: data.cause || "Overpayment",
    refund_processed: Boolean(data.refundProcessed),
    subscription_year: data.year ?? data.subscriptionYear ?? null,
    last_event_id: meta.eventId || null,
    last_event_type: meta.eventType || MEMBER_CREDIT_UPDATED,
  });
}

async function ingestAccountsEvent(payload, eventType, exchange) {
  const data = payload.data || payload;
  const meta = {
    eventId: payload.eventId,
    eventType,
    tenantId: data.tenantId || payload.tenantId,
  };

  await recordAccountsEvent(payload, eventType, exchange);

  if (eventType === MEMBER_CREDIT_UPDATED) {
    await applyMemberCreditUpdated(data, meta);
  }
}

module.exports = {
  ingestAccountsEvent,
  MEMBER_CREDIT_UPDATED,
};
