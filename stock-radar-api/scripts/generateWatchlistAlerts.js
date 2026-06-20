import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pool from "../db.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const sqlFilePath = path.join(__dirname, "..", "sql", "watchlist-alerts.sql");

function getTaiwanToday() {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Taipei",
  }).format(new Date());
}

function normalizeDate(inputDate) {
  const dateText = inputDate || getTaiwanToday();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateText)) {
    throw new Error("日期格式錯誤，請使用 YYYY-MM-DD，例如 2026-06-20");
  }

  return dateText;
}

function splitSqlStatements(sqlText) {
  return sqlText
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      return trimmed && !trimmed.startsWith("--");
    })
    .join("\n")
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

function number(value) {
  if (value === null || value === undefined) return 0;
  const result = Number(value);
  return Number.isNaN(result) ? 0 : result;
}

function integer(value) {
  const result = Math.trunc(number(value));
  return Number.isFinite(result) ? result : 0;
}

function toSourceId(value) {
  const result = integer(value);
  return result > 0 ? result : 0;
}

function average(values) {
  const valid = values.map(number).filter((value) => value > 0);
  if (!valid.length) return 0;
  return valid.reduce((sum, value) => sum + value, 0) / valid.length;
}

function positiveStreak(rows, fieldName) {
  let count = 0;

  for (const row of rows) {
    if (number(row[fieldName]) > 0) {
      count++;
    } else {
      break;
    }
  }

  return count;
}

function formatLots(value) {
  const lots = number(value);
  return `${Math.round(lots).toLocaleString("zh-TW")} 張`;
}

function formatRatio(value) {
  return `${number(value).toFixed(2)}%`;
}

function getLevelByStreak(streak) {
  if (streak >= 5) return "high";
  if (streak >= 3) return "normal";
  return "low";
}

function getLevelByRatio(value, threshold) {
  if (value >= threshold * 3) return "high";
  if (value >= threshold) return "normal";
  return "low";
}

async function ensureAlertTables(conn) {
  const sqlText = await fs.readFile(sqlFilePath, "utf8");
  const statements = splitSqlStatements(sqlText);

  for (const statement of statements) {
    await conn.query(statement);
  }
}

async function resolveTradeDate(conn, requestedDate) {
  const rows = await conn.query(
    `
    SELECT DATE_FORMAT(MAX(trade_date), '%Y-%m-%d') AS latest_trade_date
    FROM chip_scores
    WHERE trade_date <= ?
    `,
    [requestedDate],
  );

  const latestTradeDate = rows[0]?.latest_trade_date;

  if (!latestTradeDate) {
    throw new Error(`找不到 ${requestedDate} 以前的籌碼分數資料，請先執行 npm run daily`);
  }

  return latestTradeDate;
}

async function syncDefaultAlertRules(conn) {
  const result = await conn.query(
    `
    INSERT IGNORE INTO watchlist_alert_rules (user_id, stock_code)
    SELECT w.user_id, w.stock_code
    FROM watchlists w
    INNER JOIN users u ON u.id = w.user_id
    WHERE u.is_active = 1
    `,
  );

  return Number(result.affectedRows || 0);
}

async function getActiveRules(conn) {
  return conn.query(
    `
    SELECT
      r.*,
      COALESCE(s.stock_name, ep.stock_name, r.stock_code) AS stock_name,
      COALESCE(s.security_type, 'STOCK') AS security_type
    FROM watchlist_alert_rules r
    INNER JOIN users u ON u.id = r.user_id AND u.is_active = 1
    INNER JOIN watchlists w ON w.user_id = r.user_id AND w.stock_code = r.stock_code
    LEFT JOIN stocks s ON s.stock_code = r.stock_code
    LEFT JOIN etf_profiles ep ON ep.stock_code = r.stock_code
    WHERE r.is_active = 1
    ORDER BY r.user_id, r.stock_code
    `,
  );
}

async function getInstitutionalRows(conn, stockCode, tradeDate) {
  return conn.query(
    `
    SELECT
      id,
      DATE_FORMAT(trade_date, '%Y-%m-%d') AS trade_date,
      foreign_net,
      investment_trust_net,
      dealer_net,
      total_net
    FROM institutional_trades
    WHERE stock_code = ?
      AND trade_date <= ?
    ORDER BY trade_date DESC
    LIMIT 20
    `,
    [stockCode, tradeDate],
  );
}

