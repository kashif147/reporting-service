const { pool } = require("../db/postgres");
const { computeDebtorAgeBuckets } = require("../helpers/debtorAging.helper");

const MEMBER_AR_ACCOUNTS = ["1400", "2020"];

function isMemberKey(memberId) {
  const mid = String(memberId || "").trim();
  if (!mid) return false;
  return !mid.toLowerCase().startsWith("app:");
}

function resolveAsOfDate({ year, month, dateTo, asOf }) {
  if (year != null && month != null && month !== "") {
    const y = Number(year);
    const m = Number(month);
    if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) {
      throw new Error("Invalid year or month");
    }
    const lastDay = new Date(Date.UTC(y, m, 0));
    return lastDay.toISOString().slice(0, 10);
  }
  if (dateTo) {
    const match = String(dateTo).trim().match(/^(\d{4}-\d{2}-\d{2})/);
    if (!match) throw new Error("Invalid dateTo");
    return match[1];
  }
  if (asOf) {
    const match = String(asOf).trim().match(/^(\d{4}-\d{2}-\d{2})/);
    if (!match) throw new Error("Invalid asOf");
    return match[1];
  }
  throw new Error("Reporting period required: year and month, or dateTo");
}

async function upsertGlJournalLines(lines = []) {
  if (!lines.length) return 0;

  let inserted = 0;
  for (const line of lines) {
    const res = await pool.query(
      `INSERT INTO gl_journal_entry (
         event_id, tenant_id, journal_id, doc_no, doc_type, journal_date,
         member_id, account_code, dc, amount_cents, line_index, reference,
         settlement_status, posted_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       ON CONFLICT (tenant_id, doc_no, line_index) DO UPDATE SET
         event_id = EXCLUDED.event_id,
         journal_id = EXCLUDED.journal_id,
         doc_type = EXCLUDED.doc_type,
         journal_date = EXCLUDED.journal_date,
         member_id = EXCLUDED.member_id,
         account_code = EXCLUDED.account_code,
         dc = EXCLUDED.dc,
         amount_cents = EXCLUDED.amount_cents,
         reference = EXCLUDED.reference,
         settlement_status = EXCLUDED.settlement_status,
         posted_at = EXCLUDED.posted_at
       RETURNING id`,
      [
        line.event_id,
        line.tenant_id,
        line.journal_id || null,
        line.doc_no,
        line.doc_type || null,
        line.journal_date,
        line.member_id,
        line.account_code,
        line.dc,
        line.amount_cents,
        line.line_index,
        line.reference || null,
        line.settlement_status || null,
        line.posted_at,
      ],
    );
    if (res.rowCount) inserted += 1;
  }
  return inserted;
}

/**
 * Creditors (org owes member) as at journal_date <= asOfDate from replicated GL.
 * Combined net = ar1400 + poa2020 (Irish POA / member-credit liability treatment).
 */
async function listMemberCreditorsAsOf(tenantId, period = {}) {
  const asOfDate = resolveAsOfDate(period);
  let periodMode = "asOf";
  let periodYear = null;
  let periodMonth = null;
  let periodDateFrom = null;
  let periodDateTo = asOfDate;

  if (period.year != null && period.month != null && period.month !== "") {
    periodMode = "monthYear";
    periodYear = Number(period.year);
    periodMonth = Number(period.month);
  } else if (period.dateTo) {
    periodMode = "dateRange";
    if (period.dateFrom) {
      const fromMatch = String(period.dateFrom)
        .trim()
        .match(/^(\d{4}-\d{2}-\d{2})/);
      periodDateFrom = fromMatch ? fromMatch[1] : String(period.dateFrom).trim();
    }
  }

  const res = await pool.query(
    `WITH line_balances AS (
       SELECT
         member_id,
         account_code,
         SUM(
           CASE WHEN dc = 'D' THEN amount_cents ELSE -amount_cents END
         )::bigint AS amount_cents
       FROM gl_journal_entry
       WHERE tenant_id = $1
         AND journal_date <= $2::date
         AND account_code = ANY($3::text[])
         AND member_id IS NOT NULL
       GROUP BY member_id, account_code
     ),
     member_net AS (
       SELECT
         member_id,
         COALESCE(MAX(CASE WHEN account_code = '1400' THEN amount_cents END), 0)::bigint AS ar1400,
         COALESCE(MAX(CASE WHEN account_code = '2020' THEN amount_cents END), 0)::bigint AS poa2020
       FROM line_balances
       GROUP BY member_id
     )
     SELECT
       member_id,
       (ar1400 + poa2020)::bigint AS net_cents,
       CASE WHEN (ar1400 + poa2020) < 0 THEN -(ar1400 + poa2020) ELSE 0 END::bigint AS amount_cents
     FROM member_net
     WHERE (ar1400 + poa2020) < 0
     ORDER BY member_id ASC`,
    [tenantId, asOfDate, MEMBER_AR_ACCOUNTS],
  );

  const rows = (res.rows || [])
    .filter((row) => isMemberKey(row.member_id))
    .map((row) => ({
      memberId: String(row.member_id).trim(),
      amountCents: Number(row.amount_cents) || 0,
    }))
    .filter((row) => row.amountCents > 0);

  return {
    asOfDate,
    periodMode,
    year: periodYear,
    month: periodMonth,
    dateFrom: periodDateFrom,
    dateTo: periodDateTo,
    rows,
    total: rows.length,
  };
}

