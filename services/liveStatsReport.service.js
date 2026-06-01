const { getLiveStatsMonthly } = require("../repositories/membershipAnalytics.repository");
const {
  ensurePeriodSnapshot,
  buildSnapshotAndMetrics,
} = require("./snapshotBuild.service");
const { resolvePeriod } = require("../lib/reportingPeriods");

const DIMENSION_API_MAP = {
  membershipCategory: "membershipCategory",
  grade: "grade",
  branch: "branch",
  region: "region",
  section: "section",
};

async function runLiveStatsReport(tenantId, body) {
  const years = body.years || [];
  const months = body.months || [];

  if (body.recompute === true && years.length && months.length) {
    for (const y of years) {
      for (const m of months) {
        await buildSnapshotAndMetrics(tenantId, {
          type: "month_end",
          year: y,
          month: m,
        });
      }
    }
  } else if (years.length && months.length) {
    for (const y of years) {
      for (const m of months) {
        const { asOfDate } = resolvePeriod({ type: "month_end", year: y, month: m });
        await ensurePeriodSnapshot(tenantId, asOfDate);
      }
    }
  }

  const dimensions = (body.dimensions || Object.keys(DIMENSION_API_MAP)).map(
    (d) => DIMENSION_API_MAP[d] || d
  );

  const rows = await getLiveStatsMonthly(tenantId, {
    years,
    months,
    dimensions,
    includeStudents: body.includeStudents === true,
    includeHonorary: body.includeHonorary === true,
  });

  return { rows };
}

module.exports = { runLiveStatsReport };
