import path from "path";
import { fileURLToPath } from "url";
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

async function tableExists(conn, tableName) {
  const rows = await conn.query(
    "SELECT COUNT(*) AS table_count FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?",
    [tableName],
  );
  return Number(rows?.[0]?.table_count || 0) > 0;
}

async function getSnapshotDate(conn) {
  if (dateArg) return dateArg;
  const rows = await conn.query("SELECT DATE_FORMAT(COALESCE(MAX(trade_date), CURRENT_DATE()), '%Y-%m-%d') AS snapshot_date FROM user_trades WHERE is_active = 1");
  return rows?.[0]?.snapshot_date || new Date().toISOString().slice(0, 10);
}

async function generateRealizedRows(conn) {
  const sellRows = await conn.query(
    `
    SELECT t.*
    FROM user_trades t
    LEFT JOIN user_realized_trades r ON r.source_trade_id = t.id
    WHERE t.is_active = 1
      AND UPPER(t.trade_type) = 'SELL'
      AND r.id IS NULL
    ORDER BY t.user_id ASC, t.stock_code ASC, t.trade_date ASC, t.id ASC
    `,
  );

  let generatedCount = 0;
  let skippedCount = 0;

  for (const sell of sellRows) {
    const basisRows = await conn.query(
      `
      SELECT
        COALESCE(SUM(CASE WHEN UPPER(trade_type) = 'BUY' THEN shares ELSE 0 END), 0) AS buy_shares,
        COALESCE(SUM(CASE WHEN UPPER(trade_type) = 'BUY' THEN net_amount ELSE 0 END), 0) AS buy_amount,
        MIN(CASE WHEN UPPER(trade_type) = 'BUY' THEN trade_date ELSE NULL END) AS first_buy_date
      FROM user_trades
      WHERE user_id = ?
        AND stock_code = ?
        AND is_active = 1
        AND UPPER(trade_type) = 'BUY'
        AND (trade_date < ? OR (trade_date = ? AND id < ?))
      `,
      [sell.user_id, sell.stock_code, sell.trade_date, sell.trade_date, sell.id],
    );

    const basis = basisRows?.[0] || {};
    const buyShares = toNumber(basis.buy_shares, 0);
    const buyAmount = toNumber(basis.buy_amount, 0);
    const sellShares = toNumber(sell.shares, 0);

    if (buyShares <= 0 || sellShares <= 0) {
      skippedCount += 1;
      console.log(`略過賣出紀錄 id=${sell.id} ${sell.stock_code}，找不到可估算買進成本。`);
      continue;
    }

    const avgCost = round(buyAmount / buyShares, 4);
    const costAmount = round(avgCost * sellShares, 2);
    const sellGross = round(sell.trade_price * sellShares, 2);
    const fee = toNumber(sell.fee, 0);
    const tax = toNumber(sell.tax, 0);
    const realized = round(sellGross - fee - tax - costAmount, 2);
    const realizedPct = costAmount > 0 ? round((realized / costAmount) * 100, 4) : 0;
    const holdingDays = basis.first_buy_date
      ? Math.max(0, Math.round((new Date(sell.trade_date).getTime() - new Date(basis.first_buy_date).getTime()) / 86400000))
      : null;
    const status = realized > 0 ? "WIN" : realized < 0 ? "LOSS" : "FLAT";

    await conn.query(
      `
      INSERT INTO user_realized_trades (
        user_id, source_trade_id, stock_code, stock_name, market_type, buy_basis, buy_avg_price,
        sell_date, sell_price, shares, cost_amount, sell_gross_amount, fee, tax,
        realized_profit_loss, realized_profit_loss_pct, holding_days_estimated,
        strategy_source, ai_strength_score_at_trade, result_status
      ) VALUES (?, ?, ?, ?, ?, 'AVG_COST', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        buy_avg_price = VALUES(buy_avg_price),
        cost_amount = VALUES(cost_amount),
        sell_gross_amount = VALUES(sell_gross_amount),
        fee = VALUES(fee),
        tax = VALUES(tax),
        realized_profit_loss = VALUES(realized_profit_loss),
        realized_profit_loss_pct = VALUES(realized_profit_loss_pct),
        holding_days_estimated = VALUES(holding_days_estimated),
        strategy_source = VALUES(strategy_source),
        ai_strength_score_at_trade = VALUES(ai_strength_score_at_trade),
        result_status = VALUES(result_status)
      `,
      [
        sell.user_id,
        sell.id,
        sell.stock_code,
        sell.stock_name,
        sell.market_type,
        avgCost,
        sell.trade_date,
        sell.trade_price,
        sellShares,
        costAmount,
        sellGross,
        fee,
        tax,
        realized,
        realizedPct,
        holdingDays,
        sell.strategy_source,
        sell.ai_strength_score_at_trade,
        status,
      ],
    );
    generatedCount += 1;
  }

  return { generatedCount, skippedCount, sellCount: sellRows.length };
}

