import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pool from "../db.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const sqlFilePath = path.join(__dirname, "..", "sql", "strategy-watchlists.sql");

function splitSqlStatements(sqlText) {
  return sqlText
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      return trimmed && !trimmed.startsWith("--");
    })
    .join("\n")
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

async function main() {
  let conn;

  try {
    console.log("開始建立 V1.3-2-3 策略追蹤資料表");

    const sqlText = await fs.readFile(sqlFilePath, "utf8");
    const statements = splitSqlStatements(sqlText);

    if (!statements.length) {
      throw new Error(`SQL 檔案沒有可執行內容：${sqlFilePath}`);
    }

    conn = await pool.getConnection();

    for (const statement of statements) {
      await conn.query(statement);
    }

    console.log("建立完成");
    console.log("資料表：strategy_watchlists");
    console.log("下一步可部署 API，並在前端策略選股頁加入策略追蹤。");
  } catch (error) {
    console.error("建立 V1.3-2-3 策略追蹤資料表失敗");
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    if (conn) conn.release();
    await pool.end();
  }
}

main();
