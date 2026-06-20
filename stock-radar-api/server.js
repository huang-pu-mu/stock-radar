import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import crypto from "crypto";
import { OAuth2Client } from "google-auth-library";
import pool from "./db.js";
import { query, testConnection } from "./db.js";
import { generateWatchlistAlerts } from "./scripts/generateWatchlistAlerts.js";

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


const STRATEGY_DEFINITIONS = [
  {
    key: "legal_strength",
    name: "法人轉強股",
    short_name: "法人轉強",
    description: "外資或投信轉為買超，搭配籌碼分數與法人分數篩選。",
    focus: "法人",
    criteria: [
      "外資或投信最近一個交易日為買超",
      "籌碼分數達 70 分以上，或法人分數合計達 20 分以上",
      "依法人分數、籌碼分數與法人買超金額排序",
    ],
    score_formula: "策略分數 = 外資分數 + 投信分數 + 籌碼分數",
    sort_reason: "分數越高代表法人買盤與整體籌碼條件越集中；同分時優先看法人買超較大的股票。",
    risk_tips: [
      "法人買超可能只是短線調節，不一定代表股價會立即上漲。",
      "若股價已接近高點，追價風險會提高。",
      "仍需搭配成交量、股價位置與大盤環境判斷。",
    ],
    empty_tips: [
      "降低市場篩選條件，改看全部市場。",
      "等下一個交易日法人資料更新後再查看。",
      "改看資金流入股或短線強勢股。",
    ],
  },
  {
    key: "major_holder_accumulate",
    name: "主力增持股",
    short_name: "主力增持",
    description: "400 張以上大戶比重增加，且散戶比重下降或籌碼集中。",
    focus: "主力",
    criteria: [
      "使用 TDCC 集保週資料，觀察 400 張以上大戶持股比例",
      "本週大戶比重高於前一週",
      "優先排序大戶比重增加較明顯、籌碼分數較佳的股票",
    ],
    score_formula: "策略分數 = 大戶比重變化加權 + 散戶下降加分 + 籌碼集中度加分",
    sort_reason: "大戶比重增加越多、散戶比重下降越明顯，排名越前面。",
    risk_tips: [
      "TDCC 是每週資料，會落後每日行情。",
      "大戶增加不代表主力一定拉抬，也可能是長線換手。",
      "若成交量不足，後續股價反應可能較慢。",
    ],
    empty_tips: [
      "TDCC 週資料可能尚未更新。",
      "改看全部市場或延後一週再觀察。",
      "先用短線強勢股搭配確認是否有量價配合。",
    ],
  },
  {
    key: "volume_price_breakout",
    name: "量價轉強股",
    short_name: "量價轉強",
    description: "成交量放大且股價位置偏強，適合短線觀察。",
    focus: "量價",
    criteria: [
      "成交量分數達標，或狀態文字顯示量增 / 放大",
      "股價分數偏強、接近高點，或當日收盤上漲",
      "依量能、股價位置與籌碼分數排序",
    ],
    score_formula: "策略分數 = 成交量分數 + 股價位置分數 + 籌碼分數",
    sort_reason: "量能越明顯、股價位置越強、籌碼分數越高，排序越前面。",
    risk_tips: [
      "量增可能是出貨量，也可能是突破量，需要看股價是否同步轉強。",
      "短線漲幅已大時，隔日震盪可能增加。",
      "不適合只看單日成交量就直接判斷。",
    ],
    empty_tips: [
      "當天市場量能可能不足。",
      "可改看短線強勢股或法人轉強股。",
      "等收盤行情與籌碼分數更新後再查看。",
    ],
  },
  {
    key: "capital_inflow",
    name: "資金流入股",
    short_name: "資金流入",
    description: "三大法人合計買超較明顯，搭配成交金額與籌碼分數排序。",
    focus: "資金",
    criteria: [
      "三大法人合計為買超",
      "買超張數越大，排序越前面",
      "搭配成交量、成交金額與籌碼分數輔助判斷",
    ],
    score_formula: "策略分數 = 三大法人買超張數 + 籌碼分數",
    sort_reason: "資金流入越明顯、成交金額越高的股票，排名越前面。",
    risk_tips: [
      "法人買超張數大的股票，未必代表買超占成交量比例高。",
      "大型權值股容易因張數大而排前，需要搭配比例與產業題材。",
      "若連續多日上漲，短線容易遇到獲利了結。",
    ],
    empty_tips: [
      "當天法人整體偏賣超時可能沒有結果。",
      "可改看法人轉強股，條件較偏分數而非絕對張數。",
      "也可以切到上櫃觀察中小型資金流向。",
    ],
  },
  {
    key: "etf_calendar_watch",
    name: "ETF 除息觀察",
    short_name: "ETF 行事曆",
    description: "ETF 即將發生除息、收益分配或重要行事曆事件。",
    focus: "ETF",
    criteria: [
      "只篩 ETF 主檔中的商品",
      "事件日期在未來 30 天內",
      "事件類型包含除息、收益分配、股利或高重要性事件",
    ],
    score_formula: "策略分數 = 事件重要性分數 - 距離天數扣分",
    sort_reason: "事件日期越近、重要性越高，排序越前面。",
    risk_tips: [
      "ETF 除息不等於獲利，除息後淨值與價格會調整。",
      "高股息 ETF 仍需留意成分股、填息機率與整體市場風險。",
      "事件資料若來源尚未公告，可能暫時不完整。",
    ],
    empty_tips: [
      "未來 30 天內可能沒有符合條件的 ETF 事件。",
      "可改看個股行事曆或稍後重新匯入官方行事曆。",
      "確認 ETF 主檔與行事曆資料是否已更新。",
    ],
  },
  {
    key: "short_term_strong",
    name: "短線強勢股",
    short_name: "短線強勢",
    description: "籌碼分數高、股價偏強、量能不弱的短線觀察清單。",
    focus: "短線",
    criteria: [
      "籌碼分數達 80 分以上",
      "股價當日不弱，或股價位置分數偏高",
      "依籌碼分數、量能分數與股價位置分數排序",
    ],
    score_formula: "策略分數 = 籌碼分數 + 成交量分數 + 股價位置分數",
    sort_reason: "籌碼越強、量價越配合、股價位置越偏強，排名越前面。",
    risk_tips: [
      "短線強勢股通常波動較大，不適合盲目追高。",
      "若隔日量縮或跌破關鍵價位，強勢訊號可能失效。",
      "建議搭配停損、停利與大盤趨勢控管。",
    ],
    empty_tips: [
      "市場轉弱時，短線強勢股數量會明顯減少。",
      "可降低篩選市場限制或改看主力增持股。",
      "等每日籌碼分數重新計算後再查看。",
    ],
  },
];

function getStrategyDefinition(key) {
  const strategyKey = String(key || "legal_strength").trim();
  return STRATEGY_DEFINITIONS.find((item) => item.key === strategyKey) || STRATEGY_DEFINITIONS[0];
}

function normalizeStrategyKeyValue(value) {
  const key = String(value || "").trim();
  return STRATEGY_DEFINITIONS.some((item) => item.key === key) ? key : "";
}

function normalizeShortText(value, maxLength = 255) {
  const text = String(value || "").trim();
  return text ? text.slice(0, maxLength) : null;
}

