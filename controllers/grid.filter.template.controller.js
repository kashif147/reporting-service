const gridFilterTemplateService = require("../services/grid.filter.template.service");
const { AppError } = require("../errors/AppError");
const {
  validateCreateGridTemplate,
  validateUpdateGridTemplate,
} = require("../validators/gridFilterTemplate.validators");

function extractUserAndCreatorContext(req) {
  const userType = req.user?.userType || req.headers["x-user-type"] || "";
  const creatorId = req.user?.id || req.user?.sub || req.userId;
  const tenantId = req.tenantId || req.user?.tenantId || req.ctx?.tenantId;
  return { userType, creatorId, tenantId };
}

function normalizeRoleValue(role) {
  if (!role) return "";
  const raw =
    typeof role === "string"
      ? role
      : role.code || role.name || role.roleCode || role.roleName || "";
  return String(raw)
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
}

function canEditSystemDefaultTemplate(req) {
  const roles = Array.isArray(req.roles)
    ? req.roles
    : Array.isArray(req.user?.roles)
      ? req.user.roles
      : [];
  const normalizedRoles = roles.map(normalizeRoleValue).filter(Boolean);
  return normalizedRoles.some((role) =>
    [
      "su",
      "asu",
      "super user",
      "assistant super user",
      "system admin",
      "system administrator",
      "superuser",
      "assistantsuperuser",
      "systemadmin",
    ].includes(role),
  );
}

function isSystemDefaultPreferenceOnlyUpdate(payload = {}) {
  const keys = Object.keys(payload || {}).filter(
    (key) => payload[key] !== undefined,
  );
  if (keys.length === 0) return false;
  return keys.every((key) => key === "isDefault" || key === "pinned");
}

function assertCrmUser(req) {
  const { userType } = extractUserAndCreatorContext(req);
  if (userType !== "CRM") {
    throw AppError.forbidden(
      "Access denied. Only CRM users can manage filter templates.",
    );
  }
}

exports.createTemplate = async (req, res, next) => {
  try {
    assertCrmUser(req);
    const { creatorId, tenantId } = extractUserAndCreatorContext(req);
    const validatedData = validateCreateGridTemplate(req.body);

    const template = await gridFilterTemplateService.createTemplate(
      creatorId,
      validatedData,
      tenantId || null,
    );

    return res.success(template, "Filter template created successfully");
  } catch (error) {
    if (error instanceof AppError) return next(error);
    return next(error);
  }
};

exports.getUserTemplates = async (req, res, next) => {
  try {
    assertCrmUser(req);
    const { creatorId, tenantId } = extractUserAndCreatorContext(req);
    const type = req.query.type || "membershiplisting";

    const list =
      await gridFilterTemplateService.getUserTemplatesWithSystemDefault(
        creatorId,
        type,
        tenantId || null,
      );

    const systemDefault = list.find((t) => t.systemDefault) || null;
    const userTemplates = list.filter((t) => !t.systemDefault);
    const userHasDefault = userTemplates.some((t) => t.isDefault);
    if (systemDefault && !userHasDefault) {
      systemDefault.isDefault = true;
    }

    return res.success({
      total: list.length,
      templates: {
        systemDefault,
        userTemplates,
      },
    });
  } catch (error) {
    return next(error);
  }
};

exports.getTemplateById = async (req, res, next) => {
  try {
    assertCrmUser(req);
    const { creatorId, tenantId } = extractUserAndCreatorContext(req);
    const { templateId } = req.params;

    const template = await gridFilterTemplateService.getTemplateById(
      templateId,
      creatorId,
      tenantId || null,
    );

    return res.success(template);
  } catch (error) {
    if (error instanceof AppError && error.status === 404) {
      return res.notFoundRecord("Filter template not found");
    }
    return next(error);
  }
};

exports.updateTemplate = async (req, res, next) => {
  try {
    assertCrmUser(req);
    const { creatorId, tenantId } = extractUserAndCreatorContext(req);
    const { templateId } = req.params;
    const validatedData = validateUpdateGridTemplate(req.body);

    const existingTemplate = await gridFilterTemplateService.getTemplateById(
      templateId,
      creatorId,
      tenantId || null,
    );
    const isPreferenceOnly =
      existingTemplate?.systemDefault &&
      isSystemDefaultPreferenceOnlyUpdate(validatedData);

    if (
      existingTemplate?.systemDefault &&
      !isPreferenceOnly &&
      !canEditSystemDefaultTemplate(req)
    ) {
      return next(
        AppError.forbidden(
          "Access denied. Only System Administrator with Assistant Super User or Super User role can update system default templates.",
        ),
      );
    }

    const template = await gridFilterTemplateService.updateTemplate(
      templateId,
      creatorId,
      validatedData,
      tenantId || null,
      canEditSystemDefaultTemplate(req),
    );

    return res.success(template, "Filter template updated successfully");
  } catch (error) {
    if (error instanceof AppError && error.status === 404) {
      return res.notFoundRecord("Filter template not found");
    }
    return next(error);
  }
};

exports.deleteTemplate = async (req, res, next) => {
  try {
    assertCrmUser(req);
    const { creatorId, tenantId } = extractUserAndCreatorContext(req);
    const { templateId } = req.params;

    await gridFilterTemplateService.deleteTemplate(
      templateId,
      creatorId,
      tenantId || null,
    );

    return res.success(null, "Filter template deleted successfully");
  } catch (error) {
    if (error instanceof AppError && error.status === 404) {
      return res.notFoundRecord("Filter template not found");
    }
    return next(error);
  }
};

exports.getDefaultTemplate = async (req, res, next) => {
  try {
    assertCrmUser(req);
    const { creatorId, tenantId } = extractUserAndCreatorContext(req);
    const template = await gridFilterTemplateService.getDefaultTemplate(
      creatorId,
      tenantId || null,
    );

    return res.success(template);
  } catch (error) {
    return next(error);
  }
};
