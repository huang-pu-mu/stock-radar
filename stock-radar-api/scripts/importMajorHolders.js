import pool from "../db.js";

const TDCC_SHAREHOLDER_DISTRIBUTION_URL = "https://opendata.tdcc.com.tw/getOD.ashx?id=1-5";

function normalizeDate(value) {
  const text = String(value || "").trim().replaceAll("/", "-");

  if (/^\d{8}$/.test(text)) {
    return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
  }

  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(text)) {
    const [year, month, day] = text.split("-");
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }

  throw new Error(`無法辨識集保資料日期：${value}`);
}

function normalizeStockCode(value) {
  return String(value || "").trim().replace(/^="?/, "").replace(/"?$/, "");
}

function toNumber(value) {
  if (value === null || value === undefined || value === "") return 0;
  const text = String(value).replaceAll(",", "").replaceAll("%", "").trim();
  const numberValue = Number(text);
  return Number.isFinite(numberValue) ? numberValue : 0;
}

function toInteger(value) {
  return Math.trunc(toNumber(value));
}

function decodeText(buffer) {
  const labels = ["utf-8", "big5"];

  for (const label of labels) {
    try {
      return new TextDecoder(label, { fatal: true }).decode(buffer);
    } catch (error) {
      // 換下一個編碼試試看
    }
  }

  return new TextDecoder("utf-8").decode(buffer);
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
      const hasContent = row.some((item) => String(item).trim() !== "");
      if (hasContent) rows.push(row);
      row = [];
      field = "";
      continue;
    }

    field += char;
  }

  row.push(field);
  if (row.some((item) => String(item).trim() !== "")) rows.push(row);

  return rows;
}

function pickValue(record, keys) {
  for (const key of keys) {
    if (record[key] !== undefined && record[key] !== null && String(record[key]).trim() !== "") {
      return record[key];
    }
  }
  return "";
}

function normalizeHeader(value) {
  return String(value || "").replace(/^\uFEFF/, "").trim();
}

function isTotalLevel(level, levelText, holderRatio) {
  const text = String(levelText || "").trim();
  return text.includes("合計") || text.includes("總計") || level >= 16 || holderRatio >= 99.9;
}

function createEmptySummary(dataDate, stockCode) {
  return {
    dataDate,
    stockCode,
    totalHolderCount: 0,
    totalShareCount: 0,
    smallHolderCount: 0,
    smallHolderShareCount: 0,
    smallHolderRatio: 0,
    midHolderCount: 0,
    midHolderShareCount: 0,
    midHolderRatio: 0,
    largeHolderCount: 0,
    largeHolderShareCount: 0,
    largeHolderRatio: 0,
    thousandLotHolderCount: 0,
    thousandLotShareCount: 0,
    thousandLotRatio: 0,
    avgLargeHolderLots: 0,
    hasTotalRow: false,
  };
}

function addRowToSummary(summary, row) {
  const level = row.level;
  const holderCount = row.holderCount;
  const shareCount = row.shareCount;
  const holderRatio = row.holderRatio;

  if (row.isTotal) {
    summary.totalHolderCount = holderCount;
    summary.totalShareCount = shareCount;
    summary.hasTotalRow = true;
    return;
  }

  if (level < 1 || level > 15) return;

  if (!summary.hasTotalRow) {
    summary.totalHolderCount += holderCount;
    summary.totalShareCount += shareCount;
  }

  // 1~8 級：約 50 張以下；9~11 級：約 50~400 張；12~15 級：400 張以上。
  if (level <= 8) {
    summary.smallHolderCount += holderCount;
    summary.smallHolderShareCount += shareCount;
    summary.smallHolderRatio += holderRatio;
  } else if (level <= 11) {
    summary.midHolderCount += holderCount;
    summary.midHolderShareCount += shareCount;
    summary.midHolderRatio += holderRatio;
  } else {
    summary.largeHolderCount += holderCount;
    summary.largeHolderShareCount += shareCount;
    summary.largeHolderRatio += holderRatio;
  }

  if (level >= 15) {
    summary.thousandLotHolderCount += holderCount;
    summary.thousandLotShareCount += shareCount;
    summary.thousandLotRatio += holderRatio;
  }
}

