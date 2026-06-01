const dotenv = require("dotenv");
dotenv.config({ path: ".env.staging" });

const app = require("../app");
const { testConnection } = require("../db/postgres");
const { runMigrations } = require("../db/runMigrations");
const {
  initEventSystem,
  setupConsumers,
  shutdownEventSystem,
} = require("../rabbitMQ");

const PORT = process.env.PORT || 4005;

async function start() {
  if (process.env.RUN_REPORTING_MIGRATIONS === "true") {
    await runMigrations();
  }

  testConnection();

  if (process.env.RABBIT_URL) {
    try {
      await initEventSystem();
      await setupConsumers();
      console.log("✅ Reporting-service RabbitMQ consumers ready");
    } catch (error) {
      console.error("❌ RabbitMQ init failed:", error.message);
      console.warn("⚠️ Continuing without RabbitMQ (read-only / degraded)");
    }

    const shutdown = async () => {
      await shutdownEventSystem();
      process.exit(0);
    };
    process.on("SIGTERM", shutdown);
    process.on("SIGINT", shutdown);
  } else {
    console.warn("⚠️ RABBIT_URL not set — event ingestion disabled");
  }

  if (process.env.ENABLE_REPORTING_CRON !== "false") {
    const { startScheduledSnapshots } = require("../jobs/scheduledSnapshots");
    startScheduledSnapshots();
  }

  app.listen(PORT, () => {
    console.log(`Reporting service running on port ${PORT}`);
  });
}

start().catch((err) => {
  console.error(err);
  process.exit(1);
});
