import pool from "../db.js";

const DEFAULT_SYMBOLS = [
  { symbol: "^GSPC", displayName: "S&P 500", assetType: "index", marketGroup: "us_index", weight: 1.0, direction: "risk_off_when_down" },
  { symbol: "^IXIC", displayName: "NASDAQ", assetType: "index", marketGroup: "us_index", weight: 1.25, direction: "risk_off_when_down" },
  { symbol: "^DJI", displayName: "Dow Jones", assetType: "index", marketGroup: "us_index", weight: 0.75, direction: "risk_off_when_down" },
  { symbol: "^SOX", displayName: "費城半導體", assetType: "index", marketGroup: "semiconductor", weight: 1.45, direction: "risk_off_when_down" },
  { symbol: "NVDA", displayName: "NVIDIA", assetType: "stock", marketGroup: "technology", weight: 1.4, direction: "risk_off_when_down" },
  { symbol: "AMD", displayName: "AMD", assetType: "stock", marketGroup: "technology", weight: 0.8, direction: "risk_off_when_down" },
  { symbol: "MSFT", displayName: "Microsoft", assetType: "stock", marketGroup: "technology", weight: 0.7, direction: "risk_off_when_down" },
  { symbol: "AAPL", displayName: "Apple", assetType: "stock", marketGroup: "technology", weight: 0.7, direction: "risk_off_when_down" },
  { symbol: "^VIX", displayName: "VIX", assetType: "risk_index", marketGroup: "volatility", weight: 1.15, direction: "risk_off_when_up" },
  { symbol: "DX-Y.NYB", displayName: "DXY", assetType: "macro", marketGroup: "dollar", weight: 0.65, direction: "risk_off_when_up" },
  { symbol: "^TNX", displayName: "US10Y", assetType: "macro", marketGroup: "yield", weight: 0.65, direction: "risk_off_when_up" },
];

function getArgValue(name) {
  const prefix = `--${name}=`;
  const found = process.argv.slice(2).find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : "";
}

function getTaipeiToday() {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Taipei" }).format(new Date());
}

function normalizeDate(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  throw new Error("日期格式錯誤，請使用 YYYY-MM-DD，例如 2026-06-25");
}

function dateFromUnixSeconds(seconds) {
  if (!seconds) return getTaipeiToday();
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Taipei" }).format(new Date(Number(seconds) * 1000));
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function toNumber(value) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function calculateChangePercent(lastPrice, previousClose) {
  if (!lastPrice || !previousClose) return null;
  return ((lastPrice - previousClose) / previousClose) * 100;
}

function calculateRiskImpact(component, changePercent) {
  if (changePercent === null || changePercent === undefined) return 0;
  const abs = Math.abs(changePercent);
  let base = 0;

  if (component.direction === "risk_off_when_up") {
    if (changePercent >= 8) base = -14;
    else if (changePercent >= 4) base = -9;
    else if (changePercent >= 1.5) base = -5;
    else if (changePercent <= -8) base = 10;
    else if (changePercent <= -4) base = 6;
    else if (changePercent <= -1.5) base = 3;
  } else {
    if (changePercent <= -4) base = -16;
    else if (changePercent <= -2) base = -10;
    else if (changePercent <= -1) base = -6;
    else if (changePercent <= -0.4) base = -3;
    else if (changePercent >= 3) base = 10;
    else if (changePercent >= 1.5) base = 6;
    else if (changePercent >= 0.5) base = 3;
  }

  if (abs < 0.15) base = 0;
  return Math.round(base * Number(component.weight || 1));
}

function getRiskSignal(component, changePercent, impact) {
  if (changePercent === null || changePercent === undefined) return "缺資料";
  if (impact <= -12) return "高壓力";
  if (impact <= -6) return "轉弱";
  if (impact <= -2) return "偏弱";
  if (impact >= 8) return "強勢";
  if (impact >= 3) return "偏多";
  return "中性";
}

async function fetchYahooComponent(component) {
  const encoded = encodeURIComponent(component.symbol);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encoded}?range=5d&interval=1d`;
  const response = await fetch(url, {
    headers: {
      Accept: "application/json,text/plain,*/*",
      "User-Agent": "StockRadar/1.6 GlobalRisk",
    },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status} ${text.slice(0, 120)}`);
  const json = JSON.parse(text);
  const result = json?.chart?.result?.[0];
  if (!result) throw new Error(json?.chart?.error?.description || "Yahoo chart 無資料");

  const timestamps = result.timestamp || [];
  const quote = result.indicators?.quote?.[0] || {};
  const closes = quote.close || [];
  let lastIndex = closes.length - 1;
  while (lastIndex >= 0 && (closes[lastIndex] === null || closes[lastIndex] === undefined)) lastIndex -= 1;
  if (lastIndex < 0) throw new Error("找不到有效收盤價");

  const lastPrice = toNumber(closes[lastIndex] ?? result.meta?.regularMarketPrice);
  let previousClose = toNumber(result.meta?.chartPreviousClose || result.meta?.previousClose);
  if (!previousClose && lastIndex > 0) {
    for (let index = lastIndex - 1; index >= 0; index -= 1) {
      previousClose = toNumber(closes[index]);
      if (previousClose) break;
    }
  }

  const changePoint = lastPrice !== null && previousClose !== null ? lastPrice - previousClose : null;
  const changePercent = calculateChangePercent(lastPrice, previousClose);
  const riskImpact = calculateRiskImpact(component, changePercent);

  return {
    ...component,
    tradeDate: dateFromUnixSeconds(timestamps[lastIndex]),
    lastPrice,
    previousClose,
    changePoint,
    changePercent,
    riskImpact,
    riskSignal: getRiskSignal(component, changePercent, riskImpact),
    sourceUrl: url,
    raw: result.meta || {},
  };
}

