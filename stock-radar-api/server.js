import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import crypto from "crypto";
import { OAuth2Client } from "google-auth-library";
import pool from "./db.js";
import { query, testConnection } from "./db.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const SESSION_EXPIRE_SECONDS = 60 * 60 * 24 * 7;

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

function getSessionSecret() {
  return process.env.JWT_SECRET || process.env.SESSION_SECRET || "";
}

function base64UrlEncode(value) {
  return Buffer.from(JSON.stringify(value))
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function base64UrlEncodeBuffer(buffer) {
  return buffer
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function base64UrlDecode(value) {
  const normalized = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
  return Buffer.from(padded, "base64").toString("utf8");
}

function createSessionToken(user) {
  const secret = getSessionSecret();

  if (!secret) {
    throw new Error("尚未設定 JWT_SECRET，請先在 Vercel 環境變數設定一組登入密鑰。");
  }

  const now = Math.floor(Date.now() / 1000);
  const header = {
    alg: "HS256",
    typ: "JWT",
  };
  const payload = {
    user_id: user.id,
    email: user.email,
    display_name: user.display_name,
    iat: now,
    exp: now + SESSION_EXPIRE_SECONDS,
  };
  const encodedHeader = base64UrlEncode(header);
  const encodedPayload = base64UrlEncode(payload);
  const data = `${encodedHeader}.${encodedPayload}`;
  const signature = crypto.createHmac("sha256", secret).update(data).digest();

  return `${data}.${base64UrlEncodeBuffer(signature)}`;
}

function verifySessionToken(token) {
  const secret = getSessionSecret();

  if (!secret) {
    throw new Error("尚未設定 JWT_SECRET。");
  }

  const parts = String(token || "").split(".");
  if (parts.length !== 3) {
    throw new Error("登入狀態格式不正確。");
  }

  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  const data = `${encodedHeader}.${encodedPayload}`;
  const expectedSignature = crypto.createHmac("sha256", secret).update(data).digest();
  const receivedSignature = Buffer.from(
    encodedSignature.replace(/-/g, "+").replace(/_/g, "/").padEnd(encodedSignature.length + ((4 - (encodedSignature.length % 4)) % 4), "="),
    "base64",
  );

  if (
    receivedSignature.length !== expectedSignature.length ||
    !crypto.timingSafeEqual(receivedSignature, expectedSignature)
  ) {
    throw new Error("登入狀態驗證失敗。");
  }

  const payload = JSON.parse(base64UrlDecode(encodedPayload));
  const now = Math.floor(Date.now() / 1000);

  if (!payload.exp || payload.exp < now) {
    throw new Error("登入狀態已過期，請重新登入。");
  }

  return payload;
}

function getBearerToken(req) {
  const authorization = req.headers.authorization || "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : "";
}

async function requireAuth(req, res, next) {
  try {
    const token = getBearerToken(req);

    if (!token) {
      return res.status(401).json({
        success: false,
        message: "請先登入 Google 帳號。",
      });
    }

    const payload = verifySessionToken(token);
    const users = await query(
      `
      SELECT
        id,
        google_id,
        email,
        display_name,
        picture_url,
        role,
        is_active,
        DATE_FORMAT(last_login_at, '%Y-%m-%d %H:%i:%s') AS last_login_at
      FROM users
      WHERE id = ?
      LIMIT 1
      `,
      [payload.user_id],
    );

    if (users.length === 0 || Number(users[0].is_active) !== 1) {
      return res.status(403).json({
        success: false,
        message: "這個帳號目前沒有使用權限。",
      });
    }

    req.user = users[0];
    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: error.message || "登入狀態驗證失敗，請重新登入。",
    });
  }
}

app.use(cors());
app.use(express.json());

function toBigIntValue(value) {
  if (value === null || value === undefined || value === "") {
    return 0n;
  }

  const text = String(value).replaceAll(",", "").trim();
  const integerText = text.includes(".") ? text.split(".")[0] : text;

  if (!integerText || integerText === "-" || integerText === "+") {
    return 0n;
  }

  return BigInt(integerText);
}

function sharesToLotsString(shares) {
  return (shares / 1000n).toString();
}

function convertBigIntToString(value) {
  if (typeof value === "bigint") {
    return value.toString();
  }

  if (Array.isArray(value)) {
    return value.map(convertBigIntToString);
  }

  if (value && typeof value === "object") {
    const result = {};

    for (const [key, item] of Object.entries(value)) {
      result[key] = convertBigIntToString(item);
    }

    return result;
  }

  return value;
}

function parseLimit(value, defaultLimit = 20, maxLimit = 100) {
  const limit = Number(value) || defaultLimit;

  return Math.min(Math.max(limit, 1), maxLimit);
}

function parseMarket(value) {
  const market = String(value || "").trim();

  if (!market || market === "全部" || market.toLowerCase() === "all") {
    return null;
  }

  if (!["上市", "上櫃"].includes(market)) {
    return null;
  }

  return market;
}

function isValidDateText(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
}


const MARKET_INDEX_CONFIGS = [
  {
    key: "twse",
    market_type: "上市",
    index_code: "TAIEX",
    index_name: "加權指數",
    symbols: ["^TWII"],
  },
  {
    key: "tpex",
    market_type: "上櫃",
    index_code: "TPEX",
    index_name: "上櫃指數",
    symbols: ["^TWOII", "TWOII.TWO", "TPEX.TWO"],
  },
];

function toFiniteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const numberValue = Number(String(value).replaceAll(",", ""));
  return Number.isFinite(numberValue) ? numberValue : null;
}

function getTaiwanDateTimeText(date = new Date()) {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date).replace(" ", " ");
}

function getTaiwanTimeTextFromUnix(unixSeconds) {
  if (!unixSeconds) return "";

  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(Number(unixSeconds) * 1000));
}

async function fetchExternalJson(url, label) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 9000);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 stock-radar-api",
        Accept: "application/json,text/plain,*/*",
        "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.8",
        Referer: "https://mis.twse.com.tw/stock/fibest.jsp",
      },
    });

    if (!response.ok) {
      throw new Error(`${label} HTTP ${response.status}`);
    }

    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchExternalText(url, label, headers = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 stock-radar-api",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.8",
        ...headers,
      },
    });

    if (!response.ok) {
      throw new Error(`${label} HTTP ${response.status}`);
    }

    return response.text();
  } finally {
    clearTimeout(timeout);
  }
}

function getLastFiniteValue(values = []) {
  for (let index = values.length - 1; index >= 0; index -= 1) {
    const value = toFiniteNumber(values[index]);
    if (value !== null) return value;
  }

  return null;
}

function buildYahooIndexPoint(timestamp, quote, index) {
  const close = toFiniteNumber(quote?.close?.[index]);

  if (close === null) return null;

  return {
    time: getTaiwanTimeTextFromUnix(timestamp),
    timestamp,
    open: toFiniteNumber(quote?.open?.[index]),
    high: toFiniteNumber(quote?.high?.[index]),
    low: toFiniteNumber(quote?.low?.[index]),
    close,
    volume: toFiniteNumber(quote?.volume?.[index]),
  };
}

function parseTwseRocDate(value) {
  const text = String(value || "").replaceAll("/", "").trim();

  if (!/^\d{7}$/.test(text)) {
    return "";
  }

  const year = Number(text.slice(0, 3)) + 1911;
  const month = text.slice(3, 5);
  const day = text.slice(5, 7);

  return `${year}-${month}-${day}`;
}

function getLatestValidTwseMarketRow(rows = []) {
  if (!Array.isArray(rows)) return null;

  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index];

    if (row && row.Date && toFiniteNumber(row.TradeValue) !== null) {
      return row;
    }
  }

  return null;
}

function buildTwseMarketSummary(row) {
  if (!row) return null;

  return {
    key: "twse",
    market_type: "上市",
    trade_date: parseTwseRocDate(row.Date),
    trade_volume: toFiniteNumber(row.TradeVolume),
    total_trade_amount: toFiniteNumber(row.TradeValue),
    transaction_count: toFiniteNumber(row.Transaction),
    daily_index_point: toFiniteNumber(row.TAIEX),
    daily_change_point: toFiniteNumber(row.Change),
    source: "TWSE OpenAPI FMTQIK",
  };
}

async function fetchTwseMarketSummary() {
  const rows = await fetchExternalJson(
    "https://openapi.twse.com.tw/v1/exchangeReport/FMTQIK",
    "上市市場成交資訊",
  );

  const latestRow = getLatestValidTwseMarketRow(rows);

  if (!latestRow) {
    throw new Error("上市市場成交資訊查無資料");
  }

  return buildTwseMarketSummary(latestRow);
}

async function fetchMarketSummary(config) {
  if (config.key === "twse") {
    return fetchTwseMarketSummary();
  }

  return null;
}

async function fetchMarketIndexWithSummary(config) {
  const [chartResult, summaryResult] = await Promise.allSettled([
    fetchYahooIndexChart(config),
    fetchMarketSummary(config),
  ]);

  const chart = chartResult.status === "fulfilled"
    ? chartResult.value
    : {
        key: config.key,
        market_type: config.market_type,
        index_code: config.index_code,
        index_name: config.index_name,
        symbol: config.symbols[0],
        current_point: null,
        previous_close: null,
        change_point: null,
        change_percent: null,
        open: null,
        high: null,
        low: null,
        volume: null,
        total_trade_amount: null,
        latest_time: "",
        updated_at: getTaiwanDateTimeText(),
        source: "Yahoo Finance chart",
        points: [],
        error: chartResult.reason?.message || "即時走勢讀取失敗",
      };

  const summary = summaryResult.status === "fulfilled" ? summaryResult.value : null;
  const summaryError = summaryResult.status === "rejected" ? summaryResult.reason?.message : "";

  return {
    ...chart,
    total_trade_amount: summary?.total_trade_amount ?? chart.total_trade_amount ?? null,
    trade_volume: summary?.trade_volume ?? chart.volume ?? null,
    transaction_count: summary?.transaction_count ?? null,
    summary_trade_date: summary?.trade_date || "",
    summary_index_point: summary?.daily_index_point ?? null,
    summary_change_point: summary?.daily_change_point ?? null,
    summary_source: summary?.source || "",
    summary_error: summaryError || "",
  };
}

