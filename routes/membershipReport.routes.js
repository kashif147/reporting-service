const express = require("express");
const router = express.Router();
const membershipReportController = require("../controllers/membershipReport.controller");
const { authenticate, requireTenant } = require("../middlewares/auth");
const { defaultPolicyMiddleware } = require("../middlewares/policy.middleware");

router.use(authenticate);
router.use(requireTenant);

router.post(
  "/preset/:reportType",
  defaultPolicyMiddleware.requirePermission("reporting", "read"),
  membershipReportController.getPresetReport
);

router.post(
  "/listing",
  defaultPolicyMiddleware.requirePermission("reporting", "read"),
  membershipReportController.getMembershipListing
);

router.post(
  "/compare",
  defaultPolicyMiddleware.requirePermission("reporting", "read"),
  membershipReportController.getComparisonReport
);

router.post(
  "/live-stats",
  defaultPolicyMiddleware.requirePermission("reporting", "read"),
  membershipReportController.getLiveStats
);

router.post(
  "/statistics",
  defaultPolicyMiddleware.requirePermission("reporting", "read"),
  membershipReportController.getMembershipStatistics
);

router.post(
  "/workplace-breakdown",
  defaultPolicyMiddleware.requirePermission("reporting", "read"),
  membershipReportController.getWorkplaceBreakdown
);

router.post(
  "/year-reconciliation",
  defaultPolicyMiddleware.requirePermission("reporting", "read"),
  membershipReportController.getYearReconciliation
);

router.post(
  "/snapshots/build",
  defaultPolicyMiddleware.requirePermission("reporting", "write"),
  membershipReportController.buildPeriodSnapshot
);

module.exports = router;