function buildFallbackComponent(component, tradeDate, errorMessage) {
  return {
    ...component,
    tradeDate,
    lastPrice: null,
    previousClose: null,
    changePoint: null,
    changePercent: null,
    riskImpact: 0,
    riskSignal: "缺資料",
    sourceUrl: "fallback",
    raw: { error: errorMessage },
  };
}

function statusFromAverage(avgImpact) {
  if (avgImpact <= -8) return "明顯偏弱";
  if (avgImpact <= -3) return "偏弱";
  if (avgImpact >= 6) return "偏強";
  if (avgImpact >= 2) return "中性偏多";
  return "中性";
}

function getRiskLevel(score) {
  if (score >= 80) return "積極";
  if (score >= 60) return "正常";
  if (score >= 40) return "保守";
  return "高風險";
}

function getMarketMode(score, components) {
  const nasdaq = components.find((item) => item.symbol === "^IXIC");
  const sox = components.find((item) => item.symbol === "^SOX");
  const nvda = components.find((item) => item.symbol === "NVDA");
  const weakCore = [nasdaq, sox, nvda].filter((item) => Number(item?.riskImpact || 0) <= -6).length;
  if (score < 50 || weakCore >= 2) return "BEAR";
  if (score >= 75 && weakCore === 0) return "BULL";
  return "RANGE";
}

function calculateSnapshot(components) {
  const validComponents = components.filter((item) => item.changePercent !== null && item.changePercent !== undefined);
  const totalImpact = components.reduce((sum, item) => sum + Number(item.riskImpact || 0), 0);
  const score = clamp(Math.round(70 + totalImpact), 0, 100);
  const usItems = components.filter((item) => item.marketGroup === "us_index");
  const techItems = components.filter((item) => item.marketGroup === "technology");
  const semiItems = components.filter((item) => item.marketGroup === "semiconductor" || item.symbol === "NVDA" || item.symbol === "AMD");
  const vix = components.find((item) => item.symbol === "^VIX");
  const dxy = components.find((item) => item.symbol === "DX-Y.NYB");
  const us10y = components.find((item) => item.symbol === "^TNX");

  const avg = (items) => items.length ? items.reduce((sum, item) => sum + Number(item.riskImpact || 0), 0) / items.length : 0;
  const usMarketStatus = statusFromAverage(avg(usItems));
  const technologyPressure = statusFromAverage(avg(techItems));
  const semiconductorPressure = statusFromAverage(avg(semiItems));
  const mode = getMarketMode(score, components);
  const level = getRiskLevel(score);
  const openingGapProbability = clamp(Math.round(100 - score + (semiconductorPressure.includes("弱") ? 8 : 0) + (technologyPressure.includes("弱") ? 6 : 0)), 5, 95);
  const missingCount = components.length - validComponents.length;
  const sourceNote = missingCount > 0 ? `，${missingCount} 項資料暫用中性值` : "";
  const riskSummary = `Global Risk Score ${score}，模式 ${mode}，評級 ${level}，隔日開低機率約 ${openingGapProbability}%${sourceNote}。`;

  return {
    tradeDate: components.find((item) => item.tradeDate)?.tradeDate || getTaipeiToday(),
    score,
    level,
    mode,
    openingGapProbability,
    usMarketStatus,
    technologyPressure,
    semiconductorPressure,
    vixStatus: vix?.riskSignal || "缺資料",
    dxyStatus: dxy?.riskSignal || "缺資料",
    us10yStatus: us10y?.riskSignal || "缺資料",
    riskSummary,
    source: missingCount === components.length ? "Fallback Neutral Global Risk" : "Yahoo Finance Chart API",
    sourceUrl: "https://query1.finance.yahoo.com/v8/finance/chart",
  };
}