function finalizeSummary(summary) {
  if (summary.totalShareCount > 0) {
    summary.smallHolderRatio = Number(((summary.smallHolderShareCount / summary.totalShareCount) * 100).toFixed(4));
    summary.midHolderRatio = Number(((summary.midHolderShareCount / summary.totalShareCount) * 100).toFixed(4));
    summary.largeHolderRatio = Number(((summary.largeHolderShareCount / summary.totalShareCount) * 100).toFixed(4));
    summary.thousandLotRatio = Number(((summary.thousandLotShareCount / summary.totalShareCount) * 100).toFixed(4));
  } else {
    summary.smallHolderRatio = Number(summary.smallHolderRatio.toFixed(4));
    summary.midHolderRatio = Number(summary.midHolderRatio.toFixed(4));
    summary.largeHolderRatio = Number(summary.largeHolderRatio.toFixed(4));
    summary.thousandLotRatio = Number(summary.thousandLotRatio.toFixed(4));
  }

  summary.avgLargeHolderLots = summary.largeHolderCount > 0
    ? Number((summary.largeHolderShareCount / 1000 / summary.largeHolderCount).toFixed(2))
    : 0;

  return summary;
}

async function fetchTdccRows() {
  console.log("讀取：TDCC 集保戶股權分散表");
  console.log(`來源：${TDCC_SHAREHOLDER_DISTRIBUTION_URL}`);

  const response = await fetch(TDCC_SHAREHOLDER_DISTRIBUTION_URL, {
    headers: {
      "User-Agent": "stock-radar/1.0",
    },
  });

  if (!response.ok) {
    throw new Error(`TDCC 下載失敗：HTTP ${response.status}`);
  }

  const buffer = await response.arrayBuffer();
  const csvText = decodeText(buffer);
  const rows = parseCsv(csvText);

  if (rows.length < 2) {
    throw new Error("TDCC CSV 沒有資料列");
  }

  const headers = rows[0].map(normalizeHeader);

  return rows.slice(1).map((columns) => {
    const record = {};
    headers.forEach((header, index) => {
      record[header] = String(columns[index] || "").trim();
    });
    return record;
  });
}

function buildSummaries(records) {
  const summaryMap = new Map();
  let skipped = 0;

  records.forEach((record) => {
    try {
      const dataDate = normalizeDate(pickValue(record, ["資料日期", "Date"]));
      const stockCode = normalizeStockCode(pickValue(record, ["證券代號", "Securities Code"]));
      const levelText = pickValue(record, ["持股分級", "Securities Holding Range"]);
      const level = toInteger(levelText);
      const holderCount = toInteger(pickValue(record, ["人數", "Number of People", "Holders"]));
      const shareCount = toInteger(pickValue(record, ["股數", "Number of Shares", "Shares"]));
      const holderRatio = toNumber(pickValue(record, ["占集保庫存數比例%", "占集保庫存數比例", "Percentage of Shares"]));

      if (!stockCode || !/^\d{4}[A-Z0-9]{0,2}$/i.test(stockCode)) {
        skipped += 1;
        return;
      }

      const key = `${dataDate}|${stockCode}`;
      if (!summaryMap.has(key)) {
        summaryMap.set(key, createEmptySummary(dataDate, stockCode));
      }

      addRowToSummary(summaryMap.get(key), {
        level,
        levelText,
        holderCount,
        shareCount,
        holderRatio,
        isTotal: isTotalLevel(level, levelText, holderRatio),
      });
    } catch (error) {
      skipped += 1;
    }
  });

  const summaries = Array.from(summaryMap.values()).map(finalizeSummary);

  return { summaries, skipped };
}

async function ensureTable(conn) {
  await conn.query(`
    CREATE TABLE IF NOT EXISTS major_holder_stats (
      id bigint(20) NOT NULL AUTO_INCREMENT,
      data_date date NOT NULL COMMENT '集保資料日期',
      stock_code varchar(10) NOT NULL COMMENT '股票代號',
      total_holder_count int(11) NOT NULL DEFAULT 0 COMMENT '總股東人數',
      total_share_count bigint(20) NOT NULL DEFAULT 0 COMMENT '總集保股數',
      small_holder_count int(11) NOT NULL DEFAULT 0 COMMENT '50張以下股東人數',
      small_holder_share_count bigint(20) NOT NULL DEFAULT 0 COMMENT '50張以下股數',
      small_holder_ratio decimal(10,4) NOT NULL DEFAULT 0.0000 COMMENT '50張以下持股比例',
      mid_holder_count int(11) NOT NULL DEFAULT 0 COMMENT '50張以上未滿400張股東人數',
      mid_holder_share_count bigint(20) NOT NULL DEFAULT 0 COMMENT '50張以上未滿400張股數',
      mid_holder_ratio decimal(10,4) NOT NULL DEFAULT 0.0000 COMMENT '50張以上未滿400張持股比例',
      large_holder_count int(11) NOT NULL DEFAULT 0 COMMENT '400張以上大戶人數',
      large_holder_share_count bigint(20) NOT NULL DEFAULT 0 COMMENT '400張以上大戶股數',
      large_holder_ratio decimal(10,4) NOT NULL DEFAULT 0.0000 COMMENT '400張以上大戶持股比例',
      thousand_lot_holder_count int(11) NOT NULL DEFAULT 0 COMMENT '1000張以上大戶人數',
      thousand_lot_share_count bigint(20) NOT NULL DEFAULT 0 COMMENT '1000張以上大戶股數',
      thousand_lot_ratio decimal(10,4) NOT NULL DEFAULT 0.0000 COMMENT '1000張以上大戶持股比例',
      avg_large_holder_lots decimal(18,2) NOT NULL DEFAULT 0.00 COMMENT '400張以上平均每戶張數',
      source varchar(50) NOT NULL DEFAULT 'TDCC' COMMENT '資料來源',
      created_at datetime NOT NULL DEFAULT current_timestamp(),
      updated_at datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
      PRIMARY KEY (id),
      UNIQUE KEY uq_major_holder_stock_date (data_date,stock_code),
      KEY idx_major_holder_stock_code (stock_code),
      KEY idx_major_holder_data_date (data_date),
      KEY idx_major_holder_ratio (large_holder_ratio),
      KEY idx_major_holder_thousand_ratio (thousand_lot_ratio)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='集保大戶籌碼統計表'
  `);
}

