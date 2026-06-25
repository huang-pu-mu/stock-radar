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

function pctChange(current, previous) {
  const curr = toNumber(current, null);
  const prev = toNumber(previous, null);
  if (curr === null || prev === null || prev === 0) return null;
  return ((curr - prev) / prev) * 100;
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

function classifyLevel(score, distributionRisk) {
  if (distributionRisk === "HIGH" && score < 72) return "RISK";
  if (score >= 82) return "STRONG";
  if (score >= 68) return "WATCH";
  if (score >= 55) return "EARLY";
  return "NEUTRAL";
}

function analyze(row) {
  const largeRatio = toNumber(row.large_holder_ratio, 0);
  const prev4LargeRatio = toNumber(row.prev4_large_holder_ratio, largeRatio);
  const prev8LargeRatio = toNumber(row.prev8_large_holder_ratio, prev4LargeRatio);
  const thousandRatio = toNumber(row.thousand_lot_ratio, 0);
  const prev4ThousandRatio = toNumber(row.prev4_thousand_lot_ratio, thousandRatio);
  const prev8ThousandRatio = toNumber(row.prev8_thousand_lot_ratio, prev4ThousandRatio);
  const largeCount = toNumber(row.large_holder_count, 0);
  const prev4LargeCount = toNumber(row.prev4_large_holder_count, largeCount);
  const prev8LargeCount = toNumber(row.prev8_large_holder_count, prev4LargeCount);
  const smallCount = toNumber(row.small_holder_count, 0);
  const prev4SmallCount = toNumber(row.prev4_small_holder_count, smallCount);
  const prev8SmallCount = toNumber(row.prev8_small_holder_count, prev4SmallCount);
  const closePrice = toNumber(row.close_price, null);
  const prev4Close = toNumber(row.prev4_close_price, null);
  const prev8Close = toNumber(row.prev8_close_price, null);
  const chipScore = toNumber(row.chip_score, 50);
  const mainForceScore = toNumber(row.main_force_score, null);

  const large4 = largeRatio - prev4LargeRatio;
  const large8 = largeRatio - prev8LargeRatio;
  const thousand4 = thousandRatio - prev4ThousandRatio;
  const thousand8 = thousandRatio - prev8ThousandRatio;
  const largeCount4 = Math.trunc(largeCount - prev4LargeCount);
  const largeCount8 = Math.trunc(largeCount - prev8LargeCount);
  const small4 = Math.trunc(smallCount - prev4SmallCount);
  const small8 = Math.trunc(smallCount - prev8SmallCount);
  const price4 = pctChange(closePrice, prev4Close);
  const price8 = pctChange(closePrice, prev8Close);

  let score = 44;
  const tags = [];

  score += clamp((chipScore - 50) * 0.12, -6, 8);
  if (mainForceScore !== null) score += clamp((mainForceScore - 50) * 0.18, -8, 12);

  if (large4 > 0) { score += clamp(large4 * 8, 2, 20); tags.push("4週大戶比重上升"); }
  if (large8 > 0) { score += clamp(large8 * 5, 1, 15); tags.push("8週大戶比重上升"); }
  if (large4 < -0.2) { score += clamp(large4 * 10, -18, -2); tags.push("4週大戶比重下降"); }
  if (large8 < -0.4) { score += clamp(large8 * 7, -16, -2); tags.push("8週大戶比重下降"); }

  if (thousand4 > 0) { score += clamp(thousand4 * 10, 2, 18); tags.push("千張大戶4週增加"); }
  if (thousand8 > 0) { score += clamp(thousand8 * 6, 1, 12); tags.push("千張大戶8週增加"); }
  if (thousand4 < -0.15) { score += clamp(thousand4 * 9, -12, -2); tags.push("千張大戶4週下降"); }

  if (largeCount4 > 0) { score += clamp(largeCount4 * 0.18, 1, 8); tags.push("大戶人數4週增加"); }
  if (largeCount8 > 0) { score += clamp(largeCount8 * 0.12, 1, 6); tags.push("大戶人數8週增加"); }
  if (small4 < 0) { score += clamp(Math.abs(small4) * 0.025, 1, 12); tags.push("散戶4週下降"); }
  if (small8 < 0) { score += clamp(Math.abs(small8) * 0.016, 1, 10); tags.push("散戶8週下降"); }
  if (small4 > 180) { score -= clamp(small4 * 0.018, 2, 13); tags.push("散戶4週增加"); }
  if (small8 > 360) { score -= clamp(small8 * 0.012, 2, 10); tags.push("散戶8週增加"); }

  let retailPressure = "NEUTRAL";
  if (small4 > 300 || small8 > 600) retailPressure = "HIGH";
  else if (small4 > 120 || small8 > 300) retailPressure = "MEDIUM";
  else if (small4 < 0 || small8 < 0) retailPressure = "LOW";

  let distributionRisk = "LOW";
  if ((large4 < -0.45 && small4 > 150) || (price4 !== null && price4 > 15 && large4 < 0)) {
    distributionRisk = "HIGH";
    score -= 15;
    tags.push("大戶減少且散戶增加");
  } else if (large4 < -0.2 || large8 < -0.5 || small4 > 160) {
    distributionRisk = "MEDIUM";
    score -= 6;
  }

  let divergenceSignal = "";
  if (large4 > 0.25 && price4 !== null && price4 <= 5) {
    score += 7;
    divergenceSignal = "大戶增加但股價未漲";
    tags.push("可能低檔布局");
  } else if (large4 < -0.25 && price4 !== null && price4 > 8) {
    score -= 8;
    divergenceSignal = "股價上漲但大戶下降";
    tags.push("可能逢高調節");
  } else if (large8 > 0.6 && small8 < 0) {
    divergenceSignal = "中期籌碼集中";
  }

  let concentrationTrend = "NEUTRAL";
  if ((large4 > 0.2 || large8 > 0.5 || thousand4 > 0.15) && small4 <= 150) concentrationTrend = "UP";
  if (distributionRisk !== "LOW" || large4 < -0.25 || small4 > 250) concentrationTrend = "DOWN";

  let concentrationSignal = "NEUTRAL";
  if (concentrationTrend === "UP" && (largeRatio >= 45 || thousandRatio >= 22)) concentrationSignal = "LOCKING";
  else if (concentrationTrend === "UP") concentrationSignal = "ACCUMULATING";
  else if (concentrationTrend === "DOWN") concentrationSignal = "LOOSENING";

  let status = "大戶趨勢觀察";
  if (distributionRisk === "HIGH") status = "大戶出貨風險";
  else if (large4 > 0.25 && small4 < 0 && (price4 === null || price4 <= 8)) status = "大戶低檔布局";
  else if (thousand4 > 0.15 || thousand8 > 0.3) status = "千張大戶增持";
  else if (large8 > 0.6 && small8 < 0) status = "中期籌碼集中";
  else if (large4 > 0 || small4 < 0) status = "籌碼集中上升";
  else if (large4 < 0 && small4 > 0) status = "籌碼集中轉弱";

  score = round(clamp(score, 0, 100), 2);
  const level = classifyLevel(score, distributionRisk);

  return {
    big_holder_trend_score: score,
    big_holder_level: level,
    big_holder_status: status,
    concentration_trend: concentrationTrend,
    concentration_signal: concentrationSignal,
    large_holder_ratio: round(largeRatio, 4),
    large_holder_ratio_4w_change: round(large4, 4),
    large_holder_ratio_8w_change: round(large8, 4),
    thousand_lot_ratio: round(thousandRatio, 4),
    thousand_lot_ratio_4w_change: round(thousand4, 4),
    thousand_lot_ratio_8w_change: round(thousand8, 4),
    large_holder_count: Math.trunc(largeCount),
    large_holder_count_4w_change: Math.trunc(largeCount4),
    large_holder_count_8w_change: Math.trunc(largeCount8),
    small_holder_count: Math.trunc(smallCount),
    small_holder_count_4w_change: Math.trunc(small4),
    small_holder_count_8w_change: Math.trunc(small8),
    retail_pressure: retailPressure,
    distribution_risk: distributionRisk,
    divergence_signal: divergenceSignal || null,
    close_price: closePrice,
    price_change_4w_percent: round(price4, 4),
    price_change_8w_percent: round(price8, 4),
    chip_score: round(chipScore, 2),
    main_force_score: mainForceScore === null ? null : round(mainForceScore, 2),
    reason_summary: tags.slice(0, 8).join("、") || "大戶持股趨勢中性",
  };
}

async function getRows(conn, tradeDate, holderDate, hasMainForce) {
  if (!holderDate) {
    return await conn.query(
      `
      SELECT
        s.stock_code, s.stock_name, s.market_type, s.industry,
        NULL AS source_data_date,
        NULL AS large_holder_ratio, NULL AS prev4_large_holder_ratio, NULL AS prev8_large_holder_ratio,
        NULL AS thousand_lot_ratio, NULL AS prev4_thousand_lot_ratio, NULL AS prev8_thousand_lot_ratio,
        NULL AS large_holder_count, NULL AS prev4_large_holder_count, NULL AS prev8_large_holder_count,
        NULL AS small_holder_count, NULL AS prev4_small_holder_count, NULL AS prev8_small_holder_count,
        c.chip_score, p.close_price, NULL AS prev4_close_price, NULL AS prev8_close_price,
        ${hasMainForce ? "mf.main_force_score" : "NULL AS main_force_score"}
      FROM chip_scores c
      INNER JOIN stocks s ON c.stock_code = s.stock_code
      LEFT JOIN daily_prices p ON p.stock_code = c.stock_code AND p.trade_date = c.trade_date
      ${hasMainForce ? "LEFT JOIN main_force_signals mf ON mf.stock_code = c.stock_code AND mf.trade_date = c.trade_date" : ""}
      WHERE c.trade_date = ?
      ORDER BY s.market_type, s.stock_code
      `,
      [tradeDate],
    );
  }

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
      p4m.large_holder_ratio AS prev4_large_holder_ratio,
      p4m.thousand_lot_ratio AS prev4_thousand_lot_ratio,
      p4m.large_holder_count AS prev4_large_holder_count,
      p4m.small_holder_count AS prev4_small_holder_count,
      p8m.large_holder_ratio AS prev8_large_holder_ratio,
      p8m.thousand_lot_ratio AS prev8_thousand_lot_ratio,
      p8m.large_holder_count AS prev8_large_holder_count,
      p8m.small_holder_count AS prev8_small_holder_count,
      c.chip_score,
      p.close_price,
      p4.close_price AS prev4_close_price,
      p8.close_price AS prev8_close_price,
      ${hasMainForce ? "mf.main_force_score" : "NULL AS main_force_score"}
    FROM major_holder_stats m
    INNER JOIN stocks s ON m.stock_code = s.stock_code
    LEFT JOIN major_holder_stats p4m
      ON p4m.stock_code = m.stock_code
     AND p4m.data_date = (
        SELECT MAX(x.data_date)
        FROM major_holder_stats x
        WHERE x.stock_code = m.stock_code
          AND x.data_date <= DATE_SUB(m.data_date, INTERVAL 28 DAY)
     )
    LEFT JOIN major_holder_stats p8m
      ON p8m.stock_code = m.stock_code
     AND p8m.data_date = (
        SELECT MAX(x.data_date)
        FROM major_holder_stats x
        WHERE x.stock_code = m.stock_code
          AND x.data_date <= DATE_SUB(m.data_date, INTERVAL 56 DAY)
     )
    LEFT JOIN chip_scores c ON c.stock_code = m.stock_code AND c.trade_date = ?
    LEFT JOIN daily_prices p ON p.stock_code = m.stock_code AND p.trade_date = ?
    LEFT JOIN daily_prices p4
      ON p4.stock_code = m.stock_code
     AND p4.trade_date = (
        SELECT MAX(px.trade_date)
        FROM daily_prices px
        WHERE px.stock_code = m.stock_code
          AND px.trade_date <= DATE_SUB(?, INTERVAL 28 DAY)
     )
    LEFT JOIN daily_prices p8
      ON p8.stock_code = m.stock_code
     AND p8.trade_date = (
        SELECT MAX(px.trade_date)
        FROM daily_prices px
        WHERE px.stock_code = m.stock_code
          AND px.trade_date <= DATE_SUB(?, INTERVAL 56 DAY)
     )
    ${hasMainForce ? "LEFT JOIN main_force_signals mf ON mf.stock_code = m.stock_code AND mf.trade_date = ?" : ""}
    WHERE m.data_date = ?
    ORDER BY s.market_type, s.stock_code
    `,
    hasMainForce ? [tradeDate, tradeDate, tradeDate, tradeDate, tradeDate, holderDate] : [tradeDate, tradeDate, tradeDate, tradeDate, holderDate],
  );
}

async function writeSummary(conn, tradeDate, holderDate) {
  const marketRows = await conn.query(
    `SELECT market_type FROM big_holder_trend_signals WHERE trade_date = ? GROUP BY market_type ORDER BY market_type`,
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
        SUM(CASE WHEN big_holder_level = 'STRONG' THEN 1 ELSE 0 END) AS strong_count,
        SUM(CASE WHEN big_holder_level = 'WATCH' THEN 1 ELSE 0 END) AS watch_count,
        SUM(CASE WHEN big_holder_level = 'EARLY' THEN 1 ELSE 0 END) AS early_count,
        SUM(CASE WHEN big_holder_level = 'RISK' THEN 1 ELSE 0 END) AS risk_count,
        SUM(CASE WHEN concentration_signal IN ('ACCUMULATING', 'LOCKING') THEN 1 ELSE 0 END) AS accumulating_count,
        SUM(CASE WHEN concentration_signal = 'LOOSENING' THEN 1 ELSE 0 END) AS loosen_count,
        ROUND(AVG(big_holder_trend_score), 2) AS avg_big_holder_trend_score,
        MAX(big_holder_trend_score) AS top_big_holder_trend_score
      FROM big_holder_trend_signals
      WHERE trade_date = ? ${condition}
      `,
      params,
    );

    const topRows = await conn.query(
      `
      SELECT stock_code, stock_name
      FROM big_holder_trend_signals
      WHERE trade_date = ? ${condition}
      ORDER BY big_holder_trend_score DESC, stock_code ASC
      LIMIT 1
      `,
      params,
    );

    const row = rows[0] || {};
    const top = topRows[0] || {};
    await conn.query(
      `
      INSERT INTO big_holder_trend_summaries (
        trade_date, source_data_date, market_type, total_count, strong_count, watch_count, early_count, risk_count,
        accumulating_count, loosen_count, avg_big_holder_trend_score, top_big_holder_trend_score,
        top_stock_code, top_stock_name, generated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
      ON DUPLICATE KEY UPDATE
        source_data_date = VALUES(source_data_date),
        total_count = VALUES(total_count),
        strong_count = VALUES(strong_count),
        watch_count = VALUES(watch_count),
        early_count = VALUES(early_count),
        risk_count = VALUES(risk_count),
        accumulating_count = VALUES(accumulating_count),
        loosen_count = VALUES(loosen_count),
        avg_big_holder_trend_score = VALUES(avg_big_holder_trend_score),
        top_big_holder_trend_score = VALUES(top_big_holder_trend_score),
        top_stock_code = VALUES(top_stock_code),
        top_stock_name = VALUES(top_stock_name),
        generated_at = NOW(),
        updated_at = NOW()
      `,
      [
        tradeDate,
        holderDate || null,
        market,
        Number(row.total_count || 0),
        Number(row.strong_count || 0),
        Number(row.watch_count || 0),
        Number(row.early_count || 0),
        Number(row.risk_count || 0),
        Number(row.accumulating_count || 0),
        Number(row.loosen_count || 0),
        round(row.avg_big_holder_trend_score, 2),
        round(row.top_big_holder_trend_score, 2),
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
    console.log("Stock Radar V1.9 大戶持股趨勢訊號產生");
    console.log("====================================");

    const hasMajorHolders = await tableExists(conn, "major_holder_stats");
    const hasMainForce = await tableExists(conn, "main_force_signals");
    const latestPriceDate = await getLatestDate(conn, "daily_prices", "trade_date");
    const latestChipDate = await getLatestDate(conn, "chip_scores", "trade_date", latestPriceDate);
    const tradeDate = targetArg || latestChipDate || latestPriceDate;

    if (!tradeDate) {
      throw new Error("找不到 daily_prices 或 chip_scores 最新日期，請先匯入每日行情並計算分數。");
    }

    const holderDate = hasMajorHolders
      ? await getLatestDate(conn, "major_holder_stats", "data_date", null, "WHERE data_date <= ?", [tradeDate])
      : null;

    console.log(`分析日期：${tradeDate}`);
    console.log(`集保資料日期：${holderDate || "無，使用 chip_scores 中性 fallback"}`);

    const rows = await getRows(conn, tradeDate, holderDate, hasMainForce);
    await conn.query(`DELETE FROM big_holder_trend_signals WHERE trade_date = ?`, [tradeDate]);

    for (const row of rows) {
      try {
        const signal = analyze(row);
        await conn.query(
          `
          INSERT INTO big_holder_trend_signals (
            trade_date, source_data_date, stock_code, stock_name, market_type, industry,
            big_holder_trend_score, big_holder_level, big_holder_status, concentration_trend, concentration_signal,
            large_holder_ratio, large_holder_ratio_4w_change, large_holder_ratio_8w_change,
            thousand_lot_ratio, thousand_lot_ratio_4w_change, thousand_lot_ratio_8w_change,
            large_holder_count, large_holder_count_4w_change, large_holder_count_8w_change,
            small_holder_count, small_holder_count_4w_change, small_holder_count_8w_change,
            retail_pressure, distribution_risk, divergence_signal,
            close_price, price_change_4w_percent, price_change_8w_percent,
            chip_score, main_force_score, reason_summary
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            source_data_date = VALUES(source_data_date),
            stock_name = VALUES(stock_name),
            market_type = VALUES(market_type),
            industry = VALUES(industry),
            big_holder_trend_score = VALUES(big_holder_trend_score),
            big_holder_level = VALUES(big_holder_level),
            big_holder_status = VALUES(big_holder_status),
            concentration_trend = VALUES(concentration_trend),
            concentration_signal = VALUES(concentration_signal),
            large_holder_ratio = VALUES(large_holder_ratio),
            large_holder_ratio_4w_change = VALUES(large_holder_ratio_4w_change),
            large_holder_ratio_8w_change = VALUES(large_holder_ratio_8w_change),
            thousand_lot_ratio = VALUES(thousand_lot_ratio),
            thousand_lot_ratio_4w_change = VALUES(thousand_lot_ratio_4w_change),
            thousand_lot_ratio_8w_change = VALUES(thousand_lot_ratio_8w_change),
            large_holder_count = VALUES(large_holder_count),
            large_holder_count_4w_change = VALUES(large_holder_count_4w_change),
            large_holder_count_8w_change = VALUES(large_holder_count_8w_change),
            small_holder_count = VALUES(small_holder_count),
            small_holder_count_4w_change = VALUES(small_holder_count_4w_change),
            small_holder_count_8w_change = VALUES(small_holder_count_8w_change),
            retail_pressure = VALUES(retail_pressure),
            distribution_risk = VALUES(distribution_risk),
            divergence_signal = VALUES(divergence_signal),
            close_price = VALUES(close_price),
            price_change_4w_percent = VALUES(price_change_4w_percent),
            price_change_8w_percent = VALUES(price_change_8w_percent),
            chip_score = VALUES(chip_score),
            main_force_score = VALUES(main_force_score),
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
            signal.big_holder_trend_score,
            signal.big_holder_level,
            signal.big_holder_status,
            signal.concentration_trend,
            signal.concentration_signal,
            signal.large_holder_ratio,
            signal.large_holder_ratio_4w_change,
            signal.large_holder_ratio_8w_change,
            signal.thousand_lot_ratio,
            signal.thousand_lot_ratio_4w_change,
            signal.thousand_lot_ratio_8w_change,
            signal.large_holder_count,
            signal.large_holder_count_4w_change,
            signal.large_holder_count_8w_change,
            signal.small_holder_count,
            signal.small_holder_count_4w_change,
            signal.small_holder_count_8w_change,
            signal.retail_pressure,
            signal.distribution_risk,
            signal.divergence_signal,
            signal.close_price,
            signal.price_change_4w_percent,
            signal.price_change_8w_percent,
            signal.chip_score,
            signal.main_force_score,
            signal.reason_summary,
          ],
        );
        updated += 1;
      } catch (error) {
        skipped += 1;
        if (skipped <= 5) console.warn(`略過 ${row.stock_code}：${error.message}`);
      }
    }

    await writeSummary(conn, tradeDate, holderDate);

    const stats = await conn.query(
      `
      SELECT
        MIN(big_holder_trend_score) AS min_score,
        MAX(big_holder_trend_score) AS max_score,
        ROUND(AVG(big_holder_trend_score), 2) AS avg_score,
        SUM(CASE WHEN big_holder_level = 'STRONG' THEN 1 ELSE 0 END) AS strong_count,
        SUM(CASE WHEN big_holder_level = 'WATCH' THEN 1 ELSE 0 END) AS watch_count,
        SUM(CASE WHEN big_holder_level = 'EARLY' THEN 1 ELSE 0 END) AS early_count,
        SUM(CASE WHEN big_holder_level = 'RISK' THEN 1 ELSE 0 END) AS risk_count,
        SUM(CASE WHEN concentration_signal IN ('ACCUMULATING', 'LOCKING') THEN 1 ELSE 0 END) AS accumulating_count,
        SUM(CASE WHEN concentration_signal = 'LOOSENING' THEN 1 ELSE 0 END) AS loosen_count
      FROM big_holder_trend_signals
      WHERE trade_date = ?
      `,
      [tradeDate],
    );
    const stat = stats[0] || {};

    console.log(`更新個股數：${updated}`);
    console.log(`略過個股數：${skipped}`);
    console.log(`大戶趨勢分數區間：${round(stat.min_score, 2)} ～ ${round(stat.max_score, 2)}`);
    console.log(`平均大戶趨勢分數：${round(stat.avg_score, 2)}`);
    console.log(`等級統計：STRONG ${Number(stat.strong_count || 0)}｜WATCH ${Number(stat.watch_count || 0)}｜EARLY ${Number(stat.early_count || 0)}｜RISK ${Number(stat.risk_count || 0)}`);
    console.log(`籌碼集中：${Number(stat.accumulating_count || 0)}｜轉弱：${Number(stat.loosen_count || 0)}`);
    console.log("結果：PASS");
  } catch (error) {
    console.error("V1.9 大戶持股趨勢訊號產生失敗：", error.message);
    process.exitCode = 1;
  } finally {
    conn.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error("V1.9 大戶持股趨勢訊號產生失敗：", error);
  process.exit(1);
});
