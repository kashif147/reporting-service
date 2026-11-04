const express = require("express");
const router = express.Router();
const gridFilterTemplateController = require("../controllers/grid.filter.template.controller");
const { authenticate, requireTenant, requireCrmUser, tenantContextWarn } = require("../middlewares/auth");
const { defaultPolicyMiddleware } = require("../middlewares/policy.middleware");
const requireMongo = require("../middlewares/requireMongo");

router.use(authenticate, tenantContextWarn);
router.use(requireTenant);
router.use(requireCrmUser);
router.use(requireMongo);

// PDP rollout P2 (§4 Q4): Save View has its own family (the caller's own report views).
const templatesRead = defaultPolicyMiddleware.requirePermission("reporting.templates", "read");
const templatesWrite = defaultPolicyMiddleware.requirePermission("reporting.templates", "write");

router.post("/", templatesWrite, gridFilterTemplateController.createTemplate);
router.get("/", templatesRead, gridFilterTemplateController.getUserTemplates);
router.get("/default", templatesRead, gridFilterTemplateController.getDefaultTemplate);
router.get("/:templateId", templatesRead, gridFilterTemplateController.getTemplateById);
router.put("/:templateId", templatesWrite, gridFilterTemplateController.updateTemplate);
router.delete("/:templateId", templatesWrite, gridFilterTemplateController.deleteTemplate);

module.exports = router;
