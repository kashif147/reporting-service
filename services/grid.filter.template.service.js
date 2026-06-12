const mongoose = require("mongoose");
const Template = require("../models/template.model");
const { AppError } = require("../errors/AppError");

function toTemplateResponse(doc) {
  const obj =
    doc && typeof doc.toObject === "function" ? doc.toObject() : { ...doc };
  delete obj.meta;
  delete obj.__v;
  return obj;
}

function tenantOrLegacyMatch(tenantId) {
  if (!tenantId) return {};
  return {
    $or: [
      { tenantId },
      { tenantId: null },
      { tenantId: { $exists: false } },
    ],
  };
}

function normalizeUserId(userId) {
  if (userId == null || userId === "") return userId;
  return String(userId);
}

/** Match userId stored as string or legacy ObjectId in MongoDB. */
function userIdMatch(userId) {
  const uid = normalizeUserId(userId);
  if (uid == null || uid === "") return uid;
  if (mongoose.isValidObjectId(uid)) {
    return { $in: [uid, new mongoose.Types.ObjectId(uid)] };
  }
  return uid;
}

function toObjectIdOrSelf(id) {
  if (id == null) return id;
  const s = String(id);
  if (mongoose.isValidObjectId(s)) {
    return new mongoose.Types.ObjectId(s);
  }
  return id;
}

function templateTypeMatchForList(type) {
  const t = (type == null || type === "" ? "membershiplisting" : String(type)).trim();
  const lower = t.toLowerCase();
  if (lower === "membershiplisting") {
    return { $in: ["membershiplisting", "MembershipListing", "membershipListing"] };
  }
  if (lower === "statisticsreport") {
    return { $in: ["statisticsreport", "StatisticsReport", "statisticsReport"] };
  }
  if (lower === "workplacebreakdownreport") {
    return {
      $in: [
        "workplacebreakdownreport",
        "WorkplaceBreakdownReport",
        "workplaceBreakdownReport",
      ],
    };
  }
  if (lower === "creditorslistreport") {
    return {
      $in: [
        "creditorslistreport",
        "CreditorsListReport",
        "creditorsListReport",
      ],
    };
  }
  if (lower === "debtorslistreport") {
    return {
      $in: [
        "debtorslistreport",
        "DebtorsListReport",
        "debtorsListReport",
      ],
    };
  }
  return lower;
}

function clearSisterIsDefaultFlags(userId, templateType, excludeId, tenantId) {
  const uid = normalizeUserId(userId);
  const mq = {
    userId: userIdMatch(uid),
    templateType: templateTypeMatchForList(templateType),
    "meta.deleted": false,
    systemDefault: { $ne: true },
  };
  if (excludeId != null) {
    mq._id = { $ne: toObjectIdOrSelf(excludeId) };
  }
  Object.assign(mq, tenantOrLegacyMatch(tenantId));
  return Template.updateMany(mq, { $set: { isDefault: false } });
}

async function findSystemDefaultTemplateDoc(type, tenantId) {
  const resolvedType = (type == null || type === "" ? "membershiplisting" : String(type)).trim();
  const base = {
    systemDefault: true,
    "meta.deleted": false,
    templateType: templateTypeMatchForList(resolvedType),
  };
  if (tenantId) {
    const scoped = await Template.findOne({ ...base, tenantId });
    if (scoped) return scoped;
  }
  return Template.findOne({
    ...base,
    $or: [{ tenantId: null }, { tenantId: { $exists: false } }],
  });
}

class GridFilterTemplateService {
  async createTemplate(userId, templateData, tenantId = null) {
    const {
      name,
      templateType,
      filters,
      columns,
      columnLabels,
      visibleFilters,
      isDefault,
      pinned,
    } = templateData;
    const type = String(templateType || "membershiplisting").trim().toLowerCase();
    const uid = normalizeUserId(userId);

    if (isDefault) {
      await clearSisterIsDefaultFlags(uid, type, null, tenantId);
    }

    const template = new Template({
      userId: uid,
      tenantId: tenantId || undefined,
      name: name != null && name !== "" ? name : undefined,
      templateType: type,
      filters: filters || {},
      columns: columns || [],
      columnLabels: columnLabels || {},
      visibleFilters: Array.isArray(visibleFilters) ? visibleFilters : [],
      isDefault: isDefault || false,
      pinned: pinned || false,
    });

    const saved = await template.save();
    return toTemplateResponse(saved);
  }

