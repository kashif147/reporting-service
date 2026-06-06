const { normalizeMembershipDimensionFilters } = require("../lib/membershipDimensionFilters");
const {
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
} = require("../lib/workplaceBreakdownUtils");
const { countMembersByWorkLocationForDates } = require("../repositories/workplaceBreakdown.repository");
const {
  getLocationLookupMap,
  getLocationLookupCount,
} = require("../repositories/locationLookup.repository");
const { syncLocationLookupsForTenant } = require("./locationLookupSync.service");
const { ensurePeriodSnapshot } = require("./snapshotBuild.service");
const { hasPeriodSnapshot } = require("../repositories/membershipSnapshot.repository");

const REPORT_TITLE = "Workplace Membership Breakdown Report";
const SNAPSHOT_BUILD_CONCURRENCY = 3;
/** Limit snapshot builds per request to avoid gateway timeouts. */
const MAX_SNAPSHOTS_PER_REQUEST = 4;

function pickStringArray(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map((v) => String(v).trim()).filter(Boolean);
}

function normalizeRequest(body = {}) {
  const now = new Date();
  const endYear =
    Number(body.endYear) ||
    Number(body.year) ||
    now.getUTCFullYear();
  const endMonth = Math.min(
    Math.max(Number(body.endMonth) || Number(body.throughMonth) || now.getUTCMonth() + 1, 1),
    12,
  );
  const rollingMonths = Math.min(
    Math.max(Number(body.rollingMonths) || 12, 1),
    24,
  );

  return {
    endYear,
    endMonth,
    rollingMonths,
    membershipStatuses: pickStringArray(body.membershipStatuses).length
      ? pickStringArray(body.membershipStatuses)
      : ["Active"],
    includeStudents: body.includeStudents === true,
    includeHonorary: body.includeHonorary === true,
    excludeGrades: pickStringArray(body.excludeGrades),
    excludeMembershipCategories: pickStringArray(body.excludeMembershipCategories),
    dimensionOpts: normalizeMembershipDimensionFilters(body.filters || body),
    officials: pickStringArray(body.officials),
    audienceScope: String(body.audienceScope || "full").toLowerCase(),
    scopeUserId: body.scopeUserId ? String(body.scopeUserId) : null,
    ensureSnapshots:
      body.ensureSnapshots === true || body.recompute === true,
    syncLookups: body.syncLookups === true,
  };
}

async function findMissingSnapshotDates(tenantId, dates = []) {
  const unique = [...new Set(dates.filter(Boolean))];
  const missing = [];
  for (const asOfDate of unique) {
    if (!(await hasPeriodSnapshot(tenantId, asOfDate))) {
      missing.push(asOfDate);
    }
  }
  return missing;
}

async function ensureSnapshotsForDates(tenantId, dates = []) {
  const missing = await findMissingSnapshotDates(tenantId, dates);
  const toBuild = missing.slice(0, MAX_SNAPSHOTS_PER_REQUEST);
  for (let i = 0; i < toBuild.length; i += SNAPSHOT_BUILD_CONCURRENCY) {
    const batch = toBuild.slice(i, i + SNAPSHOT_BUILD_CONCURRENCY);
    await Promise.all(
      batch.map((asOfDate) => ensurePeriodSnapshot(tenantId, asOfDate)),
    );
  }
  return {
    built: toBuild.length,
    remaining: Math.max(0, missing.length - toBuild.length),
  };
}

function buildMonthlyCountsForRow(countMap, slots, yoyRef = null) {
  const slotSet = new Set(slots.map((s) => s.asOfDate));
  const entries = slots.map(({ year, month, asOfDate }) => ({
    year,
    month,
    asOfDate,
    count: countMap.get(asOfDate) ?? 0,
  }));

  if (yoyRef && !slotSet.has(yoyRef.asOfDate)) {
    entries.push({
      year: yoyRef.year,
      month: yoyRef.month,
      asOfDate: yoyRef.asOfDate,
      count: countMap.get(yoyRef.asOfDate) ?? 0,
    });
  }

  return entries;
}

function rowEndAndPriorCounts(monthlyCounts, slots) {
  const endCount = monthlyCounts.find(
    (c) =>
      c.year === slots[slots.length - 1]?.year &&
      c.month === slots[slots.length - 1]?.month,
  )?.count ?? 0;
  const priorCount = monthlyCounts.find(
    (c) =>
      c.year === slots[slots.length - 2]?.year &&
      c.month === slots[slots.length - 2]?.month,
  )?.count ?? 0;
  return { endCount, priorCount };
}

