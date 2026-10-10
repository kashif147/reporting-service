const express = require("express");
const router = express.Router();
const dashboardController = require("../controllers/dashboard.controller");
const { authenticate, requireTenant, tenantContextWarn } = require("../middlewares/auth");
const { defaultPolicyMiddleware } = require("../middlewares/policy.middleware");

// Apply authentication and tenant validation to all routes
router.use(authenticate, tenantContextWarn);
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

// The 10 legacy GET routes (/overview, /trends, /joiners, /leavers, /net, /categories,
// /grades, /sections, /workplaces, /regions) were removed in Phase 2B: they read global
// (non-tenant-scoped) mv_* materialized views and their handlers called an undefined
// `next`. No frontend/portal/backend/n8n caller used them; the CRM dashboard uses
// POST /dashboard/membership above.

module.exports = router;
