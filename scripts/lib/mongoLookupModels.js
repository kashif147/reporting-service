/**
 * Minimal Mongoose models for seed scripts (user-service DB).
 */
const mongoose = require("mongoose");

const lookupTypeSchema = new mongoose.Schema(
  {
    code: String,
    lookuptype: String,
    displayname: String,
    ParentlookuptypeId: { type: mongoose.Schema.Types.ObjectId, ref: "LookupType" },
    isactive: Boolean,
    isdeleted: Boolean,
  },
  { collection: "lookuptypes" }
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
  { collection: "lookups" }
);

const productSchema = new mongoose.Schema(
  {
    name: String,
    code: String,
    productTypeId: { type: mongoose.Schema.Types.ObjectId, ref: "ProductType" },
    status: String,
    isActive: Boolean,
    isDeleted: Boolean,
    tenantId: String,
  },
  { collection: "products" }
);

const LookupType =
  mongoose.models.SeedLookupType ||
  mongoose.model("SeedLookupType", lookupTypeSchema);
const Lookup =
  mongoose.models.SeedLookup ||
  mongoose.model("SeedLookup", lookupSchema);
const Product =
  mongoose.models.SeedProduct ||
  mongoose.model("SeedProduct", productSchema);

module.exports = { LookupType, Lookup, Product };
