ALTER TABLE reports.membership_listing
  ADD COLUMN IF NOT EXISTS full_address TEXT;

CREATE INDEX IF NOT EXISTS idx_membership_listing_tenant_membership_number
  ON reports.membership_listing (tenant_id, membership_number)
  WHERE membership_number IS NOT NULL;
