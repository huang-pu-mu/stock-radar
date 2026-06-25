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

async function getReportDate(conn) {
  if (dateArg) return dateArg;
  if (await tableExists(conn, "daily_war_room_reports")) {
    const rows = await conn.query("SELECT DATE_FORMAT(MAX(report_date), '%Y-%m-%d') AS latest_date FROM daily_war_room_reports");
    if (rows?.[0]?.latest_date) return rows[0].latest_date;
  }
  if (await tableExists(conn, "ai_selection_signals")) {
    const rows = await conn.query("SELECT DATE_FORMAT(MAX(trade_date), '%Y-%m-%d') AS latest_date FROM ai_selection_signals");
    if (rows?.[0]?.latest_date) return rows[0].latest_date;
  }
  return todayTaipeiDate();
}

function metaJson(value) {
  try { return JSON.stringify(value ?? {}); } catch { return "{}"; }
}

function chooseRecommendationType(row, marketMode) {
  const section = String(row.section_type || "").toUpperCase();
  const score = toNumber(row.score, 0);
  if (["RISK", "REDUCE"].includes(section)) return section === "REDUCE" ? "REDUCE" : "RISK_CHECK";
  if (section === "WATCH" && score >= 75 && marketMode !== "BEAR") return "BUY_PLAN";
  return "WATCH";
}

function buildSuggestedAction(type, marketMode) {
  if (type === "BUY_PLAN") return marketMode === "BULL" ? "可建立分批買進計畫，仍需人工確認。" : "可列入買進計畫候選，等待盤中量價確認。";
  if (type === "REDUCE") return "檢查減碼或停利停損計畫，不自動下單。";
  if (type === "RISK_CHECK") return "優先檢查風控線、部位比例與停損價。";
  return "列入觀察，不追高，等待條件符合後再建立計畫。";
}

async function getWarRoomRows(conn, reportDate) {
  if (!(await tableExists(conn, "daily_war_room_items")) || !(await tableExists(conn, "daily_war_room_reports"))) return [];
  return conn.query(
    `
    SELECT
      i.id,
      DATE_FORMAT(i.report_date, '%Y-%m-%d') AS report_date_text,
      i.section_type,
      i.stock_code,
      i.stock_name,
      i.industry,
      i.priority,
      i.score,
      i.title,
      i.message,
      i.action_text,
      i.meta_json,
      r.market_mode
    FROM daily_war_room_items i
    INNER JOIN daily_war_room_reports r ON r.id = i.report_id
    WHERE i.report_date = ?
      AND i.section_type IN ('WATCH', 'REDUCE', 'RISK')
    ORDER BY i.priority ASC, i.id ASC
    LIMIT 30
    `,
    [reportDate],
  );
}

async function getAiSelectionFallbackRows(conn, reportDate) {
  if (!(await tableExists(conn, "ai_selection_signals"))) return [];
  return conn.query(
    `
    SELECT
      NULL AS id,
      DATE_FORMAT(trade_date, '%Y-%m-%d') AS report_date_text,
      'WATCH' AS section_type,
      stock_code,
      stock_name,
      industry,
      20 AS priority,
      ai_strength_score AS score,
      CONCAT(stock_code, ' ', stock_name) AS title,
      recommend_reason AS message,
      '列入交易計畫候選，需人工確認。' AS action_text,
      NULL AS meta_json,
      'RANGE' AS market_mode
    FROM ai_selection_signals
    WHERE trade_date = (SELECT MAX(trade_date) FROM ai_selection_signals)
    ORDER BY ai_strength_score DESC, id ASC
    LIMIT 20
    `,
  );
}

