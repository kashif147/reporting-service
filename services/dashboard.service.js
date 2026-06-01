const { pool } = require("../db/postgres");

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

  getUnifiedDashboard: async (filters) => {
    const {
      from,
      to,
      categories = [],
      grades = [],
      sections = [],
      region,
      branch,
      workplace,
      includeStudents = false,
      status = "active",
    } = filters;

    const whereClauses = [];
    const params = [];
    let i = 1;

    // DATE FILTERS (monthly)
    if (from && to) {
      whereClauses.push(`snapshot_date BETWEEN $${i++} AND $${i++}`);
      params.push(from, to);
    }

    // CATEGORY FILTER
    if (categories.length > 0) {
      whereClauses.push(`category_id = ANY($${i++})`);
      params.push(categories);
    }

    // GRADE FILTER
    if (grades.length > 0) {
      whereClauses.push(`grade_id = ANY($${i++})`);
      params.push(grades);
    }

    // SECTION FILTER
    if (sections.length > 0) {
      whereClauses.push(`section_id = ANY($${i++})`);
      params.push(sections);
    }

    // REGION / BRANCH / WORKPLACE CASCADE FILTERS
    if (region) {
      whereClauses.push(`region_id = $${i++}`);
      params.push(region);
    }

    if (branch) {
      whereClauses.push(`branch_id = $${i++}`);
      params.push(branch);
    }

    if (workplace) {
      whereClauses.push(`workplace_id = $${i++}`);
      params.push(workplace);
    }

    // INCLUDE STUDENTS?
    if (!includeStudents) {
      whereClauses.push(`paying_type != 'No fee'`);
    }

    const whereSQL = whereClauses.length
      ? "WHERE " + whereClauses.join(" AND ")
      : "";

    //
    // ---- QUERIES ----
    //

    // 1. KPI SUMMARY
    const kpisQuery = `
      SELECT *
      FROM mv_membership_counts
      ${whereSQL}
      ORDER BY snapshot_date DESC
      LIMIT 1
    `;

    // 2. TRENDS: JOINERS (monthly)
    const joinersQuery = `
      SELECT month, joiner_count AS value
      FROM mv_joiners
      ${whereSQL}
      ORDER BY month ASC
    `;

    // 3. TRENDS: LEAVERS (monthly)
    const leaversQuery = `
      SELECT month, leaver_count AS value
      FROM mv_leavers
      ${whereSQL}
      ORDER BY month ASC
    `;

    // 4. NET MEMBERSHIP TREND
    const netQuery = `
      SELECT month, net_change AS value
      FROM mv_net_membership
      ${whereSQL}
      ORDER BY month ASC
    `;

    // 5. DISTRIBUTION — CATEGORY
    const categoryDistQuery = `
      SELECT category_name AS category, member_count AS count
      FROM mv_category_distribution
      ${whereSQL}
      ORDER BY member_count DESC
    `;

    // 6. DISTRIBUTION — REGIONS
    const regionDistQuery = `
      SELECT region_name AS region, member_count AS count
      FROM mv_region_branch_summary
      ${whereSQL}
      ORDER BY region_name
    `;

    // 7. DISTRIBUTION — SECTIONS
    const sectionDistQuery = `
      SELECT section_name AS section, member_count AS count
      FROM mv_section_distribution
      ${whereSQL}
      ORDER BY member_count DESC
    `;

    // 8. TABLES — TOP GRADES
    const topGradesQuery = `
      SELECT grade_name AS name, member_count AS count, active_count AS active
      FROM mv_grade_distribution
      ${whereSQL}
      ORDER BY member_count DESC
      LIMIT 10
    `;

    // 9. TABLES — TOP BRANCHES
    const topBranchesQuery = `
      SELECT branch_name AS name, member_count AS count, active_count AS active
      FROM mv_region_branch_summary
      ${whereSQL}
      ORDER BY member_count DESC
      LIMIT 10
    `;

    // 10. TABLES — TOP WORKPLACES
    const topWorkplacesQuery = `
      SELECT workplace_name AS name, member_count AS count, active_count AS active
      FROM mv_workplace_summary
      ${whereSQL}
      ORDER BY member_count DESC
      LIMIT 10
    `;

    //
    // ---- RUN ALL QUERIES IN PARALLEL ----
    //
    const [
      kpisRes,
      joinersRes,
      leaversRes,
      netRes,
      catRes,
      regionRes,
      sectionRes,
      gradeRes,
      branchRes,
      workplaceRes,
    ] = await Promise.all([
      pool.query(kpisQuery, params),
      pool.query(joinersQuery, params),
      pool.query(leaversQuery, params),
      pool.query(netQuery, params),
      pool.query(categoryDistQuery, params),
      pool.query(regionDistQuery, params),
      pool.query(sectionDistQuery, params),
      pool.query(topGradesQuery, params),
      pool.query(topBranchesQuery, params),
      pool.query(topWorkplacesQuery, params),
    ]);

    //
    // ---- FINAL DASHBOARD RESPONSE ----
    //
    return {
      kpis: kpisRes.rows[0] || {},
      trends: {
        joiners: joinersRes.rows,
        leavers: leaversRes.rows,
        net: netRes.rows,
      },
      distributions: {
        categories: catRes.rows,
        regions: regionRes.rows,
        sections: sectionRes.rows,
      },
      tables: {
        topGrades: gradeRes.rows,
        topBranches: branchRes.rows,
        topWorkplaces: workplaceRes.rows,
      },
    };
  },
};
