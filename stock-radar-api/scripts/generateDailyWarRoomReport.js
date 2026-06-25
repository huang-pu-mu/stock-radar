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

async function getReportDate(conn) {
  if (dateArg) return dateArg;
  if (await tableExists(conn, "ai_selection_signals")) {
    const rows = await conn.query("SELECT DATE_FORMAT(MAX(trade_date), '%Y-%m-%d') AS latest_date FROM ai_selection_signals");
    if (rows?.[0]?.latest_date) return rows[0].latest_date;
  }
  if (await tableExists(conn, "daily_prices")) {
    const rows = await conn.query("SELECT DATE_FORMAT(MAX(trade_date), '%Y-%m-%d') AS latest_date FROM daily_prices");
    if (rows?.[0]?.latest_date) return rows[0].latest_date;
  }
  return todayTaipeiDate();
}

async function getLatestMarketRisk(conn) {
  if (!(await tableExists(conn, "market_risk_snapshots"))) return null;
  const rows = await conn.query(
    `
    SELECT
      DATE_FORMAT(trade_date, '%Y-%m-%d') AS trade_date_text,
      market_risk_score,
      market_risk_level,
      market_mode,
      night_signal,
      risk_summary
    FROM market_risk_snapshots
    ORDER BY trade_date DESC, snapshot_time DESC, id DESC
    LIMIT 1
    `,
  );
  return rows?.[0] || null;
}

async function getLatestGlobalRisk(conn) {
  if (!(await tableExists(conn, "global_market_snapshots"))) return null;
  const rows = await conn.query(
    `
    SELECT
      DATE_FORMAT(trade_date, '%Y-%m-%d') AS trade_date_text,
      global_risk_score,
      global_risk_level,
      global_market_mode,
      us_market_status,
      technology_pressure,
      semiconductor_pressure,
      opening_gap_probability,
      risk_summary
    FROM global_market_snapshots
    ORDER BY trade_date DESC, snapshot_time DESC, id DESC
    LIMIT 1
    `,
  );
  return rows?.[0] || null;
}

async function getTopAiSignals(conn, limit = 8) {
  if (!(await tableExists(conn, "ai_selection_signals"))) return [];
  return conn.query(
    `
    SELECT
      DATE_FORMAT(trade_date, '%Y-%m-%d') AS trade_date_text,
      stock_code,
      stock_name,
      market_type,
      industry,
      ai_strength_score,
      ai_level,
      ai_status,
      risk_level,
      recommend_reason,
      avoid_reason
    FROM ai_selection_signals
    WHERE trade_date = (SELECT MAX(trade_date) FROM ai_selection_signals)
    ORDER BY ai_strength_score DESC, id ASC
    LIMIT ?
    `,
    [limit],
  );
}

async function getLatestPositionSnapshots(conn, limit = 8) {
  if (!(await tableExists(conn, "user_position_snapshots"))) return [];
  return conn.query(
    `
    SELECT
      DATE_FORMAT(s.trade_date, '%Y-%m-%d') AS trade_date_text,
      s.stock_code,
      COALESCE(p.stock_name, s.stock_code) AS stock_name,
      s.unrealized_profit_loss_pct,
      s.ai_strength_score,
      s.position_risk_level,
      s.ai_action,
      s.ai_reason
    FROM user_position_snapshots s
    LEFT JOIN user_positions p ON p.id = s.position_id
    WHERE s.trade_date = (SELECT MAX(trade_date) FROM user_position_snapshots)
    ORDER BY FIELD(s.position_risk_level, 'HIGH', 'WARN', 'NORMAL', 'LOW'), s.ai_strength_score ASC, s.id DESC
    LIMIT ?
    `,
    [limit],
  );
}

