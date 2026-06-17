import fs from "node:fs/promises";
import path from "node:path";
import pool from "../db.js";

const TAIWAN_TIME_ZONE = "Asia/Taipei";

const OFFICIAL_SOURCES = [
  {
    name: "TWSE 除權息預告表",
    marketType: "上市",
    category: "ex_rights",
    url: () => `https://www.twse.com.tw/rwd/zh/exRight/TWT48U?response=json&date=${getTaiwanDateCompact()}&selectType=ALL`,
  },
  {
    name: "TWSE 除權息計算結果表",
    marketType: "上市",
    category: "ex_rights",
    url: () => `https://www.twse.com.tw/rwd/zh/exRight/TWT49U?response=json&date=${getTaiwanDateCompact()}&selectType=ALL`,
  },
  {
    name: "TPEx 除權息預告表",
    marketType: "上櫃",
    category: "ex_rights",
    url: () => `https://www.tpex.org.tw/www/zh-tw/exRight/TWT48U?response=json&date=${getTaiwanDateSlash()}`,
  },
  {
    name: "TPEx 除權息計算結果表",
    marketType: "上櫃",
    category: "ex_rights",
    url: () => `https://www.tpex.org.tw/www/zh-tw/exRight/TWT49U?response=json&date=${getTaiwanDateSlash()}`,
  },
  {
    name: "MOPS 上市股東會資料候選來源",
    marketType: "上市",
    category: "shareholders_meeting",
    url: () => "https://mopsfin.twse.com.tw/opendata/t108sb31_L.csv",
    optional: true,
  },
  {
    name: "MOPS 上櫃股東會資料候選來源",
    marketType: "上櫃",
    category: "shareholders_meeting",
    url: () => "https://mopsfin.twse.com.tw/opendata/t108sb31_O.csv",
    optional: true,
  },
  {
    name: "MOPS 上市法說會資料候選來源",
    marketType: "上市",
    category: "investor_conference",
    url: () => "https://mopsfin.twse.com.tw/opendata/t100sb02_L.csv",
    optional: true,
  },
  {
    name: "MOPS 上櫃法說會資料候選來源",
    marketType: "上櫃",
    category: "investor_conference",
    url: () => "https://mopsfin.twse.com.tw/opendata/t100sb02_O.csv",
    optional: true,
  },
];

function getTaiwanDate() {
  return new Date(new Date().toLocaleString("en-US", { timeZone: TAIWAN_TIME_ZONE }));
}

