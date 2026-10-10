/**
 * Load membership dashboard seed dimensions from user-service lookups/products over
 * HTTP (operator JWT via OPERATOR_BEARER_TOKEN — see ./operatorRequest.js). No direct
 * access to user-service's MongoDB.
 */
const path = require("path");
const fs = require("fs");
const userServiceClient = require("../../lib/userServiceClient");
const { buildOperatorRequest } = require("./operatorRequest");

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

/** Kept for script compatibility; there is no Mongo connection any more. */
async function disconnectMongo() {}

function resolveLookupType(lookupTypes, spec) {
  const live = (lookupTypes || []).filter((t) => t && t.isdeleted !== true);
  return (
    live.find((t) => spec.codes?.includes(t.code)) ||
    live.find(
      (t) =>
        spec.names?.includes(t.lookuptype) ||
        spec.names?.includes(t.displayname),
    ) ||
    null
  );
}

async function loadLookupsForType(typeDoc, req) {
  if (!typeDoc?._id) return [];
  const results = await userServiceClient.getLookupsByTypeWithHierarchy(
    typeDoc._id,
    req,
    req.tenantId,
  );
  return results
    .map((r) => (r?.lookup && typeof r.lookup === "object" ? r.lookup : r))
    .filter((l) => l && l._id != null)
    .map((l) => ({
      _id: String(l._id),
      lookupname: l.lookupname,
      DisplayName: l.DisplayName,
      code: l.code,
      Parentlookupid:
        l.Parentlookupid && typeof l.Parentlookupid === "object"
          ? l.Parentlookupid._id
          : l.Parentlookupid || null,
    }));
}

async function loadMembershipCategories(req) {
  const productTypeId =
    process.env.MEMBERSHIP_CATEGORY_PRODUCT_TYPE_ID ||
    DEFAULT_MEMBERSHIP_PRODUCT_TYPE_ID;
  // user-service scopes /api/products to the token's tenant; no cross-tenant fallback.
  const products = await userServiceClient.listProducts(req, req.tenantId, {
    productTypeId,
  });
  return products
    .filter(
      (p) =>
        p &&
        p.isDeleted !== true &&
        p.isActive !== false &&
        p.status !== "Inactive",
    )
    .map((p) => p.name)
    .filter(Boolean);
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
    const req = buildOperatorRequest({ requestedTenantId: tenantId });
    const lookupTypes = await userServiceClient.listLookupTypes(req, req.tenantId);
    const types = Object.fromEntries(
      Object.entries(TYPE_SPECS).map(([key, spec]) => [
        key,
        resolveLookupType(lookupTypes, spec),
      ])
    );

    const [regions, branches, workLocations, grades, sections, paymentLookups] =
      await Promise.all([
        loadLookupsForType(types.region, req),
        loadLookupsForType(types.branch, req),
        loadLookupsForType(types.workLocation, req),
        loadLookupsForType(types.grade, req),
        loadLookupsForType(types.section, req),
        loadLookupsForType(types.paymentType, req),
      ]);

    const categoryNames = await loadMembershipCategories(req);
    const locations = buildLocationHierarchy(workLocations, branches, regions);

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
      source: "user-service-api",
    };

    console.log(
      `  lookups: ${bundle.categories.length} categories, ${bundle.locations.length} location combos, ${bundle.grades.length} grades, ${bundle.sections.length} sections`
    );
    return bundle;
  } catch (err) {
    if (fixture) {
      console.warn(`  user-service lookup load failed (${err.message}); using fixture`);
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
