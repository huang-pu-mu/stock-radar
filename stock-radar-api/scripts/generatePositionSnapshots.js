import dotenv from "dotenv";
import pool from "../db.js";

dotenv.config();

const args = process.argv.slice(2);
const tradeDateArg = args.find((arg) => /^\d{4}-\d{2}-\d{2}$/.test(arg)) || "";

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

async function tableExists(conn, tableName) {
  const rows = await conn.query(
    "SELECT COUNT(*) AS table_count FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?",
    [tableName],
  );
  return Number(rows?.[0]?.table_count || 0) > 0;
}

async function getTargetTradeDate(conn) {
  if (tradeDateArg) return tradeDateArg;
  const rows = await conn.query("SELECT DATE_FORMAT(MAX(trade_date), '%Y-%m-%d') AS latest_date FROM daily_prices");
  return rows?.[0]?.latest_date || null;
}

function analyzePosition(row) {
  const shares = toNumber(row.shares, 0);
  const buyPrice = toNumber(row.buy_price, 0);
  const closePrice = toNumber(row.close_price, buyPrice);
  const costAmount = round(toNumber(row.cost_amount, null) ?? buyPrice * shares, 2) || 0;
  const marketValue = round(closePrice * shares, 2) || 0;
  const pnl = round(marketValue - costAmount, 2) || 0;
  const pnlPct = costAmount > 0 ? round((pnl / costAmount) * 100, 4) : 0;
  const stopLoss = toNumber(row.stop_loss_price, null);
  const takeProfit = toNumber(row.take_profit_price, null);
  const trailingStop = toNumber(row.trailing_stop_price, null);
  const aiScore = toNumber(row.ai_strength_score, null);
  const marketRisk = toNumber(row.market_risk_score, null);
  const globalRisk = toNumber(row.global_risk_score, null);
  const riskLine = trailingStop !== null ? Math.max(stopLoss ?? 0, trailingStop) : stopLoss;
  const distanceToStop = stopLoss && closePrice ? round(((closePrice - stopLoss) / closePrice) * 100, 4) : null;
  const distanceToTake = takeProfit && closePrice ? round(((takeProfit - closePrice) / closePrice) * 100, 4) : null;

  let level = "LOW";
  let action = "可續抱";
  const reasons = [];

  if (riskLine !== null && closePrice <= riskLine) {
    level = "CRITICAL";
    action = "跌破風控線，建議檢查";
    reasons.push(`現價 ${closePrice} 已低於風控線 ${riskLine}`);
  } else if (takeProfit !== null && closePrice >= takeProfit) {
    level = "MEDIUM";
    action = "達停利價，建議分批檢查";
    reasons.push(`現價 ${closePrice} 已達停利價 ${takeProfit}`);
  } else if ((marketRisk !== null && marketRisk < 45) || (globalRisk !== null && globalRisk < 45)) {
    level = "HIGH";
    action = "風險升高，建議保守";
    reasons.push("市場或全球風險分數偏低");
  } else if (aiScore !== null && aiScore < 60) {
    level = "HIGH";
    action = "分數轉弱，建議減碼";
    reasons.push(`AI Strength Score ${aiScore} 低於 60`);
  } else if (aiScore !== null && aiScore >= 80 && pnlPct >= 0) {
    level = "LOW";
    action = "AI 分數轉強，可續抱";
    reasons.push(`AI Strength Score ${aiScore} 偏強`);
  } else if (aiScore !== null && aiScore >= 72 && pnlPct <= 0) {
    level = "MEDIUM";
    action = "可觀察加碼";
    reasons.push(`AI Strength Score ${aiScore} 仍在觀察區間`);
  } else if (pnlPct <= -8) {
    level = "HIGH";
    action = "虧損擴大，建議檢查";
    reasons.push(`未實現報酬率 ${pnlPct}%`);
  } else {
    reasons.push(`未實現報酬率 ${pnlPct}%`);
    if (aiScore !== null) reasons.push(`AI Strength Score ${aiScore}`);
  }

  if (distanceToStop !== null && distanceToStop <= 5 && level === "LOW") {
    level = "MEDIUM";
    reasons.push("距離停損價小於 5%");
  }

  return {
    closePrice,
    marketValue,
    costAmount,
    pnl,
    pnlPct,
    distanceToStop,
    distanceToTake,
    level,
    action,
    reason: reasons.slice(0, 5).join("；"),
  };
}

