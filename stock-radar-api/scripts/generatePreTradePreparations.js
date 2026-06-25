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
  const rows = await conn.query("SELECT COUNT(*) AS table_count FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?", [tableName]);
  return Number(rows?.[0]?.table_count || 0) > 0;
}

async function getPlanDate(conn) {
  if (dateArg) return dateArg;
  if (await tableExists(conn, "trading_assistant_recommendations")) {
    const rows = await conn.query("SELECT DATE_FORMAT(MAX(recommendation_date), '%Y-%m-%d') AS latest_date FROM trading_assistant_recommendations");
    if (rows?.[0]?.latest_date) return rows[0].latest_date;
  }
  return todayTaipeiDate();
}

async function getRecommendationRows(conn, planDate) {
  if (!(await tableExists(conn, "trading_assistant_recommendations"))) return [];
  return conn.query(
    `
    SELECT
      id,
      DATE_FORMAT(recommendation_date, '%Y-%m-%d') AS recommendation_date_text,
      stock_code,
      stock_name,
      industry,
      recommendation_type,
      priority,
      ai_strength_score,
      market_mode,
      suggested_action,
      risk_note,
      plan_note,
      source_module
    FROM trading_assistant_recommendations
    WHERE recommendation_date = ?
    ORDER BY priority ASC, id ASC
    LIMIT 30
    `,
    [planDate],
  );
}

function buildEntryCondition(row) {
  const type = String(row.recommendation_type || "WATCH").toUpperCase();
  if (type === "BUY_PLAN") return "盤中價格未追高，量價續強，且大盤風險未惡化時，才可進入人工確認。";
  if (type === "REDUCE") return "持股跌破風控線、AI 分數轉弱或達到停利區時，檢查是否減碼。";
  if (type === "RISK_CHECK") return "市場模式偏弱、全球風險升高或個股風控提醒出現時，先檢查風險。";
  return "僅列入觀察清單，等待突破、回測支撐或風險降低後再規劃。";
}

function buildRiskPlan(row) {
  const mode = String(row.market_mode || "RANGE").toUpperCase();
  if (mode === "BEAR") return "BEAR 模式：降低部位、提高現金、只允許小量試單，必須設定停損與最大虧損。";
  if (mode === "BULL") return "BULL 模式：仍需分批進場，單筆風險不得超過預設上限，避免追高。";
  return "RANGE 模式：等待明確突破或拉回不破，採限價、分批與停損控管。";
}

function buildCheckItems(planType, marketMode) {
  const type = String(planType || "WATCH").toUpperCase();
  const mode = String(marketMode || "RANGE").toUpperCase();
  const base = [
    ["市場", `確認市場模式不是極端高風險，目前模式：${mode}`, 1, 10],
    ["個股", "確認股票代號、名稱、產業與交易理由正確", 1, 20],
    ["風控", "確認停損價、最大可接受虧損與部位比例", 1, 30],
    ["人工確認", "使用者手動確認後才可執行任何交易動作", 1, 90],
  ];
  if (type === "BUY_PLAN") {
    base.splice(2, 0, ["進場", "確認不追高、量價續強，且價格符合計畫", 1, 25]);
  } else if (type === "REDUCE") {
    base.splice(2, 0, ["減碼", "確認是否跌破風控線、達停利區或分數轉弱", 1, 25]);
  } else if (type === "RISK_CHECK") {
    base.splice(2, 0, ["風險", "先檢查市場風險、全球風險與持股曝險", 1, 25]);
  } else {
    base.splice(2, 0, ["觀察", "尚未符合進場條件，只列入觀察", 0, 25]);
  }
  return base;
}

