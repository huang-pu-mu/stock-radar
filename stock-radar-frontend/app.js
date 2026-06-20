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
};

const pageTitle = document.getElementById("pageTitle");
const pageDesc = document.getElementById("pageDesc");
const stockList = document.getElementById("stockList");
const statusBox = document.getElementById("statusBox");
const refreshBtn = document.getElementById("refreshBtn");
const tabButtons = document.querySelectorAll(".tab-btn");
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

function formatPercent(value) {
  const numberValue = toNumber(value);
  if (numberValue === null) return "-";
  return `${numberValue.toLocaleString("zh-TW", { maximumFractionDigits: 1 })}%`;
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

async function fetchJson(path, options = {}) {
  if (!API_BASE_URL || API_BASE_URL.includes("你的-api網址")) {
    throw new Error("尚未設定正式 API 網址。請打開 config.js，把 PRODUCTION_API_BASE_URL 改成你的 Node.js API 網址。");
  }

  const { auth = false, body, ...fetchOptions } = options;
  const headers = new Headers(fetchOptions.headers || {});

  if (body !== undefined) {
    headers.set("Content-Type", "application/json");
    fetchOptions.body = JSON.stringify(body);
  }

  if (auth && state.authToken) {
    headers.set("Authorization", `Bearer ${state.authToken}`);
  }

  const requestUrl = `${API_BASE_URL}${path}`;
  const response = await fetch(requestUrl, {
    ...fetchOptions,
    headers,
  });

  const rawText = await response.text();
  let result = null;

  try {
    result = rawText ? JSON.parse(rawText) : null;
  } catch (error) {
    const preview = rawText
      .replace(/\s+/g, " ")
      .slice(0, 120);
    const looksLikeHtml = /^\s*</.test(rawText);
    const hint = looksLikeHtml
      ? "目前打到的網址回傳 HTML，通常代表 API 網址指到前端站、API 路由尚未部署，或 Vercel 部署失敗。"
      : "目前回傳內容不是合法 JSON。";

    throw new Error(
      `${hint} HTTP ${response.status}，URL：${requestUrl}，回傳開頭：${preview || "空白回應"}`
    );
  }

  if (!response.ok || result?.success === false) {
    throw new Error(result?.message || result?.error || `API 查詢失敗：HTTP ${response.status}`);
  }

  if (Array.isArray(result)) return result;
  if (result?.data !== undefined) return result.data;
  return result;
}

window.resetStockRadarApiUrl = function resetStockRadarApiUrl() {
  window.localStorage.removeItem("STOCK_RADAR_API_BASE_URL");
  window.location.reload();
};
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

  refreshBtn.classList.toggle("hidden", isSearchPage || isAccountPage);
  marketRow.classList.toggle("hidden", isSearchPage || isAccountPage || isWatchlistPage);
  searchPanel.classList.toggle("hidden", !isSearchPage);

  if (state.page === "watchlist") {
    pageTitle.textContent = "自選股";
    pageDesc.textContent = "登入後，每個 Google 帳號都會看到自己的自選股票清單。";
    helpCard.innerHTML = `<strong>簡單看法：</strong><span>這裡只顯示你自己加入的股票；想移除就按「已自選」。</span>`;
    return;
  }

  if (state.page === "account") {
    pageTitle.textContent = "我的帳號";
    pageDesc.textContent = "使用 Google 帳號登入後，之後自選股就能依照不同使用者分開保存。";
    helpCard.innerHTML = `<strong>簡單看法：</strong><span>任何 Google 帳號都可以登入；登入後，自己的自選股會和其他使用者分開保存。</span>`;
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
          <button class="detail-btn" type="button" data-logout="true">登出</button>
        </div>
      </article>
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

function normalizeTextValue(value) {
  const text = String(value ?? "").trim();
  return text && text !== "-" ? text : "";
}

function firstNonEmptyValue(...values) {
  for (const value of values) {
    const text = normalizeTextValue(value);
    if (text) return text;
  }
  return "";
}

function getTodayDateText() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatCalendarEventType(value) {
  const text = normalizeTextValue(value);
  if (!text) return "其他事件";

  const lower = text.toLowerCase();
  if (text.includes("除權") && text.includes("息")) return "除權息";
  if (text.includes("除息") || lower.includes("ex-dividend")) return "除息";
  if (text.includes("除權") || lower.includes("ex-right")) return "除權";
  if (text.includes("發放") || text.includes("股利") || lower.includes("payment")) return "股利發放";
  if (text.includes("股東會") || lower.includes("shareholder")) return "股東會";
  if (text.includes("法說") || lower.includes("conference")) return "法說會";
  if (text.includes("停止過戶") || text.includes("閉鎖") || lower.includes("book")) return "停止過戶";
  return text;
}

function getCalendarImportanceClass(value) {
  const text = String(value ?? "normal").toLowerCase();
  if (text === "high") return "high";
  if (text === "low") return "low";
  return "normal";
}

function getCalendarEventTimingClass(eventDate) {
  const dateText = formatDate(eventDate);
  if (!dateText || dateText === "-") return "normal";
  return dateText >= getTodayDateText() ? "upcoming" : "past";
}

function getCalendarEventTimingText(eventDate) {
  return getCalendarEventTimingClass(eventDate) === "upcoming" ? "即將到來" : "近期已發生";
}

function renderEtfProfileDetailSection(profile, summaryData) {
  const securityType = firstNonEmptyValue(
    pick(profile, ["security_type"], ""),
    pick(summaryData, ["security_type"], ""),
  ).toUpperCase();
  const hasProfile = Boolean(profile && Object.keys(profile).length > 0 && normalizeTextValue(profile.stock_code));
  const isEtf = securityType === "ETF" || hasProfile;

  if (!isEtf) return "";

  if (!hasProfile && securityType === "ETF") {
    return `
      <section class="detail-section etf-profile-section">
        <h3>ETF 基本資料</h3>
        <div class="status-box">目前尚未建立完整 ETF 主檔資料。</div>
      </section>
    `;
  }

  const fundType = firstNonEmptyValue(pick(profile, ["fund_type"], ""), pick(summaryData, ["fund_type"], "")) || "-";
  const underlyingIndex = firstNonEmptyValue(pick(profile, ["underlying_index"], ""), pick(summaryData, ["underlying_index"], "")) || "-";
  const issuer = firstNonEmptyValue(pick(profile, ["issuer"], ""), pick(summaryData, ["issuer"], "")) || "-";
  const listingDate = firstNonEmptyValue(pick(profile, ["listing_date"], ""), pick(summaryData, ["listing_date"], "")) || "-";
  const source = firstNonEmptyValue(pick(profile, ["source"], ""), pick(summaryData, ["etf_profile_source"], "")) || "-";

  return renderDetailSection("ETF 基本資料", [
    createInfoItem("ETF 類型", escapeHtml(fundType)),
    createInfoItem("追蹤指數", escapeHtml(underlyingIndex)),
    createInfoItem("基金公司", escapeHtml(issuer)),
    createInfoItem("上市日期", formatDate(listingDate)),
    createInfoItem("資料來源", escapeHtml(source)),
  ]);
}

function renderCalendarEventCard(event) {
  const eventDate = formatDate(pick(event, ["event_date"]));
  const eventType = formatCalendarEventType(pick(event, ["event_type"]));
  const title = firstNonEmptyValue(pick(event, ["title"], ""), eventType) || "行事曆事件";
  const description = firstNonEmptyValue(pick(event, ["description"], ""));
  const source = firstNonEmptyValue(pick(event, ["source"], ""));
  const sourceUrl = firstNonEmptyValue(pick(event, ["source_url"], ""));
  const timingClass = getCalendarEventTimingClass(eventDate);
  const importanceClass = getCalendarImportanceClass(pick(event, ["importance"], "normal"));
  const sourceHtml = source
    ? sourceUrl
      ? `<a href="${escapeHtml(sourceUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(source)}</a>`
      : escapeHtml(source)
    : "-";

  return `
    <article class="calendar-event-card ${timingClass} ${importanceClass}">
      <div class="calendar-date-box">
        <strong>${escapeHtml(eventDate)}</strong>
        <span>${escapeHtml(getCalendarEventTimingText(eventDate))}</span>
      </div>
      <div class="calendar-event-main">
        <div class="calendar-event-title-row">
          <span class="calendar-type-chip ${importanceClass}">${escapeHtml(eventType)}</span>
          <h4>${escapeHtml(title)}</h4>
        </div>
        ${description ? `<p>${escapeHtml(description)}</p>` : ""}
        <div class="calendar-event-meta">資料來源：${sourceHtml}</div>
      </div>
    </article>
  `;
}

function renderCalendarDetailSection(events) {
  if (!Array.isArray(events) || events.length === 0) {
    return `
      <section class="detail-section calendar-section">
        <h3>個股 / ETF 行事曆</h3>
        <div class="status-box">目前尚無近期行事曆事件。</div>
      </section>
    `;
  }

  return `
    <section class="detail-section calendar-section">
      <h3>個股 / ETF 行事曆</h3>
      <div class="calendar-event-list">
        ${events.map(renderCalendarEventCard).join("")}
      </div>
    </section>
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

function hasDisplayValue(value) {
  return value !== null && value !== undefined && value !== "" && value !== "-";
}

function formatSnapshotTime(value) {
  if (!value || value === "-") return "-";
  const text = String(value);
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(text)) return escapeHtml(text.slice(0, 19));
  if (/^\d{4}-\d{2}-\d{2}T/.test(text)) return escapeHtml(text.replace("T", " ").slice(0, 19));
  return escapeHtml(text);
}

function formatQuoteType(row = {}) {
  if (row.is_realtime === true || row.is_realtime === 1 || row.is_realtime === "1") {
    return `<span class="status-chip good">即時 / 近即時快照</span>`;
  }

  const quoteType = String(row.quote_type || "").toLowerCase();
  if (quoteType.includes("snapshot")) {
    return `<span class="status-chip neutral">行情快照</span>`;
  }

  return `<span class="status-chip warn">最新收盤備援</span>`;
}

function normalizeOrderBookLevels(orderBookData = {}) {
  if (Array.isArray(orderBookData.levels)) return orderBookData.levels;

  return [1, 2, 3, 4, 5].map((level) => ({
    level,
    buy_price: orderBookData[`buy_price_${level}`],
    buy_volume: orderBookData[`buy_volume_${level}`],
    sell_price: orderBookData[`sell_price_${level}`],
    sell_volume: orderBookData[`sell_volume_${level}`],
  }));
}

function hasOrderBookLevelData(levels) {
  return levels.some((level) => (
    hasDisplayValue(level.buy_price) ||
    hasDisplayValue(level.buy_volume) ||
    hasDisplayValue(level.sell_price) ||
    hasDisplayValue(level.sell_volume)
  ));
}

function renderOrderBookTable(orderBookData = {}) {
  const levels = normalizeOrderBookLevels(orderBookData);

  if (!hasOrderBookLevelData(levels)) {
    return `
      <div class="status-box muted">
        目前尚未接入授權五檔委買委賣資料源；此區塊已先完成，等資料表有快照後會自動顯示。
      </div>
    `;
  }

  return `
    <div class="order-book-table-wrap">
      <table class="order-book-table">
        <thead>
          <tr>
            <th>檔位</th>
            <th>委買價</th>
            <th>委買張</th>
            <th>委賣價</th>
            <th>委賣張</th>
          </tr>
        </thead>
        <tbody>
          ${levels.map((level) => `
            <tr>
              <td>${escapeHtml(level.level || "-")}</td>
              <td class="price-up">${formatPrice(level.buy_price)}</td>
              <td>${formatNumber(level.buy_volume)}</td>
              <td class="price-down">${formatPrice(level.sell_price)}</td>
              <td>${formatNumber(level.sell_volume)}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderMicrostructureDetailSection(quoteData = {}, orderBookData = {}) {
  const quote = quoteData || {};
  const orderBook = orderBookData || {};
  const snapshotAt = pick(quote, ["snapshot_at", "updated_at", "trade_date"], pick(orderBook, ["snapshot_at", "updated_at", "quote_date"], "-"));
  const insideLots = pick(quote, ["inside_volume_lots"], pick(orderBook, ["inside_volume_lots"], "-"));
  const outsideLots = pick(quote, ["outside_volume_lots"], pick(orderBook, ["outside_volume_lots"], "-"));
  const buyTotalLots = pick(orderBook, ["buy_total_lots"], "-");
  const sellTotalLots = pick(orderBook, ["sell_total_lots"], "-");
  const quoteNotice = pick(quote, ["notice"], pick(orderBook, ["notice"], ""));

  return `
    <section class="detail-section microstructure-section">
      <h3>內外盤 / 五檔報價</h3>
      <div class="info-grid">
        ${createInfoItem("資料型態", formatQuoteType(quote))}
        ${createInfoItem("快照時間", formatSnapshotTime(snapshotAt))}
        ${createInfoItem("最新價", formatPrice(pick(quote, ["last_price", "close_price"])), getPriceDirectionClass(pick(quote, ["price_change"]), pick(quote, ["last_price", "close_price"]))) }
        ${createInfoItem("漲跌", `${formatPrice(pick(quote, ["price_change"]))} / ${formatPercent(pick(quote, ["price_change_percent"]))}`, getChangeClass(pick(quote, ["price_change"]))) }
        ${createInfoItem("內盤張數", hasDisplayValue(insideLots) ? formatNumber(insideLots) : "尚無資料")}
        ${createInfoItem("外盤張數", hasDisplayValue(outsideLots) ? formatNumber(outsideLots) : "尚無資料")}
        ${createInfoItem("五檔委買合計", hasDisplayValue(buyTotalLots) ? formatNumber(buyTotalLots) : "尚無資料")}
        ${createInfoItem("五檔委賣合計", hasDisplayValue(sellTotalLots) ? formatNumber(sellTotalLots) : "尚無資料")}
      </div>
      ${renderOrderBookTable(orderBook)}
      ${quoteNotice ? `<div class="result-note microstructure-note"><strong>資料說明：</strong>${escapeHtml(quoteNotice)}</div>` : ""}
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
    const [summary, prices, trades, scores, holders, calendar, etfProfile, quote, orderBook] = await Promise.allSettled([
      fetchJson(`/stock/${stockCode}/summary`),
      fetchJson(`/prices/${stockCode}?limit=260`),
      fetchJson(`/institutional-trades/${stockCode}`),
      fetchJson(`/radar-scores/${stockCode}`),
      fetchJson(`/major-holders/${stockCode}?limit=12`),
      fetchJson(`/calendar-events/${stockCode}?limit=30`),
      fetchJson(`/etf-profiles/${stockCode}`),
      fetchJson(`/quote/${stockCode}`),
      fetchJson(`/order-book/${stockCode}`),
    ]);

    const summaryData = summary.status === "fulfilled" ? getFirstArrayItem(summary.value) : {};
    const priceRows = prices.status === "fulfilled" && Array.isArray(prices.value) ? prices.value : [];
    const enrichedPriceRows = enrichPriceRows(priceRows.length > 0 ? priceRows : [summaryData]);
    const tradeRows = trades.status === "fulfilled" && Array.isArray(trades.value) ? trades.value : [];
    const scoreRows = scores.status === "fulfilled" && Array.isArray(scores.value) ? scores.value : [];
    const holderRows = holders.status === "fulfilled" && Array.isArray(holders.value) ? holders.value : [];
    const calendarRows = calendar.status === "fulfilled" && Array.isArray(calendar.value) ? calendar.value : [];
    const etfProfileData = etfProfile.status === "fulfilled" ? getFirstArrayItem(etfProfile.value) : {};
    const quoteData = quote.status === "fulfilled" ? getFirstArrayItem(quote.value) : {};
    const orderBookData = orderBook.status === "fulfilled" ? getFirstArrayItem(orderBook.value) : {};

    const latestPrice = priceRows[0] || summaryData || {};
    const latestTrade = tradeRows[0] || summaryData || {};
    const latestScore = scoreRows[0] || summaryData || {};

    const stockName = pick(summaryData, ["stock_name", "name"], pick(latestScore, ["stock_name", "name"], "股票"));
    const market = pick(summaryData, ["market_type", "market"], pick(latestScore, ["market_type", "market"]));
    const industry = pick(summaryData, ["industry"], "-");
    const securityType = pick(summaryData, ["security_type"], "STOCK");
    const securityTypeLabel = String(securityType).toUpperCase() === "ETF" ? "ETF" : "個股";
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
              <span class="badge">${escapeHtml(securityTypeLabel)}</span>
              <span class="badge">${escapeHtml(industry)}</span>
            </div>
          </div>
          <div class="score-box ${getScoreClass(totalScore)}">
            <span class="score-value">${formatNumber(totalScore)}</span>
            <span class="score-label">籌碼分數</span>
          </div>
        </section>
      `,
      renderEtfProfileDetailSection(etfProfileData, summaryData),
      renderCalendarDetailSection(calendarRows),
      renderDetailSection("最新行情", [
        createInfoItem("日期", formatDate(pick(latestPrice, ["trade_date", "date"]))),
        createInfoItem("收盤價", formatPrice(closePrice), getPriceDirectionClass(change, closePrice)),
        createInfoItem("漲跌", formatPrice(change), getChangeClass(change)),
        createInfoItem("成交量", formatNumber(pick(latestPrice, ["trade_volume", "volume"]))),
      ]),
      renderMicrostructureDetailSection(quoteData, orderBookData),
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
  tabButtons.forEach((btn) => btn.classList.toggle("active", btn.dataset.page === page));
  state.page = page;
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

stockList.addEventListener("click", (event) => {
  const orderButton = event.target.closest("[data-order-action]");
  if (orderButton) {
    handleWatchlistOrder(orderButton);
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
  await loadCurrentUser();
  loadList();
}

initApp();
