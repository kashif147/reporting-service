const dashboardService = require("../services/dashboard.service");

exports.getOverview = async (req, res) => {
  try {
    const data = await dashboardService.getOverview();
    res.json(data);
  } catch (err) {
    next(err);
  }
};

exports.getTrends = async (req, res) => {
  try {
    const data = await dashboardService.getTrends();
    res.json(data);
  } catch (err) {
    next(err);
  }
};

exports.getJoiners = async (req, res) => {
  try {
    const data = await dashboardService.getJoiners();
    res.json(data);
  } catch (err) {
    next(err);
  }
};

exports.getLeavers = async (req, res) => {
  try {
    const data = await dashboardService.getLeavers();
    res.json(data);
  } catch (err) {
    next(err);
  }
};

exports.getNetChange = async (req, res) => {
  try {
    const data = await dashboardService.getNetChange();
    res.json(data);
  } catch (err) {
    next(err);
  }
};

exports.getCategoryDistribution = async (req, res) => {
  try {
    const data = await dashboardService.getCategoryDistribution();
    res.json(data);
  } catch (err) {
    next(err);
  }
};

exports.getGradeDistribution = async (req, res) => {
  try {
    const data = await dashboardService.getGradeDistribution();
    res.json(data);
  } catch (err) {
    next(err);
  }
};

exports.getSectionDistribution = async (req, res) => {
  try {
    const data = await dashboardService.getSectionDistribution();
    res.json(data);
  } catch (err) {
    next(err);
  }
};

exports.getWorkplaceSummary = async (req, res) => {
  try {
    const data = await dashboardService.getWorkplaceSummary();
    res.json(data);
  } catch (err) {
    next(err);
  }
};

exports.getRegionBranchSummary = async (req, res) => {
  try {
    const data = await dashboardService.getRegionBranchSummary();
    res.json(data);
  } catch (err) {
    next(err);
  }
};
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
