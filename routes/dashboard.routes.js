const express = require("express");
const router = express.Router();
const dashboardController = require("../controllers/dashboard.controller");

// Overview
router.get("/overview", dashboardController.getOverview);

// Trends
router.get("/trends", dashboardController.getTrends);

// Joiners / Leavers
router.get("/joiners", dashboardController.getJoiners);
router.get("/leavers", dashboardController.getLeavers);

// Net Change
router.get("/net", dashboardController.getNetChange);

// Distributions
router.get("/categories", dashboardController.getCategoryDistribution);
router.get("/grades", dashboardController.getGradeDistribution);
router.get("/sections", dashboardController.getSectionDistribution);

// Workplaces / Regions
router.get("/workplaces", dashboardController.getWorkplaceSummary);
router.get("/regions", dashboardController.getRegionBranchSummary);

module.exports = router;
