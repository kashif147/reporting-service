/**
 * Sync work-location lookup hierarchy + officers from user-service MongoDB.
 */
const mongoose = require("mongoose");
const { LookupType, Lookup } = require("../scripts/lib/mongoLookupModels");
const { upsertLocationLookups } = require("../repositories/locationLookup.repository");

const userSchema = new mongoose.Schema(
  {
    userFirstName: String,
    userLastName: String,
    userFullName: String,
  },
  { collection: "users" },
);

const User =
  mongoose.models.SyncUser || mongoose.model("SyncUser", userSchema);

const TYPE_SPECS = {
  region: { codes: ["REGION"], names: ["Region"] },
  branch: { codes: ["BRANCH"], names: ["Branch"] },
  workLocation: { codes: ["WORKLOC"], names: ["Work Location", "workLocation"] },
};

function label(doc) {
  return (doc.DisplayName || doc.lookupname || doc.name || "").trim();
}

function officerInitials(user) {
  if (!user) return null;
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
  if (!user) return null;
  const full = String(user.userFullName || "").trim();
  if (full) return full;
  const first = String(user.userFirstName || "").trim();
  const last = String(user.userLastName || "").trim();
  return `${first} ${last}`.trim() || null;
}

async function connectMongo() {
  const mongoUri =
    process.env.MONGO_URI ||
    process.env.USER_SERVICE_MONGO_URI ||
    process.env.MONGODB_URI;
  if (!mongoUri) {
    throw new Error(
      "MONGO_URI (or USER_SERVICE_MONGO_URI) is required to sync location lookups",
    );
  }
  if (mongoose.connection.readyState === 1) return;
  await mongoose.connect(mongoUri, {
    serverSelectionTimeoutMS: 30000,
    connectTimeoutMS: 30000,
  });
}

async function disconnectMongo() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
}

async function resolveLookupType(spec) {
  const or = [];
  if (spec.codes?.length) or.push({ code: { $in: spec.codes } });
  if (spec.names?.length) {
    or.push({ lookuptype: { $in: spec.names } });
    or.push({ displayname: { $in: spec.names } });
  }
  if (!or.length) return null;
  return LookupType.findOne({
    $or: or,
    isdeleted: { $ne: true },
  }).lean();
}

async function loadLookupsForType(typeDoc) {
  if (!typeDoc?._id) return [];
  return Lookup.find({
    lookuptypeId: typeDoc._id,
    isactive: { $ne: false },
    isdeleted: { $ne: true },
  })
    .select(
      "lookupname DisplayName Parentlookupid lookuptypeId code officer",
    )
    .lean();
}

async function loadUsersByIds(ids) {
  const unique = [...new Set(ids.filter(Boolean).map(String))];
  if (!unique.length) return new Map();
  const objectIds = unique
    .filter((id) => mongoose.Types.ObjectId.isValid(id))
    .map((id) => new mongoose.Types.ObjectId(id));
  if (!objectIds.length) return new Map();
  const users = await User.find({ _id: { $in: objectIds } })
    .select("userFirstName userLastName userFullName")
    .lean();
  return new Map(users.map((u) => [String(u._id), u]));
}

function buildHierarchyMaps(regions, branches, workLocations) {
  const byId = new Map();
  for (const list of [regions, branches, workLocations]) {
    for (const row of list) {
      byId.set(String(row._id), row);
    }
  }
  const regionById = new Map(regions.map((r) => [String(r._id), label(r)]));
  const branchById = new Map(branches.map((b) => [String(b._id), label(b)]));
  return { byId, regionById, branchById };
}

function resolveParentChain(nodeId, byId, regionById, branchById) {
  let branchName = null;
  let regionName = null;
  let branchNode = null;
  let regionNode = null;
  let parentId = nodeId ? String(nodeId) : null;

  while (parentId) {
    const parent = byId.get(parentId);
    if (!parent) break;
    const parentLabel = label(parent);
    if (branchById.has(parentId)) {
      branchName = parentLabel;
      branchNode = parent;
    }
    if (regionById.has(parentId)) {
      regionName = parentLabel;
      regionNode = parent;
    }
    parentId = parent.Parentlookupid
      ? String(parent.Parentlookupid)
      : null;
  }

  return { branchName, regionName, branchNode, regionNode };
}

async function fetchLocationLookupRowsFromMongo() {
  const [regionType, branchType, workLocType] = await Promise.all([
    resolveLookupType(TYPE_SPECS.region),
    resolveLookupType(TYPE_SPECS.branch),
    resolveLookupType(TYPE_SPECS.workLocation),
  ]);

  const [regions, branches, workLocations] = await Promise.all([
    loadLookupsForType(regionType),
    loadLookupsForType(branchType),
    loadLookupsForType(workLocType),
  ]);

  const { byId, regionById, branchById } = buildHierarchyMaps(
    regions,
    branches,
    workLocations,
  );

  const officerIds = [];
  for (const wl of workLocations) {
    if (wl.officer) officerIds.push(String(wl.officer));
  }
  for (const b of branches) {
    if (b.officer) officerIds.push(String(b.officer));
  }
  for (const r of regions) {
    if (r.officer) officerIds.push(String(r.officer));
  }

  const usersById = await loadUsersByIds(officerIds);
  const rows = [];

  for (const wl of workLocations) {
    const wlName = label(wl);
    if (!wlName) continue;

    const { branchName, regionName, branchNode, regionNode } =
      resolveParentChain(wl.Parentlookupid, byId, regionById, branchById);

    const officerUser = wl.officer ? usersById.get(String(wl.officer)) : null;
    const branchOfficer = branchNode?.officer
      ? String(branchNode.officer)
      : null;
    const regionOfficer = regionNode?.officer
      ? String(regionNode.officer)
      : null;

    rows.push({
      work_location: wlName,
      branch: branchName,
      region: regionName,
      lookup_id: String(wl._id),
      officer_user_id: wl.officer ? String(wl.officer) : null,
      officer_initials: officerInitials(officerUser),
      officer_display_name: officerDisplayName(officerUser),
      branch_officer_user_id: branchOfficer,
      region_officer_user_id: regionOfficer,
    });
  }

  return rows;
}

async function syncLocationLookupsForTenant(tenantId) {
  await connectMongo();
  try {
    const rows = await fetchLocationLookupRowsFromMongo();
    return upsertLocationLookups(tenantId, rows);
  } finally {
    await disconnectMongo();
  }
}

module.exports = {
  syncLocationLookupsForTenant,
  fetchLocationLookupRowsFromMongo,
  connectMongo,
  disconnectMongo,
  officerInitials,
  officerDisplayName,
};
