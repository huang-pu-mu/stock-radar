import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const apiDir = path.resolve(__dirname, "..");
const projectRoot = path.resolve(apiDir, "..");
const args = process.argv.slice(2);
const EXPECTED_API_VERSION = "stock-radar-api-v2.4.0";
const EXPECTED_PWA_VERSION = "stock-radar-pwa-v75";

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
  const sqlSource = read("stock-radar-api/sql/v24-portfolio-risk.sql");
  const packageJson = JSON.parse(read("stock-radar-api/package.json"));
  const checks = [];

  checks.push(createCheck("版本", "API 版本為 V2.4.0", serverSource.includes(`const API_VERSION = "${EXPECTED_API_VERSION}"`), EXPECTED_API_VERSION));
  checks.push(createCheck("版本", "API 預期 PWA 版本為 v75", serverSource.includes(`const PWA_EXPECTED_VERSION = "${EXPECTED_PWA_VERSION}"`), EXPECTED_PWA_VERSION));
  checks.push(createCheck("版本", "service-worker 快取版本為 v75", serviceWorkerSource.includes(EXPECTED_PWA_VERSION), EXPECTED_PWA_VERSION));
  checks.push(createCheck("前端", "側邊功能選單顯示 V2.4", indexSource.includes("V2.4 部位模擬與風險觀察"), "index.html"));

  const requiredScripts = [
    "portfolio:setup",
    "portfolio:risk",
    "portfolio:daily",
    "v24:check",
    "v24:test",
    "v23:test",
    "ai-feedback:daily",
    "trade:daily",
    "position:daily",
  ];

  for (const scriptName of requiredScripts) {
    checks.push(createCheck("npm 指令", scriptName, Boolean(packageJson.scripts?.[scriptName]), packageJson.scripts?.[scriptName] || "未找到"));
  }

  const requiredFiles = [
    "stock-radar-api/sql/v24-portfolio-risk.sql",
    "stock-radar-api/scripts/setupPortfolioRiskTables.js",
    "stock-radar-api/scripts/generatePortfolioRiskSnapshots.js",
    "stock-radar-api/scripts/checkV24.js",
    "stock-radar-api/scripts/runV24Acceptance.js",
    "stock-radar-api/server.js",
    "stock-radar-frontend/app.js",
    "stock-radar-frontend/style.css",
    "stock-radar-frontend/service-worker.js",
  ];

  for (const relativePath of requiredFiles) {
    checks.push(createCheck("必要檔案", relativePath, fileExists(relativePath), fileExists(relativePath) ? "存在" : "缺少"));
  }

  const sqlMarkers = [
    ["portfolio_plans 資料表", "CREATE TABLE IF NOT EXISTS `portfolio_plans`"],
    ["portfolio_plan_positions 資料表", "CREATE TABLE IF NOT EXISTS `portfolio_plan_positions`"],
    ["portfolio_risk_snapshots 資料表", "CREATE TABLE IF NOT EXISTS `portfolio_risk_snapshots`"],
    ["部位比例欄位", "position_ratio_pct"],
    ["現金比例欄位", "cash_ratio_pct"],
    ["風險曝險欄位", "risk_exposure_pct"],
  ];

  for (const [label, marker] of sqlMarkers) {
    checks.push(createCheck("SQL", label, sqlSource.includes(marker), marker));
  }

  const requiredRoutes = [
    ["get", "/health"],
    ["get", "/v24/status"],
    ["get", "/v24/acceptance"],
    ["get", "/portfolio/summary"],
    ["get", "/portfolio/plans"],
    ["post", "/portfolio/plans"],
    ["put", "/portfolio/plans/:id"],
    ["delete", "/portfolio/plans/:id"],
    ["get", "/portfolio/risk/latest"],
    ["get", "/portfolio/risk/history"],
    ["post", "/portfolio/risk/generate"],
  ];

  for (const [method, route] of requiredRoutes) {
    checks.push(createCheck("API 路由", `${method.toUpperCase()} ${route}`, hasRoute(serverSource, method, route), "server.js 靜態檢查"));
  }

  const frontendMarkers = [
    ["部位模擬頁", "renderPortfolioRiskPage"],
    ["部位總覽 API", "/portfolio/summary"],
    ["部位計畫 API", "/portfolio/plans"],
    ["部位風險 API", "/portfolio/risk/latest"],
    ["V2.4 文字", "V2.4 部位模擬與風險觀察"],
  ];

  for (const [label, marker] of frontendMarkers) {
    checks.push(createCheck("前端", label, appSource.includes(marker) || indexSource.includes(marker) || styleSource.includes(marker), marker));
  }

  checks.push(createCheck("前端", "不再顯示 V1.4 系統狀態", !appSource.includes("V1.4 系統狀態") && !appSource.includes("V1.4 功能完成度") && !appSource.includes("重新檢查 V1.4"), "V2.4 status copy"));
  checks.push(createCheck("相容", "保留 V2.3 AI 回饋學習", serverSource.includes('app.get("/ai-feedback/summary"') && serverSource.includes('app.get("/v23/status"'), "V2.3 routes"));
  checks.push(createCheck("相容", "保留 V2.2 交易績效", serverSource.includes('app.get("/trades"') && serverSource.includes('app.get("/performance/latest"'), "V2.2 routes"));
  checks.push(createCheck("相容", "保留 V2.1 持股風控", serverSource.includes('app.get("/positions"') && serverSource.includes('app.get("/position-risk/latest"'), "V2.1 routes"));
  checks.push(createCheck("相容", "保留 V2.0 AI 多因子", serverSource.includes('app.get("/ai-selection/top"') && serverSource.includes('app.get("/radar/top"'), "V2.0 routes"));

  if (apiBaseUrl) {
    console.log(`\n[API 動態檢查] ${apiBaseUrl}`);
    const apiChecks = [
      ["/health", `${apiBaseUrl}/health`, 200],
      ["/v24/status", `${apiBaseUrl}/v24/status`, 200],
      ["/v24/acceptance", `${apiBaseUrl}/v24/acceptance`, 200],
      ["/portfolio/summary 需登入保護", `${apiBaseUrl}/portfolio/summary`, 401],
      ["/portfolio/plans 需登入保護", `${apiBaseUrl}/portfolio/plans`, 401],
      ["/portfolio/risk/latest 需登入保護", `${apiBaseUrl}/portfolio/risk/latest`, 401],
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
  console.log("Stock Radar V2.4 部位模擬與風險觀察驗收檢查");
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
  console.error("V2.4 驗收檢查失敗：", error);
  process.exit(1);
});
