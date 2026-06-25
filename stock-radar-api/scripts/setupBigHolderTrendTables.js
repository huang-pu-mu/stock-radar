import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import pool from "../db.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  const sqlPath = path.join(__dirname, "..", "sql", "v19-big-holder-trend.sql");
  const sql = await fs.readFile(sqlPath, "utf8");
  const conn = await pool.getConnection();

  try {
    console.log("====================================");
    console.log("Stock Radar V1.9 大戶持股趨勢資料表建立");
    console.log("====================================");
    console.log(`SQL：${sqlPath}`);

    for (const statement of sql.split(/;\s*(?:\r?\n|$)/).map((item) => item.trim()).filter(Boolean)) {
      await conn.query(statement);
    }

    console.log("建立 / 確認完成：");
    console.log("- big_holder_trend_signals");
    console.log("- big_holder_trend_summaries");
    console.log("結果：PASS");
  } catch (error) {
    console.error("建立 V1.9 大戶持股趨勢資料表失敗：", error.message);
    process.exitCode = 1;
  } finally {
    conn.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error("建立 V1.9 大戶持股趨勢資料表失敗：", error);
  process.exit(1);
});
