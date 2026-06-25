import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import pool from "../db.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const apiDir = path.resolve(__dirname, "..");
const sqlPath = path.join(apiDir, "sql", "v25-daily-war-room.sql");

function splitSql(sql) {
  return sql
    .split(/;\s*(?:\r?\n|$)/)
    .map((statement) => statement.trim())
    .filter(Boolean);
}

async function main() {
  console.log("====================================");
  console.log("Stock Radar V2.5 每日投資作戰室資料表建立");
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
    console.log("- daily_war_room_reports");
    console.log("- daily_war_room_items");
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
