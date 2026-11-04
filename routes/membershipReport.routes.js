const express = require("express");
const router = express.Router();
const membershipReportController = require("../controllers/membershipReport.controller");
const { authenticate, requireTenant, requireCrmUser, tenantContextWarn } = require("../middlewares/auth");
const { defaultPolicyMiddleware } = require("../middlewares/policy.middleware");

router.use(authenticate, tenantContextWarn);
router.use(requireTenant);
router.use(requireCrmUser);

// PDP rollout P2 (§4 Q4): one permission family per kind of report data. There is deliberately no
// generic reporting:read - each family is granted separately.
//   statistics - aggregates / counts only
//   listings   - row-level member personal data
//   finance    - per-member balances with names / addresses
const statisticsRead = defaultPolicyMiddleware.requirePermission("reporting.statistics", "read");
const listingsRead = defaultPolicyMiddleware.requirePermission("reporting.listings", "read");
const financeRead = defaultPolicyMiddleware.requirePermission("reporting.finance", "read");

router.post("/preset/:reportType", listingsRead, membershipReportController.getPresetReport);

router.post("/listing", listingsRead, membershipReportController.getMembershipListing);

router.post("/compare", statisticsRead, membershipReportController.getComparisonReport);

router.post("/live-stats", statisticsRead, membershipReportController.getLiveStats);

router.post("/statistics", statisticsRead, membershipReportController.getMembershipStatistics);

router.post("/workplace-breakdown", statisticsRead, membershipReportController.getWorkplaceBreakdown);

router.post("/creditors-list", financeRead, membershipReportController.getCreditorsList);

router.post("/debtors-list", financeRead, membershipReportController.getDebtorsList);

router.post("/year-reconciliation", statisticsRead, membershipReportController.getYearReconciliation);

// Snapshot build writes Postgres snapshots: no tenant role code. `reporting:write` has no catalogue
// permission, so the PDP denies it to every role except ASU (own-tenant admin rule) - ASU / internal only.
router.post(
  "/snapshots/build",
  defaultPolicyMiddleware.requirePermission("reporting", "write"),
  membershipReportController.buildPeriodSnapshot
);

module.exports = router;