async function upsertSummaries(conn, summaries) {
  let updated = 0;

  for (const item of summaries) {
    await conn.query(
      `
      INSERT INTO major_holder_stats (
        data_date,
        stock_code,
        total_holder_count,
        total_share_count,
        small_holder_count,
        small_holder_share_count,
        small_holder_ratio,
        mid_holder_count,
        mid_holder_share_count,
        mid_holder_ratio,
        large_holder_count,
        large_holder_share_count,
        large_holder_ratio,
        thousand_lot_holder_count,
        thousand_lot_share_count,
        thousand_lot_ratio,
        avg_large_holder_lots,
        source
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'TDCC')
      ON DUPLICATE KEY UPDATE
        total_holder_count = VALUES(total_holder_count),
        total_share_count = VALUES(total_share_count),
        small_holder_count = VALUES(small_holder_count),
        small_holder_share_count = VALUES(small_holder_share_count),
        small_holder_ratio = VALUES(small_holder_ratio),
        mid_holder_count = VALUES(mid_holder_count),
        mid_holder_share_count = VALUES(mid_holder_share_count),
        mid_holder_ratio = VALUES(mid_holder_ratio),
        large_holder_count = VALUES(large_holder_count),
        large_holder_share_count = VALUES(large_holder_share_count),
        large_holder_ratio = VALUES(large_holder_ratio),
        thousand_lot_holder_count = VALUES(thousand_lot_holder_count),
        thousand_lot_share_count = VALUES(thousand_lot_share_count),
        thousand_lot_ratio = VALUES(thousand_lot_ratio),
        avg_large_holder_lots = VALUES(avg_large_holder_lots),
        source = VALUES(source),
        updated_at = NOW()
      `,
      [
        item.dataDate,
        item.stockCode,
        item.totalHolderCount,
        item.totalShareCount,
        item.smallHolderCount,
        item.smallHolderShareCount,
        item.smallHolderRatio,
        item.midHolderCount,
        item.midHolderShareCount,
        item.midHolderRatio,
        item.largeHolderCount,
        item.largeHolderShareCount,
        item.largeHolderRatio,
        item.thousandLotHolderCount,
        item.thousandLotShareCount,
        item.thousandLotRatio,
        item.avgLargeHolderLots,
      ],
    );

    updated += 1;
  }

  return updated;
}

async function main() {
  const records = await fetchTdccRows();
  const { summaries, skipped } = buildSummaries(records);

  if (summaries.length === 0) {
    throw new Error("沒有可匯入的大戶籌碼統計資料");
  }

  const conn = await pool.getConnection();

  try {
    await ensureTable(conn);
    const updated = await upsertSummaries(conn, summaries);

    const latestRows = await conn.query(`
      SELECT
        DATE_FORMAT(MAX(data_date), '%Y-%m-%d') AS latest_date,
        COUNT(DISTINCT stock_code) AS stock_count
      FROM major_holder_stats
    `);

    console.log("集保大戶籌碼匯入完成");
    console.log(`解析資料：${records.length} 筆`);
    console.log(`更新股票：${updated} 檔`);
    console.log(`略過資料：${skipped} 筆`);
    console.table(latestRows);
  } catch (error) {
    console.error("集保大戶籌碼匯入失敗");
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    conn.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error("集保大戶籌碼匯入失敗");
  console.error(error.message);
  process.exitCode = 1;
});
