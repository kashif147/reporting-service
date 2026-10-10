/**
 * Sync the work-location lookup hierarchy (region / branch / work location) and the
 * assigned officer's display fields from user-service into reporting Postgres
 * (`reports.membership_location_lookup`).
 *
 * Data comes ONLY from user-service's HTTP API (GET /api/lookuptype and
 * GET /api/lookup/by-type/:lookuptypeId/hierarchy), called with the caller's
 * forwarded identity. reporting-service never opens a connection to user-service's
 * MongoDB (database-per-service rule).
 *
 * Tenancy: rows are written under the trusted tenant of the request (req.tenantId as
 * established by authenticate + tenantContextWarn), never a body/query value. Lookups
 * are platform-global in user-service today (per-tenant lookups are a separate Phase 2A
 * item) — this sync only stores what user-service returns to that caller.
 *
 * Officer data minimisation: only the officer's user id, initials and display name are
 * kept. The officer's email (which user-service includes in its populated officer
 * object) is never persisted or returned.
 */
const { upsertLocationLookups } = require("../repositories/locationLookup.repository");
const userServiceClient = require("../lib/userServiceClient");

const TYPE_SPECS = {
  region: { codes: ["REGION"], names: ["Region"] },
  branch: { codes: ["BRANCH"], names: ["Branch"] },
  workLocation: { codes: ["WORKLOC"], names: ["Work Location", "workLocation"] },
};

function label(doc) {
  return String(doc?.DisplayName || doc?.lookupname || doc?.name || "").trim();
}

function idOf(value) {
  if (value == null) return null;
  if (typeof value === "object") {
    return value._id != null ? String(value._id) : null;
  }
  return String(value);
}

function officerInitials(user) {
  if (!user || typeof user !== "object") return null;
  const first = String(user.userFirstName || "").trim();
  const last = String(user.userLastName || "").trim();
  if (first && last) return `${first[0]}${last[0]}`.toUpperCase();
  const full = String(user.userFullName || "").trim();
  if (!full) return null;
  const parts = full.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
  }
  return full.slice(0, 2).toUpperCase();
}

function officerDisplayName(user) {
  if (!user || typeof user !== "object") return null;
  const full = String(user.userFullName || "").trim();
  if (full) return full;
  const first = String(user.userFirstName || "").trim();
  const last = String(user.userLastName || "").trim();
  return `${first} ${last}`.trim() || null;
}

/**
 * Pick the lookup type for a spec from user-service's lookuptype list, mirroring the
 * previous query: code match first, then lookuptype/displayname name match, ignoring
 * deleted types.
 */
function resolveLookupType(lookupTypes, spec) {
  const live = (lookupTypes || []).filter((t) => t && t.isdeleted !== true);
  const byCode = live.find((t) => spec.codes?.includes(t.code));
  if (byCode) return byCode;
  return (
    live.find(
      (t) =>
        spec.names?.includes(t.lookuptype) ||
        spec.names?.includes(t.displayname),
    ) || null
  );
}

/** Reduce a user-service formatted lookup to only the fields reporting needs. */
function toNode(result) {
  const lookup = result?.lookup && typeof result.lookup === "object" ? result.lookup : result;
  if (!lookup || lookup._id == null) return null;
  const officer = lookup.officer;
  return {
    _id: String(lookup._id),
    name: label(lookup),
    parentId: idOf(lookup.Parentlookupid),
    officerUserId: idOf(officer),
    officerInitials: officerInitials(officer),
    officerDisplayName: officerDisplayName(officer),
  };
}

async function loadNodesForType(typeDoc, req, tenantId) {
  if (!typeDoc?._id) return [];
  const results = await userServiceClient.getLookupsByTypeWithHierarchy(
    typeDoc._id,
    req,
    tenantId,
  );
  return results.map(toNode).filter(Boolean);
}

function resolveParentChain(parentId, byId, regionIds, branchIds) {
  let branchNode = null;
  let regionNode = null;
  const seen = new Set();
  let current = parentId;
  while (current && !seen.has(current)) {
    seen.add(current);
    const parent = byId.get(current);
    if (!parent) break;
    if (branchIds.has(current)) branchNode = parent;
    if (regionIds.has(current)) regionNode = parent;
    current = parent.parentId;
  }
  return { branchNode, regionNode };
}

/**
 * Build membership_location_lookup rows from user-service via HTTP.
 * Only the fields below leave this function — no officer email.
 */
async function fetchLocationLookupRows(req, tenantId) {
  const lookupTypes = await userServiceClient.listLookupTypes(req, tenantId);
  const regionType = resolveLookupType(lookupTypes, TYPE_SPECS.region);
  const branchType = resolveLookupType(lookupTypes, TYPE_SPECS.branch);
  const workLocType = resolveLookupType(lookupTypes, TYPE_SPECS.workLocation);

  const [regions, branches, workLocations] = await Promise.all([
    loadNodesForType(regionType, req, tenantId),
    loadNodesForType(branchType, req, tenantId),
    loadNodesForType(workLocType, req, tenantId),
  ]);

  const byId = new Map();
  for (const list of [regions, branches, workLocations]) {
    for (const node of list) byId.set(node._id, node);
  }
  const regionIds = new Set(regions.map((r) => r._id));
  const branchIds = new Set(branches.map((b) => b._id));

  const rows = [];
  for (const wl of workLocations) {
    if (!wl.name) continue;
    const { branchNode, regionNode } = resolveParentChain(
      wl.parentId,
      byId,
      regionIds,
      branchIds,
    );
    rows.push({
      work_location: wl.name,
      branch: branchNode?.name || null,
      region: regionNode?.name || null,
      lookup_id: wl._id,
      officer_user_id: wl.officerUserId,
      officer_initials: wl.officerInitials,
      officer_display_name: wl.officerDisplayName,
      branch_officer_user_id: branchNode?.officerUserId || null,
      region_officer_user_id: regionNode?.officerUserId || null,
    });
  }
  return rows;
}

/**
 * Resolve the trusted tenant from the authenticated request. req.tenantId is re-pinned
 * by tenantContextWarn; req.ctx.tenantId is set by authenticate. They must agree.
 */
function trustedTenantOf(req) {
  const tenantId = req?.tenantId || req?.ctx?.tenantId || null;
  if (!tenantId) return null;
  if (req?.ctx?.tenantId && String(req.ctx.tenantId) !== String(tenantId)) {
    return null;
  }
  return String(tenantId);
}

/**
 * Sync location lookups for the caller's trusted tenant.
 * @param {object} req authenticated Express request (or operator-script pseudo-request)
 */
async function syncLocationLookupsForRequest(req) {
  const tenantId = trustedTenantOf(req);
  if (!tenantId) {
    const err = new Error("Trusted tenant context required for location lookup sync");
    err.statusCode = 400;
    throw err;
  }
  const rows = await fetchLocationLookupRows(req, tenantId);
  return upsertLocationLookups(tenantId, rows);
}

module.exports = {
  syncLocationLookupsForRequest,
  fetchLocationLookupRows,
  trustedTenantOf,
  officerInitials,
  officerDisplayName,
};
