-- V1.2 官方/資料庫化資料表
-- 目的：降低前台 API 對 Yahoo 頁面解析的依賴，改成優先讀資料庫。

ALTER TABLE stocks
  ADD COLUMN IF NOT EXISTS security_type varchar(20) NOT NULL DEFAULT 'STOCK' COMMENT 'STOCK/ETF'
  AFTER industry;

CREATE TABLE IF NOT EXISTS market_daily_summaries (
  id bigint(20) NOT NULL AUTO_INCREMENT,
  trade_date date NOT NULL COMMENT '交易日期',
  market_type varchar(20) NOT NULL COMMENT '上市/上櫃',
  trade_volume bigint(20) DEFAULT NULL COMMENT '成交股數',
  total_trade_amount bigint(20) DEFAULT NULL COMMENT '成交金額',
  transaction_count bigint(20) DEFAULT NULL COMMENT '成交筆數',
  daily_index_point decimal(12,2) DEFAULT NULL COMMENT '收盤指數',
  daily_change_point decimal(12,2) DEFAULT NULL COMMENT '指數漲跌點數',
  source varchar(100) NOT NULL DEFAULT 'DATABASE' COMMENT '資料來源',
  source_url varchar(500) DEFAULT NULL COMMENT '來源網址',
  created_at datetime NOT NULL DEFAULT current_timestamp(),
  updated_at datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (id),
  UNIQUE KEY uq_market_daily_summary (`trade_date`, `market_type`),
  KEY idx_market_daily_summary_date (`trade_date`),
  KEY idx_market_daily_summary_market (`market_type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='市場每日成交總覽表';

CREATE TABLE IF NOT EXISTS monthly_revenues (
  id bigint(20) NOT NULL AUTO_INCREMENT,
  stock_code varchar(10) NOT NULL COMMENT '股票代號',
  revenue_year int(11) NOT NULL COMMENT '營收年度',
  revenue_month int(11) NOT NULL COMMENT '營收月份',
  month_revenue_thousand bigint(20) DEFAULT NULL COMMENT '當月營收，仟元',
  month_over_month_percent decimal(12,4) DEFAULT NULL COMMENT '月增率%',
  last_year_month_revenue_thousand bigint(20) DEFAULT NULL COMMENT '去年同月營收，仟元',
  year_over_year_percent decimal(12,4) DEFAULT NULL COMMENT '年增率%',
  cumulative_revenue_thousand bigint(20) DEFAULT NULL COMMENT '累計營收，仟元',
  last_year_cumulative_revenue_thousand bigint(20) DEFAULT NULL COMMENT '去年累計營收，仟元',
  cumulative_year_over_year_percent decimal(12,4) DEFAULT NULL COMMENT '累計年增率%',
  note varchar(255) DEFAULT NULL COMMENT '備註',
  source varchar(100) NOT NULL DEFAULT 'MOPS OpenData' COMMENT '資料來源',
  source_url varchar(500) DEFAULT NULL COMMENT '來源網址',
  created_at datetime NOT NULL DEFAULT current_timestamp(),
  updated_at datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (id),
  UNIQUE KEY uq_monthly_revenue (`stock_code`, `revenue_year`, `revenue_month`),
  KEY idx_monthly_revenue_stock (`stock_code`),
  KEY idx_monthly_revenue_period (`revenue_year`, `revenue_month`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='每月營收資料表';

CREATE TABLE IF NOT EXISTS quarterly_eps (
  id bigint(20) NOT NULL AUTO_INCREMENT,
  stock_code varchar(10) NOT NULL COMMENT '股票代號',
  eps_year int(11) NOT NULL COMMENT '年度',
  eps_quarter int(11) NOT NULL COMMENT '季度',
  eps decimal(12,4) DEFAULT NULL COMMENT '每股盈餘 EPS',
  quarter_over_quarter_percent decimal(12,4) DEFAULT NULL COMMENT '季增率%',
  year_over_year_percent decimal(12,4) DEFAULT NULL COMMENT '年增率%',
  source varchar(100) NOT NULL DEFAULT 'MOPS OpenData' COMMENT '資料來源',
  source_url varchar(500) DEFAULT NULL COMMENT '來源網址',
  created_at datetime NOT NULL DEFAULT current_timestamp(),
  updated_at datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (id),
  UNIQUE KEY uq_quarterly_eps (`stock_code`, `eps_year`, `eps_quarter`),
  KEY idx_quarterly_eps_stock (`stock_code`),
  KEY idx_quarterly_eps_period (`eps_year`, `eps_quarter`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='每季 EPS 資料表';

CREATE TABLE IF NOT EXISTS stock_calendar_events (
  id bigint(20) NOT NULL AUTO_INCREMENT,
  stock_code varchar(10) NOT NULL COMMENT '股票/ETF 代號',
  event_date date NOT NULL COMMENT '事件日期',
  event_type varchar(50) NOT NULL COMMENT '事件類型',
  title varchar(120) NOT NULL COMMENT '事件標題',
  description text DEFAULT NULL COMMENT '事件說明',
  importance varchar(20) NOT NULL DEFAULT 'normal' COMMENT 'high/normal/low',
  source varchar(100) NOT NULL DEFAULT 'IMPORT' COMMENT '資料來源',
  source_url varchar(500) DEFAULT NULL COMMENT '來源網址',
  is_active tinyint(1) NOT NULL DEFAULT 1 COMMENT '是否啟用',
  created_at datetime NOT NULL DEFAULT current_timestamp(),
  updated_at datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (id),
  UNIQUE KEY uq_stock_calendar_event (`stock_code`, `event_date`, `event_type`, `title`),
  KEY idx_stock_calendar_stock (`stock_code`),
  KEY idx_stock_calendar_date (`event_date`),
  KEY idx_stock_calendar_type (`event_type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='個股/ETF 行事曆事件表';

CREATE TABLE IF NOT EXISTS etf_profiles (
  id bigint(20) NOT NULL AUTO_INCREMENT,
  stock_code varchar(10) NOT NULL COMMENT 'ETF 代號',
  stock_name varchar(80) NOT NULL COMMENT 'ETF 名稱',
  market_type varchar(20) DEFAULT NULL COMMENT '上市/上櫃',
  fund_type varchar(50) DEFAULT NULL COMMENT 'ETF 類型',
  underlying_index varchar(100) DEFAULT NULL COMMENT '追蹤指數',
  issuer varchar(80) DEFAULT NULL COMMENT '投信/發行人',
  listing_date date DEFAULT NULL COMMENT '掛牌日期',
  source varchar(100) NOT NULL DEFAULT 'OFFICIAL' COMMENT '資料來源',
  source_url varchar(500) DEFAULT NULL COMMENT '來源網址',
  created_at datetime NOT NULL DEFAULT current_timestamp(),
  updated_at datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (id),
  UNIQUE KEY uq_etf_profiles_code (`stock_code`),
  KEY idx_etf_profiles_market (`market_type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='ETF 主檔資料表';

CREATE TABLE IF NOT EXISTS institutional_amount_summaries (
  id bigint(20) NOT NULL AUTO_INCREMENT,
  trade_date date NOT NULL COMMENT '交易日期',
  market_type varchar(20) NOT NULL COMMENT '上市/上櫃',
  foreign_buy_amount bigint(20) DEFAULT 0 COMMENT '外資買進金額',
  foreign_sell_amount bigint(20) DEFAULT 0 COMMENT '外資賣出金額',
  foreign_net_amount bigint(20) DEFAULT 0 COMMENT '外資買賣超金額',
  investment_trust_buy_amount bigint(20) DEFAULT 0 COMMENT '投信買進金額',
  investment_trust_sell_amount bigint(20) DEFAULT 0 COMMENT '投信賣出金額',
  investment_trust_net_amount bigint(20) DEFAULT 0 COMMENT '投信買賣超金額',
  dealer_buy_amount bigint(20) DEFAULT 0 COMMENT '自營商買進金額',
  dealer_sell_amount bigint(20) DEFAULT 0 COMMENT '自營商賣出金額',
  dealer_net_amount bigint(20) DEFAULT 0 COMMENT '自營商買賣超金額',
  total_buy_amount bigint(20) DEFAULT 0 COMMENT '三大法人買進金額',
  total_sell_amount bigint(20) DEFAULT 0 COMMENT '三大法人賣出金額',
  total_net_amount bigint(20) DEFAULT 0 COMMENT '三大法人買賣超金額',
  source varchar(100) NOT NULL DEFAULT 'OFFICIAL' COMMENT '資料來源',
  source_url varchar(500) DEFAULT NULL COMMENT '來源網址',
  created_at datetime NOT NULL DEFAULT current_timestamp(),
  updated_at datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (id),
  UNIQUE KEY uq_institutional_amount_summary (`trade_date`, `market_type`),
  KEY idx_institutional_amount_date (`trade_date`),
  KEY idx_institutional_amount_market (`market_type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='三大法人每日買賣金額總覽表';
