-- Movement breakdown columns for executive dashboard analytics (stacked charts)

ALTER TABLE reports.membership_kpi_monthly
  ADD COLUMN IF NOT EXISTS new_join_in_month INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rejoin_in_month INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reinstate_in_month INTEGER NOT NULL DEFAULT 0;

ALTER TABLE reports.membership_dimension_monthly
  ADD COLUMN IF NOT EXISTS new_join_in_month INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rejoin_in_month INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reinstate_in_month INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN reports.membership_kpi_monthly.new_join_in_month IS
  'NewJoin count in calendar month (from month-end snapshot)';
COMMENT ON COLUMN reports.membership_kpi_monthly.rejoin_in_month IS
  'Rejoin count in calendar month';
COMMENT ON COLUMN reports.membership_kpi_monthly.reinstate_in_month IS
  'Reinstate count in calendar month';
