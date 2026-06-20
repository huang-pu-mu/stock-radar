import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pool from "../db.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const sqlFilePath = path.join(__dirname, "..", "sql", "strategy-backtests.sql");

const STRATEGIES = [
  { key: "legal_strength", name: "法人轉強股" },
  { key: "major_holder_accumulate", name: "主力增持股" },
  { key: "volume_price_breakout", name: "量價轉強股" },
  { key: "capital_inflow", name: "資金流入股" },
  { key: "etf_calendar_watch", name: "ETF 除息觀察" },
  { key: "short_term_strong", name: "短線強勢股" },
];

function getTaiwanToday() {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Taipei",
  }).format(new Date());
}

function normalizeDate(inputDate, label = "日期") {
  const dateText = String(inputDate || "").trim();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateText)) {
    throw new Error(`${label}格式錯誤，請使用 YYYY-MM-DD，例如 2026-06-18`);
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

function number(value, fallback = 0) {
  if (value === null || value === undefined || value === "") return fallback;
  const result = Number(String(value).replaceAll(",", ""));
  return Number.isFinite(result) ? result : fallback;
}

function nullableNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const result = Number(String(value).replaceAll(",", ""));
  return Number.isFinite(result) ? result : null;
}

function round(value, decimals = 4) {
  const result = nullableNumber(value);
  if (result === null) return null;
  return Number(result.toFixed(decimals));
}

function parsePositiveInteger(value, fallback, min = 1, max = 500) {
  const result = Number.parseInt(value, 10);
  if (!Number.isFinite(result)) return fallback;
  return Math.max(min, Math.min(result, max));
}

function normalizeMarket(value) {
  const text = String(value || "").trim();
  return ["上市", "上櫃"].includes(text) ? text : "";
}

function normalizeStrategy(value) {
  const text = String(value || "").trim();
  return STRATEGIES.some((item) => item.key === text) ? text : "";
}

function getArgValue(args, name) {
  const prefix = `--${name}=`;
  const match = args.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : "";
}

function hasFlag(args, name) {
  return args.includes(`--${name}`);
}

function parseArgs(argv) {
  const positional = argv.filter((arg) => !arg.startsWith("--"));
  const today = getTaiwanToday();

  return {
    startDate: positional[0] ? normalizeDate(positional[0], "開始日期") : "",
    endDate: positional[1] ? normalizeDate(positional[1], "結束日期") : today,
    strategy: normalizeStrategy(getArgValue(argv, "strategy")),
    market: normalizeMarket(getArgValue(argv, "market")),
    limitPerStrategy: parsePositiveInteger(getArgValue(argv, "limit"), 30, 1, 100),
    maxTradingDays: parsePositiveInteger(getArgValue(argv, "max-days"), 80, 1, 260),
    runName: String(getArgValue(argv, "name") || "").trim().slice(0, 120),
    force: hasFlag(argv, "force"),
  };
}

async function ensureBacktestTables(conn) {
  const sqlText = await fs.readFile(sqlFilePath, "utf8");
  const statements = splitSqlStatements(sqlText);

  for (const statement of statements) {
    await conn.query(statement);
  }
}

async function resolveDefaultStartDate(conn, endDate, maxTradingDays) {
  const rows = await conn.query(
    `
    SELECT DATE_FORMAT(MIN(x.trade_date), '%Y-%m-%d') AS start_date
    FROM (
      SELECT DISTINCT trade_date
      FROM chip_scores
      WHERE trade_date <= ?
      ORDER BY trade_date DESC
      LIMIT ?
    ) x
    `,
    [endDate, maxTradingDays],
  );

  return rows[0]?.start_date || endDate;
}

