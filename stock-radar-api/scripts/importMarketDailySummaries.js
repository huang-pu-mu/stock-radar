import path from "node:path";
import { fileURLToPath } from "node:url";
import pool from "../db.js";

function getTaiwanToday() {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Taipei",
  }).format(new Date());
}

function stripHtml(value) {
  return String(value ?? "")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, "")
    .replace(/&amp;/g, "&")
    .replace(/\u00a0/g, "")
    .trim();
}

function normalizeText(value) {
  return stripHtml(value)
    .replace(/[\s　]+/g, "")
    .replace(/[()（）]/g, "")
    .trim();
}

function toNumber(value) {
  if (value === null || value === undefined || value === "") return null;

  let text = stripHtml(value)
    .replace(/,/g, "")
    .replace(/\+/g, "")
    .replace(/元|股|筆/g, "")
    .trim();

  if (!text || text === "-" || text === "--" || text === "---") return null;

  const isParenthesesNegative = /^\(.+\)$/.test(text);
  text = text.replace(/[()（）]/g, "");

  const numberValue = Number(text);
  if (!Number.isFinite(numberValue)) return null;

  return isParenthesesNegative ? -numberValue : numberValue;
}

function normalizeDateText(inputDate) {
  const dateText = inputDate || getTaiwanToday();
  const clean = String(dateText).replaceAll("-", "").replaceAll("/", "").trim();

  if (!/^\d{8}$/.test(clean)) {
    throw new Error("日期格式錯誤，請使用 YYYY-MM-DD，例如 2026-06-18");
  }

  return {
    twseDate: clean,
    sqlDate: `${clean.slice(0, 4)}-${clean.slice(4, 6)}-${clean.slice(6, 8)}`,
  };
}

