/**
 * Seed sample debtor GL lines + membership_listing rows for Debtors List Report preview.
 *
 * Usage (from reporting-service):
 *   TENANT_ID=68cbf7806080b4621d469d34 node scripts/seed-debtors-list-sample.js
 *   REPORTING_DB_URL=postgresql://reports_admin:Letme1nplz!@localhost:5432/reporting_db node scripts/seed-debtors-list-sample.js
 *   node scripts/seed-debtors-list-sample.js --clear
 */
require("dotenv").config({ path: ".env.staging" });
require("dotenv").config();

const { pool } = require("../db/postgres");
const { upsertGlJournalLines } = require("../repositories/glJournalEntry.repository");

const TENANT_ID =
  process.env.TENANT_ID || process.env.DEFAULT_TENANT_ID || "68cbf7806080b4621d469d34";
const SAMPLE_PREFIX = "SEED-DEBTOR";
const CLEAR = process.argv.includes("--clear");

function resolveAsOfDate() {
  const now = new Date();
  const month = now.getMonth() === 0 ? 12 : now.getMonth();
  const year =
    now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
  const endOfMonth = new Date(Date.UTC(year, month, 0));
  return endOfMonth.toISOString().slice(0, 10);
}

function subtractDays(isoDate, days) {
  const d = new Date(`${isoDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - Number(days) || 0);
  return d.toISOString().slice(0, 10);
}

const SAMPLE_MEMBERS = [
  {
    membershipNo: "DEBT-90001",
    fullName: "Aoife Murphy",
    fullAddress: "12 Oak Road, Dublin 4",
    grade: "Staff Nurse",
    workLocation: "St James Hospital",
    charges: [{ ageDays: 12, amountCents: 12000 }],
  },
  {
    membershipNo: "DEBT-90002",
    fullName: "Sean O'Brien",
    fullAddress: "8 Main Street, Cork",
    grade: "CNM II",
    workLocation: "Cork University Hospital",
    charges: [{ ageDays: 45, amountCents: 20000 }],
  },
  {
    membershipNo: "DEBT-90003",
    fullName: "Niamh Kelly",
    fullAddress: "44 River Lane, Galway",
    grade: "Staff Nurse",
    workLocation: "University Hospital Galway",
    charges: [{ ageDays: 72, amountCents: 17550 }],
  },
  {
    membershipNo: "DEBT-90004",
    fullName: "Liam Byrne",
    fullAddress: "3 Church View, Limerick",
    grade: "CNM I",
    workLocation: "University Hospital Limerick",
    charges: [{ ageDays: 105, amountCents: 30000 }],
  },
  {
    membershipNo: "DEBT-90005",
    fullName: "Orla Walsh",
    fullAddress: "19 Hillcrest, Waterford",
    grade: "Staff Midwife",
    workLocation: "University Hospital Waterford",
    charges: [{ ageDays: 165, amountCents: 54000 }],
  },
  {
    membershipNo: "DEBT-90006",
    fullName: "Cian Ryan",
    fullAddress: "27 Park Avenue, Dublin 9",
    grade: "Staff Nurse",
    workLocation: "Beaumont Hospital",
    charges: [
      { ageDays: 130, amountCents: 40000 },
      { ageDays: 18, amountCents: 8000 },
    ],
    payments: [{ ageDays: 8, amountCents: 10000 }],
  },
];

function buildGlLines(asOfDate) {
  const postedAt = new Date(`${asOfDate}T23:59:59Z`);
  const lines = [];
  let docSeq = 0;

  for (const member of SAMPLE_MEMBERS) {
    member.charges.forEach((charge, chargeIdx) => {
      docSeq += 1;
      const docNo = `${SAMPLE_PREFIX}-INV-${member.membershipNo}-${chargeIdx + 1}`;
      const journalDate = subtractDays(asOfDate, charge.ageDays);
      lines.push({
        event_id: `${SAMPLE_PREFIX}-${docNo}-0`,
        tenant_id: TENANT_ID,
        journal_id: null,
        doc_no: docNo,
        doc_type: "Invoice",
        journal_date: journalDate,
        member_id: member.membershipNo,
        account_code: "1400",
        dc: "D",
        amount_cents: charge.amountCents,
        line_index: 0,
        reference: `Sample membership fee ${member.membershipNo}`,
        settlement_status: null,
        posted_at: postedAt,
      });
    });

    for (const payment of member.payments || []) {
      docSeq += 1;
      const docNo = `${SAMPLE_PREFIX}-RCT-${member.membershipNo}-${docSeq}`;
      const journalDate = subtractDays(asOfDate, payment.ageDays);
      lines.push({
        event_id: `${SAMPLE_PREFIX}-${docNo}-0`,
        tenant_id: TENANT_ID,
        journal_id: null,
        doc_no: docNo,
        doc_type: "Receipt",
        journal_date: journalDate,
        member_id: member.membershipNo,
        account_code: "1400",
        dc: "C",
        amount_cents: payment.amountCents,
        line_index: 0,
        reference: `Partial payment ${member.membershipNo}`,
        settlement_status: null,
        posted_at: postedAt,
      });
    }
  }

  return lines;
}

async function upsertListingRows() {
  for (const member of SAMPLE_MEMBERS) {
    const subscriptionId = `${SAMPLE_PREFIX}-${member.membershipNo}`;
    await pool.query(
      `INSERT INTO membership_listing (
         tenant_id, subscription_id, profile_id, membership_number,
         full_name, full_address, membership_status, membership_movement,
         grade, work_location, is_current, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,'Active','None',$7,$8,true,NOW())
       ON CONFLICT (tenant_id, subscription_id) DO UPDATE SET
         membership_number = EXCLUDED.membership_number,
         full_name = EXCLUDED.full_name,
         full_address = EXCLUDED.full_address,
         grade = EXCLUDED.grade,
         work_location = EXCLUDED.work_location,
         is_current = true,
         updated_at = NOW()`,
      [
        TENANT_ID,
        subscriptionId,
        `profile-${member.membershipNo}`,
        member.membershipNo,
        member.fullName,
        member.fullAddress,
        member.grade,
        member.workLocation,
      ],
    );
  }
}

async function clearSampleData() {
  await pool.query(
    `DELETE FROM gl_journal_entry
     WHERE tenant_id = $1 AND doc_no LIKE $2`,
    [TENANT_ID, `${SAMPLE_PREFIX}-%`],
  );
  await pool.query(
    `DELETE FROM membership_listing
     WHERE tenant_id = $1 AND subscription_id LIKE $2`,
    [TENANT_ID, `${SAMPLE_PREFIX}-%`],
  );
}

async function main() {
  if (CLEAR) {
    console.log(`Clearing sample debtor data for tenant ${TENANT_ID}...`);
    await clearSampleData();
    console.log("Done.");
    await pool.end();
    return;
  }

  const asOfDate = resolveAsOfDate();
  const lines = buildGlLines(asOfDate);

  console.log(`Seeding ${SAMPLE_MEMBERS.length} sample debtors for tenant ${TENANT_ID}`);
  console.log(`Reporting as-of date (end of prior month): ${asOfDate}`);

  await clearSampleData();
  const upserted = await upsertGlJournalLines(lines);
  await upsertListingRows();

  console.log(`Upserted ${upserted} GL lines.`);
  console.log(
    "Open Debtors List Report with Reporting Period ending",
    asOfDate,
    "to preview ageing columns.",
  );
  await pool.end();
}

main().catch(async (err) => {
  console.error(err);
  try {
    await pool.end();
  } catch (_) {
    /* ignore */
  }
  process.exit(1);
});
