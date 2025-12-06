// Main RabbitMQ module exports - Now using shared middleware
const {
  init,
  publisher,
  consumer,
  EVENT_TYPES: MIDDLEWARE_EVENT_TYPES,
  shutdown,
} = require("@projectShell/rabbitmq-middleware");

// Initialize event system
async function initEventSystem() {
  try {
    await init({
      url: process.env.RABBIT_URL,
      logger: console,
      prefetch: 10,
    });
    console.log("✅ Event system initialized with middleware");
  } catch (error) {
    console.error("❌ Failed to initialize event system:", error.message);
    throw error;
  }
}

// Publish domain events using middleware
async function publishDomainEvent(eventType, data, metadata = {}) {
  const result = await publisher.publish(eventType, data, {
    tenantId: metadata.tenantId,
    correlationId: metadata.correlationId || generateEventId(),
    metadata: {
      service: "reporting-service",
      version: "1.0",
      ...metadata,
    },
  });

  if (result.success) {
    console.log("✅ Domain event published:", eventType, result.eventId);
  } else {
    console.error(
      "❌ Failed to publish domain event:",
      eventType,
      result.error
    );
  }

  return result.success;
}

// Set up consumers using middleware
async function setupConsumers() {
  try {
    console.log("🔧 Setting up RabbitMQ consumers...");
    // Add your consumer setup here
    console.log("✅ All consumers set up successfully");
  } catch (error) {
    console.error("❌ Failed to set up consumers:", error.message);
    console.error("❌ Stack trace:", error.stack);
    throw error;
  }
}

// Graceful shutdown using middleware
async function shutdownEventSystem() {
  try {
    await shutdown();
    console.log("✅ Event system shutdown complete");
  } catch (error) {
    console.error("❌ Error during event system shutdown:", error.message);
  }
}

// Utility function
function generateEventId() {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

// Export event types
const EVENT_TYPES = {
  ...MIDDLEWARE_EVENT_TYPES,
};

module.exports = {
  // Middleware functions
  init,
  publisher,
  consumer,
  shutdown,

  // Service functions
  EVENT_TYPES,
  initEventSystem,
  publishDomainEvent,
  setupConsumers,
  shutdownEventSystem,
};

