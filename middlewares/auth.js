const { validateGatewayRequest } = require("@membership/policy-middleware/security");

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

    // For legacy support, decode token (without verification - gateway already did that)
    // In production, gateway should always verify, so this is fallback only
    try {
      const jwt = require("jsonwebtoken");
      const decoded = jwt.decode(token); // Decode without verification for fallback

      if (!decoded) {
        return res.status(401).json({
          error: {
            message: "Invalid token format",
            code: "INVALID_TOKEN",
            status: 401,
          },
        });
      }

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
};

