import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { query, testConnection } from "./db.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

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

app.listen(PORT, () => {
  console.log(`Stock Radar API running on http://localhost:${PORT}`);
});
