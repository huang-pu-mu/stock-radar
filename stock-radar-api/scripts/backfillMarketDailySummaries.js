import pool from "../db.js";
import { importMarketDailySummariesForDate } from "./importMarketDailySummaries.js";

function normalizeDateText(inputDate, label) {
  const clean = String(inputDate || "").replaceAll("-", "").replaceAll("/", "").trim();

  if (!/^\d{8}$/.test(clean)) {
    throw new Error(`${label} 日期格式錯誤，請使用 YYYY-MM-DD，例如 2026-01-01`);
  }

  return `${clean.slice(0, 4)}-${clean.slice(4, 6)}-${clean.slice(6, 8)}`;
}

function parseArgs(argv) {
  const args = [...argv];
  const options = {
    startDate: "",
    endDate: "",
    force: false,
    includeWeekends: false,
    delayMs: 350,
  };

  const positional = [];

  for (const arg of args) {
    if (arg === "--force") {
      options.force = true;
      continue;
    }

    if (arg === "--include-weekends") {
      options.includeWeekends = true;
      continue;
    }

    if (arg.startsWith("--delay=")) {
      options.delayMs = Math.max(0, Number(arg.split("=")[1]) || 0);
      continue;
    }

    if (arg.startsWith("--start=")) {
      options.startDate = normalizeDateText(arg.split("=")[1], "start");
      continue;
    }

    if (arg.startsWith("--end=")) {
      options.endDate = normalizeDateText(arg.split("=")[1], "end");
      continue;
    }

    positional.push(arg);
  }

  if (!options.startDate && positional[0]) options.startDate = normalizeDateText(positional[0], "start");
  if (!options.endDate && positional[1]) options.endDate = normalizeDateText(positional[1], "end");

  if (!options.startDate || !options.endDate) {
    throw new Error("請提供起訖日期，例如：npm run official:market:history -- 2026-01-01 2026-06-18");
  }

  if (options.endDate < options.startDate) {
    throw new Error("結束日期不可以早於開始日期");
  }

  return options;
}

function dateToUtc(dateText) {
  const [year, month, day] = dateText.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function formatUtcDate(date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function* eachDate(startDate, endDate) {
  const current = dateToUtc(startDate);
  const end = dateToUtc(endDate);

  while (current <= end) {
    const dateText = formatUtcDate(current);
    const day = current.getUTCDay();
    yield {
      dateText,
      isWeekend: day === 0 || day === 6,
    };
    current.setUTCDate(current.getUTCDate() + 1);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getExistingMarketCount(conn, tradeDate) {
  const rows = await conn.query(
    `
    SELECT COUNT(DISTINCT market_type) AS total
    FROM market_daily_summaries
    WHERE trade_date = ?
      AND market_type IN ('上市', '上櫃')
    `,
    [tradeDate],
  );

  return Number(rows[0]?.total || 0);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const conn = await pool.getConnection();

  const summary = {
    success: 0,
    skippedExisting: 0,
    skippedWeekend: 0,
    skippedNoData: 0,
    partial: 0,
    failed: 0,
  };

  try {
    console.log("開始回補市場每日成交總覽歷史資料");
    console.log(`日期區間：${options.startDate} ~ ${options.endDate}`);
    console.log(`模式：${options.force ? "強制覆蓋 / 更新" : "已有上市與上櫃兩筆就略過"}`);

    for (const item of eachDate(options.startDate, options.endDate)) {
      if (item.isWeekend && !options.includeWeekends) {
        summary.skippedWeekend += 1;
        console.log(`略過週末：${item.dateText}`);
        continue;
      }

      const existingCount = await getExistingMarketCount(conn, item.dateText);
      if (!options.force && existingCount >= 2) {
        summary.skippedExisting += 1;
        console.log(`略過已存在：${item.dateText}，已有 ${existingCount} 個市場`);
        continue;
      }

      try {
        const result = await importMarketDailySummariesForDate(conn, item.dateText);
        const marketList = result.results.map((row) => row.marketType).join("、");
        const isPartial = result.results.length < 2;

        if (isPartial) summary.partial += 1;
        else summary.success += 1;

        console.log(`${isPartial ? "部分完成" : "完成"}：${item.dateText}，${marketList}`);

        if (result.errors.length > 0) {
          console.log(`  來源提醒：${result.errors.join("；")}`);
        }
      } catch (error) {
        summary.skippedNoData += 1;
        console.log(`略過無資料 / 休市：${item.dateText}，${error.message}`);
      }

      if (options.delayMs > 0) await sleep(options.delayMs);
    }

    console.log("市場每日成交總覽歷史回補完成");
    console.log(JSON.stringify(summary, null, 2));
  } catch (error) {
    summary.failed += 1;
    console.error("市場每日成交總覽歷史回補失敗");
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    conn.release();
    await pool.end();
  }
}

main();
