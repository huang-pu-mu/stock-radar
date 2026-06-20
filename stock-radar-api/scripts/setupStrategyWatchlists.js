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

async function columnExists(conn, tableName, columnName) {
  const rows = await conn.query(
    `
    SELECT COUNT(*) AS count
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = ?
      AND COLUMN_NAME = ?
    `,
    [tableName, columnName],
  );

  return Number(rows[0]?.count || 0) > 0;
}

async function addColumnIfMissing(conn, tableName, columnName, columnSql) {
  const exists = await columnExists(conn, tableName, columnName);

  if (!exists) {
    await conn.query(`ALTER TABLE ${tableName} ADD COLUMN ${columnSql}`);
    console.log(`補欄位完成：${tableName}.${columnName}`);
  }
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

    await addColumnIfMissing(
      conn,
      "strategy_watchlists",
      "take_profit_percent",
      "take_profit_percent DECIMAL(8,4) NOT NULL DEFAULT 5.0000 AFTER note",
    );
    await addColumnIfMissing(
      conn,
      "strategy_watchlists",
      "stop_loss_percent",
      "stop_loss_percent DECIMAL(8,4) NOT NULL DEFAULT 3.0000 AFTER take_profit_percent",
    );

    console.log("建立完成");
    console.log("資料表：strategy_watchlists");
    console.log("欄位：take_profit_percent / stop_loss_percent");
    console.log("下一步可部署 API，並在前端策略追蹤頁設定停利停損觀察。");
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
