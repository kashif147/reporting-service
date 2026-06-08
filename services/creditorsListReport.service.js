const {
  listMemberCreditorsAsOf,
} = require("../repositories/glJournalEntry.repository");
const {
  lookupMemberNamesByMembershipNumbers,
} = require("../repositories/memberCreditor.repository");

function centsToEuro(amountCents) {
  const cents = Number(amountCents) || 0;
  return Math.round((cents / 100) * 100) / 100;
}

function normalizeSearchTerm(search) {
  return String(search ?? "").trim().toLowerCase();
}

function rowMatchesSearch(row, searchTerm) {
  if (!searchTerm) return true;
  const haystack = [row.membershipNo, row.fullName, row.memberId]
    .map((v) => String(v || "").toLowerCase())
    .join(" ");
  return haystack.includes(searchTerm);
}

/**
 * Creditors list as at reporting date — balances from reporting_db.gl_journal_entry.
 */
async function getCreditorsListReport(tenantId, filters = {}) {
  const {
    offset = 0,
    limit = 5000,
    search,
    periodMode,
    year,
    month,
    dateFrom,
    dateTo,
    asOf,
  } = filters;

  let asOfResult;
  try {
    asOfResult = await listMemberCreditorsAsOf(tenantId, {
      year,
      month,
      dateFrom,
      dateTo,
      asOf,
    });
  } catch (err) {
    const message = err.message || "Invalid reporting period";
    const error = new Error(message);
    error.statusCode = 400;
    throw error;
  }

  const rawRows = asOfResult.rows || [];
  const memberIds = rawRows.map((row) => row.memberId).filter(Boolean);
  const nameMap = await lookupMemberNamesByMembershipNumbers(tenantId, memberIds);

  let rows = rawRows.map((row, index) => {
    const memberId = String(row.memberId || "").trim();
    const profile = nameMap.get(memberId);
    return {
      id: memberId || `creditor-${index}`,
      memberId,
      membershipNo: profile?.membershipNo || memberId || "—",
      fullName: profile?.fullName || "—",
      amount: centsToEuro(row.amountCents),
    };
  });

  const searchTerm = normalizeSearchTerm(search);
  if (searchTerm) {
    rows = rows.filter((row) => rowMatchesSearch(row, searchTerm));
  }

  const total = rows.length;
  const safeOffset = Math.max(0, Number(offset) || 0);
  const safeLimit = Math.min(Math.max(1, Number(limit) || 5000), 5000);
  const pagedRows = rows.slice(safeOffset, safeOffset + safeLimit);

  return {
    asOf: asOfResult.asOfDate ? `${asOfResult.asOfDate}T23:59:59.999Z` : null,
    asOfDate: asOfResult.asOfDate,
    periodMode: asOfResult.periodMode || periodMode || null,
    year: asOfResult.year ?? year ?? null,
    month: asOfResult.month ?? month ?? null,
    dateFrom: asOfResult.dateFrom ?? dateFrom ?? null,
    dateTo: asOfResult.dateTo ?? dateTo ?? null,
    rows: pagedRows,
    total,
    offset: safeOffset,
    limit: safeLimit,
  };
}

module.exports = {
  getCreditorsListReport,
};