async function getTradingDates(conn, startDate, endDate, maxTradingDays) {
  const rows = await conn.query(
    `
    SELECT DATE_FORMAT(trade_date, '%Y-%m-%d') AS trade_date
    FROM (
      SELECT DISTINCT trade_date
      FROM chip_scores
      WHERE trade_date BETWEEN ? AND ?
      ORDER BY trade_date DESC
      LIMIT ?
    ) d
    ORDER BY trade_date ASC
    `,
    [startDate, endDate, maxTradingDays],
  );

  return rows.map((row) => row.trade_date).filter(Boolean);
}

function buildMarketCondition(alias, market, params) {
  if (!market) return "";
  params.push(market);
  return `AND ${alias}.market_type = ?`;
}

async function getStrategyCandidates(conn, strategyKey, signalDate, market, limit) {
  const strategy = STRATEGIES.find((item) => item.key === strategyKey);

  if (!strategy) return [];

  if (strategyKey === "legal_strength") {
    const params = [signalDate];
    const marketSql = buildMarketCondition("s", market, params);
    params.push(limit);

    return conn.query(
      `
      SELECT
        DATE_FORMAT(c.trade_date, '%Y-%m-%d') AS signal_trade_date,
        c.stock_code,
        COALESCE(s.stock_name, c.stock_code) AS stock_name,
        s.market_type,
        s.industry,
        ? AS strategy_key,
        ? AS strategy_name,
        (COALESCE(c.foreign_score, 0) + COALESCE(c.investment_trust_score, 0) + COALESCE(c.chip_score, 0)) AS strategy_score,
        CONCAT(c.foreign_status, '，', c.investment_trust_status) AS trigger_summary
      FROM chip_scores c
      LEFT JOIN stocks s ON s.stock_code = c.stock_code
      LEFT JOIN institutional_trades i ON i.stock_code = c.stock_code AND i.trade_date = c.trade_date
      WHERE c.trade_date = ?
        ${marketSql}
        AND COALESCE(s.is_active, 1) = 1
        AND COALESCE(c.chip_score, 0) >= 50
        AND (
          COALESCE(c.foreign_score, 0) >= 10
          OR COALESCE(c.investment_trust_score, 0) >= 10
          OR COALESCE(i.total_net, 0) > 0
        )
      ORDER BY strategy_score DESC, COALESCE(i.total_net, 0) DESC, c.stock_code ASC
      LIMIT ?
      `,
      [strategy.key, strategy.name, ...params],
    );
  }

  if (strategyKey === "major_holder_accumulate") {
    const dateRows = await conn.query(
      `SELECT DATE_FORMAT(MAX(data_date), '%Y-%m-%d') AS data_date FROM major_holder_stats WHERE data_date <= ?`,
      [signalDate],
    );
    const dataDate = dateRows[0]?.data_date;
    if (!dataDate) return [];

    const params = [dataDate];
    const marketSql = buildMarketCondition("s", market, params);
    params.push(limit);

    return conn.query(
      `
      SELECT
        ? AS signal_trade_date,
        m.stock_code,
        COALESCE(s.stock_name, m.stock_code) AS stock_name,
        s.market_type,
        s.industry,
        ? AS strategy_key,
        ? AS strategy_name,
        ROUND(m.large_holder_ratio - COALESCE(prev.large_holder_ratio, m.large_holder_ratio), 4) AS large_holder_ratio_change,
        (
          COALESCE(c.chip_score, 0)
          + GREATEST(ROUND((m.large_holder_ratio - COALESCE(prev.large_holder_ratio, m.large_holder_ratio)) * 20, 4), 0)
          + CASE WHEN m.large_holder_ratio >= 40 THEN 10 ELSE 0 END
        ) AS strategy_score,
        CONCAT('大戶比重增加 ', ROUND(m.large_holder_ratio - COALESCE(prev.large_holder_ratio, m.large_holder_ratio), 2), '%') AS trigger_summary
      FROM major_holder_stats m
      LEFT JOIN major_holder_stats prev
        ON prev.stock_code = m.stock_code
       AND prev.data_date = (
          SELECT MAX(p2.data_date)
          FROM major_holder_stats p2
          WHERE p2.stock_code = m.stock_code
            AND p2.data_date < m.data_date
       )
      LEFT JOIN stocks s ON s.stock_code = m.stock_code
      LEFT JOIN chip_scores c
        ON c.stock_code = m.stock_code
       AND c.trade_date = (
          SELECT MAX(c2.trade_date)
          FROM chip_scores c2
          WHERE c2.stock_code = m.stock_code
            AND c2.trade_date <= ?
       )
      WHERE m.data_date = ?
        ${marketSql}
        AND COALESCE(s.is_active, 1) = 1
        AND (m.large_holder_ratio - COALESCE(prev.large_holder_ratio, m.large_holder_ratio)) > 0
      ORDER BY strategy_score DESC, large_holder_ratio_change DESC, m.stock_code ASC
      LIMIT ?
      `,
      [signalDate, strategy.key, strategy.name, signalDate, ...params],
    );
  }

  if (strategyKey === "volume_price_breakout") {
    const params = [signalDate];
    const marketSql = buildMarketCondition("s", market, params);
    params.push(limit);

    return conn.query(
      `
      SELECT
        DATE_FORMAT(c.trade_date, '%Y-%m-%d') AS signal_trade_date,
        c.stock_code,
        COALESCE(s.stock_name, c.stock_code) AS stock_name,
        s.market_type,
        s.industry,
        ? AS strategy_key,
        ? AS strategy_name,
        (COALESCE(c.volume_score, 0) + COALESCE(c.price_score, 0) + COALESCE(c.chip_score, 0)) AS strategy_score,
        CONCAT(c.volume_status, '，', c.price_position) AS trigger_summary
      FROM chip_scores c
      LEFT JOIN stocks s ON s.stock_code = c.stock_code
      LEFT JOIN daily_prices p ON p.stock_code = c.stock_code AND p.trade_date = c.trade_date
      WHERE c.trade_date = ?
        ${marketSql}
        AND COALESCE(s.is_active, 1) = 1
        AND (COALESCE(c.volume_score, 0) >= 12 OR c.volume_status LIKE '%量增%' OR c.volume_status LIKE '%放大%')
        AND (COALESCE(c.price_score, 0) >= 8 OR c.price_position LIKE '%高點%' OR COALESCE(p.price_change, 0) > 0)
      ORDER BY strategy_score DESC, COALESCE(p.volume, 0) DESC, c.stock_code ASC
      LIMIT ?
      `,
      [strategy.key, strategy.name, ...params],
    );
  }

  if (strategyKey === "capital_inflow") {
    const params = [signalDate];
    const marketSql = buildMarketCondition("s", market, params);
    params.push(limit);

    return conn.query(
      `
      SELECT
        DATE_FORMAT(i.trade_date, '%Y-%m-%d') AS signal_trade_date,
        i.stock_code,
        COALESCE(s.stock_name, i.stock_code) AS stock_name,
        s.market_type,
        s.industry,
        ? AS strategy_key,
        ? AS strategy_name,
        (COALESCE(i.total_net, 0) / 1000 + COALESCE(c.chip_score, 0)) AS strategy_score,
        CONCAT('三大法人合計買超 ', ROUND(i.total_net / 1000, 0), ' 張') AS trigger_summary
      FROM institutional_trades i
      LEFT JOIN stocks s ON s.stock_code = i.stock_code
      LEFT JOIN chip_scores c ON c.stock_code = i.stock_code AND c.trade_date = i.trade_date
      WHERE i.trade_date = ?
        ${marketSql}
        AND COALESCE(s.is_active, 1) = 1
        AND COALESCE(i.total_net, 0) > 0
      ORDER BY COALESCE(i.total_net, 0) DESC, COALESCE(c.chip_score, 0) DESC, i.stock_code ASC
      LIMIT ?
      `,
      [strategy.key, strategy.name, ...params],
    );
  }

  if (strategyKey === "etf_calendar_watch") {
    const params = [];
    const marketSql = market ? "AND ep.market_type = ?" : "";
    if (market) params.push(market);
    params.push(limit);

    return conn.query(
      `
      SELECT
        ? AS signal_trade_date,
        e.stock_code,
        COALESCE(ep.stock_name, e.title, e.stock_code) AS stock_name,
        ep.market_type,
        'ETF' AS industry,
        ? AS strategy_key,
        ? AS strategy_name,
        (CASE WHEN e.importance = 'high' THEN 100 ELSE 70 END - LEAST(GREATEST(DATEDIFF(e.event_date, ?), 0), 30)) AS strategy_score,
        CONCAT(DATEDIFF(e.event_date, ?), ' 天後：', e.event_type) AS trigger_summary
      FROM stock_calendar_events e
      INNER JOIN etf_profiles ep ON ep.stock_code = e.stock_code
      WHERE e.is_active = 1
        AND e.event_date >= ?
        AND e.event_date <= DATE_ADD(?, INTERVAL 30 DAY)
        ${marketSql}
        AND (e.event_type LIKE '%除息%' OR e.event_type LIKE '%收益%' OR e.event_type LIKE '%股利%' OR e.importance = 'high')
      ORDER BY e.event_date ASC, strategy_score DESC, e.stock_code ASC
      LIMIT ?
      `,
      [signalDate, strategy.key, strategy.name, signalDate, signalDate, signalDate, signalDate, ...params],
    );
  }

  if (strategyKey === "short_term_strong") {
    const params = [signalDate];
    const marketSql = buildMarketCondition("s", market, params);
    params.push(limit);

    return conn.query(
      `
      SELECT
        DATE_FORMAT(c.trade_date, '%Y-%m-%d') AS signal_trade_date,
        c.stock_code,
        COALESCE(s.stock_name, c.stock_code) AS stock_name,
        s.market_type,
        s.industry,
        ? AS strategy_key,
        ? AS strategy_name,
        (COALESCE(c.chip_score, 0) + COALESCE(c.volume_score, 0) + COALESCE(c.price_score, 0)) AS strategy_score,
        CONCAT('籌碼 ', c.chip_score, ' 分，', c.volume_status, '，', c.price_position) AS trigger_summary
      FROM chip_scores c
      LEFT JOIN stocks s ON s.stock_code = c.stock_code
      LEFT JOIN daily_prices p ON p.stock_code = c.stock_code AND p.trade_date = c.trade_date
      WHERE c.trade_date = ?
        ${marketSql}
        AND COALESCE(s.is_active, 1) = 1
        AND COALESCE(c.chip_score, 0) >= 80
        AND (COALESCE(p.price_change, 0) >= 0 OR COALESCE(c.price_score, 0) >= 10)
      ORDER BY strategy_score DESC, c.chip_score DESC, c.stock_code ASC
      LIMIT ?
      `,
      [strategy.key, strategy.name, ...params],
    );
  }

  return [];
}

