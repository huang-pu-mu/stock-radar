import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import pool from "../db.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const sqlPath = path.join(__dirname, "..", "sql", "v16-global-risk.sql");

function stripSqlLineComments(sqlText) {
  return sqlText
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
}

function splitSqlStatements(sqlText) {
  return stripSqlLineComments(sqlText)
    .split(/;\s*(?:\r?\n|$)/)
    .map((statement) => statement.trim())
    .filter(Boolean);
}

async function main() {
  if (!fs.existsSync(sqlPath)) {
    throw new Error(`找不到 SQL 檔案：${sqlPath}`);
  }

  const sqlText = fs.readFileSync(sqlPath, "utf8");
  const statements = splitSqlStatements(sqlText);
  const conn = await pool.getConnection();

  try {
    console.log("====================================");
    console.log("Stock Radar V1.6 全球市場風險資料表建立");
    console.log("====================================");
    console.log(`SQL：${sqlPath}`);

    for (const statement of statements) {
      await conn.query(statement);
    }

    const tables = await conn.query(`
      SELECT TABLE_NAME AS table_name
      FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME IN ('global_market_snapshots', 'global_market_components', 'global_risk_adjusted_scores')
      ORDER BY TABLE_NAME
    `);

    console.log("建立 / 確認完成：");
    tables.forEach((row) => console.log(`- ${row.table_name}`));
    console.log("結果：PASS");
  } finally {
    conn.release();
    await pool.end();
  }
}

main().catch(async (error) => {
  console.error("V1.6 全球市場風險資料表建立失敗：", error.message);
  try { await pool.end(); } catch {}
  process.exit(1);
});
