const {
  listMemberDebtorsAsOf,
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
  const haystack = [
    row.membershipNo,
    row.fullName,
    row.fullAddress,
    row.grade,
    row.workLocation,
    row.memberId,
  ]
    .map((v) => String(v || "").toLowerCase())
    .join(" ");
  return haystack.includes(searchTerm);
}

function normalizeDebtorsPeriodFilters(filters = {}) {
  const {
    periodMode,
    year,
    month,
    dateFrom,
    dateTo,
    asOf,
    reportingPeriod,
  } = filters;

  if (year != null && month != null && month !== "") {
    return { year, month, dateFrom, dateTo, asOf, periodMode: periodMode || "monthYear" };
  }

  const rp =
    reportingPeriod && typeof reportingPeriod === "object"
      ? reportingPeriod
      : null;
  const resolvedFrom = dateFrom || rp?.from || null;
  const resolvedTo = dateTo || asOf || rp?.to || null;

  if (resolvedTo) {
    return {
      periodMode: periodMode || "dateRange",
      dateFrom: resolvedFrom || undefined,
      dateTo: resolvedTo,
    };
  }

  throw new Error("Reporting period required: provide reportingPeriod.to or dateTo");
}

/**
 * Debtors list as at reporting date — balances from reporting_db.gl_journal_entry.
 */
async function getDebtorsListReport(tenantId, filters = {}) {
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

  let period;
  try {
    period = normalizeDebtorsPeriodFilters(filters);
  } catch (err) {
    const error = new Error(err.message || "Invalid reporting period");
    error.statusCode = 400;
    throw error;
  }

  let asOfResult;
  try {
    asOfResult = await listMemberDebtorsAsOf(tenantId, period);
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
      id: memberId || `debtor-${index}`,
      memberId,
      membershipNo: profile?.membershipNo || memberId || "—",
      fullName: profile?.fullName || "—",
      fullAddress: profile?.fullAddress || "—",
      grade: profile?.grade || "—",
      workLocation: profile?.workLocation || "—",
      amount: centsToEuro(row.amountCents),
      current: centsToEuro(row.aging?.current),
      days30: centsToEuro(row.aging?.days30),
      days60: centsToEuro(row.aging?.days60),
      days90: centsToEuro(row.aging?.days90),
      over90: centsToEuro(row.aging?.over90),
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
    periodMode: asOfResult.periodMode || period.periodMode || periodMode || null,
    year: asOfResult.year ?? period.year ?? year ?? null,
    month: asOfResult.month ?? period.month ?? month ?? null,
    dateFrom: asOfResult.dateFrom ?? period.dateFrom ?? dateFrom ?? null,
    dateTo: asOfResult.dateTo ?? period.dateTo ?? dateTo ?? null,
    rows: pagedRows,
    total,
    offset: safeOffset,
    limit: safeLimit,
  };
}

module.exports = {
  getDebtorsListReport,
};