async function fetchYahooIndexChart(config) {
  let lastError = null;

  for (const symbol of config.symbols) {
    try {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=5m&includePrePost=false`;
      const json = await fetchExternalJson(url, `${config.index_name} 即時走勢`);
      const result = json?.chart?.result?.[0];
      const error = json?.chart?.error;

      if (!result) {
        throw new Error(error?.description || `${config.index_name} 查無即時走勢資料`);
      }

      const meta = result.meta || {};
      const timestamps = Array.isArray(result.timestamp) ? result.timestamp : [];
      const quote = result.indicators?.quote?.[0] || {};
      const points = timestamps
        .map((timestamp, index) => buildYahooIndexPoint(timestamp, quote, index))
        .filter(Boolean);
      const closeSeries = points.map((point) => point.close);
      const currentPoint = toFiniteNumber(meta.regularMarketPrice) ?? getLastFiniteValue(closeSeries);
      const previousClose =
        toFiniteNumber(meta.previousClose) ??
        toFiniteNumber(meta.chartPreviousClose) ??
        (closeSeries.length >= 2 ? closeSeries[closeSeries.length - 2] : null);
      const change = currentPoint !== null && previousClose !== null ? currentPoint - previousClose : null;
      const changePercent = change !== null && previousClose ? (change / previousClose) * 100 : null;
      const latestPoint = points[points.length - 1] || null;
      const latestVolume = toFiniteNumber(meta.regularMarketVolume) ?? latestPoint?.volume ?? null;

      return {
        key: config.key,
        market_type: config.market_type,
        index_code: config.index_code,
        index_name: config.index_name,
        symbol,
        current_point: currentPoint,
        previous_close: previousClose,
        change_point: change,
        change_percent: changePercent,
        open: toFiniteNumber(meta.regularMarketOpen) ?? latestPoint?.open ?? null,
        high: toFiniteNumber(meta.regularMarketDayHigh) ?? getLastFiniteValue(points.map((point) => point.high)) ?? null,
        low: toFiniteNumber(meta.regularMarketDayLow) ?? getLastFiniteValue(points.map((point) => point.low)) ?? null,
        volume: latestVolume,
        total_trade_amount: null,
        latest_time: latestPoint?.time || getTaiwanTimeTextFromUnix(meta.regularMarketTime),
        updated_at: getTaiwanDateTimeText(),
        source: "Yahoo Finance chart",
        points,
        error: null,
      };
    } catch (error) {
      lastError = error;
    }
  }

  return {
    key: config.key,
    market_type: config.market_type,
    index_code: config.index_code,
    index_name: config.index_name,
    symbol: config.symbols[0],
    current_point: null,
    previous_close: null,
    change_point: null,
    change_percent: null,
    open: null,
    high: null,
    low: null,
    volume: null,
    total_trade_amount: null,
    latest_time: "",
    updated_at: getTaiwanDateTimeText(),
    source: "Yahoo Finance chart",
    points: [],
    error: lastError?.message || "即時走勢讀取失敗",
  };
}


function toPlainNumber(value) {
  if (value === null || value === undefined || value === "") return 0;
  const numberValue = Number(String(value).replaceAll(",", ""));
  return Number.isFinite(numberValue) ? numberValue : 0;
}

function calculateMajorHolderScore(row) {
  const largeRatio = toPlainNumber(row.large_holder_ratio);
  const largeRatioChange = toPlainNumber(row.large_holder_ratio_change);
  const smallRatioChange = toPlainNumber(row.small_holder_ratio_change);
  const largeShareChange = toPlainNumber(row.large_holder_share_change);
  const largeCountChange = toPlainNumber(row.large_holder_count_change);

  let score = 0;

  if (largeRatio >= 60) score += 6;
  else if (largeRatio >= 40) score += 4;
  else if (largeRatio >= 25) score += 2;

  if (largeRatioChange >= 1) score += 8;
  else if (largeRatioChange >= 0.3) score += 5;
  else if (largeRatioChange > 0) score += 3;

  if (largeShareChange > 0) score += 4;
  if (smallRatioChange < -0.3 && largeRatioChange > 0) score += 4;
  if (largeCountChange > 0 && largeRatioChange > 0) score += 2;

  return Math.max(0, Math.min(score, 20));
}

function getMajorHolderStatus(row) {
  const hasPrevious = Number(row.has_previous || 0) === 1;

  if (!hasPrevious) return "大戶資料累積中";

  const largeRatioChange = toPlainNumber(row.large_holder_ratio_change);
  const smallRatioChange = toPlainNumber(row.small_holder_ratio_change);
  const largeShareChange = toPlainNumber(row.large_holder_share_change);

  if (largeRatioChange >= 1 && largeShareChange > 0) return "大戶明顯增加";
  if (largeRatioChange >= 0.3 && smallRatioChange < 0) return "籌碼集中";
  if (largeRatioChange > 0) return "大戶比重上升";
  if (largeRatioChange <= -1) return "大戶明顯減少";
  if (largeRatioChange < 0) return "大戶比重下降";

  return "大戶持股穩定";
}

function enrichMajorHolderRow(row) {
  const majorHolderScore = calculateMajorHolderScore(row);

  return {
    ...row,
    major_holder_score: majorHolderScore,
    major_holder_status: getMajorHolderStatus(row),
    large_holder_share_change_lots: sharesToLotsString(toBigIntValue(row.large_holder_share_change)),
    large_holder_share_count_lots: sharesToLotsString(toBigIntValue(row.large_holder_share_count)),
    small_holder_share_count_lots: sharesToLotsString(toBigIntValue(row.small_holder_share_count)),
    thousand_lot_share_count_lots: sharesToLotsString(toBigIntValue(row.thousand_lot_share_count)),
  };
}

app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "Stock Radar API is running",
    version: "stock-radar-api-v1",
  });
});


app.post("/auth/google", async (req, res) => {
  try {
    const credential = req.body?.credential;
    const googleClientId = process.env.GOOGLE_CLIENT_ID;
    if (!googleClientId) {
      return res.status(500).json({
        success: false,
        message: "尚未設定 GOOGLE_CLIENT_ID，請先在 API 環境變數設定 Google OAuth Client ID。",
      });
    }

    if (!credential) {
      return res.status(400).json({
        success: false,
        message: "缺少 Google 登入憑證，請重新登入。",
      });
    }

    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: googleClientId,
    });
    const payload = ticket.getPayload();
    const googleId = payload?.sub;
    const email = String(payload?.email || "").trim().toLowerCase();
    const displayName = payload?.name || email.split("@")[0] || "Google 使用者";
    const pictureUrl = payload?.picture || null;

    if (!googleId || !email) {
      return res.status(401).json({
        success: false,
        message: "Google 帳號資料不完整，請重新登入。",
      });
    }

    if (payload?.email_verified !== true) {
      return res.status(403).json({
        success: false,
        message: "這個 Google Email 尚未完成驗證，請先完成 Google 帳號驗證。",
      });
    }

    await query(
      `
      INSERT INTO users (
        google_id,
        email,
        display_name,
        picture_url,
        role,
        is_active,
        last_login_at
      ) VALUES (?, ?, ?, ?, 'user', 1, NOW())
      ON DUPLICATE KEY UPDATE
        google_id = VALUES(google_id),
        display_name = VALUES(display_name),
        picture_url = VALUES(picture_url),
        last_login_at = NOW(),
        updated_at = CURRENT_TIMESTAMP
      `,
      [googleId, email, displayName, pictureUrl],
    );

    const users = await query(
      `
      SELECT
        id,
        google_id,
        email,
        display_name,
        picture_url,
        role,
        is_active,
        DATE_FORMAT(last_login_at, '%Y-%m-%d %H:%i:%s') AS last_login_at
      FROM users
      WHERE email = ?
      LIMIT 1
      `,
      [email],
    );

    if (users.length === 0 || Number(users[0].is_active) !== 1) {
      return res.status(403).json({
        success: false,
        message: "這個帳號目前沒有使用權限。",
      });
    }

    const user = users[0];
    const token = createSessionToken(user);

    res.json({
      success: true,
      message: "Google 登入成功",
      data: {
        token,
        user: convertBigIntToString(user),
      },
    });
  } catch (error) {
    console.error("Google login failed:", error);

    res.status(401).json({
      success: false,
      message: "Google 登入失敗，請確認 Client ID、Google 帳號狀態與資料表是否正確。",
      error: error.message,
    });
  }
});

app.get("/auth/me", requireAuth, async (req, res) => {
  res.json({
    success: true,
    data: {
      user: convertBigIntToString(req.user),
    },
  });
});

app.post("/auth/logout", (req, res) => {
  res.json({
    success: true,
    message: "已登出",
  });
});


// ==============================
// 大盤指數即時走勢
// GET /market/indices/intraday
// ==============================

function parseTwseRealtimeDate(value) {
  const text = String(value || "").replaceAll("/", "").replaceAll("-", "").trim();

  if (/^\d{8}$/.test(text)) {
    return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
  }

  if (/^\d{7}$/.test(text)) {
    const year = Number(text.slice(0, 3)) + 1911;
    return `${year}-${text.slice(3, 5)}-${text.slice(5, 7)}`;
  }

  return "";
}

function normalizeRealtimeNumber(value) {
  if (value === null || value === undefined) return null;

  const text = String(value)
    .replaceAll(",", "")
    .replaceAll("--", "-")
    .trim();

  if (!text || text === "-" || text === "－" || text.toLowerCase() === "nan") {
    return null;
  }

  const numberValue = Number(text);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function pickRealtimeNumber(row, keys = []) {
  for (const key of keys) {
    const numberValue = normalizeRealtimeNumber(row?.[key]);
    if (numberValue !== null) return numberValue;
  }

  return null;
}

function parseTwseLevelField(value) {
  return String(value || "")
    .split("_")
    .map((item) => item.trim())
    .filter((item) => item && item !== "-" && item !== "－")
    .map(normalizeRealtimeNumber);
}

function buildRealtimeLevels(priceText, volumeText, side) {
  const prices = parseTwseLevelField(priceText);
  const volumes = parseTwseLevelField(volumeText);
  const length = Math.max(prices.length, volumes.length, 5);

  return Array.from({ length })
    .map((_, index) => ({
      level: index + 1,
      side,
      price: prices[index] ?? null,
      volume_lots: volumes[index] ?? null,
    }))
    .filter((item) => item.price !== null || item.volume_lots !== null);
}

function getQuoteChannels(stockCode, marketType = "") {
  const code = normalizeStockCodeValue(stockCode).replace(/\.(TW|TWO)$/i, "");
  const market = String(marketType || "");
  const primary = market.includes("上櫃") ? "otc" : "tse";
  const secondary = primary === "tse" ? "otc" : "tse";

  return [`${primary}_${code}.tw`, `${secondary}_${code}.tw`];
}

function getRealtimeTradeSide(currentPrice, bestBid, bestAsk) {
  if (currentPrice === null) return "來源未提供";
  if (bestAsk !== null && currentPrice >= bestAsk) return "外盤參考";
  if (bestBid !== null && currentPrice <= bestBid) return "內盤參考";
  return "買賣中間";
}

function getRealtimeTradeSideNote(side) {
  if (side === "外盤參考") return "最新成交價接近委賣價，代表最新一筆較偏主動買進。";
  if (side === "內盤參考") return "最新成交價接近委買價，代表最新一筆較偏主動賣出。";
  if (side === "買賣中間") return "最新成交價在委買與委賣中間，暫不明顯偏內盤或外盤。";
  return "目前資料來源沒有提供可判斷內外盤的即時欄位。";
}

function findRealtimeQuoteRow(json, stockCode) {
  const code = normalizeStockCodeValue(stockCode).replace(/\.(TW|TWO)$/i, "");
  const rows = Array.isArray(json?.msgArray)
    ? json.msgArray
    : Array.isArray(json?.data)
      ? json.data
      : Array.isArray(json)
        ? json
        : [];

  return rows.find((row) => normalizeStockCodeValue(row?.c) === code) || rows[0] || null;
}

function buildRealtimeQuote(row, stockInfo, channel) {
  const bidLevels = buildRealtimeLevels(row?.b, row?.g, "bid");
  const askLevels = buildRealtimeLevels(row?.a, row?.f, "ask");
  const bestBid = bidLevels.find((item) => item.price !== null)?.price ?? null;
  const bestAsk = askLevels.find((item) => item.price !== null)?.price ?? null;
  const currentPrice = pickRealtimeNumber(row, ["z", "pz", "price", "current_price"]);
  const previousClose = pickRealtimeNumber(row, ["y", "previous_close", "previousClose"]);
  const change = currentPrice !== null && previousClose !== null ? currentPrice - previousClose : pickRealtimeNumber(row, ["change", "price_change"]);
  const changePercent = change !== null && previousClose ? (change / previousClose) * 100 : null;
  const volumeLots = pickRealtimeNumber(row, ["v", "volume", "trade_volume"]);
  const latestVolumeLots = pickRealtimeNumber(row, ["tv", "latest_volume", "last_volume"]);
  const innerVolumeLots = pickRealtimeNumber(row, ["iv", "inner_volume", "inside_volume", "in_volume"]);
  const outerVolumeLots = pickRealtimeNumber(row, ["ov", "outer_volume", "outside_volume", "out_volume"]);
  const totalAmount = pickRealtimeNumber(row, ["amount", "trade_value", "transaction_amount", "amt"]);
  const tradeSide = getRealtimeTradeSide(currentPrice, bestBid, bestAsk);

  return {
    stock_code: stockInfo.stock_code,
    stock_name: stockInfo.stock_name,
    market_type: stockInfo.market_type,
    industry: stockInfo.industry,
    security_type: getSecurityType(stockInfo),
    channel,
    symbol: `${normalizeStockCodeValue(stockInfo.stock_code)}.${String(stockInfo.market_type || "").includes("上櫃") ? "TWO" : "TW"}`,
    trade_date: parseTwseRealtimeDate(row?.d),
    latest_time: String(row?.t || row?.time || "").trim(),
    current_price: currentPrice,
    price_change: change,
    change_percent: changePercent,
    open_price: pickRealtimeNumber(row, ["o", "open_price", "open"]),
    high_price: pickRealtimeNumber(row, ["h", "high_price", "high"]),
    low_price: pickRealtimeNumber(row, ["l", "low_price", "low"]),
    previous_close: previousClose,
    volume_lots: volumeLots,
    latest_volume_lots: latestVolumeLots,
    total_trade_amount: totalAmount,
    bid_price: bestBid,
    ask_price: bestAsk,
    bid_levels: bidLevels.slice(0, 5),
    ask_levels: askLevels.slice(0, 5),
    inner_volume_lots: innerVolumeLots,
    outer_volume_lots: outerVolumeLots,
    trade_side: tradeSide,
    trade_side_note: getRealtimeTradeSideNote(tradeSide),
    source: "TWSE MIS 即時行情",
    updated_at: getTaiwanDateTimeText(),
  };
}

async function getStockInfoForRealtime(stockCode) {
  const code = normalizeStockCodeValue(stockCode);
  const rows = await query(
    `
    SELECT
      stock_code,
      stock_name,
      market_type,
      industry
    FROM stocks
    WHERE stock_code = ?
    LIMIT 1
    `,
    [code],
  );

  if (rows[0]) {
    return {
      ...rows[0],
      security_type: getSecurityType(rows[0]),
    };
  }

  return ensureEtfStockInfo(code);
}

async function fetchTwseRealtimeQuote(stockInfo) {
  const channels = getQuoteChannels(stockInfo.stock_code, stockInfo.market_type);
  const url = `https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=${encodeURIComponent(channels.join("|"))}&json=1&delay=0`;
  const json = await fetchExternalJson(url, `${stockInfo.stock_code} 即時行情`);
  const row = findRealtimeQuoteRow(json, stockInfo.stock_code);

  if (!row) {
    throw new Error("即時行情來源查無資料");
  }

  const channel = String(row?.ch || "").split(".")[0] || channels[0];
  return buildRealtimeQuote(row, stockInfo, channel);
}

function isLikelyTaiwanEtfCode(stockCode) {
  const code = normalizeStockCodeValue(stockCode).replace(/\.(TW|TWO)$/i, "");

  return /^00\d{2,4}[A-Z]?$/.test(code);
}

function isEtfStockInfo(stockInfo) {
  const securityType = String(stockInfo?.security_type || stockInfo?.instrument_type || "").toUpperCase();
  const industry = String(stockInfo?.industry || "").toUpperCase();
  const marketType = String(stockInfo?.market_type || "").toUpperCase();

  return securityType === "ETF" || industry === "ETF" || marketType.includes("ETF") || isLikelyTaiwanEtfCode(stockInfo?.stock_code);
}

function getSecurityType(stockInfo) {
  return isEtfStockInfo(stockInfo) ? "ETF" : "STOCK";
}

function getYahooSymbolCandidates(stockCode, marketType = "") {
  const code = normalizeStockCodeValue(stockCode).replace(/\.(TW|TWO)$/i, "");
  const market = String(marketType || "");

  if (market.includes("上櫃")) return [`${code}.TWO`, `${code}.TW`];
  if (market.includes("上市")) return [`${code}.TW`, `${code}.TWO`];

  return [`${code}.TW`, `${code}.TWO`];
}

function getYahooTwSymbol(stockInfo) {
  const stockCode = normalizeStockCodeValue(stockInfo?.stock_code);

  if (stockInfo?.symbol && /\.(TW|TWO)$/i.test(String(stockInfo.symbol))) {
    return String(stockInfo.symbol).toUpperCase();
  }

  return getYahooSymbolCandidates(stockCode, stockInfo?.market_type)[0];
}

function getMarketTypeFromYahooSymbol(symbol, fallback = "上市") {
  return String(symbol || "").toUpperCase().endsWith(".TWO") ? "上櫃" : fallback;
}

function normalizeYahooQuoteMeta(stockCode, symbol, meta = {}) {
  const code = normalizeStockCodeValue(stockCode);
  const name = String(meta.shortName || meta.longName || meta.symbol || code).trim();
  const marketType = getMarketTypeFromYahooSymbol(symbol, "上市");

  return {
    stock_code: code,
    stock_name: name || code,
    market_type: marketType,
    industry: "ETF",
    security_type: "ETF",
    symbol,
  };
}

async function fetchYahooQuoteSnapshot(stockCode, stockInfo = {}) {
  const code = normalizeStockCodeValue(stockCode);
  const symbols = getYahooSymbolCandidates(code, stockInfo.market_type);
  const errors = [];

  for (const symbol of symbols) {
    try {
      const sourceUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1m`;
      const json = await fetchExternalJson(sourceUrl, `${code} Yahoo 即時行情`);
      const result = json?.chart?.result?.[0];
      const meta = result?.meta || {};
      const quote = result?.indicators?.quote?.[0] || {};
      const timestamps = Array.isArray(result?.timestamp) ? result.timestamp : [];
      const closes = Array.isArray(quote.close) ? quote.close : [];
      const volumes = Array.isArray(quote.volume) ? quote.volume : [];

      const latestClose = getLastFiniteValue(closes);
      const latestVolume = getLastFiniteValue(volumes);
      const totalVolume = toFiniteNumber(meta.regularMarketVolume) ?? latestVolume;
      const currentPrice = toFiniteNumber(meta.regularMarketPrice) ?? latestClose;

      if (currentPrice === null) {
        errors.push(`${symbol}：沒有即時價格`);
        continue;
      }

      const previousClose = toFiniteNumber(meta.chartPreviousClose) ?? toFiniteNumber(meta.previousClose);
      const change = previousClose !== null ? currentPrice - previousClose : null;
      const changePercent = change !== null && previousClose ? (change / previousClose) * 100 : null;
      const lastTimestamp = timestamps.length > 0 ? timestamps[timestamps.length - 1] : null;
      const tradeDate = meta.regularMarketTime
        ? new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(Number(meta.regularMarketTime) * 1000))
        : getTaiwanDateTimeText().slice(0, 10);
      const normalizedInfo = normalizeYahooQuoteMeta(code, symbol, meta);

      return {
        stock_info: {
          ...normalizedInfo,
          stock_name: stockInfo.stock_name || normalizedInfo.stock_name,
          market_type: stockInfo.market_type || normalizedInfo.market_type,
          industry: stockInfo.industry || normalizedInfo.industry,
          security_type: getSecurityType({ ...normalizedInfo, ...stockInfo }),
        },
        quote: {
          stock_code: code,
          stock_name: stockInfo.stock_name || normalizedInfo.stock_name,
          market_type: stockInfo.market_type || normalizedInfo.market_type,
          industry: stockInfo.industry || normalizedInfo.industry,
          security_type: getSecurityType({ ...normalizedInfo, ...stockInfo }),
          symbol,
          trade_date: tradeDate,
          latest_time: meta.regularMarketTime ? getTaiwanTimeTextFromUnix(meta.regularMarketTime) : getTaiwanTimeTextFromUnix(lastTimestamp),
          current_price: currentPrice,
          close_price: currentPrice,
          price_change: change,
          change_percent: changePercent,
          open_price: toFiniteNumber(meta.regularMarketDayLow) === currentPrice ? null : getLastFiniteValue(quote.open || []) ?? toFiniteNumber(meta.regularMarketOpen),
          high_price: toFiniteNumber(meta.regularMarketDayHigh) ?? getLastFiniteValue(quote.high || []),
          low_price: toFiniteNumber(meta.regularMarketDayLow) ?? getLastFiniteValue(quote.low || []),
          previous_close: previousClose,
          volume: totalVolume,
          volume_lots: totalVolume !== null && totalVolume !== undefined ? totalVolume / 1000 : null,
          total_trade_amount: currentPrice !== null && totalVolume !== null ? currentPrice * totalVolume : null,
          source: "Yahoo Finance chart",
          source_url: sourceUrl,
          updated_at: getTaiwanDateTimeText(),
        },
      };
    } catch (error) {
      errors.push(`${symbol}：${error.message}`);
    }
  }

  throw new Error(errors.join("；") || "Yahoo 即時行情查無資料");
}