async function getPriceRows(conn, stockCode, tradeDate) {
  return conn.query(
    `
    SELECT
      id,
      DATE_FORMAT(trade_date, '%Y-%m-%d') AS trade_date,
      close_price,
      volume
    FROM daily_prices
    WHERE stock_code = ?
      AND trade_date <= ?
    ORDER BY trade_date DESC
    LIMIT 21
    `,
    [stockCode, tradeDate],
  );
}

async function getChipScore(conn, stockCode, tradeDate) {
  const rows = await conn.query(
    `
    SELECT
      id,
      DATE_FORMAT(trade_date, '%Y-%m-%d') AS trade_date,
      chip_score,
      foreign_status,
      investment_trust_status,
      big_holder_status,
      volume_status,
      price_position
    FROM chip_scores
    WHERE stock_code = ?
      AND trade_date <= ?
    ORDER BY trade_date DESC
    LIMIT 1
    `,
    [stockCode, tradeDate],
  );

  return rows[0] || null;
}

async function getMajorHolderRows(conn, stockCode, tradeDate) {
  return conn.query(
    `
    SELECT
      id,
      DATE_FORMAT(data_date, '%Y-%m-%d') AS data_date,
      large_holder_count,
      large_holder_ratio,
      large_holder_share_count,
      small_holder_ratio,
      thousand_lot_holder_count,
      thousand_lot_ratio
    FROM major_holder_stats
    WHERE stock_code = ?
      AND data_date <= ?
    ORDER BY data_date DESC
    LIMIT 2
    `,
    [stockCode, tradeDate],
  );
}

async function getUpcomingEvents(conn, stockCode, tradeDate, daysBefore) {
  const safeDays = Math.max(1, Math.min(integer(daysBefore), 60));

  return conn.query(
    `
    SELECT
      id,
      stock_code,
      DATE_FORMAT(event_date, '%Y-%m-%d') AS event_date,
      event_type,
      title,
      importance
    FROM stock_calendar_events
    WHERE stock_code = ?
      AND is_active = 1
      AND event_date >= ?
      AND event_date <= DATE_ADD(?, INTERVAL ${safeDays} DAY)
    ORDER BY event_date ASC, importance DESC, event_type ASC
    LIMIT 20
    `,
    [stockCode, tradeDate, tradeDate],
  );
}

async function upsertAlert(conn, alert) {
  await conn.query(
    `
    INSERT INTO watchlist_alerts (
      user_id,
      stock_code,
      stock_name,
      alert_date,
      reference_date,
      alert_type,
      alert_level,
      title,
      message,
      metric_name,
      metric_value,
      threshold_value,
      source_table,
      source_id
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      stock_name = VALUES(stock_name),
      alert_level = VALUES(alert_level),
      title = VALUES(title),
      message = VALUES(message),
      metric_name = VALUES(metric_name),
      metric_value = VALUES(metric_value),
      threshold_value = VALUES(threshold_value),
      source_table = VALUES(source_table),
      source_id = VALUES(source_id),
      updated_at = NOW()
    `,
    [
      alert.userId,
      alert.stockCode,
      alert.stockName,
      alert.alertDate,
      alert.referenceDate,
      alert.alertType,
      alert.alertLevel,
      alert.title,
      alert.message,
      alert.metricName,
      alert.metricValue,
      alert.thresholdValue,
      alert.sourceTable,
      alert.sourceId || 0,
    ],
  );
}

function buildForeignAlert(rule, tradeDate, institutionalRows) {
  if (!rule.foreign_buy_streak_enabled) return null;

  const threshold = Math.max(1, integer(rule.foreign_buy_streak_days));
  const streak = positiveStreak(institutionalRows, "foreign_net");
  const latest = institutionalRows[0];

  if (!latest || streak < threshold) return null;

  return {
    userId: rule.user_id,
    stockCode: rule.stock_code,
    stockName: rule.stock_name,
    alertDate: tradeDate,
    referenceDate: latest.trade_date,
    alertType: "foreign_buy_streak",
    alertLevel: getLevelByStreak(streak),
    title: `${rule.stock_code} ${rule.stock_name} 外資連買 ${streak} 天`,
    message: `外資已連續買超 ${streak} 天，最近一日買超 ${formatLots(latest.foreign_net)}。`,
    metricName: "外資連買天數",
    metricValue: streak,
    thresholdValue: threshold,
    sourceTable: "institutional_trades",
    sourceId: toSourceId(latest.id),
  };
}

