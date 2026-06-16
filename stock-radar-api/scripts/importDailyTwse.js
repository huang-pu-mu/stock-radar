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

  return {
    twseDate: clean,
    sqlDate: `${clean.slice(0, 4)}-${clean.slice(4, 6)}-${clean.slice(6, 8)}`,
  };
}

function stripHtml(value) {
  return String(value ?? "")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, "")
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

function getTable(json, requiredKeywords) {
  const candidates = [];

  if (Array.isArray(json.tables)) {
    for (const table of json.tables) {
      candidates.push({
        title: table.title || "",
        fields: table.fields || [],
        data: table.data || [],
      });
    }
  }

  if (Array.isArray(json.fields) && Array.isArray(json.data)) {
    candidates.push({
      title: json.title || "",
      fields: json.fields,
      data: json.data,
    });
  }

  for (const key of Object.keys(json)) {
    if (key.startsWith("fields")) {
      const suffix = key.replace("fields", "");
      const dataKey = `data${suffix}`;

      if (Array.isArray(json[key]) && Array.isArray(json[dataKey])) {
        candidates.push({
          title: key,
          fields: json[key],
          data: json[dataKey],
        });
      }
    }
  }

  const table = candidates.find((item) => {
    const fieldText = item.fields.join("|");
    return requiredKeywords.every((keyword) => fieldText.includes(keyword));
  });

  if (!table) {
    throw new Error(`找不到資料表欄位：${requiredKeywords.join(", ")}`);
  }

  return table;
}

function fieldIndex(fields, keyword) {
  const index = fields.findIndex((field) => String(field).includes(keyword));

  if (index === -1) {
    throw new Error(`找不到欄位：${keyword}`);
  }

  return index;
}

function fieldIndexAll(fields, keywords) {
  const index = fields.findIndex((field) => {
    const text = String(field);
    return keywords.every((keyword) => text.includes(keyword));
  });

  if (index === -1) {
    throw new Error(`找不到欄位：${keywords.join("+")}`);
  }

  return index;
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 stock-radar-api",
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP 錯誤：${response.status}`);
  }

  return response.json();
}

async function importDailyPrices(conn, twseDate, sqlDate) {
  const url = `https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX?date=${twseDate}&type=ALLBUT0999&response=json`;
  const json = await fetchJson(url);

  if (json.stat && !String(json.stat).includes("OK")) {
    throw new Error(`每日收盤行情查詢失敗：${json.stat}`);
  }

  const table = getTable(json, ["證券代號", "證券名稱", "收盤價", "成交股數"]);

  const codeIndex = fieldIndex(table.fields, "證券代號");
  const nameIndex = fieldIndex(table.fields, "證券名稱");
  const volumeIndex = fieldIndex(table.fields, "成交股數");
  const amountIndex = fieldIndex(table.fields, "成交金額");
  const countIndex = fieldIndex(table.fields, "成交筆數");
  const openIndex = fieldIndex(table.fields, "開盤價");
  const highIndex = fieldIndex(table.fields, "最高價");
  const lowIndex = fieldIndex(table.fields, "最低價");
  const closeIndex = fieldIndex(table.fields, "收盤價");
  const changeSignIndex = fieldIndex(table.fields, "漲跌");
  const changeValueIndex = fieldIndex(table.fields, "漲跌價差");

  let imported = 0;

  for (const row of table.data) {
    const stockCode = stripHtml(row[codeIndex]);
    const stockName = stripHtml(row[nameIndex]);

    if (!isCommonStockCode(stockCode)) continue;

    const closePrice = toNumber(row[closeIndex]);

    if (closePrice === null) continue;

    const sign = stripHtml(row[changeSignIndex]);
    const rawChange = toNumber(row[changeValueIndex]);
    let priceChange = rawChange;

    if (rawChange !== null && sign.includes("-")) {
      priceChange = rawChange * -1;
    }

    await conn.query(
      `
      INSERT INTO stocks (
        stock_code,
        stock_name,
        market_type,
        industry,
        is_active
      )
      VALUES (?, ?, '上市', '未分類', 1)
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
        toNumber(row[openIndex]),
        toNumber(row[highIndex]),
        toNumber(row[lowIndex]),
        closePrice,
        priceChange,
        toLots(row[volumeIndex]),
        toNumber(row[amountIndex]),
        toNumber(row[countIndex]),
      ],
    );

    imported++;
  }

  return imported;
}

async function importInstitutionalTrades(conn, twseDate, sqlDate) {
  const url = `https://www.twse.com.tw/rwd/zh/fund/T86?date=${twseDate}&selectType=ALLBUT0999&response=json`;
  const json = await fetchJson(url);

  if (json.stat && !String(json.stat).includes("OK")) {
    throw new Error(`三大法人查詢失敗：${json.stat}`);
  }

  const table = getTable(json, ["證券代號", "投信買賣超", "三大法人買賣超"]);

  const codeIndex = fieldIndex(table.fields, "證券代號");

  const foreignBuyIndex = fieldIndexAll(table.fields, ["外陸資", "買進股數"]);
  const foreignSellIndex = fieldIndexAll(table.fields, ["外陸資", "賣出股數"]);
  const foreignNetIndex = fieldIndexAll(table.fields, ["外陸資", "買賣超"]);

  const trustBuyIndex = fieldIndexAll(table.fields, ["投信", "買進股數"]);
  const trustSellIndex = fieldIndexAll(table.fields, ["投信", "賣出股數"]);
  const trustNetIndex = fieldIndexAll(table.fields, ["投信", "買賣超"]);

  const dealerNetIndex = fieldIndex(table.fields, "自營商買賣超股數");
  const totalNetIndex = fieldIndex(table.fields, "三大法人買賣超股數");

  let imported = 0;

  for (const row of table.data) {
    const stockCode = stripHtml(row[codeIndex]);

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
        toLots(row[foreignBuyIndex]),
        toLots(row[foreignSellIndex]),
        toLots(row[foreignNetIndex]),
        toLots(row[trustBuyIndex]),
        toLots(row[trustSellIndex]),
        toLots(row[trustNetIndex]),
        toLots(row[dealerNetIndex]),
        toLots(row[totalNetIndex]),
      ],
    );

    imported++;
  }

  return imported;
}

async function main() {
  const { twseDate, sqlDate } = normalizeDate(process.argv[2]);
  const conn = await pool.getConnection();

  try {
    console.log(`開始匯入上市資料：${sqlDate}`);

    await conn.beginTransaction();

    const priceCount = await importDailyPrices(conn, twseDate, sqlDate);
    const institutionalCount = await importInstitutionalTrades(
      conn,
      twseDate,
      sqlDate,
    );

    await conn.commit();

    console.log("匯入完成");
    console.log(`每日收盤行情：${priceCount} 筆`);
    console.log(`三大法人買賣超：${institutionalCount} 筆`);
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
