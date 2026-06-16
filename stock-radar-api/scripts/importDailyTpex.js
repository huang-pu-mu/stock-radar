import pool from "../db.js";

function getTaiwanToday() {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Taipei",
  }).format(new Date());
}

function normalizeDate(inputDate) {
  const dateText = inputDate || getTaiwanToday();
  const clean = dateText.replaceAll("-", "");

  if (!/^\d{8}$/.test(clean)) {
    throw new Error("日期格式錯誤，請使用 YYYY-MM-DD，例如 2026-06-16");
  }

  const year = Number(clean.slice(0, 4));
  const rocYear = year - 1911;

  if (rocYear <= 0) {
    throw new Error("TPEx 日期轉換失敗，西元年必須大於 1911");
  }

  return {
    tpexDate: `${rocYear}/${clean.slice(4, 6)}/${clean.slice(6, 8)}`,
    sqlDate: `${clean.slice(0, 4)}-${clean.slice(4, 6)}-${clean.slice(6, 8)}`,
  };
}

function stripHtml(value) {
  return String(value ?? "")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, "")
    .replace(/\u00a0/g, "")
    .trim();
}

function toNumber(value) {
  const text = stripHtml(value).replaceAll(",", "").replace("+", "").trim();

  if (!text || text === "--" || text === "---" || text === "X") {
    return null;
  }

  const number = Number(text);
  return Number.isNaN(number) ? null : number;
}

function toLots(value) {
  const shares = toNumber(value);

  if (shares === null) return null;

  return Math.round(shares / 1000);
}

function isCommonStockCode(code) {
  return /^\d{4}$/.test(code) && !code.startsWith("00");
}

function normalizeKey(value) {
  return String(value ?? "")
    .replace(/\s+/g, "")
    .replace(/　/g, "")
    .trim();
}

function objectValue(row, candidates) {
  if (!row || Array.isArray(row) || typeof row !== "object") {
    return undefined;
  }

  const entries = Object.entries(row);

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) continue;

    const expectedKey = normalizeKey(candidate);
    const found = entries.find(([key]) => normalizeKey(key) === expectedKey);

    if (found) return found[1];
  }

  for (const candidate of candidates) {
    const keywords = Array.isArray(candidate) ? candidate : [candidate];

    const found = entries.find(([key]) => {
      const normalizedKey = normalizeKey(key);

      return keywords.every((keyword) =>
        normalizedKey.includes(normalizeKey(keyword)),
      );
    });

    if (found) return found[1];
  }

  return undefined;
}

function getRows(json, label) {
  if (Array.isArray(json)) return json;

  const rowKeys = ["aaData", "data", "dataList", "tables"];

  for (const key of rowKeys) {
    const value = json?.[key];

    if (Array.isArray(value)) {
      if (key === "tables") {
        for (const table of value) {
          if (Array.isArray(table?.data)) return table.data;
          if (Array.isArray(table?.aaData)) return table.aaData;
        }
      }

      return value;
    }
  }

  throw new Error(`${label} 找不到資料列，TPEx 回傳格式可能已變更`);
}

async function fetchJson(url, referer) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 stock-radar-api",
      Accept: "application/json, text/javascript, */*; q=0.01",
      "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.8",
      Referer: referer,
    },
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(`HTTP 錯誤：${response.status}`);
  }

  const cleanText = text.replace(/^\uFEFF/, "").trim();

  if (!cleanText) {
    throw new Error("TPEx 回傳空資料");
  }

  try {
    return JSON.parse(cleanText);
  } catch {
    throw new Error(
      `TPEx 回傳不是 JSON，前 120 字：${cleanText.slice(0, 120)}`,
    );
  }
}

const DAILY_PRICE_INDEX = {
  code: 0,
  name: 1,
  close: 2,
  change: 3,
  open: 4,
  high: 5,
  low: 6,
  volume: 8,
  amount: 9,
  count: 10,
};

