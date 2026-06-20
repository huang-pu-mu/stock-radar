import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pool from "../db.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const apiDir = path.resolve(__dirname, "..");
const projectDir = path.resolve(apiDir, "..");

const requiredFiles = [
  "stock-radar-api/scripts/importQuarterlyEps.js",
  "stock-radar-api/scripts/importStockCalendarEvents.js",
  "stock-radar-api/scripts/importInstitutionalAmountSummaries.js",
  "stock-radar-api/scripts/importMonthlyRevenues.js",
  "stock-radar-api/scripts/importMarketDailySummaries.js",
  "stock-radar-api/scripts/backfillMarketDailySummaries.js",
  "stock-radar-api/scripts/backfillInstitutionalAmountSummaries.js",
  "stock-radar-api/scripts/syncEtfProfilesFromStocks.js",
  "stock-radar-api/scripts/setupMicrostructureTables.js",
];

const requiredScripts = [
  "official:setup",
  "official:market",
  "official:revenue",
  "official:eps",
  "official:events",
  "official:etf",
  "official:institutional-amounts",
  "official:market:history",
  "official:institutional-amounts:history",
  "official:microstructure:setup",
  "microstructure:setup",
  "official:daily",
];

const expectedDailyParts = [
  "official:market",
  "official:revenue",
  "official:eps",
  "official:etf",
  "official:events",
  "official:institutional-amounts",
];

const requiredTables = [
  "market_daily_summaries",
  "monthly_revenues",
  "quarterly_eps",
  "stock_calendar_events",
  "etf_profiles",
  "institutional_amount_summaries",
  "realtime_quote_snapshots",
  "market_order_flow_snapshots",
];

function okText(ok) {
  return ok ? "OK" : "MISSING";
}

function row(status, name, detail = "") {
  const label = status ? "✅" : "❌";
  console.log(`${label} ${name}${detail ? ` - ${detail}` : ""}`);
}

function readPackageJson() {
  const packagePath = path.join(apiDir, "package.json");
  return JSON.parse(fs.readFileSync(packagePath, "utf8"));
}

function checkFiles() {
  console.log("\n[1] V1.2 必要檔案檢查");
  const result = [];

  for (const file of requiredFiles) {
    const fullPath = path.join(projectDir, file);
    const exists = fs.existsSync(fullPath);
    row(exists, file);
    result.push({ name: file, ok: exists });
  }

  const swPath = path.join(projectDir, "stock-radar-frontend/service-worker.js");
  const swText = fs.existsSync(swPath) ? fs.readFileSync(swPath, "utf8") : "";
  const swMatch = swText.match(/stock-radar-pwa-v(\d+)/);
  const swVersion = swMatch ? Number(swMatch[1]) : null;
  const swOk = Number.isFinite(swVersion) && swVersion >= 23;
  row(swOk, "stock-radar-frontend/service-worker.js", swVersion ? `目前 v${swVersion}，要求 v23 以上` : "找不到 CACHE_NAME 版本");
  result.push({ name: "stock-radar-frontend/service-worker.js >= v23", ok: swOk });

  return result;
}

function checkPackageScripts() {
  console.log("\n[2] package.json 指令檢查");
  const pkg = readPackageJson();
  const scripts = pkg.scripts || {};
  const result = [];

  for (const scriptName of requiredScripts) {
    const exists = Boolean(scripts[scriptName]);
    row(exists, `npm run ${scriptName}`, exists ? scripts[scriptName] : "尚未設定");
    result.push({ name: scriptName, ok: exists });
  }

  const dailyCommand = scripts["official:daily"] || "";
  console.log("\n[3] official:daily 內容檢查");
  for (const part of expectedDailyParts) {
    const included = dailyCommand.includes(part) || dailyCommand.includes(part.replace("official:", ""));
    row(included, `official:daily 包含 ${part}`);
    result.push({ name: `official:daily includes ${part}`, ok: included });
  }

  return result;
}

async function tableExists(conn, tableName) {
  const rows = await conn.query(
    `
      SELECT COUNT(*) AS total
      FROM information_schema.tables
      WHERE table_schema = DATABASE()
        AND table_name = ?
    `,
    [tableName],
  );

  return Number(rows[0]?.total || 0) > 0;
}

async function columnExists(conn, tableName, columnName) {
  const rows = await conn.query(
    `
      SELECT COUNT(*) AS total
      FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = ?
        AND column_name = ?
    `,
    [tableName, columnName],
  );

  return Number(rows[0]?.total || 0) > 0;
}

async function tableCount(conn, tableName) {
  try {
    const rows = await conn.query(`SELECT COUNT(*) AS total FROM \`${tableName}\``);
    return Number(rows[0]?.total || 0);
  } catch {
    return null;
  }
}

async function checkDatabase() {
  console.log("\n[4] 資料庫表格檢查");
  const result = [];
  let conn;

  try {
    conn = await pool.getConnection();

    for (const table of requiredTables) {
      const exists = await tableExists(conn, table);
      const count = exists ? await tableCount(conn, table) : null;
      row(exists, table, exists ? `目前 ${count} 筆` : "資料表不存在");
      result.push({ name: table, ok: exists, count });
    }

    const hasSecurityType = await columnExists(conn, "stocks", "security_type");
    row(hasSecurityType, "stocks.security_type", hasSecurityType ? "欄位存在" : "欄位不存在");
    result.push({ name: "stocks.security_type", ok: hasSecurityType });
  } catch (error) {
    console.log("❌ 無法連線資料庫或檢查資料表");
    console.log(`   原因：${error.message}`);
    result.push({ name: "database connection", ok: false, error: error.message });
  } finally {
    if (conn) conn.release();
    await pool.end();
  }

  return result;
}

async function main() {
  console.log("====================================");
  console.log("Stock Radar V1.2 版本一致性檢查");
  console.log("====================================");

  const fileResults = checkFiles();
  const scriptResults = checkPackageScripts();
  const dbResults = await checkDatabase();
  const allResults = [...fileResults, ...scriptResults, ...dbResults];
  const failed = allResults.filter((item) => !item.ok);

  console.log("\n[5] 總結");
  console.log(`檢查項目：${allResults.length}`);
  console.log(`通過：${allResults.length - failed.length}`);
  console.log(`未通過：${failed.length}`);

  if (failed.length > 0) {
    console.log("\n未通過項目：");
    for (const item of failed) {
      console.log(`- ${item.name}${item.error ? `：${item.error}` : ""}`);
    }

    process.exitCode = 1;
    return;
  }

  console.log("\n✅ V1.2 版本一致性檢查通過，可以接續做自動排程。尚未代表資料內容已完整，仍需另外確認歷史筆數與前端顯示。 ");
}

main().catch(async (error) => {
  console.error("檢查程式執行失敗：", error);
  try {
    await pool.end();
  } catch {}
  process.exit(1);
});
