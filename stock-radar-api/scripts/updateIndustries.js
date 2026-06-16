import pool from "../db.js";

const SOURCES = [
  {
    marketType: "上市",
    label: "TWSE 上市公司基本資料",
    urls: [
      "https://openapi.twse.com.tw/v1/opendata/t187ap03_L",
      "https://mopsfin.twse.com.tw/opendata/t187ap03_L.csv",
    ],
  },
  {
    marketType: "上櫃",
    label: "TPEx 上櫃公司基本資料",
    urls: [
      "https://www.tpex.org.tw/openapi/v1/t187ap03_O",
      "https://mopsfin.twse.com.tw/opendata/t187ap03_O.csv",
    ],
  },
];

function stripHtml(value) {
  return String(value ?? "")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, "")
    .replace(/\u00a0/g, "")
    .trim();
}

const INDUSTRY_CODE_NAME_MAP = new Map([
  ["1", "水泥工業"],
  ["2", "食品工業"],
  ["3", "塑膠工業"],
  ["4", "紡織纖維"],
  ["5", "電機機械"],
  ["6", "電器電纜"],
  ["7", "化學生技醫療"],
  ["8", "玻璃陶瓷"],
  ["9", "造紙工業"],
  ["10", "鋼鐵工業"],
  ["11", "橡膠工業"],
  ["12", "汽車工業"],
  ["14", "建材營造"],
  ["15", "航運業"],
  ["16", "觀光事業"],
  ["17", "金融保險"],
  ["18", "貿易百貨"],
  ["20", "其他"],
  ["21", "化學工業"],
  ["22", "生技醫療業"],
  ["23", "油電燃氣業"],
  ["24", "半導體業"],
  ["25", "電腦及週邊設備業"],
  ["26", "光電業"],
  ["27", "通信網路業"],
  ["28", "電子零組件業"],
  ["29", "電子通路業"],
  ["30", "資訊服務業"],
  ["31", "其他電子業"],
  ["32", "文化創意業"],
  ["33", "農業科技業"],
  ["34", "電子商務"],
  ["35", "綠能環保"],
  ["36", "數位雲端"],
  ["37", "運動休閒"],
  ["38", "居家生活"],
]);

function formatIndustryName(value) {
  const text = String(value ?? "").trim();

  if (!text || text === "-" || text === "--") {
    return "未分類";
  }

  if (/^\d+$/.test(text)) {
    const normalizedCode = String(Number(text));
    return INDUSTRY_CODE_NAME_MAP.get(normalizedCode) || text;
  }

  return text;
}

function normalizeKey(value) {
  return stripHtml(value)
    .replace(/^﻿/, "")
    .replace(/\s+/g, "")
    .replace(/　/g, "")
    .trim();
}

function getObjectValue(row, candidates) {
  if (!row || Array.isArray(row) || typeof row !== "object") return "";

  const entries = Object.entries(row);

  for (const candidate of candidates) {
    const expected = normalizeKey(candidate);
    const found = entries.find(([key]) => normalizeKey(key) === expected);
    if (found) return found[1];
  }

  for (const candidate of candidates) {
    const expected = normalizeKey(candidate);
    const found = entries.find(([key]) => normalizeKey(key).includes(expected));
    if (found) return found[1];
  }

  return "";
}

function isCommonStockCode(code) {
  return /^\d{4}$/.test(String(code || "")) && !String(code || "").startsWith("00");
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const nextChar = text[index + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        cell += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(cell);
      cell = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && nextChar === "\n") index += 1;
      row.push(cell);
      if (row.some((item) => String(item).trim() !== "")) rows.push(row);
      row = [];
      cell = "";
      continue;
    }

    cell += char;
  }

  row.push(cell);
  if (row.some((item) => String(item).trim() !== "")) rows.push(row);

  if (rows.length < 2) return [];

  const headers = rows[0].map((item) => normalizeKey(item));

  return rows.slice(1).map((values) => {
    const result = {};
    headers.forEach((header, index) => {
      result[header] = stripHtml(values[index]);
    });
    return result;
  });
}

