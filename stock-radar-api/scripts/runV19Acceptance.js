import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { spawn } from "child_process";
import dotenv from "dotenv";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const apiDir = path.resolve(__dirname, "..");
const projectRoot = path.resolve(apiDir, "..");
const logDir = path.join(apiDir, "logs");
const args = process.argv.slice(2);

function hasFlag(name) {
  return args.includes(`--${name}`);
}

function getArg(name) {
  const prefix = `--${name}=`;
  const found = args.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : "";
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function formatDateTime(date) {
  return [date.getFullYear(), pad(date.getMonth() + 1), pad(date.getDate()), "-", pad(date.getHours()), pad(date.getMinutes()), pad(date.getSeconds())].join("");
}

function formatDuration(ms) {
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}分${seconds}秒`;
}

function appendLine(logStream, message = "") {
  const line = `${message}\n`;
  process.stdout.write(line);
  logStream.write(line);
}

function runCommand(logStream, title, command, commandArgs, options = {}) {
  return new Promise((resolve, reject) => {
    appendLine(logStream, "--------------------------------------------------");
    appendLine(logStream, `開始：${title}`);
    appendLine(logStream, `指令：${command} ${commandArgs.join(" ")}`);

    const startedAt = Date.now();
    const child = spawn(command, commandArgs, {
      cwd: options.cwd || apiDir,
      shell: process.platform === "win32",
      env: { ...process.env, FORCE_COLOR: "0" },
    });

    child.stdout.on("data", (data) => {
      const text = data.toString();
      process.stdout.write(text);
      logStream.write(text);
    });

    child.stderr.on("data", (data) => {
      const text = data.toString();
      process.stderr.write(text);
      logStream.write(text);
    });

    child.on("error", (error) => reject(error));
    child.on("close", (code) => {
      const duration = formatDuration(Date.now() - startedAt);
      if (code === 0) {
        appendLine(logStream, `完成：${title}，耗時 ${duration}`);
        resolve();
        return;
      }

      const error = new Error(`${title} 失敗，exit code: ${code}，耗時 ${duration}`);
      if (options.optional) {
        appendLine(logStream, `警告：${error.message}`);
        resolve({ warning: error.message });
        return;
      }
      reject(error);
    });
  });
}

async function main() {
  dotenv.config({ path: path.join(apiDir, ".env") });
  fs.mkdirSync(logDir, { recursive: true });

  const startedAt = new Date();
  const logFile = path.join(logDir, `v19-acceptance-${formatDateTime(startedAt)}.log`);
  const logStream = fs.createWriteStream(logFile, { flags: "a" });
  const apiBaseUrl = getArg("api");
  const tradeDate = getArg("date");
  const skipDb = hasFlag("skip-db");
  const failures = [];
  const warnings = [];

  appendLine(logStream, "====================================");
  appendLine(logStream, "Stock Radar V1.9 自動驗收測試");
  appendLine(logStream, "====================================");
  appendLine(logStream, `工作目錄：${apiDir}`);
  appendLine(logStream, `Log 檔案：${logFile}`);
  appendLine(logStream, `開始時間：${startedAt.toLocaleString("zh-TW", { hour12: false })}`);
  appendLine(logStream, `API：${apiBaseUrl || "未指定，只做本機靜態檢查"}`);
  appendLine(logStream, `DB流程：${skipDb ? "略過" : "執行 setup / generate"}`);

  const tasks = [
    { title: "API 語法檢查", command: "node", args: ["--check", "server.js"], cwd: apiDir },
    { title: "PWA app.js 語法檢查", command: "node", args: ["--check", path.join(projectRoot, "stock-radar-frontend", "app.js")], cwd: apiDir },
  ];

  if (!skipDb) {
    tasks.push({ title: "建立 V1.9 大戶持股趨勢資料表", command: "npm", args: ["run", "big-holder:setup"], cwd: apiDir });
    tasks.push({ title: "產生大戶持股趨勢訊號", command: "npm", args: ["run", "big-holder:generate", ...(tradeDate ? ["--", tradeDate] : [])], cwd: apiDir });
  }

  tasks.push({ title: "V1.9 靜態 / API 驗收", command: "npm", args: ["run", "v19:check", ...(apiBaseUrl ? ["--", `--api=${apiBaseUrl}`] : [])], cwd: apiDir });

  for (const task of tasks) {
    try {
      const result = await runCommand(logStream, task.title, task.command, task.args, task);
      if (result?.warning) warnings.push(result.warning);
    } catch (error) {
      failures.push(error.message);
      appendLine(logStream, `錯誤：${error.message}`);
      break;
    }
  }

  const finishedAt = new Date();
  appendLine(logStream, "--------------------------------------------------");
  appendLine(logStream, `結束時間：${finishedAt.toLocaleString("zh-TW", { hour12: false })}`);
  appendLine(logStream, `總耗時：${formatDuration(finishedAt.getTime() - startedAt.getTime())}`);

  if (warnings.length > 0) {
    appendLine(logStream, `警告：${warnings.length} 項`);
    warnings.forEach((warning, index) => appendLine(logStream, `${index + 1}. ${warning}`));
  }

  if (failures.length > 0) {
    appendLine(logStream, `結果：FAIL，失敗 ${failures.length} 項`);
    failures.forEach((failure, index) => appendLine(logStream, `${index + 1}. ${failure}`));
    logStream.end();
    process.exit(1);
  }

  appendLine(logStream, warnings.length > 0 ? "結果：WARN，可先貼 log 檢查" : "結果：PASS");
  logStream.end();
}

main().catch((error) => {
  console.error("V1.9 自動驗收測試失敗：", error);
  process.exit(1);
});
