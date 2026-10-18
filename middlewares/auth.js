const { validateGatewayRequest } = require("@membership/policy-middleware/security");
const { tenantContextMiddleware } = require("@membership/policy-middleware");

/**
 * Phase 1A canonical tenant-context guard — WARN MODE ONLY (non-blocking).
 *
 * Mounted AFTER `authenticate` (before `requireTenant`) on the reporting routers.
 * It observes the tenant already established on req.ctx/req.user/req.tenantId,
 * re-pins req.tenantId to that trusted tenant, and LOGS any caller-supplied
 * (body/query/params) tenantId that disagrees as a non-blocking
 * TenantContextMismatch event — it never returns 403.
 *
 * Phase 2B (audit R3): `authenticate`'s legacy Bearer fallback now VERIFIES the
 * token (HS256 against JWT_SECRET, fail closed) instead of the former unverified
 * decode-only fallback, so req.tenantId on that path is cryptographically trusted.
 */
const tenantContextWarn = tenantContextMiddleware();

const jwt = require("jsonwebtoken");

/**
 * Verify a platform (ProjectShell) JWT: HS256 only, expiry enforced, 30s clock
 * tolerance, FAIL CLOSED when JWT_SECRET is absent. Returns { valid, payload }
 * or { valid:false, reason } with a non-sensitive reason category only.
 */
const verifyProjectShellToken = (token) => {
  const secret = process.env.JWT_SECRET;
  if (!secret) return { valid: false, reason: "JWT_SECRET_MISSING" };
  try {
    const payload = jwt.verify(token, secret, {
      algorithms: ["HS256"],
      clockTolerance: 30,
    });
    if (!payload || typeof payload !== "object") {
      return { valid: false, reason: "MALFORMED_TOKEN" };
    }
    return { valid: true, payload };
  } catch (err) {
    if (err && err.name === "TokenExpiredError") {
      return { valid: false, reason: "TOKEN_EXPIRED" };
    }
    if (err && err.name === "NotBeforeError") {
      return { valid: false, reason: "TOKEN_NOT_ACTIVE" };
    }
    return { valid: false, reason: "INVALID_TOKEN" };
  }
};

/**
 * AUTHENTICATION MIDDLEWARE ONLY
 * 
 * This middleware handles authentication (verifying user identity).
 * It does NOT handle authorization (permission checks).
 * 
 * For authorization, use policy-middleware:
 * const { defaultPolicyMiddleware } = require("../middlewares/policy.middleware");
 * router.get("/resource", defaultPolicyMiddleware.requirePermission("resource", "action"), handler);
 * 
 * All authorization decisions are made by user-service /policy/evaluate endpoint.
 */