async function getEntryPrice(conn, stockCode, signalDate) {
  const rows = await conn.query(
    `
    SELECT close_price, DATE_FORMAT(trade_date, '%Y-%m-%d') AS trade_date
    FROM daily_prices
    WHERE stock_code = ?
      AND trade_date <= ?
    ORDER BY trade_date DESC
    LIMIT 1
    `,
    [stockCode, signalDate],
  );

  return rows[0] || null;
}

async function getFuturePrice(conn, stockCode, signalDate, offset) {
  const rows = await conn.query(
    `
    SELECT close_price, DATE_FORMAT(trade_date, '%Y-%m-%d') AS trade_date
    FROM daily_prices
    WHERE stock_code = ?
      AND trade_date > ?
    ORDER BY trade_date ASC
    LIMIT 1 OFFSET ${Number(offset) - 1}
    `,
    [stockCode, signalDate],
  );

  return rows[0] || null;
}

async function getLatestPrice(conn, stockCode, endDate) {
  const rows = await conn.query(
    `
    SELECT close_price, DATE_FORMAT(trade_date, '%Y-%m-%d') AS trade_date
    FROM daily_prices
    WHERE stock_code = ?
      AND trade_date <= ?
    ORDER BY trade_date DESC
    LIMIT 1
    `,
    [stockCode, endDate],
  );

  return rows[0] || null;
}

