import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const apiDir = path.resolve(__dirname, '..');

function pass(message) {
  console.log(`✅ ${message}`);
}

function fail(message) {
  console.log(`❌ ${message}`);
}

function warn(message) {
  console.log(`⚠️ ${message}`);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readEnv(filePath) {
  if (!fs.existsSync(filePath)) return {};

  const result = {};
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const index = line.indexOf('=');
    if (index < 0) continue;

    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim().replace(/^['"]|['"]$/g, '');
    result[key] = value;
  }
  return result;
}

const requiredScripts = [
  'daily',
  'official:daily',
  'scheduled:daily',
  'docker:schedule:check',
];

const requiredFiles = [
  'Dockerfile.scheduler',
  'docker-compose.scheduler.yml',
  'docker/scheduler-crontab',
  'docker/run-scheduled-daily.sh',
  'scripts/runScheduledDailyUpdate.js',
];

let total = 0;
let ok = 0;
const failed = [];
const warnings = [];

function check(condition, message, failedName = message) {
  total += 1;
  if (condition) {
    ok += 1;
    pass(message);
  } else {
    failed.push(failedName);
    fail(message);
  }
}

function addWarning(message) {
  warnings.push(message);
  warn(message);
}

console.log('====================================');
console.log('Stock Radar NAS Docker 排程準備檢查');
console.log('====================================');

const packagePath = path.join(apiDir, 'package.json');
const envPath = path.join(apiDir, '.env');
const logDir = path.join(apiDir, 'logs');

const packageJson = fs.existsSync(packagePath) ? readJson(packagePath) : null;
const scripts = packageJson?.scripts || {};

check(Boolean(packageJson), 'package.json 存在', 'package.json');

for (const scriptName of requiredScripts) {
  check(Boolean(scripts[scriptName]), `npm run ${scriptName} 已設定`, scriptName);
}

check(fs.existsSync(envPath), '.env 存在', '.env');

for (const fileName of requiredFiles) {
  check(fs.existsSync(path.join(apiDir, fileName)), `${fileName} 存在`, fileName);
}

if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}
check(fs.existsSync(logDir), 'logs 資料夾存在', 'logs');

const env = readEnv(envPath);
if (env.DB_HOST === '127.0.0.1' || env.DB_HOST === 'localhost') {
  addWarning('DB_HOST 目前是 localhost / 127.0.0.1。放到 Docker 容器後通常不能這樣用，建議改 NAS 區網 IP、MariaDB 容器名稱，或 host.docker.internal。');
}

if (!env.DB_HOST) addWarning('.env 內沒有 DB_HOST。');
if (!env.DB_NAME) addWarning('.env 內沒有 DB_NAME。');
if (!env.DB_USER) addWarning('.env 內沒有 DB_USER。');

console.log('');
console.log('[總結]');
console.log(`檢查項目：${total}`);
console.log(`通過：${ok}`);
console.log(`未通過：${failed.length}`);
console.log(`提醒：${warnings.length}`);

if (failed.length > 0) {
  console.log('');
  console.log('未通過項目：');
  failed.forEach((item) => console.log(`- ${item}`));
  process.exit(1);
}

console.log('');
console.log('✅ NAS Docker 排程準備檢查通過。');

if (warnings.length > 0) {
  console.log('');
  console.log('提醒事項：');
  warnings.forEach((item) => console.log(`- ${item}`));
}