const DAILY_PRICE_ALIASES = {
  code: ["SecuritiesCompanyCode", "Code", "代號", "證券代號", "有價證券代號"],
  name: ["CompanyName", "Name", "名稱", "證券名稱", "有價證券名稱"],
  close: ["Close", "ClosingPrice", "收盤", "收盤價"],
  change: ["Change", "漲跌", "漲跌價差"],
  open: ["Open", "OpeningPrice", "開盤", "開盤價"],
  high: ["High", "HighestPrice", "最高", "最高價"],
  low: ["Low", "LowestPrice", "最低", "最低價"],
  volume: ["TradingShares", "成交股數", "成交量"],
  amount: ["TransactionAmount", "成交金額"],
  count: ["TransactionNumber", "成交筆數"],
};

function dailyPriceValue(row, key) {
  if (Array.isArray(row)) {
    return row[DAILY_PRICE_INDEX[key]];
  }

  return objectValue(row, DAILY_PRICE_ALIASES[key]);
}

async function importDailyPrices(conn, tpexDate, sqlDate) {
  const url = `https://www.tpex.org.tw/web/stock/aftertrading/daily_close_quotes/stk_quote_result.php?l=zh-tw&o=json&d=${encodeURIComponent(
    tpexDate,
  )}&s=0,asc,0`;

  const json = await fetchJson(
    url,
    "https://www.tpex.org.tw/zh-tw/mainboard/trading/info/mi-pricing.html",
  );

  const rows = getRows(json, "上櫃每日行情");

  let imported = 0;

  for (const row of rows) {
    const stockCode = stripHtml(dailyPriceValue(row, "code"));
    const stockName = stripHtml(dailyPriceValue(row, "name"));

    if (!isCommonStockCode(stockCode)) continue;

    const closePrice = toNumber(dailyPriceValue(row, "close"));

    if (closePrice === null) continue;

    await conn.query(
      `
      INSERT INTO stocks (
        stock_code,
        stock_name,
        market_type,
        industry,
        is_active
      )
      VALUES (?, ?, '上櫃', '未分類', 1)
      ON DUPLICATE KEY UPDATE
        stock_name = VALUES(stock_name),
        market_type = VALUES(market_type),
        is_active = 1,
        updated_at = NOW()
      `,
      [stockCode, stockName],
    );

    await conn.query(
      `
      INSERT INTO daily_prices (
        stock_code,
        trade_date,
        open_price,
        high_price,
        low_price,
        close_price,
        price_change,
        volume,
        transaction_amount,
        transaction_count
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        open_price = VALUES(open_price),
        high_price = VALUES(high_price),
        low_price = VALUES(low_price),
        close_price = VALUES(close_price),
        price_change = VALUES(price_change),
        volume = VALUES(volume),
        transaction_amount = VALUES(transaction_amount),
        transaction_count = VALUES(transaction_count),
        updated_at = NOW()
      `,
      [
        stockCode,
        sqlDate,
        toNumber(dailyPriceValue(row, "open")),
        toNumber(dailyPriceValue(row, "high")),
        toNumber(dailyPriceValue(row, "low")),
        closePrice,
        toNumber(dailyPriceValue(row, "change")),
        toLots(dailyPriceValue(row, "volume")),
        toNumber(dailyPriceValue(row, "amount")),
        toNumber(dailyPriceValue(row, "count")),
      ],
    );

    imported++;
  }

  return imported;
}

const INSTITUTIONAL_INDEX = {
  code: 0,
  name: 1,
  foreignBuy: 8,
  foreignSell: 9,
  foreignNet: 10,
  trustBuy: 11,
  trustSell: 12,
  trustNet: 13,
  dealerNet: 22,
  totalNet: 23,
};

