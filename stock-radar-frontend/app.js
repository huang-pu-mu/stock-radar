function resolveApiBaseUrl() {
  const config = window.STOCK_RADAR_CONFIG || {};
  const hostname = window.location.hostname;
  const isLocal = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "";
  const savedUrl = window.localStorage.getItem("STOCK_RADAR_API_BASE_URL");

  if (savedUrl) return savedUrl.replace(/\/$/, "");

  const url = isLocal
    ? config.LOCAL_API_BASE_URL
    : config.PRODUCTION_API_BASE_URL;

  return String(url || "").replace(/\/$/, "");
}

const API_BASE_URL = resolveApiBaseUrl();
const RECENT_SEARCH_STORAGE_KEY = "STOCK_RADAR_RECENT_SEARCHES";
const AUTH_TOKEN_STORAGE_KEY = "STOCK_RADAR_AUTH_TOKEN";

const state = {
  page: "radar",
  market: "",
  limit: 20,
  latestRows: [],
  lastSearchCode: "",
  lastSearchData: null,
  authToken: window.localStorage.getItem(AUTH_TOKEN_STORAGE_KEY) || "",
  user: null,
  watchlistCodes: new Set(),
  watchlistLoaded: false,
  chartZoomRows: [],
  chartZoomRange: "60",
  chartZoomTitle: "技術圖表",
  alertFilter: "unread",
  alertMode: "list",
  alertSummary: null,
  alertUnreadCount: 0,
  alertRules: [],
  alertLastGenerateResult: null,
  strategyKey: "legal_strength",
  strategySummary: null,
  strategyOptions: [],
  strategyTrackKeys: new Set(),
  strategyTrackSummary: null,
  strategyPerformanceMetric: "current",
  strategyTrackFilterStrategy: "",
  strategyTrackFilterStatus: "",
  strategyTrackSearch: "",
  strategyTrackSort: "created_desc",
  strategyBacktestRunId: "",
  strategyBacktestMetric: "5d",
  strategyBacktestRankingMode: "overview",
  strategyBacktestRankingLimit: 20,
  strategyBacktestFilterStrategy: "",
  strategyBacktestFilterOutcome: "",
  strategyBacktestSearch: "",
  strategyBacktestSort: "5d_desc",
  strategyBacktestResultCount: 0,
  strategyBacktestRuns: [],
  strategyBacktestSummary: null,
  strategyBacktestRankings: null,
  v13Status: null,
  v13StatusLoading: false,
  v13StatusError: "",
};

const pageTitle = document.getElementById("pageTitle");
const pageDesc = document.getElementById("pageDesc");
const stockList = document.getElementById("stockList");
const statusBox = document.getElementById("statusBox");
const refreshBtn = document.getElementById("refreshBtn");
const tabButtons = document.querySelectorAll(".tab-btn");
const mobileSubnavGroups = document.querySelectorAll("[data-mobile-subnav-group]");
const marketButtons = document.querySelectorAll(".market-btn");
const marketRow = document.getElementById("marketRow");
const helpCard = document.getElementById("helpCard");
const searchPanel = document.getElementById("searchPanel");
const stockSearchInput = document.getElementById("stockSearchInput");
const stockSearchBtn = document.getElementById("stockSearchBtn");
const recentSearches = document.getElementById("recentSearches");
const detailModal = document.getElementById("detailModal");
const detailTitle = document.getElementById("detailTitle");
const detailContent = document.getElementById("detailContent");
const closeDetailBtn = document.getElementById("closeDetailBtn");
const chartZoomModal = document.getElementById("chartZoomModal");
const chartZoomTitle = document.getElementById("chartZoomTitle");
const chartZoomContent = document.getElementById("chartZoomContent");
const closeChartZoomBtn = document.getElementById("closeChartZoomBtn");
const installBtn = document.getElementById("installBtn");
const authMiniCard = document.getElementById("authMiniCard");
const alertsTabBadges = document.querySelectorAll(".alerts-tab-badge");
const backToTopBtn = document.getElementById("backToTopBtn");



const PAGE_GROUP_MAP = {
  radar: "market",
  foreign: "market",
  foreignStreak: "market",
  trust: "market",
  syncBuy: "market",
  industryFlow: "market",
  majorHolder: "market",
  search: "personal",
  watchlist: "personal",
  strategies: "strategy",
  strategyTracks: "strategy",
  strategyBacktests: "strategy",
  alerts: "alerts",
  account: "account",
};

function getPageGroup(page = state.page) {
  return PAGE_GROUP_MAP[page] || "market";
}

function updateNavigationState(page = state.page) {
  const activeGroup = getPageGroup(page);

  tabButtons.forEach((btn) => {
    const isBottomButton = btn.classList.contains("mobile-bottom-btn");
    const isActive = isBottomButton
      ? btn.dataset.mobileNavGroup === activeGroup
      : btn.dataset.page === page;

    btn.classList.toggle("active", isActive);
    if (isActive) {
      btn.setAttribute("aria-current", "page");
    } else {
      btn.removeAttribute("aria-current");
    }
  });

  mobileSubnavGroups.forEach((group) => {
    group.classList.toggle("hidden", group.dataset.mobileSubnavGroup !== activeGroup);
  });
}

const DEFAULT_STRATEGY_OPTIONS = [
  {
    key: "legal_strength",
    name: "法人轉強股",
    short_name: "法人轉強",
    description: "外資或投信轉買，搭配籌碼分數排序。",
    criteria: ["外資或投信最近一個交易日為買超", "籌碼分數達 70 分以上，或法人分數合計達 20 分以上"],
    score_formula: "策略分數 = 外資分數 + 投信分數 + 籌碼分數",
    sort_reason: "分數越高代表法人買盤與整體籌碼條件越集中。",
    risk_tips: ["法人買超可能只是短線調節，不一定代表股價會立即上漲。", "若股價已接近高點，追價風險會提高。"],
    empty_tips: ["降低市場篩選條件，改看全部市場。", "改看資金流入股或短線強勢股。"],
  },
  {
    key: "major_holder_accumulate",
    name: "主力增持股",
    short_name: "主力增持",
    description: "大戶比重增加、籌碼更集中。",
    criteria: ["使用 TDCC 集保週資料", "本週 400 張以上大戶比重高於前一週"],
    score_formula: "策略分數 = 大戶比重變化加權 + 散戶下降加分 + 籌碼集中度加分",
    sort_reason: "大戶比重增加越多、散戶比重下降越明顯，排名越前面。",
    risk_tips: ["TDCC 是每週資料，會落後每日行情。", "大戶增加不代表主力一定拉抬。"],
    empty_tips: ["TDCC 週資料可能尚未更新。", "改看全部市場或延後一週再觀察。"],
  },
  {
    key: "volume_price_breakout",
    name: "量價轉強股",
    short_name: "量價轉強",
    description: "成交量放大且股價位置偏強。",
    criteria: ["成交量分數達標，或狀態文字顯示量增 / 放大", "股價分數偏強、接近高點，或當日收盤上漲"],
    score_formula: "策略分數 = 成交量分數 + 股價位置分數 + 籌碼分數",
    sort_reason: "量能越明顯、股價位置越強、籌碼分數越高，排序越前面。",
    risk_tips: ["量增可能是出貨量，也可能是突破量。", "短線漲幅已大時，隔日震盪可能增加。"],
    empty_tips: ["當天市場量能可能不足。", "可改看短線強勢股或法人轉強股。"],
  },
  {
    key: "capital_inflow",
    name: "資金流入股",
    short_name: "資金流入",
    description: "三大法人合計買超較明顯。",
    criteria: ["三大法人合計為買超", "買超張數越大，排序越前面"],
    score_formula: "策略分數 = 三大法人買超張數 + 籌碼分數",
    sort_reason: "資金流入越明顯、成交金額越高的股票，排名越前面。",
    risk_tips: ["法人買超張數大，不一定代表買超占成交量比例高。", "大型權值股容易因張數大而排前。"],
    empty_tips: ["當天法人整體偏賣超時可能沒有結果。", "可改看法人轉強股。"],
  },
  {
    key: "etf_calendar_watch",
    name: "ETF 除息觀察",
    short_name: "ETF 除息",
    description: "ETF 即將發生除息或重要事件。",
    criteria: ["只篩 ETF 主檔中的商品", "事件日期在未來 30 天內"],
    score_formula: "策略分數 = 事件重要性分數 - 距離天數扣分",
    sort_reason: "事件日期越近、重要性越高，排序越前面。",
    risk_tips: ["ETF 除息不等於獲利，除息後淨值與價格會調整。", "仍需留意填息機率與市場風險。"],
    empty_tips: ["未來 30 天內可能沒有符合條件的 ETF 事件。", "確認 ETF 主檔與行事曆資料是否已更新。"],
  },
  {
    key: "short_term_strong",
    name: "短線強勢股",
    short_name: "短線強勢",
    description: "籌碼分數高，量價與股價位置偏強。",
    criteria: ["籌碼分數達 80 分以上", "股價當日不弱，或股價位置分數偏高"],
    score_formula: "策略分數 = 籌碼分數 + 成交量分數 + 股價位置分數",
    sort_reason: "籌碼越強、量價越配合、股價位置越偏強，排名越前面。",
    risk_tips: ["短線強勢股通常波動較大，不適合盲目追高。", "若隔日量縮或跌破關鍵價位，強勢訊號可能失效。"],
    empty_tips: ["市場轉弱時，短線強勢股數量會明顯減少。", "可降低篩選市場限制或改看主力增持股。"],
  },
];

let deferredInstallPrompt = null;
let hideStatusTimer = null;
let googleButtonRenderTimer = null;

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function pick(row, keys, fallback = "-") {
  for (const key of keys) {
    if (row && row[key] !== undefined && row[key] !== null && row[key] !== "") {
      return row[key];
    }
  }
  return fallback;
}

function toNumber(value) {
  if (value === null || value === undefined || value === "" || value === "-") return null;
  const numberValue = Number(String(value).replaceAll(",", ""));
  return Number.isFinite(numberValue) ? numberValue : null;
}

function formatNumber(value) {
  const numberValue = toNumber(value);
  if (numberValue === null) return escapeHtml(value ?? "-");
  return numberValue.toLocaleString("zh-TW");
}

function formatLotsValue(lotsValue, sharesValue) {
  const lots = toNumber(lotsValue);
  if (lots !== null) {
    return lots.toLocaleString("zh-TW", { maximumFractionDigits: 2 });
  }

  const shares = toNumber(sharesValue);
  if (shares !== null) {
    return (shares / 1000).toLocaleString("zh-TW", { maximumFractionDigits: 2 });
  }

  return "-";
}

function formatAmountYi(value) {
  const numberValue = toNumber(value);
  if (numberValue === null) return "-";
  return `${(numberValue / 100000000).toLocaleString("zh-TW", { maximumFractionDigits: 2 })} 億`;
}


function getStrategyOptions() {
  return Array.isArray(state.strategyOptions) && state.strategyOptions.length > 0
    ? state.strategyOptions
    : DEFAULT_STRATEGY_OPTIONS;
}

function getStrategyOption(key = state.strategyKey) {
  return getStrategyOptions().find((item) => item.key === key) || DEFAULT_STRATEGY_OPTIONS[0];
}

function normalizeTextList(value) {
  if (Array.isArray(value)) return value.filter((item) => item !== null && item !== undefined && String(item).trim() !== "");
  if (value === null || value === undefined || value === "") return [];
  return [String(value)];
}

function renderTextListItems(items, itemClass = "") {
  const normalized = normalizeTextList(items);
  if (normalized.length === 0) return `<li>尚無資料。</li>`;
  return normalized.map((item) => `<li class="${itemClass}">${escapeHtml(item)}</li>`).join("");
}

function renderStrategyDefinitionPanel() {
  const activeStrategy = getStrategyOption();
  const criteria = normalizeTextList(activeStrategy.criteria);
  const riskTips = normalizeTextList(activeStrategy.risk_tips);
  const formula = activeStrategy.score_formula || "依目前策略條件綜合排序。";
  const sortReason = activeStrategy.sort_reason || "符合條件越多、分數越高，排序越前面。";

  return `
    <div class="strategy-definition-panel">
      <div class="strategy-definition-card primary">
        <span class="definition-label">判斷條件</span>
        <ul>${renderTextListItems(criteria)}</ul>
      </div>
      <div class="strategy-definition-card">
        <span class="definition-label">分數怎麼算</span>
        <p>${escapeHtml(formula)}</p>
        <small>${escapeHtml(sortReason)}</small>
      </div>
      <div class="strategy-definition-card warning">
        <span class="definition-label">風險提醒</span>
        <ul>${renderTextListItems(riskTips)}</ul>
      </div>
    </div>
  `;
}

function renderScoreBreakdownItems(row) {
  const parts = Array.isArray(row.score_breakdown) ? row.score_breakdown : [];
  if (parts.length === 0) return "";

  return `
    <div class="strategy-breakdown-box">
      <div class="strategy-subtitle">策略分數拆解</div>
      <div class="breakdown-list">
        ${parts.map((part) => {
          const percent = Math.min(Math.max(toNumber(part.percent) ?? 0, 0), 100);
          const valueText = `${formatNumber(part.value)} / ${formatNumber(part.max)}`;
          return `
            <div class="breakdown-row ${escapeHtml(part.tone || "normal")}">
              <div class="breakdown-head">
                <span>${escapeHtml(part.label || "分數")}</span>
                <strong>${valueText}</strong>
              </div>
              <div class="breakdown-bar" aria-hidden="true"><span style="width:${percent}%"></span></div>
              <p>${escapeHtml(part.description || "")}</p>
            </div>
          `;
        }).join("")}
      </div>
    </div>
  `;
}

function renderStrategyReasonBox(row) {
  const reasons = normalizeTextList(row.match_reasons);
  const risks = normalizeTextList(row.risk_flags);
  const interpretation = row.strategy_interpretation || "符合策略條件，可加入觀察清單。";

  return `
    <div class="strategy-detail-box">
      <div class="strategy-reason-card">
        <div class="strategy-subtitle">為什麼被選出來</div>
        <ul>${renderTextListItems(reasons)}</ul>
      </div>
      <div class="strategy-reason-card risk">
        <div class="strategy-subtitle">注意事項</div>
        <p>${escapeHtml(interpretation)}</p>
        <ul>${renderTextListItems(risks)}</ul>
      </div>
    </div>
  `;
}

function renderStrategyEmptyTips() {
  const activeStrategy = getStrategyOption();
  const tips = normalizeTextList(activeStrategy.empty_tips);
  return `
    <div class="strategy-empty-tips">
      <strong>可以怎麼做：</strong>
      <ul>${renderTextListItems(tips)}</ul>
    </div>
  `;
}

function formatLotsFromShares(value) {
  const numberValue = toNumber(value);
  if (numberValue === null) return "-";
  return (numberValue / 1000).toLocaleString("zh-TW", { maximumFractionDigits: 0 });
}

function formatSignedNumber(value, suffix = "") {
  const numberValue = toNumber(value);
  if (numberValue === null) return "-";
  const prefix = numberValue > 0 ? "+" : "";
  return `${prefix}${numberValue.toLocaleString("zh-TW", { maximumFractionDigits: 2 })}${suffix}`;
}

function formatPercent(value) {
  const numberValue = toNumber(value);
  if (numberValue === null) return "-";
  return `${numberValue.toLocaleString("zh-TW", { maximumFractionDigits: 1 })}%`;
}

const STRATEGY_PERFORMANCE_METRICS = [
  { key: "current", field: "current_return_percent", label: "目前報酬", shortLabel: "目前" },
  { key: "1d", field: "return_1d_percent", label: "1 日報酬", shortLabel: "1日" },
  { key: "3d", field: "return_3d_percent", label: "3 日報酬", shortLabel: "3日" },
  { key: "5d", field: "return_5d_percent", label: "5 日報酬", shortLabel: "5日" },
];

const STRATEGY_TRACK_STATUS_OPTIONS = [
  { key: "", label: "全部狀態" },
  { key: "take_profit", label: "只看已達停利" },
  { key: "stop_loss", label: "只看已達停損" },
  { key: "in_range", label: "只看未觸發" },
  { key: "strong", label: "只看轉強" },
  { key: "neutral", label: "只看觀察中" },
  { key: "weak", label: "只看轉弱" },
  { key: "pending", label: "只看等待資料" },
];

const STRATEGY_TRACK_STATUS_TEXT = {
  take_profit: "已達停利",
  stop_loss: "已達停損",
  in_range: "未觸發",
  strong: "轉強",
  neutral: "觀察中",
  weak: "轉弱",
  pending: "等待資料",
};

const STRATEGY_TRACK_SORT_OPTIONS = [
  { key: "created_desc", label: "加入時間新到舊" },
  { key: "created_asc", label: "加入時間舊到新" },
  { key: "current_desc", label: "目前報酬高到低" },
  { key: "current_asc", label: "目前報酬低到高" },
  { key: "1d_desc", label: "1 日報酬高到低" },
  { key: "1d_asc", label: "1 日報酬低到高" },
  { key: "3d_desc", label: "3 日報酬高到低" },
  { key: "3d_asc", label: "3 日報酬低到高" },
  { key: "5d_desc", label: "5 日報酬高到低" },
  { key: "5d_asc", label: "5 日報酬低到高" },
  { key: "source_score_desc", label: "加入時分數高到低" },
  { key: "source_score_asc", label: "加入時分數低到高" },
  { key: "stock_code_asc", label: "股票代號小到大" },
  { key: "stock_code_desc", label: "股票代號大到小" },
];

const STRATEGY_BACKTEST_METRICS = [
  { key: "1d", field: "return_1d_percent", label: "1 日報酬", shortLabel: "1日" },
  { key: "3d", field: "return_3d_percent", label: "3 日報酬", shortLabel: "3日" },
  { key: "5d", field: "return_5d_percent", label: "5 日報酬", shortLabel: "5日" },
  { key: "latest", field: "latest_return_percent", label: "目前報酬", shortLabel: "目前" },
];

const STRATEGY_BACKTEST_RANKING_MODES = [
  { key: "overview", label: "綜合排行" },
  { key: "best", label: "最佳股票" },
  { key: "weakest", label: "最弱股票" },
  { key: "strategy", label: "策略排行" },
];

const STRATEGY_BACKTEST_OUTCOME_OPTIONS = [
  { key: "", label: "全部結果" },
  { key: "success", label: "只看成功" },
  { key: "neutral", label: "只看觀察" },
  { key: "fail", label: "只看失敗" },
  { key: "pending", label: "只看待資料" },
];

const STRATEGY_BACKTEST_OUTCOME_TEXT = {
  success: "成功",
  neutral: "觀察",
  fail: "失敗",
  pending: "待資料",
};

const STRATEGY_BACKTEST_SORT_OPTIONS = [
  { key: "5d_desc", label: "5 日報酬高到低" },
  { key: "5d_asc", label: "5 日報酬低到高" },
  { key: "3d_desc", label: "3 日報酬高到低" },
  { key: "3d_asc", label: "3 日報酬低到高" },
  { key: "1d_desc", label: "1 日報酬高到低" },
  { key: "1d_asc", label: "1 日報酬低到高" },
  { key: "latest_desc", label: "目前報酬高到低" },
  { key: "latest_asc", label: "目前報酬低到高" },
  { key: "score_desc", label: "策略分數高到低" },
  { key: "score_asc", label: "策略分數低到高" },
  { key: "signal_desc", label: "訊號日新到舊" },
  { key: "signal_asc", label: "訊號日舊到新" },
];

function getBacktestMetric(key = state.strategyBacktestMetric) {
  return STRATEGY_BACKTEST_METRICS.find((item) => item.key === key) || STRATEGY_BACKTEST_METRICS[2];
}

function getBacktestRankingMode(key = state.strategyBacktestRankingMode) {
  return STRATEGY_BACKTEST_RANKING_MODES.find((item) => item.key === key) || STRATEGY_BACKTEST_RANKING_MODES[0];
}

function getBacktestSortForMetric(metricKey = state.strategyBacktestMetric, direction = "desc") {
  if (["1d", "3d", "5d"].includes(metricKey)) return `${metricKey}_${direction}`;
  return `latest_${direction}`;
}

function getBacktestOutcomeText(key) {
  return STRATEGY_BACKTEST_OUTCOME_TEXT[key] || "-";
}

function getBacktestOutcomeClass(key) {
  if (key === "success") return "price-up";
  if (key === "fail") return "price-down";
  if (key === "pending") return "price-flat";
  return "score-mid";
}


function getStrategyPerformanceMetric(key = state.strategyPerformanceMetric) {
  return STRATEGY_PERFORMANCE_METRICS.find((item) => item.key === key) || STRATEGY_PERFORMANCE_METRICS[0];
}

function getReturnClass(value) {
  const numberValue = toNumber(value);
  if (numberValue === null || Math.abs(numberValue) < 0.0001) return "price-flat";
  return numberValue > 0 ? "price-up" : "price-down";
}