  async getUserTemplatesWithSystemDefault(userId, type = "membershiplisting", tenantId = null) {
    const uid = normalizeUserId(userId);
    const typeFilter = { templateType: templateTypeMatchForList(type) };
    const systemDefault = await findSystemDefaultTemplateDoc(type, tenantId);

    const uq = {
      userId: userIdMatch(uid),
      "meta.deleted": false,
      ...typeFilter,
    };
    Object.assign(uq, tenantOrLegacyMatch(tenantId));

    const userTemplates = await Template.find(uq).sort({
      isDefault: -1,
      createdAt: -1,
    });

    const allTemplates = [];
    if (systemDefault) allTemplates.push(systemDefault);
    allTemplates.push(...userTemplates);
    return allTemplates;
  }

  async getTemplateById(templateId, userId, tenantId = null) {
    const uid = normalizeUserId(userId);
    const systemDefault = await Template.findOne({
      _id: templateId,
      systemDefault: true,
      "meta.deleted": false,
    });

    if (systemDefault) {
      if (
        tenantId &&
        systemDefault.tenantId &&
        String(systemDefault.tenantId) !== String(tenantId)
      ) {
        throw AppError.notFound("Filter template not found");
      }
      const type = systemDefault.templateType || "membershiplisting";
      const dq = {
        userId: userIdMatch(uid),
        templateType: templateTypeMatchForList(type),
        isDefault: true,
        "meta.deleted": false,
      };
      Object.assign(dq, tenantOrLegacyMatch(tenantId));
      const userHasDefault = await Template.exists(dq);
      const out = toTemplateResponse(systemDefault);
      if (!userHasDefault) out.isDefault = true;
      return out;
    }

    const tq = { _id: templateId, userId: userIdMatch(uid), "meta.deleted": false };
    Object.assign(tq, tenantOrLegacyMatch(tenantId));

    const template = await Template.findOne(tq);
    if (!template) {
      throw AppError.notFound("Filter template not found");
    }
    return toTemplateResponse(template);
  }

  async updateTemplate(
    templateId,
    userId,
    updateData,
    tenantId = null,
    allowSystemDefaultEdits = false,
  ) {
    const uid = normalizeUserId(userId);
    const {
      name,
      templateType,
      filters,
      columns,
      columnLabels,
      visibleFilters,
      isDefault,
      pinned,
    } = updateData;

    let template = await Template.findOne({
      _id: templateId,
      systemDefault: true,
      "meta.deleted": false,
    });

    if (
      template &&
      tenantId &&
      template.tenantId &&
      String(template.tenantId) !== String(tenantId)
    ) {
      template = null;
    }

    if (!template) {
      const tq = { _id: templateId, userId: userIdMatch(uid), "meta.deleted": false };
      Object.assign(tq, tenantOrLegacyMatch(tenantId));
      template = await Template.findOne(tq);
    }

    if (!template) {
      throw AppError.notFound("Filter template not found");
    }

    const type =
      templateType !== undefined && templateType !== null
        ? templateType
        : template.templateType || "membershiplisting";

    if (template.systemDefault && !allowSystemDefaultEdits) {
      if (isDefault === true) {
        await clearSisterIsDefaultFlags(uid, type, null, tenantId);
      }
      if (pinned !== undefined) template.pinned = pinned;
      const saved = await template.save();
      const response = toTemplateResponse(saved);
      if (isDefault === true) response.isDefault = true;
      return response;
    }

    if (isDefault === true) {
      await clearSisterIsDefaultFlags(uid, type, template._id, tenantId);
    }

    if (name !== undefined) template.name = name !== "" ? name : null;
    if (templateType !== undefined) template.templateType = templateType;
    if (filters !== undefined) template.filters = filters;
    if (columns !== undefined) template.columns = columns;
    if (columnLabels !== undefined) template.columnLabels = columnLabels;
    if (visibleFilters !== undefined) {
      template.visibleFilters = Array.isArray(visibleFilters)
        ? visibleFilters
        : [];
    }
    if (isDefault !== undefined) template.isDefault = isDefault;
    if (pinned !== undefined) template.pinned = pinned;

    const saved = await template.save();
    return toTemplateResponse(saved);
  }

  async deleteTemplate(templateId, userId, tenantId = null) {
    const uid = normalizeUserId(userId);
    const tq = { _id: templateId, userId: userIdMatch(uid), "meta.deleted": false };
    Object.assign(tq, tenantOrLegacyMatch(tenantId));

    const template = await Template.findOne(tq);
    if (!template) {
      throw AppError.notFound("Filter template not found");
    }

    template.meta.deleted = true;
    template.meta.deletedAt = new Date();
    return template.save();
  }

  async getDefaultTemplate(userId, tenantId = null) {
    const uid = normalizeUserId(userId);
    const dq = { userId: userIdMatch(uid), isDefault: true, "meta.deleted": false };
    Object.assign(dq, tenantOrLegacyMatch(tenantId));
    const doc = await Template.findOne(dq);
    return doc ? toTemplateResponse(doc) : null;
  }
}

module.exports = new GridFilterTemplateService();