function getPerformanceLevel(winRate, realizedPnl) {
  if (realizedPnl > 0 && winRate >= 60) return "STRONG";
  if (realizedPnl > 0 || winRate >= 50) return "GOOD";
  if (realizedPnl < 0 && winRate < 40) return "WEAK";
  return "NEUTRAL";
}

async function generatePerformanceSnapshots(conn, snapshotDate) {
  const userRows = await conn.query(
    `
    SELECT DISTINCT user_id
    FROM user_trades
    WHERE is_active = 1
    UNION
    SELECT DISTINCT user_id
    FROM user_realized_trades
    `,
  );

  let snapshotCount = 0;

  for (const user of userRows) {
    const userId = user.user_id;
    const tradeRows = await conn.query(
      `
      SELECT
        COUNT(*) AS total_trades,
        SUM(UPPER(trade_type) = 'BUY') AS buy_trades,
        SUM(UPPER(trade_type) = 'SELL') AS sell_trades,
        COALESCE(SUM(CASE WHEN UPPER(trade_type) = 'BUY' THEN net_amount ELSE 0 END), 0) AS total_buy_amount,
        COALESCE(SUM(CASE WHEN UPPER(trade_type) = 'SELL' THEN net_amount ELSE 0 END), 0) AS total_sell_amount
      FROM user_trades
      WHERE user_id = ? AND is_active = 1 AND trade_date <= ?
      `,
      [userId, snapshotDate],
    );
    const realizedRows = await conn.query(
      `
      SELECT
        COUNT(*) AS closed_trades,
        SUM(result_status = 'WIN') AS winning_trades,
        SUM(result_status = 'LOSS') AS losing_trades,
        SUM(result_status = 'FLAT') AS flat_trades,
        COALESCE(SUM(realized_profit_loss), 0) AS realized_profit_loss,
        COALESCE(AVG(realized_profit_loss_pct), 0) AS avg_realized_profit_loss_pct,
        COALESCE(AVG(CASE WHEN result_status = 'WIN' THEN realized_profit_loss_pct ELSE NULL END), 0) AS avg_win_pct,
        COALESCE(AVG(CASE WHEN result_status = 'LOSS' THEN realized_profit_loss_pct ELSE NULL END), 0) AS avg_loss_pct
      FROM user_realized_trades
      WHERE user_id = ? AND sell_date <= ?
      `,
      [userId, snapshotDate],
    );
    const bestRows = await conn.query(
      `SELECT stock_code FROM user_realized_trades WHERE user_id = ? AND sell_date <= ? ORDER BY realized_profit_loss DESC LIMIT 1`,
      [userId, snapshotDate],
    );
    const worstRows = await conn.query(
      `SELECT stock_code FROM user_realized_trades WHERE user_id = ? AND sell_date <= ? ORDER BY realized_profit_loss ASC LIMIT 1`,
      [userId, snapshotDate],
    );
    const strategyRows = await conn.query(
      `
      SELECT strategy_source, SUM(realized_profit_loss) AS pnl
      FROM user_realized_trades
      WHERE user_id = ? AND sell_date <= ? AND strategy_source IS NOT NULL AND strategy_source <> ''
      GROUP BY strategy_source
      ORDER BY pnl DESC
      LIMIT 1
      `,
      [userId, snapshotDate],
    );

    const t = tradeRows?.[0] || {};
    const r = realizedRows?.[0] || {};
    const closedTrades = Number(r.closed_trades || 0);
    const winningTrades = Number(r.winning_trades || 0);
    const winRate = closedTrades > 0 ? round((winningTrades / closedTrades) * 100, 4) : 0;
    const realizedPnl = round(r.realized_profit_loss || 0, 2);

    await conn.query(
      `
      INSERT INTO user_performance_snapshots (
        user_id, snapshot_date, total_trades, buy_trades, sell_trades, closed_trades,
        winning_trades, losing_trades, flat_trades, win_rate_pct,
        total_buy_amount, total_sell_amount, realized_profit_loss,
        avg_realized_profit_loss_pct, avg_win_pct, avg_loss_pct,
        best_stock_code, worst_stock_code, best_strategy_source, performance_level
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        total_trades = VALUES(total_trades),
        buy_trades = VALUES(buy_trades),
        sell_trades = VALUES(sell_trades),
        closed_trades = VALUES(closed_trades),
        winning_trades = VALUES(winning_trades),
        losing_trades = VALUES(losing_trades),
        flat_trades = VALUES(flat_trades),
        win_rate_pct = VALUES(win_rate_pct),
        total_buy_amount = VALUES(total_buy_amount),
        total_sell_amount = VALUES(total_sell_amount),
        realized_profit_loss = VALUES(realized_profit_loss),
        avg_realized_profit_loss_pct = VALUES(avg_realized_profit_loss_pct),
        avg_win_pct = VALUES(avg_win_pct),
        avg_loss_pct = VALUES(avg_loss_pct),
        best_stock_code = VALUES(best_stock_code),
        worst_stock_code = VALUES(worst_stock_code),
        best_strategy_source = VALUES(best_strategy_source),
        performance_level = VALUES(performance_level)
      `,
      [
        userId,
        snapshotDate,
        Number(t.total_trades || 0),
        Number(t.buy_trades || 0),
        Number(t.sell_trades || 0),
        closedTrades,
        winningTrades,
        Number(r.losing_trades || 0),
        Number(r.flat_trades || 0),
        winRate,
        round(t.total_buy_amount || 0, 2),
        round(t.total_sell_amount || 0, 2),
        realizedPnl,
        round(r.avg_realized_profit_loss_pct || 0, 4),
        round(r.avg_win_pct || 0, 4),
        round(r.avg_loss_pct || 0, 4),
        bestRows?.[0]?.stock_code || null,
        worstRows?.[0]?.stock_code || null,
        strategyRows?.[0]?.strategy_source || null,
        getPerformanceLevel(winRate, realizedPnl),
      ],
    );
    snapshotCount += 1;
  }

  return { snapshotCount, userCount: userRows.length };
}

