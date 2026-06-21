import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const apiDir = path.resolve(__dirname, "..");
const projectRoot = path.resolve(apiDir, "..");
const frontendDir = path.join(projectRoot, "stock-radar-frontend");

const EXPECTED_API_VERSION = "stock-radar-api-v1.4.8.3";
const EXPECTED_PWA_VERSION = "stock-radar-pwa-v57";

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
  return {
    group,
    label,
    status: ok ? "pass" : "fail",
    message,
  };
}

function createWarn(group, label, ok, message = "") {
  return {
    group,
    label,
    status: ok ? "pass" : "warn",
    message,
  };
}

function hasRoute(serverSource, method, route) {
  const normalized = route.replace(/\//g, "\\/");
  const pattern = new RegExp(`app\\.${method}\\([\\"']${normalized}[\\"']`);
  return pattern.test(serverSource);
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
  });
  const text = await response.text();
  try {
    return {
      ok: response.ok,
      status: response.status,
      data: JSON.parse(text),
    };
  } catch {
    return {
      ok: response.ok,
      status: response.status,
      data: null,
      text: text.slice(0, 300),
    };
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

  let packageJson = {};
  try {
    packageJson = JSON.parse(packageJsonText);
  } catch {
    packageJson = {};
  }

  checks.push(createCheck("版本", "API 版本為 V1.4.8.3", serverSource.includes(EXPECTED_API_VERSION), EXPECTED_API_VERSION));
  checks.push(createCheck("版本", "API 預期 PWA 版本為 v57", serverSource.includes(EXPECTED_PWA_VERSION), EXPECTED_PWA_VERSION));
  checks.push(createCheck("版本", "service-worker 快取版本為 v57", serviceWorkerSource.includes(EXPECTED_PWA_VERSION), EXPECTED_PWA_VERSION));

  const requiredScripts = [
    "alerts:setup",
    "alerts:generate",
    "strategy-watchlists:setup",
    "strategy-backtests:setup",
    "strategy-backtests:generate",
    "strategy-params:setup",
    "notifications:setup",
    "v13:check",
    "v14:check",
  ];

  for (const scriptName of requiredScripts) {
    checks.push(createCheck("npm 指令", scriptName, Boolean(packageJson.scripts?.[scriptName]), packageJson.scripts?.[scriptName] || "未找到"));
  }

  const requiredFiles = [
    "stock-radar-api/sql/watchlist-alerts.sql",
    "stock-radar-api/sql/strategy-watchlists.sql",
    "stock-radar-api/sql/strategy-backtests.sql",
    "stock-radar-api/sql/strategy-parameter-presets.sql",
    "stock-radar-api/scripts/setupWatchlistAlerts.js",
    "stock-radar-api/scripts/generateWatchlistAlerts.js",
    "stock-radar-api/scripts/setupStrategyWatchlists.js",
    "stock-radar-api/scripts/setupStrategyBacktests.js",
    "stock-radar-api/scripts/generateStrategyBacktests.js",
    "stock-radar-api/scripts/setupStrategyParameterPresets.js",
    "stock-radar-api/sql/notification-channels.sql",
    "stock-radar-api/scripts/setupNotificationChannels.js",
    "stock-radar-api/scripts/checkV13.js",
    "stock-radar-frontend/index.html",
    "stock-radar-frontend/app.js",
    "stock-radar-frontend/style.css",
    "stock-radar-frontend/service-worker.js",
  ];

  for (const relativePath of requiredFiles) {
    checks.push(createCheck("必要檔案", relativePath, fileExists(relativePath), fileExists(relativePath) ? "存在" : "缺少"));
  }

  const requiredRoutes = [
    ["get", "/health"],
    ["get", "/v13/status"],
    ["get", "/v13/acceptance"],
    ["get", "/v14/status"],
    ["get", "/v14/acceptance"],
    ["get", "/watchlist/alerts"],
    ["get", "/watchlist/alerts/unread-count"],
    ["post", "/watchlist/alerts/generate"],
    ["get", "/watchlist/rules"],
    ["post", "/watchlist/rules"],
    ["get", "/strategies"],
    ["get", "/strategies/definitions"],
    ["get", "/strategy-optimization/presets"],
    ["get", "/strategy-optimization/backtest-comparison"],
    ["get", "/strategy-watchlist"],
    ["get", "/strategy-watchlist/performance"],
    ["get", "/strategy-watchlist/rankings"],
    ["patch", "/strategy-watchlist/:trackId/risk-settings"],
    ["get", "/strategy-backtests/runs"],
    ["get", "/strategy-backtests/runs/:runId"],
    ["get", "/strategy-backtests/results"],
    ["get", "/strategy-backtests/summary"],
    ["get", "/strategy-backtests/rankings"],
    ["get", "/strategy-backtests/trends"],
    ["get", "/strategy-backtests/stock-history"],
    ["get", "/notification/channels"],
    ["post", "/notification/channels/line"],
    ["patch", "/notification/channels/:channelId"],
    ["delete", "/notification/channels/:channelId"],
    ["post", "/notification/channels/:channelId/test"],
    ["get", "/strategy-daily-report"],
    ["post", "/strategy-daily-report/send-line"],
  ];

  for (const [method, route] of requiredRoutes) {
    checks.push(createCheck("API 路由", `${method.toUpperCase()} ${route}`, hasRoute(serverSource, method, route), "server.js 靜態檢查"));
  }

  const requiredFrontendMarkers = [
    ["提醒頁籤", 'data-page="alerts"'],
    ["策略選股頁籤", 'data-page="strategies"'],
    ["策略追蹤頁籤", 'data-page="strategyTracks"'],
    ["策略回測頁籤", 'data-page="strategyBacktests"'],
    ["策略最佳化頁籤", 'data-page="strategyOptimize"'],
    ["通知外送頁籤", 'data-page="notifications"'],
    ["每日報告頁籤", 'data-page="strategyReports"'],
    ["策略勝率趨勢頁籤", 'data-page="strategyTrends"'],
    ["個股策略歷史頁籤", 'data-page="strategyStockHistory"'],
    ["我的頁頁籤", 'data-page="account"'],
    ["V1.4 狀態 API", 'fetchJson("/v14/status"'],
    ["策略回測 API", 'strategy-backtests'],
    ["策略最佳化 API", 'strategy-optimization'],
    ["策略最佳化回測比較 API", 'strategy-optimization/backtest-comparison'],
    ["策略追蹤停利停損", 'risk-settings'],
    ["通知外送 API", 'notification/channels'],
    ["每日策略報告 API", 'strategy-daily-report'],
    ["策略勝率趨勢 API", 'strategy-backtests/trends'],
    ["個股策略歷史 API", 'strategy-backtests/stock-history'],
    ["V1.4 狀態 API", 'fetchJson("/v14/status"'],
    ["V1.4 狀態刷新", 'data-refresh-v14-status'],
  ];

  for (const [label, marker] of requiredFrontendMarkers) {
    const source = marker.startsWith("data-page") ? indexSource : appSource;
    checks.push(createCheck("前端功能", label, source.includes(marker), marker));
  }

  const v14UiMarkers = [
    ["桌機左側功能列 HTML", indexSource.includes("desktop-sidebar") && indexSource.includes("side-nav-group")],
    ["手機底部主導航 HTML", indexSource.includes("mobile-bottom-nav") && indexSource.includes("data-mobile-nav-group")],
    ["手機頁內次功能切換 HTML", indexSource.includes("mobile-section-nav") && indexSource.includes("data-mobile-subnav-group")],
    ["導航群組狀態 JS", appSource.includes("PAGE_GROUP_MAP") && appSource.includes("updateNavigationState")],
    ["多位置提醒徽章 JS", appSource.includes("alertsTabBadges") && appSource.includes("renderAlertsBadgeCount")],
    ["左側功能列 CSS", styleSource.includes(".desktop-sidebar") && styleSource.includes(".side-nav-btn")],
    ["底部主導航 CSS", styleSource.includes(".mobile-bottom-nav") && styleSource.includes(".mobile-bottom-btn")],
    ["手機頁內次功能 CSS", styleSource.includes(".mobile-section-nav") && styleSource.includes(".mobile-subnav-btn")],
    ["右側內容區頁首摘要 HTML", indexSource.includes("pageMetaBar") && indexSource.includes("contentFilterShell")],
    ["右側統計摘要 HTML", indexSource.includes("contentSummaryBar") && indexSource.includes("resultHeader")],
    ["右側內容區摘要 JS", appSource.includes("updateListOverview") && appSource.includes("setContentSummary") && appSource.includes("setResultHeader")],
    ["右側內容區版面 CSS", styleSource.includes(".content-summary-bar") && styleSource.includes(".result-header-card") && styleSource.includes(".summary-metric-grid")],
    ["策略最佳化頁面 HTML", indexSource.includes('data-page="strategyOptimize"')],
    ["策略最佳化前端 JS", appSource.includes("renderStrategyOptimizationPage") && appSource.includes("buildStrategyOptimizationQueryString")],
    ["策略最佳化樣式 CSS", styleSource.includes(".strategy-optimization-card") && styleSource.includes(".strategy-optimization-param-grid")],
    ["策略最佳化 API 參數", serverSource.includes("STRATEGY_OPTIMIZATION_PRESETS") && serverSource.includes("applyStrategyOptimizationParams")],
    ["策略最佳化回測比較 API", serverSource.includes("buildStrategyOptimizationBacktestComparison") && serverSource.includes('app.get("/strategy-optimization/backtest-comparison"')],
    ["策略最佳化回測比較前端", appSource.includes("renderStrategyOptimizationComparison") && appSource.includes("strategyOptimizationComparison")],
    ["策略最佳化回測比較樣式", styleSource.includes(".strategy-optimization-comparison-card") && styleSource.includes(".optimization-preset-compare-grid")],
    ["回測條件調整 CLI", readText("stock-radar-api/scripts/generateStrategyBacktests.js").includes("parseStrategyOptimizationParamsFromArgs") && readText("stock-radar-api/scripts/generateStrategyBacktests.js").includes("applyStrategyOptimizationParams")],
    ["回測條件調整前端", appSource.includes("renderStrategyBacktestConditionPanel") && appSource.includes("buildStrategyBacktestGenerateCommand")],
    ["回測條件調整樣式", styleSource.includes(".strategy-backtest-condition-card") && styleSource.includes(".backtest-command-box")],
    ["LINE 通知 SQL", readText("stock-radar-api/sql/notification-channels.sql").includes("notification_channels") && readText("stock-radar-api/sql/notification-channels.sql").includes("notification_send_logs")],
    ["LINE 通知設定腳本", readText("stock-radar-api/scripts/setupNotificationChannels.js").includes("notification-channels.sql")],
    ["LINE 通知 API", serverSource.includes("sendLinePushMessage") && serverSource.includes("LINE_CHANNEL_ACCESS_TOKEN")],
    ["LINE 通知前端", appSource.includes("renderNotificationSettingsPage") && appSource.includes("data-line-notification-form")],
    ["LINE 通知樣式", styleSource.includes(".line-notification-form") && styleSource.includes(".notification-channel-card")],
    ["每日策略報告 API", serverSource.includes("buildDailyStrategyReport") && serverSource.includes('app.get("/strategy-daily-report"') && serverSource.includes('app.post("/strategy-daily-report/send-line"')],
    ["每日策略報告前端", appSource.includes("renderStrategyDailyReportPage") && appSource.includes("data-strategy-daily-report-form") && appSource.includes("data-strategy-daily-report-send-line")],
    ["每日策略報告頁籤", indexSource.includes('data-page="strategyReports"') && indexSource.includes("每日報告")],
    ["每日策略報告樣式", styleSource.includes(".daily-report-strategy-grid") && styleSource.includes(".daily-report-line-preview")],
    ["策略勝率趨勢 API", serverSource.includes("buildBacktestWinRateTrend") && serverSource.includes('app.get("/strategy-backtests/trends"')],
    ["策略勝率趨勢前端", appSource.includes("renderStrategyWinRateTrendPage") && appSource.includes("data-strategy-trend-form")],
    ["策略勝率趨勢頁籤", indexSource.includes('data-page="strategyTrends"') && indexSource.includes("勝率趨勢")],
    ["策略勝率趨勢樣式", styleSource.includes(".strategy-trend-run-grid") && styleSource.includes(".strategy-trend-mini-chart")],
    ["個股策略歷史 API", serverSource.includes("buildStockStrategyHistory") && serverSource.includes('app.get("/strategy-backtests/stock-history"')],
    ["個股策略歷史前端", appSource.includes("renderStrategyStockHistoryPage") && appSource.includes("data-strategy-stock-history-form")],
    ["個股策略歷史頁籤", indexSource.includes('data-page="strategyStockHistory"') && indexSource.includes("個股歷史")],
    ["個股策略歷史樣式", styleSource.includes(".strategy-stock-history-form") && styleSource.includes(".strategy-stock-history-card")],
    ["V1.4 狀態 API", serverSource.includes('app.get("/v14/status"') && serverSource.includes('app.get("/v14/acceptance"')],
    ["V1.4 狀態前端", appSource.includes('fetchJson("/v14/status"') && appSource.includes("renderV14ModuleProgress") && appSource.includes("data-refresh-v14-status")],
    ["V1.4 狀態樣式", styleSource.includes(".v14-module-grid") && styleSource.includes(".v14-progress-track")],
  ];

  for (const [label, ok] of v14UiMarkers) {
    checks.push(createCheck("V1.4 UI", label, ok, ok ? "存在" : "缺少"));
  }

  checks.push(createWarn("前端樣式", "V1.4 狀態卡片樣式", styleSource.includes("v13-status-card"), "style.css 應包含 v13-status-card / v14-status-card"));
  checks.push(createWarn("前端樣式", "策略回測排行榜樣式", styleSource.includes("backtest") && styleSource.includes("ranking"), "style.css 應包含回測 / 排行榜相關樣式"));


  checks.push(createCheck("V1.4.8.1 UI", "桌機版左側功能列修正標記", styleSource.includes("V1.4.8.1：桌機版左側功能列版面修正"), "desktop sidebar override"));
  checks.push(createCheck("V1.4.8.1 UI", "桌機版 app-main-layout 強制 grid", styleSource.includes("body .app-main-layout") && styleSource.includes("grid-template-columns: 300px minmax(0, 1fr)"), "desktop grid override"));
  checks.push(createCheck("V1.4.8.1 UI", "桌機版隱藏手機導航", styleSource.includes("body .mobile-section-nav") && styleSource.includes("body .mobile-bottom-nav"), "desktop hides mobile nav"));

  checks.push(createCheck("V1.4.8.2 策略", "策略最佳化回測比較路由", hasRoute(serverSource, "get", "/strategy-optimization/backtest-comparison"), "backtest comparison api"));
  checks.push(createCheck("V1.4.8.2 策略", "策略最佳化比較前端", appSource.includes("renderStrategyOptimizationComparison") && appSource.includes("data-strategy-optimization-comparison-metric"), "comparison panel"));
  checks.push(createCheck("V1.4.8.2 策略", "策略最佳化比較樣式", styleSource.includes(".strategy-optimization-comparison-card") && styleSource.includes(".optimization-preset-compare-card"), "comparison css"));

  checks.push(createCheck("V1.4.8.3 報告", "每日報告今日重點後端", serverSource.includes("buildDailyReportHighlights") && serverSource.includes("buildDailyReportFocusSummary"), "daily report highlights"));
  checks.push(createCheck("V1.4.8.3 報告", "每日報告最佳參數後端", serverSource.includes("normalizeDailyReportOptimization") && serverSource.includes("optimization = normalizeDailyReportOptimization"), "daily report optimization"));
  checks.push(createCheck("V1.4.8.3 報告", "每日報告績效指標參數", serverSource.includes("metric: req.query.metric") && appSource.includes('name="metric"') && appSource.includes("strategyDailyReportMetric"), "daily report metric"));
  checks.push(createCheck("V1.4.8.3 報告", "每日報告今日重點前端", appSource.includes("renderDailyReportHighlights") && appSource.includes("daily-report-highlight-card"), "highlights panel"));
  checks.push(createCheck("V1.4.8.3 報告", "每日報告最佳參數前端", appSource.includes("renderDailyReportOptimizationSummary") && appSource.includes("daily-report-optimization-card"), "optimization panel"));
  checks.push(createCheck("V1.4.8.3 報告", "每日報告補強樣式", styleSource.includes(".daily-report-highlight-grid") && styleSource.includes(".daily-report-recommendation-box"), "enhanced report css"));

  if (apiBaseUrl) {
    const health = await fetchJson(`${apiBaseUrl}/health`).catch((error) => ({ ok: false, status: 0, error: error.message }));
    checks.push(createCheck("線上 API", "GET /health", Boolean(health.ok && health.data?.version), health.data?.version || health.error || String(health.status)));
    checks.push(createCheck("線上 API", "API 版本正確", health.data?.version === EXPECTED_API_VERSION, health.data?.version || "無版本"));

    const status = await fetchJson(`${apiBaseUrl}/v13/status`).catch((error) => ({ ok: false, status: 0, error: error.message }));
    checks.push(createCheck("線上 API", "GET /v13/status", Boolean(status.ok && status.data?.overall_status), status.data?.overall_status || status.error || String(status.status)));
    checks.push(createWarn("線上 API", "/v13/status 為 pass 或 warn", ["pass", "warn"].includes(status.data?.overall_status), status.data?.overall_status || "無 overall_status"));

    const acceptance = await fetchJson(`${apiBaseUrl}/v13/acceptance`).catch((error) => ({ ok: false, status: 0, error: error.message }));
    checks.push(createCheck("線上 API", "GET /v13/acceptance", Boolean(acceptance.ok && acceptance.data?.checklist), acceptance.data?.acceptance_status || acceptance.error || String(acceptance.status)));

    const v14Status = await fetchJson(`${apiBaseUrl}/v14/status`).catch((error) => ({ ok: false, status: 0, error: error.message }));
    checks.push(createCheck("線上 API", "GET /v14/status", Boolean(v14Status.ok && v14Status.data?.overall_status), v14Status.data?.overall_status || v14Status.error || String(v14Status.status)));
    checks.push(createWarn("線上 API", "/v14/status 為 pass 或 warn", ["pass", "warn"].includes(v14Status.data?.overall_status), v14Status.data?.overall_status || "無 overall_status"));

    const v14Acceptance = await fetchJson(`${apiBaseUrl}/v14/acceptance`).catch((error) => ({ ok: false, status: 0, error: error.message }));
    checks.push(createCheck("線上 API", "GET /v14/acceptance", Boolean(v14Acceptance.ok && v14Acceptance.data?.checklist), v14Acceptance.data?.acceptance_status || v14Acceptance.error || String(v14Acceptance.status)));
  }

  const passCount = checks.filter((item) => item.status === "pass").length;
  const warnCount = checks.filter((item) => item.status === "warn").length;
  const failCount = checks.filter((item) => item.status === "fail").length;
  const totalCount = checks.length;
  const overallStatus = failCount > 0 ? "fail" : warnCount > 0 ? "warn" : "pass";

  console.log("====================================");
  console.log("V1.4 系統狀態 / 驗收檢查");
  console.log(`API 版本：${EXPECTED_API_VERSION}`);
  console.log(`PWA 版本：${EXPECTED_PWA_VERSION}`);
  if (apiBaseUrl) console.log(`線上 API：${apiBaseUrl}`);
  console.log("====================================");

  for (const check of checks) {
    const icon = check.status === "pass" ? "✅" : check.status === "warn" ? "⚠️" : "❌";
    console.log(`${icon} [${check.group}] ${check.label}${check.message ? `：${check.message}` : ""}`);
  }

  console.log("====================================");
  console.log(`結果：${overallStatus}`);
  console.log(`通過：${passCount} / 警告：${warnCount} / 失敗：${failCount} / 總數：${totalCount}`);
  console.log("====================================");

  if (failCount > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("V1.4 系統狀態 / 驗收檢查失敗");
  console.error(error);
  process.exit(1);
});
