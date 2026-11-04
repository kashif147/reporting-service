const express = require("express");
const router = express.Router();
const dashboardController = require("../controllers/dashboard.controller");
const { authenticate, requireTenant, requireCrmUser, tenantContextWarn } = require("../middlewares/auth");
const { defaultPolicyMiddleware } = require("../middlewares/policy.middleware");

// Apply authentication, tenant validation and the CRM-only gate to all routes
router.use(authenticate, tenantContextWarn);
router.use(requireTenant);
router.use(requireCrmUser);

// PDP rollout P2 (§4 Q4): the dashboards are aggregate membership statistics -> the statistics family.
const statisticsRead = defaultPolicyMiddleware.requirePermission("reporting.statistics", "read");

router.post("/", statisticsRead, dashboardController.getUnifiedDashboard);

router.post("/membership", statisticsRead, dashboardController.getMembershipDashboard);

// The 10 legacy GET routes (/overview, /trends, /joiners, /leavers, /net, /categories,
// /grades, /sections, /workplaces, /regions) were removed in Phase 2B: they read global
// (non-tenant-scoped) mv_* materialized views and their handlers called an undefined
// `next`. No frontend/portal/backend/n8n caller used them; the CRM dashboard uses
// POST /dashboard/membership above.

module.exports = router;