async function main() {
  const conn = await pool.getConnection();

  try {
    console.log("====================================");
    console.log("Stock Radar V2.1 持股風險快照產生");
    console.log("====================================");

    for (const tableName of ["user_positions", "user_position_snapshots", "position_risk_alerts"]) {
      if (!(await tableExists(conn, tableName))) {
        throw new Error(`缺少資料表 ${tableName}，請先執行 npm run position:setup`);
      }
    }

    const targetDate = await getTargetTradeDate(conn);
    if (!targetDate) throw new Error("找不到 daily_prices 最新交易日，無法產生快照。");
    console.log(`快照交易日：${targetDate}`);

    const rows = await conn.query(
      `
      SELECT
        p.*,
        dp.close_price,
        DATE_FORMAT(dp.trade_date, '%Y-%m-%d') AS price_trade_date,
        ai.ai_strength_score,
        ai.market_risk_score,
        ai.global_risk_score,
        ai.breakout_score,
        ai.main_force_score,
        ai.big_holder_trend_score
      FROM user_positions p
      LEFT JOIN daily_prices dp
        ON dp.stock_code = p.stock_code
       AND dp.trade_date = ?
      LEFT JOIN ai_selection_signals ai
        ON ai.stock_code = p.stock_code
       AND ai.trade_date = (
          SELECT MAX(ai2.trade_date)
          FROM ai_selection_signals ai2
          WHERE ai2.stock_code = p.stock_code
            AND ai2.trade_date <= ?
       )
      WHERE p.is_active = 1
      ORDER BY p.user_id ASC, p.id ASC
      `,
      [targetDate, targetDate],
    );

    let generatedCount = 0;
    let skippedCount = 0;

    for (const row of rows) {
      if (row.close_price === null || row.close_price === undefined) {
        skippedCount += 1;
        console.log(`略過 ${row.stock_code} position_id=${row.id}，找不到 ${targetDate} 收盤價。`);
        continue;
      }

      const analysis = analyzePosition(row);
      await conn.query(
        `
        INSERT INTO user_position_snapshots (
          user_id, position_id, stock_code, trade_date, close_price,
          market_value, cost_amount, unrealized_profit_loss, unrealized_profit_loss_pct,
          stop_loss_price, take_profit_price, trailing_stop_price,
          distance_to_stop_loss_pct, distance_to_take_profit_pct,
          ai_strength_score, market_risk_score, global_risk_score,
          breakout_score, main_force_score, big_holder_trend_score,
          position_risk_level, ai_action, ai_reason
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          close_price = VALUES(close_price),
          market_value = VALUES(market_value),
          cost_amount = VALUES(cost_amount),
          unrealized_profit_loss = VALUES(unrealized_profit_loss),
          unrealized_profit_loss_pct = VALUES(unrealized_profit_loss_pct),
          stop_loss_price = VALUES(stop_loss_price),
          take_profit_price = VALUES(take_profit_price),
          trailing_stop_price = VALUES(trailing_stop_price),
          distance_to_stop_loss_pct = VALUES(distance_to_stop_loss_pct),
          distance_to_take_profit_pct = VALUES(distance_to_take_profit_pct),
          ai_strength_score = VALUES(ai_strength_score),
          market_risk_score = VALUES(market_risk_score),
          global_risk_score = VALUES(global_risk_score),
          breakout_score = VALUES(breakout_score),
          main_force_score = VALUES(main_force_score),
          big_holder_trend_score = VALUES(big_holder_trend_score),
          position_risk_level = VALUES(position_risk_level),
          ai_action = VALUES(ai_action),
          ai_reason = VALUES(ai_reason)
        `,
        [
          row.user_id,
          row.id,
          row.stock_code,
          targetDate,
          analysis.closePrice,
          analysis.marketValue,
          analysis.costAmount,
          analysis.pnl,
          analysis.pnlPct,
          row.stop_loss_price,
          row.take_profit_price,
          row.trailing_stop_price,
          analysis.distanceToStop,
          analysis.distanceToTake,
          row.ai_strength_score,
          row.market_risk_score,
          row.global_risk_score,
          row.breakout_score,
          row.main_force_score,
          row.big_holder_trend_score,
          analysis.level,
          analysis.action,
          analysis.reason,
        ],
      );
      generatedCount += 1;
    }

    console.log(`有效持股：${rows.length}`);
    console.log(`產生 / 更新快照：${generatedCount}`);
    console.log(`略過：${skippedCount}`);
    console.log("結果：PASS");
  } catch (error) {
    console.error("產生 V2.1 持股風險快照失敗：", error.message);
    process.exitCode = 1;
  } finally {
    conn.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error("產生 V2.1 持股風險快照失敗：", error);
  process.exit(1);
});
