const CHART_COLORS = ["#8884d8", "#82ca9d", "#ffc658", "#ff7300", "#00ff00", "#0088fe"];

function n(v) {
  return Number(v) || 0;
}

/**
 * Maps reporting-service analytics payload to MembershipDashboard.js shape.
 */
function toMembershipDashboardShape(api) {
  const k = api.kpis || {};
  const dist = api.distributions || {};

  const active = k.totalActiveMembers || {};
  const joiners = k.newJoiners || {};
  const leavers = k.leavers || {};
  const net = k.netGrowth || {};
  const paid = k.paidMembers || {};
  const student = k.studentMembers || {};
  const honorary = k.honoraryMembers || {};
  const ytd = k.ytdActive || {};
  const mtm = k.thisMonthVsLastMonth || {};

  return {
    totalActive: n(active.current),
    totalActiveYTD: n(ytd.current),
    totalActiveLY: n(ytd.prior),
    totalActiveThisMonth: n(mtm.active?.current ?? active.current),
    totalActiveLastMonth: n(mtm.active?.prior),

    newJoiners: n(joiners.current),
    newJoinersYTD: n(joiners.current),
    newJoinersLY: n(joiners.prior),
    newJoinersThisMonth: n(joiners.current),
    newJoinersLastMonth: n(joiners.prior),

    leavers: n(leavers.current),
    leaversYTD: n(leavers.current),
    leaversLY: n(leavers.prior),
    leaversThisMonth: n(leavers.current),
    leaversLastMonth: n(leavers.prior),

    paidMembers: n(paid.current),
    paidMembersYTD: n(paid.current),
    paidMembersLY: n(paid.prior),
    paidMembersThisMonth: n(paid.current),
    paidMembersLastMonth: n(paid.prior),

    studentMembers: n(student.current),
    studentMembersYTD: n(student.current),
    studentMembersLY: n(student.prior),
    studentMembersThisMonth: n(student.current),
    studentMembersLastMonth: n(student.prior),

    honoraryMembers: n(honorary.current),
    honoraryMembersYTD: n(honorary.current),
    honoraryMembersLY: n(honorary.prior),
    honoraryMembersThisMonth: n(honorary.current),
    honoraryMembersLastMonth: n(honorary.prior),

    netGrowth: n(net.current),
    netGrowthYTD: n(net.current),
    netGrowthLY: n(net.prior),

    categoryData: (dist.membershipCategory || []).map((row, i) => ({
      name: row.name || "(blank)",
      value: n(row.count),
      color: CHART_COLORS[i % CHART_COLORS.length],
    })),
    gradeData: (dist.grade || []).map((row) => ({
      name: row.name,
      count: n(row.count),
    })),
    sectionData: (dist.section || []).map((row) => ({
      name: row.name,
      count: n(row.count),
    })),
    branchData: (dist.branch || []).map((row) => ({
      name: row.name,
      count: n(row.count),
    })),
    regionData: (dist.region || []).map((row) => ({
      name: row.name,
      count: n(row.count),
    })),
    workLocationData: (dist.workLocation || []).map((row) => ({
      name: row.name,
      count: n(row.count),
    })),
    asOfDate: api.asOfDate,
    hasPriorMonthSnapshot: api.hasPriorMonthSnapshot === true,
    hasPriorYearSnapshot: api.hasPriorYearSnapshot === true,
  };
}

module.exports = { toMembershipDashboardShape };
