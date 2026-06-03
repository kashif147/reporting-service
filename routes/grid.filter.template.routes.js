const express = require("express");
const router = express.Router();
const gridFilterTemplateController = require("../controllers/grid.filter.template.controller");
const { authenticate, requireTenant } = require("../middlewares/auth");
const { defaultPolicyMiddleware } = require("../middlewares/policy.middleware");

router.use(authenticate);
router.use(requireTenant);

router.post(
  "/",
  defaultPolicyMiddleware.requirePermission("reporting", "write"),
  gridFilterTemplateController.createTemplate,
);
router.get(
  "/",
  defaultPolicyMiddleware.requirePermission("reporting", "read"),
  gridFilterTemplateController.getUserTemplates,
);
router.get(
  "/default",
  defaultPolicyMiddleware.requirePermission("reporting", "read"),
  gridFilterTemplateController.getDefaultTemplate,
);
router.get(
  "/:templateId",
  defaultPolicyMiddleware.requirePermission("reporting", "read"),
  gridFilterTemplateController.getTemplateById,
);
router.put(
  "/:templateId",
  defaultPolicyMiddleware.requirePermission("reporting", "write"),
  gridFilterTemplateController.updateTemplate,
);
router.delete(
  "/:templateId",
  defaultPolicyMiddleware.requirePermission("reporting", "write"),
  gridFilterTemplateController.deleteTemplate,
);

module.exports = router;
