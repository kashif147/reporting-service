/**
 * HTTP client for user-service lookup/product read APIs.
 *
 * reporting-service never connects to user-service's MongoDB (database-per-service,
 * see the no-cross-db-mongo / cross-service-auth skills). Every call forwards the
 * caller's identity so user-service applies its own authentication, policy
 * (`lookup:read`, `lookupType:read`, `product:read`) and tenant rules to the caller.
 *
 * `req` is the inbound Express request (runtime) or a script pseudo-request
 * `{ headers: { authorization: "Bearer <operator JWT>" }, tenantId }` (operator scripts).
 * `tenantId` MUST be the trusted tenant (req.tenantId as established by authenticate +
 * tenantContextWarn) — never a body/query value.
 *
 * Deliberately does NOT send `x-internal-request`: there is always an originating user
 * here, and the internal flag must only be used for genuine user-less S2S calls.
 */
const axios = require("axios");

const USER_SERVICE_URL =
  process.env.USER_SERVICE_URL ||
  process.env.POLICY_SERVICE_URL ||
  "http://user-service:5001";

const FORWARDED_HEADERS = [
  "x-jwt-verified",
  "x-auth-source",
  "x-user-id",
  "x-user-email",
  "x-user-type",
  "x-user-roles",
  "x-user-permissions",
  "x-correlation-id",
];

function baseUrl() {
  return String(USER_SERVICE_URL).replace(/\/$/, "");
}

function buildHeaders(req, tenantId) {
  if (!tenantId) {
    throw new Error("userServiceClient: trusted tenantId is required");
  }
  const headers = {
    "Content-Type": "application/json",
    // Always the trusted tenant, never the raw inbound header.
    "x-tenant-id": String(tenantId),
  };
  const auth = req?.headers?.authorization || req?.headers?.Authorization;
  if (auth) headers.authorization = auth;
  for (const key of FORWARDED_HEADERS) {
    if (req?.headers?.[key]) headers[key] = req.headers[key];
  }
  if (!headers.authorization && headers["x-jwt-verified"] !== "true") {
    throw new Error(
      "userServiceClient: caller identity (Authorization or gateway headers) is required",
    );
  }
  return headers;
}

function upstreamError(status, path) {
  const err = new Error(`user-service ${path} returned ${status}`);
  err.upstreamStatus = status;
  return err;
}

async function getJson(path, req, tenantId, { params, timeout = 15000 } = {}) {
  const response = await axios.get(`${baseUrl()}${path}`, {
    headers: buildHeaders(req, tenantId),
    params,
    timeout,
    validateStatus: () => true,
  });
  if (response.status < 200 || response.status >= 300) {
    throw upstreamError(response.status, path.split("?")[0]);
  }
  return response.data;
}

/** GET /api/lookuptype → array of lookup types (non-"simple" format). */
async function listLookupTypes(req, tenantId) {
  const data = await getJson("/api/lookuptype", req, tenantId);
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.data)) return data.data;
  return [];
}

/**
 * GET /api/lookup/by-type/:lookuptypeId/hierarchy?lean=true
 * → [{ lookup, hierarchy }] where lookup is user-service's formatLookup shape.
 */
async function getLookupsByTypeWithHierarchy(lookuptypeId, req, tenantId) {
  const id = encodeURIComponent(String(lookuptypeId));
  const data = await getJson(
    `/api/lookup/by-type/${id}/hierarchy`,
    req,
    tenantId,
    { params: { lean: "true" } },
  );
  return Array.isArray(data?.results) ? data.results : [];
}

/** GET /api/products?productTypeId= → products of the caller's tenant. */
async function listProducts(req, tenantId, { productTypeId } = {}) {
  const data = await getJson("/api/products", req, tenantId, {
    params: productTypeId ? { productTypeId } : undefined,
  });
  if (Array.isArray(data?.data)) return data.data;
  if (Array.isArray(data)) return data;
  return [];
}

module.exports = {
  buildHeaders,
  listLookupTypes,
  getLookupsByTypeWithHierarchy,
  listProducts,
};