async function fetchRowsFromUrl(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 stock-radar-api",
      Accept: "application/json,text/csv,text/plain,*/*",
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const text = (await response.text()).replace(/^\uFEFF/, "").trim();

  if (!text) {
    throw new Error("資料來源回傳空白內容");
  }

  const contentType = response.headers.get("content-type") || "";

  if (contentType.includes("json") || text.startsWith("[") || text.startsWith("{")) {
    const json = JSON.parse(text);
    if (Array.isArray(json)) return json;
    if (Array.isArray(json.data)) return json.data;
    if (Array.isArray(json.aaData)) return json.aaData;
    if (Array.isArray(json.tables)) {
      const table = json.tables.find((item) => Array.isArray(item?.data));
      if (table) return table.data;
    }
    throw new Error("JSON 內找不到資料列");
  }

  return parseCsv(text);
}

async function fetchRowsWithFallback(source) {
  const errors = [];

  for (const url of source.urls) {
    try {
      const rows = await fetchRowsFromUrl(url);
      if (rows.length > 0) {
        return { rows, url };
      }
      errors.push(`${url}：沒有資料列`);
    } catch (error) {
      errors.push(`${url}：${error.message}`);
    }
  }

  throw new Error(errors.join("；"));
}

function normalizeStockInfo(row) {
  if (Array.isArray(row)) {
    return {
      stockCode: stripHtml(row[1] ?? row[0]),
      stockName: stripHtml(row[3] ?? row[2] ?? row[1]),
      industry: stripHtml(row[4] ?? row[3] ?? ""),
    };
  }

  return {
    stockCode: stripHtml(getObjectValue(row, ["公司代號", "股票代號", "證券代號", "有價證券代號", "代號"])),
    stockName: stripHtml(getObjectValue(row, ["公司簡稱", "公司名稱", "股票名稱", "證券名稱", "名稱"])),
    industry: stripHtml(getObjectValue(row, ["產業別", "產業類別", "產業名稱", "類股"])),
  };
}

function normalizeIndustry(value) {
  const industry = formatIndustryName(stripHtml(value));

  if (!industry || industry === "-" || industry === "--") {
    return "未分類";
  }

  return industry;
}

async function updateSource(conn, source) {
  const { rows, url } = await fetchRowsWithFallback(source);
  let updated = 0;
  let skipped = 0;

  for (const row of rows) {
    const info = normalizeStockInfo(row);
    const stockCode = info.stockCode;

    if (!isCommonStockCode(stockCode)) {
      skipped += 1;
      continue;
    }

    const stockName = info.stockName || stockCode;
    const industry = normalizeIndustry(info.industry);

    if (industry === "未分類") {
      skipped += 1;
      continue;
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
      VALUES (?, ?, ?, ?, 1)
      ON DUPLICATE KEY UPDATE
        stock_name = VALUES(stock_name),
        market_type = VALUES(market_type),
        industry = VALUES(industry),
        is_active = 1,
        updated_at = NOW()
      `,
      [stockCode, stockName, source.marketType, industry],
    );

    updated += 1;
  }

  return {
    label: source.label,
    marketType: source.marketType,
    url,
    sourceRows: rows.length,
    updated,
    skipped,
  };
}

async function getIndustryStats(conn) {
  const rows = await conn.query(`
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

  return rows.map((row) => ({
    market_type: row.market_type,
    total_count: Number(row.total_count || 0),
    unclassified_count: Number(row.unclassified_count || 0),
    industry_count: Number(row.industry_count || 0),
  }));
}

async function main() {
  let conn;

  try {
    conn = await pool.getConnection();

    console.log("開始補齊股票產業分類");

    const results = [];

    for (const source of SOURCES) {
      console.log(`讀取：${source.label}`);
      const result = await updateSource(conn, source);
      results.push(result);
      console.log(`完成：${result.marketType}，更新 ${result.updated} 筆，略過 ${result.skipped} 筆`);
      console.log(`來源：${result.url}`);
    }

    const stats = await getIndustryStats(conn);

    console.log("");
    console.log("產業分類統計：");
    console.table(stats);
    console.log("補齊股票產業分類完成");
  } catch (error) {
    console.error("補齊股票產業分類失敗：", error.message);
    process.exitCode = 1;
  } finally {
    if (conn) conn.release();
    await pool.end();
  }
}

main();
