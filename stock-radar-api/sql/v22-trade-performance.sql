CREATE TABLE IF NOT EXISTS `user_trades` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` INT UNSIGNED NOT NULL,
  `position_id` BIGINT UNSIGNED NULL,
  `stock_code` VARCHAR(20) NOT NULL,
  `stock_name` VARCHAR(100) NULL,
  `market_type` VARCHAR(20) NULL,
  `trade_date` DATE NOT NULL,
  `trade_type` VARCHAR(10) NOT NULL COMMENT 'BUY / SELL',
  `trade_price` DECIMAL(12,2) NOT NULL DEFAULT 0,
  `shares` DECIMAL(18,2) NOT NULL DEFAULT 0 COMMENT '股數，1 張 = 1000 股',
  `lots` DECIMAL(12,3) NOT NULL DEFAULT 0 COMMENT '張數',
  `fee` DECIMAL(18,2) NOT NULL DEFAULT 0,
  `tax` DECIMAL(18,2) NOT NULL DEFAULT 0,
  `gross_amount` DECIMAL(18,2) NOT NULL DEFAULT 0,
  `net_amount` DECIMAL(18,2) NOT NULL DEFAULT 0 COMMENT '買進為成本流出，賣出為扣除費稅後流入',
  `strategy_source` VARCHAR(100) NULL COMMENT 'AI_MULTI_FACTOR / BREAKOUT / MAIN_FORCE / BIG_HOLDER / MANUAL',
  `ai_strength_score_at_trade` DECIMAL(6,2) NULL,
  `risk_score_at_trade` DECIMAL(6,2) NULL,
  `note` VARCHAR(500) NULL,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_user_trades_user_date` (`user_id`, `trade_date`, `id`),
  KEY `idx_user_trades_stock_date` (`stock_code`, `trade_date`),
  KEY `idx_user_trades_type` (`trade_type`, `trade_date`),
  KEY `idx_user_trades_strategy` (`strategy_source`, `trade_date`),
  CONSTRAINT `fk_user_trades_user_id`
    FOREIGN KEY (`user_id`) REFERENCES `users`(`id`)
    ON DELETE CASCADE,
  CONSTRAINT `fk_user_trades_position_id`
    FOREIGN KEY (`position_id`) REFERENCES `user_positions`(`id`)
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='V2.2 使用者交易紀錄';

CREATE TABLE IF NOT EXISTS `user_realized_trades` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` INT UNSIGNED NOT NULL,
  `source_trade_id` BIGINT UNSIGNED NOT NULL,
  `stock_code` VARCHAR(20) NOT NULL,
  `stock_name` VARCHAR(100) NULL,
  `market_type` VARCHAR(20) NULL,
  `buy_basis` VARCHAR(30) NOT NULL DEFAULT 'AVG_COST',
  `buy_avg_price` DECIMAL(12,4) NOT NULL DEFAULT 0,
  `sell_date` DATE NOT NULL,
  `sell_price` DECIMAL(12,2) NOT NULL DEFAULT 0,
  `shares` DECIMAL(18,2) NOT NULL DEFAULT 0,
  `cost_amount` DECIMAL(18,2) NOT NULL DEFAULT 0,
  `sell_gross_amount` DECIMAL(18,2) NOT NULL DEFAULT 0,
  `fee` DECIMAL(18,2) NOT NULL DEFAULT 0,
  `tax` DECIMAL(18,2) NOT NULL DEFAULT 0,
  `realized_profit_loss` DECIMAL(18,2) NOT NULL DEFAULT 0,
  `realized_profit_loss_pct` DECIMAL(12,4) NOT NULL DEFAULT 0,
  `holding_days_estimated` INT NULL,
  `strategy_source` VARCHAR(100) NULL,
  `ai_strength_score_at_trade` DECIMAL(6,2) NULL,
  `result_status` VARCHAR(20) NOT NULL DEFAULT 'FLAT' COMMENT 'WIN / LOSS / FLAT',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_realized_source_trade` (`source_trade_id`),
  KEY `idx_realized_user_date` (`user_id`, `sell_date`),
  KEY `idx_realized_stock_date` (`stock_code`, `sell_date`),
  KEY `idx_realized_strategy` (`strategy_source`, `sell_date`),
  CONSTRAINT `fk_realized_trades_user_id`
    FOREIGN KEY (`user_id`) REFERENCES `users`(`id`)
    ON DELETE CASCADE,
  CONSTRAINT `fk_realized_source_trade_id`
    FOREIGN KEY (`source_trade_id`) REFERENCES `user_trades`(`id`)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='V2.2 已實現損益紀錄';

CREATE TABLE IF NOT EXISTS `user_performance_snapshots` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` INT UNSIGNED NOT NULL,
  `snapshot_date` DATE NOT NULL,
  `total_trades` INT NOT NULL DEFAULT 0,
  `buy_trades` INT NOT NULL DEFAULT 0,
  `sell_trades` INT NOT NULL DEFAULT 0,
  `closed_trades` INT NOT NULL DEFAULT 0,
  `winning_trades` INT NOT NULL DEFAULT 0,
  `losing_trades` INT NOT NULL DEFAULT 0,
  `flat_trades` INT NOT NULL DEFAULT 0,
  `win_rate_pct` DECIMAL(12,4) NOT NULL DEFAULT 0,
  `total_buy_amount` DECIMAL(18,2) NOT NULL DEFAULT 0,
  `total_sell_amount` DECIMAL(18,2) NOT NULL DEFAULT 0,
  `realized_profit_loss` DECIMAL(18,2) NOT NULL DEFAULT 0,
  `avg_realized_profit_loss_pct` DECIMAL(12,4) NOT NULL DEFAULT 0,
  `avg_win_pct` DECIMAL(12,4) NOT NULL DEFAULT 0,
  `avg_loss_pct` DECIMAL(12,4) NOT NULL DEFAULT 0,
  `best_stock_code` VARCHAR(20) NULL,
  `worst_stock_code` VARCHAR(20) NULL,
  `best_strategy_source` VARCHAR(100) NULL,
  `performance_level` VARCHAR(20) NOT NULL DEFAULT 'NEUTRAL' COMMENT 'STRONG / GOOD / NEUTRAL / WEAK',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_performance_user_date` (`user_id`, `snapshot_date`),
  KEY `idx_performance_date` (`snapshot_date`),
  KEY `idx_performance_level` (`performance_level`, `snapshot_date`),
  CONSTRAINT `fk_performance_snapshots_user_id`
    FOREIGN KEY (`user_id`) REFERENCES `users`(`id`)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='V2.2 使用者交易績效快照';
