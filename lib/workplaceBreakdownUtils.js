/**
 * Rolling month slots, labels, and delta helpers for workplace breakdown report.
 */

const DISPLAY_MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function lastDayOfMonth(year, month) {
  return new Date(Date.UTC(year, month, 0));
}

function toDateOnly(d) {
  return d.toISOString().slice(0, 10);
}

/** Build rolling month slots ending at endYear/endMonth (inclusive). */
function buildRollingMonthSlots(endYear, endMonth, rollingMonths = 12) {
  const count = Math.min(Math.max(Number(rollingMonths) || 12, 1), 24);
  const anchor = new Date(Date.UTC(endYear, endMonth - 1, 1));
  const slots = [];

  for (let i = count - 1; i >= 0; i -= 1) {
    const d = new Date(
      Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() - i, 1),
    );
    const year = d.getUTCFullYear();
    const month = d.getUTCMonth() + 1;
    const asOfDate = toDateOnly(lastDayOfMonth(year, month));
    slots.push({ year, month, asOfDate });
  }

  return slots;
}

/** Short column label e.g. "Jan-24" or "Dec 2023" when year changes. */
function formatMonthColumnLabel(year, month, { priorYear } = {}) {
  const mon = DISPLAY_MONTHS[month - 1] || String(month);
  if (priorYear != null && priorYear !== year) {
    return `${mon} ${year}`;
  }
  return `${mon}-${String(year).slice(-2)}`;
}

function formatMomColumnLabel(endYear, endMonth) {
  const endMon = DISPLAY_MONTHS[endMonth - 1] || String(endMonth);
  const prev = new Date(Date.UTC(endYear, endMonth - 2, 1));
  const prevMon = DISPLAY_MONTHS[prev.getUTCMonth()] || String(prev.getUTCMonth() + 1);
  const endShort = `${endMon}-${String(endYear).slice(-2)}`;
  const prevShort = `${prevMon}-${String(prev.getUTCFullYear()).slice(-2)}`;
  return `${endShort} v ${prevShort}`;
}

/** Same calendar month one year prior (for YoY comparison). */
function buildYoyReferenceSlot(endYear, endMonth) {
  const year = endYear - 1;
  const month = endMonth;
  return {
    year,
    month,
    asOfDate: toDateOnly(lastDayOfMonth(year, month)),
  };
}

function formatYoyColumnLabel(endYear, endMonth) {
  const endMon = DISPLAY_MONTHS[endMonth - 1] || String(endMonth);
  const priorYear = endYear - 1;
  const endShort = `${endMon}-${String(endYear).slice(-2)}`;
  const priorShort = `${endMon}-${String(priorYear).slice(-2)}`;
  return `${endShort} v ${priorShort}`;
}

/** Resolve YoY prior-month count from monthly counts (works with 12+ rolling months). */
function resolveYoyPriorCount(monthlyCounts, endYear, endMonth) {
  const ref = buildYoyReferenceSlot(endYear, endMonth);
  return (
    monthlyCounts.find(
      (c) => c.year === ref.year && c.month === ref.month,
    )?.count ??
    monthlyCounts.find((c) => c.asOfDate === ref.asOfDate)?.count ??
    0
  );
}

/** Ensure YoY reference month-end is included in snapshot date list. */
function ensureYoySnapshotDate(snapshotDates, endYear, endMonth) {
  const ref = buildYoyReferenceSlot(endYear, endMonth);
  if (!snapshotDates.includes(ref.asOfDate)) {
    return [...snapshotDates, ref.asOfDate];
  }
  return snapshotDates;
}

function computeDelta(current, prior) {
  const cur = Number(current) || 0;
  const prev = Number(prior) || 0;
  const absolute = cur - prev;
  const percent =
    prev === 0 ? (cur === 0 ? 0 : 100) : Math.round((absolute / prev) * 1000) / 10;
  return { absolute, percent };
}

function regionSectionLabel(region) {
  const name = String(region || "Unknown").trim().toUpperCase();
  return `${name} REGION MEMBERSHIP STATS`;
}

const DEFAULT_EXCLUDE_GRADES = [
  "Associate",
  "Retired Nurse",
  "Retired Midwife",
  "Retired Associate",
];

module.exports = {
  buildRollingMonthSlots,
  formatMonthColumnLabel,
  formatMomColumnLabel,
  formatYoyColumnLabel,
  buildYoyReferenceSlot,
  resolveYoyPriorCount,
  ensureYoySnapshotDate,
  computeDelta,
  regionSectionLabel,
  DEFAULT_EXCLUDE_GRADES,
  DISPLAY_MONTHS,
};
