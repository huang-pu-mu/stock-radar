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

function clamp(value, min = 0, max = 100) {
  return Math.min(Math.max(toNumber(value, 0), min), max);
}

function todayTaipeiDate() {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

async function tableExists(conn, tableName) {
  const rows = await conn.query("SELECT COUNT(*) AS table_count FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?", [tableName]);
  return Number(rows?.[0]?.table_count || 0) > 0;
}

async function getRecommendationDate(conn) {
  if (dateArg) return dateArg;
  if (await tableExists(conn, "ai_selection_signals")) {
    const rows = await conn.query("SELECT DATE_FORMAT(MAX(trade_date), '%Y-%m-%d') AS latest_date FROM ai_selection_signals");
    if (rows?.[0]?.latest_date) return rows[0].latest_date;
  }
  if (await tableExists(conn, "chip_scores")) {
    const rows = await conn.query("SELECT DATE_FORMAT(MAX(trade_date), '%Y-%m-%d') AS latest_date FROM chip_scores");
    if (rows?.[0]?.latest_date) return rows[0].latest_date;
  }
  return todayTaipeiDate();
}

async function getSourceRows(conn, recommendationDate) {
  if (await tableExists(conn, "ai_selection_signals")) {
    return conn.query(
      `
      SELECT
        a.id AS source_signal_id,
        DATE_FORMAT(a.trade_date, '%Y-%m-%d') AS trade_date_text,
        a.stock_code,
        a.stock_name,
        a.market_type,
        a.industry,
        a.ai_strength_score,
        a.ai_level,
        a.candidate_horizon,
        a.risk_level,
        a.risk_flags,
        a.recommend_reason,
        a.avoid_reason,
        a.chip_factor_score,
        a.technical_factor_score,
        a.main_force_factor_score,
        a.big_holder_factor_score,
        a.market_factor_score,
        a.global_factor_score,
        a.fundamental_factor_score,
        a.breakout_score,
        a.main_force_score,
        a.big_holder_trend_score,
        a.market_risk_score,
        a.global_risk_score,
        p.close_price,
        p.price_change,
        p.volume
      FROM ai_selection_signals a
      LEFT JOIN daily_prices p
        ON p.stock_code = a.stock_code
       AND p.trade_date = a.trade_date
      WHERE a.trade_date = ?
      ORDER BY a.ai_strength_score DESC, a.stock_code ASC
      LIMIT 300
      `,
      [recommendationDate],
    );
  }

  if (await tableExists(conn, "chip_scores")) {
    return conn.query(
      `
      SELECT
        NULL AS source_signal_id,
        DATE_FORMAT(c.trade_date, '%Y-%m-%d') AS trade_date_text,
        c.stock_code,
        s.stock_name,
        s.market_type,
        s.industry,
        c.chip_score AS ai_strength_score,
        c.foreign_score AS chip_factor_score,
        c.price_score AS technical_factor_score,
        c.big_holder_score AS big_holder_factor_score,
        c.volume_score AS market_factor_score,
        NULL AS global_factor_score,
        NULL AS fundamental_factor_score,
        NULL AS market_risk_score,
        NULL AS global_risk_score,
        p.close_price,
        p.price_change,
        p.volume,
        c.foreign_status AS recommend_reason,
        c.price_position AS risk_flags
      FROM chip_scores c
      LEFT JOIN stocks s ON s.stock_code = c.stock_code
      LEFT JOIN daily_prices p ON p.stock_code = c.stock_code AND p.trade_date = c.trade_date
      WHERE c.trade_date = ?
      ORDER BY c.chip_score DESC, c.stock_code ASC
      LIMIT 300
      `,
      [recommendationDate],
    );
  }

  return [];
}

function getMarketRisk(row) {
  return row.market_risk_score === null || row.market_risk_score === undefined ? 70 : toNumber(row.market_risk_score, 70);
}

function getGlobalRisk(row) {
  return row.global_risk_score === null || row.global_risk_score === undefined ? 70 : toNumber(row.global_risk_score, 70);
}

function calculateEntryTimingScore(row) {
  const ai = clamp(row.ai_strength_score);
  const technical = clamp(row.technical_factor_score ?? row.breakout_score ?? ai);
  const priceChange = toNumber(row.price_change, 0);
  let score = 60 + (technical - 60) * 0.45 + (ai - 60) * 0.2;
  if (priceChange > 7) score -= 18;
  else if (priceChange > 5) score -= 12;
  else if (priceChange > 3.5) score -= 6;
  else if (priceChange >= -1 && priceChange <= 2.5) score += 6;
  return round(clamp(score), 2);
}

function calculateChaseRiskScore(row) {
  const priceChange = toNumber(row.price_change, 0);
  const ai = clamp(row.ai_strength_score);
  let risk = 20;
  if (priceChange > 9) risk += 45;
  else if (priceChange > 7) risk += 35;
  else if (priceChange > 5) risk += 25;
  else if (priceChange > 3) risk += 12;
  if (ai >= 90 && priceChange > 4) risk += 8;
  return round(clamp(risk), 2);
}

function calculateExitRiskScore(row) {
  const riskFlags = String(row.risk_flags || row.avoid_reason || "").toUpperCase();
  const riskLevel = String(row.risk_level || "MEDIUM").toUpperCase();
  let risk = 20;
  if (riskLevel === "HIGH") risk += 30;
  if (riskFlags.includes("RISK") || riskFlags.includes("AVOID") || riskFlags.includes("出貨") || riskFlags.includes("高風險")) risk += 25;
  if (getMarketRisk(row) < 40 || getGlobalRisk(row) < 40) risk += 30;
  return round(clamp(risk), 2);
}

function calculateAiBuyScore(row) {
  const chip = clamp(row.chip_factor_score ?? row.ai_strength_score);
  const technical = clamp(row.technical_factor_score ?? row.breakout_score ?? row.ai_strength_score);
  const mainForce = clamp(row.main_force_factor_score ?? row.main_force_score ?? 60);
  const bigHolder = clamp(row.big_holder_factor_score ?? row.big_holder_trend_score ?? 60);
  const industryFund = clamp(row.market_factor_score ?? 60);
  const fundamental = clamp(row.fundamental_factor_score ?? 60);
  const marketRisk = getMarketRisk(row);
  const globalRisk = getGlobalRisk(row);
  const marketCombo = clamp((marketRisk + globalRisk) / 2);
  const chaseRisk = calculateChaseRiskScore(row);
  const exitRisk = calculateExitRiskScore(row);
  const raw = chip * 0.25 + technical * 0.20 + mainForce * 0.15 + bigHolder * 0.10 + industryFund * 0.10 + fundamental * 0.10 + marketCombo * 0.10;
  const adjusted = raw - Math.max(0, chaseRisk - 55) * 0.35 - Math.max(0, exitRisk - 55) * 0.45;
  return round(clamp(adjusted), 2);
}

function classifyRecommendation(row, aiBuyScore, entryTimingScore, chaseRiskScore, exitRiskScore) {
  const marketRisk = getMarketRisk(row);
  const globalRisk = getGlobalRisk(row);
  const riskLevel = String(row.risk_level || "MEDIUM").toUpperCase();

  if (marketRisk < 40 || globalRisk < 40 || exitRiskScore >= 75 || riskLevel === "HIGH") {
    return { type: "AVOID", label: "禁買" };
  }

  if (aiBuyScore >= 80 && marketRisk >= 60 && globalRisk >= 60 && entryTimingScore >= 60 && chaseRiskScore < 65) {
    return { type: "BUY", label: "可買進" };
  }

  if (aiBuyScore >= 78 && chaseRiskScore >= 60) {
    return { type: "PULLBACK", label: "等拉回" };
  }

  return { type: "WATCH", label: "觀察" };
}

function buildPricePlan(row, type) {
  const closePrice = toNumber(row.close_price, 0);
  if (!closePrice) return { entryLow: null, entryHigh: null, stopLoss: null, takeProfit: null };
  const entryLow = type === "PULLBACK" ? closePrice * 0.96 : closePrice * 0.985;
  const entryHigh = type === "PULLBACK" ? closePrice * 0.99 : closePrice * 1.015;
  return {
    entryLow: round(entryLow, 2),
    entryHigh: round(entryHigh, 2),
    stopLoss: round(closePrice * 0.94, 2),
    takeProfit: round(closePrice * 1.08, 2),
  };
}

function buildReasons(row, classification, scores) {
  const reasons = [];
  const ai = round(row.ai_strength_score || scores.aiBuyScore, 2);
  reasons.push(["分數", "POSITIVE", `AI Buy Score ${scores.aiBuyScore}，AI 強勢分數 ${ai}。`, 10]);
  if (toNumber(row.chip_factor_score, 0) >= 70) reasons.push(["籌碼", "POSITIVE", `籌碼分數 ${round(row.chip_factor_score, 2)}，法人或籌碼條件偏強。`, 20]);
  if (toNumber(row.technical_factor_score ?? row.breakout_score, 0) >= 70) reasons.push(["技術", "POSITIVE", `技術 / 突破分數 ${round(row.technical_factor_score ?? row.breakout_score, 2)}，短線型態偏強。`, 30]);
  if (toNumber(row.main_force_factor_score ?? row.main_force_score, 0) >= 70) reasons.push(["主力", "POSITIVE", `主力籌碼分數 ${round(row.main_force_factor_score ?? row.main_force_score, 2)}，主力條件有加分。`, 40]);
  if (scores.chaseRiskScore >= 60) reasons.push(["追高", "RISK", `追高風險 ${scores.chaseRiskScore}，短線不建議用市價追。`, 50]);
  if (scores.exitRiskScore >= 60) reasons.push(["風險", "RISK", `出貨 / 風險分數 ${scores.exitRiskScore}，需要保守處理。`, 60]);
  if (classification.type === "AVOID") reasons.push(["禁買", "INVALID", "市場或個股風險過高，列入禁買清單。", 70]);
  if (row.recommend_reason) reasons.push(["來源", "POSITIVE", String(row.recommend_reason).slice(0, 480), 80]);
  if (row.avoid_reason) reasons.push(["風險", "RISK", String(row.avoid_reason).slice(0, 480), 90]);
  return reasons;
}

function buildRiskPlan(classification, plan, row, scores) {
  if (classification.type === "BUY") {
    return `只允許在 ${plan.entryLow ?? "計畫區間"}～${plan.entryHigh ?? "計畫區間"} 分批，跌破 ${plan.stopLoss ?? "停損線"} 停損，達 ${plan.takeProfit ?? "停利區"} 分批停利。`;
  }
  if (classification.type === "PULLBACK") {
    return "分數偏強但追高風險較高，等待量縮拉回或回測支撐不破，不建議直接追價。";
  }
  if (classification.type === "AVOID") {
    return "禁買：風險條件未解除前不建立交易計畫，等待市場風險與個股訊號改善。";
  }
  return "先觀察，不急著買；等待籌碼、技術、資金與風險條件同步轉強。";
}

async function insertFactorScores(conn, recommendationId, row, scores) {
  const factors = [
    ["chip", "籌碼分數", row.chip_factor_score ?? row.ai_strength_score, 0.25],
    ["technical", "技術突破分數", row.technical_factor_score ?? row.breakout_score ?? row.ai_strength_score, 0.20],
    ["main_force", "主力籌碼分數", row.main_force_factor_score ?? row.main_force_score ?? 60, 0.15],
    ["big_holder", "大戶趨勢分數", row.big_holder_factor_score ?? row.big_holder_trend_score ?? 60, 0.10],
    ["industry_fund", "產業資金分數", row.market_factor_score ?? 60, 0.10],
    ["fundamental", "基本面分數", row.fundamental_factor_score ?? 60, 0.10],
    ["market_global", "市場與全球風險修正", (getMarketRisk(row) + getGlobalRisk(row)) / 2, 0.10],
    ["chase_risk", "追高風險扣分", scores.chaseRiskScore, 0.00],
    ["exit_risk", "出貨風險扣分", scores.exitRiskScore, 0.00],
  ];

  for (const [key, name, score, weight] of factors) {
    const factorScore = round(score, 2);
    await conn.query(
      `
      INSERT INTO ai_recommendation_scores (recommendation_id, factor_key, factor_name, factor_score, factor_weight, weighted_score, factor_note)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        factor_score = VALUES(factor_score),
        factor_weight = VALUES(factor_weight),
        weighted_score = VALUES(weighted_score),
        factor_note = VALUES(factor_note)
      `,
      [recommendationId, key, name, factorScore, weight, round(factorScore * weight, 4), `${name}：${factorScore}`],
    );
  }
}

async function refreshPerformance(conn, recommendationDate) {
  const rows = await conn.query(
    `
    SELECT id, recommendation_date, stock_code, close_price
    FROM ai_daily_recommendations
    WHERE recommendation_date = ?
    `,
    [recommendationDate],
  );

  for (const row of rows) {
    const prices = await conn.query(
      `
      SELECT close_price
      FROM daily_prices
      WHERE stock_code = ?
        AND trade_date > ?
      ORDER BY trade_date ASC
      LIMIT 10
      `,
      [row.stock_code, recommendationDate],
    ).catch(() => []);

    const entry = toNumber(row.close_price, 0);
    const returns = [1, 3, 5, 10].map((day) => {
      if (!entry || !prices[day - 1]) return null;
      return round((toNumber(prices[day - 1].close_price, entry) - entry) / entry * 100, 4);
    });
    const validReturns = returns.filter((value) => value !== null);
    const status = validReturns.length < 3 ? "WAITING" : returns[3] >= 3 || returns[2] >= 2 ? "SUCCESS" : returns[2] >= 0 ? "PARTIAL" : "FAIL";

    await conn.query(
      `
      INSERT INTO ai_recommendation_performance (
        recommendation_id, recommendation_date, stock_code, entry_close_price,
        return_1d_pct, return_3d_pct, return_5d_pct, return_10d_pct,
        max_return_pct, min_return_pct, performance_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        entry_close_price = VALUES(entry_close_price),
        return_1d_pct = VALUES(return_1d_pct),
        return_3d_pct = VALUES(return_3d_pct),
        return_5d_pct = VALUES(return_5d_pct),
        return_10d_pct = VALUES(return_10d_pct),
        max_return_pct = VALUES(max_return_pct),
        min_return_pct = VALUES(min_return_pct),
        performance_status = VALUES(performance_status),
        updated_at = CURRENT_TIMESTAMP
      `,
      [row.id, recommendationDate, row.stock_code, entry || null, returns[0], returns[1], returns[2], returns[3], validReturns.length ? Math.max(...validReturns) : null, validReturns.length ? Math.min(...validReturns) : null, status],
    );
  }
}

async function generateRecommendations(conn, recommendationDate) {
  const sourceRows = await getSourceRows(conn, recommendationDate);
  await conn.query("DELETE FROM ai_daily_recommendations WHERE recommendation_date = ?", [recommendationDate]);

  const evaluated = sourceRows.map((row) => {
    const entryTimingScore = calculateEntryTimingScore(row);
    const chaseRiskScore = calculateChaseRiskScore(row);
    const exitRiskScore = calculateExitRiskScore(row);
    const aiBuyScore = calculateAiBuyScore(row);
    const classification = classifyRecommendation(row, aiBuyScore, entryTimingScore, chaseRiskScore, exitRiskScore);
    const riskAdjustedScore = round(clamp(aiBuyScore - Math.max(0, chaseRiskScore - 60) * 0.2 - Math.max(0, exitRiskScore - 60) * 0.3), 2);
    return { row, aiBuyScore, entryTimingScore, chaseRiskScore, exitRiskScore, riskAdjustedScore, classification };
  });

  const selected = [];
  const buyOrPullback = evaluated.filter((item) => ["BUY", "PULLBACK"].includes(item.classification.type)).sort((a, b) => b.riskAdjustedScore - a.riskAdjustedScore).slice(0, 10);
  const watch = evaluated.filter((item) => item.classification.type === "WATCH").sort((a, b) => b.riskAdjustedScore - a.riskAdjustedScore).slice(0, 10);
  const avoid = evaluated.filter((item) => item.classification.type === "AVOID").sort((a, b) => b.exitRiskScore - a.exitRiskScore).slice(0, 10);
  selected.push(...buyOrPullback, ...watch, ...avoid);

  let rank = 1;
  let buyCount = 0;
  let pullbackCount = 0;
  let watchCount = 0;
  let avoidCount = 0;

  for (const item of selected) {
    const { row, classification } = item;
    if (classification.type === "BUY") buyCount += 1;
    if (classification.type === "PULLBACK") pullbackCount += 1;
    if (classification.type === "WATCH") watchCount += 1;
    if (classification.type === "AVOID") avoidCount += 1;

    const plan = buildPricePlan(row, classification.type);
    const reasons = buildReasons(row, classification, item);
    const riskPlan = buildRiskPlan(classification, plan, row, item);
    const invalidCondition = classification.type === "AVOID"
      ? "風險條件未解除前不列入買進。"
      : "跌破停損線、法人反手大賣、Market / Global Risk 低於 40 或爆量長上影，推薦失效。";
    const lineSummary = `${classification.label}｜${row.stock_code} ${row.stock_name || ""}｜AI Buy ${item.aiBuyScore}｜${riskPlan}`.slice(0, 880);

    const result = await conn.query(
      `
      INSERT INTO ai_daily_recommendations (
        recommendation_date, stock_code, stock_name, market_type, industry, recommendation_rank,
        recommendation_type, recommendation_label, ai_buy_score, entry_timing_score, risk_adjusted_score,
        chase_risk_score, exit_risk_score, ai_strength_score, market_risk_score, global_risk_score,
        chip_factor_score, technical_factor_score, main_force_factor_score, big_holder_factor_score,
        fundamental_factor_score, industry_fund_score, close_price, suggested_entry_low, suggested_entry_high,
        stop_loss_price, take_profit_price, position_sizing_note, recommend_reason, risk_control_plan,
        invalid_condition, line_summary, manual_confirm_required, source_signal_id, source_module, meta_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, 'AI_DAILY_RECOMMENDATION', ?)
      ON DUPLICATE KEY UPDATE
        recommendation_rank = VALUES(recommendation_rank),
        recommendation_type = VALUES(recommendation_type),
        recommendation_label = VALUES(recommendation_label),
        ai_buy_score = VALUES(ai_buy_score),
        entry_timing_score = VALUES(entry_timing_score),
        risk_adjusted_score = VALUES(risk_adjusted_score),
        chase_risk_score = VALUES(chase_risk_score),
        exit_risk_score = VALUES(exit_risk_score),
        suggested_entry_low = VALUES(suggested_entry_low),
        suggested_entry_high = VALUES(suggested_entry_high),
        stop_loss_price = VALUES(stop_loss_price),
        take_profit_price = VALUES(take_profit_price),
        recommend_reason = VALUES(recommend_reason),
        risk_control_plan = VALUES(risk_control_plan),
        invalid_condition = VALUES(invalid_condition),
        line_summary = VALUES(line_summary),
        updated_at = CURRENT_TIMESTAMP
      `,
      [
        recommendationDate,
        row.stock_code,
        row.stock_name,
        row.market_type,
        row.industry,
        rank,
        classification.type,
        classification.label,
        item.aiBuyScore,
        item.entryTimingScore,
        item.riskAdjustedScore,
        item.chaseRiskScore,
        item.exitRiskScore,
        round(row.ai_strength_score || item.aiBuyScore, 2),
        round(getMarketRisk(row), 2),
        round(getGlobalRisk(row), 2),
        row.chip_factor_score ?? null,
        row.technical_factor_score ?? row.breakout_score ?? null,
        row.main_force_factor_score ?? row.main_force_score ?? null,
        row.big_holder_factor_score ?? row.big_holder_trend_score ?? null,
        row.fundamental_factor_score ?? null,
        row.market_factor_score ?? null,
        row.close_price ?? null,
        plan.entryLow,
        plan.entryHigh,
        plan.stopLoss,
        plan.takeProfit,
        classification.type === "BUY" ? "小量分批，不追高。" : "先觀察或等待條件改善。",
        reasons.map((reason) => reason[2]).slice(0, 3).join(" ").slice(0, 880),
        riskPlan,
        invalidCondition,
        lineSummary,
        row.source_signal_id ?? null,
        JSON.stringify({ source: "V3.2", ai_level: row.ai_level, candidate_horizon: row.candidate_horizon, risk_flags: row.risk_flags || null }),
      ],
    );

    const recommendationId = Number(result.insertId || 0) || Number((await conn.query("SELECT id FROM ai_daily_recommendations WHERE recommendation_date = ? AND stock_code = ?", [recommendationDate, row.stock_code]))?.[0]?.id);
    await conn.query("DELETE FROM ai_recommendation_reasons WHERE recommendation_id = ?", [recommendationId]);
    for (const [group, type, text, sortOrder] of reasons) {
      await conn.query(
        "INSERT INTO ai_recommendation_reasons (recommendation_id, reason_group, reason_type, reason_text, sort_order) VALUES (?, ?, ?, ?, ?)",
        [recommendationId, group, type, text, sortOrder],
      );
    }
    await insertFactorScores(conn, recommendationId, row, item);
    rank += 1;
  }

  await refreshPerformance(conn, recommendationDate);
  return { source_count: sourceRows.length, generated_count: selected.length, buy_count: buyCount, pullback_count: pullbackCount, watch_count: watchCount, avoid_count: avoidCount };
}

async function main() {
  console.log("====================================");
  console.log("Stock Radar V3.2 AI 每日推薦引擎產生流程");
  console.log("====================================");
  let conn;
  try {
    conn = await pool.getConnection();
    if (!(await tableExists(conn, "ai_daily_recommendations"))) {
      throw new Error("尚未建立 V3.2 資料表，請先執行 npm run ai-recommendations:setup");
    }
    const recommendationDate = await getRecommendationDate(conn);
    console.log(`推薦日期：${recommendationDate}`);
    const result = await generateRecommendations(conn, recommendationDate);
    console.log(`來源筆數：${result.source_count}`);
    console.log(`產生筆數：${result.generated_count}`);
    console.log(`可買進：${result.buy_count}`);
    console.log(`等拉回：${result.pullback_count}`);
    console.log(`觀察：${result.watch_count}`);
    console.log(`禁買：${result.avoid_count}`);
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
