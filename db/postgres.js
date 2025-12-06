const { Pool } = require("pg");

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

// Test database connectivity
const testConnection = async () => {
  try {
    const result = await pool.query("SELECT NOW()");
    console.log("PostgreSQL connected:", result.rows[0].now);
  } catch (err) {
    console.error("PostgreSQL connection error:", err.message);
  }
};

module.exports = {
  pool,
  testConnection,
};
