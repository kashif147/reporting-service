const {
  init,
  publisher,
  consumer,
  shutdown,
  EVENT_TYPES: MIDDLEWARE_EVENT_TYPES,
} = require("@projectShell/rabbitmq-middleware");
const { handleMembershipEvent } = require("./listeners/membership.listener");
const { handleProfileEvent } = require("./listeners/profile.listener");
const { handleAccountsEvent } = require("./listeners/accounts.listener");
const { handleJournalEvent } = require("./listeners/journal.listener");

const QUEUES = {
  membership: "reporting.membership.events",
  profile: "reporting.profile.events",
  accounts: "reporting.accounts.events",
  journal: "reporting.journal.events",
};

const MEMBERSHIP_ROUTING_KEYS = [
  "members.subscription.reporting.snapshot.v1",
  "members.subscription.current.updated.v1",
  "members.subscription.changed.v1",
  "members.subscription.category.changed.v1",
  "members.subscription.resigned.v1",
  "members.subscription.resignation.undone.v1",
  "members.subscription.cancelled.v1",
  "members.subscription.cancellation.undone.v1",
  "members.subscription.cancel.grace.ended.v1",
  "members.member.created.requested.v1",
  "members.subscription.upsert.requested.v1",
];

async function initEventSystem() {
  await init({
    url: process.env.RABBIT_URL,
    logger: console,
    prefetch: 10,
    connectionName: "reporting-service",
    serviceName: "reporting-service",
  });
  console.log("✅ Reporting-service RabbitMQ initialised");
}

async function setupQueue(queueName, bindings, handler) {
  await consumer.createQueue(queueName, { durable: true, messageTtl: 3_600_000 });

  const routingKeyExchange = new Map();
  for (const { exchange, routingKeys } of bindings) {
    await consumer.bindQueue(queueName, exchange, routingKeys);
    for (const rk of routingKeys) {
      if (!routingKeyExchange.has(rk)) routingKeyExchange.set(rk, exchange);
    }
  }

  for (const [key, boundExchange] of routingKeyExchange) {
    consumer.registerHandler(key, async (payload) => {
      try {
        await handler(payload, key, boundExchange);
      } catch (err) {
        console.error("Reporting consumer error:", key, err.message);
        throw err;
      }
    });
  }

  await consumer.consume(queueName, { prefetch: 10 });
  console.log("✅ Reporting consumer ready:", queueName);
}

async function setupConsumers() {
  await setupQueue(
    QUEUES.membership,
    [{ exchange: "membership.events", routingKeys: MEMBERSHIP_ROUTING_KEYS }],
    handleMembershipEvent
  );

  await setupQueue(
    QUEUES.profile,
    [
      {
        exchange: "profile.events",
        routingKeys: ["profile.created", "profile.updated", "profile.deleted"],
      },
    ],
    (payload, eventType) => handleProfileEvent(payload, eventType)
  );

  await setupQueue(
    QUEUES.accounts,
    [
      {
        exchange: "accounts.events",
        routingKeys: ["accounts.member.credit.updated.v1"],
      },
    ],
    handleAccountsEvent
  );

  await setupQueue(
    QUEUES.journal,
    [
      {
        exchange: "journal.events",
        routingKeys: ["journal.created.v1"],
      },
    ],
    handleJournalEvent
  );
}

async function shutdownEventSystem() {
  await shutdown();
}

function generateEventId() {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

const EVENT_TYPES = { ...MIDDLEWARE_EVENT_TYPES };

module.exports = {
  init,
  publisher,
  consumer,
  shutdown,
  EVENT_TYPES,
  initEventSystem,
  setupConsumers,
  shutdownEventSystem,
  generateEventId,
};
