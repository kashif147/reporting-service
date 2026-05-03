const { createLogger } = require("@projectShell/logging-lib");

module.exports = createLogger(process.env.SERVICE_NAME || "reporting-service");
