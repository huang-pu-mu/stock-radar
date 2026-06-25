import fs from "fs";

const DEFAULT_SOURCE_URL = "https://openapi.taifex.com.tw/v1/DailyMarketReportFut";
const LEGACY_SOURCE_URL = "https://openapi.taifex.com.tw/v1/DailyMarket";
const SOURCE_URL = process.env.TAIFEX_DAILY_MARKET_URL || DEFAULT_SOURCE_URL;
const SOURCE_URLS = [...new Set([SOURCE_URL, DEFAULT_SOURCE_URL, LEGACY_SOURCE_URL].filter(Boolean))];
const DEFAULT_CONTRACTS = ["TX", "TXF", "MTX"];

let pool = null;
let activeSourceUrl = SOURCE_URL;

function getArgValue(name) {
  const prefix = `--${name}=`;
  const found = process.argv.slice(2).find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : "";
}

function normalizeKey(value) {
  return String(value || "")
    .replace(/[\s　()（）%％/\\_-]/g, "")
    .toLowerCase();
}

function buildNormalizedRow(row) {
  const map = new Map();
  for (const [key, value] of Object.entries(row || {})) {
    map.set(key, value);
    map.set(normalizeKey(key), value);
  }
  return map;
}

function pickField(row, names, fallback = "") {
  const map = buildNormalizedRow(row);
  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(row, name) && row[name] !== undefined && row[name] !== null && row[name] !== "") {
      return row[name];
    }
    const normalized = normalizeKey(name);
    if (map.has(normalized) && map.get(normalized) !== undefined && map.get(normalized) !== null && map.get(normalized) !== "") {
      return map.get(normalized);
    }
  }
  return fallback;
}

function parseNumber(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).replace(/,/g, "").replace(/%/g, "").trim();
  if (!text || text === "-" || text === "--") return null;
  const numberValue = Number(text);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function parseInteger(value) {
  const numberValue = parseNumber(value);
  if (numberValue === null) return null;
  return Math.round(numberValue);
}

