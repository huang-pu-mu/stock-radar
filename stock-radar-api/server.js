import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import pool from "./db.js";
import { query, testConnection } from "./db.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

function toBigIntValue(value) {
  return BigInt(value ?? 0);
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

app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "Stock Radar API is running",
    version: "stock-radar-api-v1",
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

app.listen(PORT, () => {
  console.log(`Stock Radar API running on http://localhost:${PORT}`);
});