function parseDateToSql(value) {
  const text = stripHtml(value).replaceAll(".", "/").replaceAll("-", "/").trim();

  let match = text.match(/^(\d{2,3})\/(\d{1,2})\/(\d{1,2})$/);
  if (match) {
    const year = Number(match[1]) + 1911;
    return `${year}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
  }

  match = text.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (match) {
    return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
  }

  const clean = text.replace(/\D/g, "");
  if (/^\d{7}$/.test(clean)) {
    return `${Number(clean.slice(0, 3)) + 1911}-${clean.slice(3, 5)}-${clean.slice(5, 7)}`;
  }

  if (/^\d{8}$/.test(clean)) {
    return `${clean.slice(0, 4)}-${clean.slice(4, 6)}-${clean.slice(6, 8)}`;
  }

  return "";
}

async function fetchJson(url, label, referer = "") {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 stock-radar-api",
      Accept: "application/json,text/plain,*/*",
      "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.8",
      Referer: referer,
    },
  });

  const text = await response.text();

  if (!response.ok) throw new Error(`${label} HTTP ${response.status}`);

  try {
    return JSON.parse(text.replace(/^\uFEFF/, "").trim());
  } catch {
    throw new Error(`${label} 回傳不是 JSON，前 120 字：${text.slice(0, 120)}`);
  }
}

function objectValue(row, candidates) {
  if (!row || Array.isArray(row) || typeof row !== "object") return undefined;
  const entries = Object.entries(row);

  for (const candidate of candidates) {
    const keywordList = Array.isArray(candidate) ? candidate : [candidate];
    const found = entries.find(([key]) => {
      const text = normalizeText(key);
      return keywordList.every((keyword) => text.includes(normalizeText(keyword)));
    });

    if (found) return found[1];
  }

  return undefined;
}

function fieldIndex(fields, candidates) {
  const keywordList = Array.isArray(candidates) ? candidates : [candidates];
  return (fields || []).findIndex((field) => {
    const text = normalizeText(field);
    return keywordList.every((keyword) => text.includes(normalizeText(keyword)));
  });
}

function arrayValue(row, fields, candidates, fallbackIndex) {
  const index = fieldIndex(fields, candidates);
  if (index >= 0 && row[index] !== undefined) return row[index];
  if (fallbackIndex >= 0 && row[fallbackIndex] !== undefined) return row[fallbackIndex];
  return undefined;
}

function getTwseFmtqikTables(json) {
  const tables = [];

  if (Array.isArray(json)) {
    tables.push({ fields: [], rows: json });
  }

  if (Array.isArray(json?.data)) {
    tables.push({ fields: json.fields || [], rows: json.data });
  }

  if (Array.isArray(json?.tables)) {
    for (const table of json.tables) {
      tables.push({
        fields: table.fields || table.header || [],
        rows: table.data || table.aaData || table.rows || [],
      });
    }
  }

  return tables.filter((table) => Array.isArray(table.rows) && table.rows.length > 0);
}

function parseTwseFmtqikRows(json) {
  const parsedRows = [];
  const tables = getTwseFmtqikTables(json);

  for (const table of tables) {
    const fields = table.fields || [];

    for (const row of table.rows) {
      let parsed;

      if (Array.isArray(row)) {
        parsed = {
          tradeDate: parseDateToSql(arrayValue(row, fields, "日期", 0)),
          tradeVolume: toNumber(arrayValue(row, fields, ["成交", "股數"], 1)),
          totalTradeAmount: toNumber(arrayValue(row, fields, ["成交", "金額"], 2)),
          transactionCount: toNumber(arrayValue(row, fields, ["成交", "筆數"], 3)),
          dailyIndexPoint: toNumber(arrayValue(row, fields, ["發行量加權股價指數"], 4)),
          dailyChangePoint: toNumber(arrayValue(row, fields, ["漲跌", "點數"], 5)),
        };
      } else {
        parsed = {
          tradeDate: parseDateToSql(objectValue(row, ["Date", "日期", "交易日期"])),
          tradeVolume: toNumber(objectValue(row, ["TradeVolume", ["成交", "股數"]])),
          totalTradeAmount: toNumber(objectValue(row, ["TradeValue", ["成交", "金額"]])),
          transactionCount: toNumber(objectValue(row, ["Transaction", ["成交", "筆數"]])),
          dailyIndexPoint: toNumber(objectValue(row, ["TAIEX", ["發行量加權股價指數"], "指數"])),
          dailyChangePoint: toNumber(objectValue(row, ["Change", ["漲跌", "點數"]])),
        };
      }

      if (parsed.tradeDate && parsed.totalTradeAmount !== null) {
        parsedRows.push(parsed);
      }
    }
  }

  return parsedRows;
}

function latestRow(rows) {
  return rows
    .filter((row) => row.tradeDate)
    .sort((a, b) => a.tradeDate.localeCompare(b.tradeDate))
    .at(-1) || null;
}

function buildTwseFmtqikCandidates(twseDate) {
  return [
    {
      label: "TWSE RWD FMTQIK",
      url: `https://www.twse.com.tw/rwd/zh/afterTrading/FMTQIK?date=${twseDate}&response=json`,
      referer: "https://www.twse.com.tw/zh/trading/historical/fmtqik.html",
    },
    {
      label: "TWSE legacy FMTQIK",
      url: `https://www.twse.com.tw/exchangeReport/FMTQIK?date=${twseDate}&response=json`,
      referer: "https://www.twse.com.tw/zh/trading/historical/fmtqik.html",
    },
    {
      label: "TWSE OpenAPI FMTQIK",
      url: "https://openapi.twse.com.tw/v1/exchangeReport/FMTQIK",
      referer: "https://openapi.twse.com.tw/",
    },
  ];
}

async function upsertMarketDailySummary(conn, row, source, sourceUrl) {
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
    ) VALUES (?, '上市', ?, ?, ?, ?, ?, ?, ?)
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
      row.tradeDate,
      row.tradeVolume,
      row.totalTradeAmount,
      row.transactionCount,
      row.dailyIndexPoint,
      row.dailyChangePoint,
      source,
      sourceUrl,
    ],
  );
}

