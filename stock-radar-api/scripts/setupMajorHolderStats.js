import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pool from "../db.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  const sqlPath = path.join(__dirname, "..", "sql", "major-holder-stats.sql");
  const sqlText = await fs.readFile(sqlPath, "utf8");
  const conn = await pool.getConnection();

  try {
    console.log("開始建立大戶籌碼資料表 major_holder_stats");
    await conn.query(sqlText);
    console.log("major_holder_stats 資料表已就緒");
  } catch (error) {
    console.error("建立大戶籌碼資料表失敗");
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    conn.release();
    await pool.end();
  }
}

main();
