-- Phase A / A5: event ids are unique per TENANT, not globally (a second tenant's event must not be
-- silently dropped). Exactly ONE statement in this file: CREATE INDEX CONCURRENTLY cannot run inside the
-- implicit transaction of a multi-statement query. Re-run safe (IF NOT EXISTS). If a previous concurrent
-- build failed, the INVALID index must be dropped first (see docs in the Phase A runbook).
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_membership_event_tenant_event ON reports.membership_event (tenant_id, event_id);
