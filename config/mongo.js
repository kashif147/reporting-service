const mongoose = require("mongoose");

async function connectMongo() {
  const mongoUri =
    process.env.MONGO_URI ||
    process.env.REPORTING_MONGO_URI ||
    process.env.MONGODB_URI;

  if (!mongoUri) {
    console.warn(
      "⚠️ MONGO_URI not set — grid template Save View disabled for reporting-service",
    );
    return false;
  }

  if (mongoose.connection.readyState === 1) return true;

  await mongoose.connect(mongoUri, {
    serverSelectionTimeoutMS: 10000,
    connectTimeoutMS: 10000,
    maxPoolSize: 10,
  });

  console.log(`✅ Reporting-service MongoDB connected (${mongoose.connection.name})`);
  return true;
}

async function disconnectMongo() {
  if (mongoose.connection.readyState === 0) return;
  await mongoose.disconnect();
}

module.exports = { connectMongo, disconnectMongo };
