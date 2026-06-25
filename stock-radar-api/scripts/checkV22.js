import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const apiDir = path.resolve(__dirname, "..");
const projectRoot = path.resolve(apiDir, "..");
const args = process.argv.slice(2);
const EXPECTED_API_VERSION = "stock-radar-api-v2.2.0";
const EXPECTED_PWA_VERSION = "stock-radar-pwa-v73";

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

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
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
  const sqlSource = read("stock-radar-api/sql/v22-trade-performance.sql");
  const packageJson = JSON.parse(read("stock-radar-api/package.json"));
  const checks = [];

  checks.push(createCheck("版本", "API 版本為 V2.2.0", serverSource.includes(`const API_VERSION = "${EXPECTED_API_VERSION}"`), EXPECTED_API_VERSION));
  checks.push(createCheck("版本", "API 預期 PWA 版本為 v73", serverSource.includes(`const PWA_EXPECTED_VERSION = "${EXPECTED_PWA_VERSION}"`), EXPECTED_PWA_VERSION));
  checks.push(createCheck("版本", "service-worker 快取版本為 v73", serviceWorkerSource.includes(EXPECTED_PWA_VERSION), EXPECTED_PWA_VERSION));
  checks.push(createCheck("前端", "側邊功能選單顯示 V2.2", indexSource.includes("V2.2 交易紀錄與績效分析"), "index.html"));

  const requiredScripts = [
    "trade:setup",
    "trade:performance",
    "trade:daily",
    "v22:check",
    "v22:test",
    "v21:test",
    "position:daily",
    "ai-selection:daily",
  ];

  for (const scriptName of requiredScripts) {
    checks.push(createCheck("npm 指令", scriptName, Boolean(packageJson.scripts?.[scriptName]), packageJson.scripts?.[scriptName] || "未找到"));
  }

  const requiredFiles = [
    "stock-radar-api/sql/v22-trade-performance.sql",
    "stock-radar-api/scripts/setupTradePerformanceTables.js",
    "stock-radar-api/scripts/generateTradePerformance.js",
    "stock-radar-api/scripts/checkV22.js",
    "stock-radar-api/scripts/runV22Acceptance.js",
    "stock-radar-api/server.js",
    "stock-radar-frontend/app.js",
    "stock-radar-frontend/style.css",
    "stock-radar-frontend/service-worker.js",
  ];

  for (const relativePath of requiredFiles) {
    checks.push(createCheck("必要檔案", relativePath, fileExists(relativePath), fileExists(relativePath) ? "存在" : "缺少"));
  }

  const sqlMarkers = [
    ["user_trades 資料表", "CREATE TABLE IF NOT EXISTS `user_trades`"],
    ["user_realized_trades 資料表", "CREATE TABLE IF NOT EXISTS `user_realized_trades`"],
    ["user_performance_snapshots 資料表", "CREATE TABLE IF NOT EXISTS `user_performance_snapshots`"],
    ["已實現損益欄位", "realized_profit_loss"],
    ["勝率欄位", "win_rate_pct"],
  ];

  for (const [label, marker] of sqlMarkers) {
    checks.push(createCheck("SQL", label, sqlSource.includes(marker), marker));
  }

  const requiredRoutes = [
    ["get", "/health"],
    ["get", "/v22/status"],
    ["get", "/v22/acceptance"],
    ["get", "/trades"],
    ["post", "/trades"],
    ["put", "/trades/:id"],
    ["delete", "/trades/:id"],
    ["get", "/trades/summary"],
    ["get", "/trades/:id"],
    ["post", "/trades/performance/generate"],
    ["get", "/performance/latest"],
    ["get", "/performance/history"],
    ["get", "/performance/strategy"],
  ];

  for (const [method, route] of requiredRoutes) {
    checks.push(createCheck("API 路由", `${method.toUpperCase()} ${route}`, hasRoute(serverSource, method, route), "server.js 靜態檢查"));
  }

  const frontendMarkers = [
    ["交易績效頁", "renderTradePerformancePage"],
    ["交易紀錄 API", "/trades"],
    ["績效 API", "/performance/latest"],
    ["V2.2 文字", "V2.2 交易紀錄與績效分析"],
    ["已實現損益", "已實現損益"],
  ];

  for (const [label, marker] of frontendMarkers) {
    checks.push(createCheck("前端", label, appSource.includes(marker) || indexSource.includes(marker) || styleSource.includes(marker), marker));
  }

  checks.push(createCheck("前端", "不再顯示 V1.4 系統狀態", !appSource.includes("V1.4 系統狀態") && !appSource.includes("V1.4 功能完成度") && !appSource.includes("重新檢查 V1.4"), "V2.2 status copy"));
  checks.push(createCheck("相容", "保留 V2.1 持股風控", serverSource.includes('app.get("/positions"') && serverSource.includes('app.get("/position-risk/latest"'), "V2.1 routes"));
  checks.push(createCheck("相容", "保留 V2.0 AI 多因子", serverSource.includes('app.get("/ai-selection/top"') && serverSource.includes('app.get("/radar/top"'), "V2.0 routes"));

  if (apiBaseUrl) {
    console.log(`\n[API 動態檢查] ${apiBaseUrl}`);
    const apiChecks = [
      ["/health", `${apiBaseUrl}/health`, 200],
      ["/v22/status", `${apiBaseUrl}/v22/status`, 200],
      ["/v22/acceptance", `${apiBaseUrl}/v22/acceptance`, 200],
      ["/trades 需登入保護", `${apiBaseUrl}/trades`, 401],
      ["/performance/latest 需登入保護", `${apiBaseUrl}/performance/latest`, 401],
    ];

    for (const [label, url, expectedStatus] of apiChecks) {
      try {
        const result = await fetchJson(url);
        const ok = result.status === expectedStatus || (expectedStatus === 200 && result.ok && result.data?.success !== false);
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
  console.log("Stock Radar V2.2 交易紀錄與績效分析驗收檢查");
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
  console.error("V2.2 驗收檢查失敗：", error);
  process.exit(1);
});
