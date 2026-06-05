-- Workplace membership breakdown: location lookup ref + optional monthly pre-aggregate

CREATE TABLE IF NOT EXISTS reports.membership_location_lookup (
  tenant_id               TEXT NOT NULL,
  work_location           TEXT NOT NULL,
  branch                  TEXT,
  region                  TEXT,
  lookup_id               TEXT,
  officer_user_id         TEXT,
  officer_initials        TEXT,
  officer_display_name    TEXT,
  branch_officer_user_id  TEXT,
  region_officer_user_id  TEXT,
  synced_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, work_location)
);

CREATE INDEX IF NOT EXISTS idx_location_lookup_tenant_region
  ON reports.membership_location_lookup (tenant_id, region);

CREATE INDEX IF NOT EXISTS idx_location_lookup_tenant_officer
  ON reports.membership_location_lookup (tenant_id, officer_user_id);

CREATE TABLE IF NOT EXISTS reports.membership_worklocation_monthly (
  tenant_id               TEXT NOT NULL,
  period_year             INTEGER NOT NULL,
  period_month            INTEGER NOT NULL,
  work_location           TEXT NOT NULL,
  branch                  TEXT,
  region                  TEXT,
  officer_user_id         TEXT,
  eligible_member_count   INTEGER NOT NULL DEFAULT 0,
  computed_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, period_year, period_month, work_location)
);

CREATE INDEX IF NOT EXISTS idx_worklocation_monthly_tenant_period
  ON reports.membership_worklocation_monthly (tenant_id, period_year, period_month);

CREATE INDEX IF NOT EXISTS idx_worklocation_monthly_tenant_region
  ON reports.membership_worklocation_monthly (tenant_id, region);
