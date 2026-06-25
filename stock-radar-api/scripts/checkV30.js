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
  try {
    data = await response.json();
  } catch {
    text = await response.text().catch(() => "");
  }
  return { status: response.status, ok: response.ok, data, text };
}

async function main() {
  const apiBaseUrl = getArg("api").replace(/\/$/, "");
  const checks = [];
  const serverSource = readText("stock-radar-api/server.js");
  const packageSource = readText("stock-radar-api/package.json");
  const sqlSource = readText("stock-radar-api/sql/v30-trading-assistant.sql");
  const appSource = readText("stock-radar-frontend/app.js");
  const indexSource = readText("stock-radar-frontend/index.html");
  const swSource = readText("stock-radar-frontend/service-worker.js");
  const styleSource = readText("stock-radar-frontend/style.css");

  checks.push(createCheck("版本", "API 版本為 V3.0.0", serverSource.includes('stock-radar-api-v3.0.0'), "stock-radar-api-v3.0.0"));
  checks.push(createCheck("版本", "API 預期 PWA 版本為 v77", serverSource.includes('stock-radar-pwa-v77'), "stock-radar-pwa-v77"));
  checks.push(createCheck("版本", "service-worker 快取版本為 v77", swSource.includes('stock-radar-pwa-v77'), "stock-radar-pwa-v77"));
  checks.push(createCheck("前端", "側邊功能選單顯示 V3.0", indexSource.includes("V3.0 實戰交易輔助系統"), "index.html"));

  const scripts = [
    ["trading-assist:setup", "node scripts/setupTradingAssistantTables.js"],
    ["trading-assist:generate", "node scripts/generateTradingAssistantPlans.js"],
    ["trading-assist:daily", "npm run trading-assist:setup && npm run trading-assist:generate"],
    ["v30:check", "node scripts/checkV30.js"],
    ["v30:test", "node scripts/runV30Acceptance.js"],
    ["v25:test", "node scripts/runV25Acceptance.js"],
    ["war-room:daily", "npm run war-room:setup && npm run war-room:generate"],
  ];

  for (const [scriptName, marker] of scripts) {
    checks.push(createCheck("npm 指令", scriptName, packageSource.includes(`"${scriptName}"`) && packageSource.includes(marker), marker));
  }

  const requiredFiles = [
    "stock-radar-api/sql/v30-trading-assistant.sql",
    "stock-radar-api/scripts/setupTradingAssistantTables.js",
    "stock-radar-api/scripts/generateTradingAssistantPlans.js",
    "stock-radar-api/scripts/checkV30.js",
    "stock-radar-api/scripts/runV30Acceptance.js",
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
    ["交易輔助帳戶資料表", "CREATE TABLE IF NOT EXISTS `trading_assistant_accounts`"],
    ["交易計畫資料表", "CREATE TABLE IF NOT EXISTS `trading_plans`"],
    ["模擬下單草稿資料表", "CREATE TABLE IF NOT EXISTS `trading_plan_orders`"],
    ["交易輔助建議資料表", "CREATE TABLE IF NOT EXISTS `trading_assistant_recommendations`"],
    ["交易輔助報告資料表", "CREATE TABLE IF NOT EXISTS `trading_assistant_reports`"],
    ["人工確認欄位", "manual_confirm_required"],
    ["不自動下單定位", "不自動送券商"],
  ];

  for (const [label, marker] of sqlMarkers) {
    checks.push(createCheck("SQL", label, sqlSource.includes(marker), marker));
  }

  const requiredRoutes = [
    ["get", "/health"],
    ["get", "/v30/status"],
    ["get", "/v30/acceptance"],
    ["get", "/trade-assist/summary"],
    ["get", "/trade-assist/recommendations"],
    ["post", "/trade-assist/generate"],
    ["get", "/trade-assist/plans"],
    ["post", "/trade-assist/plans"],
    ["put", "/trade-assist/plans/:id"],
    ["delete", "/trade-assist/plans/:id"],
  ];

  for (const [method, route] of requiredRoutes) {
    checks.push(createCheck("API 路由", `${method.toUpperCase()} ${route}`, hasRoute(serverSource, method, route), "server.js 靜態檢查"));
  }

  const frontendMarkers = [
    ["交易輔助頁", "renderTradingAssistPage"],
    ["交易輔助 API", "/trade-assist/summary"],
    ["交易輔助建議 API", "/trade-assist/recommendations"],
    ["產生交易輔助 API", "/trade-assist/generate"],
    ["V3.0 文字", "V3.0 實戰交易輔助系統"],
    ["交易輔助按鈕", "data-trading-assist-generate"],
  ];

  for (const [label, marker] of frontendMarkers) {
    checks.push(createCheck("前端", label, appSource.includes(marker) || indexSource.includes(marker) || styleSource.includes(marker), marker));
  }

  checks.push(createCheck("前端", "不再顯示 V1.4 系統狀態", !appSource.includes("V1.4 系統狀態") && !appSource.includes("V1.4 功能完成度") && !appSource.includes("重新檢查 V1.4"), "V3.0 status copy"));
  checks.push(createCheck("安全邊界", "V3.0 不自動下單", serverSource.includes("不會自動下單") || sqlSource.includes("不自動下單"), "manual confirmation only"));
  checks.push(createCheck("相容", "保留 V2.5 每日作戰室", serverSource.includes('app.get("/war-room/latest"') && serverSource.includes('app.get("/v25/status"'), "V2.5 routes"));
  checks.push(createCheck("相容", "保留 V2.4 部位模擬", serverSource.includes('app.get("/portfolio/summary"') && serverSource.includes('app.get("/v24/status"'), "V2.4 routes"));
  checks.push(createCheck("相容", "保留 V2.3 AI 回饋學習", serverSource.includes('app.get("/ai-feedback/summary"') && serverSource.includes('app.get("/v23/status"'), "V2.3 routes"));
  checks.push(createCheck("相容", "保留 V2.2 交易績效", serverSource.includes('app.get("/trades"') && serverSource.includes('app.get("/performance/latest"'), "V2.2 routes"));
  checks.push(createCheck("相容", "保留 V2.1 持股風控", serverSource.includes('app.get("/positions"') && serverSource.includes('app.get("/position-risk/latest"'), "V2.1 routes"));
  checks.push(createCheck("相容", "保留 V2.0 AI 多因子", serverSource.includes('app.get("/ai-selection/top"') && serverSource.includes('app.get("/radar/top"'), "V2.0 routes"));

  if (apiBaseUrl) {
    console.log(`\n[API 動態檢查] ${apiBaseUrl}`);
    const apiChecks = [
      ["/health", `${apiBaseUrl}/health`, 200],
      ["/v30/status", `${apiBaseUrl}/v30/status`, 200],
      ["/v30/acceptance", `${apiBaseUrl}/v30/acceptance`, 200],
      ["/trade-assist/summary", `${apiBaseUrl}/trade-assist/summary`, 200],
      ["/trade-assist/recommendations", `${apiBaseUrl}/trade-assist/recommendations`, 200],
      ["/trade-assist/plans 登入保護", `${apiBaseUrl}/trade-assist/plans`, 401],
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
  console.log("Stock Radar V3.0 實戰交易輔助系統驗收檢查");
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
  console.error("V3.0 驗收檢查失敗：", error);
  process.exit(1);
});