async function ensureEtfStockInfo(stockCode) {
  const code = normalizeStockCodeValue(stockCode);

  if (!isLikelyTaiwanEtfCode(code)) {
    return null;
  }

  const snapshot = await fetchYahooQuoteSnapshot(code);
  const stockInfo = {
    ...snapshot.stock_info,
    industry: "ETF",
    security_type: "ETF",
  };

  await query(
    `
    INSERT INTO stocks (
      stock_code,
      stock_name,
      market_type,
      industry,
      is_active
    )
    VALUES (?, ?, ?, 'ETF', 1)
    ON DUPLICATE KEY UPDATE
      stock_name = VALUES(stock_name),
      market_type = VALUES(market_type),
      industry = 'ETF',
      is_active = 1,
      updated_at = NOW()
    `,
    [stockInfo.stock_code, stockInfo.stock_name, stockInfo.market_type],
  );

  return stockInfo;
}

function buildEtfSummaryFromQuote(stockInfo, quote) {
  const change = toFiniteNumber(quote.price_change);
  const scoreStatus = "ETF 不計算籌碼分數";

  return {
    stock_code: stockInfo.stock_code,
    stock_name: stockInfo.stock_name,
    market_type: stockInfo.market_type,
    industry: "ETF",
    security_type: "ETF",
    trade_date: quote.trade_date,
    open_price: quote.open_price,
    high_price: quote.high_price,
    low_price: quote.low_price,
    close_price: quote.close_price ?? quote.current_price,
    price_change: change,
    change_percent: quote.change_percent,
    volume: quote.volume_lots ?? (quote.volume ? quote.volume / 1000 : null),
    transaction_amount: quote.total_trade_amount,
    transaction_count: null,
    foreign_buy: null,
    foreign_sell: null,
    foreign_net: null,
    investment_trust_buy: null,
    investment_trust_sell: null,
    investment_trust_net: null,
    dealer_net: null,
    total_net: null,
    chip_score: null,
    foreign_score: null,
    investment_trust_score: null,
    dealer_score: null,
    big_holder_score: null,
    volume_score: null,
    price_score: null,
    foreign_status: scoreStatus,
    investment_trust_status: scoreStatus,
    dealer_status: scoreStatus,
    big_holder_status: scoreStatus,
    volume_status: "ETF 成交量看即時行情",
    price_position: "ETF 以即時價格觀察",
    realtime_quote: quote,
  };
}

async function fetchYahooEtfSummary(stockCode, stockInfo = null) {
  const snapshot = await fetchYahooQuoteSnapshot(stockCode, stockInfo || {});
  const mergedStockInfo = {
    ...snapshot.stock_info,
    ...(stockInfo || {}),
    industry: "ETF",
    security_type: "ETF",
  };

  return buildEtfSummaryFromQuote(mergedStockInfo, {
    ...snapshot.quote,
    stock_name: mergedStockInfo.stock_name,
    market_type: mergedStockInfo.market_type,
    industry: "ETF",
    security_type: "ETF",
  });
}

function decodeBasicHtmlEntities(value) {
  return String(value || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x2F;/gi, "/")
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)));
}

function htmlToReadableText(html) {
  return decodeBasicHtmlEntities(
    String(html || "")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>|<\/div>|<\/li>|<\/tr>|<\/h[1-6]>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

function parseRevenuePercent(value) {
  if (value === null || value === undefined || value === "" || value === "-") return null;
  return toFiniteNumber(String(value).replace("%", ""));
}

function parseYahooRevenueRowsFromText(text, limit = 24) {
  const normalized = String(text || "")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/−/g, "-");
  const rowPattern = /(\d{4}\/\d{2})\s+([0-9,]+)\s+(-?[0-9,.]+%|-)\s+([0-9,]+)\s+(-?[0-9,.]+%|-)\s+([0-9,]+)\s+([0-9,]+)\s+(-?[0-9,.]+%|-)/g;
  const rows = [];
  const seenPeriods = new Set();
  let match;

  while ((match = rowPattern.exec(normalized)) !== null) {
    const period = match[1];

    if (seenPeriods.has(period)) continue;
    seenPeriods.add(period);

    const year = Number(period.slice(0, 4));
    const month = Number(period.slice(5, 7));

    rows.push({
      period,
      year,
      month,
      month_revenue_thousand: toFiniteNumber(match[2]),
      month_over_month_percent: parseRevenuePercent(match[3]),
      last_year_month_revenue_thousand: toFiniteNumber(match[4]),
      year_over_year_percent: parseRevenuePercent(match[5]),
      cumulative_revenue_thousand: toFiniteNumber(match[6]),
      last_year_cumulative_revenue_thousand: toFiniteNumber(match[7]),
      cumulative_year_over_year_percent: parseRevenuePercent(match[8]),
    });

    if (rows.length >= limit) break;
  }

  return rows;
}

function getRevenueGrowthStatus(latest, rows = []) {
  if (!latest) return "營收資料不足";

  const yoy = toFiniteNumber(latest.year_over_year_percent);
  const mom = toFiniteNumber(latest.month_over_month_percent);
  const recentRows = rows.slice(0, 3);
  const positiveYoyCount = recentRows.filter((row) => toFiniteNumber(row.year_over_year_percent) !== null && toFiniteNumber(row.year_over_year_percent) > 0).length;
  const positiveMomCount = recentRows.filter((row) => toFiniteNumber(row.month_over_month_percent) !== null && toFiniteNumber(row.month_over_month_percent) > 0).length;

  if (yoy !== null && yoy >= 20 && mom !== null && mom >= 0) return "營收明顯成長";
  if (positiveYoyCount >= 3 && positiveMomCount >= 2) return "營收連續轉強";
  if (yoy !== null && yoy > 0) return "營收年增";
  if (yoy !== null && yoy < 0) return "營收年減";
  return "營收持平觀察";
}

function buildMonthlyRevenueSummary(stockInfo, symbol, rows, sourceUrl) {
  const latest = rows[0] || null;

  return {
    stock_code: stockInfo.stock_code,
    stock_name: stockInfo.stock_name,
    market_type: stockInfo.market_type,
    industry: stockInfo.industry,
    symbol,
    unit: "仟元",
    latest_period: latest?.period || "",
    latest_month_revenue_thousand: latest?.month_revenue_thousand ?? null,
    latest_month_over_month_percent: latest?.month_over_month_percent ?? null,
    latest_last_year_month_revenue_thousand: latest?.last_year_month_revenue_thousand ?? null,
    latest_year_over_year_percent: latest?.year_over_year_percent ?? null,
    latest_cumulative_revenue_thousand: latest?.cumulative_revenue_thousand ?? null,
    latest_cumulative_year_over_year_percent: latest?.cumulative_year_over_year_percent ?? null,
    growth_status: getRevenueGrowthStatus(latest, rows),
    rows,
    source: "Yahoo 股市營收表",
    source_url: sourceUrl,
    updated_at: getTaiwanDateTimeText(),
  };
}

async function fetchYahooMonthlyRevenue(stockInfo, limit = 24) {
  const symbol = getYahooTwSymbol(stockInfo);
  const sourceUrl = `https://tw.stock.yahoo.com/quote/${encodeURIComponent(symbol)}/revenue`;
  const html = await fetchExternalText(sourceUrl, `${stockInfo.stock_code} 每月營收`, {
    Referer: `https://tw.stock.yahoo.com/quote/${encodeURIComponent(symbol)}`,
  });
  const text = htmlToReadableText(html);
  const rows = parseYahooRevenueRowsFromText(text, limit);

  if (rows.length === 0) {
    throw new Error("每月營收來源暫時沒有回傳可解析資料");
  }

  return buildMonthlyRevenueSummary(stockInfo, symbol, rows, sourceUrl);
}

function parseEpsPercent(value) {
  if (value === null || value === undefined || value === "" || value === "-") return null;
  return toFiniteNumber(String(value).replace("%", ""));
}

function buildQuarterKey(year, quarter) {
  const yearValue = Number(year);
  const quarterValue = Number(quarter);

  if (!Number.isFinite(yearValue) || !Number.isFinite(quarterValue)) {
    return null;
  }

  return yearValue * 4 + quarterValue;
}

function normalizeEpsRows(rows = []) {
  const sortedRows = rows
    .filter((row) => row && Number.isFinite(Number(row.year)) && Number.isFinite(Number(row.quarter)))
    .map((row) => ({
      ...row,
      year: Number(row.year),
      quarter: Number(row.quarter),
      period: row.period || `${row.year} Q${row.quarter}`,
      quarter_key: buildQuarterKey(row.year, row.quarter),
      eps: toFiniteNumber(row.eps),
      quarter_over_quarter_percent: parseEpsPercent(row.quarter_over_quarter_percent),
      year_over_year_percent: parseEpsPercent(row.year_over_year_percent),
    }))
    .sort((a, b) => b.quarter_key - a.quarter_key);

  return sortedRows.map((row, index, allRows) => {
    const previousQuarter = allRows.find((item) => item.quarter_key === row.quarter_key - 1);
    const sameQuarterLastYear = allRows.find((item) => item.quarter_key === row.quarter_key - 4);
    const eps = toFiniteNumber(row.eps);
    const previousEps = toFiniteNumber(previousQuarter?.eps);
    const lastYearEps = toFiniteNumber(sameQuarterLastYear?.eps);
    const qoq = row.quarter_over_quarter_percent ?? (
      eps !== null && previousEps !== null && previousEps !== 0
        ? ((eps - previousEps) / Math.abs(previousEps)) * 100
        : null
    );
    const yoy = row.year_over_year_percent ?? (
      eps !== null && lastYearEps !== null && lastYearEps !== 0
        ? ((eps - lastYearEps) / Math.abs(lastYearEps)) * 100
        : null
    );

    return {
      ...row,
      quarter_over_quarter_percent: qoq,
      year_over_year_percent: yoy,
    };
  });
}

function parseYahooEpsRowsFromText(text, limit = 20) {
  const normalized = String(text || "")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/−/g, "-");
  const rowPattern = /(20\d{2})\s*(?:\/\s*)?(?:Q\s*([1-4])|([1-4])\s*Q|第\s*([1-4])\s*季|([1-4])\s*季)\s+(-?[0-9,.]+|-)\s+(-?[0-9,.]+%?|-)?\s*([-+]?[0-9,.]+%?|-)?/gi;
  const rows = [];
  const seenPeriods = new Set();
  let match;

  while ((match = rowPattern.exec(normalized)) !== null) {
    const year = Number(match[1]);
    const quarter = Number(match[2] || match[3] || match[4] || match[5]);
    const period = `${year} Q${quarter}`;

    if (seenPeriods.has(period)) continue;
    seenPeriods.add(period);

    rows.push({
      period,
      year,
      quarter,
      eps: toFiniteNumber(match[6]),
      quarter_over_quarter_percent: parseEpsPercent(match[7]),
      year_over_year_percent: parseEpsPercent(match[8]),
    });

    if (rows.length >= limit) break;
  }

  return normalizeEpsRows(rows).slice(0, limit);
}

function getEpsGrowthStatus(latest, rows = []) {
  if (!latest || toFiniteNumber(latest.eps) === null) return "EPS 資料不足";

  const eps = toFiniteNumber(latest.eps);
  const qoq = toFiniteNumber(latest.quarter_over_quarter_percent);
  const yoy = toFiniteNumber(latest.year_over_year_percent);
  const recentRows = rows.slice(0, 4);
  const positiveEpsCount = recentRows.filter((row) => toFiniteNumber(row.eps) !== null && toFiniteNumber(row.eps) > 0).length;
  const positiveYoyCount = recentRows.filter((row) => toFiniteNumber(row.year_over_year_percent) !== null && toFiniteNumber(row.year_over_year_percent) > 0).length;

  if (eps !== null && eps > 0 && yoy !== null && yoy >= 20 && (qoq === null || qoq >= 0)) return "EPS 明顯成長";
  if (positiveEpsCount >= 4 && positiveYoyCount >= 3) return "EPS 連續轉強";
  if (eps !== null && eps > 0 && yoy !== null && yoy > 0) return "EPS 年增";
  if (eps !== null && eps > 0) return "EPS 獲利觀察";
  if (eps !== null && eps < 0) return "EPS 虧損觀察";
  return "EPS 持平觀察";
}

function buildQuarterlyEpsSummary(stockInfo, symbol, rows, sourceUrl) {
  const latest = rows[0] || null;
  const recentFourRows = rows.slice(0, 4);
  const validRecentEps = recentFourRows
    .map((row) => toFiniteNumber(row.eps))
    .filter((value) => value !== null);
  const trailingFourQuarterEps = validRecentEps.length > 0
    ? validRecentEps.reduce((sum, value) => sum + value, 0)
    : null;
  const averageQuarterEps = validRecentEps.length > 0
    ? trailingFourQuarterEps / validRecentEps.length
    : null;

  return {
    stock_code: stockInfo.stock_code,
    stock_name: stockInfo.stock_name,
    market_type: stockInfo.market_type,
    industry: stockInfo.industry,
    symbol,
    unit: "元",
    latest_period: latest?.period || "",
    latest_eps: latest?.eps ?? null,
    latest_quarter_over_quarter_percent: latest?.quarter_over_quarter_percent ?? null,
    latest_year_over_year_percent: latest?.year_over_year_percent ?? null,
    trailing_four_quarter_eps: trailingFourQuarterEps,
    average_quarter_eps: averageQuarterEps,
    growth_status: getEpsGrowthStatus(latest, rows),
    rows,
    source: "Yahoo 股市 EPS 表",
    source_url: sourceUrl,
    updated_at: getTaiwanDateTimeText(),
  };
}

function normalizeYahooQuoteSummaryEpsRows(history = [], limit = 20) {
  const rows = history
    .map((item) => {
      const quarterText = String(item?.quarter?.fmt || item?.quarter?.raw || "").trim();
      const match = quarterText.match(/(20\d{2}).*?([1-4])/);
      const year = match ? Number(match[1]) : null;
      const quarter = match ? Number(match[2]) : null;
      const eps = toFiniteNumber(item?.epsActual?.raw ?? item?.epsActual?.fmt);

      if (!year || !quarter || eps === null) return null;

      return {
        period: `${year} Q${quarter}`,
        year,
        quarter,
        eps,
        quarter_over_quarter_percent: null,
        year_over_year_percent: null,
      };
    })
    .filter(Boolean);

  return normalizeEpsRows(rows).slice(0, limit);
}

async function fetchYahooEpsQuoteSummary(stockInfo, limit = 20) {
  const symbol = getYahooTwSymbol(stockInfo);
  const sourceUrl = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=earningsHistory`;
  const json = await fetchExternalJson(sourceUrl, `${stockInfo.stock_code} EPS 備援資料`);
  const history = json?.quoteSummary?.result?.[0]?.earningsHistory?.history || [];
  const rows = normalizeYahooQuoteSummaryEpsRows(history, limit);

  if (rows.length === 0) {
    throw new Error("EPS 備援來源暫時沒有回傳可解析資料");
  }

  return buildQuarterlyEpsSummary(stockInfo, symbol, rows, sourceUrl);
}

async function fetchYahooQuarterlyEps(stockInfo, limit = 20) {
  const symbol = getYahooTwSymbol(stockInfo);
  const sourceUrl = `https://tw.stock.yahoo.com/quote/${encodeURIComponent(symbol)}/eps`;

  try {
    const html = await fetchExternalText(sourceUrl, `${stockInfo.stock_code} 每季 EPS`, {
      Referer: `https://tw.stock.yahoo.com/quote/${encodeURIComponent(symbol)}`,
    });
    const text = htmlToReadableText(html);
    const rows = parseYahooEpsRowsFromText(text, limit);

    if (rows.length > 0) {
      return buildQuarterlyEpsSummary(stockInfo, symbol, rows, sourceUrl);
    }
  } catch (error) {
    // 頁面解析失敗時改用 Yahoo Finance quoteSummary 備援。
  }

  return fetchYahooEpsQuoteSummary(stockInfo, limit);
}

