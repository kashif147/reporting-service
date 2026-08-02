const { insertIssueEvent } = require("../repositories/issueEvent.repository");
const { upsertIssueListing } = require("../repositories/issueListing.repository");

const REPORTING_SNAPSHOT = "issues.issue.reporting.snapshot.v1";

function toTimestamp(value) {
  if (value == null || value === "") return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

async function recordEvent(payload, eventType, exchange) {
  const data = payload.data || payload;
  const tenantId = data.tenantId || payload.tenantId;
  if (!tenantId) return;

  const occurredAt = new Date(
    payload.occurredAt || payload.timestamp || Date.now()
  );

  await insertIssueEvent({
    eventId: payload.eventId || `${eventType}-${Date.now()}`,
    eventType,
    tenantId: String(tenantId),
    issueId: data.issueId ? String(data.issueId) : null,
    occurredAt,
    sourceService: payload.sourceService || payload.metadata?.service || null,
    correlationId: payload.correlationId || null,
    payload: { data, exchange, eventType },
  });
}

/** Denormalized upsert into reports.issue_listing from issue-service's reporting-snapshot
 * payload (issue-service/rabbitMQ/publishers/issue.events.publisher.js's
 * publishIssueReportingSnapshot). Fired on every create/update/status-change/delete. */
function issueListingRow(data, meta = {}) {
  return {
    tenant_id: String(data.tenantId || meta.tenantId || ""),
    issue_id: String(data.issueId),
    issue_type: data.issueType,
    internal_reference_number: data.internalReferenceNumber || null,
    case_file_number: data.caseFileNumber || null,
    member_ids: Array.isArray(data.memberIds) ? data.memberIds : [],
    priority: data.priority || null,
    issue_status: data.issueStatus || null,
    owner_team: data.ownerTeam || null,
    owner_user_id: data.ownerUserId || null,
    date_received: toTimestamp(data.dateReceived),
    date_resolved: toTimestamp(data.dateResolved),
    due_date: toTimestamp(data.dueDate),
    resolution: data.resolution || null,
    last_updated: toTimestamp(data.lastUpdated) || new Date().toISOString(),
    is_current: data.isCurrent !== false,
    last_event_id: meta.eventId || null,
    last_event_type: meta.eventType || REPORTING_SNAPSHOT,
  };
}

async function applyIssueSnapshot(data, meta = {}) {
  if (!data?.issueId || !(data.tenantId || meta.tenantId)) return;
  const row = issueListingRow(data, meta);
  if (!row.tenant_id || !row.issue_id) return;
  await upsertIssueListing(row);
}

module.exports = {
  recordEvent,
  applyIssueSnapshot,
  REPORTING_SNAPSHOT,
};
