-- Point-in-time member rows for period comparisons (month-end, year-end, custom as-of)
CREATE TABLE IF NOT EXISTS reports.membership_period_snapshot (
  tenant_id           TEXT NOT NULL,
  snapshot_date       DATE NOT NULL,
  subscription_id     TEXT NOT NULL,
  profile_id          TEXT NOT NULL,
  membership_number   TEXT,
  full_name           TEXT,
  membership_status   TEXT NOT NULL,
  membership_movement TEXT,
  start_date          DATE,
  expiry_date         DATE,
  cancelled_at        TIMESTAMPTZ,
  resigned_at         TIMESTAMPTZ,
  processed_at        TIMESTAMPTZ,
  membership_category TEXT,
  grade               TEXT,
  work_location       TEXT,
  branch              TEXT,
  region              TEXT,
  section             TEXT,
  payment_type        TEXT,
  payment_frequency   TEXT,
  subscription_year   INTEGER,
  member_segment      TEXT NOT NULL DEFAULT 'paid',
  is_current          BOOLEAN NOT NULL DEFAULT false,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, snapshot_date, subscription_id)
);

CREATE INDEX IF NOT EXISTS idx_period_snapshot_tenant_date_status
  ON reports.membership_period_snapshot (tenant_id, snapshot_date, membership_status);

CREATE INDEX IF NOT EXISTS idx_period_snapshot_tenant_date_segment
  ON reports.membership_period_snapshot (tenant_id, snapshot_date, member_segment);

-- Monthly KPI totals (dashboard + comparison headline figures)
CREATE TABLE IF NOT EXISTS reports.membership_kpi_monthly (
  tenant_id         TEXT NOT NULL,
  period_year       INTEGER NOT NULL,
  period_month      INTEGER NOT NULL,
  active_total      INTEGER NOT NULL DEFAULT 0,
  joiners           INTEGER NOT NULL DEFAULT 0,
  leavers           INTEGER NOT NULL DEFAULT 0,
  net_growth        INTEGER NOT NULL DEFAULT 0,
  paid_active       INTEGER NOT NULL DEFAULT 0,
  student_active    INTEGER NOT NULL DEFAULT 0,
  honorary_active   INTEGER NOT NULL DEFAULT 0,
  cancelled_in_month INTEGER NOT NULL DEFAULT 0,
  resigned_in_month  INTEGER NOT NULL DEFAULT 0,
  computed_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, period_year, period_month)
);

-- Monthly breakdown by dimension (live stats + dashboard charts)
CREATE TABLE IF NOT EXISTS reports.membership_dimension_monthly (
  tenant_id           TEXT NOT NULL,
  period_year         INTEGER NOT NULL,
  period_month        INTEGER NOT NULL,
  dimension           TEXT NOT NULL,
  dimension_value     TEXT NOT NULL DEFAULT '',
  member_segment      TEXT NOT NULL DEFAULT 'paid',
  active_count        INTEGER NOT NULL DEFAULT 0,
  cancelled_in_month  INTEGER NOT NULL DEFAULT 0,
  resigned_in_month   INTEGER NOT NULL DEFAULT 0,
  joiners_in_month    INTEGER NOT NULL DEFAULT 0,
  leavers_in_month    INTEGER NOT NULL DEFAULT 0,
  computed_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (
    tenant_id, period_year, period_month, dimension, dimension_value, member_segment
  )
);