const authenticate = async (req, res, next) => {
  try {
    // 1) Check for gateway-verified JWT (trust gateway headers with validation)
    const jwtVerified = req.headers["x-jwt-verified"];
    const authSource = req.headers["x-auth-source"];

    if (jwtVerified === "true" && authSource === "gateway") {
      // Validate gateway request (signature, IP, format)
      const validation = validateGatewayRequest(req);
      if (!validation.valid) {
        console.warn("Gateway header validation failed:", validation.reason);
        return res.status(401).json({
          error: {
            message: "Invalid gateway request",
            code: "GATEWAY_VALIDATION_FAILED",
            status: 401,
            reason: validation.reason,
          },
        });
      }

      // Gateway has verified JWT and forwarded claims as headers
      const userId = req.headers["x-user-id"];
      const tenantId = req.headers["x-tenant-id"];
      const userEmail = req.headers["x-user-email"];
      const userType = req.headers["x-user-type"];
      const userRolesStr = req.headers["x-user-roles"] || "[]";
      const userPermissionsStr = req.headers["x-user-permissions"] || "[]";

      if (!userId || !tenantId) {
        return res.status(401).json({
          error: {
            message: "Missing required authentication headers",
            code: "MISSING_HEADERS",
            status: 401,
          },
        });
      }

      let roles = [];
      let permissions = [];

      try {
        const rolesArray = JSON.parse(userRolesStr);
        roles = Array.isArray(rolesArray)
          ? rolesArray
              .map((role) => (typeof role === "string" ? role : role?.code))
              .filter(Boolean)
          : [];
      } catch (e) {
        console.warn("Failed to parse x-user-roles header:", e.message);
      }

      try {
        permissions = JSON.parse(userPermissionsStr);
        if (!Array.isArray(permissions)) permissions = [];
      } catch (e) {
        console.warn("Failed to parse x-user-permissions header:", e.message);
      }

      // Set request context with tenant isolation (consistent with other services)
      req.ctx = {
        tenantId,
        userId,
        roles,
        permissions,
      };

      // Attach user info to request for backward compatibility
      req.user = {
        sub: userId,
        id: userId,
        tenantId,
        email: userEmail,
        userType,
        roles,
        permissions,
      };

      req.userId = userId;
      req.tenantId = tenantId;
      req.roles = roles;
      req.permissions = permissions;

      return next();
    }

    // 2) Legacy Bearer JWT flow (fallback for direct service calls)
    const authHeader = req.headers.authorization || req.headers.Authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        error: {
          message: "Authorization header required",
          code: "UNAUTHORIZED",
          status: 401,
        },
      });
    }

    const token = authHeader.substring(7);

    // Legacy Bearer fallback: verify signature + expiry (HS256, JWT_SECRET).
    // Microsoft RS256 tokens are verified at the gateway and arrive via the
    // gateway-header path above, never as a direct Bearer here.
    try {
      const verification = verifyProjectShellToken(token);
      if (!verification.valid) {
        console.warn(
          `[AUTH] Bearer token verification failed: ${verification.reason}`
        );
        return res.status(401).json({
          error: {
            message: "Invalid token",
            code: "INVALID_TOKEN",
            status: 401,
          },
        });
      }
      const decoded = verification.payload;

      const tenantId =
        decoded.tenantId || decoded.tid || decoded.extension_tenantId;

      if (!tenantId) {
        return res.status(401).json({
          error: {
            message: "Invalid token: missing tenantId",
            code: "MISSING_TENANT_ID",
            status: 401,
          },
        });
      }

      const normalizedRoles = Array.isArray(decoded.roles)
        ? decoded.roles
            .map((role) => (typeof role === "string" ? role : role?.code))
            .filter(Boolean)
        : [];

      // Set request context with tenant isolation
      req.ctx = {
        tenantId,
        userId: decoded.sub || decoded.id,
        roles: normalizedRoles,
        permissions: decoded.permissions || [],
      };

      req.user = decoded;
      req.userId = decoded.sub || decoded.id;
      req.tenantId = tenantId;
      req.roles = normalizedRoles;
      req.permissions = decoded.permissions || [];

      return next();
    } catch (error) {
      return res.status(401).json({
        error: {
          message: "Invalid token",
          code: "INVALID_TOKEN",
          status: 401,
        },
      });
    }
  } catch (error) {
    console.error("Authentication error:", error.message);
    return res.status(401).json({
      error: {
        message: "Authentication failed",
        code: "AUTH_ERROR",
        status: 401,
      },
    });
  }
};

/**
 * Tenant Enforcement Middleware
 * Ensures tenantId is present in req.ctx
 */
const requireTenant = (req, res, next) => {
  if (!req.ctx || !req.ctx.tenantId) {
    return res.status(400).json({
      error: {
        message: "Tenant context required",
        code: "MISSING_TENANT",
        status: 400,
      },
    });
  }
  next();
};

module.exports = {
  authenticate,
  ensureAuthenticated: authenticate, // Alias for backward compatibility
  requireTenant,
  tenantContextWarn, // Phase 1A WARN guard; pair as router.use(authenticate, tenantContextWarn)
  verifyProjectShellToken,
};

