import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pool from "../db.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function stripSqlComments(sqlText) {
  return String(sqlText || "")
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
}

function splitSqlStatements(sqlText) {
  const statements = [];
  let current = "";
  let inSingleQuote = false;
  let inDoubleQuote = false;

  for (let index = 0; index < sqlText.length; index += 1) {
    const char = sqlText[index];
    const previousChar = sqlText[index - 1];

    if (char === "'" && !inDoubleQuote && previousChar !== "\\") {
      inSingleQuote = !inSingleQuote;
    } else if (char === '"' && !inSingleQuote && previousChar !== "\\") {
      inDoubleQuote = !inDoubleQuote;
    }

    if (char === ";" && !inSingleQuote && !inDoubleQuote) {
      const statement = current.trim();
      if (statement) statements.push(statement);
      current = "";
    } else {
      current += char;
    }
  }

  const lastStatement = current.trim();
  if (lastStatement) statements.push(lastStatement);

  return statements;
}

async function main() {
  const sqlPath = path.join(__dirname, "..", "sql", "v12-official-data-tables.sql");
  const sqlText = await fs.readFile(sqlPath, "utf8");
  const statements = splitSqlStatements(stripSqlComments(sqlText));
  const conn = await pool.getConnection();

  try {
    console.log("開始建立 V1.2 官方/資料庫化資料表");

    for (const statement of statements) {
      try {
        await conn.query(statement);
      } catch (error) {
        if (/Duplicate column name/i.test(error.message)) {
          console.log("略過已存在欄位：", error.message);
          continue;
        }
        throw error;
      }
    }

    console.log("V1.2 官方/資料庫化資料表已就緒");
  } catch (error) {
    console.error("建立 V1.2 官方/資料庫化資料表失敗");
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    conn.release();
    await pool.end();
  }
}

main();
