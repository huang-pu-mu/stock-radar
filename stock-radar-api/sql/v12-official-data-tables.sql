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

ALTER TABLE etf_profiles ADD COLUMN IF NOT EXISTS fund_type varchar(50) DEFAULT NULL COMMENT 'ETF 類型';
ALTER TABLE etf_profiles ADD COLUMN IF NOT EXISTS underlying_index varchar(100) DEFAULT NULL COMMENT '追蹤指數';
ALTER TABLE etf_profiles ADD COLUMN IF NOT EXISTS issuer varchar(80) DEFAULT NULL COMMENT '投信/發行人';
ALTER TABLE etf_profiles ADD COLUMN IF NOT EXISTS listing_date date DEFAULT NULL COMMENT '掛牌日期';
ALTER TABLE etf_profiles ADD COLUMN IF NOT EXISTS source varchar(100) NOT NULL DEFAULT 'OFFICIAL' COMMENT '資料來源';
ALTER TABLE etf_profiles ADD COLUMN IF NOT EXISTS source_url varchar(500) DEFAULT NULL COMMENT '來源網址';

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

-- V1.2-8 即時行情 / 五檔 / 大盤買賣力道快照資料表
-- 注意：真正即時行情資料需確認資料來源授權；此表設計為授權資料或手動匯入快照的儲存層。
CREATE TABLE IF NOT EXISTS realtime_quote_snapshots (
  id bigint(20) NOT NULL AUTO_INCREMENT,
  stock_code varchar(10) NOT NULL COMMENT '股票/ETF 代號',
  stock_name varchar(80) DEFAULT NULL COMMENT '股票/ETF 名稱',
  market_type varchar(20) DEFAULT NULL COMMENT '上市/上櫃',
  snapshot_at datetime NOT NULL COMMENT '快照時間',
  quote_date date DEFAULT NULL COMMENT '行情日期',
  quote_time time DEFAULT NULL COMMENT '行情時間',
  last_price decimal(12,4) DEFAULT NULL COMMENT '成交價/最新價',
  price_change decimal(12,4) DEFAULT NULL COMMENT '漲跌',
  price_change_percent decimal(12,4) DEFAULT NULL COMMENT '漲跌幅%',
  open_price decimal(12,4) DEFAULT NULL COMMENT '開盤價',
  high_price decimal(12,4) DEFAULT NULL COMMENT '最高價',
  low_price decimal(12,4) DEFAULT NULL COMMENT '最低價',
  previous_close decimal(12,4) DEFAULT NULL COMMENT '昨收價',
  total_volume bigint(20) DEFAULT NULL COMMENT '總成交股數',
  total_amount bigint(20) DEFAULT NULL COMMENT '總成交金額',
  inside_volume_lots decimal(18,2) DEFAULT NULL COMMENT '內盤成交張數',
  outside_volume_lots decimal(18,2) DEFAULT NULL COMMENT '外盤成交張數',
  buy_price_1 decimal(12,4) DEFAULT NULL COMMENT '委買一價',
  buy_volume_1 decimal(18,2) DEFAULT NULL COMMENT '委買一張數',
  buy_price_2 decimal(12,4) DEFAULT NULL COMMENT '委買二價',
  buy_volume_2 decimal(18,2) DEFAULT NULL COMMENT '委買二張數',
  buy_price_3 decimal(12,4) DEFAULT NULL COMMENT '委買三價',
  buy_volume_3 decimal(18,2) DEFAULT NULL COMMENT '委買三張數',
  buy_price_4 decimal(12,4) DEFAULT NULL COMMENT '委買四價',
  buy_volume_4 decimal(18,2) DEFAULT NULL COMMENT '委買四張數',
  buy_price_5 decimal(12,4) DEFAULT NULL COMMENT '委買五價',
  buy_volume_5 decimal(18,2) DEFAULT NULL COMMENT '委買五張數',
  sell_price_1 decimal(12,4) DEFAULT NULL COMMENT '委賣一價',
  sell_volume_1 decimal(18,2) DEFAULT NULL COMMENT '委賣一張數',
  sell_price_2 decimal(12,4) DEFAULT NULL COMMENT '委賣二價',
  sell_volume_2 decimal(18,2) DEFAULT NULL COMMENT '委賣二張數',
  sell_price_3 decimal(12,4) DEFAULT NULL COMMENT '委賣三價',
  sell_volume_3 decimal(18,2) DEFAULT NULL COMMENT '委賣三張數',
  sell_price_4 decimal(12,4) DEFAULT NULL COMMENT '委賣四價',
  sell_volume_4 decimal(18,2) DEFAULT NULL COMMENT '委賣四張數',
  sell_price_5 decimal(12,4) DEFAULT NULL COMMENT '委賣五價',
  sell_volume_5 decimal(18,2) DEFAULT NULL COMMENT '委賣五張數',
  source varchar(100) NOT NULL DEFAULT 'AUTHORIZED_SNAPSHOT' COMMENT '資料來源',
  source_url varchar(500) DEFAULT NULL COMMENT '來源網址',
  is_realtime tinyint(1) NOT NULL DEFAULT 0 COMMENT '是否為即時/近即時資料',
  raw_data longtext DEFAULT NULL COMMENT '原始資料 JSON',
  created_at datetime NOT NULL DEFAULT current_timestamp(),
  updated_at datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (id),
  UNIQUE KEY uq_realtime_quote_snapshot (stock_code, snapshot_at, source),
  KEY idx_realtime_quote_stock (stock_code),
  KEY idx_realtime_quote_snapshot_at (snapshot_at),
  KEY idx_realtime_quote_market (market_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='個股/ETF 即時行情與五檔快照表';

CREATE TABLE IF NOT EXISTS market_order_flow_snapshots (
  id bigint(20) NOT NULL AUTO_INCREMENT,
  snapshot_at datetime NOT NULL COMMENT '快照時間',
  market_type varchar(20) NOT NULL COMMENT '上市/上櫃',
  market_index decimal(12,4) DEFAULT NULL COMMENT '大盤指數',
  index_change decimal(12,4) DEFAULT NULL COMMENT '指數漲跌',
  total_buy_volume bigint(20) DEFAULT NULL COMMENT '市場委買量',
  total_sell_volume bigint(20) DEFAULT NULL COMMENT '市場委賣量',
  buy_sell_volume_diff bigint(20) DEFAULT NULL COMMENT '委買委賣量差',
  total_buy_amount bigint(20) DEFAULT NULL COMMENT '市場委買金額',
  total_sell_amount bigint(20) DEFAULT NULL COMMENT '市場委賣金額',
  buy_sell_amount_diff bigint(20) DEFAULT NULL COMMENT '委買委賣金額差',
  total_trade_amount bigint(20) DEFAULT NULL COMMENT '成交金額',
  source varchar(100) NOT NULL DEFAULT 'AUTHORIZED_SNAPSHOT' COMMENT '資料來源',
  source_url varchar(500) DEFAULT NULL COMMENT '來源網址',
  is_realtime tinyint(1) NOT NULL DEFAULT 0 COMMENT '是否為即時/近即時資料',
  raw_data longtext DEFAULT NULL COMMENT '原始資料 JSON',
  created_at datetime NOT NULL DEFAULT current_timestamp(),
  updated_at datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (id),
  UNIQUE KEY uq_market_order_flow_snapshot (snapshot_at, market_type, source),
  KEY idx_market_order_flow_market (market_type),
  KEY idx_market_order_flow_snapshot_at (snapshot_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='大盤買賣力道快照表';