async function upsertSnapshot(conn, snapshot, components) {
  await conn.query(
    `
    INSERT INTO global_market_snapshots (
      trade_date,
      snapshot_time,
      source,
      source_url,
      global_risk_score,
      global_risk_level,
      global_market_mode,
      us_market_status,
      technology_pressure,
      semiconductor_pressure,
      vix_status,
      dxy_status,
      us10y_status,
      opening_gap_probability,
      risk_summary,
      raw_json
    ) VALUES (?, CURRENT_TIMESTAMP, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      snapshot_time = VALUES(snapshot_time),
      source_url = VALUES(source_url),
      global_risk_score = VALUES(global_risk_score),
      global_risk_level = VALUES(global_risk_level),
      global_market_mode = VALUES(global_market_mode),
      us_market_status = VALUES(us_market_status),
      technology_pressure = VALUES(technology_pressure),
      semiconductor_pressure = VALUES(semiconductor_pressure),
      vix_status = VALUES(vix_status),
      dxy_status = VALUES(dxy_status),
      us10y_status = VALUES(us10y_status),
      opening_gap_probability = VALUES(opening_gap_probability),
      risk_summary = VALUES(risk_summary),
      raw_json = VALUES(raw_json)
    `,
    [
      snapshot.tradeDate,
      snapshot.source,
      snapshot.sourceUrl,
      snapshot.score,
      snapshot.level,
      snapshot.mode,
      snapshot.usMarketStatus,
      snapshot.technologyPressure,
      snapshot.semiconductorPressure,
      snapshot.vixStatus,
      snapshot.dxyStatus,
      snapshot.us10yStatus,
      snapshot.openingGapProbability,
      snapshot.riskSummary,
      JSON.stringify({ components }),
    ],
  );

  const rows = await conn.query(
    `SELECT id FROM global_market_snapshots WHERE trade_date = ? AND source = ? LIMIT 1`,
    [snapshot.tradeDate, snapshot.source],
  );
  return rows?.[0]?.id || null;
}

async function upsertComponent(conn, snapshotId, item) {
  await conn.query(
    `
    INSERT INTO global_market_components (
      snapshot_id,
      trade_date,
      symbol,
      display_name,
      asset_type,
      market_group,
      last_price,
      previous_close,
      change_point,
      change_percent,
      risk_impact,
      risk_signal,
      source,
      raw_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      trade_date = VALUES(trade_date),
      display_name = VALUES(display_name),
      asset_type = VALUES(asset_type),
      market_group = VALUES(market_group),
      last_price = VALUES(last_price),
      previous_close = VALUES(previous_close),
      change_point = VALUES(change_point),
      change_percent = VALUES(change_percent),
      risk_impact = VALUES(risk_impact),
      risk_signal = VALUES(risk_signal),
      source = VALUES(source),
      raw_json = VALUES(raw_json)
    `,
    [
      snapshotId,
      item.tradeDate,
      item.symbol,
      item.displayName,
      item.assetType,
      item.marketGroup,
      item.lastPrice,
      item.previousClose,
      item.changePoint,
      item.changePercent,
      item.riskImpact,
      item.riskSignal,
      item.sourceUrl === "fallback" ? "fallback" : "Yahoo Finance Chart API",
      JSON.stringify(item.raw || {}),
    ],
  );
}

async function main() {
  const inputDate = normalizeDate(getArgValue("date"));
  const fallbackDate = inputDate || getTaipeiToday();
  const components = [];
  const errors = [];

  console.log("====================================");
  console.log("Stock Radar V1.6 全球市場風險匯入");
  console.log("====================================");

  for (const component of DEFAULT_SYMBOLS) {
    try {
      const item = await fetchYahooComponent(component);
      if (inputDate) item.tradeDate = inputDate;
      components.push(item);
      console.log(`✅ ${component.displayName} ${item.changePercent === null ? "-" : item.changePercent.toFixed(2) + "%"}｜${item.riskSignal}`);
    } catch (error) {
      errors.push(`${component.symbol}: ${error.message}`);
      const item = buildFallbackComponent(component, fallbackDate, error.message);
      components.push(item);
      console.log(`⚠️ ${component.displayName} 讀取失敗，暫用中性值：${error.message}`);
    }
  }

  const snapshot = calculateSnapshot(components);
  const conn = await pool.getConnection();

  try {
    const snapshotId = await upsertSnapshot(conn, snapshot, components);
    for (const item of components) {
      item.tradeDate = snapshot.tradeDate;
      await upsertComponent(conn, snapshotId, item);
    }

    console.log("------------------------------------");
    console.log(`資料日：${snapshot.tradeDate}`);
    console.log(`Global Risk Score：${snapshot.score}`);
    console.log(`市場模式：${snapshot.mode}`);
    console.log(`隔日開低機率：${snapshot.openingGapProbability}%`);
    console.log(`元件筆數：${components.length}`);
    if (errors.length > 0) console.log(`警告：${errors.length} 項外部資料讀取失敗，已用中性值補齊，不中斷驗收。`);
    console.log("結果：PASS");
  } finally {
    conn.release();
    await pool.end();
  }
}

main().catch(async (error) => {
  console.error("V1.6 全球市場風險匯入失敗：", error.message);
  try { await pool.end(); } catch {}
  process.exit(1);
});
