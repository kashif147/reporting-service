const dotenv = require("dotenv");
const fs = require("fs");

const envName = process.env.NODE_ENV || "staging";
for (const file of [`.env.${envName}`, ".env.staging", ".env"]) {
  if (fs.existsSync(file)) {
    dotenv.config({ path: file, override: false });
  }
}

const { testConnection } = require("../db/postgres");
const { runMigrations } = require("../db/runMigrations");
const {
  connectMongo,
  disconnectMongo,
  resolveMongoUri,
  maskMongoUri,
} = require("../config/mongo");

const PORT = process.env.PORT || 4005;

async function start() {
  if (process.env.RUN_REPORTING_MIGRATIONS === "true") {
    await runMigrations();
  }

  testConnection();

  const mongoUri = resolveMongoUri();
  console.log(`MongoDB URI: ${maskMongoUri(mongoUri)}`);

  if (mongoUri) {
    try {
      await connectMongo();
    } catch (error) {
      if (process.env.REQUIRE_REPORTING_MONGO === "true") {
        throw error;
      }
      console.warn(
        "⚠️ Reporting-service MongoDB unavailable — grid template Save View disabled; reporting APIs will continue",
      );
    }
  } else {
    console.warn(
      "⚠️ MONGO_URI not set — grid template Save View disabled for reporting-service",
    );
  }

  const app = require("../app");

  let shutdownEventSystem = async () => {};

  if (process.env.RABBIT_URL) {
    try {
      const rabbit = require("../rabbitMQ");
      await rabbit.initEventSystem();
      await rabbit.setupConsumers();
      shutdownEventSystem = rabbit.shutdownEventSystem;
      console.log("✅ Reporting-service RabbitMQ consumers ready");
    } catch (error) {
      console.error("❌ RabbitMQ init failed:", error.message);
      console.warn("⚠️ Continuing without RabbitMQ (read-only / degraded)");
    }
  } else {
    console.warn("⚠️ RABBIT_URL not set — event ingestion disabled");
  }

  if (process.env.ENABLE_REPORTING_CRON !== "false") {
    const { startScheduledSnapshots } = require("../jobs/scheduledSnapshots");
    startScheduledSnapshots();
  }

  const shutdown = async () => {
    await shutdownEventSystem();
    await disconnectMongo();
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  app.listen(PORT, () => {
    console.log(`Reporting service running on port ${PORT}`);
  });
}

start().catch((err) => {
  console.error("Reporting service failed to start:", err.message);
  process.exit(1);
});
