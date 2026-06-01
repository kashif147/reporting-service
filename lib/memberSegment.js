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

/**
 * Build SQL fragment + params for segment filter on listing/snapshot tables.
 * @param {{ includeStudents?: boolean, includeHonorary?: boolean }} opts
 * @returns {{ sql: string, params: string[] }}
 */
function segmentFilterSql(opts = {}, column = "member_segment", paramStart = 1) {
  const includeStudents = opts.includeStudents === true;
  const includeHonorary = opts.includeHonorary === true;
  const allowed = ["paid"];
  if (includeStudents) allowed.push("student");
  if (includeHonorary) allowed.push("honorary");
  return {
    sql: `${column} = ANY($${paramStart})`,
    params: [allowed],
  };
}

module.exports = {
  memberSegmentFromCategory,
  segmentFilterSql,
  STUDENT_CATEGORY_PATTERNS,
  HONORARY_CATEGORY_PATTERNS,
};