function aggregateRegionTotals(rows, slots, endYear, endMonth) {
  const monthlyCounts = slots.map(({ year, month, asOfDate }) => ({
    year,
    month,
    asOfDate,
    count: rows.reduce(
      (sum, row) =>
        sum +
        (row.monthlyCounts.find((c) => c.asOfDate === asOfDate)?.count || 0),
      0,
    ),
  }));

  const endCount = monthlyCounts[monthlyCounts.length - 1]?.count ?? 0;
  const priorCount = monthlyCounts[monthlyCounts.length - 2]?.count ?? 0;
  const yoyCount = rows.reduce(
    (sum, row) =>
      sum + resolveYoyPriorCount(row.monthlyCounts, endYear, endMonth),
    0,
  );

  return {
    monthlyCounts,
    mom: computeDelta(endCount, priorCount),
    yoy: computeDelta(endCount, yoyCount),
  };
}

function applyAudienceScope(rows, { audienceScope, scopeUserId }) {
  if (audienceScope === "full" || !scopeUserId) return rows;
  const scope = String(scopeUserId);
  if (audienceScope === "official") {
    return rows.filter((row) => row.official?.userId === scope);
  }
  if (audienceScope === "manager") {
    return rows.filter(
      (row) =>
        row.official?.branchOfficerUserId === scope ||
        row.official?.regionOfficerUserId === scope,
    );
  }
  return rows;
}

function applyOfficialsFilter(rows, officials = []) {
  if (!officials.length) return rows;
  const set = new Set(officials.map((v) => v.toLowerCase()));
  return rows.filter((row) => {
    const id = String(row.official?.userId || "").toLowerCase();
    const initials = String(row.official?.initials || "").toLowerCase();
    const name = String(row.official?.displayName || "").toLowerCase();
    return set.has(id) || set.has(initials) || set.has(name);
  });
}

function filterEmptyRows(rows, includeEmptyRows) {
  if (includeEmptyRows) return rows;
  return rows.filter((row) =>
    row.monthlyCounts.some((c) => Number(c.count) > 0),
  );
}

function officialGroupKey(row) {
  return row.official?.userId || row.official?.initials || "unknown";
}

function buildOfficialSummary(rows, slots, endYear, endMonth) {
  const groups = new Map();

  for (const row of rows) {
    const key = officialGroupKey(row);
    if (!groups.has(key)) {
      groups.set(key, {
        official: { ...row.official },
        rows: [],
      });
    }
    groups.get(key).rows.push(row);
  }

  const summary = [];
  for (const { official, rows: groupRows } of groups.values()) {
    const totals = aggregateRegionTotals(groupRows, slots, endYear, endMonth);
    summary.push({
      official,
      workplaceCount: groupRows.length,
      totalMembersCurrent: totals.monthlyCounts[totals.monthlyCounts.length - 1]?.count ?? 0,
      monthlyCounts: totals.monthlyCounts,
      mom: totals.mom,
      yoy: totals.yoy,
    });
  }

  return summary.sort(
    (a, b) => b.totalMembersCurrent - a.totalMembersCurrent,
  );
}

function buildTrendSeries(rows, periodColumns, endYear, endMonth) {
  const orgMonthlyTotals = periodColumns.map(({ year, month, asOfDate, label }) => ({
    year,
    month,
    asOfDate,
    label: label || formatMonthColumnLabel(year, month),
    count: rows.reduce(
      (sum, row) =>
        sum +
        (row.monthlyCounts.find((c) => c.asOfDate === asOfDate)?.count || 0),
      0,
    ),
  }));

  const endSlot = periodColumns[periodColumns.length - 1];
  const topWorkplaces = [...rows]
    .map((row) => ({
      workLocation: row.workLocation,
      region: row.region,
      branch: row.branch,
      currentCount:
        row.monthlyCounts.find(
          (c) => c.year === endSlot?.year && c.month === endSlot?.month,
        )?.count ?? 0,
      monthlyCounts: row.monthlyCounts.filter((c) =>
        periodColumns.some((s) => s.asOfDate === c.asOfDate),
      ),
    }))
    .sort((a, b) => b.currentCount - a.currentCount)
    .slice(0, 10);

  const withMom = rows
    .map((row) => ({
      workLocation: row.workLocation,
      region: row.region,
      momAbsolute: row.mom?.absolute ?? 0,
      momPercent: row.mom?.percent ?? 0,
      currentCount:
        row.monthlyCounts[row.monthlyCounts.length - 1]?.count ?? 0,
    }))
    .filter((r) => r.momAbsolute !== 0);

  const gainers = [...withMom]
    .filter((r) => r.momAbsolute > 0)
    .sort((a, b) => b.momAbsolute - a.momAbsolute)
    .slice(0, 5);
  const losers = [...withMom]
    .filter((r) => r.momAbsolute < 0)
    .sort((a, b) => a.momAbsolute - b.momAbsolute)
    .slice(0, 5);

  return {
    orgMonthlyTotals,
    topWorkplaces,
    movers: { gainers, losers },
    yoyReference: buildYoyReferenceSlot(endYear, endMonth),
  };
}