function parseNullableDateValue(value) {
  const text = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function parseNullableDecimalValue(value) {
  if (value === null || value === undefined || value === "") return null;
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

async function getStrategyTrackingRows(userId, filters = {}) {
  const conditions = ["t.user_id = ?"];
  const params = [userId];
  const strategyKey = normalizeStrategyKeyValue(filters.strategy || filters.strategy_key);
  const stockCode = normalizeStockCodeValue(filters.stock_code || filters.stockCode);
  const active = filters.active ?? filters.is_active;
  const limit = parsePositiveInteger(filters.limit, 100, 1, 500);
  const offset = parsePositiveInteger(filters.offset, 0, 0, 100000);

  if (strategyKey) {
    conditions.push("t.strategy_key = ?");
    params.push(strategyKey);
  }

  if (stockCode) {
    conditions.push("t.stock_code = ?");
    params.push(stockCode);
  }

  if (active !== undefined && active !== null && active !== "") {
    conditions.push("t.is_active = ?");
    params.push(parseBooleanFlag(active, true));
  }

  const rows = await query(
    `
    SELECT
      t.id,
      t.user_id,
      t.stock_code,
      COALESCE(s.stock_name, t.stock_name, t.stock_code) AS stock_name,
      COALESCE(s.market_type, t.market_type) AS market_type,
      COALESCE(s.industry, t.industry) AS industry,
      t.strategy_key,
      t.strategy_name,
      DATE_FORMAT(t.source_trade_date, '%Y-%m-%d') AS source_trade_date,
      t.source_score,
      t.source_rank,
      t.trigger_summary,
      t.note,
      t.is_active,
      DATE_FORMAT(t.created_at, '%Y-%m-%d %H:%i:%s') AS created_at,
      DATE_FORMAT(t.updated_at, '%Y-%m-%d %H:%i:%s') AS updated_at,
      (
        SELECT p0.close_price
        FROM daily_prices p0
        WHERE p0.stock_code = t.stock_code
          AND p0.trade_date <= COALESCE(t.source_trade_date, DATE(t.created_at))
        ORDER BY p0.trade_date DESC
        LIMIT 1
      ) AS entry_price,
      DATE_FORMAT((
        SELECT p0.trade_date
        FROM daily_prices p0
        WHERE p0.stock_code = t.stock_code
          AND p0.trade_date <= COALESCE(t.source_trade_date, DATE(t.created_at))
        ORDER BY p0.trade_date DESC
        LIMIT 1
      ), '%Y-%m-%d') AS entry_price_date,
      (
        SELECT p1.close_price
        FROM daily_prices p1
        WHERE p1.stock_code = t.stock_code
          AND p1.trade_date > COALESCE(t.source_trade_date, DATE(t.created_at))
        ORDER BY p1.trade_date ASC
        LIMIT 1 OFFSET 0
      ) AS price_after_1d,
      DATE_FORMAT((
        SELECT p1.trade_date
        FROM daily_prices p1
        WHERE p1.stock_code = t.stock_code
          AND p1.trade_date > COALESCE(t.source_trade_date, DATE(t.created_at))
        ORDER BY p1.trade_date ASC
        LIMIT 1 OFFSET 0
      ), '%Y-%m-%d') AS price_after_1d_date,
      (
        SELECT p3.close_price
        FROM daily_prices p3
        WHERE p3.stock_code = t.stock_code
          AND p3.trade_date > COALESCE(t.source_trade_date, DATE(t.created_at))
        ORDER BY p3.trade_date ASC
        LIMIT 1 OFFSET 2
      ) AS price_after_3d,
      DATE_FORMAT((
        SELECT p3.trade_date
        FROM daily_prices p3
        WHERE p3.stock_code = t.stock_code
          AND p3.trade_date > COALESCE(t.source_trade_date, DATE(t.created_at))
        ORDER BY p3.trade_date ASC
        LIMIT 1 OFFSET 2
      ), '%Y-%m-%d') AS price_after_3d_date,
      (
        SELECT p5.close_price
        FROM daily_prices p5
        WHERE p5.stock_code = t.stock_code
          AND p5.trade_date > COALESCE(t.source_trade_date, DATE(t.created_at))
        ORDER BY p5.trade_date ASC
        LIMIT 1 OFFSET 4
      ) AS price_after_5d,
      DATE_FORMAT((
        SELECT p5.trade_date
        FROM daily_prices p5
        WHERE p5.stock_code = t.stock_code
          AND p5.trade_date > COALESCE(t.source_trade_date, DATE(t.created_at))
        ORDER BY p5.trade_date ASC
        LIMIT 1 OFFSET 4
      ), '%Y-%m-%d') AS price_after_5d_date,
      p.close_price,
      p.price_change,
      p.price_change_percent,
      DATE_FORMAT(p.trade_date, '%Y-%m-%d') AS latest_price_date,
      c.chip_score,
      c.foreign_status,
      c.investment_trust_status,
      c.volume_status,
      c.price_position,
      DATE_FORMAT(c.trade_date, '%Y-%m-%d') AS latest_score_date
    FROM strategy_watchlists t
    LEFT JOIN stocks s
      ON s.stock_code = t.stock_code
    LEFT JOIN daily_prices p
      ON p.stock_code = t.stock_code
     AND p.trade_date = (
       SELECT MAX(p2.trade_date)
       FROM daily_prices p2
       WHERE p2.stock_code = t.stock_code
     )
    LEFT JOIN chip_scores c
      ON c.stock_code = t.stock_code
     AND c.trade_date = (
       SELECT MAX(c2.trade_date)
       FROM chip_scores c2
       WHERE c2.stock_code = t.stock_code
     )
    WHERE ${conditions.join(" AND ")}
    ORDER BY t.is_active DESC, t.created_at DESC, t.id DESC
    LIMIT ? OFFSET ?
    `,
    [...params, limit, offset],
  );

  return rows.map(enrichStrategyTrackingPerformance);
}

const STRATEGY_TRACKING_METRICS = {
  current: {
    key: "current",
    field: "current_return_percent",
    label: "目前報酬",
    description: "最新收盤價相對加入策略追蹤時的報酬率。",
  },
  "1d": {
    key: "1d",
    field: "return_1d_percent",
    label: "1 日報酬",
    description: "加入策略追蹤後第 1 個交易日收盤價的報酬率。",
  },
  "3d": {
    key: "3d",
    field: "return_3d_percent",
    label: "3 日報酬",
    description: "加入策略追蹤後第 3 個交易日收盤價的報酬率。",
  },
  "5d": {
    key: "5d",
    field: "return_5d_percent",
    label: "5 日報酬",
    description: "加入策略追蹤後第 5 個交易日收盤價的報酬率。",
  },
};

function getStrategyTrackingMetric(metric) {
  const key = String(metric || "current").trim().toLowerCase();
  return STRATEGY_TRACKING_METRICS[key] || STRATEGY_TRACKING_METRICS.current;
}

function calculateReturnPercent(entryPrice, targetPrice) {
  const entry = Number(entryPrice);
  const target = Number(targetPrice);

  if (!Number.isFinite(entry) || !Number.isFinite(target) || entry <= 0) {
    return null;
  }

  return Number((((target - entry) / entry) * 100).toFixed(4));
}

function getPerformanceStatus(returnPercent) {
  const value = Number(returnPercent);

  if (!Number.isFinite(value)) return "等待資料";
  if (value >= 3) return "轉強";
  if (value <= -3) return "轉弱";
  return "觀察中";
}

function enrichStrategyTrackingPerformance(row) {
  const entryPrice = Number(row.entry_price);
  const currentPrice = Number(row.close_price);
  const return1d = calculateReturnPercent(entryPrice, row.price_after_1d);
  const return3d = calculateReturnPercent(entryPrice, row.price_after_3d);
  const return5d = calculateReturnPercent(entryPrice, row.price_after_5d);
  const currentReturn = calculateReturnPercent(entryPrice, currentPrice);

  return {
    ...row,
    entry_price: Number.isFinite(entryPrice) ? Number(entryPrice.toFixed(4)) : null,
    current_price: Number.isFinite(currentPrice) ? Number(currentPrice.toFixed(4)) : null,
    return_1d_percent: return1d,
    return_3d_percent: return3d,
    return_5d_percent: return5d,
    current_return_percent: currentReturn,
    performance_status: getPerformanceStatus(currentReturn),
  };
}

function buildStrategyTrackingPerformanceSummary(rows, metric = "current") {
  const metricInfo = getStrategyTrackingMetric(metric);
  const field = metricInfo.field;
  const availableRows = rows.filter((row) => Number.isFinite(Number(row[field])));
  const positiveRows = availableRows.filter((row) => Number(row[field]) > 0);
  const negativeRows = availableRows.filter((row) => Number(row[field]) < 0);
  const totalReturn = availableRows.reduce((sum, row) => sum + Number(row[field]), 0);
  const sorted = [...availableRows].sort((a, b) => Number(b[field]) - Number(a[field]));

  const byStrategyMap = new Map();
  for (const row of rows) {
    const key = row.strategy_key || "unknown";
    const value = Number(row[field]);

    if (!byStrategyMap.has(key)) {
      byStrategyMap.set(key, {
        strategy_key: key,
        strategy_name: row.strategy_name || key,
        total_count: 0,
        available_count: 0,
        positive_count: 0,
        negative_count: 0,
        total_return: 0,
        best_stock_code: null,
        best_stock_name: null,
        best_return: null,
      });
    }

    const item = byStrategyMap.get(key);
    item.total_count += 1;

    if (Number.isFinite(value)) {
      item.available_count += 1;
      item.total_return += value;
      if (value > 0) item.positive_count += 1;
      if (value < 0) item.negative_count += 1;
      if (item.best_return === null || value > item.best_return) {
        item.best_return = value;
        item.best_stock_code = row.stock_code;
        item.best_stock_name = row.stock_name;
      }
    }
  }

  const byStrategy = [...byStrategyMap.values()].map((item) => ({
    strategy_key: item.strategy_key,
    strategy_name: item.strategy_name,
    total_count: item.total_count,
    available_count: item.available_count,
    positive_count: item.positive_count,
    negative_count: item.negative_count,
    pending_count: item.total_count - item.available_count,
    avg_return: item.available_count > 0 ? Number((item.total_return / item.available_count).toFixed(4)) : null,
    win_rate: item.available_count > 0 ? Number(((item.positive_count / item.available_count) * 100).toFixed(2)) : null,
    best_stock_code: item.best_stock_code,
    best_stock_name: item.best_stock_name,
    best_return: item.best_return,
  })).sort((a, b) => {
    const aValue = Number.isFinite(Number(a.avg_return)) ? Number(a.avg_return) : -999999;
    const bValue = Number.isFinite(Number(b.avg_return)) ? Number(b.avg_return) : -999999;
    return bValue - aValue;
  });

  return {
    metric: metricInfo.key,
    metric_label: metricInfo.label,
    metric_description: metricInfo.description,
    total_count: rows.length,
    available_count: availableRows.length,
    pending_count: rows.length - availableRows.length,
    positive_count: positiveRows.length,
    negative_count: negativeRows.length,
    avg_return: availableRows.length > 0 ? Number((totalReturn / availableRows.length).toFixed(4)) : null,
    win_rate: availableRows.length > 0 ? Number(((positiveRows.length / availableRows.length) * 100).toFixed(2)) : null,
    best_return: sorted[0] ? Number(Number(sorted[0][field]).toFixed(4)) : null,
    worst_return: sorted[sorted.length - 1] ? Number(Number(sorted[sorted.length - 1][field]).toFixed(4)) : null,
    best_stock: sorted[0] || null,
    worst_stock: sorted[sorted.length - 1] || null,
    by_strategy: byStrategy,
  };
}

function buildStrategyTrackingRankings(rows, metric = "current", limit = 10) {
  const metricInfo = getStrategyTrackingMetric(metric);
  const field = metricInfo.field;
  const availableRows = rows.filter((row) => Number.isFinite(Number(row[field])));
  const sortedDesc = [...availableRows].sort((a, b) => Number(b[field]) - Number(a[field]));
  const sortedAsc = [...availableRows].sort((a, b) => Number(a[field]) - Number(b[field]));

  return {
    metric: metricInfo.key,
    metric_label: metricInfo.label,
    best_stocks: sortedDesc.slice(0, limit),
    weakest_stocks: sortedAsc.slice(0, limit),
    strategy_rankings: buildStrategyTrackingPerformanceSummary(rows, metricInfo.key).by_strategy,
  };
}


function toStrategyNumber(value, fallback = 0) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : fallback;
}

function formatStrategyPercent(value) {
  const numberValue = toStrategyNumber(value, null);
  if (numberValue === null) return "-";
  return `${numberValue.toLocaleString("zh-TW", { maximumFractionDigits: 2 })}%`;
}

function formatStrategyLots(value) {
  const numberValue = toStrategyNumber(value, null);
  if (numberValue === null) return "-";
  return `${numberValue.toLocaleString("zh-TW", { maximumFractionDigits: 0 })} 張`;
}

function buildScorePart(label, value, max, description) {
  const numberValue = toStrategyNumber(value, 0);
  const numberMax = Math.max(toStrategyNumber(max, 100), 1);
  const percent = Math.min(Math.max((numberValue / numberMax) * 100, 0), 100);
  let tone = "normal";

  if (percent >= 75) tone = "strong";
  else if (percent >= 45) tone = "medium";
  else tone = "weak";

  return {
    label,
    value: Number(numberValue.toFixed(2)),
    max: numberMax,
    percent: Number(percent.toFixed(2)),
    tone,
    description,
  };
}

function getStrategyScoreBreakdown(row, strategyKey) {
  if (strategyKey === "legal_strength") {
    return [
      buildScorePart("外資分數", row.foreign_score, 15, "外資買賣超與連續性帶來的分數。"),
      buildScorePart("投信分數", row.investment_trust_score, 15, "投信買賣超與連續性帶來的分數。"),
      buildScorePart("籌碼分數", row.chip_score, 100, "整體籌碼、成交量與股價位置的綜合分數。"),
    ];
  }

  if (strategyKey === "major_holder_accumulate") {
    return [
      buildScorePart("大戶增加", Math.max(toStrategyNumber(row.large_holder_ratio_change, 0) * 20, 0), 30, "400 張以上大戶持股比例增加幅度。"),
      buildScorePart("散戶下降", Math.max(Math.abs(Math.min(toStrategyNumber(row.small_holder_ratio_change, 0), 0)) * 12, 0), 20, "散戶比例下降越明顯，籌碼集中度越佳。"),
      buildScorePart("大戶分數", row.big_holder_score || row.major_holder_score || row.strategy_score, 20, "籌碼分數系統中的大戶籌碼分項。"),
    ];
  }

  if (strategyKey === "volume_price_breakout") {
    return [
      buildScorePart("成交量分數", row.volume_score, 20, "量能放大與成交量狀態。"),
      buildScorePart("股價位置分數", row.price_score, 15, "股價相對近期區間的位置。"),
      buildScorePart("籌碼分數", row.chip_score, 100, "整體籌碼條件。"),
    ];
  }

  if (strategyKey === "capital_inflow") {
    return [
      buildScorePart("法人買超", Math.max(toStrategyNumber(row.total_net_lots, 0) / 100, 0), 100, "三大法人合計買超張數換算的資金力道。"),
      buildScorePart("籌碼分數", row.chip_score, 100, "整體籌碼條件。"),
      buildScorePart("成交金額", Math.max(toStrategyNumber(row.transaction_amount, 0) / 100000000, 0), 100, "成交金額越高，資金進出參考性越高。"),
    ];
  }

  if (strategyKey === "etf_calendar_watch") {
    const daysLeft = toStrategyNumber(row.days_left, 30);
    const importanceScore = String(row.importance || "").toLowerCase() === "high" ? 100 : 70;
    return [
      buildScorePart("事件重要性", importanceScore, 100, "高重要性事件優先觀察。"),
      buildScorePart("日期接近度", Math.max(30 - daysLeft, 0), 30, "事件越接近，分數越高。"),
      buildScorePart("觀察分數", row.strategy_score, 100, "綜合事件重要性與距離天數。"),
    ];
  }

  return [
    buildScorePart("籌碼分數", row.chip_score, 100, "整體籌碼條件。"),
    buildScorePart("成交量分數", row.volume_score, 20, "短線量能配合程度。"),
    buildScorePart("股價位置分數", row.price_score, 15, "股價位置偏強程度。"),
  ];
}

function getStrategyReasons(row, strategyKey) {
  const reasons = [];

  if (strategyKey === "legal_strength") {
    if (toStrategyNumber(row.foreign_net_lots, 0) > 0) reasons.push(`外資買超 ${formatStrategyLots(row.foreign_net_lots)}。`);
    if (toStrategyNumber(row.investment_trust_net_lots, 0) > 0) reasons.push(`投信買超 ${formatStrategyLots(row.investment_trust_net_lots)}。`);
    if (toStrategyNumber(row.chip_score, 0) >= 70) reasons.push(`籌碼分數 ${row.chip_score} 分，達策略基本門檻。`);
  }

  if (strategyKey === "major_holder_accumulate") {
    reasons.push(`大戶比重增加 ${formatStrategyPercent(row.large_holder_ratio_change)}。`);
    if (toStrategyNumber(row.small_holder_ratio_change, 0) < 0) reasons.push(`散戶比重下降 ${formatStrategyPercent(Math.abs(toStrategyNumber(row.small_holder_ratio_change, 0)))}。`);
    if (row.big_holder_status) reasons.push(`大戶狀態：${row.big_holder_status}。`);
  }

  if (strategyKey === "volume_price_breakout") {
    if (row.volume_status) reasons.push(`成交量狀態：${row.volume_status}。`);
    if (row.price_position) reasons.push(`股價位置：${row.price_position}。`);
    if (toStrategyNumber(row.price_change, 0) > 0) reasons.push(`當日收盤上漲 ${row.price_change}。`);
  }

  if (strategyKey === "capital_inflow") {
    reasons.push(`三大法人合計買超 ${formatStrategyLots(row.total_net_lots)}。`);
    if (toStrategyNumber(row.foreign_net_lots, 0) > 0) reasons.push(`其中外資買超 ${formatStrategyLots(row.foreign_net_lots)}。`);
    if (toStrategyNumber(row.investment_trust_net_lots, 0) > 0) reasons.push(`其中投信買超 ${formatStrategyLots(row.investment_trust_net_lots)}。`);
  }

  if (strategyKey === "etf_calendar_watch") {
    reasons.push(`${row.days_left ?? "-"} 天後有 ${row.event_type || "行事曆"} 事件。`);
    if (row.title) reasons.push(`事件：${row.title}。`);
    if (row.importance) reasons.push(`重要性：${row.importance}。`);
  }

  if (strategyKey === "short_term_strong") {
    reasons.push(`籌碼分數 ${row.chip_score ?? "-"} 分。`);
    if (row.volume_status) reasons.push(`成交量狀態：${row.volume_status}。`);
    if (row.price_position) reasons.push(`股價位置：${row.price_position}。`);
  }

  if (reasons.length === 0 && row.trigger_summary) {
    reasons.push(String(row.trigger_summary));
  }

  return reasons.slice(0, 5);
}

function getStrategyRiskFlags(row, strategyKey, definition) {
  const riskFlags = [];
  const priceChange = toStrategyNumber(row.price_change, null);
  const chipScore = toStrategyNumber(row.chip_score, null);

  if (priceChange !== null && priceChange < 0 && strategyKey !== "etf_calendar_watch") {
    riskFlags.push("股價當日仍收跌，需確認是否只是資金短線進出。");
  }

  if (chipScore !== null && chipScore < 60 && !["capital_inflow", "etf_calendar_watch"].includes(strategyKey)) {
    riskFlags.push("籌碼分數未達 60 分，訊號強度較弱。");
  }

  if (strategyKey === "etf_calendar_watch") {
    riskFlags.push("ETF 除息會有價格與淨值調整，不等於直接獲利。");
  }

  if (riskFlags.length === 0 && Array.isArray(definition.risk_tips)) {
    riskFlags.push(definition.risk_tips[0]);
  }

  return riskFlags.slice(0, 3);
}

function enrichStrategyRow(row, strategy, rank) {
  const strategyKey = strategy.key;
  const scoreBreakdown = getStrategyScoreBreakdown(row, strategyKey);
  const reasons = getStrategyReasons(row, strategyKey);
  const riskFlags = getStrategyRiskFlags(row, strategyKey, strategy);
  const strategyScore = toStrategyNumber(row.strategy_score ?? row.chip_score ?? row.major_holder_score, 0);
  let interpretation = "符合策略條件，可加入觀察清單。";

  if (strategyScore >= 120 || toStrategyNumber(row.chip_score, 0) >= 85) {
    interpretation = "訊號偏強，適合優先觀察，但仍需搭配價格位置與風險控管。";
  } else if (strategyScore >= 80 || toStrategyNumber(row.chip_score, 0) >= 70) {
    interpretation = "條件達標，可列入一般觀察，等待後續量價與籌碼確認。";
  }

  return {
    rank,
    ...row,
    strategy_definition: {
      key: strategy.key,
      name: strategy.name,
      criteria: strategy.criteria,
      score_formula: strategy.score_formula,
      sort_reason: strategy.sort_reason,
      risk_tips: strategy.risk_tips,
    },
    score_breakdown: scoreBreakdown,
    match_reasons: reasons,
    risk_flags: riskFlags,
    strategy_interpretation: interpretation,
    sort_reason: strategy.sort_reason,
  };
}

async function getLatestTradeDateFrom(tableName, dateColumn, market = null, queryDate = null) {
  const allowedTables = new Set(["chip_scores", "institutional_trades", "daily_prices", "major_holder_stats"]);
  const allowedColumns = new Set(["trade_date", "data_date"]);

  if (!allowedTables.has(tableName) || !allowedColumns.has(dateColumn)) {
    throw new Error("策略日期來源設定錯誤");
  }

  const alias = tableName === "major_holder_stats" ? "m" : "t";
  const params = [];
  const conditions = [];
  let joinSql = "";

  if (queryDate) {
    conditions.push(`${alias}.${dateColumn} <= ?`);
    params.push(queryDate);
  }

  if (market) {
    joinSql = `LEFT JOIN stocks s ON s.stock_code = ${alias}.stock_code`;
    conditions.push("s.market_type = ?");
    params.push(market);
  }

  const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const rows = await query(
    `
    SELECT DATE_FORMAT(MAX(${alias}.${dateColumn}), '%Y-%m-%d') AS latest_date
    FROM ${tableName} ${alias}
    ${joinSql}
    ${whereSql}
    `,
    params,
  );

  return rows[0]?.latest_date || null;
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
    const stockCode = req.params.stockCode;

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
      return res.status(404).json({
        success: false,
        message: "Stock not found",
      });
    }

    res.json({
      success: true,
      data: convertBigIntToString(rows[0]),
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

// ==============================
// V1.3-2-2 策略說明與分數拆解
// GET /strategies/definitions?strategy=legal_strength
// ==============================
app.get("/strategies/definitions", async (req, res) => {
  try {
    const requestedStrategy = String(req.query.strategy || "").trim();
    const data = requestedStrategy
      ? [getStrategyDefinition(requestedStrategy)]
      : STRATEGY_DEFINITIONS;

    res.json({
      success: true,
      count: data.length,
      data,
    });
  } catch (error) {
    console.error("查詢策略說明失敗：", error);
    res.status(500).json({
      success: false,
      message: "查詢策略說明失敗",
      error: error.message,
    });
  }
});

// ==============================
// V1.3-2-1 選股策略清單
// V1.3-2-2 增加策略說明、分數拆解、選出原因、風險提示
// GET /strategies?strategy=legal_strength&market=上市&limit=30&date=YYYY-MM-DD
// ==============================
app.get("/strategies", async (req, res) => {
  try {
    const strategy = getStrategyDefinition(req.query.strategy);
    const limit = parseLimit(req.query.limit, 30, 100);
    const market = parseMarket(req.query.market);
    const queryDate = req.query.date || null;

    if (queryDate && !isValidDateText(queryDate)) {
      return res.status(400).json({
        success: false,
        message: "date 格式錯誤，請使用 YYYY-MM-DD",
      });
    }

    let targetDate = null;
    let referenceDate = null;
    let rows = [];
    const params = [];
    let marketCondition = "";

    if (strategy.key === "legal_strength") {
      targetDate = await getLatestTradeDateFrom("chip_scores", "trade_date", market, queryDate);

      if (targetDate) {
        params.push(targetDate);
        if (market) {
          marketCondition = "AND s.market_type = ?";
          params.push(market);
        }
        params.push(limit);

        rows = await query(
          `
          SELECT
            DATE_FORMAT(c.trade_date, '%Y-%m-%d') AS trade_date,
            c.stock_code,
            s.stock_name,
            s.market_type,
            s.industry,
            'legal_strength' AS strategy_key,
            '法人轉強股' AS strategy_name,
            c.chip_score,
            c.foreign_score,
            c.investment_trust_score,
            c.foreign_status,
            c.investment_trust_status,
            c.volume_status,
            c.price_position,
            p.close_price,
            p.price_change,
            CAST(p.volume AS CHAR) AS volume,
            CAST(i.foreign_net AS CHAR) AS foreign_net,
            CAST(i.investment_trust_net AS CHAR) AS investment_trust_net,
            CAST(i.total_net AS CHAR) AS total_net,
            CAST(ROUND(COALESCE(i.foreign_net, 0) / 1000, 0) AS CHAR) AS foreign_net_lots,
            CAST(ROUND(COALESCE(i.investment_trust_net, 0) / 1000, 0) AS CHAR) AS investment_trust_net_lots,
            CAST(ROUND(COALESCE(i.total_net, 0) / 1000, 0) AS CHAR) AS total_net_lots,
            (c.foreign_score + c.investment_trust_score + c.chip_score) AS strategy_score,
            CONCAT('法人分數 ', c.foreign_score + c.investment_trust_score, '，籌碼分數 ', c.chip_score) AS trigger_summary
          FROM chip_scores c
          LEFT JOIN stocks s
            ON s.stock_code = c.stock_code
          LEFT JOIN institutional_trades i
            ON i.stock_code = c.stock_code
           AND i.trade_date = c.trade_date
          LEFT JOIN daily_prices p
            ON p.stock_code = c.stock_code
           AND p.trade_date = c.trade_date
          WHERE c.trade_date = ?
            ${marketCondition}
            AND s.is_active = 1
            AND (COALESCE(i.foreign_net, 0) > 0 OR COALESCE(i.investment_trust_net, 0) > 0)
            AND (c.chip_score >= 70 OR (c.foreign_score + c.investment_trust_score) >= 20)
          ORDER BY strategy_score DESC, COALESCE(i.foreign_net, 0) + COALESCE(i.investment_trust_net, 0) DESC, c.stock_code ASC
          LIMIT ?
          `,
          params,
        );
      }
    }

    if (strategy.key === "major_holder_accumulate") {
      targetDate = await getLatestTradeDateFrom("major_holder_stats", "data_date", market, queryDate);
      referenceDate = await getLatestTradeDateFrom("daily_prices", "trade_date", market, queryDate);

      if (targetDate) {
        const latestTradeDate = referenceDate || targetDate;
        params.push(latestTradeDate, latestTradeDate, targetDate);
        if (market) {
          marketCondition = "AND s.market_type = ?";
          params.push(market);
        }

        const rawRows = await query(
          `
          SELECT
            DATE_FORMAT(m.data_date, '%Y-%m-%d') AS data_date,
            DATE_FORMAT(dp.trade_date, '%Y-%m-%d') AS trade_date,
            m.stock_code,
            s.stock_name,
            s.market_type,
            s.industry,
            'major_holder_accumulate' AS strategy_key,
            '主力增持股' AS strategy_name,
            m.large_holder_count,
            CAST(m.large_holder_share_count AS CHAR) AS large_holder_share_count,
            m.large_holder_ratio,
            m.small_holder_ratio,
            m.thousand_lot_ratio,
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
            ON s.stock_code = m.stock_code
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
            AND prev.id IS NOT NULL
            AND (m.large_holder_ratio - COALESCE(prev.large_holder_ratio, m.large_holder_ratio)) > 0
          `,
          params,
        );

        rows = rawRows
          .map((row) => {
            const enriched = enrichMajorHolderRow(row);
            return {
              ...enriched,
              strategy_key: strategy.key,
              strategy_name: strategy.name,
              strategy_score: enriched.major_holder_score,
              trigger_summary: `大戶比重增加 ${toPlainNumber(enriched.large_holder_ratio_change).toLocaleString("zh-TW", { maximumFractionDigits: 2 })}%`,
            };
          })
          .sort((a, b) => {
            if (b.strategy_score !== a.strategy_score) return b.strategy_score - a.strategy_score;
            return toPlainNumber(b.large_holder_ratio_change) - toPlainNumber(a.large_holder_ratio_change);
          })
          .slice(0, limit);
      }
    }

    if (strategy.key === "volume_price_breakout") {
      targetDate = await getLatestTradeDateFrom("chip_scores", "trade_date", market, queryDate);

      if (targetDate) {
        params.push(targetDate);
        if (market) {
          marketCondition = "AND s.market_type = ?";
          params.push(market);
        }
        params.push(limit);

        rows = await query(
          `
          SELECT
            DATE_FORMAT(c.trade_date, '%Y-%m-%d') AS trade_date,
            c.stock_code,
            s.stock_name,
            s.market_type,
            s.industry,
            'volume_price_breakout' AS strategy_key,
            '量價轉強股' AS strategy_name,
            c.chip_score,
            c.volume_score,
            c.price_score,
            c.volume_status,
            c.price_position,
            c.foreign_status,
            c.investment_trust_status,
            p.close_price,
            p.price_change,
            p.price_change_percent,
            CAST(p.volume AS CHAR) AS volume,
            CAST(p.transaction_amount AS CHAR) AS transaction_amount,
            (c.volume_score + c.price_score + c.chip_score) AS strategy_score,
            CONCAT(c.volume_status, '，', c.price_position) AS trigger_summary
          FROM chip_scores c
          LEFT JOIN stocks s
            ON s.stock_code = c.stock_code
          LEFT JOIN daily_prices p
            ON p.stock_code = c.stock_code
           AND p.trade_date = c.trade_date
          WHERE c.trade_date = ?
            ${marketCondition}
            AND s.is_active = 1
            AND (c.volume_score >= 12 OR c.volume_status LIKE '%量增%' OR c.volume_status LIKE '%放大%')
            AND (c.price_score >= 8 OR c.price_position LIKE '%高點%' OR COALESCE(p.price_change, 0) > 0)
          ORDER BY strategy_score DESC, COALESCE(p.volume, 0) DESC, c.stock_code ASC
          LIMIT ?
          `,
          params,
        );
      }
    }

    if (strategy.key === "capital_inflow") {
      targetDate = await getLatestTradeDateFrom("institutional_trades", "trade_date", market, queryDate);

      if (targetDate) {
        params.push(targetDate);
        if (market) {
          marketCondition = "AND s.market_type = ?";
          params.push(market);
        }
        params.push(limit);

        rows = await query(
          `
          SELECT
            DATE_FORMAT(i.trade_date, '%Y-%m-%d') AS trade_date,
            i.stock_code,
            s.stock_name,
            s.market_type,
            s.industry,
            'capital_inflow' AS strategy_key,
            '資金流入股' AS strategy_name,
            CAST(i.foreign_net AS CHAR) AS foreign_net,
            CAST(i.investment_trust_net AS CHAR) AS investment_trust_net,
            CAST(i.dealer_net AS CHAR) AS dealer_net,
            CAST(i.total_net AS CHAR) AS total_net,
            CAST(ROUND(i.foreign_net / 1000, 0) AS CHAR) AS foreign_net_lots,
            CAST(ROUND(i.investment_trust_net / 1000, 0) AS CHAR) AS investment_trust_net_lots,
            CAST(ROUND(i.dealer_net / 1000, 0) AS CHAR) AS dealer_net_lots,
            CAST(ROUND(i.total_net / 1000, 0) AS CHAR) AS total_net_lots,
            p.close_price,
            p.price_change,
            CAST(p.volume AS CHAR) AS volume,
            CAST(p.transaction_amount AS CHAR) AS transaction_amount,
            c.chip_score,
            c.foreign_status,
            c.investment_trust_status,
            c.volume_status,
            (COALESCE(i.total_net, 0) / 1000 + COALESCE(c.chip_score, 0)) AS strategy_score,
            CONCAT('三大法人合計買超 ', ROUND(i.total_net / 1000, 0), ' 張') AS trigger_summary
          FROM institutional_trades i
          LEFT JOIN stocks s
            ON s.stock_code = i.stock_code
          LEFT JOIN daily_prices p
            ON p.stock_code = i.stock_code
           AND p.trade_date = i.trade_date
          LEFT JOIN chip_scores c
            ON c.stock_code = i.stock_code
           AND c.trade_date = i.trade_date
          WHERE i.trade_date = ?
            ${marketCondition}
            AND s.is_active = 1
            AND COALESCE(i.total_net, 0) > 0
          ORDER BY COALESCE(i.total_net, 0) DESC, COALESCE(p.transaction_amount, 0) DESC, i.stock_code ASC
          LIMIT ?
          `,
          params,
        );
      }
    }

    if (strategy.key === "etf_calendar_watch") {
      if (queryDate) {
        targetDate = queryDate;
      } else {
        const dateRows = await query(`SELECT DATE_FORMAT(CURDATE(), '%Y-%m-%d') AS today`);
        targetDate = dateRows[0]?.today || null;
      }

      if (targetDate) {
        params.push(targetDate, targetDate);
        if (market) {
          marketCondition = "AND ep.market_type = ?";
          params.push(market);
        }
        params.push(limit);

        rows = await query(
          `
          SELECT
            DATE_FORMAT(e.event_date, '%Y-%m-%d') AS event_date,
            e.stock_code,
            ep.stock_name,
            ep.market_type,
            ep.fund_type,
            ep.issuer,
            ep.underlying_index,
            'etf_calendar_watch' AS strategy_key,
            'ETF 除息觀察' AS strategy_name,
            e.event_type,
            e.title,
            e.importance,
            DATEDIFF(e.event_date, ?) AS days_left,
            CASE WHEN e.importance = 'high' THEN 100 ELSE 70 END - LEAST(GREATEST(DATEDIFF(e.event_date, ?), 0), 30) AS strategy_score,
            CONCAT(DATEDIFF(e.event_date, ?), ' 天後：', e.event_type) AS trigger_summary
          FROM stock_calendar_events e
          INNER JOIN etf_profiles ep
            ON ep.stock_code = e.stock_code
          WHERE e.is_active = 1
            AND e.event_date >= ?
            AND e.event_date <= DATE_ADD(?, INTERVAL 30 DAY)
            ${marketCondition}
            AND (e.event_type LIKE '%除息%' OR e.event_type LIKE '%收益%' OR e.event_type LIKE '%股利%' OR e.importance = 'high')
          ORDER BY e.event_date ASC, strategy_score DESC, e.stock_code ASC
          LIMIT ?
          `,
          [targetDate, targetDate, targetDate, targetDate, targetDate, ...(market ? [market] : []), limit],
        );
      }
    }

    if (strategy.key === "short_term_strong") {
      targetDate = await getLatestTradeDateFrom("chip_scores", "trade_date", market, queryDate);

      if (targetDate) {
        params.push(targetDate);
        if (market) {
          marketCondition = "AND s.market_type = ?";
          params.push(market);
        }
        params.push(limit);

        rows = await query(
          `
          SELECT
            DATE_FORMAT(c.trade_date, '%Y-%m-%d') AS trade_date,
            c.stock_code,
            s.stock_name,
            s.market_type,
            s.industry,
            'short_term_strong' AS strategy_key,
            '短線強勢股' AS strategy_name,
            c.chip_score,
            c.foreign_score,
            c.investment_trust_score,
            c.volume_score,
            c.price_score,
            c.foreign_status,
            c.investment_trust_status,
            c.volume_status,
            c.price_position,
            p.close_price,
            p.price_change,
            p.price_change_percent,
            CAST(p.volume AS CHAR) AS volume,
            (c.chip_score + c.volume_score + c.price_score) AS strategy_score,
            CONCAT('籌碼 ', c.chip_score, ' 分，', c.volume_status, '，', c.price_position) AS trigger_summary
          FROM chip_scores c
          LEFT JOIN stocks s
            ON s.stock_code = c.stock_code
          LEFT JOIN daily_prices p
            ON p.stock_code = c.stock_code
           AND p.trade_date = c.trade_date
          WHERE c.trade_date = ?
            ${marketCondition}
            AND s.is_active = 1
            AND c.chip_score >= 80
            AND (COALESCE(p.price_change, 0) >= 0 OR c.price_score >= 10)
          ORDER BY strategy_score DESC, c.chip_score DESC, c.stock_code ASC
          LIMIT ?
          `,
          params,
        );
      }
    }

    const data = rows.map((row, index) => enrichStrategyRow(row, strategy, index + 1));

    res.json({
      success: true,
      strategy: strategy.key,
      strategy_name: strategy.name,
      strategy_description: strategy.description,
      strategy_definition: strategy,
      trade_date: targetDate,
      reference_date: referenceDate || targetDate,
      market: market || "全部",
      limit,
      count: data.length,
      strategies: STRATEGY_DEFINITIONS,
      data: convertBigIntToString(data),
    });
  } catch (error) {
    console.error("查詢選股策略失敗：", error);

    res.status(500).json({
      success: false,
      message: "查詢選股策略失敗",
      error: error.message,
    });
  }
});



// ==============================
// V1.3-2-5：策略追蹤績效排行榜
// GET /strategy-watchlist/rankings?metric=current&limit=10
// ==============================
app.get("/strategy-watchlist/rankings", requireAuth, async (req, res) => {
  try {
    const metric = getStrategyTrackingMetric(req.query.metric).key;
    const rankingLimit = parsePositiveInteger(req.query.limit, 10, 1, 50);
    const rows = await getStrategyTrackingRows(req.user.id, {
      strategy: req.query.strategy,
      stock_code: req.query.stock_code,
      active: req.query.active ?? 1,
      limit: parsePositiveInteger(req.query.source_limit, 500, 1, 500),
      offset: 0,
    });
    const summary = buildStrategyTrackingPerformanceSummary(rows, metric);
    const rankings = buildStrategyTrackingRankings(rows, metric, rankingLimit);

    res.json({
      success: true,
      metric: rankings.metric,
      metric_label: rankings.metric_label,
      count: rows.length,
      summary: convertBigIntToString(summary),
      data: convertBigIntToString({
        best_stocks: rankings.best_stocks,
        weakest_stocks: rankings.weakest_stocks,
        strategy_rankings: rankings.strategy_rankings,
      }),
    });
  } catch (error) {
    console.error("查詢策略追蹤績效排行榜失敗：", error);

    res.status(500).json({
      success: false,
      message: "查詢策略追蹤績效排行榜失敗",
      error: error.message,
    });
  }
});

// ==============================
// V1.3-2-4 / V1.3-2-5：策略追蹤後續表現
// GET /strategy-watchlist/performance?metric=current&active=1
// ==============================
app.get("/strategy-watchlist/performance", requireAuth, async (req, res) => {
  try {
    const metric = getStrategyTrackingMetric(req.query.metric).key;
    const rows = await getStrategyTrackingRows(req.user.id, {
      strategy: req.query.strategy,
      stock_code: req.query.stock_code,
      active: req.query.active ?? 1,
      limit: parsePositiveInteger(req.query.limit, 100, 1, 500),
      offset: parsePositiveInteger(req.query.offset, 0, 0, 100000),
    });

    res.json({
      success: true,
      count: rows.length,
      metric,
      summary: convertBigIntToString(buildStrategyTrackingPerformanceSummary(rows, metric)),
      rankings: convertBigIntToString(buildStrategyTrackingRankings(rows, metric, 10)),
      data: convertBigIntToString(rows),
    });
  } catch (error) {
    console.error("查詢策略追蹤後續表現失敗：", error);

    res.status(500).json({
      success: false,
      message: "查詢策略追蹤後續表現失敗",
      error: error.message,
    });
  }
});

// ==============================
// V1.3-2-3：策略追蹤清單
// GET /strategy-watchlist?strategy=legal_strength&active=1
// ==============================
app.get("/strategy-watchlist", requireAuth, async (req, res) => {
  try {
    const rows = await getStrategyTrackingRows(req.user.id, req.query);
    const summaryRows = await query(
      `
      SELECT
        COUNT(*) AS total_count,
        SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) AS active_count,
        SUM(CASE WHEN is_active = 0 THEN 1 ELSE 0 END) AS inactive_count
      FROM strategy_watchlists
      WHERE user_id = ?
      `,
      [req.user.id],
    );
    const strategyRows = await query(
      `
      SELECT strategy_key, strategy_name, COUNT(*) AS count
      FROM strategy_watchlists
      WHERE user_id = ?
        AND is_active = 1
      GROUP BY strategy_key, strategy_name
      ORDER BY count DESC, strategy_key ASC
      `,
      [req.user.id],
    );

    res.json({
      success: true,
      count: rows.length,
      summary: convertBigIntToString({
        total_count: Number(summaryRows[0]?.total_count || 0),
        active_count: Number(summaryRows[0]?.active_count || 0),
        inactive_count: Number(summaryRows[0]?.inactive_count || 0),
        by_strategy: strategyRows.map((row) => ({
          strategy_key: row.strategy_key,
          strategy_name: row.strategy_name,
          count: Number(row.count || 0),
        })),
        performance: buildStrategyTrackingPerformanceSummary(rows, "current"),
      }),
      data: convertBigIntToString(rows),
    });
  } catch (error) {
    console.error("查詢策略追蹤清單失敗：", error);

    res.status(500).json({
      success: false,
      message: "查詢策略追蹤清單失敗，請確認是否已執行 npm run strategy-watchlists:setup。",
      error: error.message,
    });
  }
});

// ==============================
// V1.3-2-3：新增 / 更新策略追蹤
// POST /strategy-watchlist
// ==============================
app.post("/strategy-watchlist", requireAuth, async (req, res) => {
  try {
    const stockCode = normalizeStockCodeValue(req.body?.stock_code);
    const strategyKey = normalizeStrategyKeyValue(req.body?.strategy_key);

    if (!stockCode || !isValidStockCodeValue(stockCode)) {
      return res.status(400).json({
        success: false,
        message: "股票代號格式不正確。",
      });
    }

    if (!strategyKey) {
      return res.status(400).json({
        success: false,
        message: "策略代號格式不正確。",
      });
    }

    const strategy = getStrategyDefinition(strategyKey);
    const stockRows = await query(
      `
      SELECT stock_code, stock_name, market_type, industry
      FROM stocks
      WHERE stock_code = ?
      LIMIT 1
      `,
      [stockCode],
    );
    const stock = stockRows[0] || {};
    const stockName = normalizeShortText(req.body?.stock_name || stock.stock_name || stockCode, 100);
    const marketType = normalizeShortText(req.body?.market_type || stock.market_type, 20);
    const industry = normalizeShortText(req.body?.industry || stock.industry, 100);
    const sourceTradeDate = parseNullableDateValue(req.body?.source_trade_date || req.body?.trade_date || req.body?.event_date);
    const sourceScore = parseNullableDecimalValue(req.body?.source_score || req.body?.strategy_score || req.body?.chip_score);
    const sourceRank = parsePositiveInteger(req.body?.source_rank || req.body?.rank, null, 1, 100000);
    const triggerSummary = normalizeShortText(req.body?.trigger_summary || req.body?.title || req.body?.message, 500);
    const note = normalizeShortText(req.body?.note, 255);

    await query(
      `
      INSERT INTO strategy_watchlists (
        user_id,
        stock_code,
        stock_name,
        market_type,
        industry,
        strategy_key,
        strategy_name,
        source_trade_date,
        source_score,
        source_rank,
        trigger_summary,
        note,
        is_active
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
      ON DUPLICATE KEY UPDATE
        stock_name = VALUES(stock_name),
        market_type = VALUES(market_type),
        industry = VALUES(industry),
        strategy_name = VALUES(strategy_name),
        source_trade_date = VALUES(source_trade_date),
        source_score = VALUES(source_score),
        source_rank = VALUES(source_rank),
        trigger_summary = VALUES(trigger_summary),
        note = COALESCE(VALUES(note), note),
        is_active = 1,
        updated_at = CURRENT_TIMESTAMP
      `,
      [
        req.user.id,
        stockCode,
        stockName,
        marketType,
        industry,
        strategy.key,
        strategy.name,
        sourceTradeDate,
        sourceScore,
        sourceRank,
        triggerSummary,
        note,
      ],
    );

    const rows = await getStrategyTrackingRows(req.user.id, {
      stock_code: stockCode,
      strategy: strategy.key,
      active: 1,
      limit: 1,
    });

    res.json({
      success: true,
      message: "已加入策略追蹤",
      data: convertBigIntToString(rows[0] || { stock_code: stockCode, strategy_key: strategy.key }),
    });
  } catch (error) {
    console.error("新增策略追蹤失敗：", error);

    res.status(500).json({
      success: false,
      message: "新增策略追蹤失敗",
      error: error.message,
    });
  }
});

// ==============================
// V1.3-2-3：移除策略追蹤
// DELETE /strategy-watchlist/:trackId
// ==============================
app.delete("/strategy-watchlist/:trackId", requireAuth, async (req, res) => {
  try {
    const trackId = parsePositiveInteger(req.params.trackId, 0, 0, Number.MAX_SAFE_INTEGER);

    if (!trackId) {
      return res.status(400).json({
        success: false,
        message: "策略追蹤 ID 格式不正確。",
      });
    }

    const result = await query(
      `
      DELETE FROM strategy_watchlists
      WHERE id = ?
        AND user_id = ?
      `,
      [trackId, req.user.id],
    );

    res.json({
      success: true,
      message: "已移除策略追蹤",
      affected_rows: Number(result?.affectedRows || 0),
      data: { id: trackId },
    });
  } catch (error) {
    console.error("移除策略追蹤失敗：", error);

    res.status(500).json({
      success: false,
      message: "移除策略追蹤失敗",
      error: error.message,
    });
  }
});

app.get("/watchlist", requireAuth, async (req, res) => {
  try {
    const rows = await getWatchlistRows(req.user.id);

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

    const stocks = await query(
      `
      SELECT stock_code
      FROM stocks
      WHERE stock_code = ?
        AND is_active = 1
      LIMIT 1
      `,
      [stockCode],
    );

    if (stocks.length === 0) {
      return res.status(404).json({
        success: false,
        message: "查不到這檔股票，請確認股票代號是否正確。",
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

    const rows = await getWatchlistRows(req.user.id, stockCode);

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


function parsePositiveInteger(value, defaultValue, minValue = 1, maxValue = 100) {
  const parsed = Number.parseInt(String(value ?? ""), 10);

  if (!Number.isFinite(parsed)) {
    return defaultValue;
  }

  return Math.max(minValue, Math.min(parsed, maxValue));
}

function parseBooleanFlag(value, defaultValue = true) {
  if (value === undefined || value === null || value === "") {
    return defaultValue ? 1 : 0;
  }

  const text = String(value).trim().toLowerCase();

  if (["1", "true", "yes", "y", "on"].includes(text)) return 1;
  if (["0", "false", "no", "n", "off"].includes(text)) return 0;

  return defaultValue ? 1 : 0;
}

function parseDecimalValue(value, defaultValue, minValue, maxValue) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return defaultValue;
  }

  return Math.max(minValue, Math.min(parsed, maxValue));
}

function parseDateValue(value) {
  const text = String(value || "").trim();

  if (!text) return "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return "";

  return text;
}

function normalizeAlertTypeValue(value) {
  return String(value || "").trim().replace(/\s+/g, "_").toLowerCase();
}

function normalizeAlertLevelValue(value) {
  const level = String(value || "").trim().toLowerCase();
  return ["high", "normal", "low"].includes(level) ? level : "";
}

function buildWatchlistAlertFilters(userId, queryParams = {}) {
  const conditions = ["a.user_id = ?"];
  const params = [userId];

  const stockCode = normalizeStockCodeValue(queryParams.stock_code || queryParams.stockCode);
  const alertType = normalizeAlertTypeValue(queryParams.alert_type || queryParams.alertType);
  const alertLevel = normalizeAlertLevelValue(queryParams.alert_level || queryParams.alertLevel);
  const fromDate = parseDateValue(queryParams.from || queryParams.from_date || queryParams.start_date);
  const toDate = parseDateValue(queryParams.to || queryParams.to_date || queryParams.end_date);
  const isRead = queryParams.is_read ?? queryParams.isRead;
  const unread = queryParams.unread;

  if (stockCode) {
    conditions.push("a.stock_code = ?");
    params.push(stockCode);
  }

  if (alertType) {
    conditions.push("a.alert_type = ?");
    params.push(alertType);
  }

  if (alertLevel) {
    conditions.push("a.alert_level = ?");
    params.push(alertLevel);
  }

  if (fromDate) {
    conditions.push("a.alert_date >= ?");
    params.push(fromDate);
  }

  if (toDate) {
    conditions.push("a.alert_date <= ?");
    params.push(toDate);
  }

  if (isRead !== undefined && isRead !== null && isRead !== "") {
    conditions.push("a.is_read = ?");
    params.push(parseBooleanFlag(isRead, false));
  } else if (unread !== undefined && unread !== null && unread !== "") {
    const unreadFlag = parseBooleanFlag(unread, false);
    if (unreadFlag === 1) {
      conditions.push("a.is_read = 0");
    }
  }

  return {
    whereSql: conditions.join(" AND "),
    params,
  };
}

async function ensureWatchlistRuleForStock(userId, stockCode) {
  await query(
    `
    INSERT IGNORE INTO watchlist_alert_rules (user_id, stock_code)
    SELECT ?, w.stock_code
    FROM watchlists w
    WHERE w.user_id = ?
      AND w.stock_code = ?
    LIMIT 1
    `,
    [userId, userId, stockCode],
  );
}

function normalizeWatchlistRulePayload(body = {}) {
  return {
    is_active: parseBooleanFlag(body.is_active, true),
    foreign_buy_streak_enabled: parseBooleanFlag(body.foreign_buy_streak_enabled, true),
    foreign_buy_streak_days: parsePositiveInteger(body.foreign_buy_streak_days, 3, 1, 20),
    investment_trust_buy_streak_enabled: parseBooleanFlag(body.investment_trust_buy_streak_enabled, true),
    investment_trust_buy_streak_days: parsePositiveInteger(body.investment_trust_buy_streak_days, 3, 1, 20),
    major_holder_enabled: parseBooleanFlag(body.major_holder_enabled, true),
    major_holder_ratio_change_threshold: parseDecimalValue(body.major_holder_ratio_change_threshold, 0.3, 0.01, 20),
    volume_enabled: parseBooleanFlag(body.volume_enabled, true),
    volume_ratio_threshold: parseDecimalValue(body.volume_ratio_threshold, 1.5, 1, 20),
    chip_score_enabled: parseBooleanFlag(body.chip_score_enabled, true),
    chip_score_threshold: parsePositiveInteger(body.chip_score_threshold, 80, 1, 100),
    calendar_enabled: parseBooleanFlag(body.calendar_enabled, true),
    calendar_days_before: parsePositiveInteger(body.calendar_days_before, 14, 1, 60),
  };
}

// ==============================
// V1.3-1-2：提醒中心 API
// GET /watchlist/alerts
// query: ?unread=1&stock_code=2330&alert_type=volume_spike&limit=50&offset=0
// ==============================
app.get("/watchlist/alerts", requireAuth, async (req, res) => {
  try {
    const limit = parsePositiveInteger(req.query.limit, 50, 1, 100);
    const offset = parsePositiveInteger(req.query.offset, 0, 0, 100000);
    const filters = buildWatchlistAlertFilters(req.user.id, req.query);

    const rows = await query(
      `
      SELECT
        a.id,
        a.user_id,
        a.stock_code,
        a.stock_name,
        DATE_FORMAT(a.alert_date, '%Y-%m-%d') AS alert_date,
        DATE_FORMAT(a.reference_date, '%Y-%m-%d') AS reference_date,
        a.alert_type,
        a.alert_level,
        a.title,
        a.message,
        a.metric_name,
        a.metric_value,
        a.threshold_value,
        a.source_table,
        CAST(a.source_id AS CHAR) AS source_id,
        a.is_read,
        DATE_FORMAT(a.read_at, '%Y-%m-%d %H:%i:%s') AS read_at,
        DATE_FORMAT(a.created_at, '%Y-%m-%d %H:%i:%s') AS created_at,
        DATE_FORMAT(a.updated_at, '%Y-%m-%d %H:%i:%s') AS updated_at
      FROM watchlist_alerts a
      WHERE ${filters.whereSql}
      ORDER BY a.is_read ASC, a.alert_level = 'high' DESC, a.alert_date DESC, a.created_at DESC, a.id DESC
      LIMIT ? OFFSET ?
      `,
      [...filters.params, limit, offset],
    );

    const countRows = await query(
      `
      SELECT COUNT(*) AS total_count
      FROM watchlist_alerts a
      WHERE ${filters.whereSql}
      `,
      filters.params,
    );

    const summaryRows = await query(
      `
      SELECT
        COUNT(*) AS total_count,
        SUM(CASE WHEN a.is_read = 0 THEN 1 ELSE 0 END) AS unread_count,
        SUM(CASE WHEN a.alert_level = 'high' THEN 1 ELSE 0 END) AS high_count,
        MAX(DATE_FORMAT(a.alert_date, '%Y-%m-%d')) AS latest_alert_date
      FROM watchlist_alerts a
      WHERE ${filters.whereSql}
      `,
      filters.params,
    );

    const typeRows = await query(
      `
      SELECT
        a.alert_type,
        COUNT(*) AS count
      FROM watchlist_alerts a
      WHERE ${filters.whereSql}
      GROUP BY a.alert_type
      ORDER BY count DESC, a.alert_type ASC
      `,
      filters.params,
    );

    res.json({
      success: true,
      count: rows.length,
      total_count: Number(countRows[0]?.total_count || 0),
      limit,
      offset,
      summary: convertBigIntToString({
        total_count: Number(summaryRows[0]?.total_count || 0),
        unread_count: Number(summaryRows[0]?.unread_count || 0),
        high_count: Number(summaryRows[0]?.high_count || 0),
        latest_alert_date: summaryRows[0]?.latest_alert_date || null,
        by_type: typeRows.map((row) => ({
          alert_type: row.alert_type,
          count: Number(row.count || 0),
        })),
      }),
      data: convertBigIntToString(rows),
    });
  } catch (error) {
    console.error("查詢自選股提醒失敗：", error);

    res.status(500).json({
      success: false,
      message: "查詢自選股提醒失敗",
      error: error.message,
    });
  }
});

// ==============================
// V1.3-1-2：未讀提醒數量
// GET /watchlist/alerts/unread-count
// ==============================
app.get("/watchlist/alerts/unread-count", requireAuth, async (req, res) => {
  try {
    const rows = await query(
      `
      SELECT
        COUNT(*) AS unread_count,
        SUM(CASE WHEN alert_level = 'high' THEN 1 ELSE 0 END) AS high_unread_count,
        MAX(DATE_FORMAT(alert_date, '%Y-%m-%d')) AS latest_alert_date
      FROM watchlist_alerts
      WHERE user_id = ?
        AND is_read = 0
      `,
      [req.user.id],
    );

    res.json({
      success: true,
      data: {
        unread_count: Number(rows[0]?.unread_count || 0),
        high_unread_count: Number(rows[0]?.high_unread_count || 0),
        latest_alert_date: rows[0]?.latest_alert_date || null,
      },
    });
  } catch (error) {
    console.error("查詢未讀提醒數失敗：", error);

    res.status(500).json({
      success: false,
      message: "查詢未讀提醒數失敗",
      error: error.message,
    });
  }
});

// ==============================
// V1.3-1-5：立即重新分析自選股提醒
// POST /watchlist/alerts/generate
// body/query 可選：{ date: "YYYY-MM-DD" }
// ==============================
app.post("/watchlist/alerts/generate", requireAuth, async (req, res) => {
  try {
    const requestedDate = req.body?.date || req.query?.date;
    const result = await generateWatchlistAlerts({
      date: requestedDate,
      userId: req.user.id,
      logger: console,
    });

    const unreadRows = await query(
      `
      SELECT
        COUNT(*) AS unread_count,
        SUM(CASE WHEN alert_level = 'high' THEN 1 ELSE 0 END) AS high_unread_count,
        MAX(DATE_FORMAT(alert_date, '%Y-%m-%d')) AS latest_alert_date
      FROM watchlist_alerts
      WHERE user_id = ?
        AND is_read = 0
      `,
      [req.user.id],
    );

    res.json({
      success: true,
      message: "自選股提醒已重新分析",
      data: convertBigIntToString({
        ...result,
        unread_count: Number(unreadRows[0]?.unread_count || 0),
        high_unread_count: Number(unreadRows[0]?.high_unread_count || 0),
        latest_alert_date: unreadRows[0]?.latest_alert_date || null,
      }),
    });
  } catch (error) {
    console.error("重新分析自選股提醒失敗：", error);

    res.status(500).json({
      success: false,
      message: "重新分析自選股提醒失敗",
      error: error.message,
    });
  }
});

// ==============================
// V1.3-1-2：單筆提醒標記已讀
// POST /watchlist/alerts/:alertId/read
// ==============================
app.post("/watchlist/alerts/:alertId/read", requireAuth, async (req, res) => {
  try {
    const alertId = parsePositiveInteger(req.params.alertId, 0, 0, Number.MAX_SAFE_INTEGER);

    if (!alertId) {
      return res.status(400).json({
        success: false,
        message: "提醒 ID 格式不正確。",
      });
    }

    const result = await query(
      `
      UPDATE watchlist_alerts
      SET is_read = 1,
          read_at = COALESCE(read_at, NOW()),
          updated_at = NOW()
      WHERE id = ?
        AND user_id = ?
      `,
      [alertId, req.user.id],
    );

    if (Number(result?.affectedRows || 0) === 0) {
      return res.status(404).json({
        success: false,
        message: "查不到這筆提醒，或這筆提醒不屬於目前登入者。",
      });
    }

    const rows = await query(
      `
      SELECT
        id,
        user_id,
        stock_code,
        stock_name,
        DATE_FORMAT(alert_date, '%Y-%m-%d') AS alert_date,
        DATE_FORMAT(reference_date, '%Y-%m-%d') AS reference_date,
        alert_type,
        alert_level,
        title,
        message,
        metric_name,
        metric_value,
        threshold_value,
        source_table,
        CAST(source_id AS CHAR) AS source_id,
        is_read,
        DATE_FORMAT(read_at, '%Y-%m-%d %H:%i:%s') AS read_at,
        DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS created_at,
        DATE_FORMAT(updated_at, '%Y-%m-%d %H:%i:%s') AS updated_at
      FROM watchlist_alerts
      WHERE id = ?
        AND user_id = ?
      LIMIT 1
      `,
      [alertId, req.user.id],
    );

    res.json({
      success: true,
      message: "提醒已標記為已讀",
      data: convertBigIntToString(rows[0]),
    });
  } catch (error) {
    console.error("標記提醒已讀失敗：", error);

    res.status(500).json({
      success: false,
      message: "標記提醒已讀失敗",
      error: error.message,
    });
  }
});

// ==============================
// V1.3-1-2：全部提醒標記已讀
// POST /watchlist/alerts/read-all
// body 可選：{ stock_code: "2330" }
// ==============================
app.post("/watchlist/alerts/read-all", requireAuth, async (req, res) => {
  try {
    const stockCode = normalizeStockCodeValue(req.body?.stock_code || req.query?.stock_code);
    const params = [req.user.id];
    let stockCondition = "";

    if (stockCode) {
      if (!isValidStockCodeValue(stockCode)) {
        return res.status(400).json({
          success: false,
          message: "股票代號格式不正確。",
        });
      }

      stockCondition = "AND stock_code = ?";
      params.push(stockCode);
    }

    const result = await query(
      `
      UPDATE watchlist_alerts
      SET is_read = 1,
          read_at = COALESCE(read_at, NOW()),
          updated_at = NOW()
      WHERE user_id = ?
        AND is_read = 0
        ${stockCondition}
      `,
      params,
    );

    res.json({
      success: true,
      message: stockCode ? `${stockCode} 的提醒已全部標記為已讀` : "全部提醒已標記為已讀",
      affected_rows: Number(result?.affectedRows || 0),
    });
  } catch (error) {
    console.error("全部提醒標記已讀失敗：", error);

    res.status(500).json({
      success: false,
      message: "全部提醒標記已讀失敗",
      error: error.message,
    });
  }
});

// ==============================
// V1.3-1-2：查詢自選股提醒規則
// GET /watchlist/rules
// ==============================
app.get("/watchlist/rules", requireAuth, async (req, res) => {
  try {
    const stockCode = normalizeStockCodeValue(req.query.stock_code || req.query.stockCode);
    const params = [req.user.id, req.user.id];
    let stockCondition = "";

    if (stockCode) {
      if (!isValidStockCodeValue(stockCode)) {
        return res.status(400).json({
          success: false,
          message: "股票代號格式不正確。",
        });
      }

      stockCondition = "AND w.stock_code = ?";
      params.push(stockCode);
    }

    await query(
      `
      INSERT IGNORE INTO watchlist_alert_rules (user_id, stock_code)
      SELECT w.user_id, w.stock_code
      FROM watchlists w
      WHERE w.user_id = ?
      `,
      [req.user.id],
    );

    const rows = await query(
      `
      SELECT
        r.id,
        w.user_id,
        w.stock_code,
        COALESCE(s.stock_name, ep.stock_name, w.stock_code) AS stock_name,
        COALESCE(s.market_type, ep.market_type) AS market_type,
        s.industry,
        r.is_active,
        r.foreign_buy_streak_enabled,
        r.foreign_buy_streak_days,
        r.investment_trust_buy_streak_enabled,
        r.investment_trust_buy_streak_days,
        r.major_holder_enabled,
        r.major_holder_ratio_change_threshold,
        r.volume_enabled,
        r.volume_ratio_threshold,
        r.chip_score_enabled,
        r.chip_score_threshold,
        r.calendar_enabled,
        r.calendar_days_before,
        DATE_FORMAT(r.created_at, '%Y-%m-%d %H:%i:%s') AS created_at,
        DATE_FORMAT(r.updated_at, '%Y-%m-%d %H:%i:%s') AS updated_at
      FROM watchlists w
      LEFT JOIN watchlist_alert_rules r
        ON r.user_id = w.user_id
       AND r.stock_code = w.stock_code
      LEFT JOIN stocks s
        ON s.stock_code = w.stock_code
      LEFT JOIN etf_profiles ep
        ON ep.stock_code = w.stock_code
      WHERE w.user_id = ?
        ${stockCondition}
      ORDER BY w.sort_order ASC, w.created_at ASC, w.stock_code ASC
      `,
      params.slice(1),
    );

    res.json({
      success: true,
      count: rows.length,
      data: convertBigIntToString(rows),
    });
  } catch (error) {
    console.error("查詢自選股提醒規則失敗：", error);

    res.status(500).json({
      success: false,
      message: "查詢自選股提醒規則失敗",
      error: error.message,
    });
  }
});

// ==============================
// V1.3-1-2：新增 / 更新自選股提醒規則
// POST /watchlist/rules
// body: { stock_code: "2330", chip_score_threshold: 85, volume_ratio_threshold: 2 }
// ==============================
app.post("/watchlist/rules", requireAuth, async (req, res) => {
  try {
    const stockCode = normalizeStockCodeValue(req.body?.stock_code || req.body?.stockCode);

    if (!stockCode || !isValidStockCodeValue(stockCode)) {
      return res.status(400).json({
        success: false,
        message: "請提供正確的股票代號。",
      });
    }

    const watchlistRows = await query(
      `
      SELECT stock_code
      FROM watchlists
      WHERE user_id = ?
        AND stock_code = ?
      LIMIT 1
      `,
      [req.user.id, stockCode],
    );

    if (watchlistRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "這檔股票尚未加入自選股，請先加入自選股後再設定提醒。",
      });
    }

    const rule = normalizeWatchlistRulePayload(req.body || {});

    await query(
      `
      INSERT INTO watchlist_alert_rules (
        user_id,
        stock_code,
        is_active,
        foreign_buy_streak_enabled,
        foreign_buy_streak_days,
        investment_trust_buy_streak_enabled,
        investment_trust_buy_streak_days,
        major_holder_enabled,
        major_holder_ratio_change_threshold,
        volume_enabled,
        volume_ratio_threshold,
        chip_score_enabled,
        chip_score_threshold,
        calendar_enabled,
        calendar_days_before
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        is_active = VALUES(is_active),
        foreign_buy_streak_enabled = VALUES(foreign_buy_streak_enabled),
        foreign_buy_streak_days = VALUES(foreign_buy_streak_days),
        investment_trust_buy_streak_enabled = VALUES(investment_trust_buy_streak_enabled),
        investment_trust_buy_streak_days = VALUES(investment_trust_buy_streak_days),
        major_holder_enabled = VALUES(major_holder_enabled),
        major_holder_ratio_change_threshold = VALUES(major_holder_ratio_change_threshold),
        volume_enabled = VALUES(volume_enabled),
        volume_ratio_threshold = VALUES(volume_ratio_threshold),
        chip_score_enabled = VALUES(chip_score_enabled),
        chip_score_threshold = VALUES(chip_score_threshold),
        calendar_enabled = VALUES(calendar_enabled),
        calendar_days_before = VALUES(calendar_days_before),
        updated_at = CURRENT_TIMESTAMP
      `,
      [
        req.user.id,
        stockCode,
        rule.is_active,
        rule.foreign_buy_streak_enabled,
        rule.foreign_buy_streak_days,
        rule.investment_trust_buy_streak_enabled,
        rule.investment_trust_buy_streak_days,
        rule.major_holder_enabled,
        rule.major_holder_ratio_change_threshold,
        rule.volume_enabled,
        rule.volume_ratio_threshold,
        rule.chip_score_enabled,
        rule.chip_score_threshold,
        rule.calendar_enabled,
        rule.calendar_days_before,
      ],
    );

    const rows = await query(
      `
      SELECT
        r.id,
        r.user_id,
        r.stock_code,
        COALESCE(s.stock_name, ep.stock_name, r.stock_code) AS stock_name,
        COALESCE(s.market_type, ep.market_type) AS market_type,
        s.industry,
        r.is_active,
        r.foreign_buy_streak_enabled,
        r.foreign_buy_streak_days,
        r.investment_trust_buy_streak_enabled,
        r.investment_trust_buy_streak_days,
        r.major_holder_enabled,
        r.major_holder_ratio_change_threshold,
        r.volume_enabled,
        r.volume_ratio_threshold,
        r.chip_score_enabled,
        r.chip_score_threshold,
        r.calendar_enabled,
        r.calendar_days_before,
        DATE_FORMAT(r.created_at, '%Y-%m-%d %H:%i:%s') AS created_at,
        DATE_FORMAT(r.updated_at, '%Y-%m-%d %H:%i:%s') AS updated_at
      FROM watchlist_alert_rules r
      LEFT JOIN stocks s
        ON s.stock_code = r.stock_code
      LEFT JOIN etf_profiles ep
        ON ep.stock_code = r.stock_code
      WHERE r.user_id = ?
        AND r.stock_code = ?
      LIMIT 1
      `,
      [req.user.id, stockCode],
    );

    res.json({
      success: true,
      message: "自選股提醒規則已更新",
      data: convertBigIntToString(rows[0]),
    });
  } catch (error) {
    console.error("更新自選股提醒規則失敗：", error);

    res.status(500).json({
      success: false,
      message: "更新自選股提醒規則失敗",
      error: error.message,
    });
  }
});

app.listen(PORT, () => {
  console.log(`Stock Radar API running on http://localhost:${PORT}`);
});
