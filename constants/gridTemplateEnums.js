const FILTER_OPERATOR = {
  EQUAL_TO: "equal_to",
  NOT_EQUAL_TO: "not_equal_to",
  BETWEEN: "between",
  WITHIN: "within",
  MORE_THAN: "more_than",
  LESS_THAN: "less_than",
  GREATER_THAN: "greater_than",
  LESS_THAN_OR_EQUAL: "less_than_or_equal",
  GREATER_THAN_OR_EQUAL: "greater_than_or_equal",
  CONTAINS: "contains",
  NOT_CONTAINS: "not_contains",
  STARTS_WITH: "starts_with",
  ENDS_WITH: "ends_with",
};

/** Reporting-service listing API / template filter keys (membershiplisting). */
const MEMBERSHIP_LISTING_FILTER_FIELD_MAP = {
  membershipCategories: "membershipCategories",
  membershipStatuses: "membershipStatuses",
  membershipMovements: "membershipMovements",
  grades: "grades",
  sections: "sections",
  regions: "regions",
  branches: "branches",
  workLocations: "workLocations",
  paymentTypes: "paymentTypes",
  paymentFrequencies: "paymentFrequencies",
  subscriptionYears: "subscriptionYears",
  isCurrent: "isCurrent",
  startDateRange: "startDateRange",
  expiryDateRange: "expiryDateRange",
  cancelledDateRange: "cancelledDateRange",
  resignedDateRange: "resignedDateRange",
  processedDateRange: "processedDateRange",
  renewalDate: "renewalDate",
  paymentDate: "paymentDate",
  search: "search",
  invoiceAmount: "invoiceAmount",
  arrearsAmount: "arrearsAmount",
  deferredAmount: "deferredAmount",
  balance: "balance",
};

const MEMBERSHIP_LISTING_TEMPLATE_FILTER_KEYS = Object.keys(
  MEMBERSHIP_LISTING_FILTER_FIELD_MAP,
);

const REPORTING_TEMPLATE_TYPES = ["membershiplisting"];

module.exports = {
  FILTER_OPERATOR,
  MEMBERSHIP_LISTING_FILTER_FIELD_MAP,
  MEMBERSHIP_LISTING_TEMPLATE_FILTER_KEYS,
  REPORTING_TEMPLATE_TYPES,
};
