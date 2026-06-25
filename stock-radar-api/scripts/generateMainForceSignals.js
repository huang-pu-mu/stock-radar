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

function average(values) {
  const valid = values.map((item) => toNumber(item, null)).filter((item) => item !== null);
  if (valid.length === 0) return null;
  return valid.reduce((sum, item) => sum + item, 0) / valid.length;
}

function classifyLevel(score, distributionRisk) {
  if (distributionRisk === "HIGH" && score < 70) return "RISK";
  if (score >= 82) return "STRONG";
  if (score >= 68) return "WATCH";
  if (score >= 55) return "EARLY";
  return "NEUTRAL";
}

function classifyStatus({ score, ratioChange, thousandChange, smallChange, costGap, distributionRisk }) {
  if (distributionRisk === "HIGH") return "疑似出貨風險";
  if (score >= 82 && ratioChange > 0 && smallChange < 0) return "主力低檔布局";
  if (score >= 75 && thousandChange > 0) return "千張大戶增持";
  if (score >= 68 && ratioChange > 0) return "籌碼集中上升";
  if (costGap !== null && costGap <= -5 && ratioChange > 0) return "主力成本上方觀察";
  if (score >= 55) return "主力觀察";
  return "中性觀察";
}

function classifyTrend({ ratioChange, thousandChange, smallChange, distributionRisk, lockChipSignal }) {
  if (distributionRisk === "HIGH") return "DISTRIBUTING";
  if (lockChipSignal === "LOCKING") return "LOCKING";
  if (ratioChange > 0.2 || thousandChange > 0.1 || smallChange < -50) return "ACCUMULATING";
  return "NEUTRAL";
}

