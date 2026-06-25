import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const apiDir = path.resolve(__dirname, "..");
const projectRoot = path.resolve(apiDir, "..");
const EXPECTED_API_VERSION = "stock-radar-api-v1.7.0";
const EXPECTED_PWA_VERSION = "stock-radar-pwa-v63";

const args = process.argv.slice(2);
const apiArg = args.find((arg) => arg.startsWith("--api="));
const apiBaseUrl = apiArg ? apiArg.replace(/^--api=/, "").replace(/\/$/, "") : "";

function readText(relativePath) {
  const fullPath = path.join(projectRoot, relativePath);
  if (!fs.existsSync(fullPath)) return "";
  return fs.readFileSync(fullPath, "utf8");
}

function fileExists(relativePath) {
  return fs.existsSync(path.join(projectRoot, relativePath));
}

function createCheck(group, label, ok, message = "") {
  return { group, label, status: ok ? "pass" : "fail", message };
}

function createWarn(group, label, ok, message = "") {
  return { group, label, status: ok ? "pass" : "warn", message };
}

function hasRoute(serverSource, method, route) {
  const normalized = route.replace(/\//g, "\\/");
  const pattern = new RegExp(`app\\.${method}\\([\\"']${normalized}[\\"']`);
  return pattern.test(serverSource);
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  const text = await response.text();
  try {
    return { ok: response.ok, status: response.status, data: JSON.parse(text) };
  } catch {
    return { ok: response.ok, status: response.status, data: null, text: text.slice(0, 300) };
  }
}

async function main() {
  const checks = [];
  const packageJsonText = readText("stock-radar-api/package.json");
  const serverSource = readText("stock-radar-api/server.js");
  const appSource = readText("stock-radar-frontend/app.js");
  const indexSource = readText("stock-radar-frontend/index.html");
  const styleSource = readText("stock-radar-frontend/style.css");
  const serviceWorkerSource = readText("stock-radar-frontend/service-worker.js");
  const sqlSource = readText("stock-radar-api/sql/v17-breakout-engine.sql");

  let packageJson = {};
  try { packageJson = JSON.parse(packageJsonText); } catch {}

  checks.push(createCheck("版本", "API 版本為 V1.7.0", serverSource.includes(EXPECTED_API_VERSION), EXPECTED_API_VERSION));
  checks.push(createCheck("版本", "API 預期 PWA 版本為 v63", serverSource.includes(EXPECTED_PWA_VERSION), EXPECTED_PWA_VERSION));
  checks.push(createCheck("版本", "service-worker 快取版本為 v63", serviceWorkerSource.includes(EXPECTED_PWA_VERSION), EXPECTED_PWA_VERSION));

  const requiredScripts = [
    "breakout:setup",
    "breakout:generate",
    "breakout:daily",
    "v17:check",
    "v17:test",
    "global-risk:daily",
    "market-risk:daily",
    "official:daily",
    "alerts:generate",
    "strategy-backtests:generate",
  ];

  for (const scriptName of requiredScripts) {
    checks.push(createCheck("npm 指令", scriptName, Boolean(packageJson.scripts?.[scriptName]), packageJson.scripts?.[scriptName] || "未找到"));
  }

  const requiredFiles = [
    "stock-radar-api/sql/v17-breakout-engine.sql",
    "stock-radar-api/scripts/setupBreakoutEngineTables.js",
    "stock-radar-api/scripts/generateBreakoutSignals.js",
    "stock-radar-api/scripts/checkV17.js",
    "stock-radar-api/scripts/runV17Acceptance.js",
    "stock-radar-api/server.js",
    "stock-radar-frontend/app.js",
    "stock-radar-frontend/style.css",
    "stock-radar-frontend/service-worker.js",
  ];

  for (const relativePath of requiredFiles) {
    checks.push(createCheck("必要檔案", relativePath, fileExists(relativePath), fileExists(relativePath) ? "存在" : "缺少"));
  }

  checks.push(createCheck("SQL", "technical_breakout_signals 資料表", sqlSource.includes("CREATE TABLE IF NOT EXISTS `technical_breakout_signals`"), "v17-breakout-engine.sql"));
  checks.push(createCheck("SQL", "technical_breakout_summaries 資料表", sqlSource.includes("CREATE TABLE IF NOT EXISTS `technical_breakout_summaries`"), "v17-breakout-engine.sql"));
  checks.push(createCheck("SQL", "Breakout Score 欄位", sqlSource.includes("breakout_score"), "breakout_score"));
  checks.push(createCheck("SQL", "突破型態欄位", sqlSource.includes("breakout_type"), "breakout_type"));

  const requiredRoutes = [
    ["get", "/health"],
    ["get", "/v17/status"],
    ["get", "/v17/acceptance"],
    ["get", "/breakout/latest"],
    ["get", "/breakout/top"],
    ["get", "/radar/top"],
  ];

  for (const [method, route] of requiredRoutes) {
    checks.push(createCheck("API 路由", `${method.toUpperCase()} ${route}`, hasRoute(serverSource, method, route), "server.js 靜態檢查"));
  }

  const frontendMarkers = [
    ["技術突破狀態卡", "renderBreakoutPanel"],
    ["首頁讀取 /breakout/latest", "/breakout/latest"],
    ["股票卡顯示突破分數", "突破分數"],
    ["V1.7 狀態檢查", "/v17/status"],
  ];

  for (const [label, marker] of frontendMarkers) {
    checks.push(createCheck("前端", label, appSource.includes(marker) || indexSource.includes(marker) || styleSource.includes(marker), marker));
  }

  if (apiBaseUrl) {
    console.log(`\n[API 動態檢查] ${apiBaseUrl}`);
    const apiChecks = [
      ["/health", `${apiBaseUrl}/health`],
      ["/v17/status", `${apiBaseUrl}/v17/status`],
      ["/v17/acceptance", `${apiBaseUrl}/v17/acceptance`],
      ["/breakout/latest", `${apiBaseUrl}/breakout/latest`],
      ["/breakout/top", `${apiBaseUrl}/breakout/top?limit=5`],
    ];

    for (const [label, url] of apiChecks) {
      try {
        const result = await fetchJson(url);
        const ok = result.ok && result.data && result.data.success !== false;
        checks.push(createWarn("API 動態", label, ok, ok ? `HTTP ${result.status}` : `HTTP ${result.status} ${result.data?.message || result.text || ""}`));
      } catch (error) {
        checks.push(createWarn("API 動態", label, false, error.message));
      }
    }
  }

  const failCount = checks.filter((check) => check.status === "fail").length;
  const warnCount = checks.filter((check) => check.status === "warn").length;
  const passCount = checks.filter((check) => check.status === "pass").length;

  console.log("====================================");
  console.log("Stock Radar V1.7 靜態 / API 驗收檢查");
  console.log("====================================");

  for (const check of checks) {
    const icon = check.status === "pass" ? "✅" : check.status === "warn" ? "⚠️" : "❌";
    console.log(`${icon} [${check.group}] ${check.label} - ${check.message}`);
  }

  console.log("------------------------------------");
  console.log(`PASS：${passCount}`);
  console.log(`WARN：${warnCount}`);
  console.log(`FAIL：${failCount}`);
  console.log(`結果：${failCount > 0 ? "FAIL" : warnCount > 0 ? "WARN" : "PASS"}`);

  if (failCount > 0) process.exit(1);
}

main().catch((error) => {
  console.error("V1.7 驗收檢查失敗：", error);
  process.exit(1);
});