function getTaiwanDateText(date = new Date()) {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function normalizeCalendarDateText(value) {
  const text = String(value || "").trim();
  const match = text.match(/(20\d{2})[\/\-.年](\d{1,2})[\/\-.月](\d{1,2})/);

  if (!match) return "";

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  if (!year || !month || !day || month > 12 || day > 31) return "";

  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function dateFromYahooRaw(value) {
  const raw = toFiniteNumber(value?.raw ?? value);
  if (raw === null) return "";
  return getTaiwanDateText(new Date(raw * 1000));
}

function getCalendarEventType(title) {
  const text = String(title || "");

  if (/除權息|除權交易|除權/.test(text)) return "ex_right";
  if (/除息|除息交易/.test(text)) return "ex_dividend";
  if (/配息|發放日|現金股利|股利發放/.test(text)) return "dividend";
  if (/股東會|股東常會|股東臨時會/.test(text)) return "shareholders_meeting";
  if (/法說會|法人說明會|業績發表/.test(text)) return "investor_conference";
  if (/停止過戶|最後過戶|停券|融券/.test(text)) return "book_closure";
  if (/財報|盈餘|EPS|季報|年報|營收公布|收益/.test(text)) return "earnings";
  return "other";
}

function getCalendarEventTypeName(type) {
  const typeMap = {
    ex_right: "除權",
    ex_dividend: "除息",
    dividend: "配息",
    shareholders_meeting: "股東會",
    investor_conference: "法說會",
    book_closure: "股務事件",
    earnings: "財報事件",
    other: "其他事件",
  };

  return typeMap[type] || typeMap.other;
}

function getCalendarEventImportance(type) {
  if (["ex_dividend", "ex_right", "dividend", "shareholders_meeting", "investor_conference"].includes(type)) {
    return "high";
  }

  if (["book_closure", "earnings"].includes(type)) return "medium";
  return "normal";
}

function cleanCalendarTitle(value) {
  return decodeBasicHtmlEntities(String(value || ""))
    .replace(/\s+/g, " ")
    .replace(/[｜|]{2,}/g, "｜")
    .replace(/^[-–—｜|:：,，\s]+/, "")
    .replace(/[-–—｜|:：,，\s]+$/, "")
    .trim();
}

function normalizeCalendarEvent(event) {
  const eventDate = normalizeCalendarDateText(event?.event_date || event?.date || "");
  const title = cleanCalendarTitle(event?.title || event?.event_name || "");

  if (!eventDate || !title) return null;

  const type = getCalendarEventType(title);

  return {
    event_date: eventDate,
    title,
    event_type: type,
    event_type_name: getCalendarEventTypeName(type),
    importance: getCalendarEventImportance(type),
    description: cleanCalendarTitle(event?.description || ""),
  };
}

function dedupeCalendarEvents(events = []) {
  const seen = new Set();

  return events
    .map(normalizeCalendarEvent)
    .filter(Boolean)
    .filter((event) => {
      const key = `${event.event_date}|${event.title}|${event.event_type}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.event_date.localeCompare(b.event_date));
}

function parseYahooCalendarEventsFromText(text, limit = 40) {
  const normalized = String(text || "")
    .replace(/\r/g, "\n")
    .replace(/\\u002F/g, "/")
    .replace(/\u00a0/g, " ")
    .replace(/−/g, "-");
  const lines = normalized
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const eventKeywords = /(除權息|除權交易|除權|除息交易|除息|配息|股利發放|發放日|現金股利|股東會|股東常會|股東臨時會|法說會|法人說明會|停止過戶|最後過戶|停券|融券|財報|盈餘|EPS|季報|年報|營收公布)/;
  const events = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const dateMatch = line.match(/20\d{2}[\/\-.年]\d{1,2}[\/\-.月]\d{1,2}/);

    if (!dateMatch) continue;

    const nearbyText = [line, lines[index + 1] || "", lines[index + 2] || ""]
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();

    if (!eventKeywords.test(nearbyText)) continue;

    const eventDate = normalizeCalendarDateText(dateMatch[0]);
    const title = cleanCalendarTitle(
      nearbyText
        .replace(dateMatch[0], "")
        .replace(/^(日期|時間|項目|事件|內容)\s*/g, "")
        .slice(0, 90)
    );

    events.push({
      event_date: eventDate,
      title: title || nearbyText.match(eventKeywords)?.[0] || "個股行事曆事件",
      description: nearbyText,
    });
  }

  const compactText = normalized.replace(/\s+/g, " ");
  const compactPattern = /(20\d{2}[\/\-.年]\d{1,2}[\/\-.月]\d{1,2})\s*([^。\n]{0,80}?(?:除權息|除權交易|除權|除息交易|除息|配息|股利發放|發放日|現金股利|股東會|股東常會|股東臨時會|法說會|法人說明會|停止過戶|最後過戶|停券|融券|財報|盈餘|EPS|季報|年報|營收公布)[^。\n]{0,80})/g;
  let match;

  while ((match = compactPattern.exec(compactText)) !== null) {
    events.push({
      event_date: normalizeCalendarDateText(match[1]),
      title: cleanCalendarTitle(match[2].slice(0, 90)),
      description: cleanCalendarTitle(match[0].slice(0, 120)),
    });

    if (events.length >= limit * 2) break;
  }

  return dedupeCalendarEvents(events).slice(0, limit);
}

function buildYahooQuoteSummaryCalendarEvents(stockInfo, symbol, json) {
  const result = json?.quoteSummary?.result?.[0] || {};
  const calendarEvents = result?.calendarEvents || {};
  const summaryDetail = result?.summaryDetail || {};
  const events = [];

  const exDividendDate = dateFromYahooRaw(summaryDetail?.exDividendDate || calendarEvents?.exDividendDate);
  if (exDividendDate) {
    events.push({
      event_date: exDividendDate,
      title: "除息日",
      description: "Yahoo Finance quoteSummary 提供的除息日期",
    });
  }

  const dividendDate = dateFromYahooRaw(summaryDetail?.dividendDate || calendarEvents?.dividendDate);
  if (dividendDate) {
    events.push({
      event_date: dividendDate,
      title: "股利發放日 / 配息日",
      description: "Yahoo Finance quoteSummary 提供的股利日期",
    });
  }

  const earningsDates = Array.isArray(calendarEvents?.earnings?.earningsDate)
    ? calendarEvents.earnings.earningsDate
    : [];

  earningsDates.forEach((item) => {
    const earningsDate = dateFromYahooRaw(item);
    if (earningsDate) {
      events.push({
        event_date: earningsDate,
        title: "財報 / 盈餘公布參考日",
        description: "Yahoo Finance quoteSummary 提供的財報日期",
      });
    }
  });

  return dedupeCalendarEvents(events);
}

async function fetchYahooCalendarQuoteSummary(stockInfo, limit = 40) {
  const symbol = getYahooTwSymbol(stockInfo);
  const sourceUrl = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=calendarEvents,summaryDetail`;
  const json = await fetchExternalJson(sourceUrl, `${stockInfo.stock_code} 行事曆備援資料`);
  const events = buildYahooQuoteSummaryCalendarEvents(stockInfo, symbol, json).slice(0, limit);

  if (events.length === 0) {
    throw new Error("行事曆備援來源暫時沒有回傳可解析資料");
  }

  return buildStockCalendarSummary(stockInfo, symbol, events, sourceUrl, "Yahoo Finance quoteSummary");
}

function buildStockCalendarSummary(stockInfo, symbol, events, sourceUrl, source = "Yahoo 股市行事曆") {
  const todayText = getTaiwanDateText();
  const normalizedEvents = dedupeCalendarEvents(events);
  const upcomingEvents = normalizedEvents.filter((event) => event.event_date >= todayText);
  const pastEvents = normalizedEvents.filter((event) => event.event_date < todayText).reverse();
  const nextEvent = upcomingEvents[0] || normalizedEvents[normalizedEvents.length - 1] || null;
  const typeCount = normalizedEvents.reduce((result, event) => {
    result[event.event_type] = (result[event.event_type] || 0) + 1;
    return result;
  }, {});

  return {
    stock_code: stockInfo.stock_code,
    stock_name: stockInfo.stock_name,
    market_type: stockInfo.market_type,
    industry: stockInfo.industry,
    symbol,
    today: todayText,
    next_event: nextEvent,
    upcoming_count: upcomingEvents.length,
    past_count: pastEvents.length,
    event_type_count: typeCount,
    events: [...upcomingEvents, ...pastEvents].slice(0, 40),
    source,
    source_url: sourceUrl,
    updated_at: getTaiwanDateTimeText(),
  };
}

async function fetchYahooStockCalendar(stockInfo, limit = 40) {
  const symbol = getYahooTwSymbol(stockInfo);
  const sourceUrl = `https://tw.stock.yahoo.com/quote/${encodeURIComponent(symbol)}/calendar`;

  try {
    const html = await fetchExternalText(sourceUrl, `${stockInfo.stock_code} 個股行事曆`, {
      Referer: `https://tw.stock.yahoo.com/quote/${encodeURIComponent(symbol)}`,
    });
    const text = htmlToReadableText(html);
    const events = parseYahooCalendarEventsFromText(text, limit);

    if (events.length > 0) {
      return buildStockCalendarSummary(stockInfo, symbol, events, sourceUrl);
    }
  } catch (error) {
    // Yahoo 股市頁面解析失敗時，改用 quoteSummary 備援。
  }

  return fetchYahooCalendarQuoteSummary(stockInfo, limit);
}


app.get("/market/indices/intraday", async (req, res) => {
  try {
    const indices = await Promise.all(MARKET_INDEX_CONFIGS.map(fetchMarketIndexWithSummary));

    res.json({
      success: true,
      message: "大盤指數即時走勢讀取完成",
      updated_at: getTaiwanDateTimeText(),
      data: convertBigIntToString({
        indices,
      }),
    });
  } catch (error) {
    console.error("查詢大盤指數即時走勢失敗：", error);

    res.status(500).json({
      success: false,
      message: "查詢大盤指數即時走勢失敗",
      error: error.message,
    });
  }
});


app.get("/stock/:stockCode/realtime", async (req, res) => {
  try {
    const stockCode = normalizeStockCodeValue(req.params.stockCode);

    if (!isValidStockCodeValue(stockCode)) {
      return res.status(400).json({
        success: false,
        message: "股票代號格式不正確",
      });
    }

    const stockInfo = await getStockInfoForRealtime(stockCode);

    if (!stockInfo) {
      return res.status(404).json({
        success: false,
        message: "Stock not found",
      });
    }

    let realtimeQuote;

    try {
      realtimeQuote = await fetchTwseRealtimeQuote(stockInfo);
    } catch (misError) {
      if (!isEtfStockInfo(stockInfo)) throw misError;
      const snapshot = await fetchYahooQuoteSnapshot(stockCode, stockInfo);
      realtimeQuote = {
        ...snapshot.quote,
        bid_levels: [],
        ask_levels: [],
        inner_volume_lots: null,
        outer_volume_lots: null,
        trade_side: "ETF 即時參考",
        trade_side_note: "ETF 目前使用 Yahoo 即時資料，五檔與內外盤若來源未提供則不顯示。",
      };
    }

    res.json({
      success: true,
      message: "個股即時行情讀取完成",
      data: convertBigIntToString(realtimeQuote),
    });
  } catch (error) {
    console.error("查詢個股即時行情失敗：", error);

    res.status(500).json({
      success: false,
      message: "查詢個股即時行情失敗",
      error: error.message,
    });
  }
});

app.get("/stock/:stockCode/revenue", async (req, res) => {
  try {
    const stockCode = normalizeStockCodeValue(req.params.stockCode);

    if (!isValidStockCodeValue(stockCode)) {
      return res.status(400).json({
        success: false,
        message: "股票代號格式不正確",
      });
    }

    const stockInfo = await getStockInfoForRealtime(stockCode);

    if (!stockInfo) {
      return res.status(404).json({
        success: false,
        message: "Stock not found",
      });
    }

    if (isEtfStockInfo(stockInfo)) {
      return res.json({
        success: true,
        message: "ETF 沒有公司每月營收資料",
        data: convertBigIntToString({
          stock_code: stockInfo.stock_code,
          stock_name: stockInfo.stock_name,
          market_type: stockInfo.market_type,
          industry: "ETF",
          security_type: "ETF",
          not_applicable: true,
          status: "ETF 不適用每月營收",
          rows: [],
        }),
      });
    }

    const limit = parseLimit(req.query.limit, 24, 60);
    const revenue = await fetchYahooMonthlyRevenue(stockInfo, limit);

    res.json({
      success: true,
      message: "個股每月營收讀取完成",
      data: convertBigIntToString(revenue),
    });
  } catch (error) {
    console.error("查詢個股每月營收失敗：", error);

    res.status(500).json({
      success: false,
      message: "查詢個股每月營收失敗",
      error: error.message,
    });
  }
});


app.get("/stock/:stockCode/eps", async (req, res) => {
  try {
    const stockCode = normalizeStockCodeValue(req.params.stockCode);

    if (!isValidStockCodeValue(stockCode)) {
      return res.status(400).json({
        success: false,
        message: "股票代號格式不正確",
      });
    }

    const stockInfo = await getStockInfoForRealtime(stockCode);

    if (!stockInfo) {
      return res.status(404).json({
        success: false,
        message: "Stock not found",
      });
    }

    if (isEtfStockInfo(stockInfo)) {
      return res.json({
        success: true,
        message: "ETF 沒有公司 EPS 資料",
        data: convertBigIntToString({
          stock_code: stockInfo.stock_code,
          stock_name: stockInfo.stock_name,
          market_type: stockInfo.market_type,
          industry: "ETF",
          security_type: "ETF",
          not_applicable: true,
          status: "ETF 不適用 EPS",
          rows: [],
        }),
      });
    }

    const limit = parseLimit(req.query.limit, 20, 40);
    const eps = await fetchYahooQuarterlyEps(stockInfo, limit);

    res.json({
      success: true,
      message: "個股每季 EPS 讀取完成",
      data: convertBigIntToString(eps),
    });
  } catch (error) {
    console.error("查詢個股每季 EPS 失敗：", error);

    res.status(500).json({
      success: false,
      message: "查詢個股每季 EPS 失敗",
      error: error.message,
    });
  }
});


app.get("/stock/:stockCode/calendar", async (req, res) => {
  try {
    const stockCode = normalizeStockCodeValue(req.params.stockCode);

    if (!isValidStockCodeValue(stockCode)) {
      return res.status(400).json({
        success: false,
        message: "股票代號格式不正確",
      });
    }

    const stockInfo = await getStockInfoForRealtime(stockCode);

    if (!stockInfo) {
      return res.status(404).json({
        success: false,
        message: "Stock not found",
      });
    }

    const limit = parseLimit(req.query.limit, 40, 80);
    const calendar = await fetchYahooStockCalendar(stockInfo, limit);

    res.json({
      success: true,
      message: "個股行事曆讀取完成",
      data: convertBigIntToString(calendar),
    });
  } catch (error) {
    console.error("查詢個股行事曆失敗：", error);

    res.status(500).json({
      success: false,
      message: "查詢個股行事曆失敗",
      error: error.message,
    });
  }
});

app.get("/test-db", async (req, res) => {
  try {
    const dbInfo = await testConnection();

    const tables = await query(
      `
      SELECT
        table_name
      FROM information_schema.tables
      WHERE table_schema = ?
      ORDER BY table_name
      `,
      [process.env.DB_NAME],
    );

    res.json({
      success: true,
      message: "MariaDB connected successfully",
      database: dbInfo.database_name,
      time: dbInfo.server_time,
      tables: tables.map((item) => item.table_name),
    });
  } catch (error) {
    console.error("Test DB failed:", error);

    res.status(500).json({
      success: false,
      message: "MariaDB connection failed",
      error: error.message,
    });
  }
});

app.get("/stocks", async (req, res) => {
  try {
    const stocks = await query(`
      SELECT
        stock_code,
        stock_name,
        market_type,
        industry,
        is_active,
        DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS created_at,
        DATE_FORMAT(updated_at, '%Y-%m-%d %H:%i:%s') AS updated_at
      FROM stocks
      ORDER BY stock_code
    `);

    res.json({
      success: true,
      count: stocks.length,
      data: convertBigIntToString(stocks),
    });
  } catch (error) {
    console.error("Get stocks failed:", error);

    res.status(500).json({
      success: false,
      message: "Get stocks failed",
      error: error.message,
    });
  }
});

app.get("/stocks/:stockCode", async (req, res) => {
  try {
    const stockCode = req.params.stockCode;

    const stocks = await query(
      `
      SELECT
        stock_code,
        stock_name,
        market_type,
        industry,
        is_active,
        DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS created_at,
        DATE_FORMAT(updated_at, '%Y-%m-%d %H:%i:%s') AS updated_at
      FROM stocks
      WHERE stock_code = ?
      LIMIT 1
      `,
      [stockCode],
    );

    if (stocks.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Stock not found",
      });
    }

    res.json({
      success: true,
      data: stocks[0],
    });
  } catch (error) {
    console.error("Get stock detail failed:", error);

    res.status(500).json({
      success: false,
      message: "Get stock detail failed",
      error: error.message,
    });
  }
});

app.get("/prices/:stockCode", async (req, res) => {
  try {
    const stockCode = req.params.stockCode;
    const limit = Number(req.query.limit) || 30;

    const prices = await query(
      `
      SELECT
        DATE_FORMAT(trade_date, '%Y-%m-%d') AS trade_date,
        stock_code,
        open_price,
        high_price,
        low_price,
        close_price,
        price_change,
        CAST(volume AS CHAR) AS volume,
        CAST(transaction_amount AS CHAR) AS transaction_amount,
        CAST(transaction_count AS CHAR) AS transaction_count,
        DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS created_at,
        DATE_FORMAT(updated_at, '%Y-%m-%d %H:%i:%s') AS updated_at
      FROM daily_prices
      WHERE stock_code = ?
      ORDER BY trade_date DESC
      LIMIT ?
      `,
      [stockCode, limit],
    );

    res.json({
      success: true,
      stock_code: stockCode,
      count: prices.length,
      data: convertBigIntToString(prices),
    });
  } catch (error) {
    console.error("Get prices failed:", error);

    res.status(500).json({
      success: false,
      message: "Get prices failed",
      error: error.message,
    });
  }
});

app.get("/institutional-trades/:stockCode", async (req, res) => {
  try {
    const stockCode = req.params.stockCode;
    const limit = Number(req.query.limit) || 30;

    const trades = await query(
      `
      SELECT
        DATE_FORMAT(trade_date, '%Y-%m-%d') AS trade_date,
        stock_code,

        CAST(foreign_buy AS CHAR) AS foreign_buy,
        CAST(foreign_sell AS CHAR) AS foreign_sell,
        CAST(foreign_net AS CHAR) AS foreign_net,

        CAST(investment_trust_buy AS CHAR) AS investment_trust_buy,
        CAST(investment_trust_sell AS CHAR) AS investment_trust_sell,
        CAST(investment_trust_net AS CHAR) AS investment_trust_net,

        CAST(dealer_net AS CHAR) AS dealer_net,
        CAST(total_net AS CHAR) AS total_net,

        DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS created_at,
        DATE_FORMAT(updated_at, '%Y-%m-%d %H:%i:%s') AS updated_at
      FROM institutional_trades
      WHERE stock_code = ?
      ORDER BY trade_date DESC
      LIMIT ?
      `,
      [stockCode, limit],
    );

    res.json({
      success: true,
      stock_code: stockCode,
      count: trades.length,
      data: convertBigIntToString(trades),
    });
  } catch (error) {
    console.error("Get institutional trades failed:", error);

    res.status(500).json({
      success: false,
      message: "Get institutional trades failed",
      error: error.message,
    });
  }
});

app.get("/radar-scores/:stockCode", async (req, res) => {
  try {
    const stockCode = req.params.stockCode;
    const limit = Number(req.query.limit) || 30;

    const scores = await query(
      `
      SELECT
        DATE_FORMAT(trade_date, '%Y-%m-%d') AS trade_date,
        stock_code,

        chip_score,
        foreign_score,
        investment_trust_score,
        dealer_score,
        big_holder_score,
        volume_score,
        price_score,

        foreign_status,
        investment_trust_status,
        dealer_status,
        big_holder_status,
        volume_status,
        price_position,

        DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS created_at,
        DATE_FORMAT(updated_at, '%Y-%m-%d %H:%i:%s') AS updated_at
      FROM chip_scores
      WHERE stock_code = ?
      ORDER BY trade_date DESC
      LIMIT ?
      `,
      [stockCode, limit],
    );

    res.json({
      success: true,
      stock_code: stockCode,
      count: scores.length,
      data: convertBigIntToString(scores),
    });
  } catch (error) {
    console.error("Get radar scores failed:", error);

    res.status(500).json({
      success: false,
      message: "Get radar scores failed",
      error: error.message,
    });
  }
});

app.get("/radar/today", async (req, res) => {
  try {
    const queryDate = req.query.date || null;
    const market = parseMarket(req.query.market);
    const limit = parseLimit(req.query.limit, 20, 100);

    if (queryDate && !isValidDateText(queryDate)) {
      return res.status(400).json({
        success: false,
        message: "date 格式錯誤，請使用 YYYY-MM-DD",
      });
    }

    let targetDate = queryDate;

    if (!targetDate) {
      const latestDateParams = [];
      let latestDateMarketCondition = "";

      if (market) {
        latestDateMarketCondition = "WHERE s.market_type = ?";
        latestDateParams.push(market);
      }

      const latestDateRows = await query(
        `
        SELECT DATE_FORMAT(MAX(c.trade_date), '%Y-%m-%d') AS latest_date
        FROM chip_scores c
        LEFT JOIN stocks s
          ON c.stock_code = s.stock_code
        ${latestDateMarketCondition}
        `,
        latestDateParams,
      );

      targetDate = latestDateRows[0].latest_date;
    }

    if (!targetDate) {
      return res.json({
        success: true,
        trade_date: null,
        market: market || "全部",
        count: 0,
        data: [],
      });
    }

    const params = [targetDate];
    let marketCondition = "";

    if (market) {
      marketCondition = "AND s.market_type = ?";
      params.push(market);
    }

    params.push(limit);

    const radarList = await query(
      `
      SELECT
        DATE_FORMAT(c.trade_date, '%Y-%m-%d') AS trade_date,
        c.stock_code,
        s.stock_name,
        s.market_type,
        s.industry,

        c.chip_score,
        c.foreign_score,
        c.investment_trust_score,
        c.dealer_score,
        c.big_holder_score,
        c.volume_score,
        c.price_score,

        c.foreign_status,
        c.investment_trust_status,
        c.dealer_status,
        c.big_holder_status,
        c.volume_status,
        c.price_position,

        p.close_price,
        p.price_change,
        CAST(p.volume AS CHAR) AS volume,

        DATE_FORMAT(c.created_at, '%Y-%m-%d %H:%i:%s') AS created_at,
        DATE_FORMAT(c.updated_at, '%Y-%m-%d %H:%i:%s') AS updated_at
      FROM chip_scores c
      LEFT JOIN stocks s
        ON c.stock_code = s.stock_code
      LEFT JOIN daily_prices p
        ON c.stock_code = p.stock_code
       AND c.trade_date = p.trade_date
      WHERE c.trade_date = ?
        ${marketCondition}
      ORDER BY c.chip_score DESC, c.stock_code ASC
      LIMIT ?
      `,
      params,
    );

    res.json({
      success: true,
      trade_date: targetDate,
      market: market || "全部",
      limit,
      count: radarList.length,
      data: convertBigIntToString(radarList),
    });
  } catch (error) {
    console.error("Get today radar failed:", error);

    res.status(500).json({
      success: false,
      message: "Get today radar failed",
      error: error.message,
    });
  }
});

app.get("/radar/foreign-buy-ranking", async (req, res) => {
  try {
    const queryDate = req.query.date || null;
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);

    let targetDate = queryDate;

    if (!targetDate) {
      const latestDateRows = await query(`
        SELECT DATE_FORMAT(MAX(trade_date), '%Y-%m-%d') AS latest_date
        FROM institutional_trades
      `);

      targetDate = latestDateRows[0].latest_date;
    }

    if (!targetDate) {
      return res.json({
        success: true,
        trade_date: null,
        count: 0,
        data: [],
      });
    }

    const rows = await query(
      `
      SELECT
        DATE_FORMAT(it.trade_date, '%Y-%m-%d') AS trade_date,
        it.stock_code,
        s.stock_name,
        s.market_type,
        s.industry,
        CAST(it.foreign_net AS CHAR) AS foreign_net
      FROM institutional_trades it
      LEFT JOIN stocks s
        ON it.stock_code = s.stock_code
      WHERE it.trade_date <= ?
      ORDER BY it.stock_code ASC, it.trade_date DESC
      `,
      [targetDate],
    );

    const stockMap = new Map();

    rows.forEach((row) => {
      if (!stockMap.has(row.stock_code)) {
        stockMap.set(row.stock_code, []);
      }

      stockMap.get(row.stock_code).push(row);
    });

    const ranking = [];

    stockMap.forEach((stockRows) => {
      const latestRow = stockRows[0];

      if (latestRow.trade_date !== targetDate) {
        return;
      }

      const todayForeignNet = toBigIntValue(latestRow.foreign_net);

      if (todayForeignNet <= 0n) {
        return;
      }

      let foreignBuyDays = 0;
      let totalForeignNet = 0n;

      for (const row of stockRows) {
        const foreignNet = toBigIntValue(row.foreign_net);

        if (foreignNet > 0n) {
          foreignBuyDays += 1;
          totalForeignNet += foreignNet;
        } else {
          break;
        }
      }

      ranking.push({
        trade_date: targetDate,
        stock_code: latestRow.stock_code,
        stock_name: latestRow.stock_name,
        market_type: latestRow.market_type,
        industry: latestRow.industry,

        foreign_buy_days: foreignBuyDays,

        today_foreign_net_shares: todayForeignNet.toString(),
        today_foreign_net_lots: sharesToLotsString(todayForeignNet),

        total_foreign_net_shares: totalForeignNet.toString(),
        total_foreign_net_lots: sharesToLotsString(totalForeignNet),
      });
    });

    ranking.sort((a, b) => {
      if (b.foreign_buy_days !== a.foreign_buy_days) {
        return b.foreign_buy_days - a.foreign_buy_days;
      }

      const totalDiff =
        BigInt(b.total_foreign_net_shares) - BigInt(a.total_foreign_net_shares);

      if (totalDiff > 0n) return 1;
      if (totalDiff < 0n) return -1;

      const todayDiff =
        BigInt(b.today_foreign_net_shares) - BigInt(a.today_foreign_net_shares);

      if (todayDiff > 0n) return 1;
      if (todayDiff < 0n) return -1;

      return a.stock_code.localeCompare(b.stock_code);
    });

    const limitedRanking = ranking.slice(0, limit);

    res.json({
      success: true,
      trade_date: targetDate,
      count: limitedRanking.length,
      data: limitedRanking,
    });
  } catch (error) {
    console.error("Get foreign buy ranking failed:", error);

    res.status(500).json({
      success: false,
      message: "Get foreign buy ranking failed",
      error: error.message,
    });
  }
});

app.get("/radar/investment-trust-ranking", async (req, res) => {
  try {
    const queryDate = req.query.date || null;
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);

    let targetDate = queryDate;

    if (!targetDate) {
      const latestDateRows = await query(`
        SELECT DATE_FORMAT(MAX(trade_date), '%Y-%m-%d') AS latest_date
        FROM institutional_trades
      `);

      targetDate = latestDateRows[0].latest_date;
    }

    if (!targetDate) {
      return res.json({
        success: true,
        trade_date: null,
        count: 0,
        data: [],
      });
    }

    const rows = await query(
      `
      SELECT
        DATE_FORMAT(it.trade_date, '%Y-%m-%d') AS trade_date,
        it.stock_code,
        s.stock_name,
        s.market_type,
        s.industry,
        CAST(it.investment_trust_net AS CHAR) AS investment_trust_net
      FROM institutional_trades it
      LEFT JOIN stocks s
        ON it.stock_code = s.stock_code
      WHERE it.trade_date <= ?
      ORDER BY it.stock_code ASC, it.trade_date DESC
      `,
      [targetDate],
    );

    const stockMap = new Map();

    rows.forEach((row) => {
      if (!stockMap.has(row.stock_code)) {
        stockMap.set(row.stock_code, []);
      }

      stockMap.get(row.stock_code).push(row);
    });

    const ranking = [];

    stockMap.forEach((stockRows) => {
      const latestRow = stockRows[0];

      if (latestRow.trade_date !== targetDate) {
        return;
      }

      const todayInvestmentTrustNet = toBigIntValue(
        latestRow.investment_trust_net,
      );

      if (todayInvestmentTrustNet <= 0n) {
        return;
      }

      let investmentTrustBuyDays = 0;
      let totalInvestmentTrustNet = 0n;

      for (const row of stockRows) {
        const investmentTrustNet = toBigIntValue(row.investment_trust_net);

        if (investmentTrustNet > 0n) {
          investmentTrustBuyDays += 1;
          totalInvestmentTrustNet += investmentTrustNet;
        } else {
          break;
        }
      }

      ranking.push({
        trade_date: targetDate,
        stock_code: latestRow.stock_code,
        stock_name: latestRow.stock_name,
        market_type: latestRow.market_type,
        industry: latestRow.industry,

        investment_trust_buy_days: investmentTrustBuyDays,

        today_investment_trust_net_shares: todayInvestmentTrustNet.toString(),
        today_investment_trust_net_lots: sharesToLotsString(
          todayInvestmentTrustNet,
        ),

        total_investment_trust_net_shares: totalInvestmentTrustNet.toString(),
        total_investment_trust_net_lots: sharesToLotsString(
          totalInvestmentTrustNet,
        ),
      });
    });

    ranking.sort((a, b) => {
      if (b.investment_trust_buy_days !== a.investment_trust_buy_days) {
        return b.investment_trust_buy_days - a.investment_trust_buy_days;
      }

      const totalDiff =
        BigInt(b.total_investment_trust_net_shares) -
        BigInt(a.total_investment_trust_net_shares);

      if (totalDiff > 0n) return 1;
      if (totalDiff < 0n) return -1;

      const todayDiff =
        BigInt(b.today_investment_trust_net_shares) -
        BigInt(a.today_investment_trust_net_shares);

      if (todayDiff > 0n) return 1;
      if (todayDiff < 0n) return -1;

      return a.stock_code.localeCompare(b.stock_code);
    });

    const limitedRanking = ranking.slice(0, limit);

    res.json({
      success: true,
      trade_date: targetDate,
      count: limitedRanking.length,
      data: limitedRanking,
    });
  } catch (error) {
    console.error("Get investment trust ranking failed:", error);

    res.status(500).json({
      success: false,
      message: "Get investment trust ranking failed",
      error: error.message,
    });
  }
});


