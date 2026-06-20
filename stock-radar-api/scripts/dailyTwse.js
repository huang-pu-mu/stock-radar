import { spawn } from "node:child_process";

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
  const tradeDate = normalizeDate(process.argv[2]);

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
    console.log("步驟 6：產生自選股提醒");
    try {
      await runCommand(["scripts/generateWatchlistAlerts.js", tradeDate]);
    } catch (error) {
      console.log("自選股提醒產生失敗，先保留其他每日資料流程。原因：" + error.message);
    }

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

main();
