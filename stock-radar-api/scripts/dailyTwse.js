import { spawn } from "node:child_process";

const AUTO_LOOKBACK_DAYS = 10;

function getTaiwanToday() {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Taipei",
  }).format(new Date());
}

function normalizeDate(inputDate) {
  const dateText = inputDate || getTaiwanToday();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateText)) {
    throw new Error("日期格式錯誤，請使用 YYYY-MM-DD，例如 2026-06-16");
  }

  return dateText;
}

function addDays(dateText, days) {
  const [year, month, day] = dateText.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));

  return date.toISOString().slice(0, 10);
}

function toTwseDate(dateText) {
  return dateText.replaceAll("-", "");
}

function toTpexDate(dateText) {
  const clean = toTwseDate(dateText);
  const year = Number(clean.slice(0, 4));
  const rocYear = year - 1911;

  if (rocYear <= 0) {
    throw new Error("TPEx 日期轉換失敗，西元年必須大於 1911");
  }

  return `${rocYear}/${clean.slice(4, 6)}/${clean.slice(6, 8)}`;
}

function stripHtml(value) {
  return String(value ?? "")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, "")
    .replace(/\u00a0/g, "")
    .trim();
}

function isCommonStockCode(code) {
  return /^\d{4}$/.test(code) && !code.startsWith("00");
}

function normalizeKey(value) {
  return String(value ?? "")
    .replace(/\s+/g, "")
    .replace(/　/g, "")
    .trim();
}

function collectTwseTables(json) {
  const candidates = [];

  if (Array.isArray(json.tables)) {
    for (const table of json.tables) {
      candidates.push({
        fields: table.fields || [],
        data: table.data || [],
      });
    }
  }

  if (Array.isArray(json.fields) && Array.isArray(json.data)) {
    candidates.push({
      fields: json.fields,
      data: json.data,
    });
  }

  for (const key of Object.keys(json)) {
    if (!key.startsWith("fields")) continue;

    const suffix = key.replace("fields", "");
    const dataKey = `data${suffix}`;

    if (Array.isArray(json[key]) && Array.isArray(json[dataKey])) {
      candidates.push({
        fields: json[key],
        data: json[dataKey],
      });
    }
  }

  return candidates;
}

function hasRequiredFields(table, requiredKeywords) {
  const fieldText = table.fields.join("|");
  return requiredKeywords.every((keyword) => fieldText.includes(keyword));
}

function getTpexRows(json) {
  if (Array.isArray(json)) return json;

  const rowKeys = ["aaData", "data", "dataList", "tables"];

  for (const key of rowKeys) {
    const value = json?.[key];

    if (!Array.isArray(value)) continue;

    if (key === "tables") {
      for (const table of value) {
        if (Array.isArray(table?.data)) return table.data;
        if (Array.isArray(table?.aaData)) return table.aaData;
      }
    }

    return value;
  }

  return [];
}

function objectValue(row, candidates) {
  if (!row || Array.isArray(row) || typeof row !== "object") return undefined;

  const entries = Object.entries(row);

  for (const candidate of candidates) {
    const expectedKey = normalizeKey(candidate);
    const found = entries.find(([key]) => normalizeKey(key) === expectedKey);

    if (found) return found[1];
  }

  for (const candidate of candidates) {
    const found = entries.find(([key]) => {
      const normalizedKey = normalizeKey(key);
      return normalizedKey.includes(normalizeKey(candidate));
    });

    if (found) return found[1];
  }

  return undefined;
}

