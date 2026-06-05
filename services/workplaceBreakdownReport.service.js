const { normalizeMembershipDimensionFilters } = require("../lib/membershipDimensionFilters");
const {
  buildRollingMonthSlots,
  formatMonthColumnLabel,
  formatMomColumnLabel,
  computeDelta,
  regionSectionLabel,
  DEFAULT_EXCLUDE_GRADES,
} = require("../lib/workplaceBreakdownUtils");
const { countMembersByWorkLocationForDates } = require("../repositories/workplaceBreakdown.repository");
const { getLocationLookupMap } = require("../repositories/locationLookup.repository");
const { syncLocationLookupsForTenant } = require("./locationLookupSync.service");
const { ensurePeriodSnapshot } = require("./snapshotBuild.service");

const REPORT_TITLE = "Workplace Membership Breakdown Report";

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
      body.ensureSnapshots === true ||
      body.recompute === true ||
      body.syncLookups === true,
    syncLookups: body.syncLookups === true || body.ensureSnapshots === true,
  };
}

function slotKey(year, month) {
  return `${year}-${String(month).padStart(2, "0")}`;
}

function buildMonthlyCountsForRow(countMap, slots) {
  return slots.map(({ year, month, asOfDate }) => ({
    year,
    month,
    asOfDate,
    count: countMap.get(asOfDate) ?? 0,
  }));
}

function aggregateRegionTotals(rows, slots) {
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
  const yoySlot = slots.length >= 13 ? slots[slots.length - 13] : null;
  const yoyCount = yoySlot
    ? monthlyCounts.find((c) => c.asOfDate === yoySlot.asOfDate)?.count ?? 0
    : 0;

  return {
    monthlyCounts,
    mom: computeDelta(endCount, priorCount),
    yoy: computeDelta(endCount, yoyCount),
  };
}

function applyAudienceScope(rows, { audienceScope, scopeUserId }) {
  if (audienceScope === "full" || !scopeUserId) return rows;
  if (audienceScope === "official") {
    return rows.filter((row) => row.official?.userId === scopeUserId);
  }
  if (audienceScope === "manager") {
    return [];
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

async function getWorkplaceBreakdownReport(tenantId, body = {}) {
  const opts = normalizeRequest(body);

  if (opts.audienceScope === "manager") {
    return {
      reportTitle: REPORT_TITLE,
      period: { endYear: opts.endYear, endMonth: opts.endMonth, columns: [] },
      summary: {
        totalWorkplaces: 0,
        totalMembersCurrent: 0,
        mom: { absolute: 0, percent: 0 },
        yoy: { absolute: 0, percent: 0 },
      },
      regions: [],
      filters: opts,
      notes: [
        "Manager (ADIR) audience scope is not yet configured — use full or official scope.",
      ],
    };
  }

  if (opts.syncLookups) {
    await syncLocationLookupsForTenant(tenantId);
  }

  const slots = buildRollingMonthSlots(
    opts.endYear,
    opts.endMonth,
    opts.rollingMonths,
  );

  if (opts.ensureSnapshots) {
    for (const slot of slots) {
      await ensurePeriodSnapshot(tenantId, slot.asOfDate);
    }
    const yoySlot = slots.length >= 13 ? slots[0] : null;
    if (yoySlot && !slots.some((s) => s.asOfDate === yoySlot.asOfDate)) {
      await ensurePeriodSnapshot(tenantId, yoySlot.asOfDate);
    }
  }

  const snapshotDates = slots.map((s) => s.asOfDate);
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
    const monthlyCounts = buildMonthlyCountsForRow(loc.countsByDate, slots);
    const endCount = monthlyCounts[monthlyCounts.length - 1]?.count ?? 0;
    const priorCount = monthlyCounts[monthlyCounts.length - 2]?.count ?? 0;
    const yoySlot = slots.length >= 13 ? slots[0] : null;
    const yoyCount = yoySlot
      ? monthlyCounts.find((c) => c.asOfDate === yoySlot.asOfDate)?.count ?? 0
      : 0;

    allRows.push({
      workLocation: loc.workLocation,
      branch: loc.branch,
      region: loc.region,
      official: {
        userId: lookup?.officer_user_id || null,
        initials: lookup?.officer_initials || "—",
        displayName: lookup?.officer_display_name || null,
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
      totals: aggregateRegionTotals(rows, slots),
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
    (sum, row) => {
      const yoySlot = slots.length >= 13 ? slots[0] : null;
      if (!yoySlot) return sum;
      return (
        sum +
        (row.monthlyCounts.find((c) => c.asOfDate === yoySlot.asOfDate)?.count || 0)
      );
    },
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
      yoyReference:
        slots.length >= 13
          ? { year: slots[0].year, month: slots[0].month }
          : null,
    },
    summary: {
      totalWorkplaces: filteredRows.length,
      totalMembersCurrent: endCountTotal,
      mom: computeDelta(endCountTotal, priorCountTotal),
      yoy: computeDelta(endCountTotal, yoyCountTotal),
    },
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
    notes: [],
  };
}

module.exports = { getWorkplaceBreakdownReport, REPORT_TITLE };
