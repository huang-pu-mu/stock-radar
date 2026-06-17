import pool from "../db.js";

function toNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const text = String(value).replace(/,/g, "").trim();
  if (!text || text === "-" || text === "--") return null;
  const numberValue = Number(text);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function parseTwseRocDate(value) {
  const text = String(value || "").replace(/\//g, "").trim();
  if (!/^\d{7}$/.test(text)) return "";
  return `${Number(text.slice(0, 3)) + 1911}-${text.slice(3, 5)}-${text.slice(5, 7)}`;
}

async function fetchJson(url, label) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 stock-radar-api",
      Accept: "application/json,text/plain,*/*",
    },
  });

  if (!response.ok) throw new Error(`${label} HTTP ${response.status}`);
  return response.json();
}

function getLatestTwseFmtqikRow(rows = []) {
  if (!Array.isArray(rows)) return null;
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index];
    if (row?.Date && toNumber(row?.TradeValue) !== null) return row;
  }
  return null;
}

async function importTwseFmtqik(conn) {
  const url = "https://openapi.twse.com.tw/v1/exchangeReport/FMTQIK";
  const rows = await fetchJson(url, "TWSE 上市市場成交資訊");
  const row = getLatestTwseFmtqikRow(rows);
  if (!row) throw new Error("TWSE FMTQIK 查無可匯入資料");

  const tradeDate = parseTwseRocDate(row.Date);
  if (!tradeDate) throw new Error(`TWSE FMTQIK 日期格式無法解析：${row.Date}`);

  await conn.query(
    `
    INSERT INTO market_daily_summaries (
      trade_date,
      market_type,
      trade_volume,
      total_trade_amount,
      transaction_count,
      daily_index_point,
      daily_change_point,
      source,
      source_url
    ) VALUES (?, '上市', ?, ?, ?, ?, ?, 'TWSE OpenAPI FMTQIK', ?)
    ON DUPLICATE KEY UPDATE
      trade_volume = VALUES(trade_volume),
      total_trade_amount = VALUES(total_trade_amount),
      transaction_count = VALUES(transaction_count),
      daily_index_point = VALUES(daily_index_point),
      daily_change_point = VALUES(daily_change_point),
      source = VALUES(source),
      source_url = VALUES(source_url),
      updated_at = CURRENT_TIMESTAMP
    `,
    [
      tradeDate,
      toNumber(row.TradeVolume),
      toNumber(row.TradeValue),
      toNumber(row.Transaction),
      toNumber(row.TAIEX),
      toNumber(row.Change),
      url,
    ],
  );

  return { marketType: "上市", tradeDate, source: "TWSE OpenAPI FMTQIK" };
}

async function importFromDailyPrices(conn, marketType) {
  const latestRows = await conn.query(
    `
    SELECT DATE_FORMAT(MAX(p.trade_date), '%Y-%m-%d') AS latest_date
    FROM daily_prices p
    INNER JOIN stocks s
      ON p.stock_code = s.stock_code
    WHERE s.market_type = ?
      AND (p.transaction_amount IS NOT NULL OR p.turnover IS NOT NULL OR p.volume IS NOT NULL OR p.transaction_count IS NOT NULL)
    `,
    [marketType],
  );

  const latestDate = latestRows[0]?.latest_date;
  if (!latestDate) return null;

  const summaryRows = await conn.query(
    `
    SELECT
      CAST(SUM(COALESCE(p.volume, 0)) AS CHAR) AS trade_volume,
      CAST(SUM(COALESCE(p.transaction_amount, p.turnover, 0)) AS CHAR) AS total_trade_amount,
      CAST(SUM(COALESCE(p.transaction_count, 0)) AS CHAR) AS transaction_count
    FROM daily_prices p
    INNER JOIN stocks s
      ON p.stock_code = s.stock_code
    WHERE s.market_type = ?
      AND p.trade_date = ?
    `,
    [marketType, latestDate],
  );

  const row = summaryRows[0];
  await conn.query(
    `
    INSERT INTO market_daily_summaries (
      trade_date,
      market_type,
      trade_volume,
      total_trade_amount,
      transaction_count,
      source,
      source_url
    ) VALUES (?, ?, ?, ?, ?, 'DATABASE daily_prices aggregate', 'database:daily_prices')
    ON DUPLICATE KEY UPDATE
      trade_volume = VALUES(trade_volume),
      total_trade_amount = VALUES(total_trade_amount),
      transaction_count = VALUES(transaction_count),
      source = VALUES(source),
      source_url = VALUES(source_url),
      updated_at = CURRENT_TIMESTAMP
    `,
    [
      latestDate,
      marketType,
      toNumber(row.trade_volume),
      toNumber(row.total_trade_amount),
      toNumber(row.transaction_count),
    ],
  );

  return { marketType, tradeDate: latestDate, source: "DATABASE daily_prices aggregate" };
}

async function main() {
  const conn = await pool.getConnection();

  try {
    console.log("開始匯入市場每日成交總覽");

    try {
      const result = await importTwseFmtqik(conn);
      console.log(`完成：${result.marketType} ${result.tradeDate} ${result.source}`);
    } catch (error) {
      console.log(`TWSE OpenAPI 匯入失敗，改用 daily_prices 匯總：${error.message}`);
      const fallback = await importFromDailyPrices(conn, "上市");
      if (fallback) console.log(`完成：${fallback.marketType} ${fallback.tradeDate} ${fallback.source}`);
    }

    const tpexResult = await importFromDailyPrices(conn, "上櫃");
    if (tpexResult) {
      console.log(`完成：${tpexResult.marketType} ${tpexResult.tradeDate} ${tpexResult.source}`);
    } else {
      console.log("略過：上櫃 daily_prices 尚無可匯總資料");
    }
  } catch (error) {
    console.error("匯入市場每日成交總覽失敗");
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    conn.release();
    await pool.end();
  }
}

main();
