const { insertMembershipEvent } = require("../repositories/membershipEvent.repository");
const { upsertGlJournalLines } = require("../repositories/glJournalEntry.repository");

const JOURNAL_CREATED = "journal.created.v1";
const REPLICATED_ACCOUNTS = new Set(["1400", "2020"]);

function toJournalDate(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function buildReplicationLines(payload, eventType) {
  const data = payload.data || payload;
  const tenantId = String(data.tenantId || payload.tenantId || "").trim();
  if (!tenantId) return [];

  const docNo = String(data.docNo || "").trim();
  if (!docNo) return [];

  const journalDate = toJournalDate(data.date);
  if (!journalDate) return [];

  const eventId =
    payload.eventId ||
    `${eventType}-${docNo}-${payload.timestamp || Date.now()}`;
  const postedAt = new Date(payload.timestamp || data.date || Date.now());
  const settlementStatus = data.settlement?.status || null;
  const entries = Array.isArray(data.entries) ? data.entries : [];

  const lines = [];
  entries.forEach((entry, lineIndex) => {
    const accountCode = String(entry.accountCode || "").trim();
    if (!REPLICATED_ACCOUNTS.has(accountCode)) return;

    const memberId = String(entry.memberId || data.memberId || "").trim();
    if (!memberId) return;

    const dc = entry.dc === "C" ? "C" : "D";
    const amountCents = Math.max(0, Math.floor(Number(entry.amount) || 0));
    if (amountCents <= 0) return;

    lines.push({
      event_id: eventId,
      tenant_id: tenantId,
      journal_id: data.journalId ? String(data.journalId) : null,
      doc_no: docNo,
      doc_type: data.docType ? String(data.docType) : null,
      journal_date: journalDate,
      member_id: memberId,
      account_code: accountCode,
      dc,
      amount_cents: amountCents,
      line_index: lineIndex,
      reference: data.reference ? String(data.reference) : null,
      settlement_status: settlementStatus,
      posted_at: postedAt,
    });
  });

  return lines;
}

async function recordJournalEvent(payload, eventType, exchange) {
  const data = payload.data || payload;
  const tenantId = data.tenantId || payload.tenantId;
  if (!tenantId) return;

  await insertMembershipEvent({
    eventId: payload.eventId || `${eventType}-${Date.now()}`,
    eventType,
    tenantId: String(tenantId),
    subscriptionId: null,
    profileId: null,
    membershipNumber: data.memberId ? String(data.memberId) : null,
    occurredAt: new Date(payload.timestamp || payload.occurredAt || Date.now()),
    sourceService:
      payload.sourceService || payload.metadata?.service || "account-service",
    correlationId: payload.correlationId || null,
    payload: { data, exchange, eventType },
  });
}

async function ingestJournalEvent(payload, eventType, exchange) {
  if (eventType !== JOURNAL_CREATED) return;

  await recordJournalEvent(payload, eventType, exchange);

  const lines = buildReplicationLines(payload, eventType);
  if (!lines.length) return;

  await upsertGlJournalLines(lines);
}

module.exports = {
  ingestJournalEvent,
  buildReplicationLines,
  JOURNAL_CREATED,
};
