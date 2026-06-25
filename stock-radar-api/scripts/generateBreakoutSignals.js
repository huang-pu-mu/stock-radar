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

function maxValue(values) {
  const valid = values.map((item) => toNumber(item, null)).filter((item) => item !== null);
  if (valid.length === 0) return null;
  return Math.max(...valid);
}

function classifyLevel(score) {
  if (score >= 85) return "STRONG";
  if (score >= 70) return "WATCH";
  if (score >= 55) return "EARLY";
  return "NEUTRAL";
}

function classifyType(flags, dataEnough) {
  if (!dataEnough) return "資料不足觀察";
  if (flags.is60dHigh && flags.isVolumeBreakout) return "60日爆量突破";
  if (flags.is20dHigh && flags.isVolumeBreakout) return "20日爆量突破";
  if (flags.is60dHigh) return "60日新高突破";
  if (flags.is20dHigh) return "20日新高突破";
  if (flags.isMaBullish && flags.isVolumeBreakout) return "均線量價轉強";
  if (flags.isMaBullish) return "均線多頭觀察";
  if (flags.isVolumeBreakout) return "爆量觀察";
  return "技術觀察";
}

function analyzeStock(pricesDesc, chipRow = {}, globalRow = {}, marketRow = {}) {
  const latest = pricesDesc[0];
  const newerFirst = pricesDesc;
  const previous = newerFirst[1] || null;
  const closes = newerFirst.map((row) => toNumber(row.close_price, null)).filter((item) => item !== null);
  const highs = newerFirst.map((row) => toNumber(row.high_price, null)).filter((item) => item !== null);
  const volumes = newerFirst.map((row) => toNumber(row.volume, null)).filter((item) => item !== null);
  const closePrice = toNumber(latest?.close_price, 0);
  const highPrice = toNumber(latest?.high_price, closePrice);
  const volume = toNumber(latest?.volume, 0);
  const prevClose = toNumber(previous?.close_price, closePrice);
  const priceChange = toNumber(latest?.price_change, closePrice - prevClose);
  const priceChangePercent = prevClose ? ((closePrice - prevClose) / prevClose) * 100 : 0;
  const ma5 = average(closes.slice(0, 5));
  const ma20 = average(closes.slice(0, 20));
  const ma60 = average(closes.slice(0, 60));
  const prevHigh20 = maxValue(newerFirst.slice(1, 21).map((row) => row.high_price));
  const prevHigh60 = maxValue(newerFirst.slice(1, 61).map((row) => row.high_price));
  const high20 = maxValue(highs.slice(0, 20));
  const high60 = maxValue(highs.slice(0, 60));
  const avgVolume5 = average(volumes.slice(1, 6));
  const volumeRatio5 = avgVolume5 ? volume / avgVolume5 : null;
  const dataEnough20 = newerFirst.length >= 20 && prevHigh20;
  const dataEnough60 = newerFirst.length >= 60 && prevHigh60;
  const dataEnough = newerFirst.length >= 20;

  const flags = {
    is20dHigh: Boolean(dataEnough20 && closePrice >= prevHigh20 * 0.995),
    is60dHigh: Boolean(dataEnough60 && closePrice >= prevHigh60 * 0.995),
    isMaBullish: Boolean(ma5 && ma20 && closePrice >= ma5 && ma5 >= ma20 && (!ma60 || ma20 >= ma60 * 0.98)),
    isVolumeBreakout: Boolean(volumeRatio5 !== null && volumeRatio5 >= 1.4),
    isBoxBreakout: Boolean(dataEnough20 && closePrice >= prevHigh20 && volumeRatio5 !== null && volumeRatio5 >= 1.1),
  };

  const chipScore = toNumber(chipRow?.chip_score, 50);
  const globalAdjustedScore = toNumber(globalRow?.global_adjusted_score, null);
  const marketAdjustedScore = toNumber(marketRow?.adjusted_score, null);
  const referenceScore = globalAdjustedScore ?? marketAdjustedScore ?? chipScore;
  const tags = [];
  let score = 35;

  score += clamp((referenceScore - 50) * 0.28, -8, 14);

  if (flags.is60dHigh) { score += 18; tags.push("60日新高"); }
  if (flags.is20dHigh) { score += 14; tags.push("20日新高"); }
  if (flags.isBoxBreakout) { score += 12; tags.push("箱型突破"); }
  if (flags.isVolumeBreakout) { score += clamp((volumeRatio5 - 1) * 12, 5, 16); tags.push("成交量放大"); }
  if (flags.isMaBullish) { score += 14; tags.push("均線多頭"); }
  if (ma20 && closePrice > ma20) { score += clamp(((closePrice / ma20) - 1) * 40, 2, 10); tags.push("站上月線"); }
  if (ma60 && closePrice > ma60) { score += clamp(((closePrice / ma60) - 1) * 25, 1, 8); tags.push("站上季線"); }
  if (priceChangePercent > 0) score += clamp(priceChangePercent * 1.2, 1, 8);

  if (!dataEnough) {
    score = Math.max(score, clamp(45 + (referenceScore - 50) * 0.35 + Math.max(priceChangePercent, 0), 35, 72));
    tags.push("歷史資料不足");
  }

  let overheatRisk = "LOW";
  if ((ma20 && closePrice >= ma20 * 1.18) || priceChangePercent >= 8) {
    overheatRisk = "HIGH";
    score -= 10;
    tags.push("過熱風險");
  } else if ((ma20 && closePrice >= ma20 * 1.10) || priceChangePercent >= 5) {
    overheatRisk = "MEDIUM";
    score -= 4;
  }

  let supportRisk = "NORMAL";
  if (ma20 && closePrice < ma20) {
    supportRisk = "WEAK";
    score -= 8;
  } else if (ma5 && closePrice < ma5) {
    supportRisk = "PULLBACK";
    score -= 3;
  }

  const breakoutScore = round(clamp(score, 0, 100), 2);
  const breakoutLevel = classifyLevel(breakoutScore);
  const breakoutType = classifyType(flags, dataEnough);
  const reasonTags = tags.length > 0 ? [...new Set(tags)] : [breakoutType];

  return {
    breakout_score: breakoutScore,
    breakout_level: breakoutLevel,
    breakout_type: breakoutType,
    breakout_tags: reasonTags.join("、"),
    close_price: round(closePrice, 2),
    price_change: round(priceChange, 2),
    price_change_percent: round(priceChangePercent, 4),
    volume: Math.round(volume || 0),
    volume_ratio_5: round(volumeRatio5, 4),
    ma5: round(ma5, 4),
    ma20: round(ma20, 4),
    ma60: round(ma60, 4),
    high_20: round(high20, 4),
    high_60: round(high60, 4),
    is_20d_high: flags.is20dHigh ? 1 : 0,
    is_60d_high: flags.is60dHigh ? 1 : 0,
    is_ma_bullish: flags.isMaBullish ? 1 : 0,
    is_volume_breakout: flags.isVolumeBreakout ? 1 : 0,
    is_box_breakout: flags.isBoxBreakout ? 1 : 0,
    overheat_risk: overheatRisk,
    support_risk: supportRisk,
    chip_score: round(chipScore, 2),
    global_adjusted_score: globalAdjustedScore === null ? null : round(globalAdjustedScore, 2),
    market_adjusted_score: marketAdjustedScore === null ? null : round(marketAdjustedScore, 2),
    reason_summary: `${breakoutType}｜${reasonTags.slice(0, 5).join("、")}｜突破分數 ${breakoutScore}`,
  };
}

