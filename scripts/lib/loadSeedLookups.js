/**
 * Load membership dashboard seed dimensions from user-service MongoDB lookups/products.
 */
const path = require("path");
const fs = require("fs");
const mongoose = require("mongoose");
const { LookupType, Lookup, Product } = require("./mongoLookupModels");

const DEFAULT_MEMBERSHIP_PRODUCT_TYPE_ID = "68dae613c5b15073d66b891f";

const TYPE_SPECS = {
  region: { codes: ["REGION"], names: ["Region"] },
  branch: { codes: ["BRANCH"], names: ["Branch"] },
  workLocation: { codes: ["WORKLOC"], names: ["Work Location", "workLocation"] },
  grade: { codes: ["GRADE", "GRD"], names: ["Grade"] },
  section: { codes: ["PRI_SEC"], names: ["Section", "Primary Section"] },
  paymentType: {
    codes: ["PAYMENT", "PAY_TYPE", "PAYTYP"],
    names: ["Payment Type", "Payment type"],
  },
};

function label(doc) {
  return (doc.DisplayName || doc.lookupname || doc.name || "").trim();
}

function weightedItems(names, defaultWeight = 1) {
  const unique = [...new Set(names.filter(Boolean))];
  return unique.map((name) => ({ name, weight: defaultWeight }));
}

function weightedPick(items) {
  if (!items?.length) return null;
  const total = items.reduce((s, i) => s + (i.weight || 1), 0);
  let r = Math.random() * total;
  for (const item of items) {
    r -= item.weight || 1;
    if (r <= 0) return item;
  }
  return items[items.length - 1];
}

