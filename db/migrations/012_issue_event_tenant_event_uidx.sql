-- Phase A / A5: per-tenant event id uniqueness for issue events (single statement; see 011).
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_issue_event_tenant_event ON reports.issue_event (tenant_id, event_id);
