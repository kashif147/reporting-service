// Owner decision (2026-11-01): the reporting repair preserves the CURRENTLY EFFECTIVE behaviour. MULTIAUTH's
// stored defaults have an ObjectId tenantId and are unreachable, so today the CRM applies its built-in page
// (SaveViewMenu "System default (local)": visible columns, titles and page.filters of grid-column-defaults.json).
// The new string-owned rows must hand the CRM exactly those inputs - and must NOT reactivate the historical
// six-category exclusion stored on the unreachable ObjectId row.
// Fixture: the CRM built-in pages at 7983fed. Run: node --test tests/tenantGridDefaults.parity.test.js
const test = require("node:test");
const assert = require("node:assert");
const g = require("../services/tenantGridDefaults");
const crm = require("./fixtures/crmLocalDefaults.7983fed.json");

const TYPES = ["workplacebreakdownreport", "debtorslistreport"];
const TENANT = "68cbf7806080b4621d469d34";
const keyOf = (col) => (Array.isArray(col.dataIndex) ? col.dataIndex.join(".") : String(col.dataIndex));
// the CRM's local-default derivation (gridColumnDefaults.js buildVisibleColumnKeys / buildColumnLabelsMap)
const crmLocal = (page) => ({
  columns: page.columns.filter((c) => c.isGride === true && c.dataIndex).map(keyOf),
  columnLabels: Object.fromEntries(page.columns.filter((c) => c.dataIndex).map((c) => [keyOf(c), String(c.title || keyOf(c))])),
  filters: page.filters || {},
});

test("manifest covers exactly the two repaired types; other reporting grids stay code-defined", () => {
  assert.deepStrictEqual(Object.keys(g.loadCanonical().templates).sort(), [...TYPES].sort());
});

for (const type of TYPES) {
  test(`${type}: the reachable row hands the CRM exactly what it applies today (columns, order, labels, filters)`, () => {
    const doc = g.buildTenantDefault(g.loadCanonical(), TENANT, type, new Date(0), undefined);
    const today = crmLocal(crm.pages[type]);
    assert.deepStrictEqual(doc.columns, today.columns);
    assert.deepStrictEqual(doc.columnLabels, today.columnLabels);
    assert.deepStrictEqual(doc.filters, today.filters);
    assert.deepStrictEqual(doc.visibleFilters, []);
    assert.strictEqual(doc.isDefault, false);
    assert.strictEqual(doc.pinned, false);
    assert.strictEqual(doc.tenantId, TENANT);
  });
}

test("workplacebreakdownreport: the historical six-category exclusion is NOT reactivated", () => {
  const filters = g.loadCanonical().templates.workplacebreakdownreport.filters;
  assert.strictEqual(filters.membershipCategories, undefined);
  assert.ok(!Object.values(filters).some((f) => f && f.operator === "not_equal_to"));
  assert.deepStrictEqual(filters.membershipStatuses, { operator: "equal_to", values: ["Active"] });
});
