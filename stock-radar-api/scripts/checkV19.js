import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const apiDir = path.resolve(__dirname, "..");
const projectRoot = path.resolve(apiDir, "..");
const args = process.argv.slice(2);
const EXPECTED_API_VERSION = "stock-radar-api-v1.9.0";
const EXPECTED_PWA_VERSION = "stock-radar-pwa-v65";

function getArg(name) {
  const prefix = `--${name}=`;
  const found = args.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : "";
}

function read(relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
}

function fileExists(relativePath) {
  return fs.existsSync(path.join(projectRoot, relativePath));
}

function createCheck(group, label, passed, message) {
  return { group, label, status: passed ? "pass" : "fail", message };
}

function createWarn(group, label, passed, message) {
  return { group, label, status: passed ? "pass" : "warn", message };
}

function hasRoute(source, method, route) {
  return source.includes(`app.${method}("${route}"`) || source.includes(`app.${method}('${route}'`);
}

async function fetchJson(url) {
  const response = await fetch(url);
  const text = await response.text();
  let data = null;
  try { data = JSON.parse(text); } catch {}
  return { ok: response.ok, status: response.status, data, text: text.slice(0, 300) };
}

async function main() {
  const apiBaseUrl = getArg("api").replace(/\/$/, "");
  const serverSource = read("stock-radar-api/server.js");
  const appSource = read("stock-radar-frontend/app.js");
  const styleSource = read("stock-radar-frontend/style.css");
  const serviceWorkerSource = read("stock-radar-frontend/service-worker.js");
  const indexSource = read("stock-radar-frontend/index.html");
  const sqlSource = read("stock-radar-api/sql/v19-big-holder-trend.sql");
  const packageJson = JSON.parse(read("stock-radar-api/package.json"));
  const checks = [];

  checks.push(createCheck("版本", "API 版本為 V1.9.0", serverSource.includes(`const API_VERSION = "${EXPECTED_API_VERSION}"`), EXPECTED_API_VERSION));
  checks.push(createCheck("版本", "API 預期 PWA 版本為 v65", serverSource.includes(`const PWA_EXPECTED_VERSION = "${EXPECTED_PWA_VERSION}"`), EXPECTED_PWA_VERSION));
  checks.push(createCheck("版本", "service-worker 快取版本為 v65", serviceWorkerSource.includes(EXPECTED_PWA_VERSION), EXPECTED_PWA_VERSION));

  const requiredScripts = [
    "big-holder:setup",
    "big-holder:generate",
    "big-holder:daily",
    "v19:check",
    "v19:test",
    "main-force:daily",
    "breakout:daily",
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
    "stock-radar-api/sql/v19-big-holder-trend.sql",
    "stock-radar-api/scripts/setupBigHolderTrendTables.js",
    "stock-radar-api/scripts/generateBigHolderTrendSignals.js",
    "stock-radar-api/scripts/checkV19.js",
    "stock-radar-api/scripts/runV19Acceptance.js",
    "stock-radar-api/server.js",
    "stock-radar-frontend/app.js",
    "stock-radar-frontend/style.css",
    "stock-radar-frontend/service-worker.js",
  ];

  for (const relativePath of requiredFiles) {
    checks.push(createCheck("必要檔案", relativePath, fileExists(relativePath), fileExists(relativePath) ? "存在" : "缺少"));
  }

  checks.push(createCheck("SQL", "big_holder_trend_signals 資料表", sqlSource.includes("CREATE TABLE IF NOT EXISTS `big_holder_trend_signals`"), "v19-big-holder-trend.sql"));
  checks.push(createCheck("SQL", "big_holder_trend_summaries 資料表", sqlSource.includes("CREATE TABLE IF NOT EXISTS `big_holder_trend_summaries`"), "v19-big-holder-trend.sql"));
  checks.push(createCheck("SQL", "Big Holder Trend Score 欄位", sqlSource.includes("big_holder_trend_score"), "big_holder_trend_score"));
  checks.push(createCheck("SQL", "4週 / 8週變化欄位", sqlSource.includes("large_holder_ratio_4w_change") && sqlSource.includes("large_holder_ratio_8w_change"), "large_holder_ratio_4w_change / large_holder_ratio_8w_change"));
  checks.push(createCheck("SQL", "散戶變化欄位", sqlSource.includes("small_holder_count_4w_change") && sqlSource.includes("small_holder_count_8w_change"), "small_holder_count_4w_change / small_holder_count_8w_change"));

  const requiredRoutes = [
    ["get", "/health"],
    ["get", "/v19/status"],
    ["get", "/v19/acceptance"],
    ["get", "/big-holder-trend/latest"],
    ["get", "/big-holder-trend/top"],
    ["get", "/radar/top"],
  ];

  for (const [method, route] of requiredRoutes) {
    checks.push(createCheck("API 路由", `${method.toUpperCase()} ${route}`, hasRoute(serverSource, method, route), "server.js 靜態檢查"));
  }

  const frontendMarkers = [
    ["大戶持股趨勢卡", "renderBigHolderTrendPanel"],
    ["首頁讀取 /big-holder-trend/latest", "/big-holder-trend/latest"],
    ["股票卡顯示大戶趨勢分數", "大戶趨勢"],
    ["股票卡顯示4週大戶變化", "4週大戶"],
    ["V1.9 狀態檢查", "/v19/status"],
  ];

  for (const [label, marker] of frontendMarkers) {
    checks.push(createCheck("前端", label, appSource.includes(marker) || indexSource.includes(marker) || styleSource.includes(marker), marker));
  }

  if (apiBaseUrl) {
    console.log(`\n[API 動態檢查] ${apiBaseUrl}`);
    const apiChecks = [
      ["/health", `${apiBaseUrl}/health`],
      ["/v19/status", `${apiBaseUrl}/v19/status`],
      ["/v19/acceptance", `${apiBaseUrl}/v19/acceptance`],
      ["/big-holder-trend/latest", `${apiBaseUrl}/big-holder-trend/latest`],
      ["/big-holder-trend/top", `${apiBaseUrl}/big-holder-trend/top?limit=5`],
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
  console.log("Stock Radar V1.9 靜態 / API 驗收檢查");
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
  console.error("V1.9 驗收檢查失敗：", error);
  process.exit(1);
});
