import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const apiDir = path.resolve(__dirname, "..");
const projectRoot = path.resolve(apiDir, "..");
const EXPECTED_API_VERSION = "stock-radar-api-v1.8.0";
const EXPECTED_PWA_VERSION = "stock-radar-pwa-v64";

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
  const sqlSource = readText("stock-radar-api/sql/v18-main-force-engine.sql");

  let packageJson = {};
  try { packageJson = JSON.parse(packageJsonText); } catch {}

  checks.push(createCheck("版本", "API 版本為 V1.8.0", serverSource.includes(EXPECTED_API_VERSION), EXPECTED_API_VERSION));
  checks.push(createCheck("版本", "API 預期 PWA 版本為 v64", serverSource.includes(EXPECTED_PWA_VERSION), EXPECTED_PWA_VERSION));
  checks.push(createCheck("版本", "service-worker 快取版本為 v64", serviceWorkerSource.includes(EXPECTED_PWA_VERSION), EXPECTED_PWA_VERSION));

  const requiredScripts = [
    "main-force:setup",
    "main-force:generate",
    "main-force:daily",
    "v18:check",
    "v18:test",
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
    "stock-radar-api/sql/v18-main-force-engine.sql",
    "stock-radar-api/scripts/setupMainForceEngineTables.js",
    "stock-radar-api/scripts/generateMainForceSignals.js",
    "stock-radar-api/scripts/checkV18.js",
    "stock-radar-api/scripts/runV18Acceptance.js",
    "stock-radar-api/server.js",
    "stock-radar-frontend/app.js",
    "stock-radar-frontend/style.css",
    "stock-radar-frontend/service-worker.js",
  ];

  for (const relativePath of requiredFiles) {
    checks.push(createCheck("必要檔案", relativePath, fileExists(relativePath), fileExists(relativePath) ? "存在" : "缺少"));
  }

  checks.push(createCheck("SQL", "main_force_signals 資料表", sqlSource.includes("CREATE TABLE IF NOT EXISTS `main_force_signals`"), "v18-main-force-engine.sql"));
  checks.push(createCheck("SQL", "main_force_summaries 資料表", sqlSource.includes("CREATE TABLE IF NOT EXISTS `main_force_summaries`"), "v18-main-force-engine.sql"));
  checks.push(createCheck("SQL", "Main Force Score 欄位", sqlSource.includes("main_force_score"), "main_force_score"));
  checks.push(createCheck("SQL", "估算主力成本欄位", sqlSource.includes("estimated_main_force_cost"), "estimated_main_force_cost"));
  checks.push(createCheck("SQL", "出貨風險欄位", sqlSource.includes("distribution_risk"), "distribution_risk"));

  const requiredRoutes = [
    ["get", "/health"],
    ["get", "/v18/status"],
    ["get", "/v18/acceptance"],
    ["get", "/main-force/latest"],
    ["get", "/main-force/top"],
    ["get", "/radar/top"],
  ];

  for (const [method, route] of requiredRoutes) {
    checks.push(createCheck("API 路由", `${method.toUpperCase()} ${route}`, hasRoute(serverSource, method, route), "server.js 靜態檢查"));
  }

  const frontendMarkers = [
    ["主力籌碼狀態卡", "renderMainForcePanel"],
    ["首頁讀取 /main-force/latest", "/main-force/latest"],
    ["股票卡顯示主力分數", "主力分數"],
    ["股票卡顯示估算成本", "估算成本"],
    ["V1.8 狀態檢查", "/v18/status"],
  ];

  for (const [label, marker] of frontendMarkers) {
    checks.push(createCheck("前端", label, appSource.includes(marker) || indexSource.includes(marker) || styleSource.includes(marker), marker));
  }

  if (apiBaseUrl) {
    console.log(`\n[API 動態檢查] ${apiBaseUrl}`);
    const apiChecks = [
      ["/health", `${apiBaseUrl}/health`],
      ["/v18/status", `${apiBaseUrl}/v18/status`],
      ["/v18/acceptance", `${apiBaseUrl}/v18/acceptance`],
      ["/main-force/latest", `${apiBaseUrl}/main-force/latest`],
      ["/main-force/top", `${apiBaseUrl}/main-force/top?limit=5`],
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
  console.log("Stock Radar V1.8 靜態 / API 驗收檢查");
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
  console.error("V1.8 驗收檢查失敗：", error);
  process.exit(1);
});
