import pool from "../db.js";

const REQUEST_TIMEOUT_MS = 15000;
const TAIWAN_TIME_ZONE = "Asia/Taipei";

const TWSE_ETF_PRODUCT_URL = "https://www.twse.com.tw/zh/products/securities/etf/products/list.html";
const TPEX_ETF_INFO_URL = "https://www.tpex.org.tw/zh-tw/product/etf/product/detail.html";

const OFFICIAL_LIST_SOURCES = [
  {
    name: "TWSE ETF 商品資訊",
    marketType: "上市",
    fundType: "ETF",
    urls: [
      TWSE_ETF_PRODUCT_URL,
      "https://www.twse.com.tw/rwd/zh/ETF/list?response=json",
      "https://www.twse.com.tw/zh/ETF/list?response=json",
    ],
  },
  {
    name: "TPEx ETF 商品資訊",
    marketType: "上櫃",
    fundType: "ETF",
    optional: true,
    urls: [
      "https://www.tpex.org.tw/zh-tw/product/etf/product/list.html",
      "https://www.tpex.org.tw/zh-tw/product/etf/info/month-stat.html",
    ],
  },
];

const TPEX_DETAIL_TYPES = [
  "domestic",
  "foreign",
  "bond",
  "futures",
  "leveraged",
  "active",
  "stock",
  "balance",
];

function getTaiwanNowText() {
  return new Date().toLocaleString("zh-TW", {
    timeZone: TAIWAN_TIME_ZONE,
    hour12: false,
  });
}

function stripHtml(value) {
  return String(value ?? "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<br\s*\/?\s*>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x2F;/g, "/")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/^\uFEFF/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeKey(value) {
  return stripHtml(value)
    .replace(/[\s　()（）_\-\/：:、，,.\[\]【】「」『』]/g, "")
    .toLowerCase();
}

function pick(row, candidates) {
  const entries = Object.entries(row || {});

  for (const candidate of candidates) {
    const target = normalizeKey(candidate);
    const found = entries.find(([key, value]) => normalizeKey(key) === target && stripHtml(value));
    if (found) return stripHtml(found[1]);
  }

  for (const candidate of candidates) {
    const target = normalizeKey(candidate);
    const found = entries.find(([key, value]) => normalizeKey(key).includes(target) && stripHtml(value));
    if (found) return stripHtml(found[1]);
  }

  return "";
}

function normalizeStockCode(value) {
  const text = stripHtml(value).replace(/[^0-9A-Z]/gi, "").toUpperCase();
  const match = text.match(/[0-9]{4,6}[A-Z]?/i);
  return match ? match[0].toUpperCase() : "";
}

function normalizeDate(value) {
  const text = stripHtml(value)
    .replace(/[年月]/g, "/")
    .replace(/[日號]/g, "")
    .replace(/\./g, "/")
    .replace(/-/g, "/")
    .trim();

  if (!text || ["-", "--", "無", "不適用", "na", "n/a"].includes(text.toLowerCase())) return null;

  let match = text.match(/(20\d{2}|1\d{2})\/(\d{1,2})\/(\d{1,2})/);
  if (match) {
    const year = match[1].length === 3 ? Number(match[1]) + 1911 : Number(match[1]);
    const month = String(Number(match[2])).padStart(2, "0");
    const day = String(Number(match[3])).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  match = text.match(/(20\d{2}|1\d{2})(\d{2})(\d{2})/);
  if (match) {
    const year = match[1].length === 3 ? Number(match[1]) + 1911 : Number(match[1]);
    return `${year}-${match[2]}-${match[3]}`;
  }

  return null;
}

function inferFundType(profile) {
  const raw = [profile.fund_type, profile.stock_name, profile.underlying_index, profile.stock_code]
    .filter(Boolean)
    .join(" ");

  if (/主動/.test(raw)) return "主動式 ETF";
  if (/債|Bond|B$|C$/i.test(raw)) return "債券 ETF";
  if (/反1|反向|Inverse|R$/i.test(raw)) return "反向 ETF";
  if (/正2|槓桿|Leveraged|L$/i.test(raw)) return "槓桿 ETF";
  if (/期貨|原油|黃金|白銀|商品|Futures/i.test(raw)) return "期貨 / 商品 ETF";
  if (/多資產|平衡|T$/i.test(raw)) return "多資產 ETF";
  if (/國外|全球|美國|日本|中國|印度|越南|香港|歐洲|NASDAQ|S&P|MSCI|K$/i.test(raw)) return "國外成分股 ETF";
  if (/台灣|臺灣|加權|櫃買|電子|金融|半導體/.test(raw)) return "國內成分股 ETF";
  return profile.fund_type || "ETF";
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const nextChar = text[index + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        field += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(field);
      field = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && nextChar === "\n") index += 1;
      row.push(field);
      if (row.some((item) => stripHtml(item))) rows.push(row);
      row = [];
      field = "";
      continue;
    }

    field += char;
  }

  row.push(field);
  if (row.some((item) => stripHtml(item))) rows.push(row);

  if (rows.length < 2) return [];

  const headers = rows[0].map(stripHtml);
  return rows.slice(1).map((values) => {
    const result = {};
    headers.forEach((header, index) => {
      result[header] = stripHtml(values[index]);
    });
    return result;
  });
}

