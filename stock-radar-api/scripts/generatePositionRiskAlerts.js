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

async function tableExists(conn, tableName) {
  const rows = await conn.query(
    "SELECT COUNT(*) AS table_count FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?",
    [tableName],
  );
  return Number(rows?.[0]?.table_count || 0) > 0;
}

async function getTargetTradeDate(conn) {
  if (tradeDateArg) return tradeDateArg;
  const rows = await conn.query("SELECT DATE_FORMAT(MAX(trade_date), '%Y-%m-%d') AS latest_date FROM user_position_snapshots");
  return rows?.[0]?.latest_date || null;
}

function buildAlerts(row) {
  const alerts = [];
  const stockName = row.stock_name || row.stock_code;
  const closePrice = toNumber(row.close_price, null);
  const stopLoss = toNumber(row.stop_loss_price, null);
  const takeProfit = toNumber(row.take_profit_price, null);
  const trailingStop = toNumber(row.trailing_stop_price, null);
  const aiScore = toNumber(row.ai_strength_score, null);
  const marketRisk = toNumber(row.market_risk_score, null);
  const globalRisk = toNumber(row.global_risk_score, null);
  const pnlPct = toNumber(row.unrealized_profit_loss_pct, 0);

  if (closePrice !== null && stopLoss !== null && closePrice <= stopLoss) {
    alerts.push({
      type: "STOP_LOSS",
      level: "CRITICAL",
      title: `${stockName} 跌破停損價`,
      message: `現價 ${closePrice} 已低於停損價 ${stopLoss}，未實現報酬率 ${pnlPct}%，建議立即檢查持股風控。`,
    });
  }

  if (closePrice !== null && trailingStop !== null && closePrice <= trailingStop) {
    alerts.push({
      type: "TRAILING_STOP",
      level: "HIGH",
      title: `${stockName} 跌破移動停利`,
      message: `現價 ${closePrice} 已低於移動停利價 ${trailingStop}，建議檢查是否保護獲利。`,
    });
  }

  if (closePrice !== null && takeProfit !== null && closePrice >= takeProfit) {
    alerts.push({
      type: "TAKE_PROFIT",
      level: "MEDIUM",
      title: `${stockName} 達停利價`,
      message: `現價 ${closePrice} 已達停利價 ${takeProfit}，可檢查是否分批停利或調整移動停利。`,
    });
  }

  if (aiScore !== null && aiScore < 60) {
    alerts.push({
      type: "AI_WEAK",
      level: "HIGH",
      title: `${stockName} AI 分數轉弱`,
      message: `AI Strength Score ${aiScore} 低於 60，建議檢查是否需要減碼或提高觀察。`,
    });
  }

  if ((marketRisk !== null && marketRisk < 45) || (globalRisk !== null && globalRisk < 45)) {
    alerts.push({
      type: "MARKET_RISK",
      level: "HIGH",
      title: `${stockName} 市場風險升高`,
      message: `Market Risk ${marketRisk ?? "-"} / Global Risk ${globalRisk ?? "-"}，整體風險偏高，建議保守檢查持股。`,
    });
  }

  if (["HIGH", "CRITICAL"].includes(String(row.position_risk_level || "").toUpperCase()) && alerts.length === 0) {
    alerts.push({
      type: "POSITION_RISK",
      level: row.position_risk_level,
      title: `${stockName} 持股風險偏高`,
      message: row.ai_reason || row.ai_action || "持股風險等級偏高，建議檢查。",
    });
  }

  return alerts;
}

async function main() {
  const conn = await pool.getConnection();

  try {
    console.log("====================================");
    console.log("Stock Radar V2.1 持股風控提醒產生");
    console.log("====================================");

    for (const tableName of ["user_positions", "user_position_snapshots", "position_risk_alerts"]) {
      if (!(await tableExists(conn, tableName))) {
        throw new Error(`缺少資料表 ${tableName}，請先執行 npm run position:setup`);
      }
    }

    const targetDate = await getTargetTradeDate(conn);
    if (!targetDate) {
      console.log("尚未有持股快照，略過提醒產生。");
      console.log("結果：PASS");
      return;
    }

    const rows = await conn.query(
      `
      SELECT
        ps.*,
        p.stock_name,
        p.market_type
      FROM user_position_snapshots ps
      LEFT JOIN user_positions p ON p.id = ps.position_id
      WHERE ps.trade_date = ?
      ORDER BY ps.user_id ASC, ps.position_id ASC
      `,
      [targetDate],
    );

    let alertCount = 0;
    for (const row of rows) {
      for (const alert of buildAlerts(row)) {
        await conn.query(
          `
          INSERT INTO position_risk_alerts (
            user_id, position_id, stock_code, alert_date, alert_type, alert_level, alert_title, alert_message
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            alert_level = VALUES(alert_level),
            alert_title = VALUES(alert_title),
            alert_message = VALUES(alert_message)
          `,
          [row.user_id, row.position_id, row.stock_code, targetDate, alert.type, alert.level, alert.title, alert.message],
        );
        alertCount += 1;
      }
    }

    console.log(`快照日期：${targetDate}`);
    console.log(`檢查快照：${rows.length}`);
    console.log(`產生 / 更新提醒：${alertCount}`);
    console.log("結果：PASS");
  } catch (error) {
    console.error("產生 V2.1 持股風控提醒失敗：", error.message);
    process.exitCode = 1;
  } finally {
    conn.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error("產生 V2.1 持股風控提醒失敗：", error);
  process.exit(1);
});
