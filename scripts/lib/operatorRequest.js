/**
 * Operator-script identity for calls to user-service over HTTP.
 *
 * Scripts never read user-service's MongoDB. Instead the operator supplies their own
 * platform JWT (a CRM user with lookup:read / lookupType:read / product:read) via the
 * OPERATOR_BEARER_TOKEN env var (env, not argv, so it stays out of shell history / ps).
 *
 * The token is verified locally against JWT_SECRET (HS256, the same check user-service
 * applies) and the tenant is taken from the verified token — never from argv/env alone.
 * If --tenant / TENANT_ID is also given it must match the token's tenant.
 *
 * Returns a pseudo-request `{ headers: { authorization }, tenantId, ctx: { tenantId } }`
 * that lib/userServiceClient.js and services/locationLookupSync.service.js accept.
 */
const jwt = require("jsonwebtoken");

function buildOperatorRequest({ requestedTenantId } = {}) {
  const token = String(process.env.OPERATOR_BEARER_TOKEN || "")
    .replace(/^Bearer\s+/i, "")
    .trim();
  if (!token) {
    throw new Error(
      "OPERATOR_BEARER_TOKEN is required (a CRM user JWT with lookup:read for the target tenant)",
    );
  }
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET is required to verify OPERATOR_BEARER_TOKEN");
  }

  let claims;
  try {
    claims = jwt.verify(token, secret, { algorithms: ["HS256"], clockTolerance: 30 });
  } catch (err) {
    throw new Error(
      err && err.name === "TokenExpiredError"
        ? "OPERATOR_BEARER_TOKEN has expired"
        : "OPERATOR_BEARER_TOKEN failed verification",
    );
  }

  const tenantId = claims?.tenantId ? String(claims.tenantId) : null;
  if (!tenantId) {
    throw new Error("OPERATOR_BEARER_TOKEN has no tenantId claim");
  }
  if (requestedTenantId && String(requestedTenantId) !== tenantId) {
    throw new Error(
      "Requested tenant does not match the OPERATOR_BEARER_TOKEN tenant — refusing to write another tenant's rows",
    );
  }

  return {
    headers: { authorization: `Bearer ${token}` },
    tenantId,
    ctx: { tenantId },
  };
}

module.exports = { buildOperatorRequest };
