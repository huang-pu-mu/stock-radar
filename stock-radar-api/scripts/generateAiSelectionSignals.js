import dotenv from "dotenv";
import pool from "../db.js";

dotenv.config();

function toNumber(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback;
  const numberValue = Number(String(value).replaceAll(",", ""));
  return Number.isFinite(numberValue) ? numberValue : fallback;
}

function round(value, digits = 2) {
  const numberValue = toNumber(value, null);
  if (numberValue === null) return null;
  const factor = 10 ** digits;
  return Math.round(numberValue * factor) / factor;
}

function clamp(value, min = 0, max = 100) {
  return Math.min(Math.max(value, min), max);
}

async function tableExists(conn, tableName) {
  const rows = await conn.query(
    `SELECT COUNT(*) AS table_count FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [tableName],
  );
  return Number(rows?.[0]?.table_count || 0) > 0;
}

async function getLatestDate(conn, table, column, fallback = null, whereSql = "", params = []) {
  try {
    const rows = await conn.query(`SELECT DATE_FORMAT(MAX(${column}), '%Y-%m-%d') AS latest_date FROM ${table} ${whereSql}`, params);
    return rows?.[0]?.latest_date || fallback;
  } catch {
    return fallback;
  }
}

function computeFundamentalFactor(eps, revenueYoy) {
  const epsValue = toNumber(eps, null);
  const yoyValue = toNumber(revenueYoy, null);
  let score = 50;
  const tags = [];

  if (epsValue !== null) {
    if (epsValue >= 5) { score += 14; tags.push("EPS 高獲利"); }
    else if (epsValue >= 2) { score += 9; tags.push("EPS 穩定獲利"); }
    else if (epsValue > 0) { score += 4; tags.push("EPS 正值"); }
    else if (epsValue < 0) { score -= 12; tags.push("EPS 虧損"); }
  }

  if (yoyValue !== null) {
    if (yoyValue >= 30) { score += 16; tags.push("營收強成長"); }
    else if (yoyValue >= 10) { score += 10; tags.push("營收成長"); }
    else if (yoyValue >= 0) { score += 3; tags.push("營收持平偏多"); }
    else if (yoyValue <= -20) { score -= 14; tags.push("營收明顯衰退"); }
    else { score -= 7; tags.push("營收衰退"); }
  }

  if (epsValue === null && yoyValue === null) tags.push("基本面資料不足");
  return { score: round(clamp(score, 0, 100), 2), tags };
}

function classifyRisk({ openingGapProbability, globalRiskScore, marketRiskScore, distributionRisk, bigHolderDistributionRisk, breakoutOverheatRisk }) {
  const gap = toNumber(openingGapProbability, 50);
  const global = toNumber(globalRiskScore, 70);
  const market = toNumber(marketRiskScore, 70);
  const flags = [];
  let riskScore = 0;

  if (gap >= 70) { riskScore += 2; flags.push("隔日開低機率偏高"); }
  else if (gap >= 60) { riskScore += 1; flags.push("隔日開低機率需留意"); }
  if (global < 45) { riskScore += 2; flags.push("全球市場風險偏高"); }
  else if (global < 60) { riskScore += 1; flags.push("全球市場中性偏弱"); }
  if (market < 45) { riskScore += 2; flags.push("台指夜盤風險偏高"); }
  else if (market < 60) { riskScore += 1; flags.push("台指夜盤中性偏弱"); }
  if (String(distributionRisk || "").toUpperCase() === "HIGH") { riskScore += 2; flags.push("主力出貨風險"); }
  if (String(bigHolderDistributionRisk || "").toUpperCase() === "HIGH") { riskScore += 2; flags.push("大戶出貨風險"); }
  if (String(breakoutOverheatRisk || "").toUpperCase() === "HIGH") { riskScore += 1; flags.push("技術過熱"); }

  if (riskScore >= 4) return { level: "HIGH", flags };
  if (riskScore >= 2) return { level: "MEDIUM", flags };
  return { level: "LOW", flags: flags.length ? flags : ["風險條件相對穩定"] };
}

function classifyAi(score, riskLevel) {
  if (riskLevel === "HIGH" && score < 78) return { level: "AI_RISK", status: "AI 風險控管", horizon: "AVOID" };
  if (score >= 82 && riskLevel !== "HIGH") return { level: "AI_STRONG", status: "AI 強勢候選", horizon: "1-3D" };
  if (score >= 72) return { level: "AI_WATCH", status: "AI 隔日觀察", horizon: "1-5D" };
  if (score >= 62) return { level: "AI_OBSERVE", status: "AI 追蹤觀察", horizon: "1-5D" };
  return { level: "NEUTRAL", status: "中性觀察", horizon: "1-5D" };
}

function analyze(row) {
  const chip = toNumber(row.chip_score, 50);
  const closeScore = toNumber(row.close_score, chip);
  const nightAdjusted = toNumber(row.night_adjusted_score, closeScore);
  const globalAdjusted = toNumber(row.global_adjusted_score, nightAdjusted);
  const breakout = toNumber(row.breakout_score, null);
  const mainForce = toNumber(row.main_force_score, null);
  const bigHolder = toNumber(row.big_holder_trend_score, null);
  const marketRisk = toNumber(row.market_risk_score, 70);
  const globalRisk = toNumber(row.global_risk_score, 70);
  const openingGap = toNumber(row.opening_gap_probability, 50);
  const fundamental = computeFundamentalFactor(row.eps, row.revenue_yoy_percent);

  const chipFactor = round(chip, 2);
  const technicalFactor = round(breakout ?? (chip * 0.55 + 45 * 0.45), 2);
  const mainForceFactor = round(mainForce ?? (chip * 0.45 + 50 * 0.55), 2);
  const bigHolderFactor = round(bigHolder ?? (mainForceFactor * 0.45 + 50 * 0.55), 2);
  const marketFactor = round(nightAdjusted, 2);
  const globalFactor = round(globalAdjusted, 2);
  const fundamentalFactor = fundamental.score;

  const risk = classifyRisk({
    openingGapProbability: openingGap,
    globalRiskScore: globalRisk,
    marketRiskScore: marketRisk,
    distributionRisk: row.main_force_distribution_risk,
    bigHolderDistributionRisk: row.big_holder_distribution_risk,
    breakoutOverheatRisk: row.breakout_overheat_risk,
  });

  let score =
    chipFactor * 0.20 +
    technicalFactor * 0.18 +
    mainForceFactor * 0.18 +
    bigHolderFactor * 0.14 +
    globalFactor * 0.12 +
    marketFactor * 0.10 +
    fundamentalFactor * 0.08;

  const reasons = [];
  const avoid = [];
  if (chip >= 70) reasons.push("籌碼分數強");
  if (breakout !== null && breakout >= 70) reasons.push("技術突破分數強");
  if (mainForce !== null && mainForce >= 70) reasons.push("主力籌碼偏強");
  if (bigHolder !== null && bigHolder >= 60) reasons.push("大戶趨勢改善");
  if (globalAdjusted >= closeScore) reasons.push("全球風險修正不扣分");
  if (fundamentalFactor >= 65) reasons.push(...fundamental.tags.slice(0, 2));

  if (openingGap >= 70) { score -= 6; avoid.push("隔日開低機率偏高"); }
  if (globalRisk < 45) { score -= 7; avoid.push("全球市場風險偏高"); }
  if (marketRisk < 45) { score -= 6; avoid.push("台指夜盤偏弱"); }
  if (risk.level === "HIGH") score -= 7;
  else if (risk.level === "MEDIUM") score -= 3;

  const aiStrengthScore = round(clamp(score, 0, 100), 2);
  const classification = classifyAi(aiStrengthScore, risk.level);
  if (avoid.length === 0) avoid.push("目前未偵測到主要不推薦條件");
  if (reasons.length === 0) reasons.push(classification.status);

  return {
    ai_strength_score: aiStrengthScore,
    ai_level: classification.level,
    ai_status: classification.status,
    candidate_horizon: classification.horizon,
    close_score: round(closeScore, 2),
    night_adjusted_score: round(nightAdjusted, 2),
    global_adjusted_score: round(globalAdjusted, 2),
    chip_factor_score: chipFactor,
    technical_factor_score: technicalFactor,
    main_force_factor_score: mainForceFactor,
    big_holder_factor_score: bigHolderFactor,
    market_factor_score: marketFactor,
    global_factor_score: globalFactor,
    fundamental_factor_score: fundamentalFactor,
    breakout_score: breakout === null ? null : round(breakout, 2),
    main_force_score: mainForce === null ? null : round(mainForce, 2),
    big_holder_trend_score: bigHolder === null ? null : round(bigHolder, 2),
    market_risk_score: round(marketRisk, 2),
    global_risk_score: round(globalRisk, 2),
    opening_gap_probability: round(openingGap, 2),
    eps: round(row.eps, 4),
    revenue_yoy_percent: round(row.revenue_yoy_percent, 4),
    risk_level: risk.level,
    risk_flags: risk.flags.slice(0, 6).join("、"),
    recommend_reason: `${classification.status}｜${reasons.slice(0, 6).join("、")}｜AI ${aiStrengthScore}`,
    avoid_reason: avoid.slice(0, 6).join("、"),
    factor_json: JSON.stringify({
      weights: { chip: 0.20, technical: 0.18, main_force: 0.18, big_holder: 0.14, global: 0.12, market: 0.10, fundamental: 0.08 },
      factors: { chipFactor, technicalFactor, mainForceFactor, bigHolderFactor, globalFactor, marketFactor, fundamentalFactor },
      risk,
      fundamental_tags: fundamental.tags,
    }),
  };
}

async function getRows(conn, tradeDate, flags) {
  const marketSelect = flags.marketRisk ? `a.adjusted_score AS night_adjusted_score, a.market_risk_score` : `NULL AS night_adjusted_score, NULL AS market_risk_score`;
  const globalSelect = flags.globalRisk ? `g.global_adjusted_score, g.global_risk_score, g.opening_gap_probability` : `NULL AS global_adjusted_score, NULL AS global_risk_score, NULL AS opening_gap_probability`;
  const breakoutSelect = flags.breakout ? `b.breakout_score, b.overheat_risk AS breakout_overheat_risk` : `NULL AS breakout_score, NULL AS breakout_overheat_risk`;
  const mainForceSelect = flags.mainForce ? `mf.main_force_score, mf.distribution_risk AS main_force_distribution_risk` : `NULL AS main_force_score, NULL AS main_force_distribution_risk`;
  const bigHolderSelect = flags.bigHolder ? `bh.big_holder_trend_score, bh.distribution_risk AS big_holder_distribution_risk` : `NULL AS big_holder_trend_score, NULL AS big_holder_distribution_risk`;
  const revenueSelect = flags.revenue ? `(SELECT mr.year_over_year_percent FROM monthly_revenues mr WHERE mr.stock_code = c.stock_code ORDER BY mr.revenue_year DESC, mr.revenue_month DESC LIMIT 1) AS revenue_yoy_percent` : `NULL AS revenue_yoy_percent`;
  const epsSelect = flags.eps ? `(SELECT qe.eps FROM quarterly_eps qe WHERE qe.stock_code = c.stock_code ORDER BY qe.eps_year DESC, qe.eps_quarter DESC LIMIT 1) AS eps` : `NULL AS eps`;

  const marketJoin = flags.marketRisk ? `LEFT JOIN market_risk_adjusted_scores a ON a.stock_code = c.stock_code AND a.trade_date = c.trade_date` : "";
  const globalJoin = flags.globalRisk ? `LEFT JOIN global_risk_adjusted_scores g ON g.stock_code = c.stock_code AND g.trade_date = c.trade_date` : "";
  const breakoutJoin = flags.breakout ? `LEFT JOIN technical_breakout_signals b ON b.stock_code = c.stock_code AND b.trade_date = c.trade_date` : "";
  const mainForceJoin = flags.mainForce ? `LEFT JOIN main_force_signals mf ON mf.stock_code = c.stock_code AND mf.trade_date = c.trade_date` : "";
  const bigHolderJoin = flags.bigHolder ? `LEFT JOIN big_holder_trend_signals bh ON bh.stock_code = c.stock_code AND bh.trade_date = c.trade_date` : "";

  return await conn.query(
    `
    SELECT
      DATE_FORMAT(c.trade_date, '%Y-%m-%d') AS trade_date,
      c.stock_code,
      s.stock_name,
      s.market_type,
      s.industry,
      c.chip_score,
      c.chip_score AS close_score,
      ${marketSelect},
      ${globalSelect},
      ${breakoutSelect},
      ${mainForceSelect},
      ${bigHolderSelect},
      ${epsSelect},
      ${revenueSelect}
    FROM chip_scores c
    LEFT JOIN stocks s ON s.stock_code = c.stock_code
    ${marketJoin}
    ${globalJoin}
    ${breakoutJoin}
    ${mainForceJoin}
    ${bigHolderJoin}
    WHERE c.trade_date = ?
    ORDER BY c.chip_score DESC, c.stock_code ASC
    `,
    [tradeDate],
  );
}

async function upsertSummary(conn, tradeDate, marketType) {
  const rows = await conn.query(
    `
    SELECT
      COUNT(*) AS total_count,
      SUM(ai_level = 'AI_STRONG') AS strong_count,
      SUM(ai_level = 'AI_WATCH') AS watch_count,
      SUM(ai_level = 'AI_OBSERVE') AS observe_count,
      SUM(ai_level = 'AI_RISK') AS risk_count,
      SUM(risk_level = 'LOW') AS low_risk_count,
      AVG(ai_strength_score) AS avg_ai_strength_score,
      MAX(ai_strength_score) AS top_ai_strength_score
    FROM ai_selection_signals
    WHERE trade_date = ?
      AND (? = '全部' OR market_type = ?)
    `,
    [tradeDate, marketType, marketType],
  );
  const topRows = await conn.query(
    `
    SELECT stock_code, stock_name, ai_strength_score
    FROM ai_selection_signals
    WHERE trade_date = ?
      AND (? = '全部' OR market_type = ?)
    ORDER BY ai_strength_score DESC, stock_code ASC
    LIMIT 1
    `,
    [tradeDate, marketType, marketType],
  );
  const summary = rows[0] || {};
  const top = topRows[0] || {};
  await conn.query(
    `
    INSERT INTO ai_selection_summaries (
      trade_date, market_type, total_count, strong_count, watch_count, observe_count, risk_count, low_risk_count,
      avg_ai_strength_score, top_ai_strength_score, top_stock_code, top_stock_name, generated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
    ON DUPLICATE KEY UPDATE
      total_count = VALUES(total_count),
      strong_count = VALUES(strong_count),
      watch_count = VALUES(watch_count),
      observe_count = VALUES(observe_count),
      risk_count = VALUES(risk_count),
      low_risk_count = VALUES(low_risk_count),
      avg_ai_strength_score = VALUES(avg_ai_strength_score),
      top_ai_strength_score = VALUES(top_ai_strength_score),
      top_stock_code = VALUES(top_stock_code),
      top_stock_name = VALUES(top_stock_name),
      generated_at = NOW(),
      updated_at = NOW()
    `,
    [
      tradeDate,
      marketType,
      Number(summary.total_count || 0),
      Number(summary.strong_count || 0),
      Number(summary.watch_count || 0),
      Number(summary.observe_count || 0),
      Number(summary.risk_count || 0),
      Number(summary.low_risk_count || 0),
      round(summary.avg_ai_strength_score, 2),
      round(summary.top_ai_strength_score, 2),
      top.stock_code || null,
      top.stock_name || null,
    ],
  );
  return { summary, top };
}

async function main() {
  const conn = await pool.getConnection();
  try {
    const requestedDate = process.argv[2] || null;
    const tradeDate = requestedDate || await getLatestDate(conn, "chip_scores", "trade_date");
    if (!tradeDate) throw new Error("找不到 chip_scores 交易日，請先執行 npm run score。");

    const flags = {
      marketRisk: await tableExists(conn, "market_risk_adjusted_scores"),
      globalRisk: await tableExists(conn, "global_risk_adjusted_scores"),
      breakout: await tableExists(conn, "technical_breakout_signals"),
      mainForce: await tableExists(conn, "main_force_signals"),
      bigHolder: await tableExists(conn, "big_holder_trend_signals"),
      revenue: await tableExists(conn, "monthly_revenues"),
      eps: await tableExists(conn, "quarterly_eps"),
    };

    console.log("====================================");
    console.log("Stock Radar V2.0 AI 多因子選股訊號產生");
    console.log("====================================");
    console.log(`分析日期：${tradeDate}`);
    console.log(`因子資料：${Object.entries(flags).map(([key, value]) => `${key}=${value ? 'Y' : 'N'}`).join(' / ')}`);

    const rows = await getRows(conn, tradeDate, flags);
    let updated = 0;

    for (const row of rows) {
      const signal = analyze(row);
      await conn.query(
        `
        INSERT INTO ai_selection_signals (
          trade_date, stock_code, stock_name, market_type, industry,
          ai_strength_score, ai_level, ai_status, candidate_horizon,
          close_score, night_adjusted_score, global_adjusted_score,
          chip_factor_score, technical_factor_score, main_force_factor_score, big_holder_factor_score,
          market_factor_score, global_factor_score, fundamental_factor_score,
          breakout_score, main_force_score, big_holder_trend_score, market_risk_score, global_risk_score, opening_gap_probability,
          eps, revenue_yoy_percent, risk_level, risk_flags, recommend_reason, avoid_reason, factor_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          stock_name = VALUES(stock_name),
          market_type = VALUES(market_type),
          industry = VALUES(industry),
          ai_strength_score = VALUES(ai_strength_score),
          ai_level = VALUES(ai_level),
          ai_status = VALUES(ai_status),
          candidate_horizon = VALUES(candidate_horizon),
          close_score = VALUES(close_score),
          night_adjusted_score = VALUES(night_adjusted_score),
          global_adjusted_score = VALUES(global_adjusted_score),
          chip_factor_score = VALUES(chip_factor_score),
          technical_factor_score = VALUES(technical_factor_score),
          main_force_factor_score = VALUES(main_force_factor_score),
          big_holder_factor_score = VALUES(big_holder_factor_score),
          market_factor_score = VALUES(market_factor_score),
          global_factor_score = VALUES(global_factor_score),
          fundamental_factor_score = VALUES(fundamental_factor_score),
          breakout_score = VALUES(breakout_score),
          main_force_score = VALUES(main_force_score),
          big_holder_trend_score = VALUES(big_holder_trend_score),
          market_risk_score = VALUES(market_risk_score),
          global_risk_score = VALUES(global_risk_score),
          opening_gap_probability = VALUES(opening_gap_probability),
          eps = VALUES(eps),
          revenue_yoy_percent = VALUES(revenue_yoy_percent),
          risk_level = VALUES(risk_level),
          risk_flags = VALUES(risk_flags),
          recommend_reason = VALUES(recommend_reason),
          avoid_reason = VALUES(avoid_reason),
          factor_json = VALUES(factor_json),
          updated_at = NOW()
        `,
        [
          tradeDate,
          row.stock_code,
          row.stock_name,
          row.market_type,
          row.industry,
          signal.ai_strength_score,
          signal.ai_level,
          signal.ai_status,
          signal.candidate_horizon,
          signal.close_score,
          signal.night_adjusted_score,
          signal.global_adjusted_score,
          signal.chip_factor_score,
          signal.technical_factor_score,
          signal.main_force_factor_score,
          signal.big_holder_factor_score,
          signal.market_factor_score,
          signal.global_factor_score,
          signal.fundamental_factor_score,
          signal.breakout_score,
          signal.main_force_score,
          signal.big_holder_trend_score,
          signal.market_risk_score,
          signal.global_risk_score,
          signal.opening_gap_probability,
          signal.eps,
          signal.revenue_yoy_percent,
          signal.risk_level,
          signal.risk_flags,
          signal.recommend_reason,
          signal.avoid_reason,
          signal.factor_json,
        ],
      );
      updated += 1;
    }

    const markets = ["全部", "上市", "上櫃"];
    for (const market of markets) await upsertSummary(conn, tradeDate, market);

    const statRows = await conn.query(
      `
      SELECT
        MIN(ai_strength_score) AS min_score,
        MAX(ai_strength_score) AS max_score,
        AVG(ai_strength_score) AS avg_score,
        SUM(ai_level = 'AI_STRONG') AS strong_count,
        SUM(ai_level = 'AI_WATCH') AS watch_count,
        SUM(ai_level = 'AI_RISK') AS risk_count
      FROM ai_selection_signals
      WHERE trade_date = ?
      `,
      [tradeDate],
    );
    const stat = statRows[0] || {};

    console.log(`更新個股數：${updated}`);
    console.log(`AI 強勢分數區間：${round(stat.min_score, 2)} ～ ${round(stat.max_score, 2)}`);
    console.log(`平均 AI 強勢分數：${round(stat.avg_score, 2)}`);
    console.log(`等級統計：AI_STRONG ${Number(stat.strong_count || 0)}｜AI_WATCH ${Number(stat.watch_count || 0)}｜AI_RISK ${Number(stat.risk_count || 0)}`);
    console.log("結果：PASS");
  } catch (error) {
    console.error("產生 V2.0 AI 多因子選股訊號失敗：", error.message);
    process.exitCode = 1;
  } finally {
    conn.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error("產生 V2.0 AI 多因子選股訊號失敗：", error);
  process.exit(1);
});
