const { pool } = require("../db/postgres");
const { appendSegmentFilter } = require("../lib/memberSegment");
const { appendDimensionFilters } = require("../lib/membershipDimensionFilters");
const { DEFAULT_EXCLUDE_GRADES } = require("../lib/workplaceBreakdownUtils");

function normalizeGradeList(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map((v) => String(v).trim()).filter(Boolean);
}

function appendGradeExclusions(whereParts, params, excludeGrades = []) {
  const grades = normalizeGradeList(excludeGrades);
  const deny = grades.length ? grades : DEFAULT_EXCLUDE_GRADES;
  for (const grade of deny) {
    const idx = params.length + 1;
    whereParts.push(`COALESCE(grade, '') NOT ILIKE $${idx}`);
    params.push(`%${grade}%`);
  }
}

function appendCategoryExclusions(whereParts, params, excludeCategories = []) {
  const cats = normalizeGradeList(excludeCategories);
  for (const cat of cats) {
    const idx = params.length + 1;
    whereParts.push(`COALESCE(membership_category, '') NOT ILIKE $${idx}`);
    params.push(`%${cat}%`);
  }
}

function appendStatusFilter(whereParts, params, membershipStatuses = ["Active"]) {
  const statuses = normalizeGradeList(membershipStatuses);
  const idx = params.length + 1;
  whereParts.push(`membership_status = ANY($${idx}::text[])`);
  params.push(statuses.length ? statuses : ["Active"]);
}

/**
 * Count eligible members per work location across multiple snapshot dates.
 * @returns {Promise<Array<{ snapshot_date, work_location, branch, region, member_count }>>}
 */
async function countMembersByWorkLocationForDates(
  tenantId,
  snapshotDates,
  {
    segmentOpts = {},
    dimensionOpts = {},
    membershipStatuses = ["Active"],
    excludeGrades = [],
    excludeMembershipCategories = [],
  } = {},
) {
  if (!snapshotDates?.length) return [];

  const where = ["tenant_id = $1", "snapshot_date = ANY($2::date[])"];
  const params = [tenantId, snapshotDates];
  appendStatusFilter(where, params, membershipStatuses);
  appendSegmentFilter(where, params, segmentOpts);
  appendDimensionFilters(where, params, dimensionOpts);
  appendGradeExclusions(where, params, excludeGrades);
  appendCategoryExclusions(where, params, excludeMembershipCategories);

  const { rows } = await pool.query(
    `SELECT
      snapshot_date::text AS snapshot_date,
      COALESCE(NULLIF(TRIM(work_location::text), ''), '(blank)') AS work_location,
      COALESCE(NULLIF(TRIM(branch::text), ''), '(blank)') AS branch,
      COALESCE(NULLIF(TRIM(region::text), ''), '(blank)') AS region,
      COUNT(*)::int AS member_count
    FROM membership_period_snapshot
    WHERE ${where.join(" AND ")}
    GROUP BY snapshot_date, work_location, branch, region
    ORDER BY region, branch, work_location, snapshot_date`,
    params,
  );
  return rows;
}

module.exports = {
  countMembersByWorkLocationForDates,
  appendGradeExclusions,
  appendCategoryExclusions,
  appendStatusFilter,
};
