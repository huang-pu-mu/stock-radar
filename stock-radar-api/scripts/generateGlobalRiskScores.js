import pool from "../db.js";

function getTaipeiToday() {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Taipei" }).format(new Date());
}

function normalizeDate(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw new Error("日期格式錯誤，請使用 YYYY-MM-DD，例如 2026-06-25");
  }
  return text;
}

function clampScore(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function getRiskWeight(score) {
  if (score >= 80) return 1.0;
  if (score >= 60) return 0.96;
  if (score >= 40) return 0.84;
  return 0.7;
}

function isSemiconductorOrTech(industry) {
  const text = String(industry || "");
  return /半導體|電子|電腦|光電|通信|資訊|雲端/.test(text);
}

function pressurePenalty(snapshot, industry) {
  let penalty = 0;
  const tech = String(snapshot.technology_pressure || "");
  const semi = String(snapshot.semiconductor_pressure || "");

  if (/明顯偏弱/.test(tech)) penalty -= 4;
  else if (/偏弱/.test(tech)) penalty -= 2;

  if (isSemiconductorOrTech(industry)) {
    if (/明顯偏弱/.test(semi)) penalty -= 6;
    else if (/偏弱/.test(semi)) penalty -= 3;
  }

  return penalty;
}

function calculateAdjustedScore(baseScore, snapshot, industry) {
  const score = Number(baseScore || 0);
  const riskScore = Number(snapshot.global_risk_score || 70);
  const weight = getRiskWeight(riskScore);
  let adjusted = Math.round(score * weight) + pressurePenalty(snapshot, industry);

  if (riskScore >= 82) adjusted += Math.min(4, Math.round((riskScore - 80) * 0.2));
  if (riskScore < 55) adjusted -= Math.round((55 - riskScore) * 0.25);

  adjusted = clampScore(adjusted);

  return {
    weight,
    adjustedScore: adjusted,
    globalAdjustment: adjusted - score,
  };
}

async function tableExists(conn, tableName) {
  const rows = await conn.query(
    `
    SELECT COUNT(*) AS count
    FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = ?
    `,
    [tableName],
  );
  return Number(rows?.[0]?.count || 0) > 0;
}

async function getLatestChipScoreDate(conn) {
  const rows = await conn.query(`SELECT DATE_FORMAT(MAX(trade_date), '%Y-%m-%d') AS latest_date FROM chip_scores`);
  return rows?.[0]?.latest_date || getTaipeiToday();
}

async function getGlobalRiskSnapshot(conn, tradeDate) {
  const rows = await conn.query(
    `
    SELECT
      id,
      DATE_FORMAT(trade_date, '%Y-%m-%d') AS trade_date,
      DATE_FORMAT(snapshot_time, '%Y-%m-%d %H:%i:%s') AS snapshot_time,
      global_risk_score,
      global_risk_level,
      global_market_mode,
      us_market_status,
      technology_pressure,
      semiconductor_pressure,
      opening_gap_probability,
      risk_summary
    FROM global_market_snapshots
    WHERE trade_date <= ?
    ORDER BY trade_date DESC, snapshot_time DESC, id DESC
    LIMIT 1
    `,
    [tradeDate],
  );

  if (rows.length > 0) return rows[0];

  return {
    id: null,
    trade_date: tradeDate,
    snapshot_time: null,
    global_risk_score: 70,
    global_risk_level: "正常",
    global_market_mode: "RANGE",
    us_market_status: "中性",
    technology_pressure: "中性",
    semiconductor_pressure: "中性",
    opening_gap_probability: 50,
    risk_summary: "尚未取得全球市場風險快照，暫以中性 Global Risk Score 70 計算。",
  };
}

async function getScoreRows(conn, tradeDate) {
  const hasMarketAdjusted = await tableExists(conn, "market_risk_adjusted_scores");
  if (hasMarketAdjusted) {
    return await conn.query(
      `
      SELECT
        c.stock_code,
        s.industry,
        c.chip_score AS close_score,
        a.adjusted_score AS market_adjusted_score
      FROM chip_scores c
      LEFT JOIN stocks s ON c.stock_code = s.stock_code
      LEFT JOIN market_risk_adjusted_scores a
        ON c.stock_code = a.stock_code
       AND c.trade_date = a.trade_date
      WHERE c.trade_date = ?
      ORDER BY COALESCE(a.adjusted_score, c.chip_score) DESC, c.stock_code ASC
      `,
      [tradeDate],
    );
  }

  return await conn.query(
    `
    SELECT
      c.stock_code,
      s.industry,
      c.chip_score AS close_score,
      NULL AS market_adjusted_score
    FROM chip_scores c
    LEFT JOIN stocks s ON c.stock_code = s.stock_code
    WHERE c.trade_date = ?
    ORDER BY c.chip_score DESC, c.stock_code ASC
    `,
    [tradeDate],
  );
}

async function upsertAdjustedScore(conn, tradeDate, row, snapshot) {
  const closeScore = Number(row.close_score || 0);
  const baseScore = row.market_adjusted_score === null || row.market_adjusted_score === undefined
    ? closeScore
    : Number(row.market_adjusted_score || closeScore);
  const adjusted = calculateAdjustedScore(baseScore, snapshot, row.industry);

  await conn.query(
    `
    INSERT INTO global_risk_adjusted_scores (
      trade_date,
      stock_code,
      source_snapshot_id,
      close_score,
      market_adjusted_score,
      global_risk_score,
      global_risk_level,
      global_market_mode,
      global_risk_weight,
      global_adjustment,
      global_adjusted_score,
      opening_gap_probability,
      technology_pressure,
      semiconductor_pressure,
      risk_summary
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      source_snapshot_id = VALUES(source_snapshot_id),
      close_score = VALUES(close_score),
      market_adjusted_score = VALUES(market_adjusted_score),
      global_risk_score = VALUES(global_risk_score),
      global_risk_level = VALUES(global_risk_level),
      global_market_mode = VALUES(global_market_mode),
      global_risk_weight = VALUES(global_risk_weight),
      global_adjustment = VALUES(global_adjustment),
      global_adjusted_score = VALUES(global_adjusted_score),
      opening_gap_probability = VALUES(opening_gap_probability),
      technology_pressure = VALUES(technology_pressure),
      semiconductor_pressure = VALUES(semiconductor_pressure),
      risk_summary = VALUES(risk_summary)
    `,
    [
      tradeDate,
      row.stock_code,
      snapshot.id,
      closeScore,
      row.market_adjusted_score === null || row.market_adjusted_score === undefined ? null : Number(row.market_adjusted_score),
      Number(snapshot.global_risk_score || 70),
      snapshot.global_risk_level || "正常",
      snapshot.global_market_mode || "RANGE",
      adjusted.weight,
      adjusted.globalAdjustment,
      adjusted.adjustedScore,
      Number(snapshot.opening_gap_probability || 50),
      snapshot.technology_pressure || "中性",
      snapshot.semiconductor_pressure || "中性",
      snapshot.risk_summary || "",
    ],
  );

  return adjusted;
}

async function main() {
  const conn = await pool.getConnection();

  try {
    const inputDate = normalizeDate(process.argv[2] || "");
    const tradeDate = inputDate || await getLatestChipScoreDate(conn);
    const snapshot = await getGlobalRiskSnapshot(conn, tradeDate);
    const rows = await getScoreRows(conn, tradeDate);

    console.log("====================================");
    console.log("Stock Radar V1.6 全球風險修正分數產生");
    console.log("====================================");
    console.log(`分析日期：${tradeDate}`);
    console.log(`全球風險：${snapshot.global_risk_score}｜${snapshot.global_risk_level}｜${snapshot.global_market_mode}`);
    console.log(`隔日開低機率：${snapshot.opening_gap_probability}%`);

    if (rows.length === 0) {
      throw new Error(`chip_scores 找不到 ${tradeDate} 的資料，請先執行 npm run score -- ${tradeDate}`);
    }

    let updatedCount = 0;
    let minAdjustment = 0;
    let maxAdjustment = 0;

    for (const row of rows) {
      const adjusted = await upsertAdjustedScore(conn, tradeDate, row, snapshot);
      updatedCount += 1;
      minAdjustment = Math.min(minAdjustment, adjusted.globalAdjustment);
      maxAdjustment = Math.max(maxAdjustment, adjusted.globalAdjustment);
    }

    console.log("------------------------------------");
    console.log(`更新個股數：${updatedCount}`);
    console.log(`全球修正分數區間：${minAdjustment} ～ ${maxAdjustment}`);
    console.log("結果：PASS");
  } finally {
    conn.release();
    await pool.end();
  }
}

main().catch(async (error) => {
  console.error("V1.6 全球風險修正分數產生失敗：", error.message);
  try { await pool.end(); } catch {}
  process.exit(1);
});
