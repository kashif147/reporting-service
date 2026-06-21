ALTER TABLE reports.membership_listing
  ADD COLUMN IF NOT EXISTS previous_subscription_id TEXT,
  ADD COLUMN IF NOT EXISTS previous_membership_status TEXT,
  ADD COLUMN IF NOT EXISTS movement_resolved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS renewal_batch_id TEXT,
  ADD COLUMN IF NOT EXISTS year_end_fiscal_year INTEGER,
  ADD COLUMN IF NOT EXISTS year_end_action TEXT,
  ADD COLUMN IF NOT EXISTS new_membership_status TEXT,
  ADD COLUMN IF NOT EXISTS snapshot_as_of_date DATE;

CREATE INDEX IF NOT EXISTS idx_membership_listing_renewal_batch
  ON reports.membership_listing (tenant_id, renewal_batch_id)
  WHERE renewal_batch_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_membership_listing_year_end_action
  ON reports.membership_listing (tenant_id, year_end_fiscal_year, year_end_action)
  WHERE year_end_fiscal_year IS NOT NULL;
