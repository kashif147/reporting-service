const { insertMembershipEvent } = require("../repositories/membershipEvent.repository");
const {
  upsertMembershipListing,
  patchListingByProfile,
  patchListingBySubscription,
} = require("../repositories/membershipListing.repository");
const {
  listingRowFromSubscription,
  listingRowFromReportingSnapshot,
  profileDimensionsPatch,
} = require("../lib/membershipRow.mapper");

const REPORTING_SNAPSHOT = "members.subscription.reporting.snapshot.v1";

let refreshMetricsTimer = null;
function scheduleMetricsRefresh(tenantId) {
  if (!tenantId) return;
  if (refreshMetricsTimer) clearTimeout(refreshMetricsTimer);
  refreshMetricsTimer = setTimeout(async () => {
    try {
      const now = new Date();
      const { buildPeriodSnapshotFromListing } = require("../repositories/membershipSnapshot.repository");
      const { computeAndStoreMonthlyMetrics } = require("../repositories/membershipAnalytics.repository");
      const asOf = now.toISOString().slice(0, 10);
      await buildPeriodSnapshotFromListing(String(tenantId), asOf);
      await computeAndStoreMonthlyMetrics(
        String(tenantId),
        now.getUTCFullYear(),
        now.getUTCMonth() + 1
      );
    } catch (e) {
      console.warn("[reporting] metrics refresh failed:", e.message);
    }
  }, 5000);
}

function eventMeta(payload, eventType) {
  return {
    eventId: payload.eventId,
    eventType,
    tenantId: payload.tenantId,
  };
}

async function recordEvent(payload, eventType, exchange) {
  const data = payload.data || payload;
  const tenantId = data.tenantId || payload.tenantId;
  if (!tenantId) return;

  const occurredAt = new Date(
    payload.occurredAt || payload.timestamp || Date.now()
  );

  await insertMembershipEvent({
    eventId: payload.eventId || `${eventType}-${Date.now()}`,
    eventType,
    tenantId: String(tenantId),
    subscriptionId: data.subscriptionId ? String(data.subscriptionId) : null,
    profileId: data.profileId ? String(data.profileId) : null,
    membershipNumber:
      data.memberId || data.membershipNumber
        ? String(data.memberId || data.membershipNumber)
        : null,
    occurredAt,
    sourceService:
      payload.sourceService || payload.metadata?.service || null,
    correlationId: payload.correlationId || null,
    payload: { data, exchange, eventType },
  });
}

async function applyReportingSnapshot(data, meta) {
  const row = listingRowFromReportingSnapshot(data, meta);
  if (!row.tenant_id || !row.subscription_id) return;
  await upsertMembershipListing(row);
}

async function applySubscriptionChanged(data, meta) {
  const after = data.after;
  if (!after) return;
  const row = listingRowFromSubscription(after, null, {
    ...meta,
    tenantId: data.tenantId || after.tenantId,
    profileId: data.profileId || after.profileId,
  });
  if (!row.tenant_id || !row.subscription_id) return;
  await upsertMembershipListing(row);
}

async function applyResigned(data, meta) {
  if (!data.subscriptionId || !data.tenantId) return;
  await patchListingBySubscription(String(data.tenantId), String(data.subscriptionId), {
    membership_status: "Resigned",
    resigned_at: data.dateResigned || new Date().toISOString(),
    is_current: false,
    last_event_id: meta.eventId,
    last_event_type: meta.eventType,
  });
}

async function applyCancelled(data, meta) {
  if (!data.subscriptionId || !data.tenantId) return;
  await patchListingBySubscription(String(data.tenantId), String(data.subscriptionId), {
    membership_status: "Cancelled",
    is_current: false,
    last_event_id: meta.eventId,
    last_event_type: meta.eventType,
  });
}

async function applyProfileUpdated(data, meta) {
  const after = data.after;
  const tenantId = data.tenantId || after?.tenantId;
  const profileId = data.profileId || after?._id;
  if (!tenantId || !profileId || !after) return;

  const patch = profileDimensionsPatch(after);
  await patchListingByProfile(String(tenantId), String(profileId), {
    ...patch,
    last_event_id: meta.eventId,
    last_event_type: meta.eventType,
  });
}

async function ingestMembershipEvent(payload, eventType, exchange) {
  const data = payload.data || payload;
  const meta = eventMeta(payload, eventType);

  await recordEvent(payload, eventType, exchange);

  if (eventType === REPORTING_SNAPSHOT) {
    await applyReportingSnapshot(data, meta);
    scheduleMetricsRefresh(data.tenantId || payload.tenantId);
    return;
  }

  if (eventType === "members.subscription.changed.v1") {
    await applySubscriptionChanged(data, meta);
    return;
  }

  if (eventType === "members.subscription.resigned.v1") {
    await applyResigned(data, meta);
    return;
  }

  if (eventType === "members.subscription.cancelled.v1") {
    await applyCancelled(data, meta);
    return;
  }

  if (
    eventType === "members.subscription.resignation.undone.v1" ||
    eventType === "members.subscription.cancellation.undone.v1"
  ) {
    if (data.after) {
      await applySubscriptionChanged({ ...data, after: data.after }, meta);
    }
    return;
  }

  if (eventType === "members.subscription.current.updated.v1") {
    return;
  }
}

async function ingestProfileEvent(payload, eventType) {
  const data = payload.data || payload;
  const meta = eventMeta(payload, eventType);

  await recordEvent(payload, eventType, "profile.events");

  if (eventType === "profile.updated" || eventType === "profile.created") {
    await applyProfileUpdated(data, meta);
  }
}

module.exports = {
  ingestMembershipEvent,
  ingestProfileEvent,
  REPORTING_SNAPSHOT,
};
