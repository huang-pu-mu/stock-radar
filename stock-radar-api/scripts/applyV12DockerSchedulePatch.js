import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const apiDir = path.resolve(__dirname, '..');
const packagePath = path.join(apiDir, 'package.json');
const gitignorePath = path.join(apiDir, '.gitignore');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function ensureGitignoreLine(line) {
  let content = '';
  if (fs.existsSync(gitignorePath)) {
    content = fs.readFileSync(gitignorePath, 'utf8');
  }

  const lines = content.split(/\r?\n/).filter(Boolean);
  if (!lines.includes(line)) {
    lines.push(line);
  }

  fs.writeFileSync(gitignorePath, `${lines.join('\n')}\n`, 'utf8');
}

function main() {
  if (!fs.existsSync(packagePath)) {
    throw new Error(`找不到 package.json：${packagePath}`);
  }

  const packageJson = readJson(packagePath);
  packageJson.scripts = packageJson.scripts || {};

  const updates = {
    'scheduled:daily': 'node scripts/runScheduledDailyUpdate.js',
    'docker:schedule:check': 'node scripts/checkDockerScheduleReady.js',
    'docker:scheduler:build': 'docker compose -f docker-compose.scheduler.yml build',
    'docker:scheduler:up': 'docker compose -f docker-compose.scheduler.yml up -d',
    'docker:scheduler:down': 'docker compose -f docker-compose.scheduler.yml down',
    'docker:scheduler:logs': 'docker logs -f stock-radar-scheduler',
    'docker:scheduler:test': 'docker exec stock-radar-scheduler /bin/sh /app/docker/run-scheduled-daily.sh',
  };

  for (const [name, command] of Object.entries(updates)) {
    packageJson.scripts[name] = command;
  }

  writeJson(packagePath, packageJson);
  ensureGitignoreLine('logs/');

  console.log('✅ 已套用 V1.2-3 NAS Docker 排程補丁');
  console.log('新增 npm 指令：');
  Object.entries(updates).forEach(([name, command]) => {
    console.log(`- ${name}: ${command}`);
  });
  console.log('');
  console.log('下一步請執行：');
  console.log('npm run docker:schedule:check');
}

main();