async function getLatestRiskAlerts(conn, limit = 8) {
  if (!(await tableExists(conn, "position_risk_alerts"))) return [];
  return conn.query(
    `
    SELECT
      DATE_FORMAT(a.alert_date, '%Y-%m-%d') AS alert_date_text,
      a.stock_code,
      COALESCE(p.stock_name, a.stock_code) AS stock_name,
      a.alert_type,
      a.alert_level,
      a.alert_title,
      a.alert_message,
      a.is_read
    FROM position_risk_alerts a
    LEFT JOIN user_positions p ON p.id = a.position_id
    ORDER BY a.is_read ASC, a.alert_date DESC, a.id DESC
    LIMIT ?
    `,
    [limit],
  );
}

async function getIndustryStrength(conn, limit = 5) {
  if (!(await tableExists(conn, "ai_selection_signals"))) return [];
  return conn.query(
    `
    SELECT
      COALESCE(NULLIF(industry, ''), '未分類') AS industry,
      COUNT(*) AS stock_count,
      ROUND(AVG(ai_strength_score), 2) AS avg_ai_strength_score,
      MAX(ai_strength_score) AS top_ai_strength_score
    FROM ai_selection_signals
    WHERE trade_date = (SELECT MAX(trade_date) FROM ai_selection_signals)
    GROUP BY COALESCE(NULLIF(industry, ''), '未分類')
    HAVING COUNT(*) >= 1
    ORDER BY avg_ai_strength_score DESC, stock_count DESC
    LIMIT ?
    `,
    [limit],
  );
}

function chooseMarketMode(marketRisk, globalRisk) {
  const marketMode = String(marketRisk?.market_mode || "").toUpperCase();
  const globalMode = String(globalRisk?.global_market_mode || "").toUpperCase();
  if (marketMode === "BEAR" || globalMode === "BEAR") return "BEAR";
  if (marketMode === "BULL" && globalMode !== "BEAR") return "BULL";
  return "RANGE";
}

function buildActionSummary(mode, marketRisk, globalRisk, riskAlerts) {
  const marketScore = toNumber(marketRisk?.market_risk_score, 70);
  const globalScore = toNumber(globalRisk?.global_risk_score, 70);
  if (mode === "BEAR" || marketScore < 45 || globalScore < 45) return "今日作戰重點：降低追高、檢查停損線、優先處理高風險持股。";
  if (riskAlerts.length > 0) return "今日作戰重點：先處理持股風控提醒，再評估 AI 觀察股。";
  if (mode === "BULL") return "今日作戰重點：可依計畫分批布局，但仍需避開過熱與高風險標的。";
  return "今日作戰重點：維持觀察，等待強勢股與市場風險同步確認。";
}

function buildLineMessage(reportDate, mode, topSignals, riskAlerts, actionSummary) {
  const topText = topSignals.slice(0, 3).map((row) => `${row.stock_code} ${row.stock_name || ""} ${round(row.ai_strength_score, 2)}`).join("、") || "暫無";
  const riskText = riskAlerts.slice(0, 2).map((row) => `${row.stock_code} ${row.alert_title || row.alert_level}`).join("、") || "暫無";
  return [`雷達之星 V2.5 每日作戰室 ${reportDate}`, `市場模式：${mode}`, `今日觀察：${topText}`, `風控提醒：${riskText}`, actionSummary].join("\n");
}

function itemMetaJson(value) {
  try {
    return JSON.stringify(value ?? {});
  } catch {
    return "{}";
  }
}

