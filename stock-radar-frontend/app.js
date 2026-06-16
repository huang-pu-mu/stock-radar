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

const state = {
  page: "radar",
  market: "",
  limit: 20,
  latestRows: [],
};

const pageTitle = document.getElementById("pageTitle");
const pageDesc = document.getElementById("pageDesc");
const stockList = document.getElementById("stockList");
const statusBox = document.getElementById("statusBox");
const refreshBtn = document.getElementById("refreshBtn");
const tabButtons = document.querySelectorAll(".tab-btn");
const marketButtons = document.querySelectorAll(".market-btn");
const detailModal = document.getElementById("detailModal");
const detailTitle = document.getElementById("detailTitle");
const detailContent = document.getElementById("detailContent");
const closeDetailBtn = document.getElementById("closeDetailBtn");
const installBtn = document.getElementById("installBtn");

let deferredInstallPrompt = null;

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

function getScoreClass(score) {
  const numberValue = toNumber(score);
  if (numberValue === null) return "score-low";
  if (numberValue >= 80) return "score-high";
  if (numberValue >= 60) return "score-mid";
  return "score-low";
}

function getStatusTone(value) {
  const text = String(value ?? "");
  if (!text || text === "-") return "";
  if (text.includes("強") || text.includes("買") || text.includes("增加") || text.includes("放大") || text.includes("偏多")) return "good";
  if (text.includes("弱") || text.includes("賣") || text.includes("減少") || text.includes("低迷") || text.includes("偏空")) return "bad";
  return "warn";
}

function showStatus(message, type = "") {
  statusBox.innerHTML = message;
  statusBox.className = `status-box ${type}`.trim();
  statusBox.classList.remove("hidden");
}

function hideStatus() {
  statusBox.classList.add("hidden");
}

function setLoading(isLoading) {
  refreshBtn.disabled = isLoading;
  refreshBtn.textContent = isLoading ? "讀取中..." : "重新整理";
}

async function fetchJson(path) {
  if (!API_BASE_URL || API_BASE_URL.includes("你的-api網址")) {
    throw new Error("尚未設定正式 API 網址。請打開 config.js，把 PRODUCTION_API_BASE_URL 改成你的 Node.js API 網址。");
  }

  const response = await fetch(`${API_BASE_URL}${path}`);
  let result = null;

  try {
    result = await response.json();
  } catch (error) {
    throw new Error("API 回傳不是 JSON，請確認後端是否正常啟動。特殊錯誤：" + error.message);
  }

  if (!response.ok || result.success === false) {
    throw new Error(result.message || result.error || "API 查詢失敗");
  }

  if (Array.isArray(result)) return result;
  if (Array.isArray(result.data)) return result.data;
  if (result.data) return result.data;
  return result;
}

function buildListPath() {
  const endpoint = state.page === "foreign" ? "/foreign/top" : "/radar/top";
  const params = new URLSearchParams();
  params.set("limit", String(state.limit));
  if (state.market) params.set("market", state.market);
  return `${endpoint}?${params.toString()}`;
}

