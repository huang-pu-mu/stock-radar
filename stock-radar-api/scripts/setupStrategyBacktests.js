import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pool from "../db.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const sqlFilePath = path.join(__dirname, "..", "sql", "strategy-backtests.sql");

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
    console.log("開始建立 V1.3-3-1 策略回測資料表");

    const sqlText = await fs.readFile(sqlFilePath, "utf8");
    const statements = splitSqlStatements(sqlText);

    if (!statements.length) {
      throw new Error(`SQL 檔案沒有可執行內容：${sqlFilePath}`);
    }

    conn = await pool.getConnection();

    for (const statement of statements) {
      await conn.query(statement);
    }

    await addColumnIfMissing(conn, "strategy_backtest_runs", "win_rate_1d", "win_rate_1d DECIMAL(10,4) NULL AFTER avg_return_5d");
    await addColumnIfMissing(conn, "strategy_backtest_runs", "win_rate_3d", "win_rate_3d DECIMAL(10,4) NULL AFTER win_rate_1d");
    await addColumnIfMissing(conn, "strategy_backtest_runs", "win_rate_5d", "win_rate_5d DECIMAL(10,4) NULL AFTER win_rate_3d");
    await addColumnIfMissing(conn, "strategy_backtest_results", "latest_return_percent", "latest_return_percent DECIMAL(10,4) NULL AFTER latest_price_date");
    await addColumnIfMissing(conn, "strategy_backtest_results", "outcome_description", "outcome_description VARCHAR(255) NULL AFTER outcome_label");

    console.log("建立完成");
    console.log("資料表：strategy_backtest_runs");
    console.log("資料表：strategy_backtest_results");
    console.log("下一步可執行：npm run strategy-backtests:generate -- 2026-01-01 2026-06-18");
  } catch (error) {
    console.error("建立 V1.3-3-1 策略回測資料表失敗");
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    if (conn) conn.release();
    await pool.end();
  }
}

main();
