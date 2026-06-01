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
  const ytdJoiners = k.ytdJoiners || {};
  const ytdLeavers = k.ytdLeavers || {};
  const ytdNet = k.ytdNetGrowth || {};
  const ytdPaid = k.ytdPaidMembers || {};
  const ytdStudent = k.ytdStudentMembers || {};
  const ytdHonorary = k.ytdHonoraryMembers || {};
  const mtm = k.thisMonthVsLastMonth || {};
  const mov = api.movementAnalytics || {};

  return {
    totalActive: n(active.current),
    totalActiveYTD: n(ytd.current),
    totalActiveLY: n(ytd.prior),
    totalActiveThisMonth: n(mtm.active?.current ?? active.current),
    totalActiveLastMonth: n(mtm.active?.prior),

    newJoiners: n(joiners.current),
    newJoinersYTD: n(ytdJoiners.current),
    newJoinersLY: n(ytdJoiners.prior),
    newJoinersThisMonth: n(joiners.current),
    newJoinersLastMonth: n(joiners.prior),

    leavers: n(leavers.current),
    leaversYTD: n(ytdLeavers.current),
    leaversLY: n(ytdLeavers.prior),
    leaversThisMonth: n(leavers.current),
    leaversLastMonth: n(leavers.prior),

    paidMembers: n(paid.current),
    paidMembersYTD: n(ytdPaid.current),
    paidMembersLY: n(ytdPaid.prior),
    paidMembersThisMonth: n(paid.current),
    paidMembersLastMonth: n(paid.prior),

    studentMembers: n(student.current),
    studentMembersYTD: n(ytdStudent.current),
    studentMembersLY: n(ytdStudent.prior),
    studentMembersThisMonth: n(student.current),
    studentMembersLastMonth: n(student.prior),

    honoraryMembers: n(honorary.current),
    honoraryMembersYTD: n(ytdHonorary.current),
    honoraryMembersLY: n(ytdHonorary.prior),
    honoraryMembersThisMonth: n(honorary.current),
    honoraryMembersLastMonth: n(honorary.prior),

    netGrowth: n(net.current),
    netGrowthYTD: n(ytdNet.current),
    netGrowthLY: n(ytdNet.prior),

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
    movementAnalytics: {
      headline: mov.headline || null,
      byCategory: Array.isArray(mov.byCategory) ? mov.byCategory : [],
      byBranch: Array.isArray(mov.byBranch) ? mov.byBranch : [],
      byGrade: Array.isArray(mov.byGrade) ? mov.byGrade : [],
      bySection: Array.isArray(mov.bySection) ? mov.bySection : [],
      trend12Months: Array.isArray(mov.trend12Months) ? mov.trend12Months : [],
    },
    asOfDate: api.asOfDate,
    periodYear: api.periodYear,
    periodMonth: api.periodMonth,
    hasPriorMonthSnapshot: api.hasPriorMonthSnapshot === true,
    hasPriorYearSnapshot: api.hasPriorYearSnapshot === true,
  };
}

module.exports = { toMembershipDashboardShape };
