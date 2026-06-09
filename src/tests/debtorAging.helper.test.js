const test = require("node:test");
const assert = require("node:assert/strict");
const {
  bucketForAgeDays,
  computeDebtorAgeBuckets,
} = require("../../helpers/debtorAging.helper");

test("bucketForAgeDays maps standard ageing brackets", () => {
  assert.equal(bucketForAgeDays(0), "current");
  assert.equal(bucketForAgeDays(29), "current");
  assert.equal(bucketForAgeDays(30), "days30");
  assert.equal(bucketForAgeDays(59), "days30");
  assert.equal(bucketForAgeDays(60), "days60");
  assert.equal(bucketForAgeDays(89), "days60");
  assert.equal(bucketForAgeDays(90), "days90");
  assert.equal(bucketForAgeDays(119), "days90");
  assert.equal(bucketForAgeDays(120), "over90");
});

test("computeDebtorAgeBuckets applies FIFO payments to oldest charges", () => {
  const lines = [
    {
      account_code: "1400",
      dc: "D",
      amount_cents: 10000,
      journal_date: "2025-01-01",
    },
    {
      account_code: "1400",
      dc: "D",
      amount_cents: 5000,
      journal_date: "2025-06-01",
    },
    {
      account_code: "1400",
      dc: "C",
      amount_cents: 10000,
      journal_date: "2025-07-01",
    },
  ];

  const buckets = computeDebtorAgeBuckets(lines, "2025-12-31");
  assert.equal(buckets.current, 0);
  assert.equal(buckets.days30, 0);
  assert.equal(buckets.days60, 0);
  assert.equal(buckets.days90, 0);
  assert.equal(buckets.over90, 5000);
});
