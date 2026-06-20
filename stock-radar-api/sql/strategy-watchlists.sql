-- V1.3-2-3 策略追蹤資料表
-- 用途：記錄使用者從「策略選股」加入追蹤的股票與來源策略

CREATE TABLE IF NOT EXISTS strategy_watchlists (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id INT UNSIGNED NOT NULL,
  stock_code VARCHAR(20) NOT NULL,
  stock_name VARCHAR(100) NULL,
  market_type VARCHAR(20) NULL,
  industry VARCHAR(100) NULL,
  strategy_key VARCHAR(64) NOT NULL,
  strategy_name VARCHAR(100) NOT NULL,
  source_trade_date DATE NULL,
  source_score DECIMAL(12,4) NULL,
  source_rank INT UNSIGNED NULL,
  trigger_summary VARCHAR(500) NULL,
  note VARCHAR(255) NULL,
  take_profit_percent DECIMAL(8,4) NOT NULL DEFAULT 5.0000,
  stop_loss_percent DECIMAL(8,4) NOT NULL DEFAULT 3.0000,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_strategy_watchlists_user_stock_strategy (user_id, stock_code, strategy_key),
  KEY idx_strategy_watchlists_user_active (user_id, is_active, created_at),
  KEY idx_strategy_watchlists_user_strategy (user_id, strategy_key, is_active, created_at),
  KEY idx_strategy_watchlists_stock_code (stock_code),
  KEY idx_strategy_watchlists_source_trade_date (source_trade_date),
  CONSTRAINT fk_strategy_watchlists_user_id
    FOREIGN KEY (user_id) REFERENCES users(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
