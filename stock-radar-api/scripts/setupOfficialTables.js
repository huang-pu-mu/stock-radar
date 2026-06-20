import { query } from "../db.js";

const TABLES = [
  {
    name: "market_daily_summaries",
    sql: `
      CREATE TABLE IF NOT EXISTS market_daily_summaries (
        id BIGINT NOT NULL AUTO_INCREMENT,
        trade_date DATE NOT NULL COMMENT '交易日期',
        market_type VARCHAR(20) NOT NULL COMMENT '上市/上櫃',
        trade_volume BIGINT DEFAULT NULL COMMENT '成交股數',
        total_trade_amount BIGINT DEFAULT NULL COMMENT '成交金額',
        transaction_count BIGINT DEFAULT NULL COMMENT '成交筆數',
        daily_index_point DECIMAL(12,2) DEFAULT NULL COMMENT '收盤指數',
        daily_change_point DECIMAL(12,2) DEFAULT NULL COMMENT '指數漲跌點數',
        source VARCHAR(100) NOT NULL DEFAULT 'DATABASE' COMMENT '資料來源',
        source_url VARCHAR(500) DEFAULT NULL COMMENT '來源網址',
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_market_daily_summary (trade_date, market_type),
        KEY idx_market_daily_summary_date (trade_date),
        KEY idx_market_daily_summary_market (market_type)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='市場每日成交總覽表'
    `,
  },
  {
    name: "monthly_revenues",
    sql: `
      CREATE TABLE IF NOT EXISTS monthly_revenues (
        id BIGINT NOT NULL AUTO_INCREMENT,
        stock_code VARCHAR(10) NOT NULL COMMENT '股票代號',
        revenue_year INT NOT NULL COMMENT '營收年度',
        revenue_month INT NOT NULL COMMENT '營收月份',
        month_revenue_thousand BIGINT DEFAULT NULL COMMENT '當月營收，仟元',
        month_over_month_percent DECIMAL(12,4) DEFAULT NULL COMMENT '月增率%',
        last_year_month_revenue_thousand BIGINT DEFAULT NULL COMMENT '去年同月營收，仟元',
        year_over_year_percent DECIMAL(12,4) DEFAULT NULL COMMENT '年增率%',
        cumulative_revenue_thousand BIGINT DEFAULT NULL COMMENT '累計營收，仟元',
        last_year_cumulative_revenue_thousand BIGINT DEFAULT NULL COMMENT '去年累計營收，仟元',
        cumulative_year_over_year_percent DECIMAL(12,4) DEFAULT NULL COMMENT '累計年增率%',
        note VARCHAR(255) DEFAULT NULL COMMENT '備註',
        source VARCHAR(100) NOT NULL DEFAULT 'MOPS OpenData' COMMENT '資料來源',
        source_url VARCHAR(500) DEFAULT NULL COMMENT '來源網址',
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_monthly_revenue (stock_code, revenue_year, revenue_month),
        KEY idx_monthly_revenue_stock (stock_code),
        KEY idx_monthly_revenue_period (revenue_year, revenue_month)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='每月營收資料表'
    `,
  },
  {
    name: "quarterly_eps",
    sql: `
      CREATE TABLE IF NOT EXISTS quarterly_eps (
        id BIGINT NOT NULL AUTO_INCREMENT,
        stock_code VARCHAR(10) NOT NULL COMMENT '股票代號',
        eps_year INT NOT NULL COMMENT '年度',
        eps_quarter INT NOT NULL COMMENT '季度',
        eps DECIMAL(12,4) DEFAULT NULL COMMENT '每股盈餘 EPS',
        quarter_over_quarter_percent DECIMAL(12,4) DEFAULT NULL COMMENT '季增率%',
        year_over_year_percent DECIMAL(12,4) DEFAULT NULL COMMENT '年增率%',
        source VARCHAR(100) NOT NULL DEFAULT 'MOPS OpenData' COMMENT '資料來源',
        source_url VARCHAR(500) DEFAULT NULL COMMENT '來源網址',
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_quarterly_eps (stock_code, eps_year, eps_quarter),
        KEY idx_quarterly_eps_stock (stock_code),
        KEY idx_quarterly_eps_period (eps_year, eps_quarter)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='每季 EPS 資料表'
    `,
  },
  {
    name: "stock_calendar_events",
    sql: `
      CREATE TABLE IF NOT EXISTS stock_calendar_events (
        id BIGINT NOT NULL AUTO_INCREMENT,
        stock_code VARCHAR(10) NOT NULL COMMENT '股票/ETF 代號',
        stock_name VARCHAR(80) DEFAULT NULL COMMENT '股票/ETF 名稱',
        event_date DATE NOT NULL COMMENT '事件日期',
        event_type VARCHAR(50) NOT NULL COMMENT '事件類型',
        title VARCHAR(255) DEFAULT NULL COMMENT '事件標題',
        cash_dividend DECIMAL(12,4) DEFAULT NULL COMMENT '現金股利',
        stock_dividend DECIMAL(12,4) DEFAULT NULL COMMENT '股票股利',
        ex_right_date DATE DEFAULT NULL COMMENT '除權日',
        ex_dividend_date DATE DEFAULT NULL COMMENT '除息日',
        record_date DATE DEFAULT NULL COMMENT '停止過戶日/基準日',
        payment_date DATE DEFAULT NULL COMMENT '發放日',
        meeting_date DATE DEFAULT NULL COMMENT '股東會/法說會日期',
        source VARCHAR(100) NOT NULL DEFAULT 'OFFICIAL' COMMENT '資料來源',
        source_url VARCHAR(500) DEFAULT NULL COMMENT '來源網址',
        raw_data LONGTEXT DEFAULT NULL COMMENT '原始資料 JSON',
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_stock_calendar_event (stock_code, event_date, event_type, title),
        KEY idx_stock_calendar_stock (stock_code),
        KEY idx_stock_calendar_date (event_date),
        KEY idx_stock_calendar_type (event_type)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='個股/ETF 行事曆事件表'
    `,
  },
  {
    name: "etf_profiles",
    sql: `
      CREATE TABLE IF NOT EXISTS etf_profiles (
        id BIGINT NOT NULL AUTO_INCREMENT,
        stock_code VARCHAR(10) NOT NULL COMMENT 'ETF 代號',
        stock_name VARCHAR(80) NOT NULL COMMENT 'ETF 名稱',
        market_type VARCHAR(20) DEFAULT NULL COMMENT '上市/上櫃',
        fund_type VARCHAR(50) DEFAULT NULL COMMENT 'ETF 類型',
        underlying_index VARCHAR(100) DEFAULT NULL COMMENT '追蹤指數',
        issuer VARCHAR(80) DEFAULT NULL COMMENT '投信/發行人',
        listing_date DATE DEFAULT NULL COMMENT '掛牌日期',
        source VARCHAR(100) NOT NULL DEFAULT 'OFFICIAL' COMMENT '資料來源',
        source_url VARCHAR(500) DEFAULT NULL COMMENT '來源網址',
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_etf_profiles_code (stock_code),
        KEY idx_etf_profiles_market (market_type)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='ETF 主檔資料表'
    `,
  },
  {
    name: "institutional_amount_summaries",
    sql: `
      CREATE TABLE IF NOT EXISTS institutional_amount_summaries (
        id BIGINT NOT NULL AUTO_INCREMENT,
        trade_date DATE NOT NULL COMMENT '交易日期',
        market_type VARCHAR(20) NOT NULL COMMENT '上市/上櫃',
        foreign_buy_amount BIGINT DEFAULT 0 COMMENT '外資買進金額',
        foreign_sell_amount BIGINT DEFAULT 0 COMMENT '外資賣出金額',
        foreign_net_amount BIGINT DEFAULT 0 COMMENT '外資買賣超金額',
        investment_trust_buy_amount BIGINT DEFAULT 0 COMMENT '投信買進金額',
        investment_trust_sell_amount BIGINT DEFAULT 0 COMMENT '投信賣出金額',
        investment_trust_net_amount BIGINT DEFAULT 0 COMMENT '投信買賣超金額',
        dealer_buy_amount BIGINT DEFAULT 0 COMMENT '自營商買進金額',
        dealer_sell_amount BIGINT DEFAULT 0 COMMENT '自營商賣出金額',
        dealer_net_amount BIGINT DEFAULT 0 COMMENT '自營商買賣超金額',
        total_buy_amount BIGINT DEFAULT 0 COMMENT '三大法人買進金額',
        total_sell_amount BIGINT DEFAULT 0 COMMENT '三大法人賣出金額',
        total_net_amount BIGINT DEFAULT 0 COMMENT '三大法人買賣超金額',
        source VARCHAR(100) NOT NULL DEFAULT 'OFFICIAL' COMMENT '資料來源',
        source_url VARCHAR(500) DEFAULT NULL COMMENT '來源網址',
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_institutional_amount_summary (trade_date, market_type),
        KEY idx_institutional_amount_date (trade_date),
        KEY idx_institutional_amount_market (market_type)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='三大法人每日買賣金額總覽表'
    `,
  },
];