async function connectMongo() {
  const mongoUri =
    process.env.MONGO_URI ||
    process.env.USER_SERVICE_MONGO_URI ||
    process.env.MONGODB_URI;
  if (!mongoUri) {
    throw new Error(
      "MONGO_URI (or USER_SERVICE_MONGO_URI) is required to load lookup data"
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
    .select("lookupname DisplayName Parentlookupid lookuptypeId code")
    .lean();
}

async function loadMembershipCategories(tenantId) {
  const productTypeId =
    process.env.MEMBERSHIP_CATEGORY_PRODUCT_TYPE_ID ||
    DEFAULT_MEMBERSHIP_PRODUCT_TYPE_ID;

  const query = {
    productTypeId: new mongoose.Types.ObjectId(productTypeId),
    isDeleted: { $ne: true },
    isActive: { $ne: false },
    status: { $ne: "Inactive" },
  };
  if (tenantId) query.tenantId = tenantId;

  let products = await Product.find(query).select("name code").lean();
  if (!products.length && tenantId) {
    const { tenantId: _t, ...withoutTenant } = query;
    products = await Product.find(withoutTenant).select("name code").lean();
  }
  return products.map((p) => p.name).filter(Boolean);
}

function buildLocationHierarchy(workLocations, branches, regions) {
  const byId = new Map();
  for (const list of [regions, branches, workLocations]) {
    for (const row of list) {
      byId.set(String(row._id), row);
    }
  }

  const regionById = new Map(regions.map((r) => [String(r._id), label(r)]));
  const branchById = new Map(branches.map((b) => [String(b._id), label(b)]));

  const combos = [];
  const seen = new Set();

  for (const wl of workLocations) {
    const wlName = label(wl);
    if (!wlName) continue;

    let branchName = null;
    let regionName = null;
    let parentId = wl.Parentlookupid ? String(wl.Parentlookupid) : null;

    while (parentId) {
      const parent = byId.get(parentId);
      if (!parent) break;
      const parentLabel = label(parent);
      if (branchById.has(parentId)) branchName = parentLabel;
      if (regionById.has(parentId)) regionName = parentLabel;
      parentId = parent.Parentlookupid
        ? String(parent.Parentlookupid)
        : null;
    }

    const key = `${regionName || ""}|${branchName || ""}|${wlName}`;
    if (seen.has(key)) continue;
    seen.add(key);

    combos.push({
      region: regionName || [...regionById.values()][0] || "Unknown",
      branch: branchName || [...branchById.values()][0] || regionName || "Unknown",
      work_location: wlName,
      weight: 1,
    });
  }

  if (!combos.length && regions.length) {
    for (const region of regions) {
      const regionName = label(region);
      const regionBranches = branches.filter(
        (b) => String(b.Parentlookupid) === String(region._id)
      );
      if (regionBranches.length) {
        for (const branch of regionBranches) {
          combos.push({
            region: regionName,
            branch: label(branch),
            work_location:
              workLocations.find(
                (w) => String(w.Parentlookupid) === String(branch._id)
              )?.lookupname || label(workLocations[0]) || regionName,
            weight: 1,
          });
        }
      } else {
        combos.push({
          region: regionName,
          branch: label(branches[0]) || regionName,
          work_location: label(workLocations[0]) || regionName,
          weight: 1,
        });
      }
    }
  }

  return combos;
}

function loadFixtureLookups() {
  const fixturePath =
    process.env.SEED_LOOKUPS_FIXTURE ||
    path.join(__dirname, "..", "fixtures", "seed-lookups.json");
  if (!fs.existsSync(fixturePath)) return null;
  const raw = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
  return normalizeLookupBundle(raw);
}

function normalizeLookupBundle(raw) {
  const categories = weightedItems(raw.categories || raw.membershipCategories || []);
  const grades = weightedItems(raw.grades || []);
  const sections = weightedItems(raw.sections || []);
  const paymentTypes = weightedItems(raw.paymentTypes || []);
  const locations = (raw.locations || raw.locationHierarchy || []).map((row) => ({
    region: row.region,
    branch: row.branch,
    work_location: row.work_location || row.workLocation,
    weight: row.weight || 1,
  }));

  if (!categories.length || !locations.length) {
    throw new Error("Fixture must include categories and locations");
  }

  return {
    categories,
    grades: grades.length ? grades : weightedItems(["(unknown grade)"]),
    sections: sections.length ? sections : weightedItems(["(unknown section)"]),
    paymentTypes: paymentTypes.length
      ? paymentTypes
      : weightedItems(["Salary Deduction"]),
    locations,
    source: "fixture",
  };
}

/**
 * @param {string} [tenantId]
 * @returns {Promise<object>}
 */
async function loadSeedLookups(tenantId) {
  const fixture = loadFixtureLookups();
  if (fixture && process.env.SEED_LOOKUPS_FIXTURE_ONLY === "true") {
    return fixture;
  }

  try {
    await connectMongo();

    const typeEntries = await Promise.all(
      Object.entries(TYPE_SPECS).map(async ([key, spec]) => [
        key,
        await resolveLookupType(spec),
      ])
    );
    const types = Object.fromEntries(typeEntries);

    const [regions, branches, workLocations] = await Promise.all([
      loadLookupsForType(types.region),
      loadLookupsForType(types.branch),
      loadLookupsForType(types.workLocation),
    ]);

    const [grades, sections, paymentLookups] = await Promise.all([
      loadLookupsForType(types.grade),
      loadLookupsForType(types.section),
      loadLookupsForType(types.paymentType),
    ]);

    const categoryNames = await loadMembershipCategories(tenantId);
    const locations = buildLocationHierarchy(workLocations, branches, regions);

    await disconnectMongo();

    if (!categoryNames.length) {
      throw new Error(
        "No membership category products found for tenant/product type"
      );
    }
    if (!locations.length) {
      throw new Error("No region/branch/work location hierarchy found in lookups");
    }

    const gradeNames = grades.map(label);
    const sectionNames = sections.map(label);
    const paymentNames = paymentLookups.map(label);

    const bundle = {
      categories: weightedItems(categoryNames),
      grades: gradeNames.length
        ? weightedItems(gradeNames)
        : weightedItems(["(no grade in lookups)"]),
      sections: sectionNames.length
        ? weightedItems(sectionNames)
        : weightedItems(["(no section in lookups)"]),
      paymentTypes: paymentNames.length
        ? weightedItems(paymentNames)
        : weightedItems(["Salary Deduction"]),
      locations,
      source: "mongodb",
    };

    console.log(
      `  lookups: ${bundle.categories.length} categories, ${bundle.locations.length} location combos, ${bundle.grades.length} grades, ${bundle.sections.length} sections`
    );
    return bundle;
  } catch (err) {
    await disconnectMongo().catch(() => {});
    if (fixture) {
      console.warn(`  Mongo lookup load failed (${err.message}); using fixture`);
      return fixture;
    }
    throw err;
  }
}

function pickLocation(locations) {
  const item = weightedPick(locations);
  return item || locations[0];
}

module.exports = {
  loadSeedLookups,
  weightedPick,
  pickLocation,
  disconnectMongo,
};
