const { memberSegmentFromCategory } = require("./memberSegment");

function toDateOnly(value) {
  if (value == null || value === "") return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function toTimestamp(value) {
  if (value == null || value === "") return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function fullNameFromProfile(profile) {
  if (!profile) return null;
  const pi = profile.personalInfo || profile;
  if (pi.fullName) return String(pi.fullName).trim() || null;
  const parts = [pi.forename, pi.surname].filter(Boolean);
  return parts.length ? parts.join(" ").trim() : null;
}

function fullAddressFromProfile(profile) {
  if (!profile) return null;
  const ci =
    profile.contactInfo ||
    profile.personalInfo?.contactInfo ||
    profile.personalDetails?.contactInfo;
  const raw = ci?.fullAddress || ci?.full_address;
  return raw != null && String(raw).trim() ? String(raw).trim() : null;
}

function professionalFromProfile(profile) {
  return profile?.professionalDetails || profile || {};
}

/**
 * Build listing row from subscription Mongo shape + optional profile lean object.
 */
function listingRowFromSubscription(sub, profile, meta = {}) {
  const prof = professionalFromProfile(profile);
  const subId = sub._id != null ? String(sub._id) : String(sub.subscriptionId || "");
  const profileId =
    sub.profileId != null
      ? String(sub.profileId?._id || sub.profileId)
      : String(meta.profileId || "");

  let membershipNumber = meta.memberId || meta.membershipNumber || null;
  if (!membershipNumber && profile?.membershipNumber) {
    membershipNumber = String(profile.membershipNumber).trim();
  }

  const processingDate =
    meta.processingDate ||
    sub.subscriptionAttributes?.processingDate ||
    null;

  return {
    tenant_id: String(sub.tenantId || meta.tenantId || ""),
    subscription_id: subId,
    profile_id: profileId,
    membership_number: membershipNumber,
    full_name: fullNameFromProfile(profile),
    full_address: fullAddressFromProfile(profile),
    membership_status: sub.subscriptionStatus || sub.status || "Active",
    membership_movement: sub.membershipMovement || null,
    start_date: toDateOnly(sub.startDate),
    expiry_date: toDateOnly(sub.endDate),
    cancelled_at: toTimestamp(sub.cancellation?.dateCancelled),
    resigned_at: toTimestamp(sub.resignation?.dateResigned),
    processed_at: toTimestamp(sub.yearend?.processedAt || processingDate),
    membership_category: sub.membershipCategory || null,
    grade: prof.grade || null,
    work_location: prof.workLocation || null,
    branch: prof.branch || null,
    region: prof.region || null,
    section: prof.primarySection || null,
    payment_type: sub.paymentType || null,
    payment_frequency: sub.paymentFrequency || null,
    subscription_year: sub.subscriptionYear ?? null,
    is_current: sub.isCurrent === true,
    member_segment: memberSegmentFromCategory(sub.membershipCategory),
    previous_subscription_id: sub.previousSubscriptionId
      ? String(sub.previousSubscriptionId)
      : null,
    previous_membership_status: sub.previousMembershipStatus || null,
    movement_resolved_at: toTimestamp(sub.movementResolvedAt),
    renewal_batch_id: sub.renewalBatchId ? String(sub.renewalBatchId) : null,
    year_end_fiscal_year: meta.yearEndFiscalYear ?? null,
    year_end_action: meta.yearEndAction || null,
    new_membership_status: meta.newMembershipStatus || null,
    snapshot_as_of_date: toDateOnly(meta.snapshotAsOfDate),
    last_event_id: meta.eventId || null,
    last_event_type: meta.eventType || null,
  };
}

/**
 * Patch profile dimensions onto existing listing rows for a profile.
 */
function profileDimensionsPatch(profile) {
  const prof = professionalFromProfile(profile);
  return {
    membership_number: profile?.membershipNumber
      ? String(profile.membershipNumber).trim()
      : undefined,
    full_name: fullNameFromProfile(profile),
    full_address: fullAddressFromProfile(profile),
    grade: prof.grade ?? null,
    work_location: prof.workLocation ?? null,
    branch: prof.branch ?? null,
    region: prof.region ?? null,
    section: prof.primarySection ?? null,
  };
}

/**
 * Explicit reporting snapshot event payload (members.subscription.reporting.snapshot.v1).
 */
function listingRowFromReportingSnapshot(data, meta = {}) {
  return {
    tenant_id: String(data.tenantId || meta.tenantId || ""),
    subscription_id: String(data.subscriptionId),
    profile_id: String(data.profileId),
    membership_number: data.membershipNumber || null,
    full_name: data.fullName || null,
    full_address: data.fullAddress || data.full_address || null,
    membership_status: data.membershipStatus,
    membership_movement: data.membershipMovement || null,
    start_date: toDateOnly(data.startDate),
    expiry_date: toDateOnly(data.expiryDate),
    cancelled_at: toTimestamp(data.cancelledAt),
    resigned_at: toTimestamp(data.resignedAt),
    processed_at: toTimestamp(data.processedAt),
    membership_category: data.membershipCategory || null,
    grade: data.grade || null,
    work_location: data.workLocation || null,
    branch: data.branch || null,
    region: data.region || null,
    section: data.section || null,
    payment_type: data.paymentType || null,
    payment_frequency: data.paymentFrequency || null,
    subscription_year: data.subscriptionYear ?? null,
    is_current: data.isCurrent === true,
    member_segment: memberSegmentFromCategory(data.membershipCategory),
    previous_subscription_id: data.previousSubscriptionId || null,
    previous_membership_status: data.previousMembershipStatus || null,
    movement_resolved_at: toTimestamp(data.movementResolvedAt),
    renewal_batch_id: data.renewalBatchId || null,
    year_end_fiscal_year: data.yearEndFiscalYear ?? null,
    year_end_action: data.yearEndAction || null,
    new_membership_status: data.newMembershipStatus || null,
    snapshot_as_of_date: toDateOnly(data.snapshotAsOfDate),
    last_event_id: meta.eventId || null,
    last_event_type: meta.eventType || "members.subscription.reporting.snapshot.v1",
  };
}

module.exports = {
  listingRowFromSubscription,
  listingRowFromReportingSnapshot,
  profileDimensionsPatch,
  toDateOnly,
  toTimestamp,
};
