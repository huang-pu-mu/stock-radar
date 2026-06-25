import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const apiDir = path.resolve(__dirname, "..");
const projectRoot = path.resolve(apiDir, "..");
const args = process.argv.slice(2);
const EXPECTED_API_VERSION = "stock-radar-api-v2.3.0";
const EXPECTED_PWA_VERSION = "stock-radar-pwa-v74";

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
  const sqlSource = read("stock-radar-api/sql/v23-ai-feedback-learning.sql");
  const packageJson = JSON.parse(read("stock-radar-api/package.json"));
  const checks = [];

  checks.push(createCheck("版本", "API 版本為 V2.3.0", serverSource.includes(`const API_VERSION = "${EXPECTED_API_VERSION}"`), EXPECTED_API_VERSION));
  checks.push(createCheck("版本", "API 預期 PWA 版本為 v74", serverSource.includes(`const PWA_EXPECTED_VERSION = "${EXPECTED_PWA_VERSION}"`), EXPECTED_PWA_VERSION));
  checks.push(createCheck("版本", "service-worker 快取版本為 v74", serviceWorkerSource.includes(EXPECTED_PWA_VERSION), EXPECTED_PWA_VERSION));
  checks.push(createCheck("前端", "側邊功能選單顯示 V2.3", indexSource.includes("V2.3 AI 推薦回饋學習"), "index.html"));

  const requiredScripts = [
    "ai-feedback:setup",
    "ai-feedback:generate",
    "ai-feedback:daily",
    "v23:check",
    "v23:test",
    "v22:test",
    "trade:daily",
    "ai-selection:daily",
  ];

  for (const scriptName of requiredScripts) {
    checks.push(createCheck("npm 指令", scriptName, Boolean(packageJson.scripts?.[scriptName]), packageJson.scripts?.[scriptName] || "未找到"));
  }

  const requiredFiles = [
    "stock-radar-api/sql/v23-ai-feedback-learning.sql",
    "stock-radar-api/scripts/setupAiFeedbackLearningTables.js",
    "stock-radar-api/scripts/generateAiFeedbackLearning.js",
    "stock-radar-api/scripts/checkV23.js",
    "stock-radar-api/scripts/runV23Acceptance.js",
    "stock-radar-api/server.js",
    "stock-radar-frontend/app.js",
    "stock-radar-frontend/style.css",
    "stock-radar-frontend/service-worker.js",
  ];

  for (const relativePath of requiredFiles) {
    checks.push(createCheck("必要檔案", relativePath, fileExists(relativePath), fileExists(relativePath) ? "存在" : "缺少"));
  }

  const sqlMarkers = [
    ["ai_recommendation_feedbacks 資料表", "CREATE TABLE IF NOT EXISTS `ai_recommendation_feedbacks`"],
    ["ai_factor_performance_snapshots 資料表", "CREATE TABLE IF NOT EXISTS `ai_factor_performance_snapshots`"],
    ["ai_factor_weight_suggestions 資料表", "CREATE TABLE IF NOT EXISTS `ai_factor_weight_suggestions`"],
    ["推薦結果欄位", "feedback_result"],
    ["權重建議欄位", "suggestion_action"],
  ];

  for (const [label, marker] of sqlMarkers) {
    checks.push(createCheck("SQL", label, sqlSource.includes(marker), marker));
  }

  const requiredRoutes = [
    ["get", "/health"],
    ["get", "/v23/status"],
    ["get", "/v23/acceptance"],
    ["get", "/ai-feedback/summary"],
    ["get", "/ai-feedback/factors"],
    ["get", "/ai-feedback/weights"],
    ["post", "/ai-feedback/generate"],
    ["get", "/ai-selection/top"],
  ];

  for (const [method, route] of requiredRoutes) {
    checks.push(createCheck("API 路由", `${method.toUpperCase()} ${route}`, hasRoute(serverSource, method, route), "server.js 靜態檢查"));
  }

  const frontendMarkers = [
    ["AI 回饋學習頁", "renderAiFeedbackPage"],
    ["AI 回饋 API", "/ai-feedback/summary"],
    ["因子績效 API", "/ai-feedback/factors"],
    ["權重建議 API", "/ai-feedback/weights"],
    ["V2.3 文字", "V2.3 AI 推薦回饋學習"],
  ];

  for (const [label, marker] of frontendMarkers) {
    checks.push(createCheck("前端", label, appSource.includes(marker) || indexSource.includes(marker) || styleSource.includes(marker), marker));
  }

  checks.push(createCheck("前端", "不再顯示 V1.4 系統狀態", !appSource.includes("V1.4 系統狀態") && !appSource.includes("V1.4 功能完成度") && !appSource.includes("重新檢查 V1.4"), "V2.3 status copy"));
  checks.push(createCheck("相容", "保留 V2.2 交易績效", serverSource.includes('app.get("/trades"') && serverSource.includes('app.get("/performance/latest"'), "V2.2 routes"));
  checks.push(createCheck("相容", "保留 V2.1 持股風控", serverSource.includes('app.get("/positions"') && serverSource.includes('app.get("/position-risk/latest"'), "V2.1 routes"));
  checks.push(createCheck("相容", "保留 V2.0 AI 多因子", serverSource.includes('app.get("/ai-selection/top"') && serverSource.includes('app.get("/radar/top"'), "V2.0 routes"));

  if (apiBaseUrl) {
    console.log(`\n[API 動態檢查] ${apiBaseUrl}`);
    const apiChecks = [
      ["/health", `${apiBaseUrl}/health`, 200],
      ["/v23/status", `${apiBaseUrl}/v23/status`, 200],
      ["/v23/acceptance", `${apiBaseUrl}/v23/acceptance`, 200],
      ["/ai-feedback/summary", `${apiBaseUrl}/ai-feedback/summary`, 200],
      ["/ai-feedback/factors", `${apiBaseUrl}/ai-feedback/factors`, 200],
      ["/ai-feedback/weights", `${apiBaseUrl}/ai-feedback/weights`, 200],
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
  console.log("Stock Radar V2.3 AI 推薦回饋學習驗收檢查");
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
  console.error("V2.3 驗收檢查失敗：", error);
  process.exit(1);
});