function calculateReturnPercent(targetPrice, entryPrice) {
  const entry = number(entryPrice);
  const target = number(targetPrice);

  if (entry <= 0 || target <= 0) return null;

  return round(((target - entry) / entry) * 100, 4);
}

function getOutcome(return5d, latestReturn) {
  const reference = return5d ?? latestReturn;

  if (reference === null || reference === undefined) {
    return {
      label: "pending",
      isSuccess: null,
      description: "價格資料不足，等待後續交易日。",
    };
  }

  if (reference >= 3) {
    return {
      label: "success",
      isSuccess: 1,
      description: "報酬達 3% 以上，暫定為成功訊號。",
    };
  }

  if (reference <= -3) {
    return {
      label: "fail",
      isSuccess: 0,
      description: "報酬跌破 -3%，暫定為失敗訊號。",
    };
  }

  return {
    label: "neutral",
    isSuccess: null,
    description: "報酬介於 -3% 到 3%，暫定為觀察中。",
  };
}

async function buildBacktestResult(conn, runId, row, rank, endDate) {
  const entry = await getEntryPrice(conn, row.stock_code, row.signal_trade_date);
  const after1d = await getFuturePrice(conn, row.stock_code, row.signal_trade_date, 1);
  const after3d = await getFuturePrice(conn, row.stock_code, row.signal_trade_date, 3);
  const after5d = await getFuturePrice(conn, row.stock_code, row.signal_trade_date, 5);
  const latest = await getLatestPrice(conn, row.stock_code, endDate);
  const entryPrice = nullableNumber(entry?.close_price);
  const return1d = calculateReturnPercent(after1d?.close_price, entryPrice);
  const return3d = calculateReturnPercent(after3d?.close_price, entryPrice);
  const return5d = calculateReturnPercent(after5d?.close_price, entryPrice);
  const latestReturn = calculateReturnPercent(latest?.close_price, entryPrice);
  const outcome = getOutcome(return5d, latestReturn);

  return {
    run_id: runId,
    strategy_key: row.strategy_key,
    strategy_name: row.strategy_name,
    stock_code: row.stock_code,
    stock_name: row.stock_name,
    market_type: row.market_type,
    industry: row.industry,
    signal_trade_date: row.signal_trade_date,
    source_rank: rank,
    strategy_score: round(row.strategy_score),
    trigger_summary: row.trigger_summary,
    entry_price: entryPrice,
    entry_price_date: entry?.trade_date || null,
    price_after_1d: nullableNumber(after1d?.close_price),
    price_after_1d_date: after1d?.trade_date || null,
    return_1d_percent: return1d,
    price_after_3d: nullableNumber(after3d?.close_price),
    price_after_3d_date: after3d?.trade_date || null,
    return_3d_percent: return3d,
    price_after_5d: nullableNumber(after5d?.close_price),
    price_after_5d_date: after5d?.trade_date || null,
    return_5d_percent: return5d,
    latest_price: nullableNumber(latest?.close_price),
    latest_price_date: latest?.trade_date || null,
    latest_return_percent: latestReturn,
    outcome_label: outcome.label,
    outcome_description: outcome.description,
    is_success: outcome.isSuccess,
  };
}

