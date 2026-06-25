import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import pool from "../db.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const apiDir = path.resolve(__dirname, "..");
const sqlFile = path.join(apiDir, "sql", "v17-breakout-engine.sql");

function splitSql(sql) {
  return sql
    .split(/;\s*(?:\r?\n|$)/)
    .map((item) => item.trim())
    .filter(Boolean);
}

async function main() {
  console.log("====================================");
  console.log("Stock Radar V1.7 技術突破引擎資料表建立");
  console.log("====================================");
  console.log(`SQL：${sqlFile}`);

  if (!fs.existsSync(sqlFile)) {
    throw new Error(`找不到 SQL 檔案：${sqlFile}`);
  }

  const sqlText = fs.readFileSync(sqlFile, "utf8");
  const statements = splitSql(sqlText);
  const conn = await pool.getConnection();

  try {
    for (const statement of statements) {
      await conn.query(statement);
    }

    console.log("建立 / 確認完成：");
    console.log("- technical_breakout_signals");
    console.log("- technical_breakout_summaries");
    console.log("結果：PASS");
  } finally {
    conn.release();
    await pool.end();
  }
}

main().catch(async (error) => {
  console.error("V1.7 技術突破資料表建立失敗：", error.message);
  try { await pool.end(); } catch {}
  process.exit(1);
});
