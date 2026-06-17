import fs from "node:fs/promises";
import pool from "../db.js";

function stripHtml(value) {
  return String(value ?? "")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, "")
    .replace(/^\uFEFF/, "")
    .trim();
}

function normalizeKey(value) {
  return stripHtml(value)
    .replace(/[\s　()（）_\-\/：:]/g, "")
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

function normalizeDate(value) {
  const text = String(value || "").trim();
  const match = text.match(/(20\d{2}|1\d{2})[\/\-.年](\d{1,2})[\/\-.月](\d{1,2})/);
  if (!match) return "";
  const year = match[1].length === 3 ? Number(match[1]) + 1911 : Number(match[1]);
  const month = String(Number(match[2])).padStart(2, "0");
  const day = String(Number(match[3])).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function inferEventType(text) {
  const value = String(text || "");
  if (/除息|息交易/.test(value)) return "除息";
  if (/除權/.test(value)) return "除權";
  if (/配息|股利發放|發放日|現金股利/.test(value)) return "配息";
  if (/股東會|股東常會|股東臨時會/.test(value)) return "股東會";
  if (/法說會|法人說明會/.test(value)) return "法說會";
  if (/停止過戶|最後過戶|停券|融券/.test(value)) return "股務事件";
  if (/財報|盈餘|EPS|季報|年報/.test(value)) return "財報事件";
  return "其他事件";
}

function getImportance(eventType) {
  if (["除息", "除權", "配息", "股東會", "法說會"].includes(eventType)) return "high";
  return "normal";
}

function normalizeRow(row) {
  const stockCode = String(pick(row, ["股票代號", "公司代號", "證券代號", "代號", "stock_code"])).trim();
  const eventDate = normalizeDate(pick(row, ["事件日期", "日期", "event_date", "除權息日期", "股東會日期", "法說會日期"]));
  const rawType = String(pick(row, ["事件類型", "類型", "event_type"])).trim();
  const rawTitle = String(pick(row, ["標題", "事件", "內容", "title", "說明"])).trim();
  const description = String(pick(row, ["說明", "備註", "description", "內容"])).trim();
  const eventType = rawType || inferEventType(`${rawTitle} ${description}`);
  const title = rawTitle || eventType;

  if (!/^\d{4,6}[A-Z]?$/.test(stockCode) || !eventDate || !title) return null;

  return {
    stockCode,
    eventDate,
    eventType,
    title,
    description,
    importance: getImportance(eventType),
  };
}

async function main() {
  const csvPath = process.argv[2];

  if (!csvPath) {
    console.error("請指定行事曆 CSV 檔案，例如：node scripts/importStockCalendarEvents.js ./events.csv");
    process.exit(1);
  }

  const text = await fs.readFile(csvPath, "utf8");
  const rows = parseCsv(text);
  const conn = await pool.getConnection();
  let imported = 0;
  let skipped = 0;

  try {
    console.log("開始匯入個股/ETF 行事曆事件");

    for (const rawRow of rows) {
      const row = normalizeRow(rawRow);
      if (!row) {
        skipped += 1;
        continue;
      }

      await conn.query(
        `
        INSERT INTO stock_calendar_events (
          stock_code,
          event_date,
          event_type,
          title,
          description,
          importance,
          source,
          source_url
        ) VALUES (?, ?, ?, ?, ?, ?, 'CSV IMPORT', ?)
        ON DUPLICATE KEY UPDATE
          description = VALUES(description),
          importance = VALUES(importance),
          source = VALUES(source),
          source_url = VALUES(source_url),
          is_active = 1,
          updated_at = CURRENT_TIMESTAMP
        `,
        [
          row.stockCode,
          row.eventDate,
          row.eventType,
          row.title,
          row.description,
          row.importance,
          csvPath,
        ],
      );

      imported += 1;
    }

    console.log(`完成：匯入 ${imported} 筆，略過 ${skipped} 筆`);
  } catch (error) {
    console.error("匯入個股/ETF 行事曆事件失敗");
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    conn.release();
    await pool.end();
  }
}

main();