const INSTITUTIONAL_ALIASES = {
  code: ["代號", "Code", "SecuritiesCompanyCode", "證券代號"],
  name: ["名稱", "Name", "CompanyName", "證券名稱"],
  foreignBuy: [
    ["外資及陸資", "買進股數"],
    ["外資", "買進股數"],
    "ForeignInvestorsBuy",
  ],
  foreignSell: [
    ["外資及陸資", "賣出股數"],
    ["外資", "賣出股數"],
    "ForeignInvestorsSell",
  ],
  foreignNet: [
    ["外資及陸資", "買賣超股數"],
    ["外資", "買賣超股數"],
    "ForeignInvestorsNet",
  ],
  trustBuy: [["投信", "買進股數"], "InvestmentTrustBuy"],
  trustSell: [["投信", "賣出股數"], "InvestmentTrustSell"],
  trustNet: [["投信", "買賣超股數"], "InvestmentTrustNet"],
  dealerNet: [["自營商", "買賣超股數"], "DealerNet"],
  totalNet: [["三大法人", "買賣超"], "TotalNet"],
};

function institutionalValue(row, key) {
  if (Array.isArray(row)) {
    return row[INSTITUTIONAL_INDEX[key]];
  }

  return objectValue(row, INSTITUTIONAL_ALIASES[key]);
}

async function importInstitutionalTrades(conn, tpexDate, sqlDate) {
  const url = `https://www.tpex.org.tw/web/stock/3insti/daily_trade/3itrade_hedge_result.php?l=zh-tw&o=json&se=EW&t=D&d=${encodeURIComponent(
    tpexDate,
  )}&s=0,asc`;

  const json = await fetchJson(
    url,
    "https://www.tpex.org.tw/zh-tw/mainboard/trading/major-institutional/3itrade/day.html",
  );

  const rows = getRows(json, "上櫃三大法人");

  let imported = 0;

  for (const row of rows) {
    const stockCode = stripHtml(institutionalValue(row, "code"));

    if (!isCommonStockCode(stockCode)) continue;

    await conn.query(
      `
      INSERT INTO institutional_trades (
        stock_code,
        trade_date,
        foreign_buy,
        foreign_sell,
        foreign_net,
        investment_trust_buy,
        investment_trust_sell,
        investment_trust_net,
        dealer_net,
        total_net
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        foreign_buy = VALUES(foreign_buy),
        foreign_sell = VALUES(foreign_sell),
        foreign_net = VALUES(foreign_net),
        investment_trust_buy = VALUES(investment_trust_buy),
        investment_trust_sell = VALUES(investment_trust_sell),
        investment_trust_net = VALUES(investment_trust_net),
        dealer_net = VALUES(dealer_net),
        total_net = VALUES(total_net),
        updated_at = NOW()
      `,
      [
        stockCode,
        sqlDate,
        toLots(institutionalValue(row, "foreignBuy")),
        toLots(institutionalValue(row, "foreignSell")),
        toLots(institutionalValue(row, "foreignNet")),
        toLots(institutionalValue(row, "trustBuy")),
        toLots(institutionalValue(row, "trustSell")),
        toLots(institutionalValue(row, "trustNet")),
        toLots(institutionalValue(row, "dealerNet")),
        toLots(institutionalValue(row, "totalNet")),
      ],
    );

    imported++;
  }

  return imported;
}

async function main() {
  const { tpexDate, sqlDate } = normalizeDate(process.argv[2]);
  const conn = await pool.getConnection();

  try {
    console.log(`開始匯入上櫃資料：${sqlDate}`);
    console.log(`TPEx 民國日期：${tpexDate}`);

    await conn.beginTransaction();

    const priceCount = await importDailyPrices(conn, tpexDate, sqlDate);
    const institutionalCount = await importInstitutionalTrades(
      conn,
      tpexDate,
      sqlDate,
    );

    await conn.commit();

    console.log("匯入完成");
    console.log(`上櫃每日收盤行情：${priceCount} 筆`);
    console.log(`上櫃三大法人買賣超：${institutionalCount} 筆`);
  } catch (error) {
    await conn.rollback();

    console.error("匯入失敗");
    console.error(error.message);

    process.exitCode = 1;
  } finally {
    conn.release();
    await pool.end();
  }
}

main();
