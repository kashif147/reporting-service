/**
 * Maps UI report keys to membership_listing query filters.
 */
const PRESETS = {
  "new-members": {
    membershipMovements: ["NewJoin"],
    dateRangeField: "startDate",
  },
  joiners: {
    membershipMovements: [
      "NewJoin",
      "Rejoin - Cancelled",
      "Rejoin - Resigned",
      "Reinstate - Suspended",
      "Reinstate - Archived",
    ],
    dateRangeField: "startDate",
  },
  resigned: {
    membershipStatuses: ["Resigned"],
    dateRangeField: "resignedAt",
  },
  cancelled: {
    membershipStatuses: ["Cancelled"],
    dateRangeField: "cancelledAt",
  },
  active: {
    membershipStatuses: ["Active"],
    isCurrent: true,
  },
  suspended: {
    membershipStatuses: ["Suspended"],
  },
  archived: {
    membershipStatuses: ["Archived"],
  },
  lapsed: {
    membershipStatuses: ["Lapsed"],
  },
};

function buildListingFiltersFromPreset(reportType, body = {}) {
  const preset = PRESETS[reportType];
  if (!preset) {
    const err = new Error(`Unknown report type: ${reportType}`);
    err.statusCode = 400;
    throw err;
  }

  const filters = {
    membershipStatuses: body.membershipStatuses || preset.membershipStatuses,
    membershipMovements: body.membershipMovements || preset.membershipMovements,
    membershipCategories: body.membershipCategories || body.categories || [],
    grades: body.grades || [],
    workLocations: body.workLocations || [],
    branches: body.branches || [],
    regions: body.regions || [],
    paymentTypes: body.paymentTypes || [],
    paymentFrequencies: body.paymentFrequencies || [],
    subscriptionYears: body.subscriptionYears || body.years || [],
    isCurrent: body.isCurrent !== undefined ? body.isCurrent : preset.isCurrent,
    includeStudents: body.includeStudents,
    includeHonorary: body.includeHonorary,
    search: body.search,
    limit: body.limit ?? body.take ?? 500,
    offset: body.offset ?? body.skip ?? 0,
  };

  const field = body.dateRange?.field || preset.dateRangeField;
  const from = body.dateRange?.from || body.startDate;
  const to = body.dateRange?.to || body.endDate;
  if (field && from && to) {
    filters.dateRange = { field, from, to };
  }

  if (body.category) {
    filters.membershipCategories = [body.category];
  }

  return filters;
}

module.exports = { PRESETS, buildListingFiltersFromPreset };
