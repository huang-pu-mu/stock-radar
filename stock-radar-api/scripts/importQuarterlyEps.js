import pool from "../db.js";

const SOURCES = [
  {
    marketType: "上市",
    urls: [
      "https://mopsfin.twse.com.tw/opendata/t163sb04_L.csv",
      "https://mopsfin.twse.com.tw/opendata/t163sb04_L",
    ],
  },
  {
    marketType: "上櫃",
    urls: [
      "https://mopsfin.twse.com.tw/opendata/t163sb04_O.csv",
      "https://mopsfin.twse.com.tw/opendata/t163sb04_O",
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
    .replace(/[\s　()（）%％_\-\/：:]/g, "")
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

function normalizeYear(value) {
  const text = String(value || "").replace(/[^0-9]/g, "");
  if (/^\d{4}$/.test(text)) return Number(text);
  if (/^\d{3}$/.test(text)) return Number(text) + 1911;
  return null;
}

function normalizeQuarter(value) {
  const text = String(value || "").trim();
  const match = text.match(/[1-4]/);
  return match ? Number(match[0]) : null;
}

function normalizeRow(row) {
  const stockCode = String(pick(row, ["公司代號", "股票代號", "證券代號", "代號"])).trim();
  const year = normalizeYear(pick(row, ["年度", "年", "財報年度", "資料年度"]));
  const quarter = normalizeQuarter(pick(row, ["季別", "季度", "季", "財報季別", "資料季別"]));
  const eps = toNumber(pick(row, ["基本每股盈餘", "基本每股盈餘元", "每股盈餘", "EPS", "基本每股盈餘合計"]));

  if (!/^\d{4,6}[A-Z]?$/.test(stockCode) || !year || !quarter || eps === null) return null;

  return {
    stockCode,
    year,
    quarter,
    eps,
  };
}

async function importSource(conn, source) {
  const { rows, url } = await fetchRowsWithFallback(source);
  let imported = 0;
  let skipped = 0;

  for (const rawRow of rows) {
    const row = normalizeRow(rawRow);
    if (!row) {
      skipped += 1;
      continue;
    }

    await conn.query(
      `
      INSERT INTO quarterly_eps (
        stock_code,
        eps_year,
        eps_quarter,
        eps,
        source,
        source_url
      ) VALUES (?, ?, ?, ?, 'MOPS OpenData t163sb04', ?)
      ON DUPLICATE KEY UPDATE
        eps = VALUES(eps),
        source = VALUES(source),
        source_url = VALUES(source_url),
        updated_at = CURRENT_TIMESTAMP
      `,
      [row.stockCode, row.year, row.quarter, row.eps, url],
    );

    imported += 1;
  }

  return { marketType: source.marketType, imported, skipped, url };
}

async function backfillGrowthRates(conn) {
  const rows = await conn.query(
    `
    SELECT stock_code, eps_year, eps_quarter, eps
    FROM quarterly_eps
    ORDER BY stock_code ASC, eps_year ASC, eps_quarter ASC
    `,
  );

  const byStock = new Map();
  rows.forEach((row) => {
    if (!byStock.has(row.stock_code)) byStock.set(row.stock_code, []);
    byStock.get(row.stock_code).push(row);
  });

  for (const [stockCode, stockRows] of byStock.entries()) {
    const lookup = new Map(stockRows.map((row) => [`${row.eps_year}-${row.eps_quarter}`, row]));

    for (const row of stockRows) {
      const previousQuarter = row.eps_quarter === 1
        ? lookup.get(`${Number(row.eps_year) - 1}-4`)
        : lookup.get(`${row.eps_year}-${Number(row.eps_quarter) - 1}`);
      const lastYearSameQuarter = lookup.get(`${Number(row.eps_year) - 1}-${row.eps_quarter}`);
      const eps = toNumber(row.eps);
      const previousEps = toNumber(previousQuarter?.eps);
      const lastYearEps = toNumber(lastYearSameQuarter?.eps);
      const qoq = eps !== null && previousEps !== null && previousEps !== 0
        ? ((eps - previousEps) / Math.abs(previousEps)) * 100
        : null;
      const yoy = eps !== null && lastYearEps !== null && lastYearEps !== 0
        ? ((eps - lastYearEps) / Math.abs(lastYearEps)) * 100
        : null;

      await conn.query(
        `
        UPDATE quarterly_eps
        SET quarter_over_quarter_percent = ?, year_over_year_percent = ?
        WHERE stock_code = ? AND eps_year = ? AND eps_quarter = ?
        `,
        [qoq, yoy, stockCode, row.eps_year, row.eps_quarter],
      );
    }
  }
}

async function main() {
  const conn = await pool.getConnection();

  try {
    console.log("開始匯入每季 EPS 資料");
    for (const source of SOURCES) {
      const result = await importSource(conn, source);
      console.log(`完成：${result.marketType}，匯入 ${result.imported} 筆，略過 ${result.skipped} 筆`);
      console.log(`來源：${result.url}`);
    }

    console.log("開始回填 EPS 季增率 / 年增率");
    await backfillGrowthRates(conn);
    console.log("EPS 成長率回填完成");
  } catch (error) {
    console.error("匯入每季 EPS 資料失敗");
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    conn.release();
    await pool.end();
  }
}

main();
