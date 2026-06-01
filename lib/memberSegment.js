/**
 * Classify members for student / honorary / paid filters (aligned with reminder batch exclusions).
 */
const STUDENT_CATEGORY_PATTERNS = [
  "undergraduate student",
  "undergraduate students",
  "postgraduate student",
  "postgraduate students",
];

const HONORARY_CATEGORY_PATTERNS = ["honorary"];

function normalizeCategory(name) {
  return String(name || "")
    .trim()
    .toLowerCase();
}

function matchesAny(norm, patterns) {
  return patterns.some(
    (p) => norm === p || norm.includes(p) || p.includes(norm)
  );
}

/**
 * @returns {'student'|'honorary'|'paid'}
 */
function memberSegmentFromCategory(membershipCategory) {
  const norm = normalizeCategory(membershipCategory);
  if (!norm) return "paid";
  if (matchesAny(norm, HONORARY_CATEGORY_PATTERNS)) return "honorary";
  if (matchesAny(norm, STUDENT_CATEGORY_PATTERNS) || norm.includes("student")) {
    return "student";
  }
  return "paid";
}

function buildAllowedSegments(opts = {}) {
  const allowed = ["paid"];
  if (opts.includeStudents === true) allowed.push("student");
  if (opts.includeHonorary === true) allowed.push("honorary");
  return allowed;
}

/**
 * Append `column = ANY($n::text[])` using the next parameter slot (avoids $n collisions).
 * @returns {number} parameter index used
 */
function appendSegmentFilter(whereParts, params, opts, column = "member_segment") {
  const idx = params.length + 1;
  whereParts.push(`${column} = ANY($${idx}::text[])`);
  params.push(buildAllowedSegments(opts));
  return idx;
}

/**
 * Build SQL fragment + params for segment filter (caller must align paramStart with params).
 * Prefer appendSegmentFilter when other placeholders share the same query.
 */
function segmentFilterSql(opts = {}, column = "member_segment", paramStart = 1) {
  return {
    sql: `${column} = ANY($${paramStart}::text[])`,
    params: [buildAllowedSegments(opts)],
  };
}

module.exports = {
  memberSegmentFromCategory,
  buildAllowedSegments,
  appendSegmentFilter,
  segmentFilterSql,
  STUDENT_CATEGORY_PATTERNS,
  HONORARY_CATEGORY_PATTERNS,
};
