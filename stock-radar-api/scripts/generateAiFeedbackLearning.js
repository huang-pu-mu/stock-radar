import dotenv from "dotenv";
import pool from "../db.js";

dotenv.config();

function toNumber(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback;
  const numberValue = Number(String(value).replaceAll(",", ""));
  return Number.isFinite(numberValue) ? numberValue : fallback;
}

function round(value, digits = 4) {
  const numberValue = toNumber(value, null);
  if (numberValue === null) return null;
  const factor = 10 ** digits;
  return Math.round(numberValue * factor) / factor;
}

function clamp(value, min = 0, max = 100) {
  return Math.min(Math.max(value, min), max);
}

function todayText() {
  const now = new Date();
  const taipei = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Taipei" }));
  const y = taipei.getFullYear();
  const m = String(taipei.getMonth() + 1).padStart(2, "0");
  const d = String(taipei.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

async function tableExists(conn, tableName) {
  const rows = await conn.query(
    `SELECT COUNT(*) AS table_count FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [tableName],
  );
  return Number(rows?.[0]?.table_count || 0) > 0;
}

async function getLatestDate(conn, table, column) {
  const rows = await conn.query(`SELECT DATE_FORMAT(MAX(${column}), '%Y-%m-%d') AS latest_date FROM ${table}`);
  return rows?.[0]?.latest_date || null;
}

function calcReturn(entry, target) {
  const entryValue = toNumber(entry, null);
  const targetValue = toNumber(target, null);
  if (!entryValue || targetValue === null) return null;
  return round(((targetValue - entryValue) / entryValue) * 100, 4);
}

function classifyEnvironment(row) {
  const riskLevel = String(row.risk_level || "").toUpperCase();
  const market = toNumber(row.market_risk_score, 70);
  const global = toNumber(row.global_risk_score, 70);
  const aiScore = toNumber(row.ai_strength_score, 50);
  if (riskLevel === "HIGH" || market < 45 || global < 45) return "HIGH_RISK";
  if (market >= 70 && global >= 70 && aiScore >= 72) return "BULL";
  if (market < 60 || global < 60) return "BEAR";
  return "RANGE";
}

function classifyFeedback(returns) {
  const availableReturns = returns.filter((value) => value !== null && value !== undefined);
  if (availableReturns.length === 0) return { result: "WAITING", quality: 50, maxReturn: null, minReturn: null };

  const maxReturn = Math.max(...availableReturns);
  const minReturn = Math.min(...availableReturns);
  const r1 = returns[0];
  const r3 = returns[1];
  const r5 = returns[2];
  const r10 = returns[3];

  let result = "PARTIAL";
  if ((r5 !== null && r5 >= 3) || (r3 !== null && r3 >= 2) || maxReturn >= 4) result = "SUCCESS";
  if ((r5 !== null && r5 <= -3) || minReturn <= -5 || (r10 !== null && r10 <= -5)) result = "FAIL";

  let quality = 50;
  for (const value of [r1, r3, r5, r10]) {
    if (value !== null && value !== undefined) quality += value * 2.2;
  }
  if (result === "SUCCESS") quality += 8;
  if (result === "FAIL") quality -= 10;
  return { result, quality: round(clamp(quality, 0, 100), 2), maxReturn: round(maxReturn, 4), minReturn: round(minReturn, 4) };
}

function factorDefinitions() {
  return [
    { key: "chip", name: "籌碼因子", column: "chip_factor_score", currentWeight: 0.20 },
    { key: "technical", name: "技術突破因子", column: "technical_factor_score", currentWeight: 0.18 },
    { key: "main_force", name: "主力籌碼因子", column: "main_force_factor_score", currentWeight: 0.18 },
    { key: "big_holder", name: "大戶趨勢因子", column: "big_holder_factor_score", currentWeight: 0.14 },
    { key: "market", name: "台指夜盤風險因子", column: "market_factor_score", currentWeight: 0.10 },
    { key: "global", name: "全球市場風險因子", column: "global_factor_score", currentWeight: 0.12 },
    { key: "fundamental", name: "基本面因子", column: "fundamental_factor_score", currentWeight: 0.08 },
  ];
}

async function getSignalRows(conn, targetDate, limit) {
  const where = targetDate ? "WHERE s.trade_date <= ?" : "";
  const params = targetDate ? [targetDate, limit] : [limit];
  const rows = await conn.query(
    `
    SELECT
      s.*,
      DATE_FORMAT(s.trade_date, '%Y-%m-%d') AS signal_trade_date_text,
      p0.close_price AS entry_close_price,
      (SELECT dp.close_price FROM daily_prices dp WHERE dp.stock_code = s.stock_code AND dp.trade_date > s.trade_date ORDER BY dp.trade_date ASC LIMIT 1 OFFSET 0) AS close_1d,
      (SELECT dp.close_price FROM daily_prices dp WHERE dp.stock_code = s.stock_code AND dp.trade_date > s.trade_date ORDER BY dp.trade_date ASC LIMIT 1 OFFSET 2) AS close_3d,
      (SELECT dp.close_price FROM daily_prices dp WHERE dp.stock_code = s.stock_code AND dp.trade_date > s.trade_date ORDER BY dp.trade_date ASC LIMIT 1 OFFSET 4) AS close_5d,
      (SELECT dp.close_price FROM daily_prices dp WHERE dp.stock_code = s.stock_code AND dp.trade_date > s.trade_date ORDER BY dp.trade_date ASC LIMIT 1 OFFSET 9) AS close_10d
    FROM ai_selection_signals s
    LEFT JOIN daily_prices p0 ON p0.stock_code = s.stock_code AND p0.trade_date = s.trade_date
    ${where}
    ORDER BY s.trade_date DESC, s.ai_strength_score DESC, s.stock_code ASC
    LIMIT ?
    `,
    params,
  );

  return rows.map((row) => ({
    ...row,
    trade_date: row.signal_trade_date_text || row.trade_date,
  }));
}

async function upsertFeedback(conn, row) {
  const entry = toNumber(row.entry_close_price, null);
  const returns = [
    calcReturn(entry, row.close_1d),
    calcReturn(entry, row.close_3d),
    calcReturn(entry, row.close_5d),
    calcReturn(entry, row.close_10d),
  ];
  const feedback = classifyFeedback(returns);
  const environment = classifyEnvironment(row);
  const note = feedback.result === "WAITING"
    ? "尚未有足夠後續收盤價，列入等待追蹤。"
    : `1D ${returns[0] ?? "-"}%、3D ${returns[1] ?? "-"}%、5D ${returns[2] ?? "-"}%、10D ${returns[3] ?? "-"}%，結果 ${feedback.result}。`;

  await conn.query(
    `
    INSERT INTO ai_recommendation_feedbacks (
      signal_id, signal_trade_date, stock_code, stock_name, market_type, industry,
      ai_strength_score, ai_level, candidate_horizon, risk_level, market_environment,
      entry_close_price, return_1d_pct, return_3d_pct, return_5d_pct, return_10d_pct,
      max_return_pct, min_return_pct, feedback_result, recommendation_quality_score,
      chip_factor_score, technical_factor_score, main_force_factor_score, big_holder_factor_score,
      market_factor_score, global_factor_score, fundamental_factor_score, learning_note
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      signal_id = VALUES(signal_id),
      stock_name = VALUES(stock_name),
      market_type = VALUES(market_type),
      industry = VALUES(industry),
      ai_strength_score = VALUES(ai_strength_score),
      ai_level = VALUES(ai_level),
      candidate_horizon = VALUES(candidate_horizon),
      risk_level = VALUES(risk_level),
      market_environment = VALUES(market_environment),
      entry_close_price = VALUES(entry_close_price),
      return_1d_pct = VALUES(return_1d_pct),
      return_3d_pct = VALUES(return_3d_pct),
      return_5d_pct = VALUES(return_5d_pct),
      return_10d_pct = VALUES(return_10d_pct),
      max_return_pct = VALUES(max_return_pct),
      min_return_pct = VALUES(min_return_pct),
      feedback_result = VALUES(feedback_result),
      recommendation_quality_score = VALUES(recommendation_quality_score),
      chip_factor_score = VALUES(chip_factor_score),
      technical_factor_score = VALUES(technical_factor_score),
      main_force_factor_score = VALUES(main_force_factor_score),
      big_holder_factor_score = VALUES(big_holder_factor_score),
      market_factor_score = VALUES(market_factor_score),
      global_factor_score = VALUES(global_factor_score),
      fundamental_factor_score = VALUES(fundamental_factor_score),
      learning_note = VALUES(learning_note),
      updated_at = CURRENT_TIMESTAMP
    `,
    [
      row.id || null,
      row.trade_date,
      row.stock_code,
      row.stock_name,
      row.market_type,
      row.industry,
      round(row.ai_strength_score, 2),
      row.ai_level,
      row.candidate_horizon,
      row.risk_level,
      environment,
      entry,
      returns[0],
      returns[1],
      returns[2],
      returns[3],
      feedback.maxReturn,
      feedback.minReturn,
      feedback.result,
      feedback.quality,
      round(row.chip_factor_score, 2),
      round(row.technical_factor_score, 2),
      round(row.main_force_factor_score, 2),
      round(row.big_holder_factor_score, 2),
      round(row.market_factor_score, 2),
      round(row.global_factor_score, 2),
      round(row.fundamental_factor_score, 2),
      note,
    ],
  );
  return feedback.result;
}

function summarizeFactorRows(rows, factor) {
  const values = rows
    .map((row) => ({
      factorScore: toNumber(row[factor.column], null),
      result: String(row.feedback_result || "WAITING"),
      r1: toNumber(row.return_1d_pct, null),
      r3: toNumber(row.return_3d_pct, null),
      r5: toNumber(row.return_5d_pct, null),
      r10: toNumber(row.return_10d_pct, null),
    }))
    .filter((row) => row.factorScore !== null);

  const summary = {
    sampleCount: values.length,
    successCount: values.filter((row) => row.result === "SUCCESS").length,
    partialCount: values.filter((row) => row.result === "PARTIAL").length,
    failCount: values.filter((row) => row.result === "FAIL").length,
    waitingCount: values.filter((row) => row.result === "WAITING").length,
  };
  const completedCount = Math.max(summary.sampleCount - summary.waitingCount, 0);
  summary.successRatePct = completedCount > 0 ? round((summary.successCount / completedCount) * 100, 4) : 0;
  summary.avgFactorScore = values.length ? round(values.reduce((sum, row) => sum + row.factorScore, 0) / values.length, 4) : null;

  for (const [key, prop] of [["avgReturn1d", "r1"], ["avgReturn3d", "r3"], ["avgReturn5d", "r5"], ["avgReturn10d", "r10"]]) {
    const returnValues = values.map((row) => row[prop]).filter((value) => value !== null);
    summary[key] = returnValues.length ? round(returnValues.reduce((sum, value) => sum + value, 0) / returnValues.length, 4) : null;
  }

  const performanceBase = 50 + (summary.successRatePct - 50) * 0.35 + toNumber(summary.avgReturn5d, 0) * 4;
  summary.performanceScore = round(clamp(performanceBase, 0, 100), 2);
  summary.learningStatus = completedCount < 5 ? "INSUFFICIENT" : summary.performanceScore >= 62 ? "GOOD" : summary.performanceScore <= 42 ? "WEAK" : "OBSERVE";
  return summary;
}

async function upsertFactorSnapshots(conn, snapshotDate) {
  const feedbackRows = await conn.query(`SELECT * FROM ai_recommendation_feedbacks WHERE signal_trade_date <= ?`, [snapshotDate]);
  const environments = ["ALL", "BULL", "RANGE", "BEAR", "HIGH_RISK"];
  let count = 0;

  for (const factor of factorDefinitions()) {
    for (const environment of environments) {
      const rows = environment === "ALL" ? feedbackRows : feedbackRows.filter((row) => String(row.market_environment) === environment);
      const summary = summarizeFactorRows(rows, factor);
      await conn.query(
        `
        INSERT INTO ai_factor_performance_snapshots (
          snapshot_date, factor_key, factor_name, market_environment, sample_count,
          success_count, partial_count, fail_count, waiting_count, success_rate_pct,
          avg_return_1d_pct, avg_return_3d_pct, avg_return_5d_pct, avg_return_10d_pct,
          avg_factor_score, performance_score, learning_status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          sample_count = VALUES(sample_count),
          success_count = VALUES(success_count),
          partial_count = VALUES(partial_count),
          fail_count = VALUES(fail_count),
          waiting_count = VALUES(waiting_count),
          success_rate_pct = VALUES(success_rate_pct),
          avg_return_1d_pct = VALUES(avg_return_1d_pct),
          avg_return_3d_pct = VALUES(avg_return_3d_pct),
          avg_return_5d_pct = VALUES(avg_return_5d_pct),
          avg_return_10d_pct = VALUES(avg_return_10d_pct),
          avg_factor_score = VALUES(avg_factor_score),
          performance_score = VALUES(performance_score),
          learning_status = VALUES(learning_status),
          updated_at = CURRENT_TIMESTAMP
        `,
        [
          snapshotDate,
          factor.key,
          factor.name,
          environment,
          summary.sampleCount,
          summary.successCount,
          summary.partialCount,
          summary.failCount,
          summary.waitingCount,
          summary.successRatePct,
          summary.avgReturn1d,
          summary.avgReturn3d,
          summary.avgReturn5d,
          summary.avgReturn10d,
          summary.avgFactorScore,
          summary.performanceScore,
          summary.learningStatus,
        ],
      );
      count += 1;
    }
  }
  return count;
}

async function upsertWeightSuggestions(conn, suggestionDate) {
  const factorRows = await conn.query(
    `SELECT * FROM ai_factor_performance_snapshots WHERE snapshot_date = ? AND market_environment = 'ALL'`,
    [suggestionDate],
  );
  const map = new Map(factorRows.map((row) => [row.factor_key, row]));
  let count = 0;

  for (const factor of factorDefinitions()) {
    const row = map.get(factor.key) || {};
    const sampleCount = Number(row.sample_count || 0);
    const successRate = toNumber(row.success_rate_pct, 0) || 0;
    const avgReturn5d = toNumber(row.avg_return_5d_pct, 0) || 0;
    const performanceScore = toNumber(row.performance_score, 50) || 50;

    let action = "KEEP";
    let suggestedWeight = factor.currentWeight;
    let confidence = "LOW";
    let reason = "樣本數不足，暫時維持原權重。";

    if (sampleCount >= 20) {
      confidence = sampleCount >= 80 ? "HIGH" : "MEDIUM";
      if (performanceScore >= 62 && successRate >= 52 && avgReturn5d >= 0.5) {
        action = "INCREASE";
        suggestedWeight = factor.currentWeight + 0.02;
        reason = `${factor.name} 近期勝率 ${successRate}%、5 日平均 ${avgReturn5d}%，建議小幅加權。`;
      } else if (performanceScore <= 42 || successRate <= 42 || avgReturn5d <= -1) {
        action = "DECREASE";
        suggestedWeight = Math.max(0.02, factor.currentWeight - 0.02);
        reason = `${factor.name} 近期表現偏弱，勝率 ${successRate}%、5 日平均 ${avgReturn5d}%，建議降權觀察。`;
      } else {
        reason = `${factor.name} 目前表現中性，勝率 ${successRate}%、5 日平均 ${avgReturn5d}%，維持權重。`;
      }
    }

    await conn.query(
      `
      INSERT INTO ai_factor_weight_suggestions (
        suggestion_date, factor_key, factor_name, current_weight, suggested_weight,
        suggestion_action, confidence_level, sample_count, success_rate_pct, avg_return_5d_pct, reason
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        factor_name = VALUES(factor_name),
        current_weight = VALUES(current_weight),
        suggested_weight = VALUES(suggested_weight),
        suggestion_action = VALUES(suggestion_action),
        confidence_level = VALUES(confidence_level),
        sample_count = VALUES(sample_count),
        success_rate_pct = VALUES(success_rate_pct),
        avg_return_5d_pct = VALUES(avg_return_5d_pct),
        reason = VALUES(reason),
        updated_at = CURRENT_TIMESTAMP
      `,
      [suggestionDate, factor.key, factor.name, factor.currentWeight, round(suggestedWeight, 4), action, confidence, sampleCount, successRate, avgReturn5d, reason],
    );
    count += 1;
  }
  return count;
}

async function main() {
  const targetDate = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : null;
  const limitArg = process.argv.find((arg) => arg.startsWith("--limit="));
  const limit = Math.max(1, Math.min(Number(limitArg?.split("=")[1] || 800), 5000));
  let conn;

  console.log("====================================");
  console.log("Stock Radar V2.3 AI 推薦回饋學習產生");
  console.log("====================================");

  try {
    conn = await pool.getConnection();
    for (const table of ["ai_selection_signals", "daily_prices", "ai_recommendation_feedbacks", "ai_factor_performance_snapshots", "ai_factor_weight_suggestions"]) {
      if (!(await tableExists(conn, table))) throw new Error(`缺少資料表 ${table}，請先執行相關 setup。`);
    }

    const latestSignalDate = targetDate || await getLatestDate(conn, "ai_selection_signals", "trade_date");
    const snapshotDate = todayText();
    if (!latestSignalDate) {
      console.log("尚未有 AI 多因子訊號，略過產生回饋資料。");
      console.log("結果：PASS");
      return;
    }

    const signalRows = await getSignalRows(conn, latestSignalDate, limit);
    let successCount = 0;
    let partialCount = 0;
    let failCount = 0;
    let waitingCount = 0;

    for (const row of signalRows) {
      const result = await upsertFeedback(conn, row);
      if (result === "SUCCESS") successCount += 1;
      else if (result === "PARTIAL") partialCount += 1;
      else if (result === "FAIL") failCount += 1;
      else waitingCount += 1;
    }

    const factorSnapshotCount = await upsertFactorSnapshots(conn, snapshotDate);
    const weightSuggestionCount = await upsertWeightSuggestions(conn, snapshotDate);

    console.log(`分析截止日期：${latestSignalDate}`);
    console.log(`推薦回饋筆數：${signalRows.length}`);
    console.log(`SUCCESS：${successCount}`);
    console.log(`PARTIAL：${partialCount}`);
    console.log(`FAIL：${failCount}`);
    console.log(`WAITING：${waitingCount}`);
    console.log(`因子績效快照：${factorSnapshotCount}`);
    console.log(`權重建議：${weightSuggestionCount}`);
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