async function generateTradingAssistant(conn, reportDate) {
  let rows = await getWarRoomRows(conn, reportDate);
  if (!rows.length) rows = await getAiSelectionFallbackRows(conn, reportDate);
  const marketMode = String(rows[0]?.market_mode || "RANGE").toUpperCase();

  await conn.query("DELETE FROM trading_assistant_recommendations WHERE recommendation_date = ?", [reportDate]);

  let buyPlanCount = 0;
  let reducePlanCount = 0;
  let riskCheckCount = 0;
  let manualConfirmCount = 0;
  const inserted = [];

  for (const [index, row] of rows.entries()) {
    const recommendationType = chooseRecommendationType(row, marketMode);
    if (recommendationType === "BUY_PLAN") buyPlanCount += 1;
    if (recommendationType === "REDUCE") reducePlanCount += 1;
    if (recommendationType === "RISK_CHECK") riskCheckCount += 1;
    if (["BUY_PLAN", "REDUCE", "RISK_CHECK"].includes(recommendationType)) manualConfirmCount += 1;
    const action = buildSuggestedAction(recommendationType, marketMode);
    const riskNote = marketMode === "BEAR" ? "市場模式偏空，所有交易計畫需降風險處理。" : (row.message || row.action_text || "依策略與風控條件檢查。");
    const planNote = recommendationType === "BUY_PLAN" ? "建議以小部位、分批、限價與停損線規劃；此資料只做輔助，不自動下單。" : "先檢查既有持股與風控條件，再決定是否調整。";

    await conn.query(
      `
      INSERT INTO trading_assistant_recommendations (
        recommendation_date, stock_code, stock_name, industry, recommendation_type,
        priority, ai_strength_score, market_mode, suggested_action, risk_note, plan_note, source_module, meta_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        reportDate,
        row.stock_code || null,
        row.stock_name || null,
        row.industry || null,
        recommendationType,
        Number(row.priority || 50) + index,
        row.score ?? null,
        marketMode,
        action,
        riskNote,
        planNote,
        row.section_type === "WATCH" ? "AI_SELECTION" : "WAR_ROOM",
        metaJson(row),
      ],
    );
    inserted.push(row);
  }

  const actionSummary = rows.length
    ? `V3.0 今日產生 ${rows.length} 筆交易輔助建議，其中買進計畫候選 ${buyPlanCount} 筆、減碼檢查 ${reducePlanCount} 筆、風險檢查 ${riskCheckCount} 筆；所有動作都需人工確認。`
    : "目前尚未有可產生交易輔助的作戰室或 AI 訊號資料。";
  const lineMessage = [`雷達之星 V3.0 交易輔助 ${reportDate}`, `市場模式：${marketMode}`, `建議數：${rows.length}`, `買進候選：${buyPlanCount}`, `風控檢查：${reducePlanCount + riskCheckCount}`, "所有交易計畫皆需人工確認，不會自動下單。"].join("\n");

  await conn.query(
    `
    INSERT INTO trading_assistant_reports (
      report_date, market_mode, recommendation_count, buy_plan_count, reduce_plan_count,
      risk_check_count, manual_confirm_count, action_summary, line_message
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      market_mode = VALUES(market_mode),
      recommendation_count = VALUES(recommendation_count),
      buy_plan_count = VALUES(buy_plan_count),
      reduce_plan_count = VALUES(reduce_plan_count),
      risk_check_count = VALUES(risk_check_count),
      manual_confirm_count = VALUES(manual_confirm_count),
      action_summary = VALUES(action_summary),
      line_message = VALUES(line_message),
      updated_at = CURRENT_TIMESTAMP
    `,
    [reportDate, marketMode, rows.length, buyPlanCount, reducePlanCount, riskCheckCount, manualConfirmCount, actionSummary, lineMessage],
  );

  return { recommendationCount: rows.length, buyPlanCount, reducePlanCount, riskCheckCount, manualConfirmCount, marketMode };
}

async function main() {
  console.log("====================================");
  console.log("Stock Radar V3.0 實戰交易輔助產生");
  console.log("====================================");

  let conn;
  try {
    conn = await pool.getConnection();
    for (const tableName of ["trading_assistant_accounts", "trading_plans", "trading_plan_orders", "trading_assistant_recommendations", "trading_assistant_reports"]) {
      if (!(await tableExists(conn, tableName))) throw new Error(`缺少資料表 ${tableName}，請先執行 npm run trading-assist:setup`);
    }

    const reportDate = await getReportDate(conn);
    const result = await generateTradingAssistant(conn, reportDate);
    console.log(`報告日期：${reportDate}`);
    console.log(`市場模式：${result.marketMode}`);
    console.log(`交易輔助建議：${result.recommendationCount}`);
    console.log(`買進候選：${result.buyPlanCount}`);
    console.log(`減碼檢查：${result.reducePlanCount}`);
    console.log(`風險檢查：${result.riskCheckCount}`);
    console.log(`人工確認：${result.manualConfirmCount}`);
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
