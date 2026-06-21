import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pool from "../db.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const sqlFilePath = path.join(__dirname, "..", "sql", "notification-channels.sql");

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
    console.log("開始建立 V1.4-4-1 通知外送資料表");

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
    console.log("資料表：notification_channels");
    console.log("資料表：notification_send_logs");
    console.log("下一步：設定 LINE_CHANNEL_ACCESS_TOKEN，然後到前端通知外送頁新增 LINE 目標並測試。 ");
  } catch (error) {
    console.error("建立 V1.4-4-1 通知外送資料表失敗");
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    if (conn) conn.release();
    await pool.end();
  }
}

main();
