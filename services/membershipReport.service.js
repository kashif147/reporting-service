const {
  queryMembershipListing,
} = require("../repositories/membershipListing.repository");
const { buildListingFiltersFromPreset } = require("../lib/reportPresets");

function mapRowToGrid(row, reportType) {
  const base = {
    id: row.subscriptionId,
    membershipNo: row.membershipNo,
    fullName: row.fullName,
    email: "",
    category: row.membershipCategory,
    status: row.membershipStatus,
    movement: row.membershipMovement,
    grade: row.grade,
    branch: row.branch,
    region: row.region,
    section: row.section,
    workLocation: row.workLocation,
    paymentType: row.paymentType,
    startDate: row.startDate,
    expiryDate: row.expiryDate,
  };

  if (reportType === "resigned") {
    return {
      ...base,
      resignationDate: row.resignedAt,
      reason: "",
    };
  }
  if (reportType === "cancelled") {
    return {
      ...base,
      cancellationDate: row.cancelledAt,
      memberName: row.fullName,
      memberType: row.membershipCategory,
    };
  }
  return {
    ...base,
    joiningDate: row.startDate,
    source: row.membershipMovement,
  };
}

async function getMembershipListing(tenantId, filters) {
  return queryMembershipListing(tenantId, filters);
}

async function getPresetReport(tenantId, reportType, body) {
  const filters = buildListingFiltersFromPreset(reportType, body);
  const result = await queryMembershipListing(tenantId, filters);
  return {
    data: result.rows.map((r) => mapRowToGrid(r, reportType)),
    total: result.total,
    skip: result.offset,
    take: result.limit,
  };
}

module.exports = { getMembershipListing, getPresetReport, mapRowToGrid };
