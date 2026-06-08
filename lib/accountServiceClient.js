const axios = require("axios");

const ACCOUNT_SERVICE_URL =
  process.env.ACCOUNT_SERVICE_URL ||
  "http://projectshell-vm.northeurope.cloudapp.azure.com/account-service";

function buildHeaders(req, tenantId) {
  const headers = {
    "Content-Type": "application/json",
    "x-tenant-id": tenantId || req?.headers?.["x-tenant-id"] || "",
    "x-internal-request": "true",
  };

  if (req?.headers?.authorization) {
    headers.authorization = req.headers.authorization;
  }
  if (req?.headers?.["x-jwt-verified"]) {
    headers["x-jwt-verified"] = req.headers["x-jwt-verified"];
  }
  if (req?.headers?.["x-auth-source"]) {
    headers["x-auth-source"] = req.headers["x-auth-source"];
  }
  if (req?.headers?.["x-user-id"]) {
    headers["x-user-id"] = req.headers["x-user-id"];
  }
  if (req?.headers?.["x-user-email"]) {
    headers["x-user-email"] = req.headers["x-user-email"];
  }
  if (req?.headers?.["x-user-roles"]) {
    headers["x-user-roles"] = req.headers["x-user-roles"];
  }
  if (req?.headers?.["x-user-permissions"]) {
    headers["x-user-permissions"] = req.headers["x-user-permissions"];
  }

  return headers;
}

async function fetchCreditorsAsOf(tenantId, body, req) {
  const base = ACCOUNT_SERVICE_URL.replace(/\/$/, "");
  const url = `${base}/api/reports/creditors-list`;
  const response = await axios.post(url, body || {}, {
    headers: buildHeaders(req, tenantId),
    timeout: 120000,
    validateStatus: (status) => status < 500,
  });

  if (response.status >= 400) {
    const message =
      response.data?.message ||
      response.data?.error?.message ||
      `Account service returned ${response.status}`;
    const err = new Error(message);
    err.statusCode = response.status;
    throw err;
  }

  return response.data?.data || response.data;
}

module.exports = {
  fetchCreditorsAsOf,
  buildHeaders,
};