function getTaiwanDateCompact(date = getTaiwanDate()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

function getTaiwanDateSlash(date = getTaiwanDate()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}/${month}/${day}`;
}

function stripHtml(value) {
  return String(value ?? "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#x2F;/g, "/")
    .replace(/^\uFEFF/, "")
    .trim();
}

function normalizeKey(value) {
  return stripHtml(value)
    .replace(/[\s　()（）_\-\/：:、，,.\[\]【】]/g, "")
    .toLowerCase();
}

function normalizeStockCode(value) {
  const text = stripHtml(value).replace(/[^\dA-Z]/gi, "").toUpperCase();
  const match = text.match(/\d{4,6}[A-Z]?/);
  return match ? match[0] : "";
}

function normalizeNumber(value) {
  const text = stripHtml(value).replace(/,/g, "");
  const match = text.match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
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
  const headers = rows[0].map(stripHtml);

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
  const text = stripHtml(value).replace(/[年月]/g, "/").replace(/[日號]/g, "").trim();
  if (!text || ["-", "--", "無", "不適用"].includes(text)) return "";

  let match = text.match(/(20\d{2}|1\d{2})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/);
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

  return "";
}

function inferEventType(text) {
  const value = String(text || "");
  if (/除權息/.test(value)) return "除權息";
  if (/除息|息交易/.test(value)) return "除息";
  if (/除權/.test(value)) return "除權";
  if (/配息|股利發放|發放日|現金股利/.test(value)) return "配息";
  if (/股東會|股東常會|股東臨時會|開會日期/.test(value)) return "股東會";
  if (/法說會|法人說明會|說明會/.test(value)) return "法說會";
  if (/停止過戶|最後過戶|停券|融券/.test(value)) return "股務事件";
  if (/財報|盈餘|EPS|季報|年報/.test(value)) return "財報事件";
  return "其他事件";
}

function getImportance(eventType) {
  if (["除權息", "除息", "除權", "配息", "股東會", "法說會"].includes(eventType)) return "high";
  if (["股務事件", "財報事件"].includes(eventType)) return "medium";
  return "normal";
}

function buildJsonRows(json) {
  if (!json || typeof json !== "object") return [];

  if (Array.isArray(json)) return json;

  const data = json.data || json.tables?.[0]?.data || json.result?.data || json.aaData;
  const fields = json.fields || json.tables?.[0]?.fields || json.result?.fields || json.columns;

  if (Array.isArray(data) && Array.isArray(fields)) {
    return data.map((row) => {
      const result = {};
      fields.forEach((field, index) => {
        result[stripHtml(field)] = Array.isArray(row) ? stripHtml(row[index]) : stripHtml(row?.[field]);
      });
      return result;
    });
  }

  if (Array.isArray(data)) return data;

  return [];
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 StockRadar/1.0",
      "Accept": "application/json,text/csv,text/plain,*/*",
      "Referer": "https://www.twse.com.tw/",
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return response.text();
}

function parseRemoteRows(text) {
  const cleanText = String(text || "").replace(/^\uFEFF/, "").trim();
  if (!cleanText) return [];

  if (cleanText.startsWith("{") || cleanText.startsWith("[")) {
    const json = JSON.parse(cleanText);
    return buildJsonRows(json);
  }

  return parseCsv(cleanText);
}

function pushEvent(events, event) {
  if (!event || !event.stockCode || !event.eventDate || !event.eventType || !event.title) return;

  const key = `${event.stockCode}|${event.eventDate}|${event.eventType}|${event.title}`;
  if (events.some((item) => item.key === key)) return;

  events.push({
    key,
    stockCode: event.stockCode,
    eventDate: event.eventDate,
    eventType: event.eventType,
    title: event.title,
    description: event.description || "",
    importance: event.importance || getImportance(event.eventType),
    source: event.source || "OFFICIAL",
    sourceUrl: event.sourceUrl || "",
  });
}

function parseGenericCalendarRows(rows, source) {
  const events = [];

  for (const row of rows) {
    const stockCode = normalizeStockCode(pick(row, [
      "股票代號",
      "證券代號",
      "公司代號",
      "有價證券代號",
      "代號",
      "stock_code",
      "code",
    ]));

    if (!stockCode) continue;

    const stockName = stripHtml(pick(row, ["股票名稱", "證券名稱", "公司名稱", "有價證券名稱", "名稱"]));
    const rowText = Object.values(row).join(" ");
    const rawType = stripHtml(pick(row, ["事件類型", "類型", "event_type", "項目"]));
    const rawTitle = stripHtml(pick(row, ["標題", "事件", "內容", "title", "說明", "備註"]));
    const description = stripHtml(pick(row, ["說明", "備註", "description", "內容"]));

    const exRightDate = normalizeDate(pick(row, [
      "除權息日期",
      "除權息交易日",
      "除權交易日",
      "除息交易日",
      "除權日",
      "除息日",
      "日期",
    ]));

    if (exRightDate) {
      const cashDividend = normalizeNumber(pick(row, ["現金股利", "現金股利合計", "現金股利(元)", "盈餘分配之現金股利", "資本公積發放之現金"]));
      const stockDividend = normalizeNumber(pick(row, ["股票股利", "無償配股率", "股票股利合計", "盈餘轉增資配股"]));
      const typeText = rawType || rowText;
      const eventType =
        /權.*息|息.*權/.test(typeText) || (cashDividend && stockDividend) ? "除權息" :
        /除權/.test(typeText) || (stockDividend && !cashDividend) ? "除權" :
        "除息";

      const dividendParts = [];
      if (cashDividend !== null) dividendParts.push(`現金股利 ${cashDividend} 元`);
      if (stockDividend !== null) dividendParts.push(`股票股利 / 配股率 ${stockDividend}`);

      pushEvent(events, {
        stockCode,
        eventDate: exRightDate,
        eventType,
        title: `${stockCode}${stockName ? ` ${stockName}` : ""} ${eventType}`,
        description: dividendParts.length > 0 ? dividendParts.join("，") : stripHtml(rowText).slice(0, 180),
        source: source.name,
        sourceUrl: source.urlValue,
      });
    }

    const paymentDate = normalizeDate(pick(row, [
      "現金股利發放日",
      "股利發放日",
      "發放日",
      "收益分配發放日",
      "收益發放日",
    ]));

    if (paymentDate) {
      pushEvent(events, {
        stockCode,
        eventDate: paymentDate,
        eventType: "配息",
        title: `${stockCode}${stockName ? ` ${stockName}` : ""} 配息 / 股利發放`,
        description: rawTitle || description || stripHtml(rowText).slice(0, 180),
        source: source.name,
        sourceUrl: source.urlValue,
      });
    }

    const bookClosureDate = normalizeDate(pick(row, [
      "停止過戶起始日期",
      "停止過戶開始日",
      "停止過戶日",
      "停止過戶期間起",
    ]));

    if (bookClosureDate) {
      pushEvent(events, {
        stockCode,
        eventDate: bookClosureDate,
        eventType: "股務事件",
        title: `${stockCode}${stockName ? ` ${stockName}` : ""} 停止過戶`,
        description: rawTitle || description || stripHtml(rowText).slice(0, 180),
        source: source.name,
        sourceUrl: source.urlValue,
      });
    }

    const meetingDate = normalizeDate(pick(row, [
      "股東會日期",
      "開會日期",
      "召開日期",
      "會議日期",
    ]));

    if (meetingDate) {
      const eventType = source.category === "investor_conference" || /法說|法人說明/.test(rowText)
        ? "法說會"
        : "股東會";

      pushEvent(events, {
        stockCode,
        eventDate: meetingDate,
        eventType,
        title: rawTitle || `${stockCode}${stockName ? ` ${stockName}` : ""} ${eventType}`,
        description: description || stripHtml(rowText).slice(0, 180),
        source: source.name,
        sourceUrl: source.urlValue,
      });
    }

    const genericDate = normalizeDate(pick(row, ["事件日期", "event_date"]));
    if (genericDate && !exRightDate && !paymentDate && !bookClosureDate && !meetingDate) {
      const eventType = rawType || inferEventType(`${rawTitle} ${description} ${rowText}`);
      pushEvent(events, {
        stockCode,
        eventDate: genericDate,
        eventType,
        title: rawTitle || `${stockCode}${stockName ? ` ${stockName}` : ""} ${eventType}`,
        description: description || stripHtml(rowText).slice(0, 180),
        source: source.name,
        sourceUrl: source.urlValue,
      });
    }
  }

  return events;
}

function normalizeCsvRow(row, csvPath) {
  const stockCode = normalizeStockCode(pick(row, ["股票代號", "公司代號", "證券代號", "代號", "stock_code"]));
  const eventDate = normalizeDate(pick(row, ["事件日期", "日期", "event_date", "除權息日期", "股東會日期", "法說會日期"]));
  const rawType = stripHtml(pick(row, ["事件類型", "類型", "event_type"]));
  const rawTitle = stripHtml(pick(row, ["標題", "事件", "內容", "title", "說明"]));
  const description = stripHtml(pick(row, ["說明", "備註", "description", "內容"]));
  const eventType = rawType || inferEventType(`${rawTitle} ${description}`);
  const title = rawTitle || eventType;

  if (!stockCode || !eventDate || !title) return null;

  return {
    stockCode,
    eventDate,
    eventType,
    title,
    description,
    importance: getImportance(eventType),
    source: "CSV IMPORT",
    sourceUrl: csvPath,
  };
}

async function insertEvents(conn, events) {
  let imported = 0;
  let skipped = 0;

  for (const event of events) {
    if (!event.stockCode || !event.eventDate || !event.eventType || !event.title) {
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
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        description = VALUES(description),
        importance = VALUES(importance),
        source = VALUES(source),
        source_url = VALUES(source_url),
        is_active = 1,
        updated_at = CURRENT_TIMESTAMP
      `,
      [
        event.stockCode,
        event.eventDate,
        event.eventType,
        event.title,
        event.description || "",
        event.importance || getImportance(event.eventType),
        event.source || "OFFICIAL",
        event.sourceUrl || "",
      ],
    );

    imported += 1;
  }

  return { imported, skipped };
}

