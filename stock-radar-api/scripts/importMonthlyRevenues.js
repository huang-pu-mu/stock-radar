import pool from "../db.js";

const SOURCES = [
  {
    marketType: "上市",
    urls: [
      "https://mopsfin.twse.com.tw/opendata/t187ap05_L.csv",
      "https://mopsfin.twse.com.tw/opendata/t187ap05_L",
    ],
  },
  {
    marketType: "上櫃",
    urls: [
      "https://mopsfin.twse.com.tw/opendata/t187ap05_O.csv",
      "https://mopsfin.twse.com.tw/opendata/t187ap05_O",
    ],
  },
];

function stripHtml(value) {
  return String(value ?? "")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, "")
    .replace(/^\uFEFF/, "")
    .trim();
}

function normalizeKey(value) {
  return stripHtml(value)
    .replace(/[\s　()（）%％_\-\/]/g, "")
    .toLowerCase();
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
      if (row.some((item) => String(item).trim() !== "")) rows.push(row);
      row = [];
      field = "";
      continue;
    }

    field += char;
  }

  row.push(field);
  if (row.some((item) => String(item).trim() !== "")) rows.push(row);

  if (rows.length < 2) return [];
  const headers = rows[0].map(normalizeKey);

  return rows.slice(1).map((values) => {
    const result = {};
    headers.forEach((header, index) => {
      result[header] = stripHtml(values[index]);
    });
    return result;
  });
}

async function fetchRows(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 stock-radar-api",
      Accept: "text/csv,application/json,text/plain,*/*",
    },
  });

  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const text = (await response.text()).replace(/^\uFEFF/, "").trim();
  if (!text) throw new Error("資料來源空白");

  if (text.startsWith("[") || text.startsWith("{")) {
    const json = JSON.parse(text);
    if (Array.isArray(json)) return json;
    if (Array.isArray(json.data)) return json.data;
  }

  return parseCsv(text);
}

async function fetchRowsWithFallback(source) {
  const errors = [];

  for (const url of source.urls) {
    try {
      const rows = await fetchRows(url);
      if (rows.length > 0) return { rows, url };
      errors.push(`${url}：沒有資料列`);
    } catch (error) {
      errors.push(`${url}：${error.message}`);
    }
  }

  throw new Error(errors.join("；"));
}

function pick(row, candidates) {
  const entries = Object.entries(row || {});
  for (const candidate of candidates) {
    const key = normalizeKey(candidate);
    const found = entries.find(([itemKey]) => normalizeKey(itemKey) === key);
    if (found && String(found[1] ?? "").trim() !== "") return found[1];
  }
  for (const candidate of candidates) {
    const key = normalizeKey(candidate);
    const found = entries.find(([itemKey]) => normalizeKey(itemKey).includes(key));
    if (found && String(found[1] ?? "").trim() !== "") return found[1];
  }
  return "";
}

function toNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const text = String(value).replace(/,/g, "").replace(/%/g, "").trim();
  if (!text || text === "-" || text === "--") return null;
  const numberValue = Number(text);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function parseYearMonth(value) {
  const text = String(value || "").replace(/[^0-9]/g, "");
  if (/^\d{6}$/.test(text)) {
    return { year: Number(text.slice(0, 4)), month: Number(text.slice(4, 6)) };
  }
  if (/^\d{5}$/.test(text)) {
    return { year: Number(text.slice(0, 3)) + 1911, month: Number(text.slice(3, 5)) };
  }
  if (/^\d{4}$/.test(text)) {
    return { year: Number(text.slice(0, 2)) + 1911, month: Number(text.slice(2, 4)) };
  }
  return null;
}

function normalizeRow(row) {
  const stockCode = String(pick(row, ["公司代號", "股票代號", "證券代號", "代號"])).trim();
  const period = parseYearMonth(pick(row, ["資料年月", "營收年月", "年月", "出表年月"]));

  if (!/^\d{4,6}[A-Z]?$/.test(stockCode) || !period || period.month < 1 || period.month > 12) {
    return null;
  }

  return {
    stockCode,
    year: period.year,
    month: period.month,
    monthRevenue: toNumber(pick(row, ["營業收入當月營收", "當月營收", "本月營收", "營收"])),
    lastYearMonthRevenue: toNumber(pick(row, ["營業收入去年當月營收", "去年當月營收", "去年同月營收"])),
    momPercent: toNumber(pick(row, ["營業收入上月比較增減", "上月比較增減", "月增率", "月增減百分比"])),
    yoyPercent: toNumber(pick(row, ["營業收入去年同月增減", "去年同月增減", "年增率", "年增減百分比"])),
    cumulativeRevenue: toNumber(pick(row, ["累計營業收入當月累計營收", "當月累計營收", "累計營收"])),
    lastYearCumulativeRevenue: toNumber(pick(row, ["累計營業收入去年累計營收", "去年累計營收"])),
    cumulativeYoyPercent: toNumber(pick(row, ["累計營業收入前期比較增減", "前期比較增減", "累計年增率"])),
    note: String(pick(row, ["備註", "說明"])).trim(),
  };
}

async function importSource(conn, source) {
  const { rows, url } = await fetchRowsWithFallback(source);
  let imported = 0;
  let skipped = 0;

  for (const rawRow of rows) {
    const row = normalizeRow(rawRow);
    if (!row || row.monthRevenue === null) {
      skipped += 1;
      continue;
    }

    await conn.query(
      `
      INSERT INTO monthly_revenues (
        stock_code,
        revenue_year,
        revenue_month,
        month_revenue_thousand,
        month_over_month_percent,
        last_year_month_revenue_thousand,
        year_over_year_percent,
        cumulative_revenue_thousand,
        last_year_cumulative_revenue_thousand,
        cumulative_year_over_year_percent,
        note,
        source,
        source_url
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'MOPS OpenData t187ap05', ?)
      ON DUPLICATE KEY UPDATE
        month_revenue_thousand = VALUES(month_revenue_thousand),
        month_over_month_percent = VALUES(month_over_month_percent),
        last_year_month_revenue_thousand = VALUES(last_year_month_revenue_thousand),
        year_over_year_percent = VALUES(year_over_year_percent),
        cumulative_revenue_thousand = VALUES(cumulative_revenue_thousand),
        last_year_cumulative_revenue_thousand = VALUES(last_year_cumulative_revenue_thousand),
        cumulative_year_over_year_percent = VALUES(cumulative_year_over_year_percent),
        note = VALUES(note),
        source = VALUES(source),
        source_url = VALUES(source_url),
        updated_at = CURRENT_TIMESTAMP
      `,
      [
        row.stockCode,
        row.year,
        row.month,
        row.monthRevenue,
        row.momPercent,
        row.lastYearMonthRevenue,
        row.yoyPercent,
        row.cumulativeRevenue,
        row.lastYearCumulativeRevenue,
        row.cumulativeYoyPercent,
        row.note,
        url,
      ],
    );

    imported += 1;
  }

  return { marketType: source.marketType, imported, skipped, url };
}

async function main() {
  const conn = await pool.getConnection();

  try {
    console.log("開始匯入每月營收資料");
    for (const source of SOURCES) {
      const result = await importSource(conn, source);
      console.log(`完成：${result.marketType}，匯入 ${result.imported} 筆，略過 ${result.skipped} 筆`);
      console.log(`來源：${result.url}`);
    }
  } catch (error) {
    console.error("匯入每月營收資料失敗");
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    conn.release();
    await pool.end();
  }
}

main();
