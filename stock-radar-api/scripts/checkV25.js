import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const apiDir = path.resolve(__dirname, "..");
const projectRoot = path.resolve(apiDir, "..");
const args = process.argv.slice(2);
const EXPECTED_API_VERSION = "stock-radar-api-v2.5.0";
const EXPECTED_PWA_VERSION = "stock-radar-pwa-v76";

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
  const sqlSource = read("stock-radar-api/sql/v25-daily-war-room.sql");
  const packageJson = JSON.parse(read("stock-radar-api/package.json"));
  const checks = [];

  checks.push(createCheck("版本", "API 版本為 V2.5.0", serverSource.includes(`const API_VERSION = "${EXPECTED_API_VERSION}"`), EXPECTED_API_VERSION));
  checks.push(createCheck("版本", "API 預期 PWA 版本為 v76", serverSource.includes(`const PWA_EXPECTED_VERSION = "${EXPECTED_PWA_VERSION}"`), EXPECTED_PWA_VERSION));
  checks.push(createCheck("版本", "service-worker 快取版本為 v76", serviceWorkerSource.includes(EXPECTED_PWA_VERSION), EXPECTED_PWA_VERSION));
  checks.push(createCheck("前端", "側邊功能選單顯示 V2.5", indexSource.includes("V2.5 每日投資作戰室"), "index.html"));

  const requiredScripts = [
    "war-room:setup",
    "war-room:generate",
    "war-room:daily",
    "v25:check",
    "v25:test",
    "v24:test",
    "portfolio:daily",
    "ai-feedback:daily",
    "trade:daily",
    "position:daily",
  ];

  for (const scriptName of requiredScripts) {
    checks.push(createCheck("npm 指令", scriptName, Boolean(packageJson.scripts?.[scriptName]), packageJson.scripts?.[scriptName] || "未找到"));
  }

  const requiredFiles = [
    "stock-radar-api/sql/v25-daily-war-room.sql",
    "stock-radar-api/scripts/setupDailyWarRoomTables.js",
    "stock-radar-api/scripts/generateDailyWarRoomReport.js",
    "stock-radar-api/scripts/checkV25.js",
    "stock-radar-api/scripts/runV25Acceptance.js",
    "stock-radar-api/server.js",
    "stock-radar-frontend/app.js",
    "stock-radar-frontend/style.css",
    "stock-radar-frontend/service-worker.js",
  ];

  for (const relativePath of requiredFiles) {
    checks.push(createCheck("必要檔案", relativePath, fileExists(relativePath), fileExists(relativePath) ? "存在" : "缺少"));
  }

  const sqlMarkers = [
    ["daily_war_room_reports 資料表", "CREATE TABLE IF NOT EXISTS `daily_war_room_reports`"],
    ["daily_war_room_items 資料表", "CREATE TABLE IF NOT EXISTS `daily_war_room_items`"],
    ["市場模式欄位", "market_mode"],
    ["LINE 訊息欄位", "line_message"],
    ["作戰項目類型", "section_type"],
  ];

  for (const [label, marker] of sqlMarkers) {
    checks.push(createCheck("SQL", label, sqlSource.includes(marker), marker));
  }

  const requiredRoutes = [
    ["get", "/health"],
    ["get", "/v25/status"],
    ["get", "/v25/acceptance"],
    ["get", "/war-room/latest"],
    ["get", "/war-room/history"],
    ["post", "/war-room/generate"],
  ];

  for (const [method, route] of requiredRoutes) {
    checks.push(createCheck("API 路由", `${method.toUpperCase()} ${route}`, hasRoute(serverSource, method, route), "server.js 靜態檢查"));
  }

  const frontendMarkers = [
    ["每日作戰室頁", "renderDailyWarRoomPage"],
    ["作戰室 API", "/war-room/latest"],
    ["產生作戰室 API", "/war-room/generate"],
    ["V2.5 文字", "V2.5 每日投資作戰室"],
    ["作戰室按鈕", "data-war-room-generate"],
  ];

  for (const [label, marker] of frontendMarkers) {
    checks.push(createCheck("前端", label, appSource.includes(marker) || indexSource.includes(marker) || styleSource.includes(marker), marker));
  }

  checks.push(createCheck("前端", "不再顯示 V1.4 系統狀態", !appSource.includes("V1.4 系統狀態") && !appSource.includes("V1.4 功能完成度") && !appSource.includes("重新檢查 V1.4"), "V2.5 status copy"));
  checks.push(createCheck("相容", "保留 V2.4 部位模擬", serverSource.includes('app.get("/portfolio/summary"') && serverSource.includes('app.get("/v24/status"'), "V2.4 routes"));
  checks.push(createCheck("相容", "保留 V2.3 AI 回饋學習", serverSource.includes('app.get("/ai-feedback/summary"') && serverSource.includes('app.get("/v23/status"'), "V2.3 routes"));
  checks.push(createCheck("相容", "保留 V2.2 交易績效", serverSource.includes('app.get("/trades"') && serverSource.includes('app.get("/performance/latest"'), "V2.2 routes"));
  checks.push(createCheck("相容", "保留 V2.1 持股風控", serverSource.includes('app.get("/positions"') && serverSource.includes('app.get("/position-risk/latest"'), "V2.1 routes"));
  checks.push(createCheck("相容", "保留 V2.0 AI 多因子", serverSource.includes('app.get("/ai-selection/top"') && serverSource.includes('app.get("/radar/top"'), "V2.0 routes"));

  if (apiBaseUrl) {
    console.log(`\n[API 動態檢查] ${apiBaseUrl}`);
    const apiChecks = [
      ["/health", `${apiBaseUrl}/health`, 200],
      ["/v25/status", `${apiBaseUrl}/v25/status`, 200],
      ["/v25/acceptance", `${apiBaseUrl}/v25/acceptance`, 200],
      ["/war-room/latest", `${apiBaseUrl}/war-room/latest`, 200],
      ["/war-room/history", `${apiBaseUrl}/war-room/history`, 200],
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
  console.log("Stock Radar V2.5 每日投資作戰室驗收檢查");
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
  console.error("V2.5 驗收檢查失敗：", error);
  process.exit(1);
});