function tpexRowCode(row) {
  if (Array.isArray(row)) return stripHtml(row[0]);

  return stripHtml(
    objectValue(row, [
      "SecuritiesCompanyCode",
      "Code",
      "代號",
      "證券代號",
      "有價證券代號",
    ]),
  );
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 stock-radar-api",
      Accept: "application/json, text/javascript, */*; q=0.01",
      "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.8",
      ...options.headers,
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP 錯誤：${response.status}`);
  }

  const text = await response.text();
  const cleanText = text.replace(/^\uFEFF/, "").trim();

  if (!cleanText) return null;

  return JSON.parse(cleanText);
}

async function hasTwseDailyData(dateText) {
  const twseDate = toTwseDate(dateText);
  const url = `https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX?date=${twseDate}&type=ALLBUT0999&response=json`;
  const json = await fetchJson(url);

  if (!json) return false;

  if (json.stat && !String(json.stat).includes("OK")) {
    return false;
  }

  const table = collectTwseTables(json).find((item) =>
    hasRequiredFields(item, ["證券代號", "證券名稱", "收盤價", "成交股數"]),
  );

  return Array.isArray(table?.data) && table.data.length > 0;
}

async function hasTpexDailyData(dateText) {
  const tpexDate = toTpexDate(dateText);
  const url = `https://www.tpex.org.tw/web/stock/aftertrading/daily_close_quotes/stk_quote_result.php?l=zh-tw&o=json&d=${encodeURIComponent(
    tpexDate,
  )}&s=0,asc,0`;

  const json = await fetchJson(url, {
    headers: {
      Referer: "https://www.tpex.org.tw/zh-tw/mainboard/trading/info/mi-pricing.html",
    },
  });

  const rows = getTpexRows(json);

  return rows.some((row) => isCommonStockCode(tpexRowCode(row)));
}

async function resolveTradeDate(inputDate) {
  const requestedDate = normalizeDate(inputDate);

  if (inputDate) {
    console.log(`使用手動指定日期：${requestedDate}`);
    return requestedDate;
  }

  console.log(`未指定日期，自動尋找最近可用交易日，起始日期：${requestedDate}`);
  console.log(`最多往前檢查 ${AUTO_LOOKBACK_DAYS} 天`);

  let candidateDate = requestedDate;

  for (let index = 0; index < AUTO_LOOKBACK_DAYS; index += 1) {
    try {
      const [twseOk, tpexOk] = await Promise.all([
        hasTwseDailyData(candidateDate),
        hasTpexDailyData(candidateDate),
      ]);

      if (twseOk && tpexOk) {
        if (candidateDate !== requestedDate) {
          console.log(`今日或指定日期無完整交易資料，改用最近可用交易日：${candidateDate}`);
        } else {
          console.log(`確認今日交易資料已可用：${candidateDate}`);
        }

        return candidateDate;
      }

      console.log(
        `略過 ${candidateDate}：TWSE=${twseOk ? "有資料" : "無資料"}，TPEx=${
          tpexOk ? "有資料" : "無資料"
        }`,
      );
    } catch (error) {
      console.log(`略過 ${candidateDate}：交易日檢查失敗：${error.message}`);
    }

    candidateDate = addDays(candidateDate, -1);
  }

  throw new Error(
    `最近 ${AUTO_LOOKBACK_DAYS} 天找不到 TWSE + TPEx 都有資料的交易日，請手動指定日期，例如：npm run daily -- 2026-06-18`,
  );
}

function runCommand(commandArgs) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, commandArgs, {
      stdio: "inherit",
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(
          new Error(`node ${commandArgs.join(" ")} 執行失敗，代碼：${code}`),
        );
      }
    });
  });
}

async function main() {
  const tradeDate = await resolveTradeDate(process.argv[2]);

  try {
    console.log("====================================");
    console.log(`開始每日台股資料流程：${tradeDate}`);
    console.log("====================================");

    console.log("");
    console.log("步驟 1：匯入 TWSE 上市資料");
    await runCommand(["scripts/importDailyTwse.js", tradeDate]);

    console.log("");
    console.log("步驟 2：匯入 TPEx 上櫃資料");
    await runCommand(["scripts/importDailyTpex.js", tradeDate]);

    console.log("");
    console.log("步驟 3：補齊上市＋上櫃產業分類");
    await runCommand(["scripts/updateIndustries.js"]);

    console.log("");
    console.log("步驟 4：匯入 TDCC 集保大戶籌碼資料");
    try {
      await runCommand(["scripts/importMajorHolders.js"]);
    } catch (error) {
      console.log("集保大戶資料匯入失敗，先保留其他每日資料流程。原因：" + error.message);
    }

    console.log("");
    console.log("步驟 5：計算上市＋上櫃籌碼分數");
    await runCommand(["scripts/calculateChipScores.js", tradeDate]);

    console.log("");
    console.log("====================================");
    console.log("每日流程完成");
    console.log(`日期：${tradeDate}`);
    console.log("可以查詢：");
    console.log("http://localhost:3000/radar/top");
    console.log("http://localhost:3000/foreign/top");
    console.log("http://localhost:3000/radar/today");
    console.log("http://localhost:3000/radar/major-holder");
    console.log("====================================");
  } catch (error) {
    console.error("");
    console.error("每日流程失敗");
    console.error(error.message);

    process.exit(1);
  }
}

main().catch((error) => {
  console.error("每日流程失敗");
  console.error(error.message);
  process.exit(1);
});