// ==============================
// 法人同步買超雷達：外資、投信同時買超
// GET /radar/institutional-sync-buying?market=上市&limit=30
// ==============================
app.get("/radar/institutional-sync-buying", async (req, res) => {
  try {
    const limit = parseLimit(req.query.limit, 20, 100);
    const market = parseMarket(req.query.market);
    const queryDate = req.query.date || null;

    if (queryDate && !isValidDateText(queryDate)) {
      return res.status(400).json({
        success: false,
        message: "date 格式錯誤，請使用 YYYY-MM-DD",
      });
    }

    let targetDate = queryDate;

    if (!targetDate) {
      const latestDateParams = [];
      let latestDateMarketCondition = "";

      if (market) {
        latestDateMarketCondition = "WHERE s.market_type = ?";
        latestDateParams.push(market);
      }

      const latestDateRows = await query(
        `
        SELECT DATE_FORMAT(MAX(i.trade_date), '%Y-%m-%d') AS latest_date
        FROM institutional_trades i
        LEFT JOIN stocks s
          ON i.stock_code = s.stock_code
        ${latestDateMarketCondition}
        `,
        latestDateParams,
      );

      targetDate = latestDateRows[0].latest_date;
    }

    if (!targetDate) {
      return res.json({
        success: true,
        trade_date: null,
        market: market || "全部",
        limit,
        count: 0,
        data: [],
      });
    }

    const params = [targetDate];
    let marketCondition = "";

    if (market) {
      marketCondition = "AND s.market_type = ?";
      params.push(market);
    }

    const rows = await query(
      `
      SELECT
        DATE_FORMAT(i.trade_date, '%Y-%m-%d') AS trade_date,
        i.stock_code,
        s.stock_name,
        s.market_type,
        s.industry,

        CAST(i.foreign_buy AS CHAR) AS foreign_buy,
        CAST(i.foreign_sell AS CHAR) AS foreign_sell,
        CAST(i.foreign_net AS CHAR) AS foreign_net,
        CAST(i.investment_trust_buy AS CHAR) AS investment_trust_buy,
        CAST(i.investment_trust_sell AS CHAR) AS investment_trust_sell,
        CAST(i.investment_trust_net AS CHAR) AS investment_trust_net,
        CAST(i.dealer_net AS CHAR) AS dealer_net,
        CAST(i.total_net AS CHAR) AS total_net,
        CAST((COALESCE(i.foreign_net, 0) + COALESCE(i.investment_trust_net, 0)) AS CHAR) AS institutional_sync_net,

        p.close_price,
        p.price_change,
        CAST(p.volume AS CHAR) AS volume,

        c.chip_score,
        c.foreign_score,
        c.investment_trust_score,
        c.dealer_score,
        c.big_holder_score,
        c.volume_score,
        c.price_score,
        c.foreign_status,
        c.investment_trust_status,
        c.dealer_status,
        c.big_holder_status,
        c.volume_status,
        c.price_position
      FROM institutional_trades i
      LEFT JOIN stocks s
        ON i.stock_code = s.stock_code
      LEFT JOIN daily_prices p
        ON i.stock_code = p.stock_code
       AND i.trade_date = p.trade_date
      LEFT JOIN chip_scores c
        ON i.stock_code = c.stock_code
       AND i.trade_date = c.trade_date
      WHERE i.trade_date <= ?
        ${marketCondition}
      ORDER BY i.stock_code ASC, i.trade_date DESC
      `,
      params,
    );

    const stockMap = new Map();

    rows.forEach((row) => {
      if (!stockMap.has(row.stock_code)) {
        stockMap.set(row.stock_code, []);
      }

      stockMap.get(row.stock_code).push(row);
    });

    const ranking = [];

    stockMap.forEach((stockRows) => {
      const latestRow = stockRows[0];

      if (!latestRow || latestRow.trade_date !== targetDate) {
        return;
      }

      const todayForeignNet = toBigIntValue(latestRow.foreign_net);
      const todayInvestmentTrustNet = toBigIntValue(latestRow.investment_trust_net);

      if (todayForeignNet <= 0n || todayInvestmentTrustNet <= 0n) {
        return;
      }

      let syncBuyDays = 0;
      let totalForeignNet = 0n;
      let totalInvestmentTrustNet = 0n;
      let totalSyncNet = 0n;

      for (const row of stockRows) {
        const foreignNet = toBigIntValue(row.foreign_net);
        const investmentTrustNet = toBigIntValue(row.investment_trust_net);

        if (foreignNet > 0n && investmentTrustNet > 0n) {
          syncBuyDays += 1;
          totalForeignNet += foreignNet;
          totalInvestmentTrustNet += investmentTrustNet;
          totalSyncNet += foreignNet + investmentTrustNet;
        } else {
          break;
        }
      }

      const todaySyncNet = todayForeignNet + todayInvestmentTrustNet;

      ranking.push({
        trade_date: targetDate,
        stock_code: latestRow.stock_code,
        stock_name: latestRow.stock_name,
        market_type: latestRow.market_type,
        industry: latestRow.industry,

        sync_buy_days: syncBuyDays,
        today_foreign_net_lots: todayForeignNet.toString(),
        today_investment_trust_net_lots: todayInvestmentTrustNet.toString(),
        today_sync_net_lots: todaySyncNet.toString(),
        total_foreign_net_lots: totalForeignNet.toString(),
        total_investment_trust_net_lots: totalInvestmentTrustNet.toString(),
        total_sync_net_lots: totalSyncNet.toString(),

        foreign_net: latestRow.foreign_net,
        investment_trust_net: latestRow.investment_trust_net,
        institutional_sync_net: latestRow.institutional_sync_net,
        dealer_net: latestRow.dealer_net,
        total_net: latestRow.total_net,

        close_price: latestRow.close_price,
        price_change: latestRow.price_change,
        volume: latestRow.volume,

        chip_score: latestRow.chip_score,
        foreign_score: latestRow.foreign_score,
        investment_trust_score: latestRow.investment_trust_score,
        dealer_score: latestRow.dealer_score,
        big_holder_score: latestRow.big_holder_score,
        volume_score: latestRow.volume_score,
        price_score: latestRow.price_score,
        foreign_status: latestRow.foreign_status,
        investment_trust_status: latestRow.investment_trust_status,
        dealer_status: latestRow.dealer_status,
        big_holder_status: latestRow.big_holder_status,
        volume_status: latestRow.volume_status,
        price_position: latestRow.price_position,
      });
    });

    ranking.sort((a, b) => {
      if (b.sync_buy_days !== a.sync_buy_days) {
        return b.sync_buy_days - a.sync_buy_days;
      }

      const totalSyncDiff = BigInt(b.total_sync_net_lots) - BigInt(a.total_sync_net_lots);
      if (totalSyncDiff > 0n) return 1;
      if (totalSyncDiff < 0n) return -1;

      const todaySyncDiff = BigInt(b.today_sync_net_lots) - BigInt(a.today_sync_net_lots);
      if (todaySyncDiff > 0n) return 1;
      if (todaySyncDiff < 0n) return -1;

      const scoreDiff = Number(b.chip_score || 0) - Number(a.chip_score || 0);
      if (scoreDiff !== 0) return scoreDiff;

      return a.stock_code.localeCompare(b.stock_code);
    });

    const limitedRanking = ranking.slice(0, limit);

    res.json({
      success: true,
      trade_date: targetDate,
      market: market || "全部",
      limit,
      count: limitedRanking.length,
      data: convertBigIntToString(limitedRanking),
    });
  } catch (error) {
    console.error("查詢法人同步買超雷達失敗：", error);

    res.status(500).json({
      success: false,
      message: "查詢法人同步買超雷達失敗",
      error: error.message,
    });
  }
});


