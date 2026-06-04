/**
 * Toolbar / dashboard dimension filters → SQL on membership_listing & snapshots.
 */
const LABEL_TO_API_KEY = {
  "Membership Category": "membershipCategories",
  Grade: "grades",
  "Section (Primary Section)": "sections",
  Region: "regions",
  Branch: "branches",
  "Work Location": "workLocations",
  "Payment Type": "paymentTypes",
  "Membership Status": "membershipStatuses",
  "Membership Movement": "membershipMovements",
};

const API_KEY_TO_COLUMN = {
  membershipCategories: "membership_category",
  grades: "grade",
  sections: "section",
  regions: "region",
  branches: "branch",
  workLocations: "work_location",
  paymentTypes: "payment_type",
  membershipStatuses: "membership_status",
  membershipMovements: "membership_movement",
};

function pickValues(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map((v) => String(v).trim()).filter(Boolean);
}

/**
 * @returns {{ membershipCategories?: string[], grades?: string[], ... }}
 */
function normalizeMembershipDimensionFilters(input = {}) {
  const out = {};
  for (const [label, key] of Object.entries(LABEL_TO_API_KEY)) {
    const vals = pickValues(input[label] ?? input[key]);
    if (vals.length) out[key] = vals;
  }
  return out;
}

function hasDimensionFilters(dimensionOpts = {}) {
  return Object.values(dimensionOpts).some((v) => Array.isArray(v) && v.length > 0);
}

function appendDimensionFilters(whereParts, params, dimensionOpts = {}) {
  for (const [key, column] of Object.entries(API_KEY_TO_COLUMN)) {
    const values = dimensionOpts[key];
    if (!values?.length) continue;
    const idx = params.length + 1;
    whereParts.push(`${column} = ANY($${idx}::text[])`);
    params.push(values);
  }
}

module.exports = {
  LABEL_TO_API_KEY,
  API_KEY_TO_COLUMN,
  normalizeMembershipDimensionFilters,
  hasDimensionFilters,
  appendDimensionFilters,
};
