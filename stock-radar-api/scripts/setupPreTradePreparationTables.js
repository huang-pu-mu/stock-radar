import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import pool from "../db.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const apiDir = path.resolve(__dirname, "..");
const sqlPath = path.join(apiDir, "sql", "v31-pre-trade-preparation.sql");

function splitSql(sql) {
  return sql
    .split(/;\s*(?:\r?\n|$)/)
    .map((statement) => statement.trim())
    .filter(Boolean);
}

async function main() {
  console.log("====================================");
  console.log("Stock Radar V3.1 半自動交易前置準備資料表建立");
  console.log("====================================");
  console.log(`SQL：${sqlPath}`);

  if (!fs.existsSync(sqlPath)) throw new Error(`找不到 SQL 檔案：${sqlPath}`);

  const sql = fs.readFileSync(sqlPath, "utf8");
  const statements = splitSql(sql);
  let conn;

  try {
    conn = await pool.getConnection();
    for (const statement of statements) {
      await conn.query(statement);
    }

    console.log("建立 / 確認完成：");
    console.log("- pre_trade_plans");
    console.log("- pre_trade_check_items");
    console.log("- pre_trade_action_logs");
    console.log("結果：PASS");
  } finally {
    if (conn) conn.release();
    await pool.end();
  }
}

main().catch(async (error) => {
  console.error("結果：FAIL");
  console.error(error);
  try { await pool.end(); } catch {}
  process.exit(1);
});