// ==============================
// 產業分類完成度
// GET /industries/status
// ==============================
app.get("/industries/status", async (req, res) => {
  try {
    const rows = await query(`
      SELECT
        COALESCE(market_type, '未設定') AS market_type,
        COUNT(*) AS total_count,
        SUM(CASE WHEN industry IS NULL OR industry = '' OR industry = '未分類' THEN 1 ELSE 0 END) AS unclassified_count,
        COUNT(DISTINCT CASE WHEN industry IS NOT NULL AND industry <> '' AND industry <> '未分類' THEN industry END) AS industry_count
      FROM stocks
      WHERE is_active = 1
      GROUP BY COALESCE(market_type, '未設定')
      ORDER BY market_type ASC
    `);

    const summary = rows.map((row) => {
      const totalCount = Number(row.total_count || 0);
      const unclassifiedCount = Number(row.unclassified_count || 0);
      const classifiedCount = Math.max(totalCount - unclassifiedCount, 0);
      const classifiedRate = totalCount > 0 ? Number(((classifiedCount / totalCount) * 100).toFixed(2)) : 0;

      return {
        market_type: row.market_type,
        total_count: totalCount,
        classified_count: classifiedCount,
        unclassified_count: unclassifiedCount,
        industry_count: Number(row.industry_count || 0),
        classified_rate: classifiedRate,
      };
    });

    res.json({
      success: true,
      count: summary.length,
      data: summary,
    });
  } catch (error) {
    console.error("查詢產業分類完成度失敗：", error);

    res.status(500).json({
      success: false,
      message: "查詢產業分類完成度失敗",
      error: error.message,
    });
  }
});

// ==============================
// 產業資金流向分析
// GET /radar/industry-flow?market=上市&limit=30&date=YYYY-MM-DD
// ==============================
app.get("/radar/industry-flow", async (req, res) => {
  try {
    const limit = parseLimit(req.query.limit, 20, 50);
    const market = parseMarket(req.query.market);
    const queryDate = req.query.date || null;

    if (queryDate && !isValidDateText(queryDate)) {
      return res.status(400).json({
        success: false,
        message: "date 格式錯誤，請使用 YYYY-MM-DD",
      });
    }

    let targetDate = queryDate;

    if (!targetDate) {
      const latestDateParams = [];
      let latestDateMarketCondition = "";

      if (market) {
        latestDateMarketCondition = "WHERE s.market_type = ?";
        latestDateParams.push(market);
      }

      const latestDateRows = await query(
        `
        SELECT DATE_FORMAT(MAX(i.trade_date), '%Y-%m-%d') AS latest_date
        FROM institutional_trades i
        LEFT JOIN stocks s
          ON i.stock_code = s.stock_code
        ${latestDateMarketCondition}
        `,
        latestDateParams,
      );

      targetDate = latestDateRows[0].latest_date;
    }

    if (!targetDate) {
      return res.json({
        success: true,
        trade_date: null,
        market: market || "全部",
        limit,
        count: 0,
        data: [],
      });
    }

    const marketCondition = market ? "AND s.market_type = ?" : "";
    const baseParams = market ? [targetDate, market] : [targetDate];

    const industryRows = await query(
      `
      SELECT
        DATE_FORMAT(i.trade_date, '%Y-%m-%d') AS trade_date,
        COALESCE(NULLIF(s.industry, ''), '未分類') AS industry,
        GROUP_CONCAT(DISTINCT s.market_type ORDER BY s.market_type SEPARATOR '、') AS market_types,
        COUNT(DISTINCT i.stock_code) AS stock_count,
        SUM(CASE WHEN COALESCE(i.total_net, 0) > 0 THEN 1 ELSE 0 END) AS net_buy_stock_count,
        SUM(CASE WHEN COALESCE(i.foreign_net, 0) > 0 THEN 1 ELSE 0 END) AS foreign_buy_stock_count,
        SUM(CASE WHEN COALESCE(i.investment_trust_net, 0) > 0 THEN 1 ELSE 0 END) AS investment_trust_buy_stock_count,
        SUM(CASE WHEN COALESCE(p.price_change, 0) > 0 THEN 1 ELSE 0 END) AS up_stock_count,
        SUM(CASE WHEN COALESCE(p.price_change, 0) < 0 THEN 1 ELSE 0 END) AS down_stock_count,
        CAST(SUM(COALESCE(i.foreign_net, 0)) AS CHAR) AS foreign_net_lots,
        CAST(SUM(COALESCE(i.investment_trust_net, 0)) AS CHAR) AS investment_trust_net_lots,
        CAST(SUM(COALESCE(i.dealer_net, 0)) AS CHAR) AS dealer_net_lots,
        CAST(SUM(COALESCE(i.total_net, 0)) AS CHAR) AS total_net_lots,
        CAST(SUM(COALESCE(i.foreign_net, 0) + COALESCE(i.investment_trust_net, 0)) AS CHAR) AS foreign_trust_net_lots,
        CAST(SUM(COALESCE(p.volume, 0)) AS CHAR) AS total_volume_lots,
        CAST(SUM(COALESCE(p.transaction_amount, 0)) AS CHAR) AS total_transaction_amount,
        ROUND(AVG(c.chip_score), 2) AS avg_chip_score
      FROM institutional_trades i
      LEFT JOIN stocks s
        ON i.stock_code = s.stock_code
      LEFT JOIN daily_prices p
        ON i.stock_code = p.stock_code
       AND i.trade_date = p.trade_date
      LEFT JOIN chip_scores c
        ON i.stock_code = c.stock_code
       AND i.trade_date = c.trade_date
      WHERE i.trade_date = ?
        ${marketCondition}
        AND COALESCE(NULLIF(s.industry, ''), '未分類') <> '未分類'
      GROUP BY i.trade_date, COALESCE(NULLIF(s.industry, ''), '未分類')
      ORDER BY
        SUM(COALESCE(i.total_net, 0)) DESC,
        SUM(COALESCE(i.foreign_net, 0) + COALESCE(i.investment_trust_net, 0)) DESC,
        SUM(COALESCE(p.transaction_amount, 0)) DESC,
        industry ASC
      LIMIT ?
      `,
      [...baseParams, limit],
    );

    const leaderRows = await query(
      `
      SELECT
        COALESCE(NULLIF(s.industry, ''), '未分類') AS industry,
        i.stock_code,
        s.stock_name,
        s.market_type,
        p.close_price,
        p.price_change,
        c.chip_score,
        CAST(i.foreign_net AS CHAR) AS foreign_net_lots,
        CAST(i.investment_trust_net AS CHAR) AS investment_trust_net_lots,
        CAST(i.dealer_net AS CHAR) AS dealer_net_lots,
        CAST(i.total_net AS CHAR) AS total_net_lots,
        CAST((COALESCE(i.foreign_net, 0) + COALESCE(i.investment_trust_net, 0)) AS CHAR) AS foreign_trust_net_lots
      FROM institutional_trades i
      LEFT JOIN stocks s
        ON i.stock_code = s.stock_code
      LEFT JOIN daily_prices p
        ON i.stock_code = p.stock_code
       AND i.trade_date = p.trade_date
      LEFT JOIN chip_scores c
        ON i.stock_code = c.stock_code
       AND i.trade_date = c.trade_date
      WHERE i.trade_date = ?
        ${marketCondition}
        AND COALESCE(NULLIF(s.industry, ''), '未分類') <> '未分類'
      ORDER BY
        industry ASC,
        COALESCE(i.total_net, 0) DESC,
        COALESCE(i.foreign_net, 0) + COALESCE(i.investment_trust_net, 0) DESC,
        COALESCE(c.chip_score, 0) DESC,
        i.stock_code ASC
      `,
      baseParams,
    );

    const leadersByIndustry = new Map();

    leaderRows.forEach((row) => {
      if (!leadersByIndustry.has(row.industry)) {
        leadersByIndustry.set(row.industry, []);
      }

      const leaders = leadersByIndustry.get(row.industry);
      if (leaders.length >= 3) return;

      leaders.push({
        stock_code: row.stock_code,
        stock_name: row.stock_name,
        market_type: row.market_type,
        close_price: row.close_price,
        price_change: row.price_change,
        chip_score: row.chip_score,
        foreign_net_lots: row.foreign_net_lots,
        investment_trust_net_lots: row.investment_trust_net_lots,
        dealer_net_lots: row.dealer_net_lots,
        total_net_lots: row.total_net_lots,
        foreign_trust_net_lots: row.foreign_trust_net_lots,
      });
    });

    const data = industryRows.map((row, index) => {
      const totalNet = toBigIntValue(row.total_net_lots);
      const foreignTrustNet = toBigIntValue(row.foreign_trust_net_lots);
      const stockCount = Number(row.stock_count || 0);
      const netBuyStockCount = Number(row.net_buy_stock_count || 0);
      const netBuyRatio = stockCount > 0 ? netBuyStockCount / stockCount : 0;

      let flowDirection = "資金中性";
      let flowStrength = "觀察中";

      if (totalNet > 0n) {
        flowDirection = "資金淨流入";
        flowStrength = totalNet >= 5000n || (foreignTrustNet >= 2000n && netBuyRatio >= 0.5) ? "強勢流入" : "溫和流入";
      } else if (totalNet < 0n) {
        flowDirection = "資金淨流出";
        flowStrength = totalNet <= -5000n ? "明顯流出" : "偏弱流出";
      }

      return {
        rank: index + 1,
        trade_date: row.trade_date,
        industry: row.industry,
        market_types: row.market_types || market || "全部",
        stock_count: stockCount,
        net_buy_stock_count: netBuyStockCount,
        foreign_buy_stock_count: Number(row.foreign_buy_stock_count || 0),
        investment_trust_buy_stock_count: Number(row.investment_trust_buy_stock_count || 0),
        up_stock_count: Number(row.up_stock_count || 0),
        down_stock_count: Number(row.down_stock_count || 0),
        foreign_net_lots: row.foreign_net_lots,
        investment_trust_net_lots: row.investment_trust_net_lots,
        dealer_net_lots: row.dealer_net_lots,
        total_net_lots: row.total_net_lots,
        foreign_trust_net_lots: row.foreign_trust_net_lots,
        total_volume_lots: row.total_volume_lots,
        total_transaction_amount: row.total_transaction_amount,
        avg_chip_score: row.avg_chip_score,
        net_buy_ratio: Number((netBuyRatio * 100).toFixed(1)),
        flow_direction: flowDirection,
        flow_strength: flowStrength,
        top_stocks: leadersByIndustry.get(row.industry) || [],
      };
    });

    res.json({
      success: true,
      trade_date: targetDate,
      market: market || "全部",
      limit,
      count: data.length,
      data: convertBigIntToString(data),
    });
  } catch (error) {
    console.error("查詢產業資金流向失敗：", error);

    res.status(500).json({
      success: false,
      message: "查詢產業資金流向失敗",
      error: error.message,
    });
  }
});

