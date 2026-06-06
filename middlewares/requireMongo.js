const { AppError } = require("../errors/AppError");
const {
  ensureMongoConnected,
  isMongoConnected,
  resolveMongoUri,
  maskMongoUri,
} = require("../config/mongo");

async function requireMongo(req, res, next) {
  const uri = resolveMongoUri();
  if (!uri) {
    return next(
      AppError.serviceUnavailable(
        "Grid templates are not configured (MONGO_URI missing on reporting-service).",
      ),
    );
  }

  try {
    await ensureMongoConnected();
    if (!isMongoConnected()) {
      throw new Error("MongoDB connection is not ready after reconnect attempt");
    }
    return next();
  } catch (error) {
    console.error(
      `[requireMongo] connection failed for ${maskMongoUri(uri)}:`,
      error.message,
    );
    return next(
      AppError.serviceUnavailable(
        "Reporting-service cannot reach MongoDB. Verify MONGO_URI in the container and Atlas network access.",
      ),
    );
  }
}

module.exports = requireMongo;
