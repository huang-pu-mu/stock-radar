import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageJsonPath = path.resolve(__dirname, "..", "package.json");

const officialScripts = {
  "official:setup": "node scripts/setupOfficialTables.js",
  "official:market": "node scripts/importMarketDailySummaries.js",
  "official:revenue": "node scripts/importMonthlyRevenues.js",
  "official:eps": "node scripts/importQuarterlyEps.js",
  "official:events": "node scripts/importStockCalendarEvents.js",
  "official:etf": "node scripts/syncEtfProfilesFromStocks.js",
  "official:institutional-amounts": "node scripts/importInstitutionalAmountSummaries.js",
  "official:daily": "npm run official:market && npm run official:revenue && npm run official:eps && npm run official:etf && npm run official:events && npm run official:institutional-amounts",
};

function main() {
  if (!fs.existsSync(packageJsonPath)) {
    throw new Error(`找不到 package.json：${packageJsonPath}`);
  }

  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
  packageJson.scripts = packageJson.scripts || {};

  for (const [name, command] of Object.entries(officialScripts)) {
    packageJson.scripts[name] = command;
  }

  fs.writeFileSync(
    packageJsonPath,
    `${JSON.stringify(packageJson, null, 2)}\n`,
    "utf8"
  );

  console.log("✅ 已更新 package.json scripts");
  console.log("新增 / 覆蓋以下指令：");
  for (const name of Object.keys(officialScripts)) {
    console.log(`- npm run ${name}`);
  }
}

try {
  main();
} catch (error) {
  console.error("❌ 更新 package.json scripts 失敗");
  console.error(error);
  process.exit(1);
}
