import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const apiDir = path.resolve(__dirname, "..");
const projectRoot = path.resolve(apiDir, "..");
const args = process.argv.slice(2);

function getArg(name) {
  const prefix = `--${name}=`;
  const found = args.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : "";
}

function readText(relativePath) {
  const fullPath = path.join(projectRoot, relativePath);
  return fs.existsSync(fullPath) ? fs.readFileSync(fullPath, "utf8") : "";
}

function fileExists(relativePath) {
  return fs.existsSync(path.join(projectRoot, relativePath));
}

function createCheck(group, label, ok, message) {
  return { status: ok ? "pass" : "fail", group, label, message };
}

function createWarn(group, label, ok, message) {
  return { status: ok ? "pass" : "warn", group, label, message };
}

function hasRoute(source, method, route) {
  return source.includes(`app.${method}("${route}"`) || source.includes(`app.${method}('${route}'`);
}

async function fetchJson(url) {
  const response = await fetch(url);
  let data = null;
  let text = "";
  try { data = await response.json(); } catch { text = await response.text().catch(() => ""); }
  return { status: response.status, ok: response.ok, data, text };
}

async function main() {
  const apiBaseUrl = getArg("api").replace(/\/$/, "");
  const checks = [];
  const serverSource = readText("stock-radar-api/server.js");
  const packageSource = readText("stock-radar-api/package.json");
  const sqlSource = readText("stock-radar-api/sql/v32-ai-daily-recommendations.sql");
  const appSource = readText("stock-radar-frontend/app.js");
  const indexSource = readText("stock-radar-frontend/index.html");
  const swSource = readText("stock-radar-frontend/service-worker.js");
  const styleSource = readText("stock-radar-frontend/style.css");

  checks.push(createCheck("版本", "API 版本為 V3.2.0", serverSource.includes('stock-radar-api-v3.2.0'), "stock-radar-api-v3.2.0"));
  checks.push(createCheck("版本", "API 預期 PWA 版本為 v79", serverSource.includes('stock-radar-pwa-v79'), "stock-radar-pwa-v79"));
  checks.push(createCheck("版本", "service-worker 快取版本為 v79", swSource.includes('stock-radar-pwa-v79'), "stock-radar-pwa-v79"));
  checks.push(createCheck("前端", "側邊功能選單顯示 V3.2", indexSource.includes("V3.2 AI 每日推薦引擎") || indexSource.includes("V3.2 AI每日推薦"), "index.html"));

  const scripts = [
    ["ai-recommendations:setup", "node scripts/setupAiDailyRecommendationsTables.js"],
    ["ai-recommendations:generate", "node scripts/generateAiDailyRecommendations.js"],
    ["ai-recommendations:daily", "npm run ai-recommendations:setup && npm run ai-recommendations:generate"],
    ["v32:check", "node scripts/checkV32.js"],
    ["v32:test", "node scripts/runV32Acceptance.js"],
    ["v31:test", "node scripts/runV31Acceptance.js"],
    ["pre-trade:daily", "npm run pre-trade:setup && npm run pre-trade:generate"],
  ];

  for (const [scriptName, marker] of scripts) {
    checks.push(createCheck("npm 指令", scriptName, packageSource.includes(`"${scriptName}"`) && packageSource.includes(marker), marker));
  }

  const requiredFiles = [
    "stock-radar-api/sql/v32-ai-daily-recommendations.sql",
    "stock-radar-api/scripts/setupAiDailyRecommendationsTables.js",
    "stock-radar-api/scripts/generateAiDailyRecommendations.js",
    "stock-radar-api/scripts/checkV32.js",
    "stock-radar-api/scripts/runV32Acceptance.js",
    "stock-radar-api/server.js",
    "stock-radar-frontend/app.js",
    "stock-radar-frontend/index.html",
    "stock-radar-frontend/style.css",
    "stock-radar-frontend/service-worker.js",
  ];

  for (const relativePath of requiredFiles) {
    checks.push(createCheck("必要檔案", relativePath, fileExists(relativePath), fileExists(relativePath) ? "存在" : "缺少"));
  }

  const sqlMarkers = [
    ["每日推薦主表", "CREATE TABLE IF NOT EXISTS `ai_daily_recommendations`"],
    ["推薦理由明細", "CREATE TABLE IF NOT EXISTS `ai_recommendation_reasons`"],
    ["因子分數明細", "CREATE TABLE IF NOT EXISTS `ai_recommendation_scores`"],
    ["推薦後績效", "CREATE TABLE IF NOT EXISTS `ai_recommendation_performance`"],
    ["推薦規則門檻", "CREATE TABLE IF NOT EXISTS `ai_recommendation_rules`"],
    ["人工確認安全邊界", "不自動送券商、不自動下單"],
  ];

  for (const [label, marker] of sqlMarkers) {
    checks.push(createCheck("SQL", label, sqlSource.includes(marker), marker));
  }

  const requiredRoutes = [
    ["get", "/health"],
    ["get", "/v32/status"],
    ["get", "/v32/acceptance"],
    ["get", "/ai-recommendations/today"],
    ["get", "/ai-recommendations/performance"],
    ["get", "/ai-recommendations/:tradeDate"],
    ["get", "/ai-recommendations/:tradeDate/:stockCode"],
    ["post", "/ai-recommendations/generate"],
  ];

  for (const [method, route] of requiredRoutes) {
    checks.push(createCheck("API 路由", `${method.toUpperCase()} ${route}`, hasRoute(serverSource, method, route), "server.js 靜態檢查"));
  }

  const frontendMarkers = [
    ["AI 每日推薦頁", "renderAiDailyRecommendationsPage"],
    ["今日推薦 API", "/ai-recommendations/today"],
    ["推薦績效 API", "/ai-recommendations/performance"],
    ["產生推薦 API", "/ai-recommendations/generate"],
    ["V3.2 文字", "V3.2 AI 每日推薦引擎"],
    ["AI 推薦按鈕", "data-ai-recommendations-generate"],
  ];

  for (const [label, marker] of frontendMarkers) {
    checks.push(createCheck("前端", label, appSource.includes(marker) || indexSource.includes(marker) || styleSource.includes(marker), marker));
  }

  checks.push(createCheck("安全邊界", "V3.2 不串券商、不自動下單", serverSource.includes("不串券商") && serverSource.includes("不自動下單") && serverSource.includes("manual_confirm_required"), "manual confirmation only"));
  checks.push(createCheck("推薦分類", "可買進 / 等拉回 / 觀察 / 禁買", serverSource.includes("可買進") && serverSource.includes("等拉回") && serverSource.includes("觀察") && serverSource.includes("禁買"), "classification labels"));
  checks.push(createCheck("相容", "保留 V3.1 半自動前置", serverSource.includes('app.get("/pre-trade/summary"') && serverSource.includes('app.get("/v31/status"'), "V3.1 routes"));
  checks.push(createCheck("相容", "保留 V3.0 交易輔助", serverSource.includes('app.get("/trade-assist/summary"') && serverSource.includes('app.get("/v30/status"'), "V3.0 routes"));
  checks.push(createCheck("相容", "保留 V2.0 AI 多因子", serverSource.includes('app.get("/ai-selection/top"') && serverSource.includes('app.get("/radar/top"'), "V2.0 routes"));

  if (apiBaseUrl) {
    console.log(`\n[API 動態檢查] ${apiBaseUrl}`);
    const apiChecks = [
      ["/health", `${apiBaseUrl}/health`, 200],
      ["/v32/status", `${apiBaseUrl}/v32/status`, 200],
      ["/v32/acceptance", `${apiBaseUrl}/v32/acceptance`, 200],
      ["/ai-recommendations/today", `${apiBaseUrl}/ai-recommendations/today`, 200],
      ["/ai-recommendations/performance", `${apiBaseUrl}/ai-recommendations/performance`, 200],
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
  console.log("Stock Radar V3.2 AI 每日推薦引擎驗收檢查");
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
  console.error("V3.2 驗收檢查失敗：", error);
  process.exit(1);
});
