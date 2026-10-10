/**
 * Executive/membership dashboard (tenant-scoped, Postgres analytics tables).
 * Legacy mv_* handlers and services/dashboard.service.js were removed in Phase 2B.
 */
exports.getUnifiedDashboard = async (req, res, next) => {
  try {
    const dashboardAnalytics = require("../services/dashboardAnalytics.service");
    const { toMembershipDashboardShape } = require("../services/dashboardTransform.service");
    const body = req.body || {};
    const filters = body.filters || body;
    const raw = await dashboardAnalytics.getUnifiedDashboard(
      req.tenantId,
      filters
    );
    const shaped = toMembershipDashboardShape(raw);
    res.json({ status: "success", data: shaped, meta: { asOfDate: raw.asOfDate } });
  } catch (err) {
    next(err);
  }
};

exports.getMembershipDashboard = exports.getUnifiedDashboard;
