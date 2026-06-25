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
  if (score >= 60) return 0.95;
  if (score >= 40) return 0.85;
  return 0.7;
}

function calculateAdjustedScore(closeScore, marketRiskScore) {
  const score = Number(closeScore || 0);
  const riskScore = Number(marketRiskScore || 70);
  const weight = getRiskWeight(riskScore);
  let adjusted = Math.round(score * weight);

  if (riskScore >= 80) {
    adjusted += Math.min(5, Math.round((riskScore - 80) * 0.25));
  } else if (riskScore < 60) {
    adjusted -= Math.round((60 - riskScore) * 0.2);
  }

  adjusted = clampScore(adjusted);

  return {
    weight,
    adjustedScore: adjusted,
    nightAdjustment: adjusted - score,
  };
}

async function getLatestChipScoreDate(conn) {
  const rows = await conn.query(`SELECT DATE_FORMAT(MAX(trade_date), '%Y-%m-%d') AS latest_date FROM chip_scores`);
  return rows?.[0]?.latest_date || getTaipeiToday();
}

async function getMarketRiskSnapshot(conn, tradeDate) {
  const rows = await conn.query(
    `
    SELECT
      id,
      DATE_FORMAT(trade_date, '%Y-%m-%d') AS trade_date,
      DATE_FORMAT(snapshot_time, '%Y-%m-%d %H:%i:%s') AS snapshot_time,
      product_code,
      product_name,
      contract_month,
      session_type,
      market_risk_score,
      market_risk_level,
      market_mode,
      night_signal,
      risk_summary
    FROM market_risk_snapshots
    WHERE trade_date = ?
    ORDER BY
      CASE session_type WHEN 'after_hours' THEN 1 WHEN 'regular' THEN 2 ELSE 3 END,
      snapshot_time DESC,
      total_volume DESC,
      id DESC
    LIMIT 1
    `,
    [tradeDate],
  );

  if (rows.length > 0) return rows[0];

  return {
    id: null,
    trade_date: tradeDate,
    snapshot_time: null,
    product_code: "TX",
    product_name: "臺股期貨",
    contract_month: "",
    session_type: "neutral_fallback",
    market_risk_score: 70,
    market_risk_level: "正常",
    market_mode: "RANGE",
    night_signal: "尚未取得夜盤資料",
    risk_summary: "尚未取得台指期市場風險快照，暫以中性 Market Risk Score 70 計算。",
  };
}

async function getChipRows(conn, tradeDate) {
  return await conn.query(
    `
    SELECT stock_code, chip_score
    FROM chip_scores
    WHERE trade_date = ?
    ORDER BY chip_score DESC, stock_code ASC
    `,
    [tradeDate],
  );
}

async function upsertAdjustedScore(conn, tradeDate, stockCode, closeScore, snapshot) {
  const marketRiskScore = Number(snapshot.market_risk_score || 70);
  const adjusted = calculateAdjustedScore(closeScore, marketRiskScore);

  await conn.query(
    `
    INSERT INTO market_risk_adjusted_scores (
      trade_date,
      stock_code,
      source_snapshot_id,
      close_score,
      market_risk_score,
      market_risk_level,
      market_mode,
      risk_weight,
      night_adjustment,
      adjusted_score,
      risk_summary
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      source_snapshot_id = VALUES(source_snapshot_id),
      close_score = VALUES(close_score),
      market_risk_score = VALUES(market_risk_score),
      market_risk_level = VALUES(market_risk_level),
      market_mode = VALUES(market_mode),
      risk_weight = VALUES(risk_weight),
      night_adjustment = VALUES(night_adjustment),
      adjusted_score = VALUES(adjusted_score),
      risk_summary = VALUES(risk_summary)
    `,
    [
      tradeDate,
      stockCode,
      snapshot.id,
      Number(closeScore || 0),
      marketRiskScore,
      snapshot.market_risk_level || "正常",
      snapshot.market_mode || "RANGE",
      adjusted.weight,
      adjusted.nightAdjustment,
      adjusted.adjustedScore,
      snapshot.risk_summary || "",
    ],
  );

  return adjusted;
}

async function main() {
  const conn = await pool.getConnection();

  try {
    const inputDate = process.argv[2] || "";
    const tradeDate = inputDate ? normalizeDate(inputDate) : await getLatestChipScoreDate(conn);
    const snapshot = await getMarketRiskSnapshot(conn, tradeDate);
    const rows = await getChipRows(conn, tradeDate);

    console.log("====================================");
    console.log("Stock Radar V1.5 夜盤修正分數產生");
    console.log("====================================");
    console.log(`分析日期：${tradeDate}`);
    console.log(`市場風險：${snapshot.market_risk_score}｜${snapshot.market_risk_level}｜${snapshot.market_mode}`);
    console.log(`訊號：${snapshot.night_signal}`);

    if (rows.length === 0) {
      throw new Error(`chip_scores 找不到 ${tradeDate} 的資料，請先執行 npm run score -- ${tradeDate}`);
    }

    let updatedCount = 0;
    let minAdjustment = 0;
    let maxAdjustment = 0;

    for (const row of rows) {
      const adjusted = await upsertAdjustedScore(conn, tradeDate, row.stock_code, row.chip_score, snapshot);
      updatedCount += 1;
      minAdjustment = Math.min(minAdjustment, adjusted.nightAdjustment);
      maxAdjustment = Math.max(maxAdjustment, adjusted.nightAdjustment);
    }

    console.log("------------------------------------");
    console.log(`更新個股數：${updatedCount}`);
    console.log(`修正分數區間：${minAdjustment} ～ ${maxAdjustment}`);
    console.log("結果：PASS");
  } finally {
    conn.release();
    await pool.end();
  }
}

main().catch(async (error) => {
  console.error("V1.5 夜盤修正分數產生失敗：", error.message);
  try { await pool.end(); } catch {}
  process.exit(1);
});