async function columnExists(tableName, columnName) {
  const rows = await query(
    `
      SELECT COUNT(*) AS count
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?
        AND COLUMN_NAME = ?
    `,
    [tableName, columnName]
  );

  return Number(rows?.[0]?.count || 0) > 0;
}

async function ensureStocksSecurityType() {
  const exists = await columnExists("stocks", "security_type");

  if (exists) {
    console.log("✅ stocks.security_type - 已存在");
    return;
  }

  await query(`
    ALTER TABLE stocks
    ADD COLUMN security_type VARCHAR(20) NOT NULL DEFAULT 'STOCK' COMMENT '證券類型：STOCK / ETF'
  `);

  console.log("✅ stocks.security_type - 已新增");
}

async function ensureEtfProfileColumns() {
  const requiredColumns = [
    ["fund_type", "VARCHAR(50) DEFAULT NULL COMMENT 'ETF 類型'"],
    ["underlying_index", "VARCHAR(100) DEFAULT NULL COMMENT '追蹤指數'"],
    ["issuer", "VARCHAR(80) DEFAULT NULL COMMENT '投信/發行人'"],
    ["listing_date", "DATE DEFAULT NULL COMMENT '掛牌日期'"],
    ["source", "VARCHAR(100) NOT NULL DEFAULT 'OFFICIAL' COMMENT '資料來源'"],
    ["source_url", "VARCHAR(500) DEFAULT NULL COMMENT '來源網址'"],
  ];

  for (const [columnName, definition] of requiredColumns) {
    const exists = await columnExists("etf_profiles", columnName);

    if (exists) {
      console.log(`✅ etf_profiles.${columnName} - 已存在`);
      continue;
    }

    await query(`ALTER TABLE etf_profiles ADD COLUMN ${columnName} ${definition}`);
    console.log(`✅ etf_profiles.${columnName} - 已新增`);
  }
}

async function main() {
  console.log("====================================");
  console.log("Stock Radar V1.2 official setup");
  console.log("====================================");

  for (const table of TABLES) {
    await query(table.sql);
    console.log(`✅ ${table.name} - 已確認`);
  }

  await ensureStocksSecurityType();
  await ensureEtfProfileColumns();

  console.log("====================================");
  console.log("V1.2 official 資料表檢查完成");
  console.log("====================================");
  process.exit(0);
}

main().catch((error) => {
  console.error("❌ V1.2 official setup 失敗");
  console.error(error);
  process.exit(1);
});