function normalizeDate(value) {
  const text = String(value || "").trim();
  if (!text) return "";

  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  if (/^\d{4}\/\d{2}\/\d{2}$/.test(text)) return text.replaceAll("/", "-");
  if (/^\d{8}$/.test(text)) return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;

  const rocMatch = text.match(/^(\d{2,3})\/(\d{1,2})\/(\d{1,2})$/);
  if (rocMatch) {
    const year = Number(rocMatch[1]) + 1911;
    const month = String(rocMatch[2]).padStart(2, "0");
    const day = String(rocMatch[3]).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  return text;
}

function getTaipeiToday() {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Taipei" }).format(new Date());
}

function getConfiguredContracts() {
  const fromEnv = String(process.env.TAIFEX_MARKET_RISK_CONTRACTS || "").trim();
  if (!fromEnv) return DEFAULT_CONTRACTS;
  return fromEnv.split(",").map((item) => item.trim().toUpperCase()).filter(Boolean);
}

function detectSessionType(row) {
  const sessionText = String(pickField(row, ["交易時段", "Trading Session", "TradingSession", "Session"], "")).trim();
  const afterHoursVolume = parseInteger(pickField(row, ["盤後交易時段成交量", "Volume-AfterHours", "VolumeAfterHours", "AfterHoursVolume"], null));

  if (/盤後|夜|after/i.test(sessionText)) return "after_hours";
  if (/一般|日盤|regular/i.test(sessionText)) return "regular";
  if (afterHoursVolume && afterHoursVolume > 0) return "after_hours";
  return "unknown";
}

function normalizeProductCode(row) {
  return String(pickField(row, ["契約代號", "商品代號", "契約", "Product Code", "ProductCode", "Contract", "Contract Code"], ""))
    .trim()
    .toUpperCase();
}

function normalizeProductName(row) {
  return String(pickField(row, ["商品名稱", "契約名稱", "Product Name", "ProductName", "Name"], "")).trim();
}

function getContractMonth(row) {
  return String(pickField(row, ["到期月份(週別)", "到期月份週別", "契約月份", "Contract Month", "ContractMonth", "Delivery Month"], "")).trim();
}

function isTargetContract(row, targetContracts) {
  const productCode = normalizeProductCode(row);
  const productName = normalizeProductName(row);

  if (targetContracts.includes(productCode)) return true;
  if (productName.includes("臺股期貨") || productName.includes("台股期貨")) return true;
  if (productCode === "TX" || productCode === "TXF") return true;
  return false;
}

function mapMarketRow(row) {
  const sessionType = detectSessionType(row);
  const productCode = normalizeProductCode(row) || "TX";
  const productName = normalizeProductName(row) || (productCode === "TX" ? "臺股期貨" : "");
  const tradeDate = normalizeDate(pickField(row, ["日期", "交易日期", "Date", "Trade Date", "TradeDate"], "")) || getTaipeiToday();
  const changePercent = parseNumber(pickField(row, ["漲跌%", "漲跌百分比", "Change Percent", "ChangePercent"], null));
  const openPrice = parseNumber(pickField(row, ["開盤價", "Open", "Open Price", "OpenPrice"], null));
  const highPrice = parseNumber(pickField(row, ["最高價", "High", "High Price", "HighPrice"], null));
  const lowPrice = parseNumber(pickField(row, ["最低價", "Low", "Low Price", "LowPrice"], null));
  const lastPrice = parseNumber(pickField(row, ["最後成交價", "最後成交價位", "Last", "Last Price", "LastPrice", "Close"], null));
  const changePoint = parseNumber(pickField(row, ["漲跌價", "漲跌點數", "Change", "Change Point", "ChangePoint"], null));
  const totalVolume = parseInteger(pickField(row, ["合計成交量", "Volume-Total", "VolumeTotal", "Total Volume", "TotalVolume"], null));
  const regularVolume = parseInteger(pickField(row, ["一般交易時段成交量", "Volume-Regular", "VolumeRegular", "Regular Volume", "RegularVolume"], null));
  const afterHoursVolume = parseInteger(pickField(row, ["盤後交易時段成交量", "Volume-AfterHours", "VolumeAfterHours", "After Hours Volume", "AfterHoursVolume"], null));

  return {
    tradeDate,
    productCode,
    productName,
    contractMonth: getContractMonth(row),
    sessionType,
    openPrice,
    highPrice,
    lowPrice,
    lastPrice,
    changePoint,
    changePercent,
    totalVolume,
    regularVolume,
    afterHoursVolume,
    raw: row,
  };
}

function clampScore(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function getRiskLevel(score) {
  if (score >= 80) return "積極";
  if (score >= 60) return "正常";
  if (score >= 40) return "保守";
  return "高風險";
}

function getMarketMode(score, changePercent) {
  if (score >= 70 && changePercent !== null && changePercent >= 0.3) return "BULL";
  if (score < 50 || (changePercent !== null && changePercent <= -1)) return "BEAR";
  return "RANGE";
}

function getNightSignal(score, changePercent, lowFromOpenPercent) {
  if (changePercent !== null && changePercent <= -1.5) return "夜盤急跌";
  if (changePercent !== null && changePercent <= -0.6) return "夜盤轉弱";
  if (lowFromOpenPercent !== null && lowFromOpenPercent <= -1.2 && changePercent !== null && changePercent >= -0.2) return "急跌後收斂";
  if (changePercent !== null && changePercent >= 0.8) return "夜盤轉強";
  if (changePercent !== null && changePercent >= 0.2) return "夜盤偏多";
  return "夜盤中性";
}

function calculateRisk(mappedRow) {
  const changePercent = mappedRow.changePercent;
  const openPrice = mappedRow.openPrice;
  const lowPrice = mappedRow.lowPrice;
  const lastPrice = mappedRow.lastPrice;
  let score = 70;
  let lowFromOpenPercent = null;
  let lastFromOpenPercent = null;

  if (changePercent !== null) {
    score += changePercent * 12;
  }

  if (openPrice && lowPrice) {
    lowFromOpenPercent = ((lowPrice - openPrice) / openPrice) * 100;
    if (lowFromOpenPercent <= -2.5) score -= 14;
    else if (lowFromOpenPercent <= -1.5) score -= 8;
    else if (lowFromOpenPercent <= -0.8) score -= 4;
  }

  if (openPrice && lastPrice) {
    lastFromOpenPercent = ((lastPrice - openPrice) / openPrice) * 100;
    if (lastFromOpenPercent >= 0.4 && changePercent !== null && changePercent < 0) score += 4;
  }

  const finalScore = clampScore(score);
  const level = getRiskLevel(finalScore);
  const mode = getMarketMode(finalScore, changePercent);
  const signal = getNightSignal(finalScore, changePercent, lowFromOpenPercent);
  const changeText = changePercent === null ? "漲跌幅缺資料" : `漲跌 ${changePercent.toFixed(2)}%`;
  const summary = `${mappedRow.productName || mappedRow.productCode} ${mappedRow.contractMonth || "近月"} ${mappedRow.sessionType === "after_hours" ? "夜盤" : "日盤"}${changeText}，Market Risk Score ${finalScore}，模式 ${mode}，評級 ${level}。`;

  return {
    score: finalScore,
    level,
    mode,
    signal,
    summary,
  };
}

function sortMarketRows(rows) {
  return [...rows].sort((a, b) => {
    const sessionWeight = { after_hours: 3, regular: 2, unknown: 1 };
    const aSession = sessionWeight[a.sessionType] || 0;
    const bSession = sessionWeight[b.sessionType] || 0;
    if (aSession !== bSession) return bSession - aSession;

    const aVolume = a.afterHoursVolume || a.totalVolume || 0;
    const bVolume = b.afterHoursVolume || b.totalVolume || 0;
    if (aVolume !== bVolume) return bVolume - aVolume;

    return String(a.contractMonth || "999999").localeCompare(String(b.contractMonth || "999999"));
  });
}

async function readRowsFromMock(mockPath) {
  const text = fs.readFileSync(mockPath, "utf8");
  const data = JSON.parse(text);
  return Array.isArray(data) ? data : data.data || [];
}

async function fetchRowsFromUrl(url) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json,text/plain,*/*",
      "User-Agent": "StockRadar/1.5 MarketRisk",
    },
  });
  const text = await response.text();
  const preview = text.slice(0, 180).replace(/\s+/g, " ").trim();

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${preview}`);
  }

  if (!text.trim().startsWith("[") && !text.trim().startsWith("{")) {
    throw new Error(`回傳內容不是 JSON，可能是 HTML 或防護頁：${preview}`);
  }

  const data = JSON.parse(text);
  activeSourceUrl = url;
  return Array.isArray(data) ? data : data.data || [];
}

async function fetchRows() {
  const errors = [];

  for (const url of SOURCE_URLS) {
    try {
      return await fetchRowsFromUrl(url);
    } catch (error) {
      errors.push(`${url} => ${error.message}`);
    }
  }

  throw new Error(`TAIFEX OpenAPI 讀取失敗，已嘗試 ${SOURCE_URLS.length} 個網址：${errors.join(" | ")}`);
}

async function getReferenceIndexPoint(conn, tradeDate) {
  const rows = await conn.query(
    `
    SELECT daily_index_point
    FROM market_daily_summaries
    WHERE trade_date = ?
      AND market_type = '上市'
    ORDER BY updated_at DESC, id DESC
    LIMIT 1
    `,
    [tradeDate],
  ).catch(() => []);

  const value = rows?.[0]?.daily_index_point;
  return value === undefined || value === null ? null : Number(value);
}

async function upsertSnapshot(conn, mappedRow, risk) {
  const referenceIndexPoint = await getReferenceIndexPoint(conn, mappedRow.tradeDate);
  const result = await conn.query(
    `
    INSERT INTO market_risk_snapshots (
      trade_date,
      snapshot_time,
      product_code,
      product_name,
      contract_month,
      session_type,
      open_price,
      high_price,
      low_price,
      last_price,
      change_point,
      change_percent,
      total_volume,
      regular_volume,
      after_hours_volume,
      reference_index_point,
      market_risk_score,
      market_risk_level,
      market_mode,
      night_signal,
      risk_summary,
      source,
      source_url,
      raw_json
    ) VALUES (?, CURRENT_TIMESTAMP, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'TAIFEX OpenAPI DailyMarket', ?, ?)
    ON DUPLICATE KEY UPDATE
      snapshot_time = VALUES(snapshot_time),
      product_name = VALUES(product_name),
      open_price = VALUES(open_price),
      high_price = VALUES(high_price),
      low_price = VALUES(low_price),
      last_price = VALUES(last_price),
      change_point = VALUES(change_point),
      change_percent = VALUES(change_percent),
      total_volume = VALUES(total_volume),
      regular_volume = VALUES(regular_volume),
      after_hours_volume = VALUES(after_hours_volume),
      reference_index_point = VALUES(reference_index_point),
      market_risk_score = VALUES(market_risk_score),
      market_risk_level = VALUES(market_risk_level),
      market_mode = VALUES(market_mode),
      night_signal = VALUES(night_signal),
      risk_summary = VALUES(risk_summary),
      source_url = VALUES(source_url),
      raw_json = VALUES(raw_json)
    `,
    [
      mappedRow.tradeDate,
      mappedRow.productCode,
      mappedRow.productName,
      mappedRow.contractMonth,
      mappedRow.sessionType,
      mappedRow.openPrice,
      mappedRow.highPrice,
      mappedRow.lowPrice,
      mappedRow.lastPrice,
      mappedRow.changePoint,
      mappedRow.changePercent,
      mappedRow.totalVolume,
      mappedRow.regularVolume,
      mappedRow.afterHoursVolume,
      referenceIndexPoint,
      risk.score,
      risk.level,
      risk.mode,
      risk.signal,
      risk.summary,
      activeSourceUrl,
      JSON.stringify(mappedRow.raw),
    ],
  );

  return result;
}

async function main() {
  const mockPath = getArgValue("mock");
  const dateArg = normalizeDate(getArgValue("date"));
  const targetContracts = getConfiguredContracts();

  console.log("====================================");
  console.log("Stock Radar V1.5 台指期市場風險匯入");
  console.log("====================================");
  console.log(`來源：${mockPath || SOURCE_URLS.join(" | ")}`);
  console.log(`商品：${targetContracts.join(", ")}`);

  const rows = mockPath ? await readRowsFromMock(mockPath) : await fetchRows();
  const mappedRows = rows
    .filter((row) => isTargetContract(row, targetContracts))
    .map(mapMarketRow)
    .filter((row) => !dateArg || row.tradeDate === dateArg);

  if (mappedRows.length === 0) {
    throw new Error(`找不到指定商品的期貨行情資料${dateArg ? `，日期：${dateArg}` : ""}`);
  }

  const sortedRows = sortMarketRows(mappedRows);
  const dbModule = await import("../db.js");
  pool = dbModule.default;
  const conn = await pool.getConnection();

  try {
    let importedCount = 0;
    let primarySnapshot = null;

    for (const row of sortedRows.slice(0, 8)) {
      const risk = calculateRisk(row);
      await upsertSnapshot(conn, row, risk);
      importedCount += 1;
      if (!primarySnapshot) primarySnapshot = { ...row, risk };
      console.log(`匯入：${row.tradeDate} ${row.productCode} ${row.contractMonth || "-"} ${row.sessionType}｜${risk.summary}`);
    }

    console.log("------------------------------------");
    console.log(`匯入筆數：${importedCount}`);
    console.log(`主要快照：${primarySnapshot.tradeDate} ${primarySnapshot.productCode} ${primarySnapshot.contractMonth || "-"}`);
    console.log(`實際來源：${activeSourceUrl}`);
    console.log(`Market Risk Score：${primarySnapshot.risk.score}`);
    console.log(`市場模式：${primarySnapshot.risk.mode}`);
    console.log("結果：PASS");
  } finally {
    conn.release();
    await pool.end();
  }
}

main().catch(async (error) => {
  console.error("V1.5 台指期市場風險匯入失敗：", error.message);
  if (pool) {
    try { await pool.end(); } catch {}
  }
  process.exit(1);
});
