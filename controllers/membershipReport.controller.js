const membershipReportService = require("../services/membershipReport.service");
const comparisonReportService = require("../services/comparisonReport.service");
const liveStatsReportService = require("../services/liveStatsReport.service");
const {
  getYearReconciliation,
} = require("../services/membershipYearReconciliation.service");
const {
  getMembershipStatistics,
} = require("../services/membershipStatisticsReport.service");
const {
  getWorkplaceBreakdownReport,
} = require("../services/workplaceBreakdownReport.service");
const {
  getCreditorsListReport,
} = require("../services/creditorsListReport.service");
const { buildSnapshotAndMetrics } = require("../services/snapshotBuild.service");

exports.getPresetReport = async (req, res, next) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(400).json({
        error: { message: "Tenant required", code: "TENANT_REQUIRED" },
      });
    }
    const reportType = req.params.reportType;
    const data = await membershipReportService.getPresetReport(
      tenantId,
      reportType,
      req.body || {}
    );
    res.json({ status: "success", data });
  } catch (err) {
    if (err.statusCode === 400) {
      return res.status(400).json({ error: { message: err.message } });
    }
    next(err);
  }
};

exports.getMembershipListing = async (req, res, next) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(400).json({
        error: { message: "Tenant required", code: "TENANT_REQUIRED" },
      });
    }

    const filters = req.body || {};
    const data = await membershipReportService.getMembershipListing(
      tenantId,
      filters
    );

    res.json({
      status: "success",
      data,
    });
  } catch (err) {
    next(err);
  }
};

exports.getComparisonReport = async (req, res, next) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(400).json({
        error: { message: "Tenant required", code: "TENANT_REQUIRED" },
      });
    }
    const body = req.body || {};
    const data = body.dual
      ? await comparisonReportService.runDualComparisonReport(tenantId, body)
      : await comparisonReportService.runComparisonReport(tenantId, body);
    res.json({ status: "success", data });
  } catch (err) {
    next(err);
  }
};

exports.getLiveStats = async (req, res, next) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(400).json({
        error: { message: "Tenant required", code: "TENANT_REQUIRED" },
      });
    }
    const data = await liveStatsReportService.runLiveStatsReport(
      tenantId,
      req.body || {}
    );
    res.json({ status: "success", data });
  } catch (err) {
    next(err);
  }
};

exports.getMembershipStatistics = async (req, res, next) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(400).json({
        error: { message: "Tenant required", code: "TENANT_REQUIRED" },
      });
    }
    const data = await getMembershipStatistics(tenantId, req.body || {});
    res.json({ status: "success", data });
  } catch (err) {
    if (err.statusCode === 400) {
      return res.status(400).json({ error: { message: err.message } });
    }
    next(err);
  }
};

exports.getWorkplaceBreakdown = async (req, res, next) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(400).json({
        error: { message: "Tenant required", code: "TENANT_REQUIRED" },
      });
    }
    const data = await getWorkplaceBreakdownReport(tenantId, req.body || {});
    res.json({ status: "success", data });
  } catch (err) {
    if (err.statusCode === 400) {
      return res.status(400).json({ error: { message: err.message } });
    }
    next(err);
  }
};

exports.getCreditorsList = async (req, res, next) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(400).json({
        error: { message: "Tenant required", code: "TENANT_REQUIRED" },
      });
    }
    const data = await getCreditorsListReport(tenantId, req.body || {}, req);
    res.json({ status: "success", data });
  } catch (err) {
    if (err.statusCode === 400) {
      return res.status(400).json({ error: { message: err.message } });
    }
    next(err);
  }
};

exports.getYearReconciliation = async (req, res, next) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(400).json({
        error: { message: "Tenant required", code: "TENANT_REQUIRED" },
      });
    }
    const data = await getYearReconciliation(tenantId, req.body || {});
    res.json({ status: "success", data });
  } catch (err) {
    if (err.statusCode === 400) {
      return res.status(400).json({ error: { message: err.message } });
    }
    next(err);
  }
};

exports.buildPeriodSnapshot = async (req, res, next) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(400).json({
        error: { message: "Tenant required", code: "TENANT_REQUIRED" },
      });
    }
    const resolved = await buildSnapshotAndMetrics(tenantId, req.body.period);
    res.json({ status: "success", data: resolved });
  } catch (err) {
    next(err);
  }
};