async function insertResult(conn, result) {
  await conn.query(
    `
    INSERT INTO strategy_backtest_results (
      run_id,
      strategy_key,
      strategy_name,
      stock_code,
      stock_name,
      market_type,
      industry,
      signal_trade_date,
      source_rank,
      strategy_score,
      trigger_summary,
      entry_price,
      entry_price_date,
      price_after_1d,
      price_after_1d_date,
      return_1d_percent,
      price_after_3d,
      price_after_3d_date,
      return_3d_percent,
      price_after_5d,
      price_after_5d_date,
      return_5d_percent,
      latest_price,
      latest_price_date,
      latest_return_percent,
      outcome_label,
      outcome_description,
      is_success
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      stock_name = VALUES(stock_name),
      market_type = VALUES(market_type),
      industry = VALUES(industry),
      source_rank = VALUES(source_rank),
      strategy_score = VALUES(strategy_score),
      trigger_summary = VALUES(trigger_summary),
      entry_price = VALUES(entry_price),
      entry_price_date = VALUES(entry_price_date),
      price_after_1d = VALUES(price_after_1d),
      price_after_1d_date = VALUES(price_after_1d_date),
      return_1d_percent = VALUES(return_1d_percent),
      price_after_3d = VALUES(price_after_3d),
      price_after_3d_date = VALUES(price_after_3d_date),
      return_3d_percent = VALUES(return_3d_percent),
      price_after_5d = VALUES(price_after_5d),
      price_after_5d_date = VALUES(price_after_5d_date),
      return_5d_percent = VALUES(return_5d_percent),
      latest_price = VALUES(latest_price),
      latest_price_date = VALUES(latest_price_date),
      latest_return_percent = VALUES(latest_return_percent),
      outcome_label = VALUES(outcome_label),
      outcome_description = VALUES(outcome_description),
      is_success = VALUES(is_success),
      updated_at = CURRENT_TIMESTAMP
    `,
    [
      result.run_id,
      result.strategy_key,
      result.strategy_name,
      result.stock_code,
      result.stock_name,
      result.market_type,
      result.industry,
      result.signal_trade_date,
      result.source_rank,
      result.strategy_score,
      result.trigger_summary,
      result.entry_price,
      result.entry_price_date,
      result.price_after_1d,
      result.price_after_1d_date,
      result.return_1d_percent,
      result.price_after_3d,
      result.price_after_3d_date,
      result.return_3d_percent,
      result.price_after_5d,
      result.price_after_5d_date,
      result.return_5d_percent,
      result.latest_price,
      result.latest_price_date,
      result.latest_return_percent,
      result.outcome_label,
      result.outcome_description,
      result.is_success,
    ],
  );
}