async function insertCheckItems(conn, planId, planDate, planType, marketMode) {
  const items = buildCheckItems(planType, marketMode);
  for (const [group, item, required, sortOrder] of items) {
    await conn.query(
      `
      INSERT INTO pre_trade_check_items (
        plan_id, checklist_date, check_group, check_item, check_status, is_required, sort_order
      ) VALUES (?, ?, ?, ?, 'PENDING', ?, ?)
      `,
      [planId, planDate, group, item, required, sortOrder],
    );
  }
}

async function generatePreTrade(conn, planDate) {
  const rows = await getRecommendationRows(conn, planDate);

  await conn.query("DELETE FROM pre_trade_check_items WHERE checklist_date = ?", [planDate]);
  await conn.query("DELETE FROM pre_trade_plans WHERE user_id IS NULL AND plan_date = ?", [planDate]);

  let buyCount = 0;
  let reduceCount = 0;
  let riskCount = 0;
  let watchCount = 0;

  for (const row of rows) {
    const planType = String(row.recommendation_type || "WATCH").toUpperCase();
    if (planType === "BUY_PLAN") buyCount += 1;
    else if (planType === "REDUCE") reduceCount += 1;
    else if (planType === "RISK_CHECK") riskCount += 1;
    else watchCount += 1;

    const plannedPrice = null;
    const plannedShares = null;
    const positionSizePct = planType === "BUY_PLAN" ? (String(row.market_mode || "").toUpperCase() === "BEAR" ? 5 : 10) : null;
    const maxRiskAmount = null;

    const result = await conn.query(
      `
      INSERT INTO pre_trade_plans (
        user_id, plan_date, stock_code, stock_name, industry, plan_type, source_recommendation_id,
        source_module, entry_condition, risk_control_plan, planned_price, planned_shares,
        position_size_pct, max_risk_amount, manual_confirm_required, user_confirmed,
        confirmation_status, compare_status, actual_result_note
      ) VALUES (
        NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, 'PENDING', 'WAITING', NULL
      )
      `,
      [
        planDate,
        row.stock_code || null,
        row.stock_name || null,
        row.industry || null,
        planType,
        row.id || null,
        row.source_module || "TRADING_ASSISTANT",
        buildEntryCondition(row),
        buildRiskPlan(row),
        plannedPrice,
        plannedShares,
        positionSizePct,
        maxRiskAmount,
      ],
    );

    const planId = Number(result.insertId);
    await insertCheckItems(conn, planId, planDate, planType, row.market_mode);
    await conn.query(
      `
      INSERT INTO pre_trade_action_logs (
        user_id, plan_id, action_date, action_type, action_message, before_json, after_json
      ) VALUES (NULL, ?, ?, 'GENERATE', ?, NULL, JSON_OBJECT('plan_type', ?, 'stock_code', ?))
      `,
      [
        planId,
        planDate,
        `產生 V3.1 交易前檢查清單：${row.stock_code || "市場"} ${row.stock_name || ""}`,
        planType,
        row.stock_code || null,
      ],
    );
  }

  return { totalCount: rows.length, buyCount, reduceCount, riskCount, watchCount };
}

async function main() {
  console.log("====================================");
  console.log("Stock Radar V3.1 半自動交易前置準備產生");
  console.log("====================================");

  let conn;
  try {
    conn = await pool.getConnection();
    for (const tableName of ["pre_trade_plans", "pre_trade_check_items", "pre_trade_action_logs"]) {
      if (!(await tableExists(conn, tableName))) throw new Error(`缺少資料表 ${tableName}，請先執行 npm run pre-trade:setup`);
    }

    const planDate = await getPlanDate(conn);
    const result = await generatePreTrade(conn, planDate);
    console.log(`計畫日期：${planDate}`);
    console.log(`前置檢查清單：${result.totalCount}`);
    console.log(`買進計畫：${result.buyCount}`);
    console.log(`減碼檢查：${result.reduceCount}`);
    console.log(`風險檢查：${result.riskCount}`);
    console.log(`觀察清單：${result.watchCount}`);
    console.log("安全邊界：不串券商、不自動下單、必須人工確認");
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
