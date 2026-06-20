import path from "node:path";
import { fileURLToPath } from "node:url";
import pool from "../db.js";

function getTaiwanToday() {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Taipei",
  }).format(new Date());
}

async function getLatestTradeDateFromDb(conn) {
  const rows = await conn.query(`
    SELECT DATE_FORMAT(MAX(trade_date), '%Y-%m-%d') AS latest_date
    FROM (
      SELECT trade_date FROM institutional_trades
      UNION ALL
      SELECT trade_date FROM daily_prices
      UNION ALL
      SELECT trade_date FROM market_daily_summaries
    ) source_dates
  `);

  return rows[0]?.latest_date || null;
}

function normalizeDateText(inputDate) {
  const dateText = inputDate || getTaiwanToday();
  const clean = String(dateText).replaceAll("-", "").replaceAll("/", "").trim();

  if (!/^\d{8}$/.test(clean)) {
    throw new Error("日期格式錯誤，請使用 YYYY-MM-DD，例如 2026-06-17");
  }

  const year = Number(clean.slice(0, 4));
  const rocYear = year - 1911;

  if (rocYear <= 0) {
    throw new Error("民國日期轉換失敗，西元年必須大於 1911");
  }

  return {
    twseDate: clean,
    tpexDate: `${rocYear}/${clean.slice(4, 6)}/${clean.slice(6, 8)}`,
    sqlDate: `${clean.slice(0, 4)}-${clean.slice(4, 6)}-${clean.slice(6, 8)}`,
  };
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
  let text = stripHtml(value)
    .replaceAll(",", "")
    .replaceAll("+", "")
    .replace(/億/g, "")
    .replace(/元/g, "")
    .trim();

  if (!text || text === "--" || text === "---" || text === "X") {
    return null;
  }

  const isParenthesesNegative = /^\(.+\)$/.test(text);
  text = text.replace(/[()（）]/g, "");

  const number = Number(text);
  if (Number.isNaN(number)) return null;

  return isParenthesesNegative ? -number : number;
}

function toIntegerAmount(value, multiplier = 1) {
  const number = toNumber(value);

  if (number === null) return 0;

  return Math.round(number * multiplier);
}

async function fetchText(url, referer = "") {
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
    throw new Error(`HTTP ${response.status}`);
  }

  const cleanText = text.replace(/^\uFEFF/, "").trim();

  if (!cleanText) {
    throw new Error("回傳空資料");
  }

  return cleanText;
}

async function fetchJsonCandidate(url, referer = "") {
  const text = await fetchText(url, referer);

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`回傳不是 JSON，前 160 字：${text.slice(0, 160)}`);
  }
}

async function fetchFirstJson(candidates, label) {
  const errors = [];

  for (const candidate of candidates) {
    try {
      const json = await fetchJsonCandidate(candidate.url, candidate.referer);
      return {
        json,
        sourceUrl: candidate.url,
      };
    } catch (error) {
      errors.push(`${candidate.name || candidate.url}：${error.message}`);
    }
  }

  throw new Error(`${label} 全部來源失敗；${errors.join("；")}`);
}

function getCandidateTables(json) {
  const tables = [];

  if (Array.isArray(json)) {
    tables.push({ title: "array", fields: [], data: json });
  }

  if (Array.isArray(json?.tables)) {
    for (const table of json.tables) {
      tables.push({
        title: table.title || table.subtitle || "",
        fields: table.fields || table.header || [],
        data: table.data || table.aaData || table.rows || [],
      });
    }
  }

  const directRows = ["data", "aaData", "rows", "dataList"];
  for (const key of directRows) {
    if (Array.isArray(json?.[key])) {
      tables.push({
        title: json.title || json.subtitle || key,
        fields: json.fields || json.header || json.columns || [],
        data: json[key],
      });
    }
  }

  for (const key of Object.keys(json || {})) {
    if (!key.startsWith("fields")) continue;

    const suffix = key.replace("fields", "");
    const dataKey = `data${suffix}`;

    if (Array.isArray(json[key]) && Array.isArray(json[dataKey])) {
      tables.push({
        title: `${key}/${dataKey}`,
        fields: json[key],
        data: json[dataKey],
      });
    }
  }

  return tables.filter((table) => Array.isArray(table.data) && table.data.length > 0);
}

function tableText(table) {
  return [
    table.title,
    ...(table.fields || []),
    ...(table.data || []).slice(0, 5).flatMap((row) =>
      Array.isArray(row) ? row : Object.keys(row || {}).concat(Object.values(row || {})),
    ),
  ]
    .map((item) => stripHtml(item))
    .join("|");
}