// ==============================
// 主力籌碼分析：TDCC 集保大戶資料
// GET /major-holders/status
// GET /major-holders/:stockCode?limit=12
// GET /radar/major-holder?market=上市&limit=30&date=YYYY-MM-DD
// ==============================
app.get("/major-holders/status", async (req, res) => {
  try {
    const rows = await query(`
      SELECT
        DATE_FORMAT(MAX(data_date), '%Y-%m-%d') AS latest_date,
        COUNT(DISTINCT stock_code) AS stock_count,
        COUNT(*) AS row_count,
        COUNT(DISTINCT data_date) AS date_count
      FROM major_holder_stats
    `);

    const byDate = await query(`
      SELECT
        DATE_FORMAT(data_date, '%Y-%m-%d') AS data_date,
        COUNT(DISTINCT stock_code) AS stock_count
      FROM major_holder_stats
      GROUP BY data_date
      ORDER BY data_date DESC
      LIMIT 8
    `);

    res.json({
      success: true,
      data: {
        latest_date: rows[0]?.latest_date || null,
        stock_count: Number(rows[0]?.stock_count || 0),
        row_count: Number(rows[0]?.row_count || 0),
        date_count: Number(rows[0]?.date_count || 0),
        history: convertBigIntToString(byDate),
      },
    });
  } catch (error) {
    console.error("查詢大戶籌碼狀態失敗：", error);

    res.status(500).json({
      success: false,
      message: "查詢大戶籌碼狀態失敗，請先執行 npm run major-holders:import 建立並匯入資料。",
      error: error.message,
    });
  }
});

app.get("/major-holders/:stockCode", async (req, res) => {
  try {
    const stockCode = String(req.params.stockCode || "").trim();
    const limit = parseLimit(req.query.limit, 12, 60);

    if (!stockCode) {
      return res.status(400).json({
        success: false,
        message: "請輸入股票代號",
      });
    }

    const rows = await query(
      `
      SELECT
        DATE_FORMAT(m.data_date, '%Y-%m-%d') AS data_date,
        m.stock_code,
        s.stock_name,
        s.market_type,
        s.industry,
        m.total_holder_count,
        CAST(m.total_share_count AS CHAR) AS total_share_count,
        m.small_holder_count,
        CAST(m.small_holder_share_count AS CHAR) AS small_holder_share_count,
        m.small_holder_ratio,
        m.mid_holder_count,
        CAST(m.mid_holder_share_count AS CHAR) AS mid_holder_share_count,
        m.mid_holder_ratio,
        m.large_holder_count,
        CAST(m.large_holder_share_count AS CHAR) AS large_holder_share_count,
        m.large_holder_ratio,
        m.thousand_lot_holder_count,
        CAST(m.thousand_lot_share_count AS CHAR) AS thousand_lot_share_count,
        m.thousand_lot_ratio,
        m.avg_large_holder_lots,
        CASE WHEN p.id IS NULL THEN 0 ELSE 1 END AS has_previous,
        CAST((m.large_holder_count - COALESCE(p.large_holder_count, m.large_holder_count)) AS CHAR) AS large_holder_count_change,
        CAST((m.large_holder_share_count - COALESCE(p.large_holder_share_count, m.large_holder_share_count)) AS CHAR) AS large_holder_share_change,
        ROUND(m.large_holder_ratio - COALESCE(p.large_holder_ratio, m.large_holder_ratio), 4) AS large_holder_ratio_change,
        ROUND(m.small_holder_ratio - COALESCE(p.small_holder_ratio, m.small_holder_ratio), 4) AS small_holder_ratio_change,
        ROUND(m.thousand_lot_ratio - COALESCE(p.thousand_lot_ratio, m.thousand_lot_ratio), 4) AS thousand_lot_ratio_change
      FROM major_holder_stats m
      LEFT JOIN stocks s
        ON m.stock_code = s.stock_code
      LEFT JOIN major_holder_stats p
        ON p.stock_code = m.stock_code
       AND p.data_date = (
          SELECT MAX(p2.data_date)
          FROM major_holder_stats p2
          WHERE p2.stock_code = m.stock_code
            AND p2.data_date < m.data_date
       )
      WHERE m.stock_code = ?
      ORDER BY m.data_date DESC
      LIMIT ?
      `,
      [stockCode, limit],
    );

    res.json({
      success: true,
      stock_code: stockCode,
      count: rows.length,
      data: convertBigIntToString(rows.map(enrichMajorHolderRow)),
    });
  } catch (error) {
    console.error("查詢個股大戶籌碼失敗：", error);

    res.status(500).json({
      success: false,
      message: "查詢個股大戶籌碼失敗",
      error: error.message,
    });
  }
});

app.get("/radar/major-holder", async (req, res) => {
  try {
    const limit = parseLimit(req.query.limit, 20, 100);
    const market = parseMarket(req.query.market);
    const queryDate = req.query.date || null;

    if (queryDate && !isValidDateText(queryDate)) {
      return res.status(400).json({
        success: false,
        message: "date 格式錯誤，請使用 YYYY-MM-DD",
      });
    }

    let targetDate = queryDate;

    if (queryDate) {
      const latestRows = await query(
        `
        SELECT DATE_FORMAT(MAX(data_date), '%Y-%m-%d') AS latest_date
        FROM major_holder_stats
        WHERE data_date <= ?
        `,
        [queryDate],
      );

      targetDate = latestRows[0]?.latest_date || null;
    } else {
      const latestRows = await query(`
        SELECT DATE_FORMAT(MAX(data_date), '%Y-%m-%d') AS latest_date
        FROM major_holder_stats
      `);

      targetDate = latestRows[0]?.latest_date || null;
    }

    if (!targetDate) {
      return res.json({
        success: true,
        data_date: null,
        market: market || "全部",
        limit,
        count: 0,
        data: [],
      });
    }

    const latestTradeRows = await query(`
      SELECT DATE_FORMAT(MAX(trade_date), '%Y-%m-%d') AS latest_trade_date
      FROM daily_prices
    `);
    const latestTradeDate = latestTradeRows[0]?.latest_trade_date || targetDate;

    const params = [latestTradeDate, latestTradeDate, targetDate];
    let marketCondition = "";

    if (market) {
      marketCondition = "AND s.market_type = ?";
      params.push(market);
    }

    const rows = await query(
      `
      SELECT
        DATE_FORMAT(m.data_date, '%Y-%m-%d') AS data_date,
        DATE_FORMAT(dp.trade_date, '%Y-%m-%d') AS trade_date,
        m.stock_code,
        s.stock_name,
        s.market_type,
        s.industry,
        m.total_holder_count,
        CAST(m.total_share_count AS CHAR) AS total_share_count,
        m.small_holder_count,
        CAST(m.small_holder_share_count AS CHAR) AS small_holder_share_count,
        m.small_holder_ratio,
        m.mid_holder_count,
        CAST(m.mid_holder_share_count AS CHAR) AS mid_holder_share_count,
        m.mid_holder_ratio,
        m.large_holder_count,
        CAST(m.large_holder_share_count AS CHAR) AS large_holder_share_count,
        m.large_holder_ratio,
        m.thousand_lot_holder_count,
        CAST(m.thousand_lot_share_count AS CHAR) AS thousand_lot_share_count,
        m.thousand_lot_ratio,
        m.avg_large_holder_lots,
        CASE WHEN prev.id IS NULL THEN 0 ELSE 1 END AS has_previous,
        CAST((m.large_holder_count - COALESCE(prev.large_holder_count, m.large_holder_count)) AS CHAR) AS large_holder_count_change,
        CAST((m.large_holder_share_count - COALESCE(prev.large_holder_share_count, m.large_holder_share_count)) AS CHAR) AS large_holder_share_change,
        ROUND(m.large_holder_ratio - COALESCE(prev.large_holder_ratio, m.large_holder_ratio), 4) AS large_holder_ratio_change,
        ROUND(m.small_holder_ratio - COALESCE(prev.small_holder_ratio, m.small_holder_ratio), 4) AS small_holder_ratio_change,
        ROUND(m.thousand_lot_ratio - COALESCE(prev.thousand_lot_ratio, m.thousand_lot_ratio), 4) AS thousand_lot_ratio_change,
        dp.close_price,
        dp.price_change,
        CAST(dp.volume AS CHAR) AS volume,
        cs.chip_score,
        cs.big_holder_score,
        cs.big_holder_status
      FROM major_holder_stats m
      LEFT JOIN stocks s
        ON m.stock_code = s.stock_code
      LEFT JOIN major_holder_stats prev
        ON prev.stock_code = m.stock_code
       AND prev.data_date = (
          SELECT MAX(p2.data_date)
          FROM major_holder_stats p2
          WHERE p2.stock_code = m.stock_code
            AND p2.data_date < m.data_date
       )
      LEFT JOIN daily_prices dp
        ON dp.stock_code = m.stock_code
       AND dp.trade_date = ?
      LEFT JOIN chip_scores cs
        ON cs.stock_code = m.stock_code
       AND cs.trade_date = ?
      WHERE m.data_date = ?
        ${marketCondition}
        AND s.is_active = 1
      `,
      params,
    );

    const data = rows
      .map(enrichMajorHolderRow)
      .sort((a, b) => {
        if (b.major_holder_score !== a.major_holder_score) return b.major_holder_score - a.major_holder_score;
        const ratioDiff = toPlainNumber(b.large_holder_ratio_change) - toPlainNumber(a.large_holder_ratio_change);
        if (ratioDiff !== 0) return ratioDiff;
        const shareDiff = toPlainNumber(b.large_holder_share_change) - toPlainNumber(a.large_holder_share_change);
        if (shareDiff !== 0) return shareDiff;
        const ratioRank = toPlainNumber(b.large_holder_ratio) - toPlainNumber(a.large_holder_ratio);
        if (ratioRank !== 0) return ratioRank;
        return String(a.stock_code).localeCompare(String(b.stock_code));
      })
      .slice(0, limit)
      .map((row, index) => ({
        rank: index + 1,
        ...row,
      }));

    res.json({
      success: true,
      data_date: targetDate,
      trade_date: latestTradeDate,
      market: market || "全部",
      limit,
      count: data.length,
      data: convertBigIntToString(data),
    });
  } catch (error) {
    console.error("查詢主力籌碼分析失敗：", error);

    res.status(500).json({
      success: false,
      message: "查詢主力籌碼分析失敗，請先執行 npm run major-holders:import 匯入 TDCC 集保資料。",
      error: error.message,
    });
  }
});

// ==============================
// 今日雷達：籌碼分數排行
// GET /radar/top?market=上市&limit=30
// ==============================
app.get("/radar/top", async (req, res) => {
  let conn;

  try {
    const limit = parseLimit(req.query.limit, 20, 100);
    const market = parseMarket(req.query.market);
    const queryDate = req.query.date || null;

    if (queryDate && !isValidDateText(queryDate)) {
      return res.status(400).json({
        success: false,
        message: "date 格式錯誤，請使用 YYYY-MM-DD",
      });
    }

    conn = await pool.getConnection();

    let targetDate = queryDate;

    if (!targetDate) {
      const latestDateParams = [];
      let latestDateMarketCondition = "";

      if (market) {
        latestDateMarketCondition = "WHERE s.market_type = ?";
        latestDateParams.push(market);
      }

      const latestDateRows = await conn.query(
        `
        SELECT DATE_FORMAT(MAX(c.trade_date), '%Y-%m-%d') AS latest_date
        FROM chip_scores c
        LEFT JOIN stocks s
          ON c.stock_code = s.stock_code
        ${latestDateMarketCondition}
        `,
        latestDateParams,
      );

      targetDate = latestDateRows[0].latest_date;
    }

    if (!targetDate) {
      return res.json({
        success: true,
        trade_date: null,
        market: market || "全部",
        limit,
        count: 0,
        data: [],
      });
    }

    const params = [targetDate];
    let marketCondition = "";

    if (market) {
      marketCondition = "AND s.market_type = ?";
      params.push(market);
    }

    params.push(limit);

    const rows = await conn.query(
      `
      SELECT
        DATE_FORMAT(c.trade_date, '%Y-%m-%d') AS trade_date,
        c.stock_code,
        s.stock_name,
        s.market_type,
        s.industry,
        c.chip_score,
        c.foreign_score,
        c.investment_trust_score,
        c.dealer_score,
        c.big_holder_score,
        c.volume_score,
        c.price_score,
        c.foreign_status,
        c.investment_trust_status,
        c.dealer_status,
        c.big_holder_status,
        c.volume_status,
        c.price_position,
        p.close_price,
        p.price_change,
        CAST(p.volume AS CHAR) AS volume
      FROM chip_scores c
      LEFT JOIN stocks s
        ON c.stock_code = s.stock_code
      LEFT JOIN daily_prices p
        ON c.stock_code = p.stock_code
       AND c.trade_date = p.trade_date
      WHERE c.trade_date = ?
        ${marketCondition}
      ORDER BY c.chip_score DESC, c.stock_code ASC
      LIMIT ?
      `,
      params,
    );

    res.json({
      success: true,
      trade_date: targetDate,
      market: market || "全部",
      limit,
      count: rows.length,
      data: convertBigIntToString(rows),
    });
  } catch (error) {
    console.error("查詢今日雷達失敗：", error);

    res.status(500).json({
      success: false,
      message: "查詢今日雷達失敗",
      error: error.message,
    });
  } finally {
    if (conn) conn.release();
  }
});