async function importCsvFile(csvPath) {
  const fullPath = path.resolve(csvPath);
  const text = await fs.readFile(fullPath, "utf8");
  const rows = parseCsv(text);
  const events = [];

  for (const row of rows) {
    const event = normalizeCsvRow(row, fullPath);
    if (event) events.push(event);
  }

  return events;
}

async function importOfficialSources() {
  const allEvents = [];
  const sourceResults = [];

  for (const source of OFFICIAL_SOURCES) {
    const urlValue = source.url();
    const sourceWithUrl = { ...source, urlValue };

    try {
      const text = await fetchText(urlValue);
      const rows = parseRemoteRows(text);
      const events = parseGenericCalendarRows(rows, sourceWithUrl);

      sourceResults.push({
        name: source.name,
        ok: true,
        rows: rows.length,
        events: events.length,
        url: urlValue,
      });

      events.forEach((event) => pushEvent(allEvents, event));
    } catch (error) {
      sourceResults.push({
        name: source.name,
        ok: false,
        optional: Boolean(source.optional),
        rows: 0,
        events: 0,
        url: urlValue,
        error: error.message,
      });
    }
  }

  return { events: allEvents, sourceResults };
}

function getArgValue(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return "";
  return process.argv[index + 1] || "";
}

async function main() {
  const csvArg = getArgValue("--csv");
  const positionalCsv = process.argv.find((item, index) =>
    index > 1 &&
    !item.startsWith("--") &&
    /\.(csv|txt)$/i.test(item)
  );
  const csvPath = csvArg || positionalCsv;
  const conn = await pool.getConnection();

  try {
    let events = [];
    let sourceResults = [];

    if (csvPath) {
      console.log(`開始匯入個股/ETF 行事曆事件：CSV ${csvPath}`);
      events = await importCsvFile(csvPath);
      sourceResults = [{ name: "CSV IMPORT", ok: true, rows: events.length, events: events.length, url: csvPath }];
    } else {
      console.log("開始匯入個股/ETF 行事曆事件：官方 / 半官方資料來源");
      const officialResult = await importOfficialSources();
      events = officialResult.events;
      sourceResults = officialResult.sourceResults;
    }

    for (const result of sourceResults) {
      if (result.ok) {
        console.log(`完成來源：${result.name}，原始 ${result.rows} 筆，可匯入事件 ${result.events} 筆`);
      } else {
        const level = result.optional ? "略過來源" : "來源失敗";
        console.log(`${level}：${result.name}，${result.error}`);
      }
    }

    const { imported, skipped } = await insertEvents(conn, events);

    console.log(`完成：匯入 / 更新 ${imported} 筆，略過 ${skipped} 筆`);

    if (!csvPath && imported === 0) {
      throw new Error("所有官方 / 半官方行事曆來源都沒有可匯入資料，請改用 CSV 匯入或檢查來源格式。");
    }
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