function buildInvestmentTrustAlert(rule, tradeDate, institutionalRows) {
  if (!rule.investment_trust_buy_streak_enabled) return null;

  const threshold = Math.max(1, integer(rule.investment_trust_buy_streak_days));
  const streak = positiveStreak(institutionalRows, "investment_trust_net");
  const latest = institutionalRows[0];

  if (!latest || streak < threshold) return null;

  return {
    userId: rule.user_id,
    stockCode: rule.stock_code,
    stockName: rule.stock_name,
    alertDate: tradeDate,
    referenceDate: latest.trade_date,
    alertType: "investment_trust_buy_streak",
    alertLevel: getLevelByStreak(streak),
    title: `${rule.stock_code} ${rule.stock_name} 投信連買 ${streak} 天`,
    message: `投信已連續買超 ${streak} 天，最近一日買超 ${formatLots(latest.investment_trust_net)}。`,
    metricName: "投信連買天數",
    metricValue: streak,
    thresholdValue: threshold,
    sourceTable: "institutional_trades",
    sourceId: toSourceId(latest.id),
  };
}

function buildVolumeAlert(rule, tradeDate, priceRows) {
  if (!rule.volume_enabled) return null;

  const latest = priceRows[0];
  const previousRows = priceRows.slice(1);
  const baseRows = previousRows.length >= 20 ? previousRows.slice(0, 20) : previousRows;
  const avgVolume = average(baseRows.map((row) => row.volume));
  const latestVolume = number(latest?.volume);
  const threshold = number(rule.volume_ratio_threshold) || 1.5;
  const volumeRatio = avgVolume > 0 ? latestVolume / avgVolume : 0;

  if (!latest || baseRows.length < 5 || volumeRatio < threshold) return null;

  return {
    userId: rule.user_id,
    stockCode: rule.stock_code,
    stockName: rule.stock_name,
    alertDate: tradeDate,
    referenceDate: latest.trade_date,
    alertType: "volume_spike",
    alertLevel: getLevelByRatio(volumeRatio, threshold),
    title: `${rule.stock_code} ${rule.stock_name} 成交量放大 ${volumeRatio.toFixed(2)} 倍`,
    message: `最近一日成交量 ${formatLots(latestVolume)}，高於近 ${baseRows.length} 日均量 ${formatLots(avgVolume)}，量能放大 ${volumeRatio.toFixed(2)} 倍。`,
    metricName: "成交量放大倍數",
    metricValue: volumeRatio,
    thresholdValue: threshold,
    sourceTable: "daily_prices",
    sourceId: toSourceId(latest.id),
  };
}

function buildChipScoreAlert(rule, tradeDate, chipScore) {
  if (!rule.chip_score_enabled) return null;

  const threshold = integer(rule.chip_score_threshold) || 80;
  const score = integer(chipScore?.chip_score);

  if (!chipScore || score < threshold) return null;

  const statuses = [
    chipScore.foreign_status,
    chipScore.investment_trust_status,
    chipScore.big_holder_status,
    chipScore.volume_status,
    chipScore.price_position,
  ].filter(Boolean);

  return {
    userId: rule.user_id,
    stockCode: rule.stock_code,
    stockName: rule.stock_name,
    alertDate: tradeDate,
    referenceDate: chipScore.trade_date,
    alertType: "chip_score_threshold",
    alertLevel: score >= 90 ? "high" : "normal",
    title: `${rule.stock_code} ${rule.stock_name} 籌碼分數達 ${score} 分`,
    message: `籌碼分數 ${score} 分，已達設定門檻 ${threshold} 分。${statuses.length ? `狀態：${statuses.join("、")}` : ""}`,
    metricName: "籌碼分數",
    metricValue: score,
    thresholdValue: threshold,
    sourceTable: "chip_scores",
    sourceId: toSourceId(chipScore.id),
  };
}

function buildMajorHolderAlert(rule, tradeDate, majorHolderRows) {
  if (!rule.major_holder_enabled) return null;

  const latest = majorHolderRows[0];
  const previous = majorHolderRows[1];
  const threshold = number(rule.major_holder_ratio_change_threshold) || 0.3;

  if (!latest || !previous) return null;

  const ratioChange = number(latest.large_holder_ratio) - number(previous.large_holder_ratio);
  const smallRatioChange = number(latest.small_holder_ratio) - number(previous.small_holder_ratio);

  if (ratioChange < threshold) return null;

  const level = ratioChange >= 1 ? "high" : "normal";
  const smallHolderText = smallRatioChange < 0
    ? `，散戶比例下降 ${formatRatio(Math.abs(smallRatioChange))}`
    : "";

  return {
    userId: rule.user_id,
    stockCode: rule.stock_code,
    stockName: rule.stock_name,
    alertDate: tradeDate,
    referenceDate: latest.data_date,
    alertType: "major_holder_increase",
    alertLevel: level,
    title: `${rule.stock_code} ${rule.stock_name} 大戶比重增加 ${formatRatio(ratioChange)}`,
    message: `400 張以上大戶持股比例由 ${formatRatio(previous.large_holder_ratio)} 增至 ${formatRatio(latest.large_holder_ratio)}，增加 ${formatRatio(ratioChange)}${smallHolderText}。`,
    metricName: "大戶持股比例增加",
    metricValue: ratioChange,
    thresholdValue: threshold,
    sourceTable: "major_holder_stats",
    sourceId: toSourceId(latest.id),
  };
}

