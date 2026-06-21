-- Membership reporting warehouse (event log + denormalized listing)
CREATE SCHEMA IF NOT EXISTS reports;

-- Append-only event store (all membership/profile reporting events)
CREATE TABLE IF NOT EXISTS reports.membership_event (
  id              BIGSERIAL PRIMARY KEY,
  event_id        TEXT NOT NULL,
  event_type      TEXT NOT NULL,
  tenant_id       TEXT NOT NULL,
  subscription_id TEXT,
  profile_id      TEXT,
  membership_number TEXT,
  occurred_at     TIMESTAMPTZ NOT NULL,
  source_service  TEXT,
  correlation_id  TEXT,
  payload         JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT membership_event_event_id_key UNIQUE (event_id)
);

CREATE INDEX IF NOT EXISTS idx_membership_event_tenant_occurred
  ON reports.membership_event (tenant_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_membership_event_subscription
  ON reports.membership_event (tenant_id, subscription_id)
  WHERE subscription_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_membership_event_profile
  ON reports.membership_event (tenant_id, profile_id)
  WHERE profile_id IS NOT NULL;

-- Denormalized row per subscription (year) for listing reports
CREATE TABLE IF NOT EXISTS reports.membership_listing (
  tenant_id             TEXT NOT NULL,
  subscription_id       TEXT NOT NULL,
  profile_id            TEXT NOT NULL,
  membership_number     TEXT,
  full_name             TEXT,
  membership_status     TEXT NOT NULL,
  membership_movement   TEXT,
  start_date            DATE,
  expiry_date           DATE,
  cancelled_at          TIMESTAMPTZ,
  resigned_at           TIMESTAMPTZ,
  processed_at          TIMESTAMPTZ,
  membership_category   TEXT,
  grade                 TEXT,
  work_location         TEXT,
  branch                TEXT,
  region                TEXT,
  section               TEXT,
  payment_type          TEXT,
  payment_frequency     TEXT,
  subscription_year     INTEGER,
  is_current            BOOLEAN NOT NULL DEFAULT false,
  previous_subscription_id TEXT,
  previous_membership_status TEXT,
  movement_resolved_at  TIMESTAMPTZ,
  renewal_batch_id      TEXT,
  year_end_fiscal_year  INTEGER,
  year_end_action       TEXT,
  new_membership_status TEXT,
  snapshot_as_of_date   DATE,
  last_event_id         TEXT,
  last_event_type       TEXT,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, subscription_id)
);

-- Keep this baseline migration safe for existing databases. CREATE TABLE IF NOT EXISTS
-- does not add columns when reports.membership_listing already exists, but this file
-- still creates indexes on newer listing columns below.
ALTER TABLE reports.membership_listing
  ADD COLUMN IF NOT EXISTS previous_subscription_id TEXT,
  ADD COLUMN IF NOT EXISTS previous_membership_status TEXT,
  ADD COLUMN IF NOT EXISTS movement_resolved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS renewal_batch_id TEXT,
  ADD COLUMN IF NOT EXISTS year_end_fiscal_year INTEGER,
  ADD COLUMN IF NOT EXISTS year_end_action TEXT,
  ADD COLUMN IF NOT EXISTS new_membership_status TEXT,
  ADD COLUMN IF NOT EXISTS snapshot_as_of_date DATE;

CREATE INDEX IF NOT EXISTS idx_membership_listing_tenant_status
  ON reports.membership_listing (tenant_id, membership_status);

CREATE INDEX IF NOT EXISTS idx_membership_listing_tenant_movement
  ON reports.membership_listing (tenant_id, membership_movement);

CREATE INDEX IF NOT EXISTS idx_membership_listing_tenant_current
  ON reports.membership_listing (tenant_id, is_current)
  WHERE is_current = true;

CREATE INDEX IF NOT EXISTS idx_membership_listing_tenant_year
  ON reports.membership_listing (tenant_id, subscription_year);

CREATE INDEX IF NOT EXISTS idx_membership_listing_start_date
  ON reports.membership_listing (tenant_id, start_date);

CREATE INDEX IF NOT EXISTS idx_membership_listing_cancelled_at
  ON reports.membership_listing (tenant_id, cancelled_at);

CREATE INDEX IF NOT EXISTS idx_membership_listing_resigned_at
  ON reports.membership_listing (tenant_id, resigned_at);

CREATE INDEX IF NOT EXISTS idx_membership_listing_processed_at
  ON reports.membership_listing (tenant_id, processed_at);

CREATE INDEX IF NOT EXISTS idx_membership_listing_profile
  ON reports.membership_listing (tenant_id, profile_id);

CREATE INDEX IF NOT EXISTS idx_membership_listing_renewal_batch
  ON reports.membership_listing (tenant_id, renewal_batch_id)
  WHERE renewal_batch_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_membership_listing_year_end_action
  ON reports.membership_listing (tenant_id, year_end_fiscal_year, year_end_action)
  WHERE year_end_fiscal_year IS NOT NULL;
