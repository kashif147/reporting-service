const { AppError } = require("../errors/AppError");
const {
  FILTER_OPERATOR,
  MEMBERSHIP_LISTING_TEMPLATE_FILTER_KEYS,
  STATISTICS_REPORT_TEMPLATE_FILTER_KEYS,
  REPORTING_TEMPLATE_TYPES,
} = require("../constants/gridTemplateEnums");

const VALID_OPERATORS = new Set(Object.values(FILTER_OPERATOR));

function validateFilterEntry(key, entry) {
  if (!entry || typeof entry !== "object") {
    throw AppError.badRequest(`Invalid filter entry for "${key}"`);
  }
  if (!VALID_OPERATORS.has(entry.operator)) {
    throw AppError.badRequest(`Invalid operator for filter "${key}"`);
  }
  if (!Array.isArray(entry.values) || entry.values.length === 0) {
    throw AppError.badRequest(`Filter "${key}" requires at least one value`);
  }
}

function allowedKeysForType(type) {
  if (type === "membershiplisting") return MEMBERSHIP_LISTING_TEMPLATE_FILTER_KEYS;
  if (type === "statisticsreport") return STATISTICS_REPORT_TEMPLATE_FILTER_KEYS;
  return null;
}

function validateFiltersForType(templateType, filters = {}) {
  if (!filters || typeof filters !== "object") {
    throw AppError.badRequest("filters must be an object");
  }

  const type = String(templateType || "membershiplisting").trim().toLowerCase();
  const allowedKeys = allowedKeysForType(type);

  for (const [key, entry] of Object.entries(filters)) {
    if (allowedKeys && !allowedKeys.includes(key)) {
      throw AppError.badRequest(`Unknown filter key "${key}" for ${type}`);
    }
    validateFilterEntry(key, entry);
  }
}

function validateCreateGridTemplate(body = {}) {
  const templateType = String(body.templateType || "membershiplisting").trim();
  const normalizedType = templateType.toLowerCase();

  if (!REPORTING_TEMPLATE_TYPES.includes(normalizedType)) {
    throw AppError.badRequest(`Unsupported templateType: ${templateType}`);
  }

  validateFiltersForType(normalizedType, body.filters || {});

  const columns = Array.isArray(body.columns) ? body.columns : [];
  for (const col of columns) {
    if (typeof col !== "string" || !col.trim()) {
      throw AppError.badRequest("columns must be an array of non-empty strings");
    }
  }

  return {
    name: body.name != null && body.name !== "" ? String(body.name).trim() : null,
    templateType: normalizedType,
    filters: body.filters || {},
    columns,
    columnLabels:
      body.columnLabels && typeof body.columnLabels === "object"
        ? body.columnLabels
        : {},
    isDefault: Boolean(body.isDefault),
    pinned: Boolean(body.pinned),
  };
}

function validateUpdateGridTemplate(body = {}) {
  const out = {};

  if (body.name !== undefined) {
    out.name = body.name !== "" ? String(body.name).trim() : null;
  }
  if (body.templateType !== undefined) {
    const normalizedType = String(body.templateType).trim().toLowerCase();
    if (!REPORTING_TEMPLATE_TYPES.includes(normalizedType)) {
      throw AppError.badRequest(`Unsupported templateType: ${body.templateType}`);
    }
    out.templateType = normalizedType;
  }
  if (body.filters !== undefined) {
    validateFiltersForType(
      out.templateType || body.templateType || "membershiplisting",
      body.filters,
    );
    out.filters = body.filters;
  }
  if (body.columns !== undefined) {
    if (!Array.isArray(body.columns)) {
      throw AppError.badRequest("columns must be an array");
    }
    out.columns = body.columns;
  }
  if (body.columnLabels !== undefined) {
    out.columnLabels = body.columnLabels;
  }
  if (body.isDefault !== undefined) {
    out.isDefault = Boolean(body.isDefault);
  }
  if (body.pinned !== undefined) {
    out.pinned = Boolean(body.pinned);
  }

  return out;
}

module.exports = {
  validateCreateGridTemplate,
  validateUpdateGridTemplate,
};
