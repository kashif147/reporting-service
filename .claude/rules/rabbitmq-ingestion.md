# RabbitMQ: two independent ingestion pipelines

`rabbitMQ/index.js` sets up four consumer queues. Two of them are the membership warehouse
documented in `docs/MEMBERSHIP_REPORTING.md` (`membership.events` → `membership.listener.js`,
`profile.events` → `profile.listener.js`, feeding `membership_event`/`membership_listing`). **The
other two are an entirely separate finance/GL replication pipeline that neither doc mentions:**

- `accounts.events` / `accounts.member.credit.updated.v1` → `accounts.listener.js` →
  `services/accountsIngest.service.js`. Every event is appended to `membership_event` for audit, and
  a `MEMBER_CREDIT_UPDATED` event additionally upserts a `member_creditor` row (member overpayment/
  credit balance, `repositories/memberCreditor.repository.js`) — or deletes it if the credited
  amount drops to zero.
- `journal.events` / `journal.created.v1` → `journal.listener.js` →
  `services/journalIngest.service.js`. This is a **selective, filtered replication**: it only
  copies journal lines whose `accountCode` is in a hardcoded set (`REPLICATED_ACCOUNTS = {"1400",
  "2020"}`, member-debtor-related GL accounts) into `gl_journal_entry`
  (`repositories/glJournalEntry.repository.js`) — every other GL account code on the same journal is
  silently skipped. To add a new GL account to reporting, add it to `REPLICATED_ACCOUNTS` — there is
  no config option for this today.

Both pipelines feed `scripts/sync-member-creditors.js` / `scripts/sync-gl-journal-entries.js`, which
backfill/reconcile these two tables directly from account-service (via `lib/accountServiceClient.js`)
when the live RabbitMQ stream has gaps — same purpose as this service's `--backfill-months` flag for
membership snapshots.
