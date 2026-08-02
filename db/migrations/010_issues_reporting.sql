-- Issue Management reporting warehouse (event log + denormalized listing)
-- Mirrors reports.membership_event / reports.membership_listing's shape (001_membership_reporting.sql).
-- Fed by issue-service's issues.issue.reporting.snapshot.v1 event on the issues.events exchange.
CREATE SCHEMA IF NOT EXISTS reports;

-- Append-only event store for every issue-reporting event received.
CREATE TABLE IF NOT EXISTS reports.issue_event (
  id              BIGSERIAL PRIMARY KEY,
  event_id        TEXT NOT NULL,
  event_type      TEXT NOT NULL,
  tenant_id       TEXT NOT NULL,
  issue_id        TEXT,
  occurred_at     TIMESTAMPTZ NOT NULL,
  source_service  TEXT,
  correlation_id  TEXT,
  payload         JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT issue_event_event_id_key UNIQUE (event_id)
);

CREATE INDEX IF NOT EXISTS idx_issue_event_tenant_occurred
  ON reports.issue_event (tenant_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_issue_event_issue
  ON reports.issue_event (tenant_id, issue_id)
  WHERE issue_id IS NOT NULL;

-- Denormalized row per issue (typed, read-optimized) for the Issues dashboard/grid.
CREATE TABLE IF NOT EXISTS reports.issue_listing (
  tenant_id                  TEXT NOT NULL,
  issue_id                   TEXT NOT NULL,
  issue_type                 TEXT NOT NULL,
  internal_reference_number  TEXT,
  case_file_number           TEXT,
  member_ids                 JSONB NOT NULL DEFAULT '[]'::jsonb,
  priority                   TEXT,
  issue_status                TEXT,
  owner_team                 TEXT,
  owner_user_id              TEXT,
  date_received              TIMESTAMPTZ,
  date_resolved               TIMESTAMPTZ,
  due_date                    TIMESTAMPTZ,
  resolution                  TEXT,
  last_updated                TIMESTAMPTZ,
  is_current                  BOOLEAN NOT NULL DEFAULT true,
  last_event_id                TEXT,
  last_event_type              TEXT,
  updated_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, issue_id)
);

CREATE INDEX IF NOT EXISTS idx_issue_listing_tenant_type
  ON reports.issue_listing (tenant_id, issue_type);

CREATE INDEX IF NOT EXISTS idx_issue_listing_tenant_priority
  ON reports.issue_listing (tenant_id, priority);

CREATE INDEX IF NOT EXISTS idx_issue_listing_tenant_current
  ON reports.issue_listing (tenant_id, is_current)
  WHERE is_current = true;

CREATE INDEX IF NOT EXISTS idx_issue_listing_tenant_owner_team
  ON reports.issue_listing (tenant_id, owner_team);

CREATE INDEX IF NOT EXISTS idx_issue_listing_tenant_due_date
  ON reports.issue_listing (tenant_id, due_date)
  WHERE due_date IS NOT NULL;