function average(values) {
  const valid = values.filter((value) => value !== null && value !== undefined && Number.isFinite(Number(value)));
  if (!valid.length) return null;
  return round(valid.reduce((sum, value) => sum + Number(value), 0) / valid.length, 4);
}

function winRate(values) {
  const valid = values.filter((value) => value !== null && value !== undefined && Number.isFinite(Number(value)));
  if (!valid.length) return null;
  const wins = valid.filter((value) => Number(value) > 0).length;
  return round((wins / valid.length) * 100, 4);
}

function buildSummary(results) {
  const byStrategy = new Map();

  for (const result of results) {
    if (!byStrategy.has(result.strategy_key)) {
      byStrategy.set(result.strategy_key, {
        strategy_key: result.strategy_key,
        strategy_name: result.strategy_name,
        signal_count: 0,
        success_count: 0,
        neutral_count: 0,
        fail_count: 0,
        pending_count: 0,
        returns_1d: [],
        returns_3d: [],
        returns_5d: [],
        latest_returns: [],
      });
    }

    const item = byStrategy.get(result.strategy_key);
    item.signal_count += 1;
    if (result.outcome_label === "success") item.success_count += 1;
    else if (result.outcome_label === "fail") item.fail_count += 1;
    else if (result.outcome_label === "neutral") item.neutral_count += 1;
    else item.pending_count += 1;
    item.returns_1d.push(result.return_1d_percent);
    item.returns_3d.push(result.return_3d_percent);
    item.returns_5d.push(result.return_5d_percent);
    item.latest_returns.push(result.latest_return_percent);
  }

  const strategySummary = [...byStrategy.values()].map((item) => ({
    strategy_key: item.strategy_key,
    strategy_name: item.strategy_name,
    signal_count: item.signal_count,
    success_count: item.success_count,
    neutral_count: item.neutral_count,
    fail_count: item.fail_count,
    pending_count: item.pending_count,
    avg_return_1d: average(item.returns_1d),
    avg_return_3d: average(item.returns_3d),
    avg_return_5d: average(item.returns_5d),
    latest_avg_return: average(item.latest_returns),
    win_rate_1d: winRate(item.returns_1d),
    win_rate_3d: winRate(item.returns_3d),
    win_rate_5d: winRate(item.returns_5d),
  }));

  return {
    total_signal_count: results.length,
    success_count: results.filter((item) => item.outcome_label === "success").length,
    neutral_count: results.filter((item) => item.outcome_label === "neutral").length,
    fail_count: results.filter((item) => item.outcome_label === "fail").length,
    pending_count: results.filter((item) => item.outcome_label === "pending").length,
    avg_return_1d: average(results.map((item) => item.return_1d_percent)),
    avg_return_3d: average(results.map((item) => item.return_3d_percent)),
    avg_return_5d: average(results.map((item) => item.return_5d_percent)),
    latest_avg_return: average(results.map((item) => item.latest_return_percent)),
    win_rate_1d: winRate(results.map((item) => item.return_1d_percent)),
    win_rate_3d: winRate(results.map((item) => item.return_3d_percent)),
    win_rate_5d: winRate(results.map((item) => item.return_5d_percent)),
    by_strategy: strategySummary.sort((a, b) => (b.avg_return_5d ?? -9999) - (a.avg_return_5d ?? -9999)),
  };
}

