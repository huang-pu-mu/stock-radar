import pool from "../db.js";

const MOPS_AJAX_URL = "https://mops.twse.com.tw/mops/web/ajax_t163sb04";
const DEFAULT_QUARTER_COUNT = Number(process.env.EPS_IMPORT_QUARTERS || 12);

const SOURCES = [
  {
    marketType: "上市",
    typeK: "sii",
  },
  {
    marketType: "上櫃",
    typeK: "otc",
  },
];

function stripHtml(value) {
  return String(value ?? "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#40;/g, "(")
    .replace(/&#41;/g, ")")
    .replace(/&#43;/g, "+")
    .replace(/&#45;/g, "-")
    .replace(/&#37;/g, "%")
    .replace(/\s+/g, " ")
    .replace(/^\uFEFF/, "")
    .trim();
}

function normalizeKey(value) {
  return stripHtml(value)
    .replace(/[\s　()（）%％_\-\/：:]/g, "")
    .toLowerCase();
}

function toNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const text = stripHtml(value)
    .replace(/,/g, "")
    .replace(/%/g, "")
    .replace(/−/g, "-")
    .replace(/—/g, "-")
    .trim();
  if (!text || text === "-" || text === "--" || text === "不適用") return null;
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

function getRecentCompletedQuarters(count = DEFAULT_QUARTER_COUNT) {
  const now = new Date();
  let year = now.getFullYear();
  let quarter = Math.floor(now.getMonth() / 3) + 1;

  // 只抓已結束季度，避免抓到尚未申報完成的本季資料。
  quarter -= 1;
  if (quarter <= 0) {
    year -= 1;
    quarter = 4;
  }

  const periods = [];
  for (let index = 0; index < count; index += 1) {
    periods.push({ year, quarter });
    quarter -= 1;
    if (quarter <= 0) {
      year -= 1;
      quarter = 4;
    }
  }
  return periods;
}

function parseRequestedPeriods() {
  const [yearArg, quarterArg] = process.argv.slice(2);
  const year = normalizeYear(yearArg);
  const quarter = normalizeQuarter(quarterArg);

  if (year && quarter) return [{ year, quarter }];
  return getRecentCompletedQuarters();
}

function htmlTableRows(html) {
  const rows = [];
  const rowMatches = String(html || "").match(/<tr[\s\S]*?<\/tr>/gi) || [];

  for (const rowHtml of rowMatches) {
    const cellMatches = rowHtml.match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/gi) || [];
    const cells = cellMatches.map(stripHtml).filter((cell) => cell !== "");
    if (cells.length > 0) rows.push(cells);
  }

  return rows;
}

function findHeaderIndex(header, candidates) {
  const normalizedCandidates = candidates.map(normalizeKey);
  return header.findIndex((cell) => {
    const key = normalizeKey(cell);
    return normalizedCandidates.some((candidate) => key === candidate || key.includes(candidate));
  });
}

function findLikelyEpsValue(cells) {
  // MOPS 綜合損益表中，基本每股盈餘通常在表格後段。
  // 若表頭解析不到，就從後段數值欄位往前找第一個合理 EPS 數字。
  for (let index = cells.length - 1; index >= 0; index -= 1) {
    const value = toNumber(cells[index]);
    if (value !== null && Math.abs(value) < 1000) return value;
  }
  return null;
}

function parseMopsEpsRows(html, year, quarter) {
  const text = stripHtml(html);
  if (!text || text.includes("查無資料") || text.includes("很抱歉")) return [];

  const tableRows = htmlTableRows(html);
  let header = [];
  let codeIndex = 0;
  let epsIndex = -1;
  const result = [];

  for (const cells of tableRows) {
    const normalizedCells = cells.map(normalizeKey);
    const hasCodeHeader = normalizedCells.some((cell) => cell.includes("公司代號") || cell.includes("證券代號"));
    const hasEpsHeader = normalizedCells.some((cell) => cell.includes("基本每股盈餘") || cell.includes("每股盈餘"));

    if (hasCodeHeader && hasEpsHeader) {
      header = cells;
      const foundCodeIndex = findHeaderIndex(header, ["公司代號", "證券代號", "股票代號"]);
      const foundEpsIndex = findHeaderIndex(header, ["基本每股盈餘", "基本每股盈餘元", "基本每股盈餘（元）", "每股盈餘"]);
      codeIndex = foundCodeIndex >= 0 ? foundCodeIndex : 0;
      epsIndex = foundEpsIndex;
      continue;
    }

    const stockCode = String(cells[codeIndex] || cells[0] || "").trim();
    if (!/^\d{4,6}[A-Z]?$/.test(stockCode)) continue;

    const eps = epsIndex >= 0 ? toNumber(cells[epsIndex]) : findLikelyEpsValue(cells);
    if (eps === null) continue;

    result.push({
      stockCode,
      year,
      quarter,
      eps,
    });
  }

  return result;
}

async function fetchMopsEpsRows(source, period) {
  const rocYear = period.year - 1911;
  const params = new URLSearchParams({
    encodeURIComponent: "1",
    step: "1",
    firstin: "1",
    off: "1",
    keyword4: "",
    code1: "",
    TYPEK: source.typeK,
    year: String(rocYear),
    season: String(period.quarter).padStart(2, "0"),
  });

  const response = await fetch(MOPS_AJAX_URL, {
    method: "POST",
    headers: {
      "User-Agent": "Mozilla/5.0 stock-radar-api",
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      Accept: "text/html,application/xhtml+xml,application/xml,text/plain,*/*",
      Origin: "https://mops.twse.com.tw",
      Referer: "https://mops.twse.com.tw/mops/web/t163sb04",
    },
    body: params,
  });

  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const html = await response.text();
  const rows = parseMopsEpsRows(html, period.year, period.quarter);

  if (rows.length === 0) {
    throw new Error(`${period.year} Q${period.quarter} 無可解析 EPS 資料`);
  }

  return {
    rows,
    sourceUrl: `${MOPS_AJAX_URL}?TYPEK=${source.typeK}&year=${rocYear}&season=${String(period.quarter).padStart(2, "0")}`,
  };
}

async function upsertRows(conn, rows, sourceUrl) {
  let imported = 0;
  let skipped = 0;

  for (const row of rows) {
    if (!row || !/^\d{4,6}[A-Z]?$/.test(row.stockCode) || !row.year || !row.quarter || row.eps === null) {
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
      ) VALUES (?, ?, ?, ?, 'MOPS ajax_t163sb04', ?)
      ON DUPLICATE KEY UPDATE
        eps = VALUES(eps),
        source = VALUES(source),
        source_url = VALUES(source_url),
        updated_at = CURRENT_TIMESTAMP
      `,
      [row.stockCode, row.year, row.quarter, row.eps, sourceUrl],
    );

    imported += 1;
  }

  return { imported, skipped };
}

async function importSource(conn, source, periods) {
  let imported = 0;
  let skipped = 0;
  let successPeriods = 0;
  const errors = [];

  for (const period of periods) {
    try {
      const { rows, sourceUrl } = await fetchMopsEpsRows(source, period);
      const result = await upsertRows(conn, rows, sourceUrl);
      imported += result.imported;
      skipped += result.skipped;
      successPeriods += 1;
      console.log(`完成：${source.marketType} ${period.year} Q${period.quarter}，匯入 ${result.imported} 筆，略過 ${result.skipped} 筆`);
    } catch (error) {
      errors.push(`${source.marketType} ${period.year} Q${period.quarter}：${error.message}`);
      console.log(`略過：${source.marketType} ${period.year} Q${period.quarter}，${error.message}`);
    }
  }

  if (successPeriods === 0) {
    throw new Error(errors.join("；"));
  }

  return { marketType: source.marketType, imported, skipped, successPeriods, errors };
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
  const periods = parseRequestedPeriods();

  try {
    console.log("開始匯入每季 EPS 資料");
    console.log(`資料來源：MOPS ajax_t163sb04，季度：${periods.map((period) => `${period.year}Q${period.quarter}`).join(", ")}`);

    for (const source of SOURCES) {
      const result = await importSource(conn, source, periods);
      console.log(`完成：${result.marketType}，成功季度 ${result.successPeriods}，匯入 ${result.imported} 筆，略過 ${result.skipped} 筆`);
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
