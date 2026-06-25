import dotenv from "dotenv";
import pool from "../db.js";

dotenv.config();

const args = process.argv.slice(2);
const dateArg = args.find((arg) => /^\d{4}-\d{2}-\d{2}$/.test(arg)) || "";

function toNumber(value, fallback = 0) {
  if (value === null || value === undefined || value === "") return fallback;
  const numberValue = Number(String(value).replaceAll(",", ""));
  return Number.isFinite(numberValue) ? numberValue : fallback;
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(toNumber(value, 0) * factor) / factor;
}

function todayTaipeiDate() {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

async function tableExists(conn, tableName) {
  const rows = await conn.query(
    "SELECT COUNT(*) AS table_count FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?",
    [tableName],
  );
  return Number(rows?.[0]?.table_count || 0) > 0;
}

function getRiskLevel(metrics, plan) {
  const exposure = toNumber(metrics.riskExposurePct, 0);
  const largestSingle = toNumber(metrics.largestSingleStockPct, 0);
  const largestIndustry = toNumber(metrics.largestIndustryPct, 0);
  const cashRatio = toNumber(metrics.cashRatioPct, 0);
  const maxExposure = toNumber(plan.max_risk_exposure_pct, 70);
  const maxSingle = toNumber(plan.max_single_stock_pct, 20);
  const maxIndustry = toNumber(plan.max_industry_pct, 35);
  const mode = String(plan.market_mode || "RANGE").toUpperCase();

  if (exposure > maxExposure + 15 || largestSingle > maxSingle + 10 || largestIndustry > maxIndustry + 15) return "HIGH";
  if (mode === "BEAR" && exposure > 50) return "HIGH";
  if (mode === "BEAR" && cashRatio < 35) return "WARN";
  if (exposure > maxExposure || largestSingle > maxSingle || largestIndustry > maxIndustry) return "WARN";
  if (mode === "BULL" && exposure <= maxExposure && largestSingle <= maxSingle) return "GOOD";
  return "NORMAL";
}

function buildRiskMessage(level, metrics, plan) {
  const mode = String(plan.market_mode || "RANGE").toUpperCase();
  if (level === "HIGH") return { summary: "部位曝險或集中度偏高，建議降低單檔 / 產業集中或提高現金比重。", action: "風險升高，建議保守" };
  if (level === "WARN") return { summary: "部位接近設定上限，建議暫緩加碼並檢查分批計畫。", action: "先觀察，不急著加碼" };
  if (level === "GOOD") return { summary: "目前部位配置符合上限，且市場模式偏多，可依計畫分批執行。", action: "可依計畫分批布局" };
  return { summary: `目前市場模式為 ${mode}，部位比例與集中度仍在可控範圍。`, action: "維持紀律，依風控線操作" };
}

async function getSnapshotDate(conn) {
  if (dateArg) return dateArg;
  const rows = await conn.query("SELECT DATE_FORMAT(CURRENT_DATE(), '%Y-%m-%d') AS snapshot_date");
  return rows?.[0]?.snapshot_date || todayTaipeiDate();
}

async function generateSnapshots(conn, snapshotDate) {
  const planRows = await conn.query(
    `
    SELECT *
    FROM portfolio_plans
    WHERE is_active = 1
    ORDER BY user_id ASC, id ASC
    `,
  );

  let generatedCount = 0;

  for (const plan of planRows) {
    const positionRows = await conn.query(
      `
      SELECT *
      FROM portfolio_plan_positions
      WHERE user_id = ? AND plan_id = ? AND is_active = 1
      ORDER BY target_weight_pct DESC, planned_amount DESC, id ASC
      `,
      [plan.user_id, plan.id],
    );

    const totalCapital = toNumber(plan.total_capital, 0);
    const investedAmount = round(positionRows.reduce((sum, row) => sum + toNumber(row.planned_amount, 0), 0), 2);
    const cashAmount = round(plan.cash_amount !== null && plan.cash_amount !== undefined ? plan.cash_amount : Math.max(0, totalCapital - investedAmount), 2);
    const positionCount = positionRows.length;
    const positionRatioPct = totalCapital > 0 ? round((investedAmount / totalCapital) * 100, 4) : 0;
    const cashRatioPct = totalCapital > 0 ? round((cashAmount / totalCapital) * 100, 4) : 0;
    const largestSingleStockPct = positionRows.reduce((max, row) => Math.max(max, toNumber(row.target_weight_pct, 0)), 0);
    const industryTotals = new Map();
    for (const row of positionRows) {
      const key = row.industry || "未分類";
      industryTotals.set(key, (industryTotals.get(key) || 0) + toNumber(row.planned_amount, 0));
    }
    const largestIndustryAmount = Math.max(0, ...Array.from(industryTotals.values()));
    const largestIndustryPct = totalCapital > 0 ? round((largestIndustryAmount / totalCapital) * 100, 4) : 0;
    const mode = String(plan.market_mode || "RANGE").toUpperCase();
    const marketMultiplier = mode === "BEAR" ? 1.25 : mode === "BULL" ? 0.9 : 1;
    const riskExposurePct = round(positionRatioPct * marketMultiplier, 4);
    const metrics = { riskExposurePct, largestSingleStockPct, largestIndustryPct, cashRatioPct };
    const riskLevel = getRiskLevel(metrics, plan);
    const message = buildRiskMessage(riskLevel, metrics, plan);

    await conn.query(
      `
      INSERT INTO portfolio_risk_snapshots (
        user_id, plan_id, snapshot_date, total_capital, invested_amount, cash_amount,
        position_count, position_ratio_pct, cash_ratio_pct, largest_single_stock_pct,
        largest_industry_pct, risk_exposure_pct, market_mode, portfolio_risk_level,
        risk_summary, ai_action
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        total_capital = VALUES(total_capital),
        invested_amount = VALUES(invested_amount),
        cash_amount = VALUES(cash_amount),
        position_count = VALUES(position_count),
        position_ratio_pct = VALUES(position_ratio_pct),
        cash_ratio_pct = VALUES(cash_ratio_pct),
        largest_single_stock_pct = VALUES(largest_single_stock_pct),
        largest_industry_pct = VALUES(largest_industry_pct),
        risk_exposure_pct = VALUES(risk_exposure_pct),
        market_mode = VALUES(market_mode),
        portfolio_risk_level = VALUES(portfolio_risk_level),
        risk_summary = VALUES(risk_summary),
        ai_action = VALUES(ai_action)
      `,
      [
        plan.user_id,
        plan.id,
        snapshotDate,
        totalCapital,
        investedAmount,
        cashAmount,
        positionCount,
        positionRatioPct,
        cashRatioPct,
        largestSingleStockPct,
        largestIndustryPct,
        riskExposurePct,
        mode,
        riskLevel,
        message.summary,
        message.action,
      ],
    );
    generatedCount += 1;
  }

  return { planCount: planRows.length, generatedCount };
}

async function main() {
  console.log("====================================");
  console.log("Stock Radar V2.4 部位模擬與風險觀察產生");
  console.log("====================================");

  let conn;
  try {
    conn = await pool.getConnection();
    for (const tableName of ["portfolio_plans", "portfolio_plan_positions", "portfolio_risk_snapshots"]) {
      if (!(await tableExists(conn, tableName))) throw new Error(`缺少資料表 ${tableName}，請先執行 npm run portfolio:setup`);
    }

    const snapshotDate = await getSnapshotDate(conn);
    const result = await generateSnapshots(conn, snapshotDate);
    console.log(`快照日期：${snapshotDate}`);
    console.log(`啟用計畫：${result.planCount}`);
    console.log(`產生快照：${result.generatedCount}`);
    console.log("結果：PASS");
  } finally {
    if (conn) conn.release();
    await pool.end();
  }
}

main().catch(async (error) => {
  console.error("結果：FAIL");
  console.error(error);
  try { await pool.end(); } catch {}
  process.exit(1);
});
