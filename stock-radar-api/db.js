import mariadb from "mariadb";
import dotenv from "dotenv";

dotenv.config();

const pool = mariadb.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  connectionLimit: 5,
  connectTimeout: 10000,
  acquireTimeout: 10000,
  charset: "utf8mb4",
});

export async function query(sql, params = []) {
  let conn;

  try {
    conn = await pool.getConnection();
    const rows = await conn.query(sql, params);
    return rows;
  } catch (error) {
    console.error("Database query error:", error);
    throw error;
  } finally {
    if (conn) conn.release();
  }
}

export async function testConnection() {
  const rows = await query(`
    SELECT
      DATABASE() AS database_name,
      DATE_FORMAT(NOW(), '%Y-%m-%d %H:%i:%s') AS server_time
  `);

  return rows[0];
}

export default pool;
