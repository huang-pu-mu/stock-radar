-- Stock Radar V1.6 全球市場風險引擎
-- 可重複執行，不會刪除既有資料

CREATE TABLE IF NOT EXISTS `global_market_snapshots` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `trade_date` DATE NOT NULL,
  `snapshot_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `source` VARCHAR(80) NOT NULL DEFAULT 'Yahoo Finance Chart API',
  `source_url` VARCHAR(500) NULL,
  `global_risk_score` INT NOT NULL DEFAULT 70,
  `global_risk_level` VARCHAR(20) NOT NULL DEFAULT '正常',
  `global_market_mode` VARCHAR(20) NOT NULL DEFAULT 'RANGE',
  `us_market_status` VARCHAR(50) NULL,
  `technology_pressure` VARCHAR(50) NULL,
  `semiconductor_pressure` VARCHAR(50) NULL,
  `vix_status` VARCHAR(50) NULL,
  `dxy_status` VARCHAR(50) NULL,
  `us10y_status` VARCHAR(50) NULL,
  `opening_gap_probability` INT NOT NULL DEFAULT 50,
  `risk_summary` VARCHAR(500) NULL,
  `raw_json` LONGTEXT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_global_market_snapshot_date_source` (`trade_date`, `source`),
  KEY `idx_global_market_snapshot_date` (`trade_date`),
  KEY `idx_global_market_snapshot_score` (`global_risk_score`, `global_market_mode`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `global_market_components` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `snapshot_id` BIGINT UNSIGNED NOT NULL,
  `trade_date` DATE NOT NULL,
  `symbol` VARCHAR(30) NOT NULL,
  `display_name` VARCHAR(80) NOT NULL,
  `asset_type` VARCHAR(30) NOT NULL,
  `market_group` VARCHAR(30) NOT NULL,
  `last_price` DECIMAL(18,4) NULL,
  `previous_close` DECIMAL(18,4) NULL,
  `change_point` DECIMAL(18,4) NULL,
  `change_percent` DECIMAL(10,4) NULL,
  `risk_impact` INT NOT NULL DEFAULT 0,
  `risk_signal` VARCHAR(50) NULL,
  `source` VARCHAR(80) NOT NULL DEFAULT 'Yahoo Finance Chart API',
  `raw_json` LONGTEXT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_global_component_snapshot_symbol` (`snapshot_id`, `symbol`),
  KEY `idx_global_component_date_group` (`trade_date`, `market_group`),
  CONSTRAINT `fk_global_component_snapshot`
    FOREIGN KEY (`snapshot_id`) REFERENCES `global_market_snapshots` (`id`)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `global_risk_adjusted_scores` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `trade_date` DATE NOT NULL,
  `stock_code` VARCHAR(20) NOT NULL,
  `source_snapshot_id` BIGINT UNSIGNED NULL,
  `close_score` INT NOT NULL DEFAULT 0,
  `market_adjusted_score` INT NULL,
  `global_risk_score` INT NOT NULL DEFAULT 70,
  `global_risk_level` VARCHAR(20) NOT NULL DEFAULT '正常',
  `global_market_mode` VARCHAR(20) NOT NULL DEFAULT 'RANGE',
  `global_risk_weight` DECIMAL(6,4) NOT NULL DEFAULT 1.0000,
  `global_adjustment` INT NOT NULL DEFAULT 0,
  `global_adjusted_score` INT NOT NULL DEFAULT 0,
  `opening_gap_probability` INT NOT NULL DEFAULT 50,
  `technology_pressure` VARCHAR(50) NULL,
  `semiconductor_pressure` VARCHAR(50) NULL,
  `risk_summary` VARCHAR(500) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_global_adjusted_trade_stock` (`trade_date`, `stock_code`),
  KEY `idx_global_adjusted_trade_score` (`trade_date`, `global_adjusted_score`),
  KEY `idx_global_adjusted_stock_date` (`stock_code`, `trade_date`),
  CONSTRAINT `fk_global_adjusted_snapshot`
    FOREIGN KEY (`source_snapshot_id`) REFERENCES `global_market_snapshots` (`id`)
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
