/**
 * Centralized RBAC Policy Middleware
 * Uses shared policy middleware package
 */

const {
  createDefaultPolicyMiddleware,
} = require("@membership/policy-middleware");

const policyServiceUrl =
  process.env.POLICY_SERVICE_URL || "http://user-service:5001";
const policyTimeout = Number(process.env.POLICY_TIMEOUT || 5000);
const policyRetries = Number(process.env.POLICY_RETRIES || 2);
const policyCacheTimeout = Number(
  process.env.POLICY_CACHE_TIMEOUT || process.env.POLICY_CACHE_TTL || 300000
);
const policyRetryDelay = Number(process.env.POLICY_RETRY_DELAY || 1000);

// Warn if using default localhost URL in non-development environments
if (!process.env.POLICY_SERVICE_URL && process.env.NODE_ENV !== "development") {
  console.warn(
    "⚠️  WARNING: POLICY_SERVICE_URL not set. Using Docker service default.",
    "Set POLICY_SERVICE_URL in .env.staging for explicit staging configuration."
  );
} else {
  console.log(`✅ Policy service URL configured: ${policyServiceUrl}`);
}

// Create default policy middleware instance
const defaultPolicyMiddleware = createDefaultPolicyMiddleware(
  policyServiceUrl,
  {
    timeout: policyTimeout,
    retries: policyRetries,
    cacheTimeout: policyCacheTimeout,
    retryDelay: policyRetryDelay,
  }
);

module.exports = defaultPolicyMiddleware;
module.exports.defaultPolicyMiddleware = defaultPolicyMiddleware;