export async function generateTradePerformance() {
  const conn = await pool.getConnection();
  try {
    for (const tableName of ["user_trades", "user_realized_trades", "user_performance_snapshots"]) {
      if (!(await tableExists(conn, tableName))) {
        throw new Error(`缺少資料表 ${tableName}，請先執行 npm run trade:setup`);
      }
    }
    const snapshotDate = await getSnapshotDate(conn);
    const realized = await generateRealizedRows(conn);
    const snapshots = await generatePerformanceSnapshots(conn, snapshotDate);
    return { snapshotDate, ...realized, ...snapshots };
  } finally {
    conn.release();
  }
}

async function main() {
  try {
    console.log("====================================");
    console.log("Stock Radar V2.2 交易績效產生");
    console.log("====================================");
    const result = await generateTradePerformance();
    console.log(`績效日期：${result.snapshotDate}`);
    console.log(`檢查賣出紀錄：${result.sellCount}`);
    console.log(`產生 / 更新已實現損益：${result.generatedCount}`);
    console.log(`略過賣出紀錄：${result.skippedCount}`);
    console.log(`產生 / 更新績效快照：${result.snapshotCount}`);
    console.log("結果：PASS");
  } catch (error) {
    console.error("產生 V2.2 交易績效失敗：", error.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isDirectRun) {
  main().catch((error) => {
    console.error("產生 V2.2 交易績效失敗：", error);
    process.exit(1);
  });
}
