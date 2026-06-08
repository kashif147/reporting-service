-- Creditors list warehouse (organisation owes member — credit balances)
CREATE TABLE IF NOT EXISTS reports.member_creditor (
  tenant_id           TEXT NOT NULL,
  membership_number   TEXT NOT NULL,
  full_name           TEXT,
  amount_cents        INTEGER NOT NULL DEFAULT 0,
  cause               TEXT NOT NULL,
  refund_processed    BOOLEAN NOT NULL DEFAULT false,
  subscription_year   INTEGER,
  last_event_id       TEXT,
  last_event_type     TEXT,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, membership_number)
);

CREATE INDEX IF NOT EXISTS idx_member_creditor_tenant_updated
  ON reports.member_creditor (tenant_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_member_creditor_tenant_cause
  ON reports.member_creditor (tenant_id, cause);

CREATE INDEX IF NOT EXISTS idx_member_creditor_tenant_refund
  ON reports.member_creditor (tenant_id, refund_processed);
