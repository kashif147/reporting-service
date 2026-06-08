-- Replicated member GL lines (1400 / 2020) for as-at finance reporting
CREATE TABLE IF NOT EXISTS reports.gl_journal_entry (
  id                BIGSERIAL PRIMARY KEY,
  event_id          TEXT NOT NULL,
  tenant_id         TEXT NOT NULL,
  journal_id        TEXT,
  doc_no            TEXT NOT NULL,
  doc_type          TEXT,
  journal_date      DATE NOT NULL,
  member_id         TEXT NOT NULL,
  account_code      TEXT NOT NULL,
  dc                CHAR(1) NOT NULL CHECK (dc IN ('D', 'C')),
  amount_cents      INTEGER NOT NULL,
  line_index        SMALLINT NOT NULL DEFAULT 0,
  reference         TEXT,
  settlement_status TEXT,
  posted_at         TIMESTAMPTZ NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT gl_journal_entry_line_key UNIQUE (tenant_id, doc_no, line_index)
);

CREATE INDEX IF NOT EXISTS idx_gl_journal_entry_tenant_date
  ON reports.gl_journal_entry (tenant_id, journal_date);

CREATE INDEX IF NOT EXISTS idx_gl_journal_entry_tenant_member_date
  ON reports.gl_journal_entry (tenant_id, member_id, journal_date)
  WHERE account_code IN ('1400', '2020');

CREATE INDEX IF NOT EXISTS idx_gl_journal_entry_event_id
  ON reports.gl_journal_entry (event_id);
