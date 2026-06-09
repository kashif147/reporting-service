/**
 * FIFO age analysis on member AR (1400) charges, applying 1400 credits and 2020 debits.
 * Age is measured in whole days from charge journal_date to the reporting as-of date.
 *
 * Buckets (non-overlapping):
 * - current: 0–29 days
 * - days30: 30–59 days
 * - days60: 60–89 days
 * - days90: 90–119 days
 * - over90: 120+ days
 */

function parseIsoDate(value) {
  const match = String(value || "").trim().match(/^(\d{4}-\d{2}-\d{2})/);
  if (!match) return null;
  const [y, m, d] = match[1].split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

function ageDaysFromCharge(chargeDate, asOfDate) {
  const chargeMs = parseIsoDate(chargeDate);
  const asOfMs = parseIsoDate(asOfDate);
  if (chargeMs == null || asOfMs == null) return 0;
  return Math.max(0, Math.floor((asOfMs - chargeMs) / (1000 * 60 * 60 * 24)));
}

function bucketForAgeDays(ageDays) {
  const days = Number(ageDays) || 0;
  if (days < 30) return "current";
  if (days < 60) return "days30";
  if (days < 90) return "days60";
  if (days < 120) return "days90";
  return "over90";
}

function emptyBuckets() {
  return {
    current: 0,
    days30: 0,
    days60: 0,
    days90: 0,
    over90: 0,
  };
}

/**
 * @param {Array<{ account_code: string, dc: string, amount_cents: number, journal_date: string|Date }>} lines
 * @param {string} asOfDate YYYY-MM-DD
 * @returns {{ current: number, days30: number, days60: number, days90: number, over90: number }}
 */
function computeDebtorAgeBuckets(lines = [], asOfDate) {
  const buckets = emptyBuckets();
  if (!lines.length || !asOfDate) return buckets;

  const charges = [];
  const payments = [];

  for (const line of lines) {
    const account = String(line.account_code || "").trim();
    const amount = Math.max(0, Math.floor(Number(line.amount_cents) || 0));
    if (!amount) continue;
    const dc = String(line.dc || "").toUpperCase();
    const date =
      line.journal_date instanceof Date
        ? line.journal_date.toISOString().slice(0, 10)
        : String(line.journal_date || "").slice(0, 10);

    if (account === "1400" && dc === "D") {
      charges.push({ date, amountCents: amount });
    } else if (
      (account === "1400" && dc === "C") ||
      (account === "2020" && dc === "D")
    ) {
      payments.push({ date, amountCents: amount });
    }
  }

  charges.sort((a, b) => {
    const cmp = a.date.localeCompare(b.date);
    if (cmp !== 0) return cmp;
    return a.amountCents - b.amountCents;
  });

  let paymentPool = payments.reduce((sum, p) => sum + p.amountCents, 0);

  for (const charge of charges) {
    let remaining = charge.amountCents;
    if (paymentPool > 0) {
      const applied = Math.min(paymentPool, remaining);
      paymentPool -= applied;
      remaining -= applied;
    }
    if (remaining <= 0) continue;
    const bucket = bucketForAgeDays(ageDaysFromCharge(charge.date, asOfDate));
    buckets[bucket] += remaining;
  }

  return buckets;
}

module.exports = {
  ageDaysFromCharge,
  bucketForAgeDays,
  computeDebtorAgeBuckets,
  emptyBuckets,
};
