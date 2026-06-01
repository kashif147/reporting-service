ALTER TABLE reports.membership_listing
  ADD COLUMN IF NOT EXISTS member_segment TEXT NOT NULL DEFAULT 'paid';

CREATE INDEX IF NOT EXISTS idx_membership_listing_segment
  ON reports.membership_listing (tenant_id, member_segment);