function hasNetAmountKeyword(text) {
  return text.includes("買賣超") || text.includes("買賣差額") || text.includes("差額");
}

function pickInstitutionalAmountTable(json, label) {
  const tables = getCandidateTables(json);

  const table = tables.find((item) => {
    const text = tableText(item);
    return (
      text.includes("買進") &&
      text.includes("賣出") &&
      hasNetAmountKeyword(text) &&
      (text.includes("外資") || text.includes("陸資") || text.includes("投信") || text.includes("自營商"))
    );
  });

  if (!table) {
    const keys = Object.keys(json || {}).join(", ");
    const tableHints = tables
      .slice(0, 3)
      .map((item) => tableText(item).slice(0, 220))
      .join(" || ");
    throw new Error(`${label} 找不到三大法人金額表，回傳 keys：${keys}，table hints：${tableHints}`);
  }

  return table;
}

function fieldIndex(fields, keywords) {
  if (!Array.isArray(fields)) return -1;

  const keywordList = Array.isArray(keywords) ? keywords : [keywords];

  return fields.findIndex((field) => {
    const text = normalizeText(field);
    return keywordList.every((keyword) => text.includes(normalizeText(keyword)));
  });
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

function rowValue(row, fields, candidates, fallbackIndexes = []) {
  if (Array.isArray(row)) {
    for (const candidate of candidates) {
      const index = fieldIndex(fields, candidate);
      if (index >= 0 && row[index] !== undefined) return row[index];
    }

    for (const index of fallbackIndexes) {
      if (row[index] !== undefined) return row[index];
    }

    return undefined;
  }

  return objectValue(row, candidates);
}

function detectAmountMultiplier(json, table) {
  const text = [
    json?.title,
    json?.subtitle,
    json?.stat,
    table?.title,
    ...(table?.fields || []),
  ]
    .map((item) => stripHtml(item))
    .join("|");

  if (text.includes("百萬元")) return 1_000_000;
  if (text.includes("仟元") || text.includes("千元")) return 1_000;
  if (text.includes("億元")) return 100_000_000;

  return 1;
}

function addAmount(target, rowAmount) {
  target.buy += rowAmount.buy;
  target.sell += rowAmount.sell;
  target.net += rowAmount.net;
}

function emptyAmount() {
  return { buy: 0, sell: 0, net: 0 };
}

function classifyRowName(name) {
  const normalized = normalizeText(name);

  if (!normalized) return "unknown";

  if (normalized.includes("合計") || normalized.includes("總計") || normalized.includes("三大法人合計")) {
    return "total";
  }

  if (normalized.includes("投信")) return "investmentTrust";

  if (normalized.includes("外資") || normalized.includes("陸資")) return "foreign";

  if (normalized.includes("自營商")) return "dealer";

  return "unknown";
}

function isAggregateDealerName(name) {
  const normalized = normalizeText(name);
  return normalized === "自營商" || normalized === "自營商合計";
}

function isAggregateForeignName(name) {
  const normalized = normalizeText(name);
  return (
    normalized === "外資及陸資" ||
    normalized === "外資" ||
    normalized === "外陸資" ||
    normalized === "外資及陸資合計"
  );
}

function parseInstitutionalAmountJson(json, label) {
  if (json?.stat && !String(json.stat).toLowerCase().includes("ok")) {
    throw new Error(`${label} 回傳狀態：${json.stat}`);
  }

  const table = pickInstitutionalAmountTable(json, label);
  const multiplier = detectAmountMultiplier(json, table);

  const rows = table.data;
  const fields = table.fields || [];

  const foreignRows = [];
  const dealerRows = [];
  const trustRows = [];
  const totalRows = [];

  for (const row of rows) {
    const name = stripHtml(
      rowValue(row, fields, ["單位名稱", "身份別", "身分別", "類別", "項目", "名稱", "法人"], [0]),
    );

    const buy = toIntegerAmount(
      rowValue(row, fields, [["買進", "金額"], "買進金額", "買進"], [1]),
      multiplier,
    );
    const sell = toIntegerAmount(
      rowValue(row, fields, [["賣出", "金額"], "賣出金額", "賣出"], [2]),
      multiplier,
    );
    const net = toIntegerAmount(
      rowValue(
        row,
        fields,
        [["買賣超", "金額"], ["買賣差額"], ["差額"], "買賣超金額", "買賣差額", "買賣超"],
        [3],
      ),
      multiplier,
    );

    const rowAmount = { name, buy, sell, net };
    const type = classifyRowName(name);

    if (type === "foreign") foreignRows.push(rowAmount);
    if (type === "investmentTrust") trustRows.push(rowAmount);
    if (type === "dealer") dealerRows.push(rowAmount);
    if (type === "total") totalRows.push(rowAmount);
  }

  const foreign = emptyAmount();
  const investmentTrust = emptyAmount();
  const dealer = emptyAmount();
  const total = emptyAmount();

  const aggregateForeignRow = foreignRows.find((row) => isAggregateForeignName(row.name));
  const aggregateDealerRow = dealerRows.find((row) => isAggregateDealerName(row.name));

  if (aggregateForeignRow) {
    addAmount(foreign, aggregateForeignRow);
  } else {
    foreignRows.forEach((row) => addAmount(foreign, row));
  }

  trustRows.forEach((row) => addAmount(investmentTrust, row));

  if (aggregateDealerRow) {
    addAmount(dealer, aggregateDealerRow);
  } else {
    dealerRows.forEach((row) => addAmount(dealer, row));
  }

  if (totalRows.length > 0) {
    totalRows.forEach((row) => addAmount(total, row));
  } else {
    total.buy = foreign.buy + investmentTrust.buy + dealer.buy;
    total.sell = foreign.sell + investmentTrust.sell + dealer.sell;
    total.net = foreign.net + investmentTrust.net + dealer.net;
  }

  const parsedRowCount = foreignRows.length + trustRows.length + dealerRows.length + totalRows.length;

  if (parsedRowCount === 0) {
    throw new Error(`${label} 找不到可分類法人金額列`);
  }

  return {
    foreign,
    investmentTrust,
    dealer,
    total,
    rowCount: rows.length,
    parsedRowCount,
    multiplier,
  };
}

function buildTwseCandidates(twseDate) {
  const base = "https://www.twse.com.tw/rwd/zh/fund/BFI82U";
  const legacy = "https://www.twse.com.tw/fund/BFI82U";

  return [
    {
      name: "TWSE BFI82U rwd dayDate type=day",
      url: `${base}?dayDate=${twseDate}&type=day&response=json`,
      referer: "https://www.twse.com.tw/zh/page/trading/fund/BFI82U.html",
    },
    {
      name: "TWSE BFI82U rwd dayDate",
      url: `${base}?dayDate=${twseDate}&response=json`,
      referer: "https://www.twse.com.tw/zh/page/trading/fund/BFI82U.html",
    },
    {
      name: "TWSE BFI82U legacy dayDate type=day",
      url: `${legacy}?dayDate=${twseDate}&type=day&response=json`,
      referer: "https://www.twse.com.tw/zh/page/trading/fund/BFI82U.html",
    },
  ];
}

function buildTpexCandidates(tpexDate) {
  const encodedDate = encodeURIComponent(tpexDate);

  return [
    {
      name: "TPEx 3itrade_sum 3itrade_sum_result",
      url: `https://www.tpex.org.tw/web/stock/3insti/3itrade_sum/3itrade_sum_result.php?l=zh-tw&o=json&t=D&d=${encodedDate}`,
      referer: "https://www.tpex.org.tw/zh-tw/mainboard/trading/major-institutional/3itrade/summary.html",
    },
    {
      name: "TPEx 3itrade_sum 3itrdsum_result",
      url: `https://www.tpex.org.tw/web/stock/3insti/3itrade_sum/3itrdsum_result.php?l=zh-tw&o=json&t=D&d=${encodedDate}`,
      referer: "https://www.tpex.org.tw/zh-tw/mainboard/trading/major-institutional/3itrade/summary.html",
    },
    {
      name: "TPEx 3itrdsum 3itrdsum_result",
      url: `https://www.tpex.org.tw/web/stock/3insti/3itrdsum/3itrdsum_result.php?l=zh-tw&o=json&t=D&d=${encodedDate}`,
      referer: "https://www.tpex.org.tw/zh-tw/mainboard/trading/major-institutional/3itrade/summary.html",
    },
    {
      name: "TPEx zh-tw ajax institutional summary",
      url: `https://www.tpex.org.tw/www/zh-tw/insti/summary?date=${encodedDate}&response=json`,
      referer: "https://www.tpex.org.tw/zh-tw/mainboard/trading/major-institutional/3itrade/summary.html",
    },
  ];
}

async function upsertInstitutionalAmountSummary(conn, sqlDate, marketType, parsed, sourceUrl, sourceName) {
  await conn.query(
    `
    INSERT INTO institutional_amount_summaries (
      trade_date,
      market_type,
      foreign_buy_amount,
      foreign_sell_amount,
      foreign_net_amount,
      investment_trust_buy_amount,
      investment_trust_sell_amount,
      investment_trust_net_amount,
      dealer_buy_amount,
      dealer_sell_amount,
      dealer_net_amount,
      total_buy_amount,
      total_sell_amount,
      total_net_amount,
      source,
      source_url
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      foreign_buy_amount = VALUES(foreign_buy_amount),
      foreign_sell_amount = VALUES(foreign_sell_amount),
      foreign_net_amount = VALUES(foreign_net_amount),
      investment_trust_buy_amount = VALUES(investment_trust_buy_amount),
      investment_trust_sell_amount = VALUES(investment_trust_sell_amount),
      investment_trust_net_amount = VALUES(investment_trust_net_amount),
      dealer_buy_amount = VALUES(dealer_buy_amount),
      dealer_sell_amount = VALUES(dealer_sell_amount),
      dealer_net_amount = VALUES(dealer_net_amount),
      total_buy_amount = VALUES(total_buy_amount),
      total_sell_amount = VALUES(total_sell_amount),
      total_net_amount = VALUES(total_net_amount),
      source = VALUES(source),
      source_url = VALUES(source_url),
      updated_at = NOW()
    `,
    [
      sqlDate,
      marketType,
      parsed.foreign.buy,
      parsed.foreign.sell,
      parsed.foreign.net,
      parsed.investmentTrust.buy,
      parsed.investmentTrust.sell,
      parsed.investmentTrust.net,
      parsed.dealer.buy,
      parsed.dealer.sell,
      parsed.dealer.net,
      parsed.total.buy,
      parsed.total.sell,
      parsed.total.net,
      sourceName,
      sourceUrl,
    ],
  );
}

async function importMarketInstitutionalAmount(conn, config) {
  const { json, sourceUrl } = await fetchFirstJson(
    config.candidates,
    config.marketType,
  );
  const parsed = parseInstitutionalAmountJson(json, config.marketType);

  await upsertInstitutionalAmountSummary(
    conn,
    config.sqlDate,
    config.marketType,
    parsed,
    sourceUrl,
    config.sourceName,
  );

  return {
    market_type: config.marketType,
    source_url: sourceUrl,
    row_count: parsed.rowCount,
    parsed_row_count: parsed.parsedRowCount,
    multiplier: parsed.multiplier,
    total_net_amount: parsed.total.net,
  };
}

export async function importInstitutionalAmountSummariesForDate(conn, inputDate = null) {
  const latestDbDate = inputDate ? null : await getLatestTradeDateFromDb(conn);
  const { twseDate, tpexDate, sqlDate } = normalizeDateText(inputDate || latestDbDate);

  const configs = [
    {
      marketType: "上市",
      sqlDate,
      candidates: buildTwseCandidates(twseDate),
      sourceName: "TWSE BFI82U 三大法人買賣金額統計表",
    },
    {
      marketType: "上櫃",
      sqlDate,
      candidates: buildTpexCandidates(tpexDate),
      sourceName: "TPEx 三大法人買賣金額統計表",
    },
  ];

  const results = [];
  const errors = [];

  for (const config of configs) {
    try {
      const result = await importMarketInstitutionalAmount(conn, config);
      results.push(result);
    } catch (error) {
      errors.push(`${config.marketType}：${error.message}`);
    }
  }

  if (results.length === 0) {
    throw new Error(errors.join("；"));
  }

  return { sqlDate, results, errors };
}

function isMainModule() {
  return Boolean(process.argv[1]) && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

async function main() {
  const conn = await pool.getConnection();

  try {
    const inputDate = process.argv[2] || null;
    const { sqlDate, results, errors } = await importInstitutionalAmountSummariesForDate(conn, inputDate);

    console.log("開始匯入三大法人官方買賣金額");
    console.log(`交易日期：${sqlDate}`);

    for (const result of results) {
      console.log(
        `完成：${result.market_type}，原始 ${result.row_count} 列，可解析 ${result.parsed_row_count} 列，買賣超 ${result.total_net_amount}`,
      );
      console.log(`來源：${result.source_url}`);
    }

    console.log(`完成：匯入 / 更新 ${results.length} 筆市場法人金額總覽`);

    if (errors.length > 0) {
      console.log(`部分來源未完成：${errors.join("；")}`);
    }
  } catch (error) {
    console.error("匯入三大法人官方買賣金額失敗");
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
