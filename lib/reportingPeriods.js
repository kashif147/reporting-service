/**
 * Resolve reporting period labels to an as-of calendar date (inclusive, end of period).
 */

function lastDayOfMonth(year, month) {
  return new Date(Date.UTC(year, month, 0));
}

function toDateOnly(d) {
  return d.toISOString().slice(0, 10);
}

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

/** DD MMM YYYY for report headers (UTC calendar date). */
function formatDisplayDate(isoDate) {
  const [year, month, day] = String(isoDate).split("-").map(Number);
  if (!year || !month || !day) return String(isoDate);
  return `${String(day).padStart(2, "0")} ${DISPLAY_MONTHS[month - 1]} ${year}`;
}

/**
 * @param {{ type: string, year?: number, month?: number, date?: string }} period
 * @returns {{ asOfDate: string, label: string, year: number, month: number }}
 */
function resolvePeriod(period = {}) {
  const type = period.type || "month_end";
  const year = Number(period.year);
  const month = Number(period.month);

  if (type === "custom" && period.date) {
    const d = new Date(period.date);
    if (Number.isNaN(d.getTime())) throw new Error("Invalid custom period date");
    const asOf = toDateOnly(d);
    return {
      asOfDate: asOf,
      label: asOf,
      year: d.getUTCFullYear(),
      month: d.getUTCMonth() + 1,
    };
  }

  if (type === "year_end") {
    if (!year) throw new Error("year required for year_end period");
    return {
      asOfDate: `${year}-12-31`,
      label: `Year end ${year}`,
      year,
      month: 12,
    };
  }

  if (type === "month_end") {
    if (!year || !month) throw new Error("year and month required for month_end period");
    const end = lastDayOfMonth(year, month);
    return {
      asOfDate: toDateOnly(end),
      label: `${year}-${String(month).padStart(2, "0")}`,
      year,
      month,
    };
  }

  throw new Error(`Unknown period type: ${type}`);
}

/** Current calendar month (UTC). */
function currentMonthPeriod() {
  const now = new Date();
  return resolvePeriod({
    type: "month_end",
    year: now.getUTCFullYear(),
    month: now.getUTCMonth() + 1,
  });
}

function previousMonthPeriod(ref = new Date()) {
  const y = ref.getUTCFullYear();
  const m = ref.getUTCMonth();
  const prev = new Date(Date.UTC(y, m - 1, 1));
  return resolvePeriod({
    type: "month_end",
    year: prev.getUTCFullYear(),
    month: prev.getUTCMonth() + 1,
  });
}

function sameMonthLastYear(ref = new Date()) {
  return resolvePeriod({
    type: "month_end",
    year: ref.getUTCFullYear() - 1,
    month: ref.getUTCMonth() + 1,
  });
}

function yearToDateEnd(ref = new Date()) {
  return resolvePeriod({ type: "custom", date: toDateOnly(ref) });
}

function lastYearToDateEnd(ref = new Date()) {
  const d = new Date(ref);
  d.setUTCFullYear(d.getUTCFullYear() - 1);
  return resolvePeriod({ type: "custom", date: toDateOnly(d) });
}

function monthRange(year, month) {
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 1));
  return { start: start.toISOString(), end: end.toISOString() };
}

module.exports = {
  resolvePeriod,
  currentMonthPeriod,
  previousMonthPeriod,
  sameMonthLastYear,
  yearToDateEnd,
  lastYearToDateEnd,
  monthRange,
  lastDayOfMonth,
  toDateOnly,
  formatDisplayDate,
};