async function generateReport(conn, reportDate) {
  const marketRisk = await getLatestMarketRisk(conn);
  const globalRisk = await getLatestGlobalRisk(conn);
  const topSignals = await getTopAiSignals(conn, 10);
  const positionSnapshots = await getLatestPositionSnapshots(conn, 10);
  const riskAlerts = await getLatestRiskAlerts(conn, 10);
  const industries = await getIndustryStrength(conn, 5);
  const marketMode = chooseMarketMode(marketRisk, globalRisk);
  const holdRows = positionSnapshots.filter((row) => !["HIGH", "WARN"].includes(String(row.position_risk_level || "").toUpperCase())).slice(0, 5);
  const reduceRows = positionSnapshots.filter((row) => ["HIGH", "WARN"].includes(String(row.position_risk_level || "").toUpperCase()) || String(row.ai_action || "").includes("減碼")).slice(0, 5);
  const actionSummary = buildActionSummary(marketMode, marketRisk, globalRisk, riskAlerts);
  const industrySummary = industries.map((row) => `${row.industry} ${round(row.avg_ai_strength_score, 2)}`).join("、") || "暫無明顯強勢產業";
  const marketSummary = marketRisk?.risk_summary || `市場模式 ${marketMode}，Market Risk Score ${round(marketRisk?.market_risk_score, 70)}。`;
  const globalSummary = globalRisk?.risk_summary || `全球風險分數 ${round(globalRisk?.global_risk_score, 70)}，開低機率 ${round(globalRisk?.opening_gap_probability, 50)}%。`;
  const positionSummary = positionSnapshots.length ? `持股快照 ${positionSnapshots.length} 筆，高風險 / 警示 ${reduceRows.length} 筆。` : "尚未有持股快照，作戰室先以市場與 AI 觀察股為主。";
  const aiStrategySummary = topSignals.length ? `AI 觀察股 ${topSignals.length} 檔，最高分 ${topSignals[0].stock_code} ${round(topSignals[0].ai_strength_score, 2)}。` : "尚未產生 AI 多因子觀察股。";
  const lineMessage = buildLineMessage(reportDate, marketMode, topSignals, riskAlerts, actionSummary);

  await conn.query(
    `
    INSERT INTO daily_war_room_reports (
      report_date, market_mode, market_risk_score, global_risk_score, portfolio_risk_level,
      top_watch_count, hold_count, reduce_count, risk_alert_count, industry_strength_summary,
      market_summary, global_summary, position_summary, ai_strategy_summary, action_summary, line_message
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      market_mode = VALUES(market_mode),
      market_risk_score = VALUES(market_risk_score),
      global_risk_score = VALUES(global_risk_score),
      portfolio_risk_level = VALUES(portfolio_risk_level),
      top_watch_count = VALUES(top_watch_count),
      hold_count = VALUES(hold_count),
      reduce_count = VALUES(reduce_count),
      risk_alert_count = VALUES(risk_alert_count),
      industry_strength_summary = VALUES(industry_strength_summary),
      market_summary = VALUES(market_summary),
      global_summary = VALUES(global_summary),
      position_summary = VALUES(position_summary),
      ai_strategy_summary = VALUES(ai_strategy_summary),
      action_summary = VALUES(action_summary),
      line_message = VALUES(line_message),
      updated_at = CURRENT_TIMESTAMP
    `,
    [
      reportDate,
      marketMode,
      marketRisk?.market_risk_score ?? null,
      globalRisk?.global_risk_score ?? null,
      reduceRows.length > 0 || riskAlerts.length > 0 ? "WARN" : "NORMAL",
      topSignals.length,
      holdRows.length,
      reduceRows.length,
      riskAlerts.length,
      industrySummary,
      marketSummary,
      globalSummary,
      positionSummary,
      aiStrategySummary,
      actionSummary,
      lineMessage,
    ],
  );

  const reportRows = await conn.query("SELECT id FROM daily_war_room_reports WHERE report_date = ? LIMIT 1", [reportDate]);
  const reportId = Number(reportRows?.[0]?.id || 0);
  if (!reportId) throw new Error("無法取得每日作戰室報告 ID");

  await conn.query("DELETE FROM daily_war_room_items WHERE report_id = ?", [reportId]);

  const items = [];
  items.push({ section: "MARKET", priority: 1, score: marketRisk?.market_risk_score ?? null, title: `市場模式：${marketMode}`, message: marketSummary, action: actionSummary, meta: marketRisk });
  items.push({ section: "GLOBAL", priority: 2, score: globalRisk?.global_risk_score ?? null, title: "全球市場狀態", message: globalSummary, action: "觀察美股、費半、VIX 與隔日開低風險。", meta: globalRisk });

  topSignals.slice(0, 8).forEach((row, index) => {
    items.push({
      section: "WATCH",
      priority: 10 + index,
      stock_code: row.stock_code,
      stock_name: row.stock_name,
      industry: row.industry,
      score: row.ai_strength_score,
      title: `${row.stock_code} ${row.stock_name || ""}`.trim(),
      message: row.recommend_reason || row.ai_status || "AI 多因子觀察股。",
      action: row.risk_level === "HIGH" ? "分數雖高但風險偏高，先觀察不追高。" : "列入今日觀察清單。",
      meta: row,
    });
  });

  industries.forEach((row, index) => {
    items.push({ section: "INDUSTRY", priority: 30 + index, industry: row.industry, score: row.avg_ai_strength_score, title: `強勢產業：${row.industry}`, message: `平均 AI 分數 ${round(row.avg_ai_strength_score, 2)}，樣本 ${row.stock_count} 檔。`, action: "觀察族群延續性與資金輪動。", meta: row });
  });

  holdRows.forEach((row, index) => {
    items.push({ section: "HOLD", priority: 50 + index, stock_code: row.stock_code, stock_name: row.stock_name, score: row.ai_strength_score, title: `持股續抱：${row.stock_code} ${row.stock_name || ""}`.trim(), message: row.ai_reason || row.ai_action || "持股風險仍在可控範圍。", action: row.ai_action || "依原風控續抱。", meta: row });
  });

  reduceRows.forEach((row, index) => {
    items.push({ section: "REDUCE", priority: 60 + index, stock_code: row.stock_code, stock_name: row.stock_name, score: row.ai_strength_score, title: `檢查減碼：${row.stock_code} ${row.stock_name || ""}`.trim(), message: row.ai_reason || row.ai_action || "持股風險升高。", action: row.ai_action || "檢查風控線與部位比例。", meta: row });
  });

  riskAlerts.slice(0, 8).forEach((row, index) => {
    items.push({ section: "RISK", priority: 70 + index, stock_code: row.stock_code, stock_name: row.stock_name, score: null, title: row.alert_title || `風控提醒：${row.stock_code}`, message: row.alert_message || row.alert_level || "持股有風控提醒。", action: "優先檢查停損、停利與持股比例。", meta: row });
  });

  for (const item of items) {
    await conn.query(
      `
      INSERT INTO daily_war_room_items (
        report_id, report_date, section_type, stock_code, stock_name, industry,
        priority, score, title, message, action_text, meta_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        reportId,
        reportDate,
        item.section,
        item.stock_code || null,
        item.stock_name || null,
        item.industry || null,
        item.priority,
        item.score ?? null,
        item.title,
        item.message || null,
        item.action || null,
        itemMetaJson(item.meta),
      ],
    );
  }

  return { reportId, itemCount: items.length, topSignals: topSignals.length, riskAlerts: riskAlerts.length };
}

async function main() {
  console.log("====================================");
  console.log("Stock Radar V2.5 每日投資作戰室產生");
  console.log("====================================");

  let conn;
  try {
    conn = await pool.getConnection();
    for (const tableName of ["daily_war_room_reports", "daily_war_room_items"]) {
      if (!(await tableExists(conn, tableName))) throw new Error(`缺少資料表 ${tableName}，請先執行 npm run war-room:setup`);
    }

    const reportDate = await getReportDate(conn);
    const result = await generateReport(conn, reportDate);
    console.log(`報告日期：${reportDate}`);
    console.log(`報告 ID：${result.reportId}`);
    console.log(`作戰項目：${result.itemCount}`);
    console.log(`AI 觀察股：${result.topSignals}`);
    console.log(`風控提醒：${result.riskAlerts}`);
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