function buildJsonRows(json) {
  if (!json || typeof json !== "object") return [];
  if (Array.isArray(json)) return json;

  const data = json.data || json.tables?.[0]?.data || json.result?.data || json.aaData || json.rows;
  const fields = json.fields || json.tables?.[0]?.fields || json.result?.fields || json.columns || json.titles;

  if (Array.isArray(data) && Array.isArray(fields)) {
    return data.map((row) => {
      const result = {};
      fields.forEach((field, index) => {
        const key = typeof field === "object" ? field.name || field.title || field.data || index : field;
        result[stripHtml(key)] = Array.isArray(row) ? stripHtml(row[index]) : stripHtml(row?.[key]);
      });
      return result;
    });
  }

  if (Array.isArray(data)) return data;
  return [];
}

function extractCells(rowHtml) {
  return [...String(rowHtml).matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((match) => stripHtml(match[1]));
}

function parseHtmlTables(text) {
  const html = String(text || "");
  const tableHtmlList = [...html.matchAll(/<table[\s\S]*?<\/table>/gi)].map((match) => match[0]);
  const scopes = tableHtmlList.length > 0 ? tableHtmlList : [html];
  const allRows = [];

  for (const scope of scopes) {
    const rows = [...scope.matchAll(/<tr[\s\S]*?<\/tr>/gi)].map((match) => extractCells(match[0])).filter((cells) => cells.length > 0);
    if (rows.length < 2) continue;

    let headerIndex = rows.findIndex((cells) => cells.some((cell) => /證券代號|ETF代號|股票代號|代號|code/i.test(cell)));
    if (headerIndex < 0) headerIndex = 0;

    const headers = rows[headerIndex].map(stripHtml);
    for (const values of rows.slice(headerIndex + 1)) {
      if (values.length < 2) continue;
      const result = {};
      headers.forEach((header, index) => {
        result[header || `欄位${index + 1}`] = stripHtml(values[index]);
      });
      allRows.push(result);
    }
  }

  return allRows;
}

function parseHtmlKeyValueRows(text) {
  const rows = [...String(text || "").matchAll(/<tr[\s\S]*?<\/tr>/gi)].map((match) => extractCells(match[0])).filter((cells) => cells.length >= 2);
  const result = {};

  for (const cells of rows) {
    for (let index = 0; index < cells.length - 1; index += 2) {
      const key = stripHtml(cells[index]);
      const value = stripHtml(cells[index + 1]);
      if (key && value && key.length <= 30) result[key] = value;
    }

    if (cells.length === 2 && cells[0] && cells[1]) {
      result[cells[0]] = cells[1];
    }
  }

  return result;
}

function parseRemoteRows(text) {
  const cleanText = String(text || "").replace(/^\uFEFF/, "").trim();
  if (!cleanText) return [];

  if (cleanText.startsWith("{") || cleanText.startsWith("[")) {
    try {
      return buildJsonRows(JSON.parse(cleanText));
    } catch {
      return [];
    }
  }

  if (cleanText.includes("<table") || cleanText.includes("<tr")) {
    const rows = parseHtmlTables(cleanText);
    if (rows.length > 0) return rows;
  }

  if (cleanText.includes(",")) return parseCsv(cleanText);
  return [];
}

async function fetchText(url, label) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 StockRadar/1.2.5",
        Accept: "application/json,text/html,text/csv,text/plain,*/*",
        Referer: "https://www.twse.com.tw/",
      },
    });

    if (!response.ok) throw new Error(`${label} HTTP ${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

function normalizeProfile(row, source) {
  const stockCode = normalizeStockCode(
    pick(row, ["證券代號", "ETF代號", "基金代號", "代號", "股票代號", "Code", "SecuritiesCode", "SecuritiesCompanyCode"]),
  );

  if (!stockCode) return null;

  const stockName =
    pick(row, ["證券簡稱", "ETF名稱", "基金名稱", "中文簡稱", "名稱", "股票名稱", "Name", "CompanyName"]) || stockCode;
  const issuer = pick(row, ["發行人", "基金經理公司", "基金管理公司", "投信", "投信公司", "經理公司", "Issuer", "Manager"]);
  const underlyingIndex = pick(row, ["標的指數", "追蹤指數", "標的指數名稱", "指數名稱", "Index", "UnderlyingIndex"]);
  const listingDate = normalizeDate(pick(row, ["上市日期", "上櫃日期", "掛牌日期", "ListingDate", "ListedDate"]));
  const fundType = pick(row, ["ETF類型", "基金類型", "商品分類", "類型", "Type", "Category"]) || source.fundType || "ETF";

  const profile = {
    stock_code: stockCode,
    stock_name: stockName,
    market_type: source.marketType,
    fund_type: fundType,
    underlying_index: underlyingIndex || null,
    issuer: issuer || null,
    listing_date: listingDate,
    source: source.name,
    source_url: source.sourceUrl || source.url || source.urls?.[0] || null,
  };

  profile.fund_type = inferFundType(profile);
  return profile;
}

function getPreferredTpexTypes(row) {
  const text = `${row.stock_code || ""} ${row.stock_name || ""}`;
  const types = [];

  if (/主動/.test(text)) types.push("active");
  if (/債|B$|C$/i.test(text)) types.push("bond");
  if (/反1|反向|R$/i.test(text)) types.push("leveraged");
  if (/正2|槓桿|L$/i.test(text)) types.push("leveraged");
  if (/期貨|原油|黃金|白銀|商品/.test(text)) types.push("futures");
  if (/全球|美國|日本|中國|印度|越南|香港|歐洲|K$/i.test(text)) types.push("foreign");
  if (/台灣|臺灣|加權|櫃買|電子|金融|半導體/.test(text)) types.push("domestic");

  return [...new Set([...types, ...TPEX_DETAIL_TYPES])];
}

async function ensureSchema(conn) {
  await conn.query(
    `
    ALTER TABLE stocks
      ADD COLUMN IF NOT EXISTS security_type varchar(20) NOT NULL DEFAULT 'STOCK' COMMENT 'STOCK/ETF'
      AFTER industry
    `,
  );

  await conn.query(
    `
    CREATE TABLE IF NOT EXISTS etf_profiles (
      id bigint(20) NOT NULL AUTO_INCREMENT,
      stock_code varchar(10) NOT NULL COMMENT 'ETF 代號',
      stock_name varchar(80) NOT NULL COMMENT 'ETF 名稱',
      market_type varchar(20) DEFAULT NULL COMMENT '上市/上櫃',
      fund_type varchar(50) DEFAULT NULL COMMENT 'ETF 類型',
      underlying_index varchar(100) DEFAULT NULL COMMENT '追蹤指數',
      issuer varchar(80) DEFAULT NULL COMMENT '投信/發行人',
      listing_date date DEFAULT NULL COMMENT '掛牌日期',
      source varchar(100) NOT NULL DEFAULT 'OFFICIAL' COMMENT '資料來源',
      source_url varchar(500) DEFAULT NULL COMMENT '來源網址',
      created_at datetime NOT NULL DEFAULT current_timestamp(),
      updated_at datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
      PRIMARY KEY (id),
      UNIQUE KEY uq_etf_profiles_code (stock_code),
      KEY idx_etf_profiles_market (market_type)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='ETF 主檔資料表'
    `,
  );

  const requiredColumns = [
    ["fund_type", "varchar(50) DEFAULT NULL COMMENT 'ETF 類型'"],
    ["underlying_index", "varchar(100) DEFAULT NULL COMMENT '追蹤指數'"],
    ["issuer", "varchar(80) DEFAULT NULL COMMENT '投信/發行人'"],
    ["listing_date", "date DEFAULT NULL COMMENT '掛牌日期'"],
    ["source", "varchar(100) NOT NULL DEFAULT 'OFFICIAL' COMMENT '資料來源'"],
    ["source_url", "varchar(500) DEFAULT NULL COMMENT '來源網址'"],
  ];

  for (const [columnName, definition] of requiredColumns) {
    await conn.query(`ALTER TABLE etf_profiles ADD COLUMN IF NOT EXISTS ${columnName} ${definition}`);
  }
}

async function upsertOfficialProfile(conn, profile) {
  await conn.query(
    `
    INSERT INTO etf_profiles (
      stock_code,
      stock_name,
      market_type,
      fund_type,
      underlying_index,
      issuer,
      listing_date,
      source,
      source_url
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      stock_name = COALESCE(NULLIF(VALUES(stock_name), ''), stock_name),
      market_type = COALESCE(NULLIF(VALUES(market_type), ''), market_type),
      fund_type = COALESCE(NULLIF(VALUES(fund_type), ''), fund_type),
      underlying_index = COALESCE(NULLIF(VALUES(underlying_index), ''), underlying_index),
      issuer = COALESCE(NULLIF(VALUES(issuer), ''), issuer),
      listing_date = COALESCE(VALUES(listing_date), listing_date),
      source = COALESCE(NULLIF(VALUES(source), ''), source),
      source_url = COALESCE(NULLIF(VALUES(source_url), ''), source_url),
      updated_at = CURRENT_TIMESTAMP
    `,
    [
      profile.stock_code,
      profile.stock_name,
      profile.market_type,
      profile.fund_type,
      profile.underlying_index,
      profile.issuer,
      profile.listing_date,
      profile.source,
      profile.source_url,
    ],
  );

  await conn.query(
    `
    UPDATE stocks
    SET
      stock_name = COALESCE(NULLIF(?, ''), stock_name),
      market_type = COALESCE(NULLIF(?, ''), market_type),
      industry = 'ETF',
      security_type = 'ETF',
      updated_at = CURRENT_TIMESTAMP
    WHERE stock_code = ?
    `,
    [profile.stock_name, profile.market_type, profile.stock_code],
  );
}

async function importOfficialListSource(conn, source) {
  for (const url of source.urls) {
    try {
      console.log(`讀取：${source.name} ${url}`);
      const text = await fetchText(url, source.name);
      const rows = parseRemoteRows(text);
      const profiles = rows.map((row) => normalizeProfile(row, { ...source, url, sourceUrl: url })).filter(Boolean);

      if (profiles.length === 0) {
        console.log(`略過：${source.name} ${url} 沒有可解析 ETF 主檔列`);
        continue;
      }

      let imported = 0;
      const seen = new Set();
      for (const profile of profiles) {
        if (seen.has(profile.stock_code)) continue;
        seen.add(profile.stock_code);
        await upsertOfficialProfile(conn, profile);
        imported += 1;
      }

      console.log(`完成：${source.name} 匯入 / 更新 ${imported} 筆`);
      return { source: source.name, url, count: imported };
    } catch (error) {
      console.log(`略過：${source.name} ${url} - ${error.message}`);
    }
  }

  const message = `${source.name} 所有候選來源都無法匯入，將保留既有資料並使用 stocks fallback。`;
  if (source.optional) {
    console.log(`略過：${message}`);
  } else {
    console.log(`警告：${message}`);
  }

  return { source: source.name, url: null, count: 0, warning: message };
}

async function syncFallbackFromStocks(conn) {
  await conn.query(
    `
    UPDATE stocks
    SET security_type = 'ETF', industry = 'ETF'
    WHERE stock_code REGEXP '^00[0-9A-Z]+'
       OR industry = 'ETF'
       OR market_type = 'ETF'
       OR security_type = 'ETF'
    `,
  );

  const result = await conn.query(
    `
    INSERT INTO etf_profiles (
      stock_code,
      stock_name,
      market_type,
      fund_type,
      source,
      source_url
    )
    SELECT
      stock_code,
      stock_name,
      market_type,
      'ETF',
      'stocks table sync',
      'database:stocks'
    FROM stocks s
    WHERE (s.security_type = 'ETF'
       OR s.industry = 'ETF'
       OR s.stock_code REGEXP '^00[0-9A-Z]+')
      AND NOT EXISTS (
        SELECT 1
        FROM etf_profiles e
        WHERE e.stock_code = s.stock_code
      )
    `,
  );

  console.log(`完成：stocks fallback 新增 ${Number(result?.affectedRows || 0)} 筆`);
}

async function getTpexDetailCandidates(conn) {
  return conn.query(
    `
    SELECT
      s.stock_code,
      s.stock_name,
      s.market_type,
      e.issuer,
      e.underlying_index,
      e.listing_date
    FROM stocks s
    LEFT JOIN etf_profiles e
      ON s.stock_code = e.stock_code
    WHERE (s.security_type = 'ETF'
       OR s.industry = 'ETF'
       OR s.stock_code REGEXP '^00[0-9A-Z]+')
      AND (s.market_type = '上櫃' OR e.market_type = '上櫃')
      AND (
        e.stock_code IS NULL
        OR e.issuer IS NULL
        OR e.underlying_index IS NULL
        OR e.listing_date IS NULL
        OR e.source = 'stocks table sync'
      )
    ORDER BY s.stock_code
    `,
  );
}

async function importTpexDetailProfile(conn, candidate) {
  const types = getPreferredTpexTypes(candidate);

  for (const type of types) {
    const url = `${TPEX_ETF_INFO_URL}?code=${encodeURIComponent(candidate.stock_code)}&type=${encodeURIComponent(type)}`;

    try {
      const html = await fetchText(url, `TPEx ETF 明細 ${candidate.stock_code}`);
      const row = parseHtmlKeyValueRows(html);
      const issuer = pick(row, ["基金經理公司", "發行人", "投信", "經理公司"]);
      const underlyingIndex = pick(row, ["標的指數", "追蹤指數", "指數名稱"]);
      const listingDate = normalizeDate(pick(row, ["上櫃日期", "掛牌日期", "上市日期"]));
      const stockName = pick(row, ["證券簡稱", "基金名稱", "ETF名稱", "中文簡稱"]);

      if (!issuer && !underlyingIndex && !listingDate) continue;

      const profile = {
        stock_code: candidate.stock_code,
        stock_name: stockName || candidate.stock_name,
        market_type: "上櫃",
        fund_type: inferFundType({ stock_code: candidate.stock_code, stock_name: candidate.stock_name, fund_type: type }),
        underlying_index: underlyingIndex || null,
        issuer: issuer || null,
        listing_date: listingDate,
        source: "TPEx ETF 商品明細",
        source_url: url,
      };

      await upsertOfficialProfile(conn, profile);
      return true;
    } catch {
      // 換下一個 type 候選來源。
    }
  }

  return false;
}

async function importTpexDetails(conn) {
  const candidates = await getTpexDetailCandidates(conn);
  if (candidates.length === 0) {
    console.log("略過：沒有需要補齊的上櫃 ETF 明細");
    return 0;
  }

  console.log(`開始補齊 TPEx 上櫃 ETF 明細：${candidates.length} 筆候選`);
  let imported = 0;

  for (const candidate of candidates) {
    const ok = await importTpexDetailProfile(conn, candidate);
    if (ok) imported += 1;
  }

  console.log(`完成：TPEx 上櫃 ETF 明細補齊 ${imported} 筆`);
  return imported;
}

async function getSummary(conn) {
  const rows = await conn.query(
    `
    SELECT
      COUNT(*) AS total_count,
      SUM(CASE WHEN source <> 'stocks table sync' THEN 1 ELSE 0 END) AS official_count,
      SUM(CASE WHEN issuer IS NOT NULL AND issuer <> '' THEN 1 ELSE 0 END) AS issuer_count,
      SUM(CASE WHEN underlying_index IS NOT NULL AND underlying_index <> '' THEN 1 ELSE 0 END) AS index_count,
      SUM(CASE WHEN listing_date IS NOT NULL THEN 1 ELSE 0 END) AS listing_date_count
    FROM etf_profiles
    `,
  );

  return rows[0] || {};
}

async function main() {
  const withTpexDetails = !process.argv.includes("--no-tpex-details");
  const conn = await pool.getConnection();

  try {
    console.log("====================================");
    console.log("Stock Radar V1.2.5 ETF 官方主檔同步");
    console.log(`執行時間：${getTaiwanNowText()}`);
    console.log("====================================");

    await ensureSchema(conn);

    const results = [];
    for (const source of OFFICIAL_LIST_SOURCES) {
      results.push(await importOfficialListSource(conn, source));
    }

    if (withTpexDetails) {
      const detailCount = await importTpexDetails(conn);
      results.push({ source: "TPEx ETF 商品明細", url: TPEX_ETF_INFO_URL, count: detailCount });
    }

    await syncFallbackFromStocks(conn);

    const summary = await getSummary(conn);
    console.log("====================================");
    console.log("ETF 主檔同步完成");
    console.log(`總筆數：${Number(summary.total_count || 0)}`);
    console.log(`官方來源筆數：${Number(summary.official_count || 0)}`);
    console.log(`已有基金公司：${Number(summary.issuer_count || 0)}`);
    console.log(`已有追蹤指數：${Number(summary.index_count || 0)}`);
    console.log(`已有掛牌日期：${Number(summary.listing_date_count || 0)}`);
    console.log("來源結果：");
    for (const item of results) {
      console.log(`- ${item.source}: ${item.count} 筆${item.url ? ` (${item.url})` : ""}`);
    }
    console.log("====================================");
  } catch (error) {
    console.error("同步 ETF 主檔失敗");
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    conn.release();
    await pool.end();
  }
}

main();