async function getWorkplaceBreakdownReport(tenantId, body = {}) {
  const opts = normalizeRequest(body);
  const notes = [];

  try {
    if (opts.syncLookups) {
      await syncLocationLookupsForTenant(tenantId);
    } else {
      const lookupCount = await getLocationLookupCount(tenantId);
      if (lookupCount === 0) {
        await syncLocationLookupsForTenant(tenantId);
      }
    }
  } catch (syncError) {
    console.error(
      "[workplaceBreakdown] location lookup sync failed:",
      syncError.message,
    );
    notes.push(
      "Work location officer lookup sync failed — official initials may be incomplete. Set USER_SERVICE_MONGO_URI on reporting-service or run scripts/sync-location-lookups.js.",
    );
  }

  const slots = buildRollingMonthSlots(
    opts.endYear,
    opts.endMonth,
    opts.rollingMonths,
  );
  const yoyRef = buildYoyReferenceSlot(opts.endYear, opts.endMonth);

  let snapshotDates = slots.map((s) => s.asOfDate);
  if (opts.rollingMonths >= 12) {
    snapshotDates = ensureYoySnapshotDate(snapshotDates, opts.endYear, opts.endMonth);
  }

  let builtSnapshotCount = 0;
  let remainingSnapshotCount = 0;

  if (opts.ensureSnapshots) {
    const snapshotBuild = await ensureSnapshotsForDates(tenantId, snapshotDates);
    builtSnapshotCount = snapshotBuild.built;
    remainingSnapshotCount = snapshotBuild.remaining;
    if (builtSnapshotCount > 0) {
      notes.push(
        `Built ${builtSnapshotCount} missing month-end snapshot(s).`,
      );
    }
    if (remainingSnapshotCount > 0) {
      notes.push(
        `${remainingSnapshotCount} snapshot(s) still missing — click Filter again to continue building, or run the snapshot admin job.`,
      );
    }
  } else {
    const missing = await findMissingSnapshotDates(tenantId, snapshotDates);
    if (missing.length) {
      notes.push(
        `${missing.length} month-end snapshot(s) are not available yet — counts for those months may be zero. Click Filter to build missing snapshots (may take a few minutes).`,
      );
    }
  }

  const segmentOpts = {
    includeStudents: opts.includeStudents,
    includeHonorary: opts.includeHonorary,
  };

  const countRows = await countMembersByWorkLocationForDates(
    tenantId,
    snapshotDates,
    {
      segmentOpts,
      dimensionOpts: opts.dimensionOpts,
      membershipStatuses: opts.membershipStatuses,
      excludeGrades: opts.excludeGrades.length
        ? opts.excludeGrades
        : DEFAULT_EXCLUDE_GRADES,
      excludeMembershipCategories: opts.excludeMembershipCategories,
    },
  );

  const lookupMap = await getLocationLookupMap(tenantId);

  const locationKeys = new Map();
  for (const row of countRows) {
    const key = `${row.region}|${row.branch}|${row.work_location}`;
    if (!locationKeys.has(key)) {
      locationKeys.set(key, {
        workLocation: row.work_location,
        branch: row.branch,
        region: row.region,
        countsByDate: new Map(),
      });
    }
    locationKeys.get(key).countsByDate.set(row.snapshot_date, row.member_count);
  }

  for (const [wlName, lookup] of lookupMap) {
    const key = `${lookup.region || "(blank)"}|${lookup.branch || "(blank)"}|${wlName}`;
    if (!locationKeys.has(key)) {
      locationKeys.set(key, {
        workLocation: wlName,
        branch: lookup.branch || "(blank)",
        region: lookup.region || "(blank)",
        countsByDate: new Map(),
      });
    }
  }

  const includeEmptyRows = body.includeEmptyRows === true;
  const allRows = [];

  for (const loc of locationKeys.values()) {
    const lookup = lookupMap.get(loc.workLocation);
    const monthlyCounts = buildMonthlyCountsForRow(
      loc.countsByDate,
      slots,
      yoyRef,
    );
    const { endCount, priorCount } = rowEndAndPriorCounts(monthlyCounts, slots);
    const yoyCount = resolveYoyPriorCount(
      monthlyCounts,
      opts.endYear,
      opts.endMonth,
    );

    allRows.push({
      workLocation: loc.workLocation,
      branch: loc.branch,
      region: loc.region,
      official: {
        userId: lookup?.officer_user_id || null,
        initials: lookup?.officer_initials || "—",
        displayName: lookup?.officer_display_name || null,
        branchOfficerUserId: lookup?.branch_officer_user_id || null,
        regionOfficerUserId: lookup?.region_officer_user_id || null,
      },
      monthlyCounts,
      mom: computeDelta(endCount, priorCount),
      yoy: computeDelta(endCount, yoyCount),
    });
  }

  let filteredRows = applyAudienceScope(allRows, opts);
  filteredRows = applyOfficialsFilter(filteredRows, opts.officials);
  filteredRows = filterEmptyRows(filteredRows, includeEmptyRows);

  filteredRows.sort(
    (a, b) =>
      a.region.localeCompare(b.region) ||
      a.branch.localeCompare(b.branch) ||
      a.workLocation.localeCompare(b.workLocation),
  );

  const regionMap = new Map();
  for (const row of filteredRows) {
    if (!regionMap.has(row.region)) {
      regionMap.set(row.region, []);
    }
    regionMap.get(row.region).push(row);
  }

  const regions = [...regionMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([region, rows]) => ({
      region,
      label: regionSectionLabel(region),
      rows,
      totals: aggregateRegionTotals(rows, slots, opts.endYear, opts.endMonth),
    }));

  const endCountTotal = filteredRows.reduce(
    (sum, row) => sum + (row.monthlyCounts[row.monthlyCounts.length - 1]?.count || 0),
    0,
  );
  const priorCountTotal = filteredRows.reduce(
    (sum, row) => sum + (row.monthlyCounts[row.monthlyCounts.length - 2]?.count || 0),
    0,
  );
  const yoyCountTotal = filteredRows.reduce(
    (sum, row) =>
      sum + resolveYoyPriorCount(row.monthlyCounts, opts.endYear, opts.endMonth),
    0,
  );

  const columns = slots.map((slot, index) => ({
    year: slot.year,
    month: slot.month,
    label: formatMonthColumnLabel(slot.year, slot.month, {
      priorYear: index > 0 ? slots[index - 1].year : slot.year,
    }),
    asOfDate: slot.asOfDate,
  }));

  const priorSlot = slots.length >= 2 ? slots[slots.length - 2] : null;
  const officialSummary = buildOfficialSummary(
    filteredRows,
    slots,
    opts.endYear,
    opts.endMonth,
  );
  const trendSeries = buildTrendSeries(
    filteredRows,
    columns,
    opts.endYear,
    opts.endMonth,
  );

  return {
    reportTitle: REPORT_TITLE,
    period: {
      endYear: opts.endYear,
      endMonth: opts.endMonth,
      rollingMonths: opts.rollingMonths,
      columns,
      momColumn: {
        priorYear: priorSlot?.year,
        priorMonth: priorSlot?.month,
        label: formatMomColumnLabel(opts.endYear, opts.endMonth),
      },
      yoyColumn: {
        priorYear: yoyRef.year,
        priorMonth: yoyRef.month,
        label: formatYoyColumnLabel(opts.endYear, opts.endMonth),
      },
      yoyReference: { year: yoyRef.year, month: yoyRef.month },
    },
    summary: {
      totalWorkplaces: filteredRows.length,
      totalMembersCurrent: endCountTotal,
      mom: computeDelta(endCountTotal, priorCountTotal),
      yoy: computeDelta(endCountTotal, yoyCountTotal),
    },
    officialSummary,
    trendSeries,
    regions,
    filters: {
      membershipStatuses: opts.membershipStatuses,
      includeStudents: opts.includeStudents,
      includeHonorary: opts.includeHonorary,
      excludeGrades: opts.excludeGrades.length
        ? opts.excludeGrades
        : DEFAULT_EXCLUDE_GRADES,
      excludeMembershipCategories: opts.excludeMembershipCategories,
      audienceScope: opts.audienceScope,
      scopeUserId: opts.scopeUserId,
      dimensions: opts.dimensionOpts,
    },
    notes,
  };
}

module.exports = { getWorkplaceBreakdownReport, REPORT_TITLE };
