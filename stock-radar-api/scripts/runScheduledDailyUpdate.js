import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const apiDir = path.resolve(__dirname, '..');
const logDir = path.join(apiDir, 'logs');

function pad(value) {
  return String(value).padStart(2, '0');
}

function formatDateTime(date) {
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    '-',
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join('');
}

function formatDuration(ms) {
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}分${seconds}秒`;
}

function appendLine(logStream, message = '') {
  const line = `${message}\n`;
  process.stdout.write(line);
  logStream.write(line);
}

function runCommand(logStream, title, command, args) {
  return new Promise((resolve, reject) => {
    appendLine(logStream, '--------------------------------------------------');
    appendLine(logStream, `開始：${title}`);
    appendLine(logStream, `指令：${command} ${args.join(' ')}`);

    const startedAt = Date.now();
    const child = spawn(command, args, {
      cwd: apiDir,
      shell: process.platform === 'win32',
      env: {
        ...process.env,
        FORCE_COLOR: '0',
      },
    });

    child.stdout.on('data', (data) => {
      const text = data.toString();
      process.stdout.write(text);
      logStream.write(text);
    });

    child.stderr.on('data', (data) => {
      const text = data.toString();
      process.stderr.write(text);
      logStream.write(text);
    });

    child.on('error', (error) => {
      reject(error);
    });

    child.on('close', (code) => {
      const duration = formatDuration(Date.now() - startedAt);
      if (code === 0) {
        appendLine(logStream, `完成：${title}，耗時 ${duration}`);
        resolve();
        return;
      }

      reject(new Error(`${title} 失敗，exit code: ${code}，耗時 ${duration}`));
    });
  });
}

async function main() {
  dotenv.config({ path: path.join(apiDir, '.env') });

  fs.mkdirSync(logDir, { recursive: true });

  const startedAt = new Date();
  const logFile = path.join(logDir, `daily-update-${formatDateTime(startedAt)}.log`);
  const logStream = fs.createWriteStream(logFile, { flags: 'a' });

  const tasks = [
    {
      title: '原本每日資料更新 npm run daily',
      command: 'npm',
      args: ['run', 'daily'],
    },
    {
      title: 'V1.2 官方資料更新 npm run official:daily',
      command: 'npm',
      args: ['run', 'official:daily'],
    },
  ];

  const failures = [];

  appendLine(logStream, '====================================');
  appendLine(logStream, 'Stock Radar 每日排程更新');
  appendLine(logStream, '====================================');
  appendLine(logStream, `工作目錄：${apiDir}`);
  appendLine(logStream, `Log 檔案：${logFile}`);
  appendLine(logStream, `開始時間：${startedAt.toLocaleString('zh-TW', { hour12: false })}`);

  for (const task of tasks) {
    try {
      await runCommand(logStream, task.title, task.command, task.args);
    } catch (error) {
      failures.push(error);
      appendLine(logStream, `錯誤：${error.message}`);
    }
  }

  const finishedAt = new Date();
  appendLine(logStream, '--------------------------------------------------');
  appendLine(logStream, `結束時間：${finishedAt.toLocaleString('zh-TW', { hour12: false })}`);
  appendLine(logStream, `總耗時：${formatDuration(finishedAt.getTime() - startedAt.getTime())}`);

  if (failures.length > 0) {
    appendLine(logStream, `結果：失敗 ${failures.length} 項`);
    failures.forEach((error, index) => {
      appendLine(logStream, `${index + 1}. ${error.message}`);
    });
    logStream.end();
    process.exit(1);
  }

  appendLine(logStream, '結果：全部成功');
  logStream.end();
}

main().catch((error) => {
  console.error('排程執行失敗：', error);
  process.exit(1);
});
