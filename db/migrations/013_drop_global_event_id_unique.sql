-- Phase A / A5: drop the GLOBAL UNIQUE(event_id) constraints once 011/012 exist and the ingest code
-- uses ON CONFLICT (tenant_id, event_id). Run only after that code is deployed (old code targets
-- ON CONFLICT (event_id) and needs the old constraint). Re-run safe (IF EXISTS).
ALTER TABLE reports.membership_event DROP CONSTRAINT IF EXISTS membership_event_event_id_key;
ALTER TABLE reports.issue_event DROP CONSTRAINT IF EXISTS issue_event_event_id_key;