async function tableExists(conn, tableName) {
  const rows = await conn.query(
    `SELECT COUNT(*) AS table_count FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [tableName],
  );
  return Number(rows?.[0]?.table_count || 0) > 0;
}

async function getTargetDate(conn, argDate) {
  if (argDate) return argDate;
  const rows = await conn.query(`SELECT DATE_FORMAT(MAX(trade_date), '%Y-%m-%d') AS latest_date FROM daily_prices`);
  return rows?.[0]?.latest_date || null;
}

async function writeSummary(conn, tradeDate) {
  const marketRows = await conn.query(
    `
    SELECT market_type FROM technical_breakout_signals
    WHERE trade_date = ?
    GROUP BY market_type
    ORDER BY market_type
    `,
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
        SUM(CASE WHEN breakout_level = 'STRONG' THEN 1 ELSE 0 END) AS strong_count,
        SUM(CASE WHEN breakout_level = 'WATCH' THEN 1 ELSE 0 END) AS watch_count,
        SUM(CASE WHEN breakout_level = 'EARLY' THEN 1 ELSE 0 END) AS early_count,
        ROUND(AVG(breakout_score), 2) AS avg_breakout_score,
        MAX(breakout_score) AS top_breakout_score
      FROM technical_breakout_signals
      WHERE trade_date = ? ${condition}
      `,
      params,
    );

    const topRows = await conn.query(
      `
      SELECT stock_code, stock_name
      FROM technical_breakout_signals
      WHERE trade_date = ? ${condition}
      ORDER BY breakout_score DESC, stock_code ASC
      LIMIT 1
      `,
      params,
    );

    const row = rows[0] || {};
    const top = topRows[0] || {};
    await conn.query(
      `
      INSERT INTO technical_breakout_summaries (
        trade_date, market_type, total_count, strong_count, watch_count, early_count,
        avg_breakout_score, top_breakout_score, top_stock_code, top_stock_name, generated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
      ON DUPLICATE KEY UPDATE
        total_count = VALUES(total_count),
        strong_count = VALUES(strong_count),
        watch_count = VALUES(watch_count),
        early_count = VALUES(early_count),
        avg_breakout_score = VALUES(avg_breakout_score),
        top_breakout_score = VALUES(top_breakout_score),
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
        row.avg_breakout_score,
        row.top_breakout_score,
        top.stock_code || null,
        top.stock_name || null,
      ],
    );
  }
}

async function main() {
  const argDate = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : "";
  const conn = await pool.getConnection();

  try {
    console.log("====================================");
    console.log("Stock Radar V1.7 技術突破訊號產生");
    console.log("====================================");

    const tradeDate = await getTargetDate(conn, argDate);
    if (!tradeDate) throw new Error("daily_prices 沒有可分析日期，請先執行每日資料匯入。");

    const hasGlobalAdjusted = await tableExists(conn, "global_risk_adjusted_scores");
    const hasMarketAdjusted = await tableExists(conn, "market_risk_adjusted_scores");

    const stocks = await conn.query(
      `
      SELECT
        s.stock_code, s.stock_name, s.market_type, s.industry,
        c.chip_score
      FROM stocks s
      INNER JOIN daily_prices p ON p.stock_code = s.stock_code AND p.trade_date = ?
      LEFT JOIN chip_scores c ON c.stock_code = s.stock_code AND c.trade_date = ?
      WHERE s.is_active = 1
      ORDER BY s.stock_code
      `,
      [tradeDate, tradeDate],
    );

    let generated = 0;
    let skipped = 0;
    const byLevel = { STRONG: 0, WATCH: 0, EARLY: 0, NEUTRAL: 0 };

    for (const stock of stocks) {
      const prices = await conn.query(
        `
        SELECT trade_date, open_price, high_price, low_price, close_price, price_change, volume
        FROM daily_prices
        WHERE stock_code = ? AND trade_date <= ?
        ORDER BY trade_date DESC
        LIMIT 80
        `,
        [stock.stock_code, tradeDate],
      );

      if (prices.length === 0) {
        skipped++;
        continue;
      }

      let globalRow = {};
      if (hasGlobalAdjusted) {
        const rows = await conn.query(
          `SELECT global_adjusted_score FROM global_risk_adjusted_scores WHERE stock_code = ? AND trade_date = ? LIMIT 1`,
          [stock.stock_code, tradeDate],
        );
        globalRow = rows[0] || {};
      }

      let marketRow = {};
      if (hasMarketAdjusted) {
        const rows = await conn.query(
          `SELECT adjusted_score FROM market_risk_adjusted_scores WHERE stock_code = ? AND trade_date = ? LIMIT 1`,
          [stock.stock_code, tradeDate],
        );
        marketRow = rows[0] || {};
      }

      const signal = analyzeStock(prices, stock, globalRow, marketRow);
      byLevel[signal.breakout_level] = (byLevel[signal.breakout_level] || 0) + 1;

      await conn.query(
        `
        INSERT INTO technical_breakout_signals (
          trade_date, stock_code, stock_name, market_type, industry,
          breakout_score, breakout_level, breakout_type, breakout_tags,
          close_price, price_change, price_change_percent, volume, volume_ratio_5,
          ma5, ma20, ma60, high_20, high_60,
          is_20d_high, is_60d_high, is_ma_bullish, is_volume_breakout, is_box_breakout,
          overheat_risk, support_risk, chip_score, global_adjusted_score, market_adjusted_score, reason_summary
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          stock_name = VALUES(stock_name), market_type = VALUES(market_type), industry = VALUES(industry),
          breakout_score = VALUES(breakout_score), breakout_level = VALUES(breakout_level), breakout_type = VALUES(breakout_type), breakout_tags = VALUES(breakout_tags),
          close_price = VALUES(close_price), price_change = VALUES(price_change), price_change_percent = VALUES(price_change_percent), volume = VALUES(volume), volume_ratio_5 = VALUES(volume_ratio_5),
          ma5 = VALUES(ma5), ma20 = VALUES(ma20), ma60 = VALUES(ma60), high_20 = VALUES(high_20), high_60 = VALUES(high_60),
          is_20d_high = VALUES(is_20d_high), is_60d_high = VALUES(is_60d_high), is_ma_bullish = VALUES(is_ma_bullish), is_volume_breakout = VALUES(is_volume_breakout), is_box_breakout = VALUES(is_box_breakout),
          overheat_risk = VALUES(overheat_risk), support_risk = VALUES(support_risk), chip_score = VALUES(chip_score), global_adjusted_score = VALUES(global_adjusted_score), market_adjusted_score = VALUES(market_adjusted_score), reason_summary = VALUES(reason_summary),
          updated_at = NOW()
        `,
        [
          tradeDate,
          stock.stock_code,
          stock.stock_name,
          stock.market_type || "其他",
          stock.industry || "未分類",
          signal.breakout_score,
          signal.breakout_level,
          signal.breakout_type,
          signal.breakout_tags,
          signal.close_price,
          signal.price_change,
          signal.price_change_percent,
          signal.volume,
          signal.volume_ratio_5,
          signal.ma5,
          signal.ma20,
          signal.ma60,
          signal.high_20,
          signal.high_60,
          signal.is_20d_high,
          signal.is_60d_high,
          signal.is_ma_bullish,
          signal.is_volume_breakout,
          signal.is_box_breakout,
          signal.overheat_risk,
          signal.support_risk,
          signal.chip_score,
          signal.global_adjusted_score,
          signal.market_adjusted_score,
          signal.reason_summary,
        ],
      );

      generated++;
    }

    await writeSummary(conn, tradeDate);

    const scoreRows = await conn.query(
      `SELECT MIN(breakout_score) AS min_score, MAX(breakout_score) AS max_score, ROUND(AVG(breakout_score),2) AS avg_score FROM technical_breakout_signals WHERE trade_date = ?`,
      [tradeDate],
    );
    const scoreSummary = scoreRows[0] || {};

    console.log(`分析日期：${tradeDate}`);
    console.log(`更新個股數：${generated}`);
    console.log(`略過個股數：${skipped}`);
    console.log(`突破分數區間：${scoreSummary.min_score ?? "-"} ～ ${scoreSummary.max_score ?? "-"}`);
    console.log(`平均突破分數：${scoreSummary.avg_score ?? "-"}`);
    console.log(`等級統計：STRONG ${byLevel.STRONG || 0}｜WATCH ${byLevel.WATCH || 0}｜EARLY ${byLevel.EARLY || 0}｜NEUTRAL ${byLevel.NEUTRAL || 0}`);
    console.log("結果：PASS");
  } finally {
    conn.release();
    await pool.end();
  }
}

main().catch(async (error) => {
  console.error("V1.7 技術突破訊號產生失敗：", error.message);
  try { await pool.end(); } catch {}
  process.exit(1);
});
