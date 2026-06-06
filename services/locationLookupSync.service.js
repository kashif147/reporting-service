/**
 * Sync work-location lookup hierarchy + officers from user-service MongoDB
 * into reporting Postgres. Uses a dedicated mongoose connection so we never
 * disconnect reporting-service's own Mongo (grid templates / Save View).
 */
const mongoose = require("mongoose");
const { upsertLocationLookups } = require("../repositories/locationLookup.repository");

const TYPE_SPECS = {
  region: { codes: ["REGION"], names: ["Region"] },
  branch: { codes: ["BRANCH"], names: ["Branch"] },
  workLocation: { codes: ["WORKLOC"], names: ["Work Location", "workLocation"] },
};

const lookupTypeSchema = new mongoose.Schema(
  {
    code: String,
    lookuptype: String,
    displayname: String,
    ParentlookuptypeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "LookupType",
    },
    isactive: Boolean,
    isdeleted: Boolean,
  },
  { collection: "lookuptypes", bufferCommands: false },
);

const lookupSchema = new mongoose.Schema(
  {
    code: String,
    lookupname: String,
    DisplayName: String,
    Parentlookupid: { type: mongoose.Schema.Types.ObjectId, ref: "Lookup" },
    lookuptypeId: { type: mongoose.Schema.Types.ObjectId, ref: "LookupType" },
    officer: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    isactive: Boolean,
    isdeleted: Boolean,
  },
  { collection: "lookups", bufferCommands: false },
);

const userSchema = new mongoose.Schema(
  {
    userFirstName: String,
    userLastName: String,
    userFullName: String,
  },
  { collection: "users", bufferCommands: false },
);

let userServiceConnection = null;
let userServiceConnectPromise = null;

function resolveUserServiceMongoUri() {
  return (
    process.env.USER_SERVICE_MONGO_URI ||
    process.env.USER_SERVICE_MONGODB_URI ||
    ""
  ).trim();
}

function resolveScriptMongoUri() {
  const dedicated = resolveUserServiceMongoUri();
  if (dedicated) return dedicated;
  return (process.env.MONGO_URI || process.env.MONGODB_URI || "").trim();
}

function maskMongoUri(uri) {
  if (!uri) return "(not set)";
  return uri.replace(/\/\/([^:@/]+):([^@/]+)@/, "//$1:***@");
}

function getUserServiceConnection({ forScript = false } = {}) {
  const mongoUri = forScript ? resolveScriptMongoUri() : resolveUserServiceMongoUri();
  if (!mongoUri) {
    throw new Error(
      forScript
        ? "USER_SERVICE_MONGO_URI (or MONGO_URI for scripts) is required to sync location lookups"
        : "USER_SERVICE_MONGO_URI is required to sync location lookups",
    );
  }

  if (!userServiceConnection) {
    userServiceConnection = mongoose.createConnection(mongoUri, {
      serverSelectionTimeoutMS: 30000,
      connectTimeoutMS: 30000,
      socketTimeoutMS: 30000,
      maxPoolSize: 5,
      bufferCommands: false,
    });
  }

  return userServiceConnection;
}

function getModels(connection) {
  const LookupType =
    connection.models.SyncLookupType ||
    connection.model("SyncLookupType", lookupTypeSchema);
  const Lookup =
    connection.models.SyncLookup ||
    connection.model("SyncLookup", lookupSchema);
  const User =
    connection.models.SyncUser || connection.model("SyncUser", userSchema);
  return { LookupType, Lookup, User };
}

async function ensureUserServiceMongoConnected(options = {}) {
  const connection = getUserServiceConnection(options);
  if (connection.readyState === 1) return connection;

  if (!userServiceConnectPromise) {
    userServiceConnectPromise = connection
      .asPromise()
      .then(() => {
        console.log(
          `[locationLookupSync] user-service Mongo connected (${connection.name})`,
        );
        return connection;
      })
      .catch((error) => {
        userServiceConnectPromise = null;
        const uri = options.forScript
          ? resolveScriptMongoUri()
          : resolveUserServiceMongoUri();
        console.error(
          `[locationLookupSync] user-service Mongo connection failed (${maskMongoUri(uri)}):`,
          error.message,
        );
        throw error;
      });
  }

  return userServiceConnectPromise;
}

async function closeUserServiceMongoConnection() {
  userServiceConnectPromise = null;
  if (!userServiceConnection) return;
  if (userServiceConnection.readyState !== 0) {
    await userServiceConnection.close();
  }
  userServiceConnection = null;
}

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

async function resolveLookupType(LookupType, spec) {
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

async function loadLookupsForType(Lookup, typeDoc) {
  if (!typeDoc?._id) return [];
  return Lookup.find({
    lookuptypeId: typeDoc._id,
    isactive: { $ne: false },
    isdeleted: { $ne: true },
  })
    .select("lookupname DisplayName Parentlookupid lookuptypeId code officer")
    .lean();
}

async function loadUsersByIds(User, ids) {
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
    parentId = parent.Parentlookupid ? String(parent.Parentlookupid) : null;
  }

  return { branchName, regionName, branchNode, regionNode };
}

async function fetchLocationLookupRowsFromMongo(models) {
  const { LookupType, Lookup, User } = models;
  const [regionType, branchType, workLocType] = await Promise.all([
    resolveLookupType(LookupType, TYPE_SPECS.region),
    resolveLookupType(LookupType, TYPE_SPECS.branch),
    resolveLookupType(LookupType, TYPE_SPECS.workLocation),
  ]);

  const [regions, branches, workLocations] = await Promise.all([
    loadLookupsForType(Lookup, regionType),
    loadLookupsForType(Lookup, branchType),
    loadLookupsForType(Lookup, workLocType),
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

  const usersById = await loadUsersByIds(User, officerIds);
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

async function syncLocationLookupsForTenant(tenantId, options = {}) {
  const connection = await ensureUserServiceMongoConnected(options);
  const models = getModels(connection);
  const rows = await fetchLocationLookupRowsFromMongo(models);
  return upsertLocationLookups(tenantId, rows);
}

module.exports = {
  syncLocationLookupsForTenant,
  fetchLocationLookupRowsFromMongo,
  ensureUserServiceMongoConnected,
  closeUserServiceMongoConnection,
  officerInitials,
  officerDisplayName,
  // Legacy script helpers — no-op / isolated close only
  connectMongo: (options) => ensureUserServiceMongoConnected(options),
  disconnectMongo: closeUserServiceMongoConnection,
};