async function createRun(conn, options, startDate, endDate, tradingDaysCount) {
  const runName = options.runName || `V1.3 策略回測 ${startDate} ~ ${endDate}`;
  const result = await conn.query(
    `
    INSERT INTO strategy_backtest_runs (
      run_name,
      start_date,
      end_date,
      market_type,
      strategy_key,
      limit_per_strategy,
      trading_days_count,
      params_json,
      status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'running')
    `,
    [
      runName,
      startDate,
      endDate,
      options.market || null,
      options.strategy || null,
      options.limitPerStrategy,
      tradingDaysCount,
      JSON.stringify(options),
    ],
  );

  return Number(result.insertId);
}

async function updateRunSuccess(conn, runId, summary, tradingDaysCount) {
  await conn.query(
    `
    UPDATE strategy_backtest_runs
    SET
      trading_days_count = ?,
      signal_count = ?,
      success_count = ?,
      neutral_count = ?,
      fail_count = ?,
      pending_count = ?,
      avg_return_1d = ?,
      avg_return_3d = ?,
      avg_return_5d = ?,
      win_rate_1d = ?,
      win_rate_3d = ?,
      win_rate_5d = ?,
      summary_json = ?,
      status = 'completed',
      completed_at = CURRENT_TIMESTAMP,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
    `,
    [
      tradingDaysCount,
      summary.total_signal_count,
      summary.success_count,
      summary.neutral_count,
      summary.fail_count,
      summary.pending_count,
      summary.avg_return_1d,
      summary.avg_return_3d,
      summary.avg_return_5d,
      summary.win_rate_1d,
      summary.win_rate_3d,
      summary.win_rate_5d,
      JSON.stringify(summary),
      runId,
    ],
  );
}

async function updateRunFailed(conn, runId, error) {
  if (!runId) return;

  await conn.query(
    `
    UPDATE strategy_backtest_runs
    SET status = 'failed', error_message = ?, completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
    `,
    [String(error?.message || error).slice(0, 2000), runId],
  );
}

