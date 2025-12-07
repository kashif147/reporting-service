const pool = require("../db/postgres");

module.exports = {
  getOverview: async () => {
    const { rows } = await pool.query(`
      SELECT * FROM mv_membership_counts
      ORDER BY snapshot_date DESC
      LIMIT 1
    `);
    return rows[0];
  },

  getTrends: async () => {
    const { rows } = await pool.query(`
      SELECT * FROM mv_membership_counts
      ORDER BY snapshot_date ASC
    `);
    return rows;
  },

  getJoiners: async () => {
    const { rows } = await pool.query(`
      SELECT * FROM mv_joiners ORDER BY month ASC
    `);
    return rows;
  },

  getLeavers: async () => {
    const { rows } = await pool.query(`
      SELECT * FROM mv_leavers ORDER BY month ASC
    `);
    return rows;
  },

  getNetChange: async () => {
    const { rows } = await pool.query(`
      SELECT * FROM mv_net_membership ORDER BY month ASC
    `);
    return rows;
  },

  getCategoryDistribution: async () => {
    const { rows } = await pool.query(`
      SELECT * FROM mv_category_distribution ORDER BY member_count DESC
    `);
    return rows;
  },

  getGradeDistribution: async () => {
    const { rows } = await pool.query(`
      SELECT * FROM mv_grade_distribution ORDER BY member_count DESC
    `);
    return rows;
  },

  getSectionDistribution: async () => {
    const { rows } = await pool.query(`
      SELECT * FROM mv_section_distribution ORDER BY member_count DESC
    `);
    return rows;
  },

  getWorkplaceSummary: async () => {
    const { rows } = await pool.query(`
      SELECT * FROM mv_workplace_summary
      ORDER BY region_name, branch_name, workplace_name
    `);
    return rows;
  },

  getRegionBranchSummary: async () => {
    const { rows } = await pool.query(`
      SELECT * FROM mv_region_branch_summary
      ORDER BY region_name, branch_name
    `);
    return rows;
  },
};