function updatePageText() {
  const marketText = state.market || "全市場";

  if (state.page === "foreign") {
    pageTitle.textContent = "外資排行";
    pageDesc.textContent = `${marketText}外資買超排序，觀察法人資金流向`;
    return;
  }

  pageTitle.textContent = "今日雷達";
  pageDesc.textContent = `${marketText}籌碼分數排序，優先觀察高分標的`;
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

function renderStockCard(row, index) {
  const code = pick(row, ["stock_code", "code"]);
  const name = pick(row, ["stock_name", "name"]);
  const market = pick(row, ["market_type", "market"]);
  const score = pick(row, ["total_score", "chip_score", "score"], "-");
  const closePrice = pick(row, ["close_price", "closing_price", "close"], "-");
  const change = pick(row, ["price_change", "change", "change_price"], "-");
  const tradeDate = pick(row, ["trade_date", "score_date", "date"], "-");
  const scoreClass = getScoreClass(score);
  const changeClass = getChangeClass(change);

  const radarItems = [
    createInfoItem("收盤價", formatPrice(closePrice)),
    createInfoItem("漲跌", formatPrice(change), changeClass),
    createStatusItem("外資狀態", pick(row, ["foreign_status", "foreign_investor_status"])),
    createStatusItem("投信狀態", pick(row, ["investment_trust_status", "trust_status"])),
    createStatusItem("成交量狀態", pick(row, ["volume_status"])),
    createStatusItem("股價位置", pick(row, ["price_position_status", "price_position"])),
  ].join("");

  const foreignValue = pick(row, ["foreign_buy_sell", "foreign_net_buy", "foreign_net_buy_sell"], "-");
  const trustValue = pick(row, ["investment_trust_buy_sell", "trust_net_buy", "investment_trust_net_buy_sell"], "-");
  const dealerValue = pick(row, ["dealer_buy_sell", "dealer_net_buy", "dealer_net_buy_sell"], "-");

  const foreignItems = [
    createInfoItem("外資買超", formatNumber(foreignValue), getChangeClass(foreignValue)),
    createInfoItem("投信買賣超", formatNumber(trustValue), getChangeClass(trustValue)),
    createInfoItem("自營商買賣超", formatNumber(dealerValue), getChangeClass(dealerValue)),
    createInfoItem("收盤價", formatPrice(closePrice)),
    createInfoItem("漲跌", formatPrice(change), changeClass),
    createInfoItem("市場別", escapeHtml(market)),
  ].join("");

  return `
    <article class="stock-card">
      <div class="stock-top">
        <div class="stock-main">
          <span class="rank-badge">#${index + 1}</span>
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

      <div class="info-grid">
        ${state.page === "foreign" ? foreignItems : radarItems}
      </div>

      <div class="card-actions">
        <span class="card-note">資料日：${formatDate(tradeDate)}</span>
        <button class="detail-btn" data-code="${escapeHtml(code)}">查看明細</button>
      </div>
    </article>
  `;
}

async function loadList() {
  updatePageText();
  hideStatus();
  setLoading(true);
  renderLoadingCards();

  try {
    const rows = await fetchJson(buildListPath());
    state.latestRows = Array.isArray(rows) ? rows : [];

    if (state.latestRows.length === 0) {
      stockList.innerHTML = "";
      showStatus("目前沒有資料，請確認後端 API 是否已有匯入資料。", "error");
      return;
    }

    stockList.innerHTML = state.latestRows.map(renderStockCard).join("");
    showStatus(`已載入 ${state.latestRows.length} 檔股票。`, "success");
    window.setTimeout(hideStatus, 1200);
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

function renderDetailSection(title, rows) {
  return `
    <section class="detail-section">
      <h3>${escapeHtml(title)}</h3>
      <div class="info-grid">${rows.join("")}</div>
    </section>
  `;
}

function getFirstArrayItem(value) {
  if (Array.isArray(value)) return value[0] || {};
  if (value && Array.isArray(value.data)) return value.data[0] || {};
  return value || {};
}

async function openDetail(stockCode) {
  detailModal.classList.remove("hidden");
  detailModal.setAttribute("aria-hidden", "false");
  detailTitle.textContent = `${stockCode} 載入中`;
  detailContent.innerHTML = `<div class="status-box">股票明細讀取中...</div>`;

  try {
    const [summary, prices, trades, scores] = await Promise.allSettled([
      fetchJson(`/stock/${stockCode}/summary`),
      fetchJson(`/prices/${stockCode}`),
      fetchJson(`/institutional-trades/${stockCode}`),
      fetchJson(`/radar-scores/${stockCode}`),
    ]);

    const summaryData = summary.status === "fulfilled" ? getFirstArrayItem(summary.value) : {};
    const priceRows = prices.status === "fulfilled" && Array.isArray(prices.value) ? prices.value : [];
    const tradeRows = trades.status === "fulfilled" && Array.isArray(trades.value) ? trades.value : [];
    const scoreRows = scores.status === "fulfilled" && Array.isArray(scores.value) ? scores.value : [];

    const latestPrice = priceRows[0] || summaryData || {};
    const latestTrade = tradeRows[0] || summaryData || {};
    const latestScore = scoreRows[0] || summaryData || {};

    const stockName = pick(summaryData, ["stock_name", "name"], pick(latestScore, ["stock_name", "name"], "股票"));
    const market = pick(summaryData, ["market_type", "market"], pick(latestScore, ["market_type", "market"]));
    const industry = pick(summaryData, ["industry"], "-");
    const totalScore = pick(latestScore, ["total_score", "chip_score", "score"], pick(summaryData, ["total_score", "chip_score", "score"], "-"));
    const closePrice = pick(latestPrice, ["close_price", "closing_price", "close"], pick(summaryData, ["close_price", "closing_price", "close"], "-"));
    const change = pick(latestPrice, ["price_change", "change", "change_price"], pick(summaryData, ["price_change", "change", "change_price"], "-"));

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
        createInfoItem("收盤價", formatPrice(closePrice)),
        createInfoItem("漲跌", formatPrice(change), getChangeClass(change)),
        createInfoItem("成交量", formatNumber(pick(latestPrice, ["trade_volume", "volume"]))),
      ]),
      renderDetailSection("三大法人", [
        createInfoItem("外資", formatNumber(pick(latestTrade, ["foreign_buy_sell", "foreign_net_buy", "foreign_net_buy_sell"])), getChangeClass(pick(latestTrade, ["foreign_buy_sell", "foreign_net_buy", "foreign_net_buy_sell"]))),
        createInfoItem("投信", formatNumber(pick(latestTrade, ["investment_trust_buy_sell", "trust_net_buy", "investment_trust_net_buy_sell"])), getChangeClass(pick(latestTrade, ["investment_trust_buy_sell", "trust_net_buy", "investment_trust_net_buy_sell"]))),
        createInfoItem("自營商", formatNumber(pick(latestTrade, ["dealer_buy_sell", "dealer_net_buy", "dealer_net_buy_sell"])), getChangeClass(pick(latestTrade, ["dealer_buy_sell", "dealer_net_buy", "dealer_net_buy_sell"]))),
        createInfoItem("日期", formatDate(pick(latestTrade, ["trade_date", "date"]))),
      ]),
      renderDetailSection("籌碼狀態", [
        createStatusItem("外資狀態", pick(latestScore, ["foreign_status", "foreign_investor_status"])),
        createStatusItem("投信狀態", pick(latestScore, ["investment_trust_status", "trust_status"])),
        createStatusItem("成交量狀態", pick(latestScore, ["volume_status"])),
        createStatusItem("股價位置", pick(latestScore, ["price_position_status", "price_position"])),
      ]),
      renderDetailSection("分數拆解", [
        createInfoItem("外資分數", formatNumber(pick(latestScore, ["foreign_score"]))),
        createInfoItem("投信分數", formatNumber(pick(latestScore, ["investment_trust_score", "trust_score"]))),
        createInfoItem("自營商分數", formatNumber(pick(latestScore, ["dealer_score"]))),
        createInfoItem("成交量分數", formatNumber(pick(latestScore, ["volume_score"]))),
        createInfoItem("股價位置分數", formatNumber(pick(latestScore, ["price_position_score"]))),
        createInfoItem("大戶分數", formatNumber(pick(latestScore, ["big_holder_score"]))),
      ]),
    ].join("");
  } catch (error) {
    detailContent.innerHTML = `<div class="status-box error">明細讀取失敗：${escapeHtml(error.message)}</div>`;
  }
}

function closeDetail() {
  detailModal.classList.add("hidden");
  detailModal.setAttribute("aria-hidden", "true");
}

tabButtons.forEach((button) => {
  button.addEventListener("click", () => {
    tabButtons.forEach((btn) => btn.classList.remove("active"));
    button.classList.add("active");
    state.page = button.dataset.page;
    loadList();
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
  const button = event.target.closest(".detail-btn");
  if (!button) return;
  openDetail(button.dataset.code);
});

refreshBtn.addEventListener("click", loadList);
closeDetailBtn.addEventListener("click", closeDetail);

detailModal.addEventListener("click", (event) => {
  if (event.target.dataset.close === "true") closeDetail();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeDetail();
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

loadList();