async function importTwseFmtqik(conn, inputDate = null) {
  const { twseDate, sqlDate } = normalizeDateText(inputDate);
  const errors = [];

  for (const candidate of buildTwseFmtqikCandidates(twseDate)) {
    try {
      const json = await fetchJson(candidate.url, candidate.label, candidate.referer);
      const rows = parseTwseFmtqikRows(json);
      const row = inputDate ? rows.find((item) => item.tradeDate === sqlDate) : latestRow(rows);

      if (!row) {
        throw new Error(inputDate ? `查無 ${sqlDate} 資料` : "查無可匯入資料");
      }

      await upsertMarketDailySummary(conn, row, candidate.label, candidate.url);

      return {
        marketType: "上市",
        tradeDate: row.tradeDate,
        source: candidate.label,
        sourceUrl: candidate.url,
      };
    } catch (error) {
      errors.push(`${candidate.label}：${error.message}`);
    }
  }

  throw new Error(errors.join("；"));
}

async function importFromDailyPrices(conn, marketType, inputDate = null) {
  let latestDate = inputDate ? normalizeDateText(inputDate).sqlDate : null;

  if (!latestDate) {
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

    latestDate = latestRows[0]?.latest_date;
  }

  if (!latestDate) return null;

  const summaryRows = await conn.query(
    `
    SELECT
      CAST(SUM(COALESCE(p.volume, 0)) AS CHAR) AS trade_volume,
      CAST(SUM(COALESCE(p.transaction_amount, p.turnover, 0)) AS CHAR) AS total_trade_amount,
      CAST(SUM(COALESCE(p.transaction_count, 0)) AS CHAR) AS transaction_count,
      COUNT(*) AS stock_count
    FROM daily_prices p
    INNER JOIN stocks s
      ON p.stock_code = s.stock_code
    WHERE s.market_type = ?
      AND p.trade_date = ?
    `,
    [marketType, latestDate],
  );

  const row = summaryRows[0];
  const stockCount = Number(row?.stock_count || 0);
  const totalTradeAmount = toNumber(row?.total_trade_amount);

  if (stockCount === 0 || totalTradeAmount === null || totalTradeAmount <= 0) {
    return null;
  }

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
      totalTradeAmount,
      toNumber(row.transaction_count),
    ],
  );

  return {
    marketType,
    tradeDate: latestDate,
    source: "DATABASE daily_prices aggregate",
    stockCount,
  };
}

export async function importMarketDailySummariesForDate(conn, inputDate = null) {
  const normalized = inputDate ? normalizeDateText(inputDate) : null;
  const labelDate = normalized?.sqlDate || "最近可用交易日";
  const results = [];
  const errors = [];

  try {
    const result = await importTwseFmtqik(conn, inputDate);
    results.push(result);
  } catch (error) {
    errors.push(`上市官方來源：${error.message}`);
    const fallback = await importFromDailyPrices(conn, "上市", inputDate);
    if (fallback) {
      results.push(fallback);
    } else {
      errors.push(`上市 daily_prices 彙總：${labelDate} 查無可彙總資料`);
    }
  }

  const tpexResult = await importFromDailyPrices(conn, "上櫃", inputDate);
  if (tpexResult) {
    results.push(tpexResult);
  } else {
    errors.push(`上櫃 daily_prices 彙總：${labelDate} 查無可彙總資料`);
  }

  if (results.length === 0) {
    throw new Error(errors.join("；"));
  }

  return { results, errors };
}

function isMainModule() {
  return Boolean(process.argv[1]) && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

async function main() {
  const conn = await pool.getConnection();

  try {
    const inputDate = process.argv[2] || null;
    console.log("開始匯入市場每日成交總覽");
    if (inputDate) console.log(`指定日期：${normalizeDateText(inputDate).sqlDate}`);

    const { results, errors } = await importMarketDailySummariesForDate(conn, inputDate);

    for (const result of results) {
      console.log(`完成：${result.marketType} ${result.tradeDate} ${result.source}`);
      if (result.sourceUrl) console.log(`來源：${result.sourceUrl}`);
    }

    if (errors.length > 0) {
      console.log(`部分來源未完成：${errors.join("；")}`);
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

if (isMainModule()) {
  main();
}
