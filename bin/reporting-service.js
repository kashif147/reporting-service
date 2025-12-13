const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
dotenv.config();

const { testConnection } = require("../db/postgres");

const app = express();

// app.use(cors());
app.use(express.json());

// Initialize RabbitMQ event system - Now using middleware
const {
  initEventSystem,
  setupConsumers,
  shutdownEventSystem,
} = require("../rabbitMQ");

if (process.env.RABBIT_URL) {
  console.log("🐰 RabbitMQ URL configured, initializing with middleware...");
  initEventSystem()
    .then(() => {
      console.log("✅ Initializing RabbitMQ consumers...");
      return setupConsumers();
    })
    .then(() => {
      console.log("✅ RabbitMQ fully initialized with middleware");
    })
    .catch((error) => {
      console.error("❌ Failed to initialize RabbitMQ:", error.message);
      console.error("⚠️ App will continue without RabbitMQ (degraded mode)");
    });

  // Graceful shutdown
  process.on("SIGTERM", async () => {
    console.log("⏹️  SIGTERM received, shutting down gracefully...");
    await shutdownEventSystem();
    process.exit(0);
  });

  process.on("SIGINT", async () => {
    console.log("⏹️  SIGINT received, shutting down gracefully...");
    await shutdownEventSystem();
    process.exit(0);
  });
} else {
  console.warn(
    "⚠️ RABBIT_URL not configured, skipping RabbitMQ initialization"
  );
}

// Default health-check route
app.get("/", (req, res) => {
  res.send("Reporting Service Backend is running");
});

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({
    status: "healthy",
    service: "reporting-service",
    timestamp: new Date().toISOString(),
    port: process.env.PORT || 4005,
    environment: process.env.NODE_ENV || "development",
  });
});

// Test DB connection on startup
testConnection();

const PORT = process.env.PORT || 4005;

app.listen(PORT, () => {
  console.log(`Reporting service running on port ${PORT}`);
});