/**
 * Debtors (member owes organisation) as at journal_date <= asOfDate from replicated GL.
 * Combined net = ar1400 + poa2020; debtor when net > 0. Age analysis via FIFO on 1400 charges.
 */
async function listMemberDebtorsAsOf(tenantId, period = {}) {
  const asOfDate = resolveAsOfDate(period);
  let periodMode = "asOf";
  let periodYear = null;
  let periodMonth = null;
  let periodDateFrom = null;
  let periodDateTo = asOfDate;

  if (period.year != null && period.month != null && period.month !== "") {
    periodMode = "monthYear";
    periodYear = Number(period.year);
    periodMonth = Number(period.month);
  } else if (period.dateTo) {
    periodMode = "dateRange";
    if (period.dateFrom) {
      const fromMatch = String(period.dateFrom)
        .trim()
        .match(/^(\d{4}-\d{2}-\d{2})/);
      periodDateFrom = fromMatch ? fromMatch[1] : String(period.dateFrom).trim();
    }
  }

  const netRes = await pool.query(
    `WITH line_balances AS (
       SELECT
         member_id,
         account_code,
         SUM(
           CASE WHEN dc = 'D' THEN amount_cents ELSE -amount_cents END
         )::bigint AS amount_cents
       FROM gl_journal_entry
       WHERE tenant_id = $1
         AND journal_date <= $2::date
         AND account_code = ANY($3::text[])
         AND member_id IS NOT NULL
       GROUP BY member_id, account_code
     ),
     member_net AS (
       SELECT
         member_id,
         COALESCE(MAX(CASE WHEN account_code = '1400' THEN amount_cents END), 0)::bigint AS ar1400,
         COALESCE(MAX(CASE WHEN account_code = '2020' THEN amount_cents END), 0)::bigint AS poa2020
       FROM line_balances
       GROUP BY member_id
     )
     SELECT
       member_id,
       (ar1400 + poa2020)::bigint AS net_cents,
       CASE WHEN (ar1400 + poa2020) > 0 THEN (ar1400 + poa2020) ELSE 0 END::bigint AS amount_cents
     FROM member_net
     WHERE (ar1400 + poa2020) > 0
     ORDER BY member_id ASC`,
    [tenantId, asOfDate, MEMBER_AR_ACCOUNTS],
  );

  const debtorMembers = (netRes.rows || [])
    .filter((row) => isMemberKey(row.member_id))
    .map((row) => ({
      memberId: String(row.member_id).trim(),
      amountCents: Number(row.amount_cents) || 0,
    }))
    .filter((row) => row.amountCents > 0);

  if (!debtorMembers.length) {
    return {
      asOfDate,
      periodMode,
      year: periodYear,
      month: periodMonth,
      dateFrom: periodDateFrom,
      dateTo: periodDateTo,
      rows: [],
      total: 0,
    };
  }

  const memberIds = debtorMembers.map((row) => row.memberId);
  const linesRes = await pool.query(
    `SELECT
       member_id,
       account_code,
       dc,
       amount_cents,
       journal_date
     FROM gl_journal_entry
     WHERE tenant_id = $1
       AND journal_date <= $2::date
       AND account_code = ANY($3::text[])
       AND member_id = ANY($4::text[])
     ORDER BY member_id ASC, journal_date ASC, line_index ASC`,
    [tenantId, asOfDate, MEMBER_AR_ACCOUNTS, memberIds],
  );

  const linesByMember = new Map();
  for (const line of linesRes.rows || []) {
    const memberId = String(line.member_id || "").trim();
    if (!memberId) continue;
    if (!linesByMember.has(memberId)) linesByMember.set(memberId, []);
    linesByMember.get(memberId).push(line);
  }

  const rows = debtorMembers.map((row) => ({
    memberId: row.memberId,
    amountCents: row.amountCents,
    aging: computeDebtorAgeBuckets(linesByMember.get(row.memberId) || [], asOfDate),
  }));

  return {
    asOfDate,
    periodMode,
    year: periodYear,
    month: periodMonth,
    dateFrom: periodDateFrom,
    dateTo: periodDateTo,
    rows,
    total: rows.length,
  };
}

module.exports = {
  upsertGlJournalLines,
  listMemberCreditorsAsOf,
  listMemberDebtorsAsOf,
  resolveAsOfDate,
  isMemberKey,
  MEMBER_AR_ACCOUNTS,
};
