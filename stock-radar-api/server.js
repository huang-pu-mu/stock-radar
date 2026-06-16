import express from "express";
import cors from "cors";
import dotenv from "dotenv";
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
      data: stocks,
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
        price_change_percent,
        CAST(volume AS CHAR) AS volume,
        CAST(turnover AS CHAR) AS turnover,
        DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS created_at
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
      data: prices,
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

        CAST(dealer_buy AS CHAR) AS dealer_buy,
        CAST(dealer_sell AS CHAR) AS dealer_sell,
        CAST(dealer_net AS CHAR) AS dealer_net,

        CAST(total_net AS CHAR) AS total_net,

        DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS created_at
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
      data: trades,
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

        total_score,
        foreign_score,
        investment_trust_score,
        volume_score,
        price_position_score,
        trend_score,

        foreign_status,
        investment_trust_status,
        volume_status,
        price_position_status,
        radar_note,

        DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS created_at
      FROM radar_scores
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
      data: scores,
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
    const limit = Number(req.query.limit) || 20;

    let targetDate = queryDate;

    if (!targetDate) {
      const latestDateRows = await query(`
        SELECT DATE_FORMAT(MAX(trade_date), '%Y-%m-%d') AS latest_date
        FROM radar_scores
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

    const radarList = await query(
      `
      SELECT
        DATE_FORMAT(rs.trade_date, '%Y-%m-%d') AS trade_date,
        rs.stock_code,
        s.stock_name,
        s.market_type,
        s.industry,

        rs.total_score,
        rs.foreign_score,
        rs.investment_trust_score,
        rs.volume_score,
        rs.price_position_score,
        rs.trend_score,

        rs.foreign_status,
        rs.investment_trust_status,
        rs.volume_status,
        rs.price_position_status,
        rs.radar_note,

        DATE_FORMAT(rs.created_at, '%Y-%m-%d %H:%i:%s') AS created_at
      FROM radar_scores rs
      LEFT JOIN stocks s
        ON rs.stock_code = s.stock_code
      WHERE rs.trade_date = ?
      ORDER BY rs.total_score DESC, rs.stock_code ASC
      LIMIT ?
      `,
      [targetDate, limit],
    );

    res.json({
      success: true,
      trade_date: targetDate,
      count: radarList.length,
      data: radarList,
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

app.listen(PORT, () => {
  console.log(`Stock Radar API running on http://localhost:${PORT}`);
});