function formatReturnPercent(value) {
  const numberValue = toNumber(value);
  if (numberValue === null) return "待資料";
  const prefix = numberValue > 0 ? "+" : "";
  return `${prefix}${numberValue.toLocaleString("zh-TW", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
}

function formatRiskThreshold(value, fallback) {
  const numberValue = toNumber(value);
  const safeValue = numberValue === null ? fallback : numberValue;
  return safeValue.toLocaleString("zh-TW", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

function getRiskObservationClass(row) {
  const key = pick(row, ["risk_observation_key"], "");
  if (key === "take_profit") return "price-up";
  if (key === "stop_loss") return "price-down";
  if (key === "pending") return "price-flat";
  return "score-mid";
}

function getStrategyPerformanceValue(row, metricKey = state.strategyPerformanceMetric) {
  const metric = getStrategyPerformanceMetric(metricKey);
  return toNumber(pick(row, [metric.field], null));
}

function getStrategyTrackStatusText(key = state.strategyTrackFilterStatus) {
  return STRATEGY_TRACK_STATUS_TEXT[key] || "";
}

function getStrategyTrackSortOption(key = state.strategyTrackSort) {
  return STRATEGY_TRACK_SORT_OPTIONS.find((item) => item.key === key) || STRATEGY_TRACK_SORT_OPTIONS[0];
}

function hasStrategyTrackFilters() {
  return Boolean(state.strategyTrackFilterStrategy || state.strategyTrackFilterStatus || state.strategyTrackSearch);
}

function getStrategyTrackSearchText(row) {
  return [
    pick(row, ["stock_code"], ""),
    pick(row, ["stock_name"], ""),
    pick(row, ["strategy_name"], ""),
    pick(row, ["industry"], ""),
    pick(row, ["trigger_summary"], ""),
  ].join(" ").toLowerCase();
}

function getStrategyTrackStatusKey(row) {
  const status = String(pick(row, ["performance_status"], "")).trim();
  if (status === "轉強") return "strong";
  if (status === "轉弱") return "weak";
  if (status === "觀察中") return "neutral";
  if (status === "等待資料") return "pending";
  return "";
}

function getStrategyTrackSortValue(row, sortKey = state.strategyTrackSort) {
  const key = String(sortKey || "created_desc");
  if (key.startsWith("current_")) return getStrategyPerformanceValue(row, "current");
  if (key.startsWith("1d_")) return getStrategyPerformanceValue(row, "1d");
  if (key.startsWith("3d_")) return getStrategyPerformanceValue(row, "3d");
  if (key.startsWith("5d_")) return getStrategyPerformanceValue(row, "5d");
  if (key.startsWith("source_score_")) return toNumber(pick(row, ["source_score"], null));
  if (key.startsWith("created_")) return Date.parse(pick(row, ["created_at"], ""));
  return String(pick(row, ["stock_code"], ""));
}

function sortStrategyTrackingRows(rows, sortKey = state.strategyTrackSort) {
  const direction = String(sortKey || "created_desc").endsWith("_asc") ? "asc" : "desc";
  const isTextSort = String(sortKey || "").startsWith("stock_code_");

  return [...rows].sort((a, b) => {
    if (isTextSort) {
      const result = String(getStrategyTrackSortValue(a, sortKey)).localeCompare(String(getStrategyTrackSortValue(b, sortKey)));
      return direction === "asc" ? result : -result;
    }

    const aValue = getStrategyTrackSortValue(a, sortKey);
    const bValue = getStrategyTrackSortValue(b, sortKey);
    const aValid = Number.isFinite(Number(aValue));
    const bValid = Number.isFinite(Number(bValue));

    if (!aValid && !bValid) return String(pick(a, ["stock_code"], "")).localeCompare(String(pick(b, ["stock_code"], "")));
    if (!aValid) return 1;
    if (!bValid) return -1;

    return direction === "asc" ? Number(aValue) - Number(bValue) : Number(bValue) - Number(aValue);
  });
}

function getVisibleStrategyTrackingRows(rows = state.latestRows) {
  const keyword = String(state.strategyTrackSearch || "").trim().toLowerCase();
  let visibleRows = Array.isArray(rows) ? [...rows] : [];

  if (state.strategyTrackFilterStrategy) {
    visibleRows = visibleRows.filter((row) => pick(row, ["strategy_key"], "") === state.strategyTrackFilterStrategy);
  }

  if (state.strategyTrackFilterStatus) {
    visibleRows = visibleRows.filter((row) => {
      if (["take_profit", "stop_loss", "in_range"].includes(state.strategyTrackFilterStatus)) {
        return pick(row, ["risk_observation_key"], "") === state.strategyTrackFilterStatus;
      }
      return getStrategyTrackStatusKey(row) === state.strategyTrackFilterStatus;
    });
  }

  if (keyword) {
    visibleRows = visibleRows.filter((row) => getStrategyTrackSearchText(row).includes(keyword));
  }

  return sortStrategyTrackingRows(visibleRows, state.strategyTrackSort);
}

function buildStrategyTrackingQueryString() {
  const params = new URLSearchParams();
  params.set("active", "1");
  params.set("limit", "300");
  params.set("source_limit", "500");
  params.set("metric", state.strategyPerformanceMetric);
  params.set("sort", state.strategyTrackSort);

  if (state.strategyTrackFilterStrategy) params.set("strategy", state.strategyTrackFilterStrategy);
  if (state.strategyTrackFilterStatus) params.set("status", state.strategyTrackFilterStatus);
  if (state.strategyTrackSearch) params.set("search", state.strategyTrackSearch);

  return params.toString();
}

function buildStrategyTrackingFilterSummary(count) {
  const filters = [];
  const strategy = getStrategyOptions().find((item) => item.key === state.strategyTrackFilterStrategy);
  if (strategy) filters.push(`策略：${strategy.name}`);
  if (state.strategyTrackFilterStatus) filters.push(`狀態：${getStrategyTrackStatusText()}`);
  if (state.strategyTrackSearch) filters.push(`搜尋：${state.strategyTrackSearch}`);
  filters.push(`排序：${getStrategyTrackSortOption().label}`);
  return `${formatNumber(count)} 筆結果｜${filters.join("｜")}`;
}

function buildStrategyPerformanceSummary(rows, metricKey = state.strategyPerformanceMetric) {
  const metric = getStrategyPerformanceMetric(metricKey);
  const availableRows = rows.filter((row) => getStrategyPerformanceValue(row, metric.key) !== null);
  const positiveRows = availableRows.filter((row) => getStrategyPerformanceValue(row, metric.key) > 0);
  const negativeRows = availableRows.filter((row) => getStrategyPerformanceValue(row, metric.key) < 0);
  const avgReturn = availableRows.length
    ? availableRows.reduce((sum, row) => sum + getStrategyPerformanceValue(row, metric.key), 0) / availableRows.length
    : null;
  const sorted = [...availableRows].sort((a, b) => getStrategyPerformanceValue(b, metric.key) - getStrategyPerformanceValue(a, metric.key));

  return {
    metric,
    totalCount: rows.length,
    availableCount: availableRows.length,
    pendingCount: rows.length - availableRows.length,
    positiveCount: positiveRows.length,
    negativeCount: negativeRows.length,
    avgReturn,
    winRate: availableRows.length ? (positiveRows.length / availableRows.length) * 100 : null,
    best: sorted[0] || null,
    worst: sorted[sorted.length - 1] || null,
  };
}

function buildStrategyPerformanceByStrategy(rows, metricKey = state.strategyPerformanceMetric) {
  const metric = getStrategyPerformanceMetric(metricKey);
  const map = new Map();

  rows.forEach((row) => {
    const key = pick(row, ["strategy_key"], "unknown");
    const value = getStrategyPerformanceValue(row, metric.key);

    if (!map.has(key)) {
      map.set(key, {
        strategy_key: key,
        strategy_name: pick(row, ["strategy_name"], key),
        total: 0,
        available: 0,
        positive: 0,
        totalReturn: 0,
        best: null,
      });
    }

    const item = map.get(key);
    item.total += 1;

    if (value !== null) {
      item.available += 1;
      item.totalReturn += value;
      if (value > 0) item.positive += 1;
      if (!item.best || value > getStrategyPerformanceValue(item.best, metric.key)) item.best = row;
    }
  });

  return [...map.values()].map((item) => ({
    ...item,
    avgReturn: item.available ? item.totalReturn / item.available : null,
    winRate: item.available ? (item.positive / item.available) * 100 : null,
  })).sort((a, b) => (b.avgReturn ?? -999999) - (a.avgReturn ?? -999999));
}

function buildStrategyRiskSummary(rows = []) {
  return rows.reduce((summary, row) => {
    const key = pick(row, ["risk_observation_key"], "pending");
    summary.total += 1;
    if (key === "take_profit") summary.takeProfit += 1;
    else if (key === "stop_loss") summary.stopLoss += 1;
    else if (key === "in_range") summary.inRange += 1;
    else summary.pending += 1;
    return summary;
  }, {
    total: 0,
    takeProfit: 0,
    stopLoss: 0,
    inRange: 0,
    pending: 0,
  });
}

function formatPrice(value) {
  const numberValue = toNumber(value);
  if (numberValue === null) return escapeHtml(value ?? "-");
  return numberValue.toFixed(2).replace(/\.00$/, "");
}

function formatDate(value) {
  if (!value || value === "-") return "-";
  const text = String(value);
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  return escapeHtml(text);
}

function getChangeClass(value) {
  const numberValue = toNumber(value);
  if (numberValue === null || numberValue === 0) return "price-flat";
  return numberValue > 0 ? "price-up" : "price-down";
}

function getPriceDirectionClass(changeValue, closeValue = null, previousCloseValue = null) {
  const change = toNumber(changeValue);

  if (change !== null) return getChangeClass(change);

  const close = toNumber(closeValue);
  const previousClose = toNumber(previousCloseValue);

  if (close !== null && previousClose !== null) {
    return getChangeClass(close - previousClose);
  }

  return "price-flat";
}

function formatDirectionalClosePrice(closeValue, changeValue, previousCloseValue = null) {
  const directionClass = getPriceDirectionClass(changeValue, closeValue, previousCloseValue);
  return `<strong class="${directionClass}">${formatPrice(closeValue)}</strong>`;
}

function getScoreClass(score) {
  const numberValue = toNumber(score);
  if (numberValue === null) return "score-low";
  if (numberValue >= 80) return "score-high";
  if (numberValue >= 60) return "score-mid";
  return "score-low";
}

function getScoreText(score) {
  const numberValue = toNumber(score);
  if (numberValue === null) return "尚無分數";
  if (numberValue >= 80) return "優先觀察";
  if (numberValue >= 60) return "可以觀察";
  return "普通觀察";
}

function getStatusTone(value) {
  const text = String(value ?? "");
  if (!text || text === "-") return "";
  if (text.includes("強") || text.includes("買") || text.includes("增加") || text.includes("放大") || text.includes("偏多")) return "good";
  if (text.includes("弱") || text.includes("賣") || text.includes("減少") || text.includes("低迷") || text.includes("偏空")) return "bad";
  return "warn";
}

function showStatus(message, type = "") {
  if (hideStatusTimer) window.clearTimeout(hideStatusTimer);
  statusBox.innerHTML = message;
  statusBox.className = `status-box ${type}`.trim();
  statusBox.classList.remove("hidden");
}

function hideStatus() {
  if (hideStatusTimer) window.clearTimeout(hideStatusTimer);
  statusBox.classList.add("hidden");
}

function showTemporaryStatus(message, type = "success", delay = 1300) {
  showStatus(message, type);
  hideStatusTimer = window.setTimeout(hideStatus, delay);
}

function setLoading(isLoading) {
  refreshBtn.disabled = isLoading;
  refreshBtn.textContent = isLoading ? "讀取中..." : "重新整理";
}

function setSearchLoading(isLoading) {
  stockSearchBtn.disabled = isLoading;
  stockSearchInput.disabled = isLoading;
  stockSearchBtn.textContent = isLoading ? "查詢中..." : "查詢";
}

function updateBackToTopVisibility() {
  if (!backToTopBtn) return;
  backToTopBtn.classList.toggle("hidden", window.scrollY < 520);
}

function scrollToPageTop() {
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function scrollToBacktestResults() {
  const target = document.getElementById("strategyBacktestResultsSection");
  if (!target) return;
  window.setTimeout(() => {
    target.scrollIntoView({ behavior: "smooth", block: "start" });
  }, 80);
}

async function fetchJson(path, options = {}) {
  if (!API_BASE_URL || API_BASE_URL.includes("你的-api網址")) {
    throw new Error("尚未設定正式 API 網址。請打開 config.js，把 PRODUCTION_API_BASE_URL 改成你的 Node.js API 網址。");
  }

  const { auth = false, body, raw = false, ...fetchOptions } = options;
  const headers = new Headers(fetchOptions.headers || {});

  if (body !== undefined) {
    headers.set("Content-Type", "application/json");
    fetchOptions.body = JSON.stringify(body);
  }

  if (auth && state.authToken) {
    headers.set("Authorization", `Bearer ${state.authToken}`);
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...fetchOptions,
    headers,
  });
  let result = null;

  try {
    result = await response.json();
  } catch (error) {
    throw new Error("API 回傳不是 JSON，請確認後端是否正常啟動。特殊錯誤：" + error.message);
  }

  if (!response.ok || result.success === false) {
    throw new Error(result.message || result.error || "API 查詢失敗");
  }

  if (raw) return result;
  if (Array.isArray(result)) return result;
  if (result.data) return result.data;
  return result;
}
function buildListPath() {
  const params = new URLSearchParams();

  if (state.page === "foreignStreak") {
    params.set("limit", "100");
    return `/radar/foreign-buy-ranking?${params.toString()}`;
  }

  if (state.page === "trust") {
    params.set("limit", "100");
    return `/radar/investment-trust-ranking?${params.toString()}`;
  }

  if (state.page === "syncBuy") {
    params.set("limit", "100");
    if (state.market) params.set("market", state.market);
    return `/radar/institutional-sync-buying?${params.toString()}`;
  }

  if (state.page === "industryFlow") {
    params.set("limit", "50");
    if (state.market) params.set("market", state.market);
    return `/radar/industry-flow?${params.toString()}`;
  }

  if (state.page === "majorHolder") {
    params.set("limit", "100");
    if (state.market) params.set("market", state.market);
    return `/radar/major-holder?${params.toString()}`;
  }

  const endpoint = state.page === "foreign" ? "/foreign/top" : "/radar/top";
  params.set("limit", String(state.limit));
  if (state.market) params.set("market", state.market);
  return `${endpoint}?${params.toString()}`;
}

function updatePageText() {
  const marketText = state.market || "全市場";
  const isSearchPage = state.page === "search";
  const isAccountPage = state.page === "account";
  const isWatchlistPage = state.page === "watchlist";
  const isAlertsPage = state.page === "alerts";
  const isStrategiesPage = state.page === "strategies";
  const isStrategyTracksPage = state.page === "strategyTracks";
  const isStrategyBacktestsPage = state.page === "strategyBacktests";
  const isAlertRulesMode = isAlertsPage && state.alertMode === "rules";

  refreshBtn.classList.toggle("hidden", isSearchPage || isAccountPage);
  marketRow.classList.toggle("hidden", isSearchPage || isAccountPage || isWatchlistPage || isAlertsPage || isStrategyTracksPage || isStrategyBacktestsPage);
  searchPanel.classList.toggle("hidden", !isSearchPage);



  if (state.page === "strategyBacktests") {
    const metric = getBacktestMetric();
    pageTitle.textContent = "策略回測";
    pageDesc.textContent = `用歷史資料檢查策略訊號後續 ${metric.label}、勝率與最佳 / 最弱股票。`;
    helpCard.innerHTML = `<strong>簡單看法：</strong><span>先看 5 日平均報酬與勝率，再看樣本數；回測只是歷史統計，不代表未來一定重演。</span>`;
    return;
  }

  if (state.page === "strategyTracks") {
    pageTitle.textContent = "策略追蹤";
    pageDesc.textContent = "保存從策略選股加入的股票，檢查 1 日、3 日、5 日與目前報酬表現。";
    helpCard.innerHTML = `<strong>簡單看法：</strong><span>先看平均報酬與正報酬比例，再看哪個策略、哪檔股票追蹤效果最好。</span>`;
    return;
  }

  if (state.page === "strategies") {
    const activeStrategy = getStrategyOption(state.strategyKey);
    pageTitle.textContent = "策略選股";
    pageDesc.textContent = `${marketText}${activeStrategy.name}，用全市場資料快速篩出符合條件的觀察名單。`;
    helpCard.innerHTML = `<strong>簡單看法：</strong><span>先選策略，再用上市 / 上櫃切換市場；這是篩選清單，不是買賣建議。</span>`;
    return;
  }

  if (state.page === "alerts") {
    pageTitle.textContent = isAlertRulesMode ? "提醒設定" : "提醒中心";
    pageDesc.textContent = isAlertRulesMode
      ? "調整每一檔自選股的提醒條件，包含法人、主力、成交量、籌碼分數與行事曆。"
      : "顯示自選股的異常提醒，包含投信連買、主力籌碼、量能、分數與行事曆。";
    helpCard.innerHTML = isAlertRulesMode
      ? `<strong>簡單看法：</strong><span>門檻越低，提醒越多；門檻越高，提醒會比較少但訊號較強。</span>`
      : `<strong>簡單看法：</strong><span>先看未讀與高重要性提醒；看完可標記已讀，避免每天重複判斷。</span>`;
    return;
  }

  if (state.page === "watchlist") {
    pageTitle.textContent = "自選股";
    pageDesc.textContent = "登入後，每個 Google 帳號都會看到自己的自選股票清單。";
    helpCard.innerHTML = `<strong>簡單看法：</strong><span>這裡只顯示你自己加入的股票；想移除就按「已自選」。</span>`;
    return;
  }

  if (state.page === "account") {
    pageTitle.textContent = "我的帳號";
    pageDesc.textContent = "管理登入、自選股，並檢查 V1.3 系統狀態、策略回測與提醒資料。";
    helpCard.innerHTML = `<strong>簡單看法：</strong><span>這裡可確認 API、資料庫、提醒、策略追蹤與策略回測是否都正常。</span>`;
    return;
  }

  if (state.page === "search") {
    pageTitle.textContent = "個股查詢";
    pageDesc.textContent = "直接輸入股票代號，查看該股票的行情、法人與籌碼分數。";
    helpCard.innerHTML = `<strong>簡單看法：</strong><span>先輸入股票代號，例如 2330；查到後再看分數、法人買賣超與成交量。</span>`;
    window.setTimeout(() => stockSearchInput.focus(), 80);
    renderRecentSearches();
    return;
  }

  if (state.page === "foreign") {
    pageTitle.textContent = "外資排行";
    pageDesc.textContent = `${marketText}外資買超排行，先看外資今天買最多的股票。`;
    helpCard.innerHTML = `<strong>簡單看法：</strong><span>外資買超越大，代表外資今天買進力道越明顯；點「看明細」可以看投信與成交量。</span>`;
    return;
  }

  if (state.page === "foreignStreak") {
    pageTitle.textContent = "外資連買";
    pageDesc.textContent = `${marketText}外資連買排行，先看外資連續買進、累計買超大的股票。`;
    helpCard.innerHTML = `<strong>簡單看法：</strong><span>外資連買天數越多、累計買超越大，代表外資近期買進態度越明顯；點「看明細」可以看完整籌碼。</span>`;
    return;
  }

  if (state.page === "trust") {
    pageTitle.textContent = "投信排行";
    pageDesc.textContent = `${marketText}投信連買排行，先看投信連續買進、累計買超大的股票。`;
    helpCard.innerHTML = `<strong>簡單看法：</strong><span>投信連買天數越多、累計買超越大，代表投信近期買進態度越明顯；點「看明細」可以看完整籌碼。</span>`;
    return;
  }

  if (state.page === "syncBuy") {
    pageTitle.textContent = "法人同步買超";
    pageDesc.textContent = `${marketText}外資與投信同一天買超排行，優先看法人方向一致的股票。`;
    helpCard.innerHTML = `<strong>簡單看法：</strong><span>外資和投信同時買超，代表兩種主要法人同向偏多；同步天數越多、合計買超越大，觀察價值越高。</span>`;
    return;
  }

  if (state.page === "industryFlow") {
    pageTitle.textContent = "產業資金流向";
    pageDesc.textContent = `${marketText}依產業彙總三大法人買賣超，先看資金今天流入哪個產業。`;
    helpCard.innerHTML = `<strong>簡單看法：</strong><span>法人合計買超越大，代表該產業今天資金流入越明顯；再看外資、投信是否同向，以及產業內買超家數。</span>`;
    return;
  }

  if (state.page === "majorHolder") {
    pageTitle.textContent = "主力籌碼分析";
    pageDesc.textContent = `${marketText}用 TDCC 集保股權分散資料，看 400 張以上大戶持股是否增加。`;
    helpCard.innerHTML = `<strong>簡單看法：</strong><span>大戶比重上升、散戶比重下降，代表籌碼可能更集中；這是每週資料，不是每日即時資料。</span>`;
    return;
  }

  pageTitle.textContent = "今日雷達";
  pageDesc.textContent = `${marketText}籌碼分數排行，先看分數高、狀態偏多的股票。`;
  helpCard.innerHTML = `<strong>簡單看法：</strong><span>分數越高代表籌碼越強；點「看明細」可以查看外資、投信、成交量。</span>`;
}

function createInfoItem(label, value, extraClass = "") {
  return `
    <div class="info-item">
      <span class="info-label">${escapeHtml(label)}</span>
      <span class="info-value ${extraClass}">${value}</span>
    </div>
  `;
}

function createStatusItem(label, value) {
  const rawValue = value ?? "-";
  const tone = getStatusTone(rawValue);
  const chip = `<span class="status-chip ${tone}">${escapeHtml(rawValue)}</span>`;
  return createInfoItem(label, chip);
}


const MOVING_AVERAGE_PERIODS = [5, 10, 20, 60, 120, 240];
const VOLUME_AVERAGE_PERIODS = [5, 20];
const CHART_RANGE_OPTIONS = [
  { value: "20", label: "20日" },
  { value: "60", label: "60日" },
  { value: "120", label: "120日" },
  { value: "240", label: "240日" },
  { value: "all", label: "全部" },
];

function getRowDate(row) {
  return String(pick(row, ["trade_date", "date"], ""));
}

function getSortedPriceRows(rows, maxRows = 260) {
  const safeRows = Array.isArray(rows) ? rows : [];
  const uniqueMap = new Map();

  safeRows.forEach((row) => {
    const date = getRowDate(row);
    const close = toNumber(pick(row, ["close_price", "closing_price", "close"], null));

    if (!date || close === null) return;
    uniqueMap.set(date, row);
  });

  return Array.from(uniqueMap.values())
    .sort((a, b) => getRowDate(a).localeCompare(getRowDate(b)))
    .slice(-maxRows);
}

function averageStrict(values, period) {
  const safeValues = values.slice(-period).filter((value) => value !== null && Number.isFinite(value));

  if (safeValues.length < period) return null;

  return safeValues.reduce((sum, value) => sum + value, 0) / safeValues.length;
}

function enrichPriceRows(rows) {
  const sortedRows = getSortedPriceRows(rows);

  return sortedRows.map((row, index) => {
    const close = toNumber(pick(row, ["close_price", "closing_price", "close"], null));
    const open = toNumber(pick(row, ["open_price", "open"], close));
    const high = toNumber(pick(row, ["high_price", "high"], Math.max(open ?? close ?? 0, close ?? open ?? 0)));
    const low = toNumber(pick(row, ["low_price", "low"], Math.min(open ?? close ?? 0, close ?? open ?? 0)));
    const volume = toNumber(pick(row, ["trade_volume", "volume"], null));
    const change = toNumber(pick(row, ["price_change", "change", "change_price"], null));
    const closeHistory = sortedRows
      .slice(0, index + 1)
      .map((item) => toNumber(pick(item, ["close_price", "closing_price", "close"], null)));
    const previousClose = closeHistory.length >= 2 ? closeHistory[closeHistory.length - 2] : null;
    const volumeHistory = sortedRows
      .slice(0, index + 1)
      .map((item) => toNumber(pick(item, ["trade_volume", "volume"], null)));
    const ma = {};
    const mv = {};

    MOVING_AVERAGE_PERIODS.forEach((period) => {
      ma[`ma${period}`] = averageStrict(closeHistory, period);
    });

    VOLUME_AVERAGE_PERIODS.forEach((period) => {
      mv[`mv${period}`] = averageStrict(volumeHistory, period);
    });

    return {
      date: getRowDate(row),
      open: open ?? close,
      high: high ?? close,
      low: low ?? close,
      close,
      previousClose,
      change,
      volume,
      ma,
      mv,
    };
  });
}

function formatAveragePrice(value, period, availableCount) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return `<span class="muted-value">資料不足 ${availableCount}/${period}</span>`;
  }

  return formatPrice(value);
}

function renderMovingAverageItems(enrichedRows) {
  const latestRow = enrichedRows[enrichedRows.length - 1] || {};
  const availableCount = enrichedRows.length;

  return MOVING_AVERAGE_PERIODS.map((period) =>
    createInfoItem(`MA${period}`, formatAveragePrice(latestRow.ma?.[`ma${period}`], period, availableCount)),
  );
}

function svgPoint(x, y) {
  return `${Number(x).toFixed(2)},${Number(y).toFixed(2)}`;
}

function renderEmptyChart(message) {
  return `
    <div class="chart-empty">
      ${escapeHtml(message)}
    </div>
  `;
}

function getChartRowsByRange(enrichedRows, rangeValue = "120") {
  const safeRows = Array.isArray(enrichedRows) ? enrichedRows : [];

  if (rangeValue === "all") return safeRows;

  const count = Number(rangeValue);
  if (!Number.isFinite(count) || count <= 0) return safeRows.slice(-120);

  return safeRows.slice(-count);
}

function getChartRangeLabel(rangeValue) {
  return CHART_RANGE_OPTIONS.find((item) => item.value === String(rangeValue))?.label || "120日";
}

function getZoomChartWidth(rowCount, minWidth = 1050) {
  if (rowCount <= 30) return minWidth;
  if (rowCount <= 70) return Math.max(minWidth, rowCount * 24);
  if (rowCount <= 140) return Math.max(minWidth, rowCount * 18);
  return Math.max(minWidth, rowCount * 14);
}

function renderPriceChart(enrichedRows, options = {}) {
  const range = options.range || "120";
  const isZoom = Boolean(options.zoom);
  const rows = getChartRowsByRange(enrichedRows, range);

  if (rows.length < 2) {
    return renderEmptyChart("至少需要 2 筆行情資料，才能畫股價走勢圖。");
  }

  const width = isZoom ? getZoomChartWidth(rows.length, 1120) : 900;
  const height = isZoom ? 380 : 320;
  const left = isZoom ? 62 : 54;
  const right = 28;
  const top = isZoom ? 28 : 22;
  const bottom = isZoom ? 46 : 38;
  const chartWidth = width - left - right;
  const chartHeight = height - top - bottom;
  const valueCandidates = [];

  rows.forEach((row) => {
    [row.high, row.low, row.close, ...MOVING_AVERAGE_PERIODS.map((period) => row.ma[`ma${period}`])]
      .filter((value) => value !== null && value !== undefined && Number.isFinite(value))
      .forEach((value) => valueCandidates.push(value));
  });

  const minValue = Math.min(...valueCandidates);
  const maxValue = Math.max(...valueCandidates);
  const paddingValue = Math.max((maxValue - minValue) * 0.08, maxValue * 0.01, 1);
  const lowBound = minValue - paddingValue;
  const highBound = maxValue + paddingValue;
  const valueRange = highBound - lowBound || 1;
  const xStep = rows.length > 1 ? chartWidth / (rows.length - 1) : chartWidth;
  const candleWidth = Math.max(isZoom ? 4 : 3, Math.min(isZoom ? 14 : 9, xStep * 0.52));

  const xFor = (index) => left + index * xStep;
  const yFor = (value) => top + ((highBound - value) / valueRange) * chartHeight;
  const gridValues = Array.from({ length: 5 }, (_, index) => lowBound + (valueRange / 4) * index);

  const gridLines = gridValues.map((value) => {
    const y = yFor(value);
    return `
      <line class="chart-grid" x1="${left}" y1="${y}" x2="${width - right}" y2="${y}" />
      <text class="chart-axis-text" x="${left - 8}" y="${y + 4}" text-anchor="end">${formatPrice(value)}</text>
    `;
  }).join("");

  const candles = rows.map((row, index) => {
    const x = xFor(index);
    const open = row.open ?? row.close;
    const close = row.close ?? row.open;
    const high = row.high ?? Math.max(open, close);
    const low = row.low ?? Math.min(open, close);
    const yHigh = yFor(high);
    const yLow = yFor(low);
    const yOpen = yFor(open);
    const yClose = yFor(close);
    const rectY = Math.min(yOpen, yClose);
    const rectHeight = Math.max(Math.abs(yClose - yOpen), isZoom ? 2.4 : 2);
    const toneClass = getPriceDirectionClass(row.change, row.close, row.previousClose);
    const tone = toneClass === "price-up" ? "up" : toneClass === "price-down" ? "down" : "flat";

    return `
      <line class="candle-line candle-${tone}" x1="${x}" y1="${yHigh}" x2="${x}" y2="${yLow}" />
      <rect class="candle-body candle-${tone}" x="${x - candleWidth / 2}" y="${rectY}" width="${candleWidth}" height="${rectHeight}" rx="1.5" />
    `;
  }).join("");

  const maLines = MOVING_AVERAGE_PERIODS.map((period) => {
    const points = rows
      .map((row, index) => row.ma[`ma${period}`] === null ? null : svgPoint(xFor(index), yFor(row.ma[`ma${period}`])))
      .filter(Boolean)
      .join(" ");

    if (!points) return "";

    return `<polyline class="ma-line ma-${period}" points="${points}" />`;
  }).join("");

  const firstDate = rows[0]?.date || "";
  const lastDate = rows[rows.length - 1]?.date || "";
  const zoomClass = isZoom ? " zoom-scroll" : "";
  const svgStyle = isZoom ? ` style="width:${width}px"` : "";

  return `
    <div class="chart-scroll${zoomClass}" data-chart-scroll="true">
      <svg class="stock-chart price-chart" viewBox="0 0 ${width} ${height}"${svgStyle} role="img" aria-label="股價走勢圖">
        <rect class="chart-bg" x="0" y="0" width="${width}" height="${height}" rx="18" />
        ${gridLines}
        ${candles}
        ${maLines}
        <text class="chart-axis-text" x="${left}" y="${height - 12}" text-anchor="start">${escapeHtml(firstDate)}</text>
        <text class="chart-axis-text" x="${width - right}" y="${height - 12}" text-anchor="end">${escapeHtml(lastDate)}</text>
      </svg>
    </div>
  `;
}

function renderVolumeChart(enrichedRows, options = {}) {
  const range = options.range || "120";
  const isZoom = Boolean(options.zoom);
  const rows = getChartRowsByRange(enrichedRows, range);

  if (rows.length < 2) {
    return renderEmptyChart("至少需要 2 筆行情資料，才能畫成交量走勢圖。");
  }

  const width = isZoom ? getZoomChartWidth(rows.length, 1120) : 900;
  const height = isZoom ? 260 : 230;
  const left = isZoom ? 62 : 54;
  const right = 28;
  const top = 20;
  const bottom = isZoom ? 42 : 34;
  const chartWidth = width - left - right;
  const chartHeight = height - top - bottom;
  const maxVolume = Math.max(
    1,
    ...rows.flatMap((row) => [row.volume, row.mv.mv5, row.mv.mv20].filter((value) => value !== null && Number.isFinite(value))),
  );
  const xStep = rows.length > 1 ? chartWidth / (rows.length - 1) : chartWidth;
  const barWidth = Math.max(isZoom ? 4 : 3, Math.min(isZoom ? 16 : 10, xStep * 0.62));
  const xFor = (index) => left + index * xStep;
  const yFor = (value) => top + ((maxVolume - value) / maxVolume) * chartHeight;

  const gridValues = Array.from({ length: 4 }, (_, index) => (maxVolume / 3) * index);
  const gridLines = gridValues.map((value) => {
    const y = yFor(value);
    return `
      <line class="chart-grid" x1="${left}" y1="${y}" x2="${width - right}" y2="${y}" />
      <text class="chart-axis-text" x="${left - 8}" y="${y + 4}" text-anchor="end">${formatNumber(Math.round(value))}</text>
    `;
  }).join("");

  const bars = rows.map((row, index) => {
    const volume = row.volume ?? 0;
    const x = xFor(index);
    const y = yFor(volume);
    const barHeight = Math.max(top + chartHeight - y, 1);
    const toneClass = getPriceDirectionClass(row.change, row.close, row.previousClose);
    const tone = toneClass === "price-up" ? "up" : toneClass === "price-down" ? "down" : "flat";

    return `<rect class="volume-bar volume-${tone}" x="${x - barWidth / 2}" y="${y}" width="${barWidth}" height="${barHeight}" rx="1.5" />`;
  }).join("");

  const mvLines = VOLUME_AVERAGE_PERIODS.map((period) => {
    const points = rows
      .map((row, index) => row.mv[`mv${period}`] === null ? null : svgPoint(xFor(index), yFor(row.mv[`mv${period}`])))
      .filter(Boolean)
      .join(" ");

    if (!points) return "";

    return `<polyline class="ma-line mv-${period}" points="${points}" />`;
  }).join("");

  const firstDate = rows[0]?.date || "";
  const lastDate = rows[rows.length - 1]?.date || "";
  const zoomClass = isZoom ? " zoom-scroll" : "";
  const svgStyle = isZoom ? ` style="width:${width}px"` : "";

  return `
    <div class="chart-scroll${zoomClass}" data-chart-scroll="true">
      <svg class="stock-chart volume-chart" viewBox="0 0 ${width} ${height}"${svgStyle} role="img" aria-label="成交量走勢圖">
        <rect class="chart-bg" x="0" y="0" width="${width}" height="${height}" rx="18" />
        ${gridLines}
        ${bars}
        ${mvLines}
        <text class="chart-axis-text" x="${left}" y="${height - 11}" text-anchor="start">${escapeHtml(firstDate)}</text>
        <text class="chart-axis-text" x="${width - right}" y="${height - 11}" text-anchor="end">${escapeHtml(lastDate)}</text>
      </svg>
    </div>
  `;
}

function renderChartRangeButtons(activeRange) {
  return `
    <div class="chart-range-row" aria-label="圖表區間切換">
      ${CHART_RANGE_OPTIONS.map((item) => `
        <button class="chart-range-btn ${item.value === String(activeRange) ? "active" : ""}" type="button" data-chart-range="${escapeHtml(item.value)}">
          ${escapeHtml(item.label)}
        </button>
      `).join("")}
      <button class="chart-range-btn reset" type="button" data-chart-reset="true">重設</button>
    </div>
  `;
}

function renderChartZoomContent() {
  const rows = state.chartZoomRows || [];
  const range = state.chartZoomRange || "60";
  const visibleRows = getChartRowsByRange(rows, range);
  const availableCount = rows.length;
  const latestRow = rows[availableCount - 1] || {};
  const latestMv5 = latestRow.mv?.mv5;
  const latestMv20 = latestRow.mv?.mv20;

  if (rows.length < 2) {
    return renderEmptyChart("目前資料不足，還不能放大圖表。");
  }

  return `
    ${renderChartRangeButtons(range)}
    <div class="chart-zoom-hint">
      目前顯示 <strong>${escapeHtml(getChartRangeLabel(range))}</strong>，共 <strong>${visibleRows.length}</strong> 筆。圖表可左右拖曳，按「重設」會回到 60 日並移到最新資料。
    </div>
    <section class="detail-section chart-section chart-zoom-section">
      <div class="chart-title-row">
        <h3>股價走勢圖</h3>
        <span>${escapeHtml(visibleRows[0]?.date || "-")} ～ ${escapeHtml(visibleRows[visibleRows.length - 1]?.date || "-")}</span>
      </div>
      ${renderChartLegend(MOVING_AVERAGE_PERIODS.map((period) => ({ label: `MA${period}`, className: `legend-ma-${period}` })))}
      ${renderPriceChart(rows, { range, zoom: true })}
    </section>
    <section class="detail-section chart-section chart-zoom-section">
      <div class="chart-title-row">
        <h3>成交量走勢圖</h3>
        <span>MV5 / MV20</span>
      </div>
      ${renderChartLegend([
        { label: `MV5 ${latestMv5 !== null && latestMv5 !== undefined ? formatNumber(Math.round(latestMv5)) : `資料不足 ${availableCount}/5`}`, className: "legend-mv-5" },
        { label: `MV20 ${latestMv20 !== null && latestMv20 !== undefined ? formatNumber(Math.round(latestMv20)) : `資料不足 ${availableCount}/20`}`, className: "legend-mv-20" },
      ])}
      ${renderVolumeChart(rows, { range, zoom: true })}
    </section>
  `;
}

function scrollChartZoomToEnd() {
  window.setTimeout(() => {
    chartZoomContent?.querySelectorAll("[data-chart-scroll]").forEach((element) => {
      element.scrollLeft = element.scrollWidth;
    });
  }, 80);
}

function openChartZoom() {
  if (!chartZoomModal || !chartZoomContent) return;

  if (!state.chartZoomRows || state.chartZoomRows.length < 2) {
    showStatus("目前圖表資料不足，無法放大查看。", "error");
    return;
  }

  chartZoomTitle.textContent = state.chartZoomTitle || "技術圖表";
  chartZoomContent.innerHTML = renderChartZoomContent();
  chartZoomModal.classList.remove("hidden");
  chartZoomModal.setAttribute("aria-hidden", "false");
  document.body.classList.add("chart-zoom-open");
  scrollChartZoomToEnd();
}

function closeChartZoom() {
  if (!chartZoomModal) return;

  chartZoomModal.classList.add("hidden");
  chartZoomModal.setAttribute("aria-hidden", "true");
  document.body.classList.remove("chart-zoom-open");
}

function rerenderChartZoom(rangeValue) {
  state.chartZoomRange = rangeValue;
  chartZoomContent.innerHTML = renderChartZoomContent();
  scrollChartZoomToEnd();
}

function renderChartLegend(items) {
  return `
    <div class="chart-legend">
      ${items.map((item) => `<span class="legend-item ${escapeHtml(item.className || "")}"><span class="legend-dot"></span>${escapeHtml(item.label)}</span>`).join("")}
    </div>
  `;
}

function renderTechnicalCharts(enrichedRows) {
  const availableCount = enrichedRows.length;
  const latestRow = enrichedRows[availableCount - 1] || {};
  const latestMv5 = latestRow.mv?.mv5;
  const latestMv20 = latestRow.mv?.mv20;

  return `
    <section class="detail-section chart-section">
      <div class="chart-header-row">
        <div>
          <h3>股價走勢圖</h3>
          <p>預設顯示最近 ${Math.min(availableCount, 120)} 筆行情，點放大可切換區間。</p>
        </div>
        <button class="chart-expand-btn" type="button" data-chart-expand="true">放大圖表</button>
      </div>
      ${renderChartLegend(MOVING_AVERAGE_PERIODS.map((period) => ({ label: `MA${period}`, className: `legend-ma-${period}` })))}
      ${renderPriceChart(enrichedRows, { range: "120" })}
      <p class="chart-note">MA 是收盤價平均。若 K 棒太密，請按「放大圖表」切換 20 / 60 / 120 / 240 日。</p>
    </section>
    <section class="detail-section chart-section">
      <h3>成交量走勢圖</h3>
      ${renderChartLegend([
        { label: `MV5 ${latestMv5 !== null && latestMv5 !== undefined ? formatNumber(Math.round(latestMv5)) : `資料不足 ${availableCount}/5`}`, className: "legend-mv-5" },
        { label: `MV20 ${latestMv20 !== null && latestMv20 !== undefined ? formatNumber(Math.round(latestMv20)) : `資料不足 ${availableCount}/20`}`, className: "legend-mv-20" },
      ])}
      ${renderVolumeChart(enrichedRows, { range: "120" })}
      <p class="chart-note">成交量單位依資料庫目前匯入值顯示；若匯入程式為張數，這裡就是張數。</p>
    </section>
  `;
}

function renderLoadingCards() {
  stockList.innerHTML = Array.from({ length: 4 })
    .map(
      () => `
        <article class="stock-card loading-card">
          <div class="skeleton skeleton-title"></div>
          <div class="loading-grid">
            <div class="skeleton skeleton-text"></div>
            <div class="skeleton skeleton-text"></div>
            <div class="skeleton skeleton-text"></div>
            <div class="skeleton skeleton-text"></div>
          </div>
        </article>
      `
    )
    .join("");
}

function renderSearchIntro() {
  stockList.innerHTML = `
    <article class="search-intro-card">
      <div class="intro-icon">🔎</div>
      <h3>請輸入股票代號</h3>
      <p>例如輸入 <strong>2330</strong>，就可以查台積電的最新行情、三大法人與籌碼分數。</p>
      <div class="example-row" aria-label="查詢範例">
        <button class="example-btn" type="button" data-search-code="2330">查 2330</button>
        <button class="example-btn" type="button" data-search-code="2317">查 2317</button>
        <button class="example-btn" type="button" data-search-code="0050">查 0050</button>
      </div>
    </article>
  `;
}


function isAuthenticated() {
  return Boolean(state.authToken && state.user);
}

function getStockCodeFromRow(row) {
  return normalizeStockCode(pick(row, ["stock_code", "code"], ""));
}

function getWatchlistButton(stockCode) {
  const code = normalizeStockCode(stockCode);

  if (!code || code === "-") return "";

  if (!isAuthenticated()) {
    return `
      <button class="watch-btn login-required" type="button" data-watch-action="login" data-code="${escapeHtml(code)}">
        加入自選
      </button>
    `;
  }

  const isWatched = state.watchlistCodes.has(code);

  return `
    <button class="watch-btn ${isWatched ? "watched" : ""}" type="button" data-watch-action="${isWatched ? "remove" : "add"}" data-code="${escapeHtml(code)}">
      ${isWatched ? "已自選" : "加入自選"}
    </button>
  `;
}

function getWatchlistOrderButtons(stockCode, index = -1) {
  const code = normalizeStockCode(stockCode);

  if (state.page !== "watchlist" || !isAuthenticated() || index < 0) return "";

  const total = state.latestRows.length;
  const isFirst = index <= 0;
  const isLast = index >= total - 1;

  return `
    <div class="order-buttons" aria-label="調整自選股順序">
      <button class="order-btn" type="button" data-order-action="up" data-code="${escapeHtml(code)}" ${isFirst ? "disabled" : ""}>上移</button>
      <button class="order-btn" type="button" data-order-action="down" data-code="${escapeHtml(code)}" ${isLast ? "disabled" : ""}>下移</button>
    </div>
  `;
}

function getCardActionButtons(stockCode, detailText = "看明細", index = -1) {
  const code = normalizeStockCode(stockCode);

  return `
    <div class="action-buttons">
      ${getWatchlistOrderButtons(code, index)}
      ${getWatchlistButton(code)}
      <button class="detail-btn" type="button" data-code="${escapeHtml(code)}">${escapeHtml(detailText)}</button>
    </div>
  `;
}

async function refreshWatchlistCodes(rows = null) {
  if (!isAuthenticated()) {
    state.watchlistCodes = new Set();
    state.watchlistLoaded = false;
    return [];
  }

  const watchlistRows = rows || await fetchJson("/watchlist", {
    method: "GET",
    auth: true,
  });

  const safeRows = Array.isArray(watchlistRows) ? watchlistRows : [];
  state.watchlistCodes = new Set(safeRows.map(getStockCodeFromRow).filter(Boolean));
  state.watchlistLoaded = true;
  return safeRows;
}

function rerenderCurrentContent() {
  if (state.page === "search" && state.lastSearchData) {
    renderSearchResult(state.lastSearchData);
    return;
  }

  if (["radar", "foreign", "foreignStreak", "trust", "syncBuy"].includes(state.page) && state.latestRows.length > 0) {
    stockList.innerHTML = state.latestRows.map(renderStockCard).join("");
    return;
  }

  if (state.page === "strategyTracks") {
    renderStrategyTrackingPage();
    return;
  }

  if (state.page === "strategyBacktests") {
    renderStrategyBacktestPage();
    return;
  }

  if (state.page === "strategies") {
    renderStrategiesPage();
    return;
  }

  if (state.page === "alerts") {
    renderAlertsPage();
    return;
  }

  if (state.page === "account") {
    renderAccountPage();
  }
}

function renderWatchlistLoginPrompt() {
  stockList.innerHTML = `
    <article class="search-intro-card watchlist-login-card">
      <div class="intro-icon">⭐</div>
      <h3>請先登入 Google 帳號</h3>
      <p>登入後就可以把股票加入自選股，而且每個 Google 帳號看到的清單都不一樣。</p>
      <div class="example-row">
        <button class="example-btn" type="button" data-go-account="true">前往登入</button>
      </div>
    </article>
  `;
}

function renderEmptyWatchlist() {
  stockList.innerHTML = `
    <article class="search-intro-card watchlist-empty-card">
      <div class="intro-icon">⭐</div>
      <h3>目前還沒有自選股</h3>
      <p>可以先到「今日雷達」或「個股查詢」，看到想追蹤的股票後按「加入自選」。</p>
      <div class="example-row">
        <button class="example-btn" type="button" data-go-page="radar">看今日雷達</button>
        <button class="example-btn" type="button" data-go-page="search">去個股查詢</button>
      </div>
    </article>
  `;
}

async function handleWatchlistAction(button) {
  const action = button.dataset.watchAction;
  const stockCode = normalizeStockCode(button.dataset.code);

  if (!stockCode) return;

  if (action === "login") {
    showStatus("請先使用 Google 帳號登入，登入後就能加入自選股。", "error");
    switchPage("account");
    return;
  }

  if (!isAuthenticated()) {
    showStatus("請先使用 Google 帳號登入。", "error");
    switchPage("account");
    return;
  }

  button.disabled = true;
  const originalText = button.textContent;
  button.textContent = action === "remove" ? "移除中..." : "加入中...";

  try {
    if (action === "remove") {
      await fetchJson(`/watchlist/${encodeURIComponent(stockCode)}`, {
        method: "DELETE",
        auth: true,
      });
      state.watchlistCodes.delete(stockCode);

      if (state.page === "watchlist") {
        await loadList();
      } else {
        rerenderCurrentContent();
      }

      showTemporaryStatus(`已移除自選股：${escapeHtml(stockCode)}`, "success");
      return;
    }

    await fetchJson("/watchlist", {
      method: "POST",
      auth: true,
      body: {
        stock_code: stockCode,
      },
    });
    state.watchlistCodes.add(stockCode);
    rerenderCurrentContent();
    showTemporaryStatus(`已加入自選股：${escapeHtml(stockCode)}`, "success");
  } catch (error) {
    showStatus(`自選股操作失敗：${escapeHtml(error.message)}`, "error");
    button.disabled = false;
    button.textContent = originalText;
  }
}


async function handleWatchlistOrder(button) {
  if (state.page !== "watchlist" || !isAuthenticated()) return;

  const stockCode = normalizeStockCode(button.dataset.code);
  const action = button.dataset.orderAction;
  const currentIndex = state.latestRows.findIndex((row) => getStockCodeFromRow(row) === stockCode);
  const targetIndex = action === "up" ? currentIndex - 1 : currentIndex + 1;

  if (!stockCode || currentIndex < 0 || targetIndex < 0 || targetIndex >= state.latestRows.length) return;

  const previousRows = [...state.latestRows];
  const nextRows = [...state.latestRows];
  [nextRows[currentIndex], nextRows[targetIndex]] = [nextRows[targetIndex], nextRows[currentIndex]];

  button.disabled = true;
  state.latestRows = nextRows;
  stockList.innerHTML = state.latestRows.map(renderStockCard).join("");
  showStatus("正在儲存自選股順序...", "success");

  try {
    const savedRows = await fetchJson("/watchlist/order", {
      method: "PATCH",
      auth: true,
      body: {
        stock_codes: nextRows.map(getStockCodeFromRow).filter(Boolean),
      },
    });

    if (Array.isArray(savedRows)) {
      state.latestRows = savedRows;
    }

    await refreshWatchlistCodes(state.latestRows);
    stockList.innerHTML = state.latestRows.map(renderStockCard).join("");
    showTemporaryStatus("自選股順序已更新。", "success");
  } catch (error) {
    state.latestRows = previousRows;
    stockList.innerHTML = state.latestRows.map(renderStockCard).join("");
    showStatus(`自選股排序失敗：${escapeHtml(error.message)}`, "error");
  }
}



function getGoogleClientId() {
  const config = window.STOCK_RADAR_CONFIG || {};
  return String(config.GOOGLE_CLIENT_ID || "").trim();
}

function isGoogleClientConfigured() {
  const clientId = getGoogleClientId();
  return Boolean(clientId && !clientId.includes("請填入") && clientId.includes(".apps.googleusercontent.com"));
}

function getUserDisplayName() {
  return state.user?.display_name || state.user?.email || "使用者";
}

function renderAuthHeader() {
  if (!authMiniCard) return;

  if (state.user) {
    authMiniCard.innerHTML = `
      <span class="auth-dot online"></span>
      <span>${escapeHtml(getUserDisplayName())}</span>
    `;
    authMiniCard.classList.add("logged-in");
    return;
  }

  authMiniCard.innerHTML = `
    <span class="auth-dot"></span>
    <span>登入</span>
  `;
  authMiniCard.classList.remove("logged-in");
}

function saveAuthSession(authData) {
  state.authToken = authData?.token || "";
  state.user = authData?.user || null;
  state.watchlistCodes = new Set();
  state.watchlistLoaded = false;

  if (state.authToken) {
    window.localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, state.authToken);
  }

  renderAuthHeader();
}

function clearAuthSession(showMessage = true) {
  state.authToken = "";
  state.user = null;
  state.watchlistCodes = new Set();
  state.watchlistLoaded = false;
  window.localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
  renderAuthHeader();
  updateAlertsBadge();

  if (showMessage) {
    showTemporaryStatus("已登出。", "success");
  }
}

async function loadCurrentUser() {
  if (!state.authToken) {
    renderAuthHeader();
    return;
  }

  try {
    const data = await fetchJson("/auth/me", {
      method: "GET",
      auth: true,
    });
    state.user = data.user || null;

    if (state.user) {
      try {
        await refreshWatchlistCodes();
      } catch (watchlistError) {
        console.warn("Load watchlist codes failed:", watchlistError);
      }
    }
  } catch (error) {
    clearAuthSession(false);
  } finally {
    renderAuthHeader();
    await updateAlertsBadge();
  }
}

async function handleGoogleCredential(response) {
  try {
    const credential = response?.credential;

    if (!credential) {
      throw new Error("沒有收到 Google 登入憑證，請重新登入。");
    }

    showStatus("正在確認 Google 帳號...", "success");

    const data = await fetchJson("/auth/google", {
      method: "POST",
      body: { credential },
    });

    saveAuthSession(data);
    await refreshWatchlistCodes();
    await updateAlertsBadge();
    renderAccountPage();
    showTemporaryStatus(`登入成功：${escapeHtml(getUserDisplayName())}`, "success");
  } catch (error) {
    showStatus(`Google 登入失敗：${escapeHtml(error.message)}`, "error");
    renderGoogleButton();
  }
}

function renderGoogleButton() {
  const buttonBox = document.getElementById("googleSignInButton");
  const messageBox = document.getElementById("googleLoginMessage");

  if (!buttonBox) return;

  if (!isGoogleClientConfigured()) {
    buttonBox.innerHTML = "";
    if (messageBox) {
      messageBox.innerHTML = `
        <strong>尚未設定 Google Client ID。</strong><br />
        請先打開 <code>config.js</code>，把 <code>GOOGLE_CLIENT_ID</code> 改成你的 OAuth Client ID。
      `;
    }
    return;
  }

  if (!window.google?.accounts?.id) {
    if (messageBox) messageBox.textContent = "Google 登入元件載入中，請稍候。";
    if (googleButtonRenderTimer) window.clearTimeout(googleButtonRenderTimer);
    googleButtonRenderTimer = window.setTimeout(renderGoogleButton, 500);
    return;
  }

  buttonBox.innerHTML = "";
  window.google.accounts.id.initialize({
    client_id: getGoogleClientId(),
    callback: handleGoogleCredential,
    auto_select: false,
    cancel_on_tap_outside: true,
  });
  window.google.accounts.id.renderButton(buttonBox, {
    type: "standard",
    theme: "outline",
    size: "large",
    shape: "pill",
    text: "signin_with",
    width: 300,
  });

  if (messageBox) {
    messageBox.textContent = "點上方按鈕，選擇你的 Google 帳號登入。";
  }
}




function getStrategyTrackKey(stockCode, strategyKey) {
  const code = normalizeStockCode(stockCode);
  const key = String(strategyKey || state.strategyKey || "").trim();
  return code && key ? `${key}::${code}` : "";
}

async function refreshStrategyTrackKeys(rows = null) {
  if (!isAuthenticated()) {
    state.strategyTrackKeys = new Set();
    return [];
  }

  const trackRows = rows || await fetchJson("/strategy-watchlist?active=1&limit=200", {
    method: "GET",
    auth: true,
  });
  const safeRows = Array.isArray(trackRows) ? trackRows : [];
  state.strategyTrackKeys = new Set(
    safeRows
      .map((row) => getStrategyTrackKey(row.stock_code, row.strategy_key))
      .filter(Boolean)
  );
  return safeRows;
}

function getStrategyTrackButton(row, index = -1) {
  const code = normalizeStockCode(pick(row, ["stock_code", "code"], ""));
  const strategyKey = pick(row, ["strategy_key"], state.strategyKey);

  if (!code || code === "-") return "";

  if (!isAuthenticated()) {
    return `
      <button class="strategy-track-btn login-required" type="button" data-strategy-track-action="login" data-code="${escapeHtml(code)}">
        策略追蹤
      </button>
    `;
  }

  const trackKey = getStrategyTrackKey(code, strategyKey);
  const isTracked = state.strategyTrackKeys.has(trackKey);

  return `
    <button class="strategy-track-btn ${isTracked ? "tracked" : ""}" type="button" data-strategy-track-action="${isTracked ? "view" : "add"}" data-strategy-row-index="${index}" data-code="${escapeHtml(code)}" data-track-strategy-key="${escapeHtml(strategyKey)}">
      ${isTracked ? "已追蹤" : "策略追蹤"}
    </button>
  `;
}

function getStrategyTrackPayload(row, index = 0) {
  return {
    stock_code: normalizeStockCode(pick(row, ["stock_code", "code"], "")),
    stock_name: pick(row, ["stock_name", "name"], ""),
    market_type: pick(row, ["market_type", "market"], ""),
    industry: pick(row, ["industry", "fund_type"], ""),
    strategy_key: pick(row, ["strategy_key"], state.strategyKey),
    strategy_name: pick(row, ["strategy_name"], getStrategyOption().name),
    source_trade_date: pick(row, ["trade_date", "data_date", "event_date"], state.strategySummary?.trade_date || ""),
    source_score: pick(row, ["strategy_score", "chip_score", "major_holder_score"], null),
    source_rank: index + 1,
    trigger_summary: pick(row, ["trigger_summary", "title"], "符合策略條件"),
  };
}

function handleStrategyPerformanceMetric(button) {
  const metric = button.dataset.strategyPerformanceMetric;
  if (!STRATEGY_PERFORMANCE_METRICS.some((item) => item.key === metric)) return;
  state.strategyPerformanceMetric = metric;
  loadStrategyTracking();
}

function handleStrategyTrackFilterSubmit(form) {
  const formData = new FormData(form);
  const strategy = String(formData.get("strategy") || "").trim();
  const status = String(formData.get("status") || "").trim();
  const sort = String(formData.get("sort") || "created_desc").trim();
  const search = String(formData.get("search") || "").trim().slice(0, 50);

  state.strategyTrackFilterStrategy = getStrategyOptions().some((item) => item.key === strategy) ? strategy : "";
  state.strategyTrackFilterStatus = STRATEGY_TRACK_STATUS_OPTIONS.some((item) => item.key === status) ? status : "";
  state.strategyTrackSort = STRATEGY_TRACK_SORT_OPTIONS.some((item) => item.key === sort) ? sort : "created_desc";
  state.strategyTrackSearch = search;

  loadStrategyTracking();
}

function resetStrategyTrackFilters() {
  state.strategyTrackFilterStrategy = "";
  state.strategyTrackFilterStatus = "";
  state.strategyTrackSearch = "";
  state.strategyTrackSort = "created_desc";
  loadStrategyTracking();
}

async function handleStrategyTrackAction(button) {
  const action = button.dataset.strategyTrackAction;

  if (action === "login") {
    showStatus("請先使用 Google 帳號登入，登入後才能加入策略追蹤。", "error");
    switchPage("account");
    return;
  }

  if (!isAuthenticated()) {
    showStatus("請先使用 Google 帳號登入。", "error");
    switchPage("account");
    return;
  }

  if (action === "view") {
    switchPage("strategyTracks");
    return;
  }

  const rowIndex = Number(button.dataset.strategyRowIndex || -1);
  const row = Number.isInteger(rowIndex) && rowIndex >= 0 ? state.latestRows[rowIndex] : null;

  if (!row) {
    showStatus("找不到要加入策略追蹤的資料，請重新整理後再試。", "error");
    return;
  }

  button.disabled = true;
  const originalText = button.textContent;
  button.textContent = "加入中...";

  try {
    const payload = getStrategyTrackPayload(row, rowIndex);
    await fetchJson("/strategy-watchlist", {
      method: "POST",
      auth: true,
      body: payload,
    });
    state.strategyTrackKeys.add(getStrategyTrackKey(payload.stock_code, payload.strategy_key));
    rerenderCurrentContent();
    showTemporaryStatus(`已加入策略追蹤：${escapeHtml(payload.stock_code)} ${escapeHtml(payload.strategy_name)}`, "success");
  } catch (error) {
    showStatus(`加入策略追蹤失敗：${escapeHtml(error.message)}`, "error");
    button.disabled = false;
    button.textContent = originalText;
  }
}

async function handleStrategyTrackRemove(button) {
  if (!isAuthenticated()) return;

  const trackId = button.dataset.strategyTrackRemove;
  if (!trackId) return;

  button.disabled = true;
  const originalText = button.textContent;
  button.textContent = "移除中...";

  try {
    await fetchJson(`/strategy-watchlist/${encodeURIComponent(trackId)}`, {
      method: "DELETE",
      auth: true,
    });
    await loadStrategyTracking();
    showTemporaryStatus("已移除策略追蹤。", "success");
  } catch (error) {
    showStatus(`移除策略追蹤失敗：${escapeHtml(error.message)}`, "error");
    button.disabled = false;
    button.textContent = originalText;
  }
}

async function handleStrategyRiskSettingSubmit(form) {
  const trackId = form.dataset.trackId;
  const submitButton = form.querySelector('button[type="submit"]');
  const originalText = submitButton?.textContent || "儲存停利停損";
  const formData = new FormData(form);

  if (!trackId) {
    showStatus("策略追蹤 ID 遺失，無法儲存停利停損設定。", "error");
    return;
  }

  try {
    if (submitButton) {
      submitButton.disabled = true;
      submitButton.textContent = "儲存中...";
    }

    await fetchJson(`/strategy-watchlist/${encodeURIComponent(trackId)}/risk-settings`, {
      method: "PATCH",
      auth: true,
      body: {
        take_profit_percent: formData.get("take_profit_percent"),
        stop_loss_percent: formData.get("stop_loss_percent"),
      },
      raw: true,
    });

    await loadStrategyTracking();
    showTemporaryStatus("已更新停利停損觀察設定。", "success");
  } catch (error) {
    showStatus(`儲存停利停損失敗：${escapeHtml(error.message)}`, "error");
  } finally {
    if (submitButton) {
      submitButton.disabled = false;
      submitButton.textContent = originalText;
    }
  }
}

function renderStrategyTrackingLoginPrompt() {
  stockList.innerHTML = `
    <article class="search-intro-card watchlist-login-card">
      <div class="intro-icon">📌</div>
      <h3>請先登入 Google 帳號</h3>
      <p>登入後可以保存從策略選股加入的追蹤名單，之後回來看它的後續表現。</p>
      <div class="example-row">
        <button class="example-btn" type="button" data-go-account="true">前往登入</button>
      </div>
    </article>
  `;
}

function renderStrategyTrackingFilters(resultCount = 0) {
  const strategyOptions = getStrategyOptions();
  const hasFilters = hasStrategyTrackFilters();

  return `
    <section class="strategy-dashboard-card strategy-track-filter-card">
      <div class="alerts-dashboard-header strategy-dashboard-header">
        <div>
          <p class="section-kicker">V1.3-2-7 停利停損觀察</p>
          <h3>策略追蹤篩選</h3>
          <p>依策略、股票、停利停損狀態與報酬排序，快速找出已達停利或已達停損的追蹤股票。</p>
        </div>
        <div class="strategy-meta-box">
          <span>${escapeHtml(buildStrategyTrackingFilterSummary(resultCount))}</span>
        </div>
      </div>

      <form class="strategy-track-filter-form" data-strategy-track-filter-form>
        <label>
          <span>搜尋股票 / 產業</span>
          <input name="search" type="search" value="${escapeHtml(state.strategyTrackSearch)}" placeholder="例如：2330、台積電、半導體" />
        </label>
        <label>
          <span>來源策略</span>
          <select name="strategy">
            <option value="">全部策略</option>
            ${strategyOptions.map((item) => `
              <option value="${escapeHtml(item.key)}" ${item.key === state.strategyTrackFilterStrategy ? "selected" : ""}>${escapeHtml(item.name)}</option>
            `).join("")}
          </select>
        </label>
        <label>
          <span>表現狀態</span>
          <select name="status">
            ${STRATEGY_TRACK_STATUS_OPTIONS.map((item) => `
              <option value="${escapeHtml(item.key)}" ${item.key === state.strategyTrackFilterStatus ? "selected" : ""}>${escapeHtml(item.label)}</option>
            `).join("")}
          </select>
        </label>
        <label>
          <span>排序方式</span>
          <select name="sort">
            ${STRATEGY_TRACK_SORT_OPTIONS.map((item) => `
              <option value="${escapeHtml(item.key)}" ${item.key === state.strategyTrackSort ? "selected" : ""}>${escapeHtml(item.label)}</option>
            `).join("")}
          </select>
        </label>
        <div class="strategy-track-filter-actions">
          <button class="search-btn" type="submit">套用篩選</button>
          <button class="ghost-btn" type="button" data-strategy-track-filter-reset="true" ${hasFilters ? "" : "disabled"}>清除篩選</button>
        </div>
      </form>
    </section>
  `;
}

function renderEmptyStrategyTracking() {
  const hasFilters = hasStrategyTrackFilters();
  stockList.innerHTML = `
    ${renderStrategyTrackingFilters(0)}
    <article class="search-intro-card strategies-empty-card">
      <div class="intro-icon">📌</div>
      <h3>${hasFilters ? "目前沒有符合篩選條件的策略追蹤" : "目前還沒有策略追蹤"}</h3>
      <p>${hasFilters ? "可以清除篩選、改用其他排序，或回到策略選股加入更多追蹤標的。" : "請先到「策略選股」，看到想觀察的股票後按「策略追蹤」。"}</p>
      <div class="example-row">
        ${hasFilters ? `<button class="example-btn" type="button" data-strategy-track-filter-reset="true">清除篩選</button>` : ""}
        <button class="example-btn" type="button" data-go-page="strategies">去策略選股</button>
      </div>
    </article>
  `;
}

function renderStrategyPerformanceMetricButtons() {
  return `
    <div class="strategy-performance-tabs" role="group" aria-label="切換策略績效指標">
      ${STRATEGY_PERFORMANCE_METRICS.map((metric) => `
        <button class="filter-chip ${state.strategyPerformanceMetric === metric.key ? "active" : ""}" type="button" data-strategy-performance-metric="${escapeHtml(metric.key)}">
          ${escapeHtml(metric.label)}
        </button>
      `).join("")}
    </div>
  `;
}

function renderStrategyTrackingSummary(rowsOverride = null) {
  const rows = Array.isArray(rowsOverride) ? rowsOverride : getVisibleStrategyTrackingRows();
  const apiSummary = state.strategyTrackSummary || {};
  const localSummary = buildStrategyPerformanceSummary(rows, state.strategyPerformanceMetric);
  const summary = apiSummary.performance && apiSummary.performance.metric === localSummary.metric.key ? apiSummary.performance : null;
  const metric = localSummary.metric;
  const avgReturn = summary?.avg_return ?? localSummary.avgReturn;
  const winRate = summary?.win_rate ?? localSummary.winRate;
  const positiveCount = summary?.positive_count ?? localSummary.positiveCount;
  const negativeCount = summary?.negative_count ?? localSummary.negativeCount;
  const pendingCount = summary?.pending_count ?? localSummary.pendingCount;
  const best = localSummary.best;
  const worst = localSummary.worst;
  const byStrategy = buildStrategyPerformanceByStrategy(rows, state.strategyPerformanceMetric).slice(0, 6);
  const riskSummary = buildStrategyRiskSummary(rows);

  return `
    <section class="strategy-dashboard-card strategy-track-summary-card">
      <div class="alerts-dashboard-header strategy-dashboard-header">
        <div>
          <p class="section-kicker">V1.3-2-5 策略追蹤績效</p>
          <h3>策略追蹤績效排行榜</h3>
          <p>用 ${escapeHtml(metric.label)} 檢查策略追蹤後續表現，快速看哪個策略、哪檔股票目前效果最好。</p>
        </div>
        <div class="strategy-meta-box">
          <span>追蹤中：${formatNumber(apiSummary.active_count ?? rows.length ?? 0)}</span>
          <span>全部：${formatNumber(apiSummary.total_count ?? rows.length ?? 0)}</span>
        </div>
      </div>

      ${renderStrategyPerformanceMetricButtons()}

      <div class="strategy-performance-stat-grid">
        <div class="performance-stat-card">
          <span class="stat-label">平均${escapeHtml(metric.shortLabel)}</span>
          <strong class="${getReturnClass(avgReturn)}">${formatReturnPercent(avgReturn)}</strong>
        </div>
        <div class="performance-stat-card">
          <span class="stat-label">正報酬比例</span>
          <strong>${winRate === null || winRate === undefined ? "待資料" : formatReturnPercent(winRate).replace(/^\+/, "")}</strong>
        </div>
        <div class="performance-stat-card">
          <span class="stat-label">正 / 負 / 待資料</span>
          <strong>${formatNumber(positiveCount)} / ${formatNumber(negativeCount)} / ${formatNumber(pendingCount)}</strong>
        </div>
        <div class="performance-stat-card">
          <span class="stat-label">目前最佳追蹤</span>
          <strong>${best ? `${escapeHtml(best.stock_code)} ${escapeHtml(best.stock_name || "")}` : "待資料"}</strong>
          ${best ? `<small class="${getReturnClass(getStrategyPerformanceValue(best, metric.key))}">${formatReturnPercent(getStrategyPerformanceValue(best, metric.key))}</small>` : ""}
        </div>
      </div>

      <div class="strategy-risk-stat-grid">
        <div class="performance-stat-card risk-profit-card">
          <span class="stat-label">已達停利</span>
          <strong class="price-up">${formatNumber(riskSummary.takeProfit)}</strong>
        </div>
        <div class="performance-stat-card risk-loss-card">
          <span class="stat-label">已達停損</span>
          <strong class="price-down">${formatNumber(riskSummary.stopLoss)}</strong>
        </div>
        <div class="performance-stat-card">
          <span class="stat-label">未觸發 / 待資料</span>
          <strong>${formatNumber(riskSummary.inRange)} / ${formatNumber(riskSummary.pending)}</strong>
        </div>
      </div>

      <div class="strategy-ranking-grid">
        <article class="strategy-ranking-card best-ranking-card">
          <h4>最佳股票排行</h4>
          ${rows
            .filter((row) => getStrategyPerformanceValue(row, metric.key) !== null)
            .sort((a, b) => getStrategyPerformanceValue(b, metric.key) - getStrategyPerformanceValue(a, metric.key))
            .slice(0, 5)
            .map((row, index) => `
              <div class="ranking-row">
                <span>${index + 1}. ${escapeHtml(row.stock_code)} ${escapeHtml(row.stock_name || "")}</span>
                <strong class="${getReturnClass(getStrategyPerformanceValue(row, metric.key))}">${formatReturnPercent(getStrategyPerformanceValue(row, metric.key))}</strong>
              </div>
            `).join("") || `<p class="muted-text">目前還沒有足夠價格資料。</p>`}
        </article>

        <article class="strategy-ranking-card weak-ranking-card">
          <h4>最弱股票排行</h4>
          ${rows
            .filter((row) => getStrategyPerformanceValue(row, metric.key) !== null)
            .sort((a, b) => getStrategyPerformanceValue(a, metric.key) - getStrategyPerformanceValue(b, metric.key))
            .slice(0, 5)
            .map((row, index) => `
              <div class="ranking-row">
                <span>${index + 1}. ${escapeHtml(row.stock_code)} ${escapeHtml(row.stock_name || "")}</span>
                <strong class="${getReturnClass(getStrategyPerformanceValue(row, metric.key))}">${formatReturnPercent(getStrategyPerformanceValue(row, metric.key))}</strong>
              </div>
            `).join("") || `<p class="muted-text">目前還沒有足夠價格資料。</p>`}
        </article>
      </div>

      ${byStrategy.length ? `
        <div class="strategy-rank-table">
          <h4>各策略目前表現</h4>
          ${byStrategy.map((item, index) => `
            <div class="strategy-rank-row">
              <span>${index + 1}. ${escapeHtml(item.strategy_name)}</span>
              <strong class="${getReturnClass(item.avgReturn)}">平均 ${formatReturnPercent(item.avgReturn)}</strong>
              <small>正報酬 ${item.winRate === null ? "待資料" : formatReturnPercent(item.winRate).replace(/^\+/, "")}</small>
              <small>樣本 ${formatNumber(item.available)} / ${formatNumber(item.total)}</small>
            </div>
          `).join("")}
        </div>
      ` : ""}
    </section>
  `;
}

function renderPerformancePill(label, value, date) {
  return `
    <div class="performance-pill">
      <span>${escapeHtml(label)}</span>
      <strong class="${getReturnClass(value)}">${formatReturnPercent(value)}</strong>
      <small>${date ? formatDate(date) : "待資料"}</small>
    </div>
  `;
}

function renderStrategyRiskPanel(row) {
  const trackId = pick(row, ["id"], "");
  const takeProfit = formatRiskThreshold(pick(row, ["take_profit_percent"], 5), 5);
  const stopLoss = formatRiskThreshold(pick(row, ["stop_loss_percent"], 3), 3);
  const status = pick(row, ["risk_observation_status"], "等待資料");
  const riskClass = getRiskObservationClass(row);
  const distanceToProfit = pick(row, ["distance_to_take_profit_percent"], null);
  const distanceToStop = pick(row, ["distance_to_stop_loss_percent"], null);

  return `
    <div class="strategy-risk-panel ${escapeHtml(pick(row, ["risk_observation_key"], "pending"))}">
      <div class="strategy-risk-header">
        <div>
          <strong>停利 / 停損觀察</strong>
          <span>目前：<b class="${riskClass}">${escapeHtml(status)}</b></span>
        </div>
        <div class="strategy-risk-distance">
          <span>距停利：${formatReturnPercent(distanceToProfit)}</span>
          <span>距停損：${formatReturnPercent(distanceToStop)}</span>
        </div>
      </div>
      <form class="strategy-risk-form" data-strategy-risk-form data-track-id="${escapeHtml(trackId)}">
        <label>
          <span>停利 %</span>
          <input name="take_profit_percent" type="number" step="0.1" min="0.1" max="50" value="${escapeHtml(takeProfit)}" />
        </label>
        <label>
          <span>停損 %</span>
          <input name="stop_loss_percent" type="number" step="0.1" min="0.1" max="50" value="${escapeHtml(stopLoss)}" />
        </label>
        <button class="watch-btn" type="submit">儲存停利停損</button>
      </form>
    </div>
  `;
}

function renderStrategyTrackingCard(row, index) {
  const code = pick(row, ["stock_code"], "-");
  const name = pick(row, ["stock_name"], code);
  const market = pick(row, ["market_type"], "-");
  const industry = pick(row, ["industry"], "-");
  const strategyName = pick(row, ["strategy_name"], "策略追蹤");
  const sourceDate = pick(row, ["source_trade_date"], "-");
  const sourceScore = pick(row, ["source_score"], "-");
  const currentScore = pick(row, ["chip_score"], "-");
  const closePrice = pick(row, ["close_price", "current_price"], "-");
  const change = pick(row, ["price_change"], "-");
  const trigger = pick(row, ["trigger_summary"], "從策略選股加入追蹤");
  const createdAt = pick(row, ["created_at"], "-");
  const selectedReturn = getStrategyPerformanceValue(row, state.strategyPerformanceMetric);
  const toneClass = getReturnClass(selectedReturn);

  const items = [
    createInfoItem("來源策略", escapeHtml(strategyName)),
    createInfoItem("加入時分數", formatNumber(sourceScore)),
    createInfoItem("目前籌碼分數", formatNumber(currentScore), getScoreClass(currentScore)),
    createInfoItem("加入價", `${formatPrice(pick(row, ["entry_price"], "-"))} / ${formatDate(pick(row, ["entry_price_date"], "-"))}`),
    createInfoItem("目前收盤價", formatDirectionalClosePrice(closePrice, change)),
    createInfoItem("表現狀態", escapeHtml(pick(row, ["performance_status"], "等待資料")), toneClass),
    createInfoItem("停利門檻", `${formatRiskThreshold(pick(row, ["take_profit_percent"], 5), 5)}%`),
    createInfoItem("停損門檻", `${formatRiskThreshold(pick(row, ["stop_loss_percent"], 3), 3)}%`),
    createInfoItem("風控狀態", escapeHtml(pick(row, ["risk_observation_status"], "等待資料")), getRiskObservationClass(row)),
  ].join("");

  return `
    <article class="stock-card strategy-track-card">
      <div class="stock-top">
        <div class="stock-main">
          <span class="rank-badge">追蹤 ${index + 1}</span>
          <div class="stock-name">
            <h3>${escapeHtml(name)}</h3>
            <span class="stock-code">${escapeHtml(code)}</span>
            <span class="badge">${escapeHtml(market)}</span>
            <span class="badge">${escapeHtml(industry)}</span>
          </div>
        </div>
        <div class="score-box ${toneClass}">
          <span class="score-value">${formatReturnPercent(selectedReturn)}</span>
          <span class="score-label">${escapeHtml(getStrategyPerformanceMetric().shortLabel)}</span>
        </div>
      </div>
      <div class="quick-summary">
        <span class="summary-pill score-mid">${escapeHtml(strategyName)}</span>
        <span class="summary-text">${escapeHtml(trigger)}</span>
      </div>
      <div class="strategy-performance-pills">
        ${renderPerformancePill("1日", pick(row, ["return_1d_percent"], null), pick(row, ["price_after_1d_date"], ""))}
        ${renderPerformancePill("3日", pick(row, ["return_3d_percent"], null), pick(row, ["price_after_3d_date"], ""))}
        ${renderPerformancePill("5日", pick(row, ["return_5d_percent"], null), pick(row, ["price_after_5d_date"], ""))}
        ${renderPerformancePill("目前", pick(row, ["current_return_percent"], null), pick(row, ["latest_price_date"], ""))}
      </div>
      ${renderStrategyRiskPanel(row)}
      <div class="quick-summary secondary-summary price-summary">
        <span class="price-metric">來源日：${formatDate(sourceDate)}</span>
        <span class="price-metric">追蹤時間：${escapeHtml(createdAt)}</span>
      </div>
      <div class="info-grid strategy-info-grid">
        ${items}
      </div>
      <div class="card-actions">
        <span class="card-note">最新分數日：${formatDate(pick(row, ["latest_score_date", "latest_price_date"], "-"))}</span>
        <div class="action-buttons">
          <button class="watch-btn danger-action" type="button" data-strategy-track-remove="${escapeHtml(pick(row, ["id"], ""))}">移除追蹤</button>
          <button class="watch-btn" type="button" data-watch-action="add" data-code="${escapeHtml(code)}">加入自選</button>
          <button class="detail-btn" type="button" data-code="${escapeHtml(code)}">看明細</button>
        </div>
      </div>
    </article>
  `;
}

function renderStrategyTrackingPage() {
  const rows = getVisibleStrategyTrackingRows();

  if (rows.length === 0) {
    renderEmptyStrategyTracking();
    return;
  }

  stockList.innerHTML = `
    ${renderStrategyTrackingFilters(rows.length)}
    ${renderStrategyTrackingSummary(rows)}
    <div class="strategy-result-note">
      這裡只表示「追蹤後的統計結果」，不是買賣建議。樣本數少時，策略排名只能先當觀察參考。
    </div>
    ${rows.map(renderStrategyTrackingCard).join("")}
  `;
}

async function loadStrategyTracking() {
  if (!isAuthenticated()) {
    setLoading(false);
    renderStrategyTrackingLoginPrompt();
    return;
  }

  setLoading(true);
  renderLoadingCards();

  try {
    const result = await fetchJson(`/strategy-watchlist/performance?${buildStrategyTrackingQueryString()}`, {
      method: "GET",
      auth: true,
      raw: true,
    });
    state.latestRows = Array.isArray(result.data) ? result.data : [];
    state.strategyTrackSummary = result.summary || null;
    state.strategyTrackKeys = new Set(
      state.latestRows.map((row) => getStrategyTrackKey(row.stock_code, row.strategy_key)).filter(Boolean)
    );
    renderStrategyTrackingPage();
    showTemporaryStatus(`已更新 ${state.latestRows.length} 筆策略追蹤。`, "success");
  } catch (error) {
    state.latestRows = [];
    stockList.innerHTML = `
      <article class="search-intro-card error-card">
        <div class="intro-icon">⚠️</div>
        <h3>策略追蹤讀取失敗</h3>
        <p>${escapeHtml(error.message)}</p>
        <button class="retry-btn" type="button" id="retryBtn">重新讀取</button>
      </article>
    `;
    document.getElementById("retryBtn")?.addEventListener("click", loadList);
    showStatus(`策略追蹤讀取失敗：${escapeHtml(error.message)}`, "error");
  } finally {
    setLoading(false);
  }
}

function getStrategyToneClass(row) {
  const score = toNumber(pick(row, ["strategy_score", "chip_score", "major_holder_score"], null));
  if (score !== null && score >= 120) return "score-high";
  if (score !== null && score >= 80) return "score-mid";
  const chipScore = toNumber(pick(row, ["chip_score"], null));
  if (chipScore !== null && chipScore >= 80) return "score-high";
  if (chipScore !== null && chipScore >= 60) return "score-mid";
  return "score-low";
}

function renderStrategyButtons() {
  const options = getStrategyOptions();

  return `
    <section class="strategy-dashboard-card">
      <div class="alerts-dashboard-header strategy-dashboard-header">
        <div>
          <p class="section-kicker">V1.3-2 選股策略</p>
          <h3>策略清單</h3>
          <p>目前策略：${escapeHtml(getStrategyOption().name)}。可切換不同角度找觀察名單。</p>
        </div>
        <div class="strategy-meta-box">
          <span>市場：${escapeHtml(state.market || "全部")}</span>
          <span>筆數：${formatNumber(state.strategySummary?.count ?? state.latestRows.length ?? 0)}</span>
          <span>資料日：${formatDate(state.strategySummary?.trade_date || state.strategySummary?.reference_date)}</span>
        </div>
      </div>
      <div class="strategy-chip-row" aria-label="策略切換">
        ${options.map((item) => `
          <button class="strategy-chip ${item.key === state.strategyKey ? "active" : ""}" type="button" data-strategy-key="${escapeHtml(item.key)}">
            <strong>${escapeHtml(item.short_name || item.name)}</strong>
            <span>${escapeHtml(item.description || "")}</span>
          </button>
        `).join("")}
      </div>
      ${renderStrategyDefinitionPanel()}
    </section>
  `;
}

function getStrategyMetricItems(row) {
  const strategyKey = pick(row, ["strategy_key"], state.strategyKey);

  if (strategyKey === "major_holder_accumulate") {
    return [
      createInfoItem("大戶比重", formatPercent(pick(row, ["large_holder_ratio"]))),
      createInfoItem("比重變化", formatSignedNumber(pick(row, ["large_holder_ratio_change"]), "%"), getChangeClass(pick(row, ["large_holder_ratio_change"]))),
      createInfoItem("散戶變化", formatSignedNumber(pick(row, ["small_holder_ratio_change"]), "%"), getChangeClass(pick(row, ["small_holder_ratio_change"]))),
      createInfoItem("大戶分數", formatNumber(pick(row, ["strategy_score", "major_holder_score", "big_holder_score"]))),
    ];
  }

  if (strategyKey === "etf_calendar_watch") {
    return [
      createInfoItem("事件日期", formatDate(pick(row, ["event_date"]))),
      createInfoItem("剩餘天數", `${formatNumber(pick(row, ["days_left"]))} 天`),
      createInfoItem("事件類型", escapeHtml(pick(row, ["event_type"]))),
      createInfoItem("發行人", escapeHtml(pick(row, ["issuer"]))),
    ];
  }

  if (strategyKey === "capital_inflow") {
    return [
      createInfoItem("法人合計", `${formatLotsValue(pick(row, ["total_net_lots"]), pick(row, ["total_net"]))} 張`, getChangeClass(pick(row, ["total_net"]))),
      createInfoItem("外資", `${formatLotsValue(pick(row, ["foreign_net_lots"]), pick(row, ["foreign_net"]))} 張`, getChangeClass(pick(row, ["foreign_net"]))),
      createInfoItem("投信", `${formatLotsValue(pick(row, ["investment_trust_net_lots"]), pick(row, ["investment_trust_net"]))} 張`, getChangeClass(pick(row, ["investment_trust_net"]))),
      createInfoItem("籌碼分數", formatNumber(pick(row, ["chip_score"])), getScoreClass(pick(row, ["chip_score"]))),
    ];
  }

  return [
    createInfoItem("策略分數", formatNumber(pick(row, ["strategy_score", "chip_score"]))),
    createInfoItem("籌碼分數", formatNumber(pick(row, ["chip_score"])), getScoreClass(pick(row, ["chip_score"]))),
    createInfoItem("成交量", escapeHtml(pick(row, ["volume_status"], formatNumber(pick(row, ["volume"], "-"))))),
    createInfoItem("股價位置", escapeHtml(pick(row, ["price_position"], "-"))),
  ];
}

function renderStrategyCard(row, index) {
  const code = pick(row, ["stock_code"], "-");
  const name = pick(row, ["stock_name"], code);
  const market = pick(row, ["market_type", "market"], "-");
  const industry = pick(row, ["industry", "fund_type"], "-");
  const strategyName = pick(row, ["strategy_name"], getStrategyOption().name);
  const trigger = pick(row, ["trigger_summary", "title"], "符合目前策略條件");
  const tradeDate = pick(row, ["trade_date", "data_date", "event_date"], state.strategySummary?.trade_date || "-");
  const score = pick(row, ["strategy_score", "chip_score", "major_holder_score"], "-");
  const closePrice = pick(row, ["close_price"], "-");
  const change = pick(row, ["price_change"], "-");
  const toneClass = getStrategyToneClass(row);
  const metricItems = getStrategyMetricItems(row).join("");
  const isEtfEvent = pick(row, ["strategy_key"], state.strategyKey) === "etf_calendar_watch";

  return `
    <article class="stock-card strategy-card ${escapeHtml(state.strategyKey)}">
      <div class="stock-top">
        <div class="stock-main">
          <span class="rank-badge">第 ${index + 1} 名</span>
          <div class="stock-name">
            <h3>${escapeHtml(name)}</h3>
            <span class="stock-code">${escapeHtml(code)}</span>
            <span class="badge">${escapeHtml(market)}</span>
            <span class="badge">${escapeHtml(industry)}</span>
          </div>
        </div>
        <div class="score-box ${toneClass}">
          <span class="score-value">${formatNumber(score)}</span>
          <span class="score-label">策略分數</span>
        </div>
      </div>

      <div class="quick-summary">
        <span class="summary-pill ${toneClass}">${escapeHtml(strategyName)}</span>
        <span class="summary-text">${escapeHtml(trigger)}</span>
      </div>

      ${!isEtfEvent ? `
        <div class="quick-summary secondary-summary price-summary">
          <span class="price-metric">收盤 ${formatDirectionalClosePrice(closePrice, change)}</span>
          <span class="price-metric">漲跌 <strong class="${getChangeClass(change)}">${formatPrice(change)}</strong></span>
        </div>
      ` : `
        <div class="quick-summary secondary-summary price-summary">
          <span class="price-metric">${escapeHtml(pick(row, ["title"], "ETF 行事曆事件"))}</span>
          <span class="price-metric">重要性：${escapeHtml(pick(row, ["importance"], "normal"))}</span>
        </div>
      `}

      <div class="info-grid strategy-info-grid">
        ${metricItems}
      </div>

      ${renderScoreBreakdownItems(row)}
      ${renderStrategyReasonBox(row)}

      <div class="card-actions">
        <span class="card-note">資料日：${formatDate(tradeDate)}</span>
        <div class="action-buttons strategy-actions">
          ${getStrategyTrackButton(row, index)}
          ${getWatchlistButton(code)}
          <button class="detail-btn" type="button" data-code="${escapeHtml(code)}">${escapeHtml(isEtfEvent ? "看 ETF" : "看明細")}</button>
        </div>
      </div>
    </article>
  `;
}

function renderStrategiesPage() {
  const rows = Array.isArray(state.latestRows) ? state.latestRows : [];

  if (rows.length === 0) {
    stockList.innerHTML = `
      ${renderStrategyButtons()}
      <article class="search-intro-card strategies-empty-card">
        <div class="intro-icon">📊</div>
        <h3>目前沒有符合策略的股票</h3>
        <p>可以切換策略或市場，也可以等下一次每日資料更新後再查看。</p>
        ${renderStrategyEmptyTips()}
      </article>
    `;
    return;
  }

  stockList.innerHTML = `
    ${renderStrategyButtons()}
    <div class="strategy-result-note">
      目前顯示 <strong>${escapeHtml(getStrategyOption().name)}</strong>，共 <strong>${formatNumber(rows.length)}</strong> 筆。清單用途是快速篩選觀察股，不代表一定會上漲。
      <br><span>${escapeHtml(getStrategyOption().sort_reason || "分數越高、條件越完整，排序越前面。")}</span>
    </div>
    ${rows.map(renderStrategyCard).join("")}
  `;
}

async function loadStrategies() {
  setLoading(true);
  renderLoadingCards();

  try {
    const params = new URLSearchParams();
    params.set("strategy", state.strategyKey);
    params.set("limit", "30");
    if (state.market) params.set("market", state.market);

    const result = await fetchJson(`/strategies?${params.toString()}`, { raw: true });
    state.latestRows = Array.isArray(result.data) ? result.data : [];
    state.strategySummary = {
      count: result.count,
      trade_date: result.trade_date,
      reference_date: result.reference_date,
      market: result.market,
      strategy_name: result.strategy_name,
      strategy_definition: result.strategy_definition,
    };
    state.strategyOptions = Array.isArray(result.strategies) ? result.strategies : DEFAULT_STRATEGY_OPTIONS;
    if (isAuthenticated()) {
      try {
        await refreshStrategyTrackKeys();
      } catch (trackError) {
        console.warn("策略追蹤狀態讀取失敗", trackError);
      }
    }
    renderStrategiesPage();
    showTemporaryStatus(`已更新 ${escapeHtml(result.strategy_name || getStrategyOption().name)}：${state.latestRows.length} 筆。`, "success");
  } catch (error) {
    state.latestRows = [];
    stockList.innerHTML = `
      <article class="search-intro-card error-card">
        <div class="intro-icon">⚠️</div>
        <h3>策略選股讀取失敗</h3>
        <p>${escapeHtml(error.message)}</p>
        <button class="retry-btn" type="button" id="retryBtn">重新讀取</button>
      </article>
    `;
    document.getElementById("retryBtn")?.addEventListener("click", loadList);
    showStatus(`策略選股讀取失敗：${escapeHtml(error.message)}`, "error");
  } finally {
    setLoading(false);
  }
}

function handleStrategyChange(button) {
  const key = button.dataset.strategyKey;
  if (!key || key === state.strategyKey) return;
  state.strategyKey = key;
  state.strategySummary = null;
  loadList();
}

function getAlertTypeLabel(type) {
  const map = {
    foreign_buy_streak: "外資連買",
    investment_trust_buy_streak: "投信連買",
    major_holder_increase: "主力籌碼",
    volume_spike: "成交量放大",
    chip_score_threshold: "籌碼分數",
    calendar_event: "行事曆",
  };

  return map[type] || String(type || "提醒");
}

function getAlertLevelLabel(level) {
  return String(level || "normal") === "high" ? "高重要" : "一般";
}

function getAlertLevelClass(level) {
  return String(level || "normal") === "high" ? "high" : "normal";
}

function isUnreadAlert(row) {
  return Number(row?.is_read || 0) === 0;
}

function getAlertFilterQuery() {
  const params = new URLSearchParams();
  params.set("limit", "50");

  if (state.alertFilter === "unread") params.set("unread", "1");
  if (state.alertFilter === "read") params.set("is_read", "1");
  if (state.alertFilter === "high") params.set("alert_level", "high");

  return `/watchlist/alerts?${params.toString()}`;
}

function renderAlertsLoginPrompt() {
  stockList.innerHTML = `
    <article class="search-intro-card alerts-login-card">
      <div class="intro-icon">🔔</div>
      <h3>請先登入 Google 帳號</h3>
      <p>提醒中心會依照你的自選股產生提醒，所以需要先登入才能讀取。</p>
      <div class="example-row">
        <button class="example-btn" type="button" data-go-account="true">前往登入</button>
      </div>
    </article>
  `;
}

function renderEmptyAlerts() {
  return `
    <article class="search-intro-card alerts-empty-card">
      <div class="intro-icon">🔕</div>
      <h3>目前沒有符合條件的提醒</h3>
      <p>可以切換成「全部」查看歷史提醒，或到自選股加入更多股票。</p>
      <div class="example-row">
        <button class="example-btn" type="button" data-alert-filter="all">查看全部提醒</button>
        <button class="example-btn" type="button" data-alert-mode="rules">調整提醒設定</button>
        <button class="example-btn" type="button" data-go-page="watchlist">看自選股</button>
      </div>
    </article>
  `;
}

function renderAlertSummaryCards(summary = {}) {
  const totalCount = summary.total_count ?? 0;
  const unreadCount = summary.unread_count ?? 0;
  const highCount = summary.high_count ?? 0;
  const latestDate = summary.latest_alert_date || "-";

  return `
    <div class="alert-summary-grid">
      ${createInfoItem("全部提醒", `${formatNumber(totalCount)} 筆`)}
      ${createInfoItem("未讀提醒", `${formatNumber(unreadCount)} 筆`, Number(unreadCount) > 0 ? "price-up" : "")}
      ${createInfoItem("高重要性", `${formatNumber(highCount)} 筆`, Number(highCount) > 0 ? "price-up" : "")}
      ${createInfoItem("最新提醒日", formatDate(latestDate))}
    </div>
  `;
}

function renderAlertFilterButton(filter, label) {
  const active = state.alertFilter === filter;
  return `
    <button class="alert-filter-btn ${active ? "active" : ""}" type="button" data-alert-filter="${escapeHtml(filter)}">
      ${escapeHtml(label)}
    </button>
  `;
}

function renderAlertGenerateNotice() {
  const result = state.alertLastGenerateResult;
  if (!result) return "";

  return `
    <div class="alert-generate-note">
      <strong>剛剛已重新分析</strong>
      <span>交易日：${escapeHtml(formatDate(result.trade_date))}</span>
      <span>符合提醒：${escapeHtml(formatNumber(result.generated_count || 0))} 筆</span>
      <span>啟用規則：${escapeHtml(formatNumber(result.active_rules || 0))} 筆</span>
    </div>
  `;
}

function renderAlertsToolbar(summary = {}) {
  const unreadCount = Number(summary.unread_count || 0);

  return `
    <article class="alerts-dashboard-card">
      <div class="alerts-dashboard-header">
        <div>
          <p class="eyebrow">自選股提醒</p>
          <h3>提醒中心</h3>
          <p>符合條件的股票會出現在這裡；未讀提醒會排在最前面。</p>
        </div>
        <div class="alerts-toolbar-actions">
          <button class="detail-btn secondary-action" type="button" data-alert-generate="true">立即重新分析</button>
          <button class="detail-btn secondary-action" type="button" data-alert-mode="rules">提醒設定</button>
          <button class="detail-btn ${unreadCount > 0 ? "" : "disabled-look"}" type="button" data-alert-read-all="true" ${unreadCount > 0 ? "" : "disabled"}>全部已讀</button>
        </div>
      </div>
      ${renderAlertSummaryCards(summary)}
      ${renderAlertGenerateNotice()}
      <div class="alert-filter-row" aria-label="提醒篩選">
        ${renderAlertFilterButton("unread", "未讀")}
        ${renderAlertFilterButton("read", "已讀")}
        ${renderAlertFilterButton("all", "全部")}
        ${renderAlertFilterButton("high", "高重要")}
      </div>
    </article>
  `;
}

function renderAlertCard(row) {
  const unread = isUnreadAlert(row);
  const levelClass = getAlertLevelClass(row.alert_level);
  const stockCode = normalizeStockCode(row.stock_code);
  const metricValue = toNumber(row.metric_value) === null ? escapeHtml(row.metric_value ?? "-") : formatNumber(row.metric_value);
  const thresholdValue = toNumber(row.threshold_value) === null ? escapeHtml(row.threshold_value ?? "-") : formatNumber(row.threshold_value);

  return `
    <article class="stock-card alert-card ${unread ? "unread" : "read"} ${levelClass}">
      <div class="stock-top">
        <div class="stock-main">
          <span class="rank-badge alert-status-badge ${unread ? "unread" : "read"}">${unread ? "未讀" : "已讀"}</span>
          <div class="stock-name">
            <h3>${escapeHtml(row.stock_name || stockCode || "提醒")}</h3>
            <span class="stock-code">${escapeHtml(stockCode)}</span>
            <span class="badge alert-type-badge">${escapeHtml(getAlertTypeLabel(row.alert_type))}</span>
            <span class="badge alert-level-badge ${levelClass}">${escapeHtml(getAlertLevelLabel(row.alert_level))}</span>
          </div>
        </div>
      </div>

      <div class="alert-title">${escapeHtml(row.title || "自選股提醒")}</div>
      <p class="alert-message">${escapeHtml(row.message || "-")}</p>

      <div class="info-grid alert-info-grid">
        ${createInfoItem("提醒日", formatDate(row.alert_date))}
        ${createInfoItem("參考日", formatDate(row.reference_date))}
        ${createInfoItem(row.metric_name || "指標數值", metricValue)}
        ${createInfoItem("設定門檻", thresholdValue)}
      </div>

      <div class="card-actions alert-actions">
        <span class="card-note">來源：${escapeHtml(row.source_table || "-")}｜建立：${escapeHtml(row.created_at || "-")}</span>
        <div class="action-buttons">
          ${unread ? `<button class="watch-btn" type="button" data-alert-read="${escapeHtml(row.id)}">標記已讀</button>` : ""}
          <button class="detail-btn" type="button" data-alert-detail="${escapeHtml(stockCode)}">看股票</button>
        </div>
      </div>
    </article>
  `;
}

function renderAlertsPage(result = null) {
  const raw = result || { data: state.latestRows, summary: state.alertSummary || {} };
  const rows = Array.isArray(raw.data) ? raw.data : [];
  const summary = raw.summary || {};

  state.latestRows = rows;
  state.alertSummary = summary;
  state.alertUnreadCount = Number(summary.unread_count || state.alertUnreadCount || 0);

  stockList.innerHTML = [
    renderAlertsToolbar(summary),
    rows.length > 0 ? rows.map(renderAlertCard).join("") : renderEmptyAlerts(),
  ].join("");
}

function normalizeRuleBoolean(value) {
  return Number(value || 0) === 1;
}

function getRuleNumber(rule, key, fallback) {
  const value = toNumber(rule?.[key]);
  return value === null ? fallback : value;
}

function renderRuleToggle(rule, key, label, hint) {
  const checked = normalizeRuleBoolean(rule[key]) ? "checked" : "";
  return `
    <label class="rule-toggle-row">
      <span>
        <strong>${escapeHtml(label)}</strong>
        <small>${escapeHtml(hint)}</small>
      </span>
      <input type="checkbox" name="${escapeHtml(key)}" value="1" ${checked} />
    </label>
  `;
}

function renderRuleNumberField(rule, key, label, min, step, fallback, suffix) {
  const value = getRuleNumber(rule, key, fallback);
  return `
    <label class="rule-field">
      <span>${escapeHtml(label)}</span>
      <div class="rule-input-group">
        <input type="number" name="${escapeHtml(key)}" min="${escapeHtml(min)}" step="${escapeHtml(step)}" value="${escapeHtml(value)}" />
        <em>${escapeHtml(suffix)}</em>
      </div>
    </label>
  `;
}

function renderRuleCard(rule) {
  const stockCode = normalizeStockCode(rule.stock_code);
  const stockName = rule.stock_name || stockCode;
  const active = normalizeRuleBoolean(rule.is_active);

  return `
    <article class="stock-card alert-rule-card ${active ? "active" : "inactive"}">
      <form data-alert-rule-form="true" data-stock-code="${escapeHtml(stockCode)}">
        <div class="stock-top rule-card-header">
          <div class="stock-main">
            <span class="rank-badge ${active ? "" : "muted-badge"}">${active ? "啟用" : "停用"}</span>
            <div class="stock-name">
              <h3>${escapeHtml(stockName)}</h3>
              <span class="stock-code">${escapeHtml(stockCode)}</span>
              <span class="badge">${escapeHtml(rule.market_type || "-")}</span>
              ${rule.industry ? `<span class="badge">${escapeHtml(rule.industry)}</span>` : ""}
            </div>
          </div>
        </div>

        <div class="rule-master-row">
          ${renderRuleToggle(rule, "is_active", "啟用這檔股票提醒", "關閉後，每日排程不會再產生這檔股票的新提醒。")}
        </div>

        <div class="rule-section-grid">
          <section class="rule-section-card">
            <h4>法人提醒</h4>
            ${renderRuleToggle(rule, "foreign_buy_streak_enabled", "外資連買", "外資連續買超達門檻時提醒。")}
            ${renderRuleNumberField(rule, "foreign_buy_streak_days", "外資連買門檻", 1, 1, 3, "天")}
            ${renderRuleToggle(rule, "investment_trust_buy_streak_enabled", "投信連買", "投信連續買超達門檻時提醒。")}
            ${renderRuleNumberField(rule, "investment_trust_buy_streak_days", "投信連買門檻", 1, 1, 3, "天")}
          </section>

          <section class="rule-section-card">
            <h4>主力與量能</h4>
            ${renderRuleToggle(rule, "major_holder_enabled", "大戶持股增加", "TDCC 大戶比例增加達門檻時提醒。")}
            ${renderRuleNumberField(rule, "major_holder_ratio_change_threshold", "大戶增加門檻", 0, 0.1, 0.3, "%")}
            ${renderRuleToggle(rule, "volume_enabled", "成交量放大", "最新成交量高於 20 日均量時提醒。")}
            ${renderRuleNumberField(rule, "volume_ratio_threshold", "成交量放大門檻", 1, 0.1, 1.5, "倍")}
          </section>

          <section class="rule-section-card">
            <h4>分數與行事曆</h4>
            ${renderRuleToggle(rule, "chip_score_enabled", "籌碼分數達標", "籌碼分數達到門檻時提醒。")}
            ${renderRuleNumberField(rule, "chip_score_threshold", "籌碼分數門檻", 0, 1, 80, "分")}
            ${renderRuleToggle(rule, "calendar_enabled", "行事曆提前提醒", "除權息、股東會、法說會等事件提前提醒。")}
            ${renderRuleNumberField(rule, "calendar_days_before", "提前提醒天數", 1, 1, 14, "天")}
          </section>
        </div>

        <div class="card-actions alert-actions">
          <span class="card-note">更新時間：${escapeHtml(rule.updated_at || "-")}</span>
          <div class="action-buttons">
            <button class="watch-btn" type="submit">儲存設定</button>
          </div>
        </div>
      </form>
    </article>
  `;
}

function renderAlertRulesPage(result = null) {
  const rows = Array.isArray(result?.data) ? result.data : [];
  state.alertRules = rows;

  stockList.innerHTML = [
    `
      <article class="alerts-dashboard-card alert-rules-dashboard-card">
        <div class="alerts-dashboard-header">
          <div>
            <p class="eyebrow">自選股提醒</p>
            <h3>提醒設定</h3>
            <p>每檔自選股可以分別調整提醒條件。門檻越低，提醒越多；門檻越高，提醒越少。</p>
          </div>
          <div class="alerts-toolbar-actions">
            <button class="detail-btn secondary-action" type="button" data-alert-mode="list">返回提醒中心</button>
          </div>
        </div>
        <div class="rule-help-grid">
          ${createInfoItem("股票數量", `${formatNumber(rows.length)} 檔`)}
          ${createInfoItem("外資 / 投信", "連買天數")}
          ${createInfoItem("主力 / 成交量", "比例與倍數")}
          ${createInfoItem("行事曆", "提前天數")}
        </div>
      </article>
    `,
    rows.length > 0 ? rows.map(renderRuleCard).join("") : `
      <article class="search-intro-card alerts-empty-card">
        <div class="intro-icon">⚙️</div>
        <h3>目前沒有可設定的自選股</h3>
        <p>請先到自選股頁面加入股票，再回來調整提醒條件。</p>
        <div class="example-row">
          <button class="example-btn" type="button" data-go-page="watchlist">看自選股</button>
        </div>
      </article>
    `,
  ].join("");
}

function readRuleForm(form) {
  const formData = new FormData(form);
  const stockCode = normalizeStockCode(form.dataset.stockCode || "");
  const boolFields = [
    "is_active",
    "foreign_buy_streak_enabled",
    "investment_trust_buy_streak_enabled",
    "major_holder_enabled",
    "volume_enabled",
    "chip_score_enabled",
    "calendar_enabled",
  ];
  const numberFields = [
    "foreign_buy_streak_days",
    "investment_trust_buy_streak_days",
    "major_holder_ratio_change_threshold",
    "volume_ratio_threshold",
    "chip_score_threshold",
    "calendar_days_before",
  ];
  const payload = { stock_code: stockCode };

  boolFields.forEach((field) => {
    payload[field] = formData.has(field) ? 1 : 0;
  });

  numberFields.forEach((field) => {
    const value = Number(formData.get(field));
    payload[field] = Number.isFinite(value) ? value : undefined;
  });

  return payload;
}

function renderAlertsBadgeCount(unreadCount = 0) {
  const safeCount = Number(unreadCount || 0);

  alertsTabBadges.forEach((badge) => {
    badge.textContent = safeCount > 99 ? "99+" : String(safeCount);
    badge.classList.toggle("hidden", safeCount <= 0);
  });
}

async function updateAlertsBadge() {
  if (!alertsTabBadges.length) return;

  if (!isAuthenticated()) {
    state.alertUnreadCount = 0;
    renderAlertsBadgeCount(0);
    return;
  }

  try {
    const data = await fetchJson("/watchlist/alerts/unread-count", {
      method: "GET",
      auth: true,
    });
    const unreadCount = Number(data?.unread_count || 0);
    state.alertUnreadCount = unreadCount;
    renderAlertsBadgeCount(unreadCount);
  } catch (error) {
    console.warn("Update alert badge failed:", error);
  }
}

async function loadAlerts() {
  if (state.alertMode === "rules") {
    await loadAlertRules();
    return;
  }

  if (!isAuthenticated()) {
    setLoading(false);
    state.latestRows = [];
    state.alertSummary = null;
    renderAlertsLoginPrompt();
    await updateAlertsBadge();
    return;
  }

  setLoading(true);
  renderLoadingCards();

  try {
    const result = await fetchJson(getAlertFilterQuery(), {
      method: "GET",
      auth: true,
      raw: true,
    });

    renderAlertsPage(result);
    await updateAlertsBadge();
    showTemporaryStatus(`已更新 ${Number(result.count || 0)} 筆提醒。`, "success");
  } catch (error) {
    stockList.innerHTML = "";
    showStatus(`提醒讀取失敗：${escapeHtml(error.message)}`, "error");
  } finally {
    setLoading(false);
  }
}

async function handleAlertFilter(button) {
  const filter = button.dataset.alertFilter || "unread";
  state.alertFilter = filter;
  await loadList();
}

async function handleAlertMarkRead(button) {
  const alertId = button.dataset.alertRead;
  if (!alertId) return;

  button.disabled = true;
  button.textContent = "處理中...";

  try {
    await fetchJson(`/watchlist/alerts/${encodeURIComponent(alertId)}/read`, {
      method: "POST",
      auth: true,
    });
    await loadAlerts();
    showTemporaryStatus("提醒已標記為已讀。", "success");
  } catch (error) {
    showStatus(`標記已讀失敗：${escapeHtml(error.message)}`, "error");
    button.disabled = false;
    button.textContent = "標記已讀";
  }
}

async function handleAlertsReadAll(button) {
  if (!isAuthenticated()) return;

  button.disabled = true;
  const originalText = button.textContent;
  button.textContent = "處理中...";

  try {
    const result = await fetchJson("/watchlist/alerts/read-all", {
      method: "POST",
      auth: true,
      raw: true,
    });
    await loadAlerts();
    showTemporaryStatus(`已標記 ${Number(result.affected_rows || 0)} 筆提醒為已讀。`, "success");
  } catch (error) {
    showStatus(`全部已讀失敗：${escapeHtml(error.message)}`, "error");
    button.disabled = false;
    button.textContent = originalText;
  }
}


async function handleAlertsGenerate(button) {
  if (!isAuthenticated()) {
    switchPage("account");
    return;
  }

  button.disabled = true;
  const originalText = button.textContent;
  button.textContent = "分析中...";
  showTemporaryStatus("正在重新分析自選股提醒，請稍候。", "success", 1800);

  try {
    const result = await fetchJson("/watchlist/alerts/generate", {
      method: "POST",
      auth: true,
      raw: true,
    });

    const data = result.data || result;
    state.alertLastGenerateResult = data;
    state.alertFilter = "unread";
    state.alertMode = "list";
    await loadAlerts();
    showTemporaryStatus(
      `重新分析完成：交易日 ${formatDate(data.trade_date)}，符合條件 ${formatNumber(data.generated_count || 0)} 筆提醒。`,
      "success",
      2600,
    );
  } catch (error) {
    showStatus(`重新分析提醒失敗：${escapeHtml(error.message)}`, "error");
    button.disabled = false;
    button.textContent = originalText;
  }
}

async function loadAlertRules() {
  if (!isAuthenticated()) {
    setLoading(false);
    state.alertRules = [];
    renderAlertsLoginPrompt();
    await updateAlertsBadge();
    return;
  }

  setLoading(true);
  renderLoadingCards();

  try {
    const result = await fetchJson("/watchlist/rules", {
      method: "GET",
      auth: true,
      raw: true,
    });
    renderAlertRulesPage(result);
    showTemporaryStatus(`已載入 ${Number(result.count || 0)} 檔自選股提醒設定。`, "success");
  } catch (error) {
    stockList.innerHTML = "";
    showStatus(`提醒設定讀取失敗：${escapeHtml(error.message)}`, "error");
  } finally {
    setLoading(false);
  }
}

async function handleAlertMode(button) {
  const mode = button.dataset.alertMode === "rules" ? "rules" : "list";
  state.alertMode = mode;
  updatePageText();
  await loadList();
}

async function handleAlertRuleSubmit(form) {
  const submitButton = form.querySelector('button[type="submit"]');
  const originalText = submitButton ? submitButton.textContent : "";

  if (submitButton) {
    submitButton.disabled = true;
    submitButton.textContent = "儲存中...";
  }

  try {
    const payload = readRuleForm(form);
    await fetchJson("/watchlist/rules", {
      method: "POST",
      auth: true,
      body: payload,
    });
    await loadAlertRules();
    showTemporaryStatus(`${payload.stock_code} 提醒設定已更新。可回提醒中心按「立即重新分析」套用新條件。`, "success", 2600);
  } catch (error) {
    showStatus(`提醒設定儲存失敗：${escapeHtml(error.message)}`, "error");
    if (submitButton) {
      submitButton.disabled = false;
      submitButton.textContent = originalText;
    }
  }
}


function getV13StatusMeta(status) {
  const key = String(status || "warn").toLowerCase();
  if (key === "pass") return { label: "正常", className: "pass", icon: "✅" };
  if (key === "fail") return { label: "異常", className: "fail", icon: "⛔" };
  return { label: "需確認", className: "warn", icon: "⚠️" };
}

function findV13Check(key) {
  const checks = Array.isArray(state.v13Status?.checks) ? state.v13Status.checks : [];
  return checks.find((item) => item && item.key === key) || null;
}

function formatV13Count(value) {
  const numberValue = toNumber(value);
  if (numberValue === null) return escapeHtml(value ?? "-");
  return formatNumber(numberValue);
}

function getV13FeatureSnapshot(key) {
  const snapshot = state.v13Status?.feature_snapshot || {};
  return snapshot[key] || null;
}

function renderV13CheckCard(check) {
  if (!check) return "";
  const meta = getV13StatusMeta(check.status);
  return `
    <div class="v13-check-card ${meta.className}">
      <div class="v13-check-top">
        <span class="v13-check-icon">${meta.icon}</span>
        <strong>${escapeHtml(check.label || check.key || "檢查項目")}</strong>
        <span class="v13-status-pill ${meta.className}">${meta.label}</span>
      </div>
      <p>${escapeHtml(check.message || "-")}</p>
    </div>
  `;
}

function renderV13FeatureCards() {
  const alerts = getV13FeatureSnapshot("watchlist_alerts") || {};
  const tracks = getV13FeatureSnapshot("strategy_watchlists") || {};
  const backtests = getV13FeatureSnapshot("strategy_backtests") || findV13Check("strategy_backtests")?.latest_run || {};

  return `
    <div class="v13-feature-grid">
      <div class="v13-feature-card">
        <span>自選股提醒</span>
        <strong>${formatV13Count(alerts.total_count)} 筆</strong>
        <small>未讀 ${formatV13Count(alerts.unread_count)} 筆，股票 ${formatV13Count(alerts.stock_count)} 檔</small>
      </div>
      <div class="v13-feature-card">
        <span>策略追蹤</span>
        <strong>${formatV13Count(tracks.active_count)} 筆啟用</strong>
        <small>追蹤 ${formatV13Count(tracks.stock_count)} 檔，策略 ${formatV13Count(tracks.strategy_count)} 種</small>
      </div>
      <div class="v13-feature-card">
        <span>策略回測</span>
        <strong>Run ${escapeHtml(backtests.id ?? backtests.run_id ?? "-")}</strong>
        <small>訊號 ${formatV13Count(backtests.total_signals ?? backtests.signal_count)} 筆，5日平均 ${formatReturnPercent(backtests.avg_return_5d ?? backtests.avg_return_5d_percent)}</small>
      </div>
    </div>
  `;
}

function renderV13BacktestStats() {
  const stats = Array.isArray(state.v13Status?.latest_backtest_strategy_stats)
    ? state.v13Status.latest_backtest_strategy_stats
    : [];

  if (!stats.length) {
    return `
      <div class="v13-empty-note">
        尚未讀到各策略回測統計；如果剛完成回測，請按「重新檢查 V1.3」。
      </div>
    `;
  }

  return `
    <div class="v13-backtest-list">
      ${stats.slice(0, 6).map((item) => `
        <div class="v13-backtest-row">
          <span>${escapeHtml(item.strategy_name || item.strategy_key || "策略")}</span>
          <strong class="${getReturnClass(item.avg_return_5d ?? item.avg_5d)}">${formatReturnPercent(item.avg_return_5d ?? item.avg_5d)}</strong>
          <small>5日勝率 ${formatPercent(item.win_rate_5d)}</small>
        </div>
      `).join("")}
    </div>
  `;
}

function renderV13StatusCard() {
  if (!state.v13Status && !state.v13StatusLoading && !state.v13StatusError) {
    window.setTimeout(() => loadV13Status(), 0);
  }

  if (state.v13StatusLoading && !state.v13Status) {
    return `
      <article class="account-card v13-status-card">
        <div class="v13-status-header">
          <div>
            <p class="eyebrow">V1.3 系統狀態</p>
            <h3>正在檢查 V1.3 功能</h3>
            <p>正在讀取 /health 與 /v13/status。</p>
          </div>
          <span class="v13-status-pill warn">檢查中</span>
        </div>
        <div class="v13-loading-bar"></div>
      </article>
    `;
  }

  if (state.v13StatusError) {
    return `
      <article class="account-card v13-status-card error-card">
        <div class="v13-status-header">
          <div>
            <p class="eyebrow">V1.3 系統狀態</p>
            <h3>狀態檢查失敗</h3>
            <p>${escapeHtml(state.v13StatusError)}</p>
          </div>
          <span class="v13-status-pill fail">異常</span>
        </div>
        <div class="account-actions">
          <button class="detail-btn" type="button" data-refresh-v13-status="true">重新檢查 V1.3</button>
        </div>
      </article>
    `;
  }

  const status = state.v13Status;
  if (!status) return "";

  const meta = getV13StatusMeta(status.overall_status);
  const checks = [
    findV13Check("database"),
    findV13Check("core_market_data"),
    findV13Check("alerts"),
    findV13Check("strategy_tracking"),
    findV13Check("strategy_backtests"),
  ].filter(Boolean);

  return `
    <article class="account-card v13-status-card ${meta.className}">
      <div class="v13-status-header">
        <div>
          <p class="eyebrow">V1.3 系統狀態</p>
          <h3>${meta.icon} ${escapeHtml(status.overall_message || "V1.3 狀態檢查完成")}</h3>
          <p>檢查時間：${escapeHtml(status.checked_at || "-")}</p>
        </div>
        <span class="v13-status-pill ${meta.className}">${meta.label}</span>
      </div>

      <div class="account-info-grid v13-version-grid">
        ${createInfoItem("API 版本", escapeHtml(status.version || "-"))}
        ${createInfoItem("PWA 預期版本", escapeHtml(status.pwa_expected_version || "-"))}
        ${createInfoItem("資料庫", escapeHtml(status.database?.database_name || "-"))}
        ${createInfoItem("最新行情", formatDate(status.latest_data?.daily_prices))}
      </div>

      <div class="v13-check-grid">
        ${checks.map(renderV13CheckCard).join("")}
      </div>

      ${renderV13FeatureCards()}

      <div class="v13-subsection">
        <div class="v13-subsection-title">
          <strong>策略回測統計</strong>
          <span>取最新完成回測任務</span>
        </div>
        ${renderV13BacktestStats()}
      </div>

      <div class="account-actions v13-actions">
        <button class="detail-btn" type="button" data-refresh-v13-status="true">重新檢查 V1.3</button>
        <button class="detail-btn secondary-action" type="button" data-go-page="strategyBacktests">看策略回測</button>
        <button class="detail-btn secondary-action" type="button" data-go-page="alerts">提醒中心</button>
        <button class="detail-btn secondary-action" type="button" data-go-page="strategyTracks">策略追蹤</button>
      </div>
    </article>
  `;
}

async function loadV13Status({ force = false } = {}) {
  if (state.v13StatusLoading) return;
  if (state.v13Status && !force) return;

  state.v13StatusLoading = true;
  state.v13StatusError = "";
  if (state.page === "account") renderAccountPage();

  try {
    const result = await fetchJson("/v13/status", { method: "GET", raw: true });
    state.v13Status = result;
  } catch (error) {
    state.v13StatusError = error.message || "V1.3 狀態檢查失敗。";
  } finally {
    state.v13StatusLoading = false;
    if (state.page === "account") renderAccountPage();
  }
}

function renderAccountPage() {
  hideStatus();

  if (state.user) {
    const picture = state.user.picture_url
      ? `<img class="profile-avatar" src="${escapeHtml(state.user.picture_url)}" alt="${escapeHtml(getUserDisplayName())}" />`
      : `<div class="profile-avatar placeholder">${escapeHtml(String(getUserDisplayName()).slice(0, 1))}</div>`;

    stockList.innerHTML = `
      <article class="account-card">
        <div class="profile-row">
          ${picture}
          <div class="profile-main">
            <p class="eyebrow">目前登入</p>
            <h3>${escapeHtml(getUserDisplayName())}</h3>
            <p>${escapeHtml(state.user.email || "-")}</p>
          </div>
        </div>
        <div class="account-info-grid">
          ${createInfoItem("帳號狀態", "已登入")}
          ${createInfoItem("登入方式", "Google 帳號")}
          ${createInfoItem("權限", escapeHtml(state.user.role || "user"))}
          ${createInfoItem("最後登入", escapeHtml(state.user.last_login_at || "剛剛"))}
        </div>
        <div class="result-note">
          <strong>自選股已可使用：</strong>這個 Google 帳號會看到自己的股票清單，不會和其他使用者混在一起。
        </div>
        <div class="account-actions">
          <button class="detail-btn secondary-action" type="button" data-go-page="alerts">提醒中心</button>
          <button class="detail-btn secondary-action" type="button" data-go-page="strategyTracks">策略追蹤</button>
          <button class="detail-btn" type="button" data-logout="true">登出</button>
        </div>
      </article>
      ${renderV13StatusCard()}
    `;
    return;
  }

  stockList.innerHTML = `
    <article class="account-card login-card">
      <div class="intro-icon">🔐</div>
      <h3>使用 Google 帳號登入</h3>
      <p>登入後，之後的自選股會依照 Google 帳號分開保存。每個人看到自己的清單。</p>
      <div id="googleSignInButton" class="google-signin-box"></div>
      <p id="googleLoginMessage" class="login-message">準備載入 Google 登入按鈕。</p>
      <div class="result-note">
        <strong>管理提醒：</strong>API 端只需要設定 <code>GOOGLE_CLIENT_ID</code> 與 <code>JWT_SECRET</code>。
      </div>
    </article>
    ${renderV13StatusCard()}
  `;

  renderGoogleButton();
}


function getForeignStreakStrengthClass(days) {
  const numberValue = toNumber(days);
  if (numberValue === null) return "score-low";
  if (numberValue >= 5) return "score-high";
  if (numberValue >= 2) return "score-mid";
  return "score-low";
}

function getForeignStreakStrengthText(days) {
  const numberValue = toNumber(days);
  if (numberValue === null) return "尚無資料";
  if (numberValue >= 5) return "外資強買";
  if (numberValue >= 2) return "外資偏多";
  return "單日買超";
}

function renderForeignStreakCard(row, index) {
  const code = pick(row, ["stock_code", "code"]);
  const name = pick(row, ["stock_name", "name"]);
  const market = pick(row, ["market_type", "market"]);
  const industry = pick(row, ["industry"], "-");
  const tradeDate = pick(row, ["trade_date", "date"], "-");
  const buyDays = pick(row, ["foreign_buy_days", "buy_days"], "-");
  const todayLots = formatLotsValue(
    pick(row, ["today_foreign_net_lots", "today_foreign_net_buy_lots"], "-"),
    pick(row, ["today_foreign_net_shares", "today_foreign_net_buy_shares"], "-"),
  );
  const totalLots = formatLotsValue(
    pick(row, ["total_foreign_net_lots", "total_foreign_net_buy_lots"], "-"),
    pick(row, ["total_foreign_net_shares", "total_foreign_net_buy_shares"], "-"),
  );
  const strengthClass = getForeignStreakStrengthClass(buyDays);
  const strengthText = getForeignStreakStrengthText(buyDays);
  const buyDaysText = toNumber(buyDays) === null ? "-" : `${formatNumber(buyDays)} 天`;

  const foreignItems = [
    createInfoItem("連買天數", escapeHtml(buyDaysText), strengthClass),
    createInfoItem("今日買超", `${todayLots} 張`, "price-up"),
    createInfoItem("累計買超", `${totalLots} 張`, "price-up"),
    createInfoItem("市場別", escapeHtml(market)),
    createInfoItem("產業", escapeHtml(industry)),
    createInfoItem("資料日", formatDate(tradeDate)),
  ].join("");

  return `
    <article class="stock-card">
      <div class="stock-top">
        <div class="stock-main">
          <span class="rank-badge">${state.page === "watchlist" ? "自選股" : `第 ${index + 1} 名`}</span>
          <div class="stock-name">
            <h3>${escapeHtml(name)}</h3>
            <span class="stock-code">${escapeHtml(code)}</span>
            <span class="badge">${escapeHtml(market)}</span>
          </div>
        </div>
        <div class="score-box ${strengthClass}">
          <span class="score-value">${formatNumber(buyDays)}</span>
          <span class="score-label">連買天數</span>
        </div>
      </div>

      <div class="quick-summary">
        <span class="summary-pill ${strengthClass}">${escapeHtml(strengthText)}</span>
        <span class="summary-text">今日買超 <strong class="price-up">${todayLots}</strong> 張，累計 <strong class="price-up">${totalLots}</strong> 張</span>
      </div>

      <div class="info-grid">
        ${foreignItems}
      </div>

      <div class="card-actions">
        <span class="card-note">資料日：${formatDate(tradeDate)}</span>
        ${getCardActionButtons(code, "看明細", index)}
      </div>
    </article>
  `;
}

function getTrustStrengthClass(days) {
  const numberValue = toNumber(days);
  if (numberValue === null) return "score-low";
  if (numberValue >= 5) return "score-high";
  if (numberValue >= 2) return "score-mid";
  return "score-low";
}

function getTrustStrengthText(days) {
  const numberValue = toNumber(days);
  if (numberValue === null) return "尚無資料";
  if (numberValue >= 5) return "投信強買";
  if (numberValue >= 2) return "投信偏多";
  return "單日買超";
}

function renderTrustCard(row, index) {
  const code = pick(row, ["stock_code", "code"]);
  const name = pick(row, ["stock_name", "name"]);
  const market = pick(row, ["market_type", "market"]);
  const industry = pick(row, ["industry"], "-");
  const tradeDate = pick(row, ["trade_date", "date"], "-");
  const buyDays = pick(row, ["investment_trust_buy_days", "trust_buy_days", "buy_days"], "-");
  const todayLots = formatLotsValue(
    pick(row, ["today_investment_trust_net_lots", "today_trust_net_lots"], "-"),
    pick(row, ["today_investment_trust_net_shares", "today_trust_net_shares"], "-"),
  );
  const totalLots = formatLotsValue(
    pick(row, ["total_investment_trust_net_lots", "total_trust_net_lots"], "-"),
    pick(row, ["total_investment_trust_net_shares", "total_trust_net_shares"], "-"),
  );
  const strengthClass = getTrustStrengthClass(buyDays);
  const strengthText = getTrustStrengthText(buyDays);
  const buyDaysText = toNumber(buyDays) === null ? "-" : `${formatNumber(buyDays)} 天`;

  const trustItems = [
    createInfoItem("連買天數", escapeHtml(buyDaysText), strengthClass),
    createInfoItem("今日買超", `${todayLots} 張`, "price-up"),
    createInfoItem("累計買超", `${totalLots} 張`, "price-up"),
    createInfoItem("市場別", escapeHtml(market)),
    createInfoItem("產業", escapeHtml(industry)),
    createInfoItem("資料日", formatDate(tradeDate)),
  ].join("");

  return `
    <article class="stock-card">
      <div class="stock-top">
        <div class="stock-main">
          <span class="rank-badge">第 ${index + 1} 名</span>
          <div class="stock-name">
            <h3>${escapeHtml(name)}</h3>
            <span class="stock-code">${escapeHtml(code)}</span>
            <span class="badge">${escapeHtml(market)}</span>
          </div>
        </div>
        <div class="score-box ${strengthClass}">
          <span class="score-value">${formatNumber(buyDays)}</span>
          <span class="score-label">連買天數</span>
        </div>
      </div>

      <div class="quick-summary">
        <span class="summary-pill ${strengthClass}">${escapeHtml(strengthText)}</span>
        <span class="summary-text">今日買超 <strong class="price-up">${todayLots}</strong> 張，累計 <strong class="price-up">${totalLots}</strong> 張</span>
      </div>

      <div class="info-grid">
        ${trustItems}
      </div>

      <div class="card-actions">
        <span class="card-note">資料日：${formatDate(tradeDate)}</span>
        ${getCardActionButtons(code, "看明細", index)}
      </div>
    </article>
  `;
}


function getSyncBuyStrengthClass(days, totalLots) {
  const dayValue = toNumber(days);
  const lotValue = toNumber(totalLots) || 0;
  if (dayValue === null) return "score-low";
  if (dayValue >= 3 || lotValue >= 5000) return "score-high";
  if (dayValue >= 2 || lotValue >= 1000) return "score-mid";
  return "score-low";
}

function getSyncBuyStrengthText(days) {
  const numberValue = toNumber(days);
  if (numberValue === null) return "尚無資料";
  if (numberValue >= 3) return "法人同步強買";
  if (numberValue >= 2) return "連續同步買超";
  return "今日同步買超";
}

function renderSyncBuyCard(row, index) {
  const code = pick(row, ["stock_code", "code"]);
  const name = pick(row, ["stock_name", "name"]);
  const market = pick(row, ["market_type", "market"]);
  const industry = pick(row, ["industry"], "-");
  const tradeDate = pick(row, ["trade_date", "date"], "-");
  const syncDays = pick(row, ["sync_buy_days"], "-");
  const todayForeignLots = formatLotsValue(
    pick(row, ["today_foreign_net_lots", "foreign_net"], "-"),
    pick(row, ["today_foreign_net_shares"], "-"),
  );
  const todayTrustLots = formatLotsValue(
    pick(row, ["today_investment_trust_net_lots", "investment_trust_net"], "-"),
    pick(row, ["today_investment_trust_net_shares"], "-"),
  );
  const todaySyncLots = formatLotsValue(
    pick(row, ["today_sync_net_lots", "institutional_sync_net"], "-"),
    pick(row, ["today_sync_net_shares"], "-"),
  );
  const totalSyncLots = formatLotsValue(
    pick(row, ["total_sync_net_lots"], "-"),
    pick(row, ["total_sync_net_shares"], "-"),
  );
  const chipScore = pick(row, ["chip_score", "total_score", "score"], "-");
  const closePrice = pick(row, ["close_price", "closing_price", "close"], "-");
  const change = pick(row, ["price_change", "change", "change_price"], "-");
  const strengthClass = getSyncBuyStrengthClass(syncDays, pick(row, ["total_sync_net_lots"], 0));
  const strengthText = getSyncBuyStrengthText(syncDays);
  const syncDaysText = toNumber(syncDays) === null ? "-" : `${formatNumber(syncDays)} 天`;

  const syncItems = [
    createInfoItem("同步天數", escapeHtml(syncDaysText), strengthClass),
    createInfoItem("外資今日", `${todayForeignLots} 張`, "price-up"),
    createInfoItem("投信今日", `${todayTrustLots} 張`, "price-up"),
    createInfoItem("法人合計", `${todaySyncLots} 張`, "price-up"),
    createInfoItem("累計同步", `${totalSyncLots} 張`, "price-up"),
    createInfoItem("籌碼分數", formatNumber(chipScore), getScoreClass(chipScore)),
    createInfoItem("市場別", escapeHtml(market)),
    createInfoItem("產業", escapeHtml(industry)),
  ].join("");

  return `
    <article class="stock-card sync-buy-card">
      <div class="stock-top">
        <div class="stock-main">
          <span class="rank-badge">第 ${index + 1} 名</span>
          <div class="stock-name">
            <h3>${escapeHtml(name)}</h3>
            <span class="stock-code">${escapeHtml(code)}</span>
            <span class="badge">${escapeHtml(market)}</span>
          </div>
        </div>
        <div class="score-box ${strengthClass}">
          <span class="score-value">${formatNumber(syncDays)}</span>
          <span class="score-label">同步天數</span>
        </div>
      </div>

      <div class="quick-summary">
        <span class="summary-pill ${strengthClass}">${escapeHtml(strengthText)}</span>
        <span class="summary-text">外資 <strong class="price-up">${todayForeignLots}</strong> 張＋投信 <strong class="price-up">${todayTrustLots}</strong> 張，同步合計 <strong class="price-up">${todaySyncLots}</strong> 張</span>
      </div>

      <div class="quick-summary secondary-summary price-summary">
        <span class="price-metric">收盤 ${formatDirectionalClosePrice(closePrice, change)}</span>
        <span class="price-metric">漲跌 <strong class="${getChangeClass(change)}">${formatPrice(change)}</strong></span>
      </div>

      <div class="info-grid">
        ${syncItems}
      </div>

      <div class="card-actions">
        <span class="card-note">資料日：${formatDate(tradeDate)}</span>
        ${getCardActionButtons(code, "看明細", index)}
      </div>
    </article>
  `;
}


function getIndustryFlowStrengthClass(direction, totalLots) {
  const lotValue = toNumber(totalLots) || 0;
  const text = String(direction || "");

  if (text.includes("流出") || lotValue < 0) return "score-low";
  if (text.includes("流入") && lotValue >= 5000) return "score-high";
  if (text.includes("流入") || lotValue > 0) return "score-mid";
  return "score-low";
}

function renderIndustryTopStocks(topStocks) {
  const rows = Array.isArray(topStocks) ? topStocks.slice(0, 3) : [];

  if (rows.length === 0) {
    return `<div class="industry-leaders empty">此產業暫無個股排行資料</div>`;
  }

  return `
    <div class="industry-leaders">
      ${rows.map((stock, leaderIndex) => {
        const code = pick(stock, ["stock_code", "code"], "-");
        const name = pick(stock, ["stock_name", "name"], "-");
        const totalLots = formatLotsValue(pick(stock, ["total_net_lots", "total_net"], "-"));
        const chipScore = pick(stock, ["chip_score", "score"], "-");
        const change = pick(stock, ["price_change", "change"], "-");

        return `
          <button class="industry-leader-btn detail-btn" type="button" data-code="${escapeHtml(code)}">
            <span class="leader-left">
              <span class="leader-rank">TOP ${leaderIndex + 1}</span>
              <span class="leader-name">${escapeHtml(name)}</span>
              <span class="leader-code">${escapeHtml(code)}</span>
            </span>
            <span class="leader-stats">
              <span>法人 <strong class="${getChangeClass(totalLots)}">${totalLots}</strong> 張</span>
              <span>分數 <strong>${formatNumber(chipScore)}</strong></span>
              <span>漲跌 <strong class="${getChangeClass(change)}">${formatPrice(change)}</strong></span>
            </span>
          </button>
        `;
      }).join("")}
    </div>
  `;
}

function renderIndustryFlowCard(row, index) {
  const industry = pick(row, ["industry"], "未分類");
  const tradeDate = pick(row, ["trade_date", "date"], "-");
  const marketTypes = pick(row, ["market_types", "market_type", "market"], "全部");
  const stockCount = pick(row, ["stock_count"], "-");
  const netBuyCount = pick(row, ["net_buy_stock_count"], "-");
  const netBuyRatio = pick(row, ["net_buy_ratio"], "-");
  const upCount = pick(row, ["up_stock_count"], "-");
  const downCount = pick(row, ["down_stock_count"], "-");
  const totalNetLots = pick(row, ["total_net_lots", "institutional_net_lots"], "-");
  const foreignTrustLots = pick(row, ["foreign_trust_net_lots"], "-");
  const foreignLots = pick(row, ["foreign_net_lots"], "-");
  const trustLots = pick(row, ["investment_trust_net_lots", "trust_net_lots"], "-");
  const dealerLots = pick(row, ["dealer_net_lots"], "-");
  const amount = pick(row, ["total_transaction_amount", "transaction_amount"], "-");
  const avgScore = pick(row, ["avg_chip_score"], "-");
  const direction = pick(row, ["flow_direction"], "資金中性");
  const strength = pick(row, ["flow_strength"], "觀察中");
  const strengthClass = getIndustryFlowStrengthClass(direction, totalNetLots);
  const totalNetClass = getChangeClass(totalNetLots);

  const industryItems = [
    createInfoItem("法人合計", `${formatLotsValue(totalNetLots)} 張`, totalNetClass),
    createInfoItem("外資＋投信", `${formatLotsValue(foreignTrustLots)} 張`, getChangeClass(foreignTrustLots)),
    createInfoItem("外資", `${formatLotsValue(foreignLots)} 張`, getChangeClass(foreignLots)),
    createInfoItem("投信", `${formatLotsValue(trustLots)} 張`, getChangeClass(trustLots)),
    createInfoItem("自營商", `${formatLotsValue(dealerLots)} 張`, getChangeClass(dealerLots)),
    createInfoItem("買超家數", `${formatNumber(netBuyCount)} / ${formatNumber(stockCount)}`),
    createInfoItem("買超比例", formatPercent(netBuyRatio)),
    createInfoItem("上漲 / 下跌", `${formatNumber(upCount)} / ${formatNumber(downCount)}`),
    createInfoItem("平均分數", formatNumber(avgScore), getScoreClass(avgScore)),
    createInfoItem("成交金額", formatAmountYi(amount)),
  ].join("");

  return `
    <article class="stock-card industry-flow-card">
      <div class="stock-top">
        <div class="stock-main">
          <span class="rank-badge">第 ${index + 1} 名</span>
          <div class="stock-name">
            <h3>${escapeHtml(industry)}</h3>
            <span class="badge">${escapeHtml(marketTypes)}</span>
            <span class="badge">${formatNumber(stockCount)} 檔</span>
          </div>
        </div>
        <div class="score-box ${strengthClass}">
          <span class="score-value">${formatLotsValue(totalNetLots)}</span>
          <span class="score-label">法人合計張</span>
        </div>
      </div>

      <div class="quick-summary">
        <span class="summary-pill ${strengthClass}">${escapeHtml(strength)}</span>
        <span class="summary-text">${escapeHtml(direction)} <strong class="${totalNetClass}">${formatLotsValue(totalNetLots)}</strong> 張，買超家數 ${formatNumber(netBuyCount)} 檔，占 ${formatPercent(netBuyRatio)}</span>
      </div>

      <div class="info-grid industry-flow-grid">
        ${industryItems}
      </div>

      <section class="industry-leader-section">
        <h4>產業內法人買超前 3 檔</h4>
        ${renderIndustryTopStocks(row.top_stocks)}
      </section>

      <div class="card-actions">
        <span class="card-note">資料日：${formatDate(tradeDate)}</span>
      </div>
    </article>
  `;
}

function formatSignedPercent(value) {
  const numberValue = toNumber(value);
  if (numberValue === null) return "-";
  const prefix = numberValue > 0 ? "+" : "";
  return `${prefix}${numberValue.toLocaleString("zh-TW", { maximumFractionDigits: 2 })}%`;
}

function formatSignedLots(value) {
  const numberValue = toNumber(value);
  if (numberValue === null) return "-";
  const prefix = numberValue > 0 ? "+" : "";
  return `${prefix}${numberValue.toLocaleString("zh-TW", { maximumFractionDigits: 0 })}`;
}

function getMajorHolderStrengthClass(score, ratioChange) {
  const scoreValue = toNumber(score);
  const changeValue = toNumber(ratioChange);
  if ((scoreValue !== null && scoreValue >= 15) || (changeValue !== null && changeValue >= 1)) return "score-high";
  if ((scoreValue !== null && scoreValue >= 8) || (changeValue !== null && changeValue > 0)) return "score-mid";
  return "score-low";
}

function renderMajorHolderTrend(rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return `<div class="major-holder-history empty">尚無大戶歷史資料。</div>`;
  }

  return `
    <div class="major-holder-history">
      ${rows.slice(0, 8).map((row) => {
        const ratio = pick(row, ["large_holder_ratio"], "-");
        const ratioChange = pick(row, ["large_holder_ratio_change"], "-");
        const smallRatio = pick(row, ["small_holder_ratio"], "-");
        const shareChange = pick(row, ["large_holder_share_change_lots", "large_holder_share_change"], "-");
        return `
          <div class="major-history-row">
            <strong>${formatDate(pick(row, ["data_date"]))}</strong>
            <span>大戶 ${formatPercent(ratio)}</span>
            <span class="${getChangeClass(ratioChange)}">${formatSignedPercent(ratioChange)}</span>
            <span>散戶 ${formatPercent(smallRatio)}</span>
            <span class="${getChangeClass(shareChange)}">${formatSignedLots(shareChange)} 張</span>
          </div>
        `;
      }).join("")}
    </div>
  `;
}

function renderMajorHolderDetailSection(rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return `
      <section class="detail-section">
        <h3>主力 / 大戶籌碼</h3>
        <div class="status-box">尚未匯入 TDCC 集保大戶資料。</div>
      </section>
    `;
  }

  const latest = rows[0];
  const score = pick(latest, ["major_holder_score", "big_holder_score"], "-");
  const ratioChange = pick(latest, ["large_holder_ratio_change"], "-");

  return [
    renderDetailSection("主力 / 大戶籌碼", [
      createStatusItem("狀態", pick(latest, ["major_holder_status", "big_holder_status"])),
      createInfoItem("大戶分數", formatNumber(score), getMajorHolderStrengthClass(score, ratioChange)),
      createInfoItem("大戶比重", formatPercent(pick(latest, ["large_holder_ratio"])), getChangeClass(ratioChange)),
      createInfoItem("比重變化", formatSignedPercent(ratioChange), getChangeClass(ratioChange)),
      createInfoItem("大戶人數", formatNumber(pick(latest, ["large_holder_count"]))),
      createInfoItem("大戶張數", `${formatNumber(pick(latest, ["large_holder_share_count_lots"]))} 張`),
      createInfoItem("散戶比重", formatPercent(pick(latest, ["small_holder_ratio"])), getChangeClass(pick(latest, ["small_holder_ratio_change"]))),
      createInfoItem("千張大戶", formatPercent(pick(latest, ["thousand_lot_ratio"]))),
      createInfoItem("資料日", formatDate(pick(latest, ["data_date"]))),
    ]),
    `
      <section class="detail-section">
        <h3>大戶週變化</h3>
        ${renderMajorHolderTrend(rows)}
      </section>
    `,
  ].join("");
}

function renderMajorHolderCard(row, index) {
  const code = pick(row, ["stock_code", "code"]);
  const name = pick(row, ["stock_name", "name"]);
  const market = pick(row, ["market_type", "market"]);
  const industry = pick(row, ["industry"], "-");
  const dataDate = pick(row, ["data_date"], "-");
  const tradeDate = pick(row, ["trade_date"], "-");
  const majorScore = pick(row, ["major_holder_score", "big_holder_score"], "-");
  const status = pick(row, ["major_holder_status", "big_holder_status"], "大戶資料累積中");
  const largeRatio = pick(row, ["large_holder_ratio"], "-");
  const largeRatioChange = pick(row, ["large_holder_ratio_change"], "-");
  const largeShareLots = pick(row, ["large_holder_share_count_lots"], "-");
  const largeShareChangeLots = pick(row, ["large_holder_share_change_lots"], "-");
  const smallRatio = pick(row, ["small_holder_ratio"], "-");
  const smallRatioChange = pick(row, ["small_holder_ratio_change"], "-");
  const thousandRatio = pick(row, ["thousand_lot_ratio"], "-");
  const closePrice = pick(row, ["close_price", "closing_price", "close"], "-");
  const change = pick(row, ["price_change", "change", "change_price"], "-");
  const chipScore = pick(row, ["chip_score", "total_score", "score"], "-");
  const strengthClass = getMajorHolderStrengthClass(majorScore, largeRatioChange);

  const items = [
    createInfoItem("大戶比重", formatPercent(largeRatio), getChangeClass(largeRatioChange)),
    createInfoItem("比重變化", formatSignedPercent(largeRatioChange), getChangeClass(largeRatioChange)),
    createInfoItem("大戶張數", `${formatNumber(largeShareLots)} 張`),
    createInfoItem("張數變化", `${formatSignedLots(largeShareChangeLots)} 張`, getChangeClass(largeShareChangeLots)),
    createInfoItem("大戶人數", formatNumber(pick(row, ["large_holder_count"]))),
    createInfoItem("散戶比重", formatPercent(smallRatio), getChangeClass(smallRatioChange)),
    createInfoItem("千張大戶", formatPercent(thousandRatio)),
    createInfoItem("籌碼分數", formatNumber(chipScore), getScoreClass(chipScore)),
  ].join("");

  return `
    <article class="stock-card major-holder-card">
      <div class="stock-top">
        <div class="stock-main">
          <span class="rank-badge">第 ${index + 1} 名</span>
          <div class="stock-name">
            <h3>${escapeHtml(name)}</h3>
            <span class="stock-code">${escapeHtml(code)}</span>
            <span class="badge">${escapeHtml(market)}</span>
            <span class="badge">${escapeHtml(industry)}</span>
          </div>
        </div>
        <div class="score-box ${strengthClass}">
          <span class="score-value">${formatNumber(majorScore)}</span>
          <span class="score-label">大戶分數</span>
        </div>
      </div>

      <div class="quick-summary">
        <span class="summary-pill ${strengthClass}">${escapeHtml(status)}</span>
        <span class="summary-text">400張以上大戶比重 <strong class="${getChangeClass(largeRatioChange)}">${formatPercent(largeRatio)}</strong>，本週變化 <strong class="${getChangeClass(largeRatioChange)}">${formatSignedPercent(largeRatioChange)}</strong></span>
      </div>

      <div class="quick-summary secondary-summary price-summary">
        <span class="price-metric">收盤 ${formatDirectionalClosePrice(closePrice, change)}</span>
        <span class="price-metric">漲跌 <strong class="${getChangeClass(change)}">${formatPrice(change)}</strong></span>
      </div>

      <div class="info-grid major-holder-grid">
        ${items}
      </div>

      <div class="card-actions">
        <span class="card-note">集保日：${formatDate(dataDate)}｜行情日：${formatDate(tradeDate)}</span>
        ${getCardActionButtons(code, "看明細", index)}
      </div>
    </article>
  `;
}

function renderStockCard(row, index) {
  if (state.page === "majorHolder") return renderMajorHolderCard(row, index);
  if (state.page === "industryFlow") return renderIndustryFlowCard(row, index);
  if (state.page === "foreignStreak") return renderForeignStreakCard(row, index);
  if (state.page === "trust") return renderTrustCard(row, index);
  if (state.page === "syncBuy") return renderSyncBuyCard(row, index);
  const code = pick(row, ["stock_code", "code"]);
  const name = pick(row, ["stock_name", "name"]);
  const market = pick(row, ["market_type", "market"]);
  const score = pick(row, ["total_score", "chip_score", "score"], "-");
  const closePrice = pick(row, ["close_price", "closing_price", "close"], "-");
  const change = pick(row, ["price_change", "change", "change_price"], "-");
  const tradeDate = pick(row, ["trade_date", "score_date", "date"], "-");
  const scoreClass = getScoreClass(score);
  const changeClass = getChangeClass(change);
  const scoreText = getScoreText(score);

  const radarItems = [
    createStatusItem("外資", pick(row, ["foreign_status", "foreign_investor_status"])),
    createStatusItem("投信", pick(row, ["investment_trust_status", "trust_status"])),
    createStatusItem("成交量", pick(row, ["volume_status"])),
    createStatusItem("股價位置", pick(row, ["price_position_status", "price_position"])),
  ].join("");

  const foreignValue = pick(row, ["foreign_buy_sell", "foreign_net", "foreign_net_buy", "foreign_net_buy_sell"], "-");
  const trustValue = pick(row, ["investment_trust_buy_sell", "investment_trust_net", "trust_net_buy", "investment_trust_net_buy_sell"], "-");
  const dealerValue = pick(row, ["dealer_buy_sell", "dealer_net", "dealer_net_buy", "dealer_net_buy_sell"], "-");

  const foreignItems = [
    createInfoItem("外資買超", formatNumber(foreignValue), getChangeClass(foreignValue)),
    createInfoItem("投信", formatNumber(trustValue), getChangeClass(trustValue)),
    createInfoItem("自營商", formatNumber(dealerValue), getChangeClass(dealerValue)),
    createInfoItem("市場別", escapeHtml(market)),
  ].join("");

  return `
    <article class="stock-card">
      <div class="stock-top">
        <div class="stock-main">
          <span class="rank-badge">${state.page === "watchlist" ? "自選股" : `第 ${index + 1} 名`}</span>
          <div class="stock-name">
            <h3>${escapeHtml(name)}</h3>
            <span class="stock-code">${escapeHtml(code)}</span>
            <span class="badge">${escapeHtml(market)}</span>
          </div>
        </div>
        <div class="score-box ${scoreClass}">
          <span class="score-value">${formatNumber(score)}</span>
          <span class="score-label">籌碼分數</span>
        </div>
      </div>

      <div class="quick-summary">
        <span class="summary-pill ${scoreClass}">${escapeHtml(scoreText)}</span>
        <span class="summary-text">收盤 ${formatDirectionalClosePrice(closePrice, change)}，漲跌 <strong class="${changeClass}">${formatPrice(change)}</strong></span>
      </div>

      <div class="info-grid">
        ${state.page === "foreign" ? foreignItems : radarItems}
      </div>

      <div class="card-actions">
        <span class="card-note">資料日：${formatDate(tradeDate)}</span>
        ${getCardActionButtons(code, "看明細", index)}
      </div>
    </article>
  `;
}

function renderDetailSection(title, rows) {
  return `
    <section class="detail-section">
      <h3>${escapeHtml(title)}</h3>
      <div class="info-grid">${rows.join("")}</div>
    </section>
  `;
}

function renderSearchResult(summaryData) {
  const code = pick(summaryData, ["stock_code", "code"], state.lastSearchCode || "-");
  const name = pick(summaryData, ["stock_name", "name"], "股票");
  const market = pick(summaryData, ["market_type", "market"], "-");
  const industry = pick(summaryData, ["industry"], "-");
  const tradeDate = pick(summaryData, ["trade_date", "date"], "-");
  const score = pick(summaryData, ["chip_score", "total_score", "score"], "-");
  const scoreClass = getScoreClass(score);
  const scoreText = getScoreText(score);
  const closePrice = pick(summaryData, ["close_price", "closing_price", "close"], "-");
  const change = pick(summaryData, ["price_change", "change", "change_price"], "-");
  const changeClass = getChangeClass(change);
  const foreignNet = pick(summaryData, ["foreign_net", "foreign_buy_sell", "foreign_net_buy", "foreign_net_buy_sell"], "-");
  const trustNet = pick(summaryData, ["investment_trust_net", "investment_trust_buy_sell", "trust_net_buy", "investment_trust_net_buy_sell"], "-");
  const dealerNet = pick(summaryData, ["dealer_net", "dealer_buy_sell", "dealer_net_buy", "dealer_net_buy_sell"], "-");
  const totalNet = pick(summaryData, ["total_net"], "-");

  stockList.innerHTML = `
    <article class="stock-card search-result-card">
      <div class="stock-top">
        <div class="stock-main">
          <span class="rank-badge search-badge">查詢結果</span>
          <div class="stock-name">
            <h3>${escapeHtml(name)}</h3>
            <span class="stock-code">${escapeHtml(code)}</span>
            <span class="badge">${escapeHtml(market)}</span>
            <span class="badge">${escapeHtml(industry)}</span>
          </div>
        </div>
        <div class="score-box ${scoreClass}">
          <span class="score-value">${formatNumber(score)}</span>
          <span class="score-label">籌碼分數</span>
        </div>
      </div>

      <div class="quick-summary search-summary">
        <span class="summary-pill ${scoreClass}">${escapeHtml(scoreText)}</span>
        <span class="summary-text">收盤 ${formatDirectionalClosePrice(closePrice, change)}，漲跌 <strong class="${changeClass}">${formatPrice(change)}</strong></span>
      </div>

      ${renderDetailSection("最新行情", [
        createInfoItem("資料日", formatDate(tradeDate)),
        createInfoItem("開盤", formatPrice(pick(summaryData, ["open_price"]))),
        createInfoItem("最高", formatPrice(pick(summaryData, ["high_price"]))),
        createInfoItem("最低", formatPrice(pick(summaryData, ["low_price"]))),
        createInfoItem("收盤", formatPrice(closePrice), getPriceDirectionClass(change, closePrice)),
        createInfoItem("漲跌", formatPrice(change), changeClass),
        createInfoItem("成交量", formatNumber(pick(summaryData, ["volume", "trade_volume"]))),
        createInfoItem("成交金額", formatNumber(pick(summaryData, ["transaction_amount"]))),
      ])}

      ${renderDetailSection("三大法人", [
        createInfoItem("外資買超", formatNumber(foreignNet), getChangeClass(foreignNet)),
        createInfoItem("投信買超", formatNumber(trustNet), getChangeClass(trustNet)),
        createInfoItem("自營商", formatNumber(dealerNet), getChangeClass(dealerNet)),
        createInfoItem("法人合計", formatNumber(totalNet), getChangeClass(totalNet)),
      ])}

      ${renderDetailSection("籌碼狀態", [
        createStatusItem("外資", pick(summaryData, ["foreign_status", "foreign_investor_status"])),
        createStatusItem("投信", pick(summaryData, ["investment_trust_status", "trust_status"])),
        createStatusItem("自營商", pick(summaryData, ["dealer_status"])),
        createStatusItem("大戶", pick(summaryData, ["big_holder_status"])),
        createStatusItem("成交量", pick(summaryData, ["volume_status"])),
        createStatusItem("股價位置", pick(summaryData, ["price_position", "price_position_status"])),
      ])}

      ${renderDetailSection("分數拆解", [
        createInfoItem("外資分數", formatNumber(pick(summaryData, ["foreign_score"]))),
        createInfoItem("投信分數", formatNumber(pick(summaryData, ["investment_trust_score", "trust_score"]))),
        createInfoItem("自營商分數", formatNumber(pick(summaryData, ["dealer_score"]))),
        createInfoItem("大戶分數", formatNumber(pick(summaryData, ["big_holder_score"]))),
        createInfoItem("成交量分數", formatNumber(pick(summaryData, ["volume_score"]))),
        createInfoItem("股價位置分數", formatNumber(pick(summaryData, ["price_score", "price_position_score"]))),
      ])}

      <div class="result-note">
        <strong>提醒：</strong>籌碼分數是觀察工具，不代表一定會上漲；建議搭配趨勢、成交量與風險控管一起看。
      </div>

      <div class="card-actions search-actions">
        <span class="card-note">資料日：${formatDate(tradeDate)}</span>
        ${getCardActionButtons(code, "看更多明細")}
      </div>
    </article>
  `;
}

function getFirstArrayItem(value) {
  if (Array.isArray(value)) return value[0] || {};
  if (value && Array.isArray(value.data)) return value.data[0] || {};
  return value || {};
}

function normalizeStockCode(value) {
  return String(value ?? "").trim().replace(/\s+/g, "").toUpperCase();
}

function isValidStockCode(stockCode) {
  return /^[0-9A-Z]{2,10}$/.test(stockCode);
}

function getRecentSearches() {
  try {
    const rows = JSON.parse(window.localStorage.getItem(RECENT_SEARCH_STORAGE_KEY) || "[]");
    return Array.isArray(rows) ? rows.filter(isValidStockCode).slice(0, 6) : [];
  } catch (error) {
    return [];
  }
}

function saveRecentSearch(stockCode) {
  const code = normalizeStockCode(stockCode);
  if (!isValidStockCode(code)) return;

  const nextRows = [code, ...getRecentSearches().filter((item) => item !== code)].slice(0, 6);
  window.localStorage.setItem(RECENT_SEARCH_STORAGE_KEY, JSON.stringify(nextRows));
  renderRecentSearches();
}

function renderRecentSearches() {
  const rows = getRecentSearches();

  if (rows.length === 0) {
    recentSearches.innerHTML = "";
    return;
  }

  recentSearches.innerHTML = `
    <span class="recent-label">最近查詢：</span>
    ${rows.map((code) => `<button class="recent-search-btn" type="button" data-search-code="${escapeHtml(code)}">${escapeHtml(code)}</button>`).join("")}
  `;
}

async function searchStock(codeFromButton = "") {
  const stockCode = normalizeStockCode(codeFromButton || stockSearchInput.value);

  if (!stockCode) {
    showStatus("請先輸入股票代號，例如 2330。", "error");
    stockSearchInput.focus();
    return;
  }

  if (!isValidStockCode(stockCode)) {
    showStatus("股票代號格式不正確，請輸入 2 到 10 碼的數字或英文字。", "error");
    stockSearchInput.focus();
    return;
  }

  stockSearchInput.value = stockCode;
  hideStatus();
  setSearchLoading(true);
  stockList.innerHTML = `
    <article class="stock-card loading-card">
      <div class="skeleton skeleton-title"></div>
      <div class="loading-grid">
        <div class="skeleton skeleton-text"></div>
        <div class="skeleton skeleton-text"></div>
        <div class="skeleton skeleton-text"></div>
        <div class="skeleton skeleton-text"></div>
      </div>
    </article>
  `;

  try {
    const result = await fetchJson(`/stock/${encodeURIComponent(stockCode)}/summary`);
    const summaryData = getFirstArrayItem(result);

    if (!summaryData || !pick(summaryData, ["stock_code", "code"], "")) {
      throw new Error("查不到這檔股票，請確認股票代號是否正確。");
    }

    state.lastSearchCode = stockCode;
    state.lastSearchData = summaryData;
    saveRecentSearch(stockCode);
    renderSearchResult(summaryData);
    showTemporaryStatus(`已查到 ${escapeHtml(pick(summaryData, ["stock_name", "name"], stockCode))}。`, "success");
  } catch (error) {
    const isNotFound = String(error.message).toLowerCase().includes("not found");
    stockList.innerHTML = `
      <article class="search-intro-card error-card">
        <div class="intro-icon">⚠️</div>
        <h3>查不到這檔股票</h3>
        <p>${isNotFound ? "請確認股票代號是否正確，或確認資料庫是否已匯入這檔股票。" : escapeHtml(error.message)}</p>
        <button class="retry-btn" type="button" data-focus-search="true">重新輸入</button>
      </article>
    `;
    showStatus(isNotFound ? "查不到這檔股票，請確認股票代號是否正確。" : escapeHtml(error.message), "error");
  } finally {
    setSearchLoading(false);
  }
}


function buildStrategyBacktestQueryString() {
  const params = new URLSearchParams();
  const runId = String(state.strategyBacktestRunId || "").trim();

  if (runId) params.set("run_id", runId);
  if (state.strategyBacktestFilterStrategy) params.set("strategy", state.strategyBacktestFilterStrategy);
  if (state.strategyBacktestFilterOutcome) params.set("outcome", state.strategyBacktestFilterOutcome);
  if (state.strategyBacktestSearch) params.set("search", state.strategyBacktestSearch);
  params.set("sort", state.strategyBacktestSort || "5d_desc");
  params.set("limit", "50");

  return params.toString();
}

function getBacktestRunOptions() {
  return Array.isArray(state.strategyBacktestRuns) ? state.strategyBacktestRuns : [];
}

function renderStrategyBacktestFilters() {
  return `
    <section class="strategy-track-filter-panel strategy-backtest-filter-panel">
      <div class="strategy-filter-title">
        <div>
          <p class="section-kicker">V1.3-3 策略回測</p>
          <h3>回測條件</h3>
          <p>選擇 Run ID、策略、結果與排序方式，檢查歷史策略訊號後續表現。</p>
        </div>
      </div>
      <form class="strategy-track-filter-form" data-strategy-backtest-filter-form>
        <label>
          <span>回測任務</span>
          <select name="run_id">
            ${getBacktestRunOptions().map((run) => `
              <option value="${escapeHtml(run.id)}" ${String(run.id) === String(state.strategyBacktestRunId) ? "selected" : ""}>
                Run ${escapeHtml(run.id)}｜${formatDate(run.start_date)} ~ ${formatDate(run.end_date)}｜${formatNumber(run.signal_count)} 筆
              </option>
            `).join("")}
          </select>
        </label>
        <label>
          <span>策略</span>
          <select name="strategy">
            <option value="">全部策略</option>
            ${getStrategyOptions().map((item) => `
              <option value="${escapeHtml(item.key)}" ${item.key === state.strategyBacktestFilterStrategy ? "selected" : ""}>${escapeHtml(item.name)}</option>
            `).join("")}
          </select>
        </label>
        <label>
          <span>結果</span>
          <select name="outcome">
            ${STRATEGY_BACKTEST_OUTCOME_OPTIONS.map((item) => `
              <option value="${escapeHtml(item.key)}" ${item.key === state.strategyBacktestFilterOutcome ? "selected" : ""}>${escapeHtml(item.label)}</option>
            `).join("")}
          </select>
        </label>
        <label>
          <span>排序</span>
          <select name="sort">
            ${STRATEGY_BACKTEST_SORT_OPTIONS.map((item) => `
              <option value="${escapeHtml(item.key)}" ${item.key === state.strategyBacktestSort ? "selected" : ""}>${escapeHtml(item.label)}</option>
            `).join("")}
          </select>
        </label>
        <label class="wide-field">
          <span>搜尋</span>
          <input name="search" type="search" value="${escapeHtml(state.strategyBacktestSearch)}" placeholder="例如：2330、台積電、半導體、法人" />
        </label>
        <div class="filter-actions">
          <button class="watch-btn" type="submit">套用篩選</button>
          <button class="ghost-btn compact" type="button" data-strategy-backtest-reset>清除篩選</button>
        </div>
      </form>
    </section>
  `;
}

function renderStrategyBacktestMetricTabs() {
  return `
    <div class="strategy-performance-metric-row">
      ${STRATEGY_BACKTEST_METRICS.map((metric) => `
        <button
          class="metric-switch-btn ${state.strategyBacktestMetric === metric.key ? "active" : ""}"
          type="button"
          data-strategy-backtest-metric="${escapeHtml(metric.key)}"
        >${escapeHtml(metric.label)}</button>
      `).join("")}
    </div>
  `;
}

function renderStrategyBacktestSummary() {
  const summary = state.strategyBacktestSummary || {};
  const run = summary.run || {};
  const strategies = Array.isArray(summary.strategy_stats) ? summary.strategy_stats : [];
  const metric = getBacktestMetric();
  const metricAvgField = metric.key === "1d" ? "avg_return_1d" : metric.key === "3d" ? "avg_return_3d" : metric.key === "latest" ? "avg_latest_return" : "avg_return_5d";
  const metricWinField = metric.key === "1d" ? "win_rate_1d" : metric.key === "3d" ? "win_rate_3d" : metric.key === "latest" ? "win_rate_5d" : "win_rate_5d";
  const rankings = state.strategyBacktestRankings?.data || state.strategyBacktestRankings || {};
  const rankingSummary = rankings.summary || {};

  return `
    <section class="strategy-tracking-summary strategy-backtest-summary">
      <div class="strategy-summary-head">
        <div>
          <p class="section-kicker">Run ${escapeHtml(run.id || state.strategyBacktestRunId || "-")}</p>
          <h3>策略回測總覽</h3>
          <p>${formatDate(run.start_date)} ~ ${formatDate(run.end_date)}，共 ${formatNumber(run.trading_days_count)} 個交易日。</p>
        </div>
        <span class="summary-pill score-high">${escapeHtml(metric.label)}</span>
      </div>
      ${renderStrategyBacktestMetricTabs()}
      <div class="tracking-metric-grid">
        <article><span>總訊號</span><strong>${formatNumber(run.signal_count)}</strong></article>
        <article><span>${escapeHtml(metric.label)}平均</span><strong class="${getReturnClass(rankingSummary.avg_return || run[metricAvgField])}">${formatReturnPercent(rankingSummary.avg_return || run[metricAvgField])}</strong></article>
        <article><span>5 日勝率</span><strong>${formatPercent(run.win_rate_5d)}</strong></article>
        <article><span>成功 / 失敗</span><strong>${formatNumber(run.success_count)} / ${formatNumber(run.fail_count)}</strong></article>
        <article><span>待資料</span><strong>${formatNumber(run.pending_count)}</strong></article>
      </div>
      ${strategies.length ? `
        <div class="strategy-rank-table">
          <h4>各策略回測表現</h4>
          ${strategies.map((item, index) => `
            <div class="strategy-rank-row">
              <span>${index + 1}. ${escapeHtml(item.strategy_name || item.strategy_key)}</span>
              <strong class="${getReturnClass(item[metricAvgField])}">平均 ${formatReturnPercent(item[metricAvgField])}</strong>
              <small>5 日勝率 ${formatPercent(item.win_rate_5d)}</small>
              <small>樣本 ${formatNumber(item.signal_count)}</small>
            </div>
          `).join("")}
        </div>
      ` : ""}
    </section>
  `;
}

function renderStrategyBacktestRankingModeTabs() {
  const activeMode = getBacktestRankingMode().key;

  return `
    <div class="backtest-ranking-mode-tabs">
      ${STRATEGY_BACKTEST_RANKING_MODES.map((mode) => `
        <button
          class="metric-switch-btn ${activeMode === mode.key ? "active" : ""}"
          type="button"
          data-strategy-backtest-ranking-mode="${escapeHtml(mode.key)}"
        >${escapeHtml(mode.label)}</button>
      `).join("")}
    </div>
  `;
}

function renderBacktestRankingStatCards(payload, metric) {
  const summary = payload.summary || {};
  const bestStocks = Array.isArray(payload.best_stocks) ? payload.best_stocks : [];
  const weakestStocks = Array.isArray(payload.weakest_stocks) ? payload.weakest_stocks : [];
  const bestReturn = bestStocks[0]?.selected_return_percent ?? null;
  const weakestReturn = weakestStocks[0]?.selected_return_percent ?? null;
  const bestWeakGap = toNumber(bestReturn) !== null && toNumber(weakestReturn) !== null
    ? toNumber(bestReturn) - toNumber(weakestReturn)
    : null;

  return `
    <div class="strategy-performance-stat-grid backtest-ranking-stat-grid">
      <article class="performance-stat-card">
        <span class="stat-label">${escapeHtml(metric.label)}平均</span>
        <strong class="${getReturnClass(summary.avg_return)}">${formatReturnPercent(summary.avg_return)}</strong>
        <small>可用樣本 ${formatNumber(summary.available_count)} / ${formatNumber(summary.signal_count)}</small>
      </article>
      <article class="performance-stat-card">
        <span class="stat-label">正報酬比例</span>
        <strong>${formatPercent(summary.win_rate)}</strong>
        <small>正 ${formatNumber(summary.positive_count)}｜負 ${formatNumber(summary.negative_count)}</small>
      </article>
      <article class="performance-stat-card">
        <span class="stat-label">最佳 / 最弱差距</span>
        <strong class="${getReturnClass(bestWeakGap)}">${formatReturnPercent(bestWeakGap)}</strong>
        <small>衡量排行分散程度</small>
      </article>
      <article class="performance-stat-card">
        <span class="stat-label">待資料</span>
        <strong>${formatNumber(summary.pending_count)}</strong>
        <small>尚無 ${escapeHtml(metric.label)} 價格資料</small>
      </article>
    </div>
  `;
}

function renderBacktestStockRankingRow(row, index, rankType = "best") {
  const code = pick(row, ["stock_code"], "-");
  const name = pick(row, ["stock_name"], code);
  const selectedReturn = pick(row, ["selected_return_percent"], null);
  const rankClass = rankType === "weakest" ? "weak-ranking-row" : "best-ranking-row";

  return `
    <article class="backtest-stock-rank-card ${rankClass}">
      <div class="backtest-rank-main">
        <span class="rank-badge">${index + 1}</span>
        <div>
          <h4>${escapeHtml(code)} ${escapeHtml(name)}</h4>
          <p>${escapeHtml(pick(row, ["strategy_name"], "策略"))}｜${formatDate(pick(row, ["signal_trade_date"], "-"))}</p>
        </div>
      </div>
      <div class="backtest-rank-return ${getReturnClass(selectedReturn)}">
        <strong>${formatReturnPercent(selectedReturn)}</strong>
        <span>${escapeHtml(getBacktestMetric().label)}</span>
      </div>
      <div class="backtest-rank-meta">
        <span>${escapeHtml(pick(row, ["market_type"], "-"))}</span>
        <span>${escapeHtml(pick(row, ["industry"], "-"))}</span>
        <span>分數 ${formatNumber(pick(row, ["strategy_score"], "-"))}</span>
        <span class="${getBacktestOutcomeClass(pick(row, ["outcome_label"], "pending"))}">${escapeHtml(getBacktestOutcomeText(pick(row, ["outcome_label"], "pending")))}</span>
      </div>
      <div class="strategy-performance-pills compact-pills">
        ${renderPerformancePill("1日", pick(row, ["return_1d_percent"], null), "")}
        ${renderPerformancePill("3日", pick(row, ["return_3d_percent"], null), "")}
        ${renderPerformancePill("5日", pick(row, ["return_5d_percent"], null), "")}
        ${renderPerformancePill("目前", pick(row, ["latest_return_percent"], null), "")}
      </div>
      <div class="card-actions rank-card-actions">
        <span class="card-note">進場價 ${formatPrice(pick(row, ["entry_price"], "-"))}</span>
        <div class="action-buttons">
          <button class="watch-btn" type="button" data-watch-action="add" data-code="${escapeHtml(code)}">加入自選</button>
          <button class="detail-btn" type="button" data-code="${escapeHtml(code)}">看明細</button>
        </div>
      </div>
    </article>
  `;
}

function renderBacktestStrategyRankingCard(item, index, metric) {
  const avgReturn = pick(item, ["avg_return"], null);
  const totalAvailable = toNumber(item.available_count) || 0;
  const signalCount = toNumber(item.signal_count) || 0;
  const availableRatio = signalCount > 0 ? (totalAvailable / signalCount) * 100 : null;

  return `
    <article class="backtest-strategy-rank-card">
      <div class="backtest-strategy-rank-head">
        <span class="rank-badge">${index + 1}</span>
        <div>
          <h4>${escapeHtml(item.strategy_name || item.strategy_key || "策略")}</h4>
          <p>${escapeHtml(metric.label)} 樣本 ${formatNumber(item.available_count)} / ${formatNumber(item.signal_count)}</p>
        </div>
        <strong class="${getReturnClass(avgReturn)}">${formatReturnPercent(avgReturn)}</strong>
      </div>
      <div class="backtest-strategy-rank-bars">
        <div>
          <span>勝率 ${formatPercent(item.win_rate)}</span>
          <div class="rank-progress"><i style="width:${Math.max(0, Math.min(100, toNumber(item.win_rate) || 0))}%"></i></div>
        </div>
        <div>
          <span>可用資料 ${formatPercent(availableRatio)}</span>
          <div class="rank-progress muted-progress"><i style="width:${Math.max(0, Math.min(100, availableRatio || 0))}%"></i></div>
        </div>
      </div>
      <div class="backtest-rank-meta">
        <span>正 ${formatNumber(item.positive_count)}</span>
        <span>負 ${formatNumber(item.negative_count)}</span>
        <span>待資料 ${formatNumber(item.pending_count)}</span>
      </div>
    </article>
  `;
}

function renderBacktestRankingColumns(bestStocks, weakestStocks) {
  return `
    <div class="backtest-ranking-columns">
      <section>
        <div class="ranking-section-title">
          <h4>最佳股票排行</h4>
          <span>報酬高到低</span>
        </div>
        <div class="backtest-stock-rank-list">
          ${bestStocks.slice(0, 10).map((row, index) => renderBacktestStockRankingRow(row, index, "best")).join("") || `<p class="muted-text">目前沒有足夠資料。</p>`}
        </div>
      </section>
      <section>
        <div class="ranking-section-title">
          <h4>最弱股票排行</h4>
          <span>報酬低到高</span>
        </div>
        <div class="backtest-stock-rank-list">
          ${weakestStocks.slice(0, 10).map((row, index) => renderBacktestStockRankingRow(row, index, "weakest")).join("") || `<p class="muted-text">目前沒有足夠資料。</p>`}
        </div>
      </section>
    </div>
  `;
}

function renderBacktestStrategyRankingList(strategyRankings, metric) {
  return `
    <section class="backtest-strategy-rank-list-wrap">
      <div class="ranking-section-title">
        <h4>策略績效排行</h4>
        <span>依 ${escapeHtml(metric.label)} 平均報酬排序</span>
      </div>
      <div class="backtest-strategy-rank-list">
        ${strategyRankings.map((item, index) => renderBacktestStrategyRankingCard(item, index, metric)).join("") || `<p class="muted-text">目前沒有策略排行資料。</p>`}
      </div>
    </section>
  `;
}

function renderStrategyBacktestRankingPanel() {
  const payload = state.strategyBacktestRankings?.data || state.strategyBacktestRankings || {};
  const bestStocks = Array.isArray(payload.best_stocks) ? payload.best_stocks : [];
  const weakestStocks = Array.isArray(payload.weakest_stocks) ? payload.weakest_stocks : [];
  const strategyRankings = Array.isArray(payload.strategy_rankings) ? payload.strategy_rankings : [];
  const metric = getBacktestMetric();
  const rankingMode = getBacktestRankingMode().key;

  const showStocks = rankingMode === "overview" || rankingMode === "best" || rankingMode === "weakest";
  const showStrategies = rankingMode === "overview" || rankingMode === "strategy";

  return `
    <section class="strategy-ranking-section strategy-backtest-ranking-section enhanced-backtest-ranking-section">
      <div class="strategy-ranking-header">
        <div>
          <p class="section-kicker">V1.3-3-4 排行榜</p>
          <h3>回測排行榜強化</h3>
          <p>依 ${escapeHtml(metric.label)} 檢查最佳股票、最弱股票與各策略平均表現。</p>
        </div>
        <div class="ranking-limit-note">排行榜不受搜尋條件影響</div>
      </div>
      ${renderStrategyBacktestMetricTabs()}
      ${renderStrategyBacktestRankingModeTabs()}
      ${renderBacktestRankingStatCards(payload, metric)}
      ${showStocks && rankingMode !== "weakest" ? renderBacktestRankingColumns(bestStocks, rankingMode === "overview" ? weakestStocks : []) : ""}
      ${showStocks && rankingMode === "weakest" ? renderBacktestRankingColumns([], weakestStocks) : ""}
      ${showStrategies ? renderBacktestStrategyRankingList(strategyRankings, metric) : ""}
      <div class="strategy-result-note compact-note">
        排行榜不受搜尋條件影響，只比較整個 Run 中已有價格資料的訊號；樣本數太少時，平均報酬容易被單一股票放大或扭曲。
      </div>
    </section>
  `;
}

function renderStrategyBacktestResultCard(row, index) {
  const metric = getBacktestMetric();
  const selectedReturn = pick(row, [metric.field], null);
  const code = pick(row, ["stock_code"], "-");
  const name = pick(row, ["stock_name"], code);
  const outcome = pick(row, ["outcome_label"], "pending");

  return `
    <article class="stock-card strategy-backtest-card">
      <div class="stock-top">
        <div class="stock-main">
          <span class="rank-badge">回測 ${index + 1}</span>
          <div class="stock-name">
            <h3>${escapeHtml(name)}</h3>
            <span class="stock-code">${escapeHtml(code)}</span>
            <span class="badge">${escapeHtml(pick(row, ["market_type"], "-"))}</span>
            <span class="badge">${escapeHtml(pick(row, ["industry"], "-"))}</span>
          </div>
        </div>
        <div class="score-box ${getReturnClass(selectedReturn)}">
          <span class="score-value">${formatReturnPercent(selectedReturn)}</span>
          <span class="score-label">${escapeHtml(metric.shortLabel)}</span>
        </div>
      </div>
      <div class="quick-summary">
        <span class="summary-pill score-mid">${escapeHtml(pick(row, ["strategy_name"], "策略"))}</span>
        <span class="summary-pill ${getBacktestOutcomeClass(outcome)}">${escapeHtml(getBacktestOutcomeText(outcome))}</span>
        <span class="summary-text">${escapeHtml(pick(row, ["trigger_summary"], "符合策略條件"))}</span>
      </div>
      <div class="strategy-performance-pills">
        ${renderPerformancePill("1日", pick(row, ["return_1d_percent"], null), pick(row, ["price_after_1d_date"], ""))}
        ${renderPerformancePill("3日", pick(row, ["return_3d_percent"], null), pick(row, ["price_after_3d_date"], ""))}
        ${renderPerformancePill("5日", pick(row, ["return_5d_percent"], null), pick(row, ["price_after_5d_date"], ""))}
        ${renderPerformancePill("目前", pick(row, ["latest_return_percent"], null), pick(row, ["latest_price_date"], ""))}
      </div>
      <div class="info-grid strategy-info-grid">
        ${createInfoItem("訊號日", formatDate(pick(row, ["signal_trade_date"], "-")))}
        ${createInfoItem("策略分數", formatNumber(pick(row, ["strategy_score"], "-")))}
        ${createInfoItem("進場價", `${formatPrice(pick(row, ["entry_price"], "-"))} / ${formatDate(pick(row, ["entry_price_date"], "-"))}`)}
        ${createInfoItem("目前價", `${formatPrice(pick(row, ["latest_price"], "-"))} / ${formatDate(pick(row, ["latest_price_date"], "-"))}`)}
        ${createInfoItem("結果", escapeHtml(pick(row, ["outcome_description"], getBacktestOutcomeText(outcome))), getBacktestOutcomeClass(outcome))}
      </div>
      <div class="card-actions">
        <span class="card-note">Run ID：${escapeHtml(pick(row, ["run_id"], state.strategyBacktestRunId || "-"))}</span>
        <div class="action-buttons">
          <button class="watch-btn" type="button" data-watch-action="add" data-code="${escapeHtml(code)}">加入自選</button>
          <button class="detail-btn" type="button" data-code="${escapeHtml(code)}">看明細</button>
        </div>
      </div>
    </article>
  `;
}

function renderStrategyBacktestResultsSection(rows) {
  const searchText = String(state.strategyBacktestSearch || "").trim();
  const hasSearch = Boolean(searchText);
  const totalCount = Number.isFinite(Number(state.strategyBacktestResultCount))
    ? Number(state.strategyBacktestResultCount)
    : rows.length;

  return `
    <section id="strategyBacktestResultsSection" class="strategy-backtest-results-section">
      <div class="strategy-result-header">
        <div>
          <p class="section-kicker">回測結果清單</p>
          <h3>${hasSearch ? `目前搜尋：${escapeHtml(searchText)}` : "回測結果清單"}</h3>
          <p>${hasSearch ? `共找到 ${formatNumber(totalCount)} 筆回測訊號` : "依目前篩選條件列出策略訊號明細。"}</p>
        </div>
        ${hasSearch ? `<span class="summary-pill score-high">搜尋結果</span>` : `<span class="summary-pill">明細</span>`}
      </div>
      <div class="strategy-result-note">
        回測是用歷史資料檢查策略訊號，不是保證未來績效。樣本數越多，統計才越有參考價值。
      </div>
      ${rows.length ? rows.map(renderStrategyBacktestResultCard).join("") : `
        <article class="search-intro-card">
          <div class="intro-icon">🔎</div>
          <h3>${hasSearch ? `${escapeHtml(searchText)} 在本次回測沒有策略訊號` : "沒有符合篩選條件的回測結果"}</h3>
          <p>${hasSearch ? "請改用「個股查詢」查看股票目前資料。" : "請調整策略、結果或搜尋關鍵字。"}</p>
          ${hasSearch ? `
            <div class="example-row">
              <button class="example-btn" type="button" data-go-page="search">前往個股查詢</button>
              <button class="example-btn" type="button" data-strategy-backtest-reset>清除搜尋</button>
            </div>
          ` : ""}
        </article>
      `}
    </section>
  `;
}

function renderStrategyBacktestEmpty() {
  stockList.innerHTML = `
    ${renderStrategyBacktestFilters()}
    <article class="search-intro-card">
      <div class="intro-icon">📊</div>
      <h3>目前沒有符合條件的回測資料</h3>
      <p>可以改用其他策略、清除搜尋條件，或先執行 npm run strategy-backtests:generate 產生回測結果。</p>
      <div class="example-row">
        <button class="example-btn" type="button" data-strategy-backtest-reset>清除篩選</button>
      </div>
    </article>
  `;
}

function renderStrategyBacktestPage() {
  const rows = Array.isArray(state.latestRows) ? state.latestRows : [];

  if (!state.strategyBacktestSummary && rows.length === 0) {
    renderStrategyBacktestEmpty();
    return;
  }

  const hasSearch = Boolean(String(state.strategyBacktestSearch || "").trim());
  const resultsSection = renderStrategyBacktestResultsSection(rows);
  const rankingPanel = renderStrategyBacktestRankingPanel();

  stockList.innerHTML = `
    ${renderStrategyBacktestFilters()}
    ${renderStrategyBacktestSummary()}
    ${hasSearch ? resultsSection : rankingPanel}
    ${hasSearch ? rankingPanel : resultsSection}
  `;
}

function handleStrategyBacktestFilterSubmit(form) {
  const formData = new FormData(form);
  const runId = String(formData.get("run_id") || "").trim();
  const strategy = String(formData.get("strategy") || "").trim();
  const outcome = String(formData.get("outcome") || "").trim();
  const sort = String(formData.get("sort") || "5d_desc").trim();
  const search = String(formData.get("search") || "").trim();

  state.strategyBacktestRunId = runId;
  state.strategyBacktestFilterStrategy = getStrategyOptions().some((item) => item.key === strategy) ? strategy : "";
  state.strategyBacktestFilterOutcome = STRATEGY_BACKTEST_OUTCOME_OPTIONS.some((item) => item.key === outcome) ? outcome : "";
  state.strategyBacktestSort = STRATEGY_BACKTEST_SORT_OPTIONS.some((item) => item.key === sort) ? sort : "5d_desc";
  state.strategyBacktestSearch = search;
  loadStrategyBacktests({ scrollToResults: Boolean(search) });
}

function resetStrategyBacktestFilters() {
  state.strategyBacktestFilterStrategy = "";
  state.strategyBacktestFilterOutcome = "";
  state.strategyBacktestSearch = "";
  state.strategyBacktestSort = "5d_desc";
  state.strategyBacktestResultCount = 0;
  loadStrategyBacktests();
}

function handleStrategyBacktestMetric(button) {
  const metric = button.dataset.strategyBacktestMetric;
  if (!STRATEGY_BACKTEST_METRICS.some((item) => item.key === metric)) return;
  state.strategyBacktestMetric = metric;
  state.strategyBacktestSort = getBacktestSortForMetric(metric, "desc");
  loadStrategyBacktests();
}

function handleStrategyBacktestRankingMode(button) {
  const mode = button.dataset.strategyBacktestRankingMode;
  if (!STRATEGY_BACKTEST_RANKING_MODES.some((item) => item.key === mode)) return;
  state.strategyBacktestRankingMode = mode;
  renderStrategyBacktestPage();
}

async function loadStrategyBacktests(options = {}) {
  setLoading(true);
  renderLoadingCards();

  try {
    const runsResponse = await fetchJson("/strategy-backtests/runs?status=completed&limit=20", { method: "GET", raw: true });
    state.strategyBacktestRuns = Array.isArray(runsResponse.data) ? runsResponse.data : [];

    if (!state.strategyBacktestRunId && state.strategyBacktestRuns.length > 0) {
      state.strategyBacktestRunId = String(state.strategyBacktestRuns[0].id);
    }

    const runQuery = state.strategyBacktestRunId ? `?run_id=${encodeURIComponent(state.strategyBacktestRunId)}` : "";
    const [summaryResponse, rankingResponse, resultsResponse] = await Promise.all([
      fetchJson(`/strategy-backtests/summary${runQuery}`, { method: "GET", raw: true }),
      fetchJson(`/strategy-backtests/rankings?metric=${encodeURIComponent(state.strategyBacktestMetric)}${state.strategyBacktestRunId ? `&run_id=${encodeURIComponent(state.strategyBacktestRunId)}` : ""}&limit=${encodeURIComponent(state.strategyBacktestRankingLimit || 20)}`, { method: "GET", raw: true }),
      fetchJson(`/strategy-backtests/results?${buildStrategyBacktestQueryString()}`, { method: "GET", raw: true }),
    ]);

    state.strategyBacktestSummary = summaryResponse.data || null;
    state.strategyBacktestRankings = rankingResponse.data ? { data: rankingResponse.data } : null;
    state.latestRows = Array.isArray(resultsResponse.data) ? resultsResponse.data : [];
    state.strategyBacktestResultCount = Number(resultsResponse.total_count ?? resultsResponse.count ?? state.latestRows.length) || 0;
    renderStrategyBacktestPage();
    if (options.scrollToResults && state.strategyBacktestSearch) {
      scrollToBacktestResults();
    }
    showTemporaryStatus(`已更新 ${formatNumber(state.strategyBacktestResultCount)} 筆回測結果。`, "success");
  } catch (error) {
    state.latestRows = [];
    state.strategyBacktestResultCount = 0;
    stockList.innerHTML = `
      <article class="search-intro-card error-card">
        <div class="intro-icon">⚠️</div>
        <h3>策略回測讀取失敗</h3>
        <p>${escapeHtml(error.message)}</p>
        <button class="retry-btn" type="button" id="retryBtn">重新讀取</button>
      </article>
    `;
    document.getElementById("retryBtn")?.addEventListener("click", loadList);
    showStatus(`策略回測讀取失敗：${escapeHtml(error.message)}`, "error");
  } finally {
    setLoading(false);
  }
}

async function loadList() {
  updatePageText();
  hideStatus();

  if (state.page === "account") {
    setLoading(false);
    renderAccountPage();
    return;
  }

  if (state.page === "search") {
    setLoading(false);
    if (state.lastSearchData) {
      renderSearchResult(state.lastSearchData);
    } else {
      renderSearchIntro();
    }
    return;
  }

  if (state.page === "alerts") {
    await loadAlerts();
    return;
  }

  if (state.page === "strategies") {
    await loadStrategies();
    return;
  }

  if (state.page === "strategyTracks") {
    await loadStrategyTracking();
    return;
  }

  if (state.page === "strategyBacktests") {
    await loadStrategyBacktests();
    return;
  }

  if (state.page === "watchlist") {
    if (!isAuthenticated()) {
      setLoading(false);
      renderWatchlistLoginPrompt();
      return;
    }

    setLoading(true);
    renderLoadingCards();

    try {
      const rows = await refreshWatchlistCodes();
      state.latestRows = rows;

      if (state.latestRows.length === 0) {
        renderEmptyWatchlist();
        showTemporaryStatus("目前還沒有自選股。", "success");
        return;
      }

      stockList.innerHTML = state.latestRows.map(renderStockCard).join("");
      showTemporaryStatus(`已更新 ${state.latestRows.length} 檔自選股。`, "success");
    } catch (error) {
      stockList.innerHTML = "";
      showStatus(`自選股讀取失敗：${escapeHtml(error.message)}`, "error");
    } finally {
      setLoading(false);
    }

    return;
  }

  setLoading(true);
  renderLoadingCards();

  try {
    const rows = await fetchJson(buildListPath());
    let latestRows = Array.isArray(rows) ? rows : [];

    if (state.page === "trust" || state.page === "foreignStreak" || state.page === "syncBuy" || state.page === "industryFlow" || state.page === "majorHolder") {
      if (state.market && state.page !== "industryFlow") {
        latestRows = latestRows.filter((row) => pick(row, ["market_type", "market"], "") === state.market);
      }

      latestRows = latestRows.slice(0, state.limit);
    }

    state.latestRows = latestRows;

    if (state.latestRows.length === 0) {
      stockList.innerHTML = "";
      showStatus("目前沒有股票資料，請確認後端 API 是否已有匯入資料。", "error");
      return;
    }

    stockList.innerHTML = state.latestRows.map(renderStockCard).join("");
    showTemporaryStatus(`已更新 ${state.latestRows.length} 檔股票。`, "success");
  } catch (error) {
    stockList.innerHTML = "";
    showStatus(
      `
        <div class="status-title">讀取失敗</div>
        <div>${escapeHtml(error.message)}</div>
        <div style="margin-top:10px;">
          <button class="retry-btn" type="button" id="retryBtn">重新讀取</button>
        </div>
      `,
      "error"
    );
    document.getElementById("retryBtn")?.addEventListener("click", loadList);
  } finally {
    setLoading(false);
  }
}

async function openDetail(stockCode) {
  detailModal.classList.remove("hidden");
  detailModal.setAttribute("aria-hidden", "false");
  detailTitle.textContent = `${stockCode} 載入中`;
  detailContent.innerHTML = `<div class="status-box">股票明細讀取中...</div>`;

  try {
    const [summary, prices, trades, scores, holders] = await Promise.allSettled([
      fetchJson(`/stock/${stockCode}/summary`),
      fetchJson(`/prices/${stockCode}?limit=260`),
      fetchJson(`/institutional-trades/${stockCode}`),
      fetchJson(`/radar-scores/${stockCode}`),
      fetchJson(`/major-holders/${stockCode}?limit=12`),
    ]);

    const summaryData = summary.status === "fulfilled" ? getFirstArrayItem(summary.value) : {};
    const priceRows = prices.status === "fulfilled" && Array.isArray(prices.value) ? prices.value : [];
    const enrichedPriceRows = enrichPriceRows(priceRows.length > 0 ? priceRows : [summaryData]);
    const tradeRows = trades.status === "fulfilled" && Array.isArray(trades.value) ? trades.value : [];
    const scoreRows = scores.status === "fulfilled" && Array.isArray(scores.value) ? scores.value : [];
    const holderRows = holders.status === "fulfilled" && Array.isArray(holders.value) ? holders.value : [];

    const latestPrice = priceRows[0] || summaryData || {};
    const latestTrade = tradeRows[0] || summaryData || {};
    const latestScore = scoreRows[0] || summaryData || {};

    const stockName = pick(summaryData, ["stock_name", "name"], pick(latestScore, ["stock_name", "name"], "股票"));
    const market = pick(summaryData, ["market_type", "market"], pick(latestScore, ["market_type", "market"]));
    const industry = pick(summaryData, ["industry"], "-");
    const totalScore = pick(latestScore, ["total_score", "chip_score", "score"], pick(summaryData, ["total_score", "chip_score", "score"], "-"));
    const closePrice = pick(latestPrice, ["close_price", "closing_price", "close"], pick(summaryData, ["close_price", "closing_price", "close"], "-"));
    const change = pick(latestPrice, ["price_change", "change", "change_price"], pick(summaryData, ["price_change", "change", "change_price"], "-"));

    state.chartZoomRows = enrichedPriceRows;
    state.chartZoomRange = "60";
    state.chartZoomTitle = `${stockName} ${stockCode} 技術圖表`;

    detailTitle.textContent = `${stockName} ${stockCode}`;

    detailContent.innerHTML = [
      `
        <section class="detail-hero">
          <div>
            <h3>${escapeHtml(stockName)}</h3>
            <div class="detail-meta-row">
              <span class="stock-code">${escapeHtml(stockCode)}</span>
              <span class="badge">${escapeHtml(market)}</span>
              <span class="badge">${escapeHtml(industry)}</span>
            </div>
          </div>
          <div class="score-box ${getScoreClass(totalScore)}">
            <span class="score-value">${formatNumber(totalScore)}</span>
            <span class="score-label">籌碼分數</span>
          </div>
        </section>
      `,
      renderDetailSection("最新行情", [
        createInfoItem("日期", formatDate(pick(latestPrice, ["trade_date", "date"]))),
        createInfoItem("收盤價", formatPrice(closePrice), getPriceDirectionClass(change, closePrice)),
        createInfoItem("漲跌", formatPrice(change), getChangeClass(change)),
        createInfoItem("成交量", formatNumber(pick(latestPrice, ["trade_volume", "volume"]))),
      ]),
      renderDetailSection("均線平均價格", renderMovingAverageItems(enrichedPriceRows)),
      renderTechnicalCharts(enrichedPriceRows),
      renderDetailSection("三大法人", [
        createInfoItem("外資", formatNumber(pick(latestTrade, ["foreign_buy_sell", "foreign_net", "foreign_net_buy", "foreign_net_buy_sell"])), getChangeClass(pick(latestTrade, ["foreign_buy_sell", "foreign_net", "foreign_net_buy", "foreign_net_buy_sell"]))),
        createInfoItem("投信", formatNumber(pick(latestTrade, ["investment_trust_buy_sell", "investment_trust_net", "trust_net_buy", "investment_trust_net_buy_sell"])), getChangeClass(pick(latestTrade, ["investment_trust_buy_sell", "investment_trust_net", "trust_net_buy", "investment_trust_net_buy_sell"]))),
        createInfoItem("自營商", formatNumber(pick(latestTrade, ["dealer_buy_sell", "dealer_net", "dealer_net_buy", "dealer_net_buy_sell"])), getChangeClass(pick(latestTrade, ["dealer_buy_sell", "dealer_net", "dealer_net_buy", "dealer_net_buy_sell"]))),
        createInfoItem("日期", formatDate(pick(latestTrade, ["trade_date", "date"]))),
      ]),
      renderMajorHolderDetailSection(holderRows),
      renderDetailSection("籌碼狀態", [
        createStatusItem("外資", pick(latestScore, ["foreign_status", "foreign_investor_status"])),
        createStatusItem("投信", pick(latestScore, ["investment_trust_status", "trust_status"])),
        createStatusItem("成交量", pick(latestScore, ["volume_status"])),
        createStatusItem("股價位置", pick(latestScore, ["price_position_status", "price_position"])),
      ]),
      renderDetailSection("分數拆解", [
        createInfoItem("外資分數", formatNumber(pick(latestScore, ["foreign_score"]))),
        createInfoItem("投信分數", formatNumber(pick(latestScore, ["investment_trust_score", "trust_score"]))),
        createInfoItem("自營商分數", formatNumber(pick(latestScore, ["dealer_score"]))),
        createInfoItem("成交量分數", formatNumber(pick(latestScore, ["volume_score"]))),
        createInfoItem("股價位置分數", formatNumber(pick(latestScore, ["price_score", "price_position_score"]))),
        createInfoItem("大戶分數", formatNumber(pick(latestScore, ["big_holder_score"]))),
      ]),
    ].join("");
  } catch (error) {
    detailContent.innerHTML = `<div class="status-box error">明細讀取失敗：${escapeHtml(error.message)}</div>`;
  }
}

function closeDetail() {
  closeChartZoom();
  detailModal.classList.add("hidden");
  detailModal.setAttribute("aria-hidden", "true");
}

function switchPage(page) {
  state.page = page;
  updateNavigationState(page);
  if (page === "alerts") {
    state.alertMode = "list";
  }
  if (page === "strategies") {
    state.strategySummary = null;
  }
  if (page === "strategyTracks") {
    state.strategyTrackSummary = null;
  }
  if (page === "strategyBacktests") {
    state.strategyBacktestSummary = null;
    state.strategyBacktestRankings = null;
  }
  loadList();
}

tabButtons.forEach((button) => {
  button.addEventListener("click", () => {
    switchPage(button.dataset.page);
  });
});

marketButtons.forEach((button) => {
  button.addEventListener("click", () => {
    marketButtons.forEach((btn) => btn.classList.remove("active"));
    button.classList.add("active");
    state.market = button.dataset.market;
    loadList();
  });
});

stockList.addEventListener("submit", (event) => {
  const strategyBacktestFilterForm = event.target.closest("[data-strategy-backtest-filter-form]");
  if (strategyBacktestFilterForm) {
    event.preventDefault();
    handleStrategyBacktestFilterSubmit(strategyBacktestFilterForm);
    return;
  }

  const strategyTrackFilterForm = event.target.closest("[data-strategy-track-filter-form]");
  if (strategyTrackFilterForm) {
    event.preventDefault();
    handleStrategyTrackFilterSubmit(strategyTrackFilterForm);
    return;
  }

  const strategyRiskForm = event.target.closest("[data-strategy-risk-form]");
  if (strategyRiskForm) {
    event.preventDefault();
    handleStrategyRiskSettingSubmit(strategyRiskForm);
    return;
  }

  const alertRuleForm = event.target.closest("[data-alert-rule-form]");
  if (alertRuleForm) {
    event.preventDefault();
    handleAlertRuleSubmit(alertRuleForm);
  }
});

stockList.addEventListener("click", (event) => {
  const orderButton = event.target.closest("[data-order-action]");
  if (orderButton) {
    handleWatchlistOrder(orderButton);
    return;
  }

  const strategyButton = event.target.closest("[data-strategy-key]");
  if (strategyButton) {
    handleStrategyChange(strategyButton);
    return;
  }

  const strategyTrackButton = event.target.closest("[data-strategy-track-action]");
  if (strategyTrackButton) {
    handleStrategyTrackAction(strategyTrackButton);
    return;
  }

  const strategyTrackRemoveButton = event.target.closest("[data-strategy-track-remove]");
  if (strategyTrackRemoveButton) {
    handleStrategyTrackRemove(strategyTrackRemoveButton);
    return;
  }

  const strategyPerformanceButton = event.target.closest("[data-strategy-performance-metric]");
  if (strategyPerformanceButton) {
    handleStrategyPerformanceMetric(strategyPerformanceButton);
    return;
  }

  const strategyBacktestMetricButton = event.target.closest("[data-strategy-backtest-metric]");
  if (strategyBacktestMetricButton) {
    handleStrategyBacktestMetric(strategyBacktestMetricButton);
    return;
  }

  const strategyBacktestRankingModeButton = event.target.closest("[data-strategy-backtest-ranking-mode]");
  if (strategyBacktestRankingModeButton) {
    handleStrategyBacktestRankingMode(strategyBacktestRankingModeButton);
    return;
  }

  const strategyBacktestResetButton = event.target.closest("[data-strategy-backtest-reset]");
  if (strategyBacktestResetButton) {
    resetStrategyBacktestFilters();
    return;
  }

  const strategyTrackFilterResetButton = event.target.closest("[data-strategy-track-filter-reset]");
  if (strategyTrackFilterResetButton) {
    resetStrategyTrackFilters();
    return;
  }

  const alertModeButton = event.target.closest("[data-alert-mode]");
  if (alertModeButton) {
    handleAlertMode(alertModeButton);
    return;
  }

  const alertRuleForm = event.target.closest("[data-alert-rule-form]");
  if (alertRuleForm && event.type === "submit") {
    handleAlertRuleSubmit(alertRuleForm);
    return;
  }

  const alertFilterButton = event.target.closest("[data-alert-filter]");
  if (alertFilterButton) {
    handleAlertFilter(alertFilterButton);
    return;
  }

  const alertReadButton = event.target.closest("[data-alert-read]");
  if (alertReadButton) {
    handleAlertMarkRead(alertReadButton);
    return;
  }

  const alertGenerateButton = event.target.closest("[data-alert-generate]");
  if (alertGenerateButton) {
    handleAlertsGenerate(alertGenerateButton);
    return;
  }

  const alertReadAllButton = event.target.closest("[data-alert-read-all]");
  if (alertReadAllButton) {
    handleAlertsReadAll(alertReadAllButton);
    return;
  }

  const alertDetailButton = event.target.closest("[data-alert-detail]");
  if (alertDetailButton) {
    openDetail(alertDetailButton.dataset.alertDetail);
    return;
  }

  const watchButton = event.target.closest("[data-watch-action]");
  if (watchButton) {
    handleWatchlistAction(watchButton);
    return;
  }

  const goAccountButton = event.target.closest("[data-go-account]");
  if (goAccountButton) {
    switchPage("account");
    return;
  }

  const v13RefreshButton = event.target.closest("[data-refresh-v13-status]");
  if (v13RefreshButton) {
    loadV13Status({ force: true });
    return;
  }

  const goPageButton = event.target.closest("[data-go-page]");
  if (goPageButton) {
    switchPage(goPageButton.dataset.goPage);
    return;
  }

  const logoutButton = event.target.closest("[data-logout]");
  if (logoutButton) {
    clearAuthSession(true);
    renderAccountPage();
    return;
  }

  const detailButton = event.target.closest(".detail-btn");
  if (detailButton) {
    openDetail(detailButton.dataset.code);
    return;
  }

  const exampleButton = event.target.closest("[data-search-code]");
  if (exampleButton) {
    searchStock(exampleButton.dataset.searchCode);
    return;
  }

  const focusButton = event.target.closest("[data-focus-search]");
  if (focusButton) {
    stockSearchInput.focus();
  }
});

recentSearches.addEventListener("click", (event) => {
  const button = event.target.closest("[data-search-code]");
  if (!button) return;
  searchStock(button.dataset.searchCode);
});

searchPanel.addEventListener("submit", (event) => {
  event.preventDefault();
  searchStock();
});

authMiniCard?.addEventListener("click", () => {
  switchPage("account");
});

backToTopBtn?.addEventListener("click", scrollToPageTop);
window.addEventListener("scroll", updateBackToTopVisibility, { passive: true });
updateBackToTopVisibility();

refreshBtn.addEventListener("click", loadList);
closeDetailBtn.addEventListener("click", closeDetail);

detailModal.addEventListener("click", (event) => {
  if (event.target.dataset.close === "true") closeDetail();
});

detailContent.addEventListener("click", (event) => {
  const expandButton = event.target.closest("[data-chart-expand]");
  if (expandButton) {
    openChartZoom();
  }
});

chartZoomContent?.addEventListener("click", (event) => {
  const rangeButton = event.target.closest("[data-chart-range]");
  if (rangeButton) {
    rerenderChartZoom(rangeButton.dataset.chartRange);
    return;
  }

  const resetButton = event.target.closest("[data-chart-reset]");
  if (resetButton) {
    rerenderChartZoom("60");
  }
});

closeChartZoomBtn?.addEventListener("click", closeChartZoom);

chartZoomModal?.addEventListener("click", (event) => {
  if (event.target.dataset.chartZoomClose === "true") closeChartZoom();
});


document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;

  if (chartZoomModal && !chartZoomModal.classList.contains("hidden")) {
    closeChartZoom();
    return;
  }

  closeDetail();
});

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  installBtn.classList.remove("hidden");
});

installBtn.addEventListener("click", async () => {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  installBtn.classList.add("hidden");
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("service-worker.js").then((registration) => registration.update()).catch(console.error);
  });
}

async function initApp() {
  updateNavigationState(state.page);
  await loadCurrentUser();
  loadList();
}

initApp();