// ==============================
// 外資買超排行
// GET /foreign/top?market=上櫃&limit=30
// ==============================
app.get("/foreign/top", async (req, res) => {
  let conn;

  try {
    const limit = parseLimit(req.query.limit, 20, 100);
    const market = parseMarket(req.query.market);
    const queryDate = req.query.date || null;

    if (queryDate && !isValidDateText(queryDate)) {
      return res.status(400).json({
        success: false,
        message: "date 格式錯誤，請使用 YYYY-MM-DD",
      });
    }

    conn = await pool.getConnection();

    let targetDate = queryDate;

    if (!targetDate) {
      const latestDateParams = [];
      let latestDateMarketCondition = "";

      if (market) {
        latestDateMarketCondition = "WHERE s.market_type = ?";
        latestDateParams.push(market);
      }

      const latestDateRows = await conn.query(
        `
        SELECT DATE_FORMAT(MAX(i.trade_date), '%Y-%m-%d') AS latest_date
        FROM institutional_trades i
        LEFT JOIN stocks s
          ON i.stock_code = s.stock_code
        ${latestDateMarketCondition}
        `,
        latestDateParams,
      );

      targetDate = latestDateRows[0].latest_date;
    }

    if (!targetDate) {
      return res.json({
        success: true,
        trade_date: null,
        market: market || "全部",
        limit,
        count: 0,
        data: [],
      });
    }

    const params = [targetDate];
    let marketCondition = "";

    if (market) {
      marketCondition = "AND s.market_type = ?";
      params.push(market);
    }

    params.push(limit);

    const rows = await conn.query(
      `
      SELECT
        DATE_FORMAT(i.trade_date, '%Y-%m-%d') AS trade_date,
        i.stock_code,
        s.stock_name,
        s.market_type,
        s.industry,
        CAST(i.foreign_buy AS CHAR) AS foreign_buy,
        CAST(i.foreign_sell AS CHAR) AS foreign_sell,
        CAST(i.foreign_net AS CHAR) AS foreign_net,
        CAST(i.investment_trust_net AS CHAR) AS investment_trust_net,
        CAST(i.dealer_net AS CHAR) AS dealer_net,
        CAST(i.total_net AS CHAR) AS total_net,
        p.close_price,
        p.price_change,
        CAST(p.volume AS CHAR) AS volume
      FROM institutional_trades i
      LEFT JOIN stocks s
        ON i.stock_code = s.stock_code
      LEFT JOIN daily_prices p
        ON i.stock_code = p.stock_code
       AND i.trade_date = p.trade_date
      WHERE i.trade_date = ?
        ${marketCondition}
      ORDER BY i.foreign_net DESC, i.stock_code ASC
      LIMIT ?
      `,
      params,
    );

    res.json({
      success: true,
      trade_date: targetDate,
      market: market || "全部",
      limit,
      count: rows.length,
      data: convertBigIntToString(rows),
    });
  } catch (error) {
    console.error("查詢外資排行失敗：", error);

    res.status(500).json({
      success: false,
      message: "查詢外資排行失敗",
      error: error.message,
    });
  } finally {
    if (conn) conn.release();
  }
});

// ==============================
// 個股摘要
// GET /stock/:stockCode/summary
// ==============================
app.get("/stock/:stockCode/summary", async (req, res) => {
  let conn;

  try {
    const stockCode = normalizeStockCodeValue(req.params.stockCode);

    if (!isValidStockCodeValue(stockCode)) {
      return res.status(400).json({
        success: false,
        message: "股票或 ETF 代號格式不正確",
      });
    }

    conn = await pool.getConnection();

    const rows = await conn.query(
      `
      SELECT
        s.stock_code,
        s.stock_name,
        s.market_type,
        s.industry,

        p.trade_date,
        p.open_price,
        p.high_price,
        p.low_price,
        p.close_price,
        p.price_change,
        p.volume,
        p.transaction_amount,
        p.transaction_count,

        i.foreign_buy,
        i.foreign_sell,
        i.foreign_net,
        i.investment_trust_buy,
        i.investment_trust_sell,
        i.investment_trust_net,
        i.dealer_net,
        i.total_net,

        c.chip_score,
        c.foreign_score,
        c.investment_trust_score,
        c.dealer_score,
        c.big_holder_score,
        c.volume_score,
        c.price_score,
        c.foreign_status,
        c.investment_trust_status,
        c.dealer_status,
        c.big_holder_status,
        c.volume_status,
        c.price_position
      FROM stocks s
      LEFT JOIN daily_prices p
        ON s.stock_code = p.stock_code
       AND p.trade_date = (
          SELECT MAX(trade_date)
          FROM daily_prices
          WHERE stock_code = ?
       )
      LEFT JOIN institutional_trades i
        ON s.stock_code = i.stock_code
       AND i.trade_date = p.trade_date
      LEFT JOIN chip_scores c
        ON s.stock_code = c.stock_code
       AND c.trade_date = p.trade_date
      WHERE s.stock_code = ?
      LIMIT 1
      `,
      [stockCode, stockCode],
    );

    if (rows.length === 0) {
      if (isLikelyTaiwanEtfCode(stockCode)) {
        const stockInfo = await ensureEtfStockInfo(stockCode);
        const etfSummary = await fetchYahooEtfSummary(stockCode, stockInfo);

        return res.json({
          success: true,
          data: convertBigIntToString(etfSummary),
        });
      }

      return res.status(404).json({
        success: false,
        message: "Stock not found",
      });
    }

    const summaryRow = {
      ...rows[0],
      security_type: getSecurityType(rows[0]),
    };

    if (isEtfStockInfo(summaryRow)) {
      try {
        const etfSummary = await fetchYahooEtfSummary(stockCode, summaryRow);

        return res.json({
          success: true,
          data: convertBigIntToString({ ...summaryRow, ...etfSummary }),
        });
      } catch (etfError) {
        return res.json({
          success: true,
          data: convertBigIntToString(summaryRow),
        });
      }
    }

    res.json({
      success: true,
      data: convertBigIntToString(summaryRow),
    });
  } catch (error) {
    console.error("查詢個股摘要失敗：", error);

    res.status(500).json({
      success: false,
      message: "查詢個股摘要失敗",
      error: error.message,
    });
  } finally {
    if (conn) conn.release();
  }
});


function normalizeStockCodeValue(value) {
  return String(value || "").trim().replace(/\s+/g, "").toUpperCase();
}

function isValidStockCodeValue(value) {
  return /^[0-9A-Z]{2,10}$/.test(String(value || ""));
}

async function enrichWatchlistEtfRows(rows = []) {
  const enrichedRows = await Promise.all(rows.map(async (row) => {
    const baseRow = {
      ...row,
      security_type: getSecurityType(row),
    };

    if (!isEtfStockInfo(baseRow)) return baseRow;

    try {
      const etfSummary = await fetchYahooEtfSummary(baseRow.stock_code, baseRow);

      return {
        ...baseRow,
        ...etfSummary,
        watchlist_id: baseRow.watchlist_id,
        user_id: baseRow.user_id,
        note: baseRow.note,
        sort_order: baseRow.sort_order,
        watchlist_created_at: baseRow.watchlist_created_at,
        watchlist_updated_at: baseRow.watchlist_updated_at,
        security_type: "ETF",
      };
    } catch (error) {
      return baseRow;
    }
  }));

  return enrichedRows;
}

async function getWatchlistRows(userId, stockCode = null) {
  const params = [userId];
  let stockCondition = "";

  if (stockCode) {
    stockCondition = "AND w.stock_code = ?";
    params.push(stockCode);
  }

  return query(
    `
    SELECT
      w.id AS watchlist_id,
      w.user_id,
      w.stock_code,
      w.note,
      w.sort_order,
      DATE_FORMAT(w.created_at, '%Y-%m-%d %H:%i:%s') AS watchlist_created_at,
      DATE_FORMAT(w.updated_at, '%Y-%m-%d %H:%i:%s') AS watchlist_updated_at,

      s.stock_name,
      s.market_type,
      s.industry,

      DATE_FORMAT(p.trade_date, '%Y-%m-%d') AS trade_date,
      p.open_price,
      p.high_price,
      p.low_price,
      p.close_price,
      p.price_change,
      CAST(p.volume AS CHAR) AS volume,
      CAST(p.transaction_amount AS CHAR) AS transaction_amount,
      CAST(p.transaction_count AS CHAR) AS transaction_count,

      CAST(i.foreign_buy AS CHAR) AS foreign_buy,
      CAST(i.foreign_sell AS CHAR) AS foreign_sell,
      CAST(i.foreign_net AS CHAR) AS foreign_net,
      CAST(i.investment_trust_buy AS CHAR) AS investment_trust_buy,
      CAST(i.investment_trust_sell AS CHAR) AS investment_trust_sell,
      CAST(i.investment_trust_net AS CHAR) AS investment_trust_net,
      CAST(i.dealer_net AS CHAR) AS dealer_net,
      CAST(i.total_net AS CHAR) AS total_net,

      c.chip_score,
      c.foreign_score,
      c.investment_trust_score,
      c.dealer_score,
      c.big_holder_score,
      c.volume_score,
      c.price_score,
      c.foreign_status,
      c.investment_trust_status,
      c.dealer_status,
      c.big_holder_status,
      c.volume_status,
      c.price_position
    FROM watchlists w
    INNER JOIN stocks s
      ON w.stock_code = s.stock_code
    LEFT JOIN daily_prices p
      ON w.stock_code = p.stock_code
     AND p.trade_date = (
        SELECT MAX(dp.trade_date)
        FROM daily_prices dp
        WHERE dp.stock_code = w.stock_code
     )
    LEFT JOIN institutional_trades i
      ON w.stock_code = i.stock_code
     AND i.trade_date = p.trade_date
    LEFT JOIN chip_scores c
      ON w.stock_code = c.stock_code
     AND c.trade_date = p.trade_date
    WHERE w.user_id = ?
      ${stockCondition}
    ORDER BY w.sort_order ASC, w.created_at ASC, w.stock_code ASC
    `,
    params,
  );
}

// ==============================
// 自選股：取得目前登入者的自選股
// GET /watchlist
// ==============================
app.get("/watchlist", requireAuth, async (req, res) => {
  try {
    const rows = await enrichWatchlistEtfRows(await getWatchlistRows(req.user.id));

    res.json({
      success: true,
      count: rows.length,
      data: convertBigIntToString(rows),
    });
  } catch (error) {
    console.error("查詢自選股失敗：", error);

    res.status(500).json({
      success: false,
      message: "查詢自選股失敗",
      error: error.message,
    });
  }
});

// ==============================
// 自選股：新增股票
// POST /watchlist
// body: { stock_code: "2330", note: "可省略" }
// ==============================
app.post("/watchlist", requireAuth, async (req, res) => {
  try {
    const stockCode = normalizeStockCodeValue(req.body?.stock_code);
    const note = String(req.body?.note || "").trim().slice(0, 255) || null;

    if (!stockCode) {
      return res.status(400).json({
        success: false,
        message: "請提供股票代號。",
      });
    }

    if (!isValidStockCodeValue(stockCode)) {
      return res.status(400).json({
        success: false,
        message: "股票代號格式不正確。",
      });
    }

    let stocks = await query(
      `
      SELECT stock_code
      FROM stocks
      WHERE stock_code = ?
        AND is_active = 1
      LIMIT 1
      `,
      [stockCode],
    );

    if (stocks.length === 0 && isLikelyTaiwanEtfCode(stockCode)) {
      const etfInfo = await ensureEtfStockInfo(stockCode);
      stocks = etfInfo ? [{ stock_code: etfInfo.stock_code }] : [];
    }

    if (stocks.length === 0) {
      return res.status(404).json({
        success: false,
        message: "查不到這檔股票或 ETF，請確認代號是否正確。",
      });
    }

    const sortRows = await query(
      `
      SELECT COALESCE(MAX(sort_order), 0) + 10 AS next_sort_order
      FROM watchlists
      WHERE user_id = ?
      `,
      [req.user.id],
    );
    const nextSortOrder = Number(sortRows[0]?.next_sort_order || 10);

    await query(
      `
      INSERT INTO watchlists (user_id, stock_code, note, sort_order)
      VALUES (?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        note = VALUES(note),
        updated_at = CURRENT_TIMESTAMP
      `,
      [req.user.id, stockCode, note, nextSortOrder],
    );

    const rows = await enrichWatchlistEtfRows(await getWatchlistRows(req.user.id, stockCode));

    res.json({
      success: true,
      message: "已加入自選股",
      data: convertBigIntToString(rows[0] || { stock_code: stockCode }),
    });
  } catch (error) {
    console.error("新增自選股失敗：", error);

    res.status(500).json({
      success: false,
      message: "新增自選股失敗",
      error: error.message,
    });
  }
});


// ==============================
// 自選股：調整排序
// PATCH /watchlist/order
// body: { stock_codes: ["2330", "2317"] }
// ==============================
app.patch("/watchlist/order", requireAuth, async (req, res) => {
  let conn;

  try {
    const stockCodes = Array.isArray(req.body?.stock_codes)
      ? req.body.stock_codes.map(normalizeStockCodeValue).filter(Boolean)
      : [];
    const uniqueStockCodes = [...new Set(stockCodes)];

    if (uniqueStockCodes.length === 0) {
      return res.status(400).json({
        success: false,
        message: "請提供要排序的自選股股票代號。",
      });
    }

    const hasInvalidCode = uniqueStockCodes.some((stockCode) => !isValidStockCodeValue(stockCode));

    if (hasInvalidCode) {
      return res.status(400).json({
        success: false,
        message: "股票代號格式不正確。",
      });
    }

    const currentRows = await query(
      `
      SELECT stock_code
      FROM watchlists
      WHERE user_id = ?
      `,
      [req.user.id],
    );
    const currentCodes = currentRows.map((row) => normalizeStockCodeValue(row.stock_code));
    const currentCodeSet = new Set(currentCodes);
    const missingCodes = uniqueStockCodes.filter((stockCode) => !currentCodeSet.has(stockCode));

    if (missingCodes.length > 0) {
      return res.status(400).json({
        success: false,
        message: `排序清單包含未加入自選股的股票：${missingCodes.join(", ")}`,
      });
    }

    const fullOrderCodes = [
      ...uniqueStockCodes,
      ...currentCodes.filter((stockCode) => !uniqueStockCodes.includes(stockCode)),
    ];

    conn = await pool.getConnection();
    await conn.beginTransaction();

    for (const [index, stockCode] of fullOrderCodes.entries()) {
      await conn.query(
        `
        UPDATE watchlists
        SET sort_order = ?, updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ?
          AND stock_code = ?
        `,
        [(index + 1) * 10, req.user.id, stockCode],
      );
    }

    await conn.commit();

    const rows = await getWatchlistRows(req.user.id);

    res.json({
      success: true,
      message: "自選股順序已更新",
      count: rows.length,
      data: convertBigIntToString(rows),
    });
  } catch (error) {
    if (conn) await conn.rollback();
    console.error("調整自選股排序失敗：", error);

    res.status(500).json({
      success: false,
      message: "調整自選股排序失敗",
      error: error.message,
    });
  } finally {
    if (conn) conn.release();
  }
});

// ==============================
// 自選股：移除股票
// DELETE /watchlist/:stockCode
// ==============================
app.delete("/watchlist/:stockCode", requireAuth, async (req, res) => {
  try {
    const stockCode = normalizeStockCodeValue(req.params.stockCode);

    if (!stockCode || !isValidStockCodeValue(stockCode)) {
      return res.status(400).json({
        success: false,
        message: "股票代號格式不正確。",
      });
    }

    const result = await query(
      `
      DELETE FROM watchlists
      WHERE user_id = ?
        AND stock_code = ?
      `,
      [req.user.id, stockCode],
    );

    res.json({
      success: true,
      message: "已移除自選股",
      affected_rows: Number(result?.affectedRows || 0),
      data: {
        stock_code: stockCode,
      },
    });
  } catch (error) {
    console.error("移除自選股失敗：", error);

    res.status(500).json({
      success: false,
      message: "移除自選股失敗",
      error: error.message,
    });
  }
});

app.listen(PORT, () => {
  console.log(`Stock Radar API running on http://localhost:${PORT}`);
});