async function tableExists(conn, tableName) {
  const rows = await conn.query(
    `SELECT COUNT(*) AS table_count FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [tableName],
  );
  return Number(rows?.[0]?.table_count || 0) > 0;
}

async function getLatestDate(conn, table, column, fallback = null) {
  try {
    const rows = await conn.query(`SELECT DATE_FORMAT(MAX(${column}), '%Y-%m-%d') AS latest_date FROM ${table}`);
    return rows?.[0]?.latest_date || fallback;
  } catch {
    return fallback;
  }
}

async function getPriceWindow(conn, stockCode, tradeDate) {
  return await conn.query(
    `
    SELECT
      DATE_FORMAT(trade_date, '%Y-%m-%d') AS trade_date,
      close_price,
      volume
    FROM daily_prices
    WHERE stock_code = ?
      AND trade_date <= ?
    ORDER BY trade_date DESC
    LIMIT 20
    `,
    [stockCode, tradeDate],
  );
}

function estimateCost(prices) {
  let amount = 0;
  let volume = 0;
  for (const row of prices) {
    const close = toNumber(row.close_price, null);
    const vol = toNumber(row.volume, 0);
    if (close !== null && vol > 0) {
      amount += close * vol;
      volume += vol;
    }
  }
  return volume > 0 ? amount / volume : null;
}

function volumeRatio5(prices) {
  if (prices.length < 2) return null;
  const latestVolume = toNumber(prices[0]?.volume, null);
  const avg = average(prices.slice(1, 6).map((row) => row.volume));
  if (latestVolume === null || !avg) return null;
  return latestVolume / avg;
}

function analyze(row, prices) {
  const closePrice = toNumber(row.close_price, toNumber(prices?.[0]?.close_price, null));
  const cost = estimateCost(prices);
  const costGap = closePrice !== null && cost ? ((closePrice - cost) / cost) * 100 : null;
  const volumeRatio = volumeRatio5(prices);
  const largeRatio = toNumber(row.large_holder_ratio, 0);
  const prevLargeRatio = toNumber(row.prev_large_holder_ratio, largeRatio);
  const thousandRatio = toNumber(row.thousand_lot_ratio, 0);
  const prevThousandRatio = toNumber(row.prev_thousand_lot_ratio, thousandRatio);
  const largeCount = toNumber(row.large_holder_count, 0);
  const prevLargeCount = toNumber(row.prev_large_holder_count, largeCount);
  const smallCount = toNumber(row.small_holder_count, 0);
  const prevSmallCount = toNumber(row.prev_small_holder_count, smallCount);
  const ratioChange = largeRatio - prevLargeRatio;
  const thousandChange = thousandRatio - prevThousandRatio;
  const largeCountChange = Math.trunc(largeCount - prevLargeCount);
  const smallChange = Math.trunc(smallCount - prevSmallCount);
  const foreignNet = toNumber(row.foreign_net_buy, 0);
  const trustNet = toNumber(row.investment_trust_net_buy, 0);
  const dealerNet = toNumber(row.dealer_net_buy, 0);
  const chipScore = toNumber(row.chip_score, 50);
  const breakoutScore = toNumber(row.breakout_score, null);

  let score = 42;
  const tags = [];

  score += clamp((chipScore - 50) * 0.18, -8, 10);
  if (breakoutScore !== null) score += clamp((breakoutScore - 50) * 0.12, -5, 8);

  if (ratioChange > 0) { score += clamp(ratioChange * 6, 2, 18); tags.push("大戶比重上升"); }
  if (ratioChange < -0.25) { score += clamp(ratioChange * 8, -18, -2); tags.push("大戶比重下降"); }
  if (thousandChange > 0) { score += clamp(thousandChange * 8, 2, 15); tags.push("千張大戶增加"); }
  if (largeCountChange > 0) { score += clamp(largeCountChange * 0.2, 1, 8); tags.push("大戶人數增加"); }
  if (smallChange < 0) { score += clamp(Math.abs(smallChange) * 0.03, 1, 10); tags.push("散戶人數下降"); }
  if (smallChange > 300) { score -= clamp(smallChange * 0.015, 2, 12); tags.push("散戶人數增加"); }

  const legalNet = foreignNet + trustNet + dealerNet;
  if (legalNet > 0) { score += clamp(Math.log10(legalNet + 10) * 2.2, 1, 10); tags.push("法人同步偏多"); }
  if (legalNet < -500) { score -= clamp(Math.log10(Math.abs(legalNet) + 10) * 2, 2, 10); tags.push("法人賣壓"); }

  if (costGap !== null) {
    if (costGap >= -8 && costGap <= 8 && ratioChange > 0) { score += 8; tags.push("現價接近主力成本"); }
    if (costGap < -8 && ratioChange > 0) { score += 4; tags.push("低於估算成本"); }
    if (costGap > 18) { score -= 8; tags.push("遠高於估算成本"); }
  }

  if (volumeRatio !== null && volumeRatio >= 1.5 && ratioChange > 0) { score += 6; tags.push("量能配合"); }

  let distributionRisk = "LOW";
  if ((ratioChange < -0.4 && smallChange > 150) || (costGap !== null && costGap > 20 && ratioChange < 0)) {
    distributionRisk = "HIGH";
    score -= 14;
  } else if (ratioChange < -0.15 || smallChange > 150) {
    distributionRisk = "MEDIUM";
    score -= 5;
  }

  let lockChipSignal = "NEUTRAL";
  if (largeRatio >= 45 || thousandRatio >= 25) {
    lockChipSignal = "LOCKING";
    score += 5;
    tags.push("籌碼鎖定度高");
  }

  let accumulationSignal = "NEUTRAL";
  if (ratioChange > 0.2 && smallChange < 0) accumulationSignal = "ACCUMULATING";
  else if (ratioChange > 0 || thousandChange > 0) accumulationSignal = "IMPROVING";
  else if (distributionRisk !== "LOW") accumulationSignal = "WEAKENING";

  const mainForceScore = round(clamp(score, 0, 100), 2);
  const level = classifyLevel(mainForceScore, distributionRisk);
  const status = classifyStatus({ score: mainForceScore, ratioChange, thousandChange, smallChange, costGap, distributionRisk });
  const trend = classifyTrend({ ratioChange, thousandChange, smallChange, distributionRisk, lockChipSignal });
  const uniqueTags = tags.length ? [...new Set(tags)] : [status];

  return {
    main_force_score: mainForceScore,
    main_force_level: level,
    main_force_status: status,
    main_force_trend: trend,
    estimated_main_force_cost: round(cost, 2),
    close_price: round(closePrice, 2),
    cost_gap_percent: round(costGap, 4),
    large_holder_ratio: round(largeRatio, 4),
    large_holder_ratio_change: round(ratioChange, 4),
    thousand_lot_ratio: round(thousandRatio, 4),
    thousand_lot_ratio_change: round(thousandChange, 4),
    large_holder_count: Math.trunc(largeCount || 0),
    large_holder_count_change: largeCountChange,
    small_holder_count: Math.trunc(smallCount || 0),
    small_holder_count_change: smallChange,
    foreign_net_buy: Math.trunc(foreignNet || 0),
    investment_trust_net_buy: Math.trunc(trustNet || 0),
    dealer_net_buy: Math.trunc(dealerNet || 0),
    volume_ratio_5: round(volumeRatio, 4),
    breakout_score: breakoutScore === null ? null : round(breakoutScore, 2),
    chip_score: round(chipScore, 2),
    accumulation_signal: accumulationSignal,
    lock_chip_signal: lockChipSignal,
    distribution_risk: distributionRisk,
    reason_summary: `${status}｜${uniqueTags.slice(0, 5).join("、")}｜主力分數 ${mainForceScore}`,
  };
}

async function getRows(conn, tradeDate, holderDate, hasMajorHolders, hasBreakout) {
  if (hasMajorHolders && holderDate) {
    return await conn.query(
      `
      SELECT
        s.stock_code,
        s.stock_name,
        s.market_type,
        s.industry,
        DATE_FORMAT(m.data_date, '%Y-%m-%d') AS source_data_date,
        m.large_holder_ratio,
        m.thousand_lot_ratio,
        m.large_holder_count,
        m.small_holder_count,
        prev.large_holder_ratio AS prev_large_holder_ratio,
        prev.thousand_lot_ratio AS prev_thousand_lot_ratio,
        prev.large_holder_count AS prev_large_holder_count,
        prev.small_holder_count AS prev_small_holder_count,
        c.chip_score,
        p.close_price,
        COALESCE(i.foreign_net, 0) AS foreign_net_buy,
        COALESCE(i.investment_trust_net, 0) AS investment_trust_net_buy,
        COALESCE(i.dealer_net, 0) AS dealer_net_buy,
        ${hasBreakout ? "b.breakout_score" : "NULL AS breakout_score"}
      FROM major_holder_stats m
      INNER JOIN stocks s ON m.stock_code = s.stock_code
      LEFT JOIN major_holder_stats prev
        ON prev.stock_code = m.stock_code
       AND prev.data_date = (
          SELECT MAX(p2.data_date)
          FROM major_holder_stats p2
          WHERE p2.stock_code = m.stock_code
            AND p2.data_date < m.data_date
       )
      LEFT JOIN chip_scores c
        ON c.stock_code = m.stock_code
       AND c.trade_date = ?
      LEFT JOIN daily_prices p
        ON p.stock_code = m.stock_code
       AND p.trade_date = ?
      LEFT JOIN institutional_trades i
        ON i.stock_code = m.stock_code
       AND i.trade_date = ?
      ${hasBreakout ? "LEFT JOIN technical_breakout_signals b ON b.stock_code = m.stock_code AND b.trade_date = ?" : ""}
      WHERE m.data_date = ?
      ORDER BY s.market_type, s.stock_code
      `,
      hasBreakout ? [tradeDate, tradeDate, tradeDate, tradeDate, holderDate] : [tradeDate, tradeDate, tradeDate, holderDate],
    );
  }

  return await conn.query(
    `
    SELECT
      s.stock_code,
      s.stock_name,
      s.market_type,
      s.industry,
      NULL AS source_data_date,
      NULL AS large_holder_ratio,
      NULL AS thousand_lot_ratio,
      NULL AS large_holder_count,
      NULL AS small_holder_count,
      NULL AS prev_large_holder_ratio,
      NULL AS prev_thousand_lot_ratio,
      NULL AS prev_large_holder_count,
      NULL AS prev_small_holder_count,
      c.chip_score,
      p.close_price,
      COALESCE(i.foreign_net, 0) AS foreign_net_buy,
      COALESCE(i.investment_trust_net, 0) AS investment_trust_net_buy,
      COALESCE(i.dealer_net, 0) AS dealer_net_buy,
      ${hasBreakout ? "b.breakout_score" : "NULL AS breakout_score"}
    FROM chip_scores c
    INNER JOIN stocks s ON c.stock_code = s.stock_code
    LEFT JOIN daily_prices p ON p.stock_code = c.stock_code AND p.trade_date = c.trade_date
    LEFT JOIN institutional_trades i ON i.stock_code = c.stock_code AND i.trade_date = c.trade_date
    ${hasBreakout ? "LEFT JOIN technical_breakout_signals b ON b.stock_code = c.stock_code AND b.trade_date = c.trade_date" : ""}
    WHERE c.trade_date = ?
    ORDER BY s.market_type, s.stock_code
    `,
    [tradeDate],
  );
}

async function writeSummary(conn, tradeDate) {
  const marketRows = await conn.query(
    `SELECT market_type FROM main_force_signals WHERE trade_date = ? GROUP BY market_type ORDER BY market_type`,
    [tradeDate],
  );
  const markets = ["全部", ...marketRows.map((row) => row.market_type || "其他")];

  for (const market of markets) {
    const params = [tradeDate];
    let condition = "";
    if (market !== "全部") {
      condition = "AND market_type = ?";
      params.push(market);
    }

    const rows = await conn.query(
      `
      SELECT
        COUNT(*) AS total_count,
        SUM(CASE WHEN main_force_level = 'STRONG' THEN 1 ELSE 0 END) AS strong_count,
        SUM(CASE WHEN main_force_level = 'WATCH' THEN 1 ELSE 0 END) AS watch_count,
        SUM(CASE WHEN main_force_level = 'EARLY' THEN 1 ELSE 0 END) AS early_count,
        SUM(CASE WHEN main_force_level = 'RISK' THEN 1 ELSE 0 END) AS risk_count,
        ROUND(AVG(main_force_score), 2) AS avg_main_force_score,
        MAX(main_force_score) AS top_main_force_score
      FROM main_force_signals
      WHERE trade_date = ? ${condition}
      `,
      params,
    );

    const topRows = await conn.query(
      `
      SELECT stock_code, stock_name
      FROM main_force_signals
      WHERE trade_date = ? ${condition}
      ORDER BY main_force_score DESC, stock_code ASC
      LIMIT 1
      `,
      params,
    );

    const row = rows[0] || {};
    const top = topRows[0] || {};
    await conn.query(
      `
      INSERT INTO main_force_summaries (
        trade_date, market_type, total_count, strong_count, watch_count, early_count, risk_count,
        avg_main_force_score, top_main_force_score, top_stock_code, top_stock_name, generated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
      ON DUPLICATE KEY UPDATE
        total_count = VALUES(total_count),
        strong_count = VALUES(strong_count),
        watch_count = VALUES(watch_count),
        early_count = VALUES(early_count),
        risk_count = VALUES(risk_count),
        avg_main_force_score = VALUES(avg_main_force_score),
        top_main_force_score = VALUES(top_main_force_score),
        top_stock_code = VALUES(top_stock_code),
        top_stock_name = VALUES(top_stock_name),
        generated_at = NOW(),
        updated_at = NOW()
      `,
      [
        tradeDate,
        market,
        Number(row.total_count || 0),
        Number(row.strong_count || 0),
        Number(row.watch_count || 0),
        Number(row.early_count || 0),
        Number(row.risk_count || 0),
        round(row.avg_main_force_score, 2),
        round(row.top_main_force_score, 2),
        top.stock_code || null,
        top.stock_name || null,
      ],
    );
  }
}

async function main() {
  const targetArg = process.argv[2];
  const conn = await pool.getConnection();
  let updated = 0;
  let skipped = 0;

  try {
    console.log("====================================");
    console.log("Stock Radar V1.8 主力籌碼訊號產生");
    console.log("====================================");

    const hasMajorHolders = await tableExists(conn, "major_holder_stats");
    const hasBreakout = await tableExists(conn, "technical_breakout_signals");
    const latestPriceDate = await getLatestDate(conn, "daily_prices", "trade_date");
    const latestChipDate = await getLatestDate(conn, "chip_scores", "trade_date", latestPriceDate);
    const tradeDate = targetArg || latestChipDate || latestPriceDate;
    const holderDate = hasMajorHolders ? await getLatestDate(conn, "major_holder_stats", "data_date") : null;

    if (!tradeDate) {
      throw new Error("找不到 daily_prices 或 chip_scores 最新日期，請先匯入每日行情並計算分數。");
    }

    console.log(`分析日期：${tradeDate}`);
    console.log(`集保資料日期：${holderDate || "無，使用 chip_scores / 法人資料中性 fallback"}`);

    const rows = await getRows(conn, tradeDate, holderDate, hasMajorHolders, hasBreakout);
    await conn.query(`DELETE FROM main_force_signals WHERE trade_date = ?`, [tradeDate]);

    for (const row of rows) {
      try {
        const prices = await getPriceWindow(conn, row.stock_code, tradeDate);
        const signal = analyze(row, prices);
        await conn.query(
          `
          INSERT INTO main_force_signals (
            trade_date, source_data_date, stock_code, stock_name, market_type, industry,
            main_force_score, main_force_level, main_force_status, main_force_trend,
            estimated_main_force_cost, close_price, cost_gap_percent,
            large_holder_ratio, large_holder_ratio_change, thousand_lot_ratio, thousand_lot_ratio_change,
            large_holder_count, large_holder_count_change, small_holder_count, small_holder_count_change,
            foreign_net_buy, investment_trust_net_buy, dealer_net_buy, volume_ratio_5,
            breakout_score, chip_score, accumulation_signal, lock_chip_signal, distribution_risk,
            reason_summary
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            source_data_date = VALUES(source_data_date),
            stock_name = VALUES(stock_name),
            market_type = VALUES(market_type),
            industry = VALUES(industry),
            main_force_score = VALUES(main_force_score),
            main_force_level = VALUES(main_force_level),
            main_force_status = VALUES(main_force_status),
            main_force_trend = VALUES(main_force_trend),
            estimated_main_force_cost = VALUES(estimated_main_force_cost),
            close_price = VALUES(close_price),
            cost_gap_percent = VALUES(cost_gap_percent),
            large_holder_ratio = VALUES(large_holder_ratio),
            large_holder_ratio_change = VALUES(large_holder_ratio_change),
            thousand_lot_ratio = VALUES(thousand_lot_ratio),
            thousand_lot_ratio_change = VALUES(thousand_lot_ratio_change),
            large_holder_count = VALUES(large_holder_count),
            large_holder_count_change = VALUES(large_holder_count_change),
            small_holder_count = VALUES(small_holder_count),
            small_holder_count_change = VALUES(small_holder_count_change),
            foreign_net_buy = VALUES(foreign_net_buy),
            investment_trust_net_buy = VALUES(investment_trust_net_buy),
            dealer_net_buy = VALUES(dealer_net_buy),
            volume_ratio_5 = VALUES(volume_ratio_5),
            breakout_score = VALUES(breakout_score),
            chip_score = VALUES(chip_score),
            accumulation_signal = VALUES(accumulation_signal),
            lock_chip_signal = VALUES(lock_chip_signal),
            distribution_risk = VALUES(distribution_risk),
            reason_summary = VALUES(reason_summary),
            updated_at = NOW()
          `,
          [
            tradeDate,
            row.source_data_date || holderDate || null,
            row.stock_code,
            row.stock_name,
            row.market_type,
            row.industry,
            signal.main_force_score,
            signal.main_force_level,
            signal.main_force_status,
            signal.main_force_trend,
            signal.estimated_main_force_cost,
            signal.close_price,
            signal.cost_gap_percent,
            signal.large_holder_ratio,
            signal.large_holder_ratio_change,
            signal.thousand_lot_ratio,
            signal.thousand_lot_ratio_change,
            signal.large_holder_count,
            signal.large_holder_count_change,
            signal.small_holder_count,
            signal.small_holder_count_change,
            signal.foreign_net_buy,
            signal.investment_trust_net_buy,
            signal.dealer_net_buy,
            signal.volume_ratio_5,
            signal.breakout_score,
            signal.chip_score,
            signal.accumulation_signal,
            signal.lock_chip_signal,
            signal.distribution_risk,
            signal.reason_summary,
          ],
        );
        updated += 1;
      } catch (error) {
        skipped += 1;
        if (skipped <= 5) console.warn(`略過 ${row.stock_code}：${error.message}`);
      }
    }

    await writeSummary(conn, tradeDate);

    const stats = await conn.query(
      `
      SELECT
        MIN(main_force_score) AS min_score,
        MAX(main_force_score) AS max_score,
        ROUND(AVG(main_force_score), 2) AS avg_score,
        SUM(CASE WHEN main_force_level = 'STRONG' THEN 1 ELSE 0 END) AS strong_count,
        SUM(CASE WHEN main_force_level = 'WATCH' THEN 1 ELSE 0 END) AS watch_count,
        SUM(CASE WHEN main_force_level = 'EARLY' THEN 1 ELSE 0 END) AS early_count,
        SUM(CASE WHEN main_force_level = 'RISK' THEN 1 ELSE 0 END) AS risk_count
      FROM main_force_signals
      WHERE trade_date = ?
      `,
      [tradeDate],
    );
    const stat = stats[0] || {};

    console.log(`更新個股數：${updated}`);
    console.log(`略過個股數：${skipped}`);
    console.log(`主力分數區間：${round(stat.min_score, 2)} ～ ${round(stat.max_score, 2)}`);
    console.log(`平均主力分數：${round(stat.avg_score, 2)}`);
    console.log(`等級統計：STRONG ${Number(stat.strong_count || 0)}｜WATCH ${Number(stat.watch_count || 0)}｜EARLY ${Number(stat.early_count || 0)}｜RISK ${Number(stat.risk_count || 0)}`);
    console.log("結果：PASS");
  } finally {
    conn.release();
    await pool.end();
  }
}

main().catch(async (error) => {
  console.error("V1.8 主力籌碼訊號產生失敗：", error.message);
  try { await pool.end(); } catch {}
  process.exit(1);
});
