const express = require("express");
const router = express.Router();
const dashboardController = require("../controllers/dashboard.controller");
const { authenticate, requireTenant } = require("../middlewares/auth");
const { defaultPolicyMiddleware } = require("../middlewares/policy.middleware");

// Apply authentication and tenant validation to all routes
router.use(authenticate);
router.use(requireTenant);

// All dashboard routes require reporting:read permission
router.post(
  "/",
  defaultPolicyMiddleware.requirePermission("reporting", "read"),
  dashboardController.getUnifiedDashboard
);

router.post(
  "/membership",
  defaultPolicyMiddleware.requirePermission("reporting", "read"),
  dashboardController.getMembershipDashboard
);

// Overview
router.get(
  "/overview",
  defaultPolicyMiddleware.requirePermission("reporting", "read"),
  dashboardController.getOverview
);

// Trends
router.get(
  "/trends",
  defaultPolicyMiddleware.requirePermission("reporting", "read"),
  dashboardController.getTrends
);

// Joiners / Leavers
router.get(
  "/joiners",
  defaultPolicyMiddleware.requirePermission("reporting", "read"),
  dashboardController.getJoiners
);
router.get(
  "/leavers",
  defaultPolicyMiddleware.requirePermission("reporting", "read"),
  dashboardController.getLeavers
);

// Net Change
router.get(
  "/net",
  defaultPolicyMiddleware.requirePermission("reporting", "read"),
  dashboardController.getNetChange
);

// Distributions
router.get(
  "/categories",
  defaultPolicyMiddleware.requirePermission("reporting", "read"),
  dashboardController.getCategoryDistribution
);
router.get(
  "/grades",
  defaultPolicyMiddleware.requirePermission("reporting", "read"),
  dashboardController.getGradeDistribution
);
router.get(
  "/sections",
  defaultPolicyMiddleware.requirePermission("reporting", "read"),
  dashboardController.getSectionDistribution
);

// Workplaces / Regions
router.get(
  "/workplaces",
  defaultPolicyMiddleware.requirePermission("reporting", "read"),
  dashboardController.getWorkplaceSummary
);
router.get(
  "/regions",
  defaultPolicyMiddleware.requirePermission("reporting", "read"),
  dashboardController.getRegionBranchSummary
);

module.exports = router;