async function generateStrategyBacktests(options) {
  let conn;
  let runId = null;

  try {
    conn = await pool.getConnection();
    await ensureBacktestTables(conn);

    const endDate = normalizeDate(options.endDate || getTaiwanToday(), "結束日期");
    const startDate = options.startDate || (await resolveDefaultStartDate(conn, endDate, options.maxTradingDays));
    const normalizedStartDate = normalizeDate(startDate, "開始日期");
    const tradingDates = await getTradingDates(conn, normalizedStartDate, endDate, options.maxTradingDays);

    if (!tradingDates.length) {
      throw new Error(`找不到 ${normalizedStartDate} ~ ${endDate} 的籌碼分數交易日資料，請先執行 npm run daily 或歷史回補。`);
    }

    const enabledStrategies = options.strategy
      ? STRATEGIES.filter((item) => item.key === options.strategy)
      : STRATEGIES;

    runId = await createRun(conn, options, tradingDates[0], tradingDates[tradingDates.length - 1], tradingDates.length);

    console.log("====================================");
    console.log("開始產生 V1.3-3-1 策略回測");
    console.log(`Run ID：${runId}`);
    console.log(`期間：${tradingDates[0]} ~ ${tradingDates[tradingDates.length - 1]}`);
    console.log(`交易日數：${tradingDates.length}`);
    console.log(`策略：${enabledStrategies.map((item) => item.name).join("、")}`);
    console.log(`每策略每日上限：${options.limitPerStrategy}`);
    console.log("====================================");

    const allResults = [];

    for (const signalDate of tradingDates) {
      for (const strategy of enabledStrategies) {
        const candidates = await getStrategyCandidates(conn, strategy.key, signalDate, options.market, options.limitPerStrategy);
        let rank = 1;

        for (const candidate of candidates) {
          const result = await buildBacktestResult(conn, runId, candidate, rank, endDate);
          await insertResult(conn, result);
          allResults.push(result);
          rank += 1;
        }
      }

      console.log(`${signalDate} 完成，目前累計 ${allResults.length} 筆訊號`);
    }

    const summary = buildSummary(allResults);
    await updateRunSuccess(conn, runId, summary, tradingDates.length);

    console.log("====================================");
    console.log("策略回測完成");
    console.log(`Run ID：${runId}`);
    console.log(`總訊號：${summary.total_signal_count} 筆`);
    console.log(`成功 / 觀察 / 失敗 / 待資料：${summary.success_count} / ${summary.neutral_count} / ${summary.fail_count} / ${summary.pending_count}`);
    console.log(`1日平均報酬：${summary.avg_return_1d ?? "無資料"}%`);
    console.log(`3日平均報酬：${summary.avg_return_3d ?? "無資料"}%`);
    console.log(`5日平均報酬：${summary.avg_return_5d ?? "無資料"}%`);
    console.log("策略統計：");
    for (const item of summary.by_strategy) {
      console.log(`- ${item.strategy_name}：${item.signal_count} 筆，5日平均 ${item.avg_return_5d ?? "無資料"}%，5日勝率 ${item.win_rate_5d ?? "無資料"}%`);
    }
    console.log("可用 SQL 檢查：");
    console.log(`SELECT * FROM strategy_backtest_runs WHERE id = ${runId};`);
    console.log(`SELECT * FROM strategy_backtest_results WHERE run_id = ${runId} ORDER BY return_5d_percent DESC LIMIT 20;`);

    return { runId, summary, tradingDays: tradingDates.length };
  } catch (error) {
    if (conn && runId) {
      await updateRunFailed(conn, runId, error);
    }
    throw error;
  } finally {
    if (conn) conn.release();
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  try {
    await generateStrategyBacktests(options);
  } catch (error) {
    console.error("產生 V1.3-3-1 策略回測失敗");
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

const isCliExecution = process.argv[1] && path.resolve(process.argv[1]) === __filename;

if (isCliExecution) {
  main();
}

export { generateStrategyBacktests };