function buildCalendarAlerts(rule, tradeDate, events) {
  if (!rule.calendar_enabled) return [];

  return events.map((event) => {
    const level = event.importance === "high" ? "high" : "normal";

    return {
      userId: rule.user_id,
      stockCode: rule.stock_code,
      stockName: rule.stock_name,
      alertDate: tradeDate,
      referenceDate: event.event_date,
      alertType: "calendar_event",
      alertLevel: level,
      title: `${rule.stock_code} ${rule.stock_name} 即將發生：${event.title}`,
      message: `${event.event_date} 有 ${event.event_type} 事件：${event.title}。`,
      metricName: "行事曆提前提醒天數",
      metricValue: integer(rule.calendar_days_before),
      thresholdValue: integer(rule.calendar_days_before),
      sourceTable: "stock_calendar_events",
      sourceId: toSourceId(event.id),
    };
  });
}

async function buildAlertsForRule(conn, rule, tradeDate) {
  const [institutionalRows, priceRows, chipScore, majorHolderRows, events] = await Promise.all([
    getInstitutionalRows(conn, rule.stock_code, tradeDate),
    getPriceRows(conn, rule.stock_code, tradeDate),
    getChipScore(conn, rule.stock_code, tradeDate),
    getMajorHolderRows(conn, rule.stock_code, tradeDate),
    getUpcomingEvents(conn, rule.stock_code, tradeDate, rule.calendar_days_before),
  ]);

  return [
    buildForeignAlert(rule, tradeDate, institutionalRows),
    buildInvestmentTrustAlert(rule, tradeDate, institutionalRows),
    buildVolumeAlert(rule, tradeDate, priceRows),
    buildChipScoreAlert(rule, tradeDate, chipScore),
    buildMajorHolderAlert(rule, tradeDate, majorHolderRows),
    ...buildCalendarAlerts(rule, tradeDate, events),
  ].filter(Boolean);
}

async function main() {
  const requestedDate = normalizeDate(process.argv[2]);
  let conn;

  try {
    console.log("====================================");
    console.log("開始產生 V1.3 自選股提醒");
    console.log(`指定日期：${requestedDate}`);
    console.log("====================================");

    conn = await pool.getConnection();
    await ensureAlertTables(conn);

    const tradeDate = await resolveTradeDate(conn, requestedDate);
    const syncedRules = await syncDefaultAlertRules(conn);
    const rules = await getActiveRules(conn);

    console.log(`最近可用交易日：${tradeDate}`);
    console.log(`新增預設提醒規則：${syncedRules} 筆`);
    console.log(`啟用提醒規則：${rules.length} 筆`);

    if (!rules.length) {
      console.log("目前沒有自選股或啟用的提醒規則，略過提醒產生。");
      return;
    }

    let generatedCount = 0;
    const typeCounter = new Map();

    for (const rule of rules) {
      const alerts = await buildAlertsForRule(conn, rule, tradeDate);

      for (const alert of alerts) {
        await upsertAlert(conn, alert);
        generatedCount++;
        typeCounter.set(alert.alertType, (typeCounter.get(alert.alertType) || 0) + 1);
      }
    }

    console.log("提醒產生完成");
    console.log(`本次符合條件提醒：${generatedCount} 筆`);

    if (typeCounter.size) {
      console.log("提醒類型統計：");
      for (const [type, count] of typeCounter.entries()) {
        console.log(`- ${type}：${count} 筆`);
      }
    }

    console.log("可用 SQL 檢查：");
    console.log("SELECT * FROM watchlist_alerts ORDER BY created_at DESC LIMIT 20;");
  } catch (error) {
    console.error("產生 V1.3 自選股提醒失敗");
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    if (conn) conn.release();
    await pool.end();
  }
}

main();
