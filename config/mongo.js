const mongoose = require("mongoose");

mongoose.set("bufferCommands", false);

let connectPromise = null;

function resolveMongoUri() {
  return (
    process.env.MONGO_URI ||
    process.env.REPORTING_MONGO_URI ||
    process.env.MONGODB_URI ||
    ""
  ).trim();
}

function isMongoConnected() {
  return mongoose.connection.readyState === 1;
}

function maskMongoUri(uri) {
  if (!uri) return "(not set)";
  return uri.replace(/\/\/([^:@/]+):([^@/]+)@/, "//$1:***@");
}

function resetConnectPromise() {
  connectPromise = null;
}

if (!mongoose.connection.listenerCount("disconnected")) {
  mongoose.connection.on("disconnected", () => {
    resetConnectPromise();
    console.warn("⚠️ Reporting-service MongoDB disconnected");
  });
  mongoose.connection.on("error", (error) => {
    resetConnectPromise();
    console.error("❌ Reporting-service MongoDB connection error:", error.message);
  });
}

async function connectMongo() {
  const mongoUri = resolveMongoUri();

  if (!mongoUri) {
    console.warn(
      "⚠️ MONGO_URI not set — grid template Save View disabled for reporting-service",
    );
    return false;
  }

  if (isMongoConnected()) return true;

  if (connectPromise) return connectPromise;

  connectPromise = mongoose
    .connect(mongoUri, {
      serverSelectionTimeoutMS: 30000,
      connectTimeoutMS: 30000,
      socketTimeoutMS: 30000,
      maxPoolSize: 10,
      minPoolSize: 2,
    })
    .then(() => {
      console.log(
        `✅ Reporting-service MongoDB connected (${mongoose.connection.name})`,
      );
      return true;
    })
    .catch((error) => {
      resetConnectPromise();
      console.error(
        `❌ Reporting-service MongoDB connection failed (${maskMongoUri(mongoUri)}):`,
        error.message,
      );
      throw error;
    });

  return connectPromise;
}

async function ensureMongoConnected() {
  if (isMongoConnected()) return true;
  resetConnectPromise();
  return connectMongo();
}

async function disconnectMongo() {
  resetConnectPromise();
  if (mongoose.connection.readyState === 0) return;
  await mongoose.disconnect();
}

module.exports = {
  connectMongo,
  ensureMongoConnected,
  disconnectMongo,
  isMongoConnected,
  resolveMongoUri,
  maskMongoUri,
};
