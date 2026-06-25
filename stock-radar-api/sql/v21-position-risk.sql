CREATE TABLE IF NOT EXISTS `user_positions` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` INT UNSIGNED NOT NULL,
  `stock_code` VARCHAR(20) NOT NULL,
  `stock_name` VARCHAR(100) NULL,
  `market_type` VARCHAR(20) NULL,
  `buy_date` DATE NOT NULL,
  `buy_price` DECIMAL(12,2) NOT NULL DEFAULT 0,
  `shares` DECIMAL(18,2) NOT NULL DEFAULT 0 COMMENT '股數，1 張 = 1000 股',
  `lots` DECIMAL(12,3) NOT NULL DEFAULT 0 COMMENT '張數',
  `cost_amount` DECIMAL(18,2) NOT NULL DEFAULT 0,
  `stop_loss_price` DECIMAL(12,2) NULL,
  `take_profit_price` DECIMAL(12,2) NULL,
  `trailing_stop_price` DECIMAL(12,2) NULL,
  `note` VARCHAR(500) NULL,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_user_positions_user_active` (`user_id`, `is_active`, `created_at`),
  KEY `idx_user_positions_stock` (`stock_code`),
  KEY `idx_user_positions_buy_date` (`buy_date`),
  CONSTRAINT `fk_user_positions_user_id`
    FOREIGN KEY (`user_id`) REFERENCES `users`(`id`)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='V2.1 使用者持股清單';

CREATE TABLE IF NOT EXISTS `user_position_snapshots` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` INT UNSIGNED NOT NULL,
  `position_id` BIGINT UNSIGNED NOT NULL,
  `stock_code` VARCHAR(20) NOT NULL,
  `trade_date` DATE NOT NULL,
  `close_price` DECIMAL(12,2) NULL,
  `market_value` DECIMAL(18,2) NOT NULL DEFAULT 0,
  `cost_amount` DECIMAL(18,2) NOT NULL DEFAULT 0,
  `unrealized_profit_loss` DECIMAL(18,2) NOT NULL DEFAULT 0,
  `unrealized_profit_loss_pct` DECIMAL(12,4) NOT NULL DEFAULT 0,
  `stop_loss_price` DECIMAL(12,2) NULL,
  `take_profit_price` DECIMAL(12,2) NULL,
  `trailing_stop_price` DECIMAL(12,2) NULL,
  `distance_to_stop_loss_pct` DECIMAL(12,4) NULL,
  `distance_to_take_profit_pct` DECIMAL(12,4) NULL,
  `ai_strength_score` DECIMAL(6,2) NULL,
  `market_risk_score` DECIMAL(6,2) NULL,
  `global_risk_score` DECIMAL(6,2) NULL,
  `breakout_score` DECIMAL(6,2) NULL,
  `main_force_score` DECIMAL(6,2) NULL,
  `big_holder_trend_score` DECIMAL(6,2) NULL,
  `position_risk_level` VARCHAR(20) NOT NULL DEFAULT 'MEDIUM' COMMENT 'LOW / MEDIUM / HIGH / CRITICAL',
  `ai_action` VARCHAR(100) NOT NULL DEFAULT '可續抱',
  `ai_reason` VARCHAR(700) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_position_snapshot_position_date` (`position_id`, `trade_date`),
  KEY `idx_position_snapshots_user_date` (`user_id`, `trade_date`),
  KEY `idx_position_snapshots_stock_date` (`stock_code`, `trade_date`),
  KEY `idx_position_snapshots_risk` (`position_risk_level`, `trade_date`),
  CONSTRAINT `fk_position_snapshots_user_id`
    FOREIGN KEY (`user_id`) REFERENCES `users`(`id`)
    ON DELETE CASCADE,
  CONSTRAINT `fk_position_snapshots_position_id`
    FOREIGN KEY (`position_id`) REFERENCES `user_positions`(`id`)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='V2.1 持股每日損益與風險快照';

CREATE TABLE IF NOT EXISTS `position_risk_alerts` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` INT UNSIGNED NOT NULL,
  `position_id` BIGINT UNSIGNED NOT NULL,
  `stock_code` VARCHAR(20) NOT NULL,
  `alert_date` DATE NOT NULL,
  `alert_type` VARCHAR(50) NOT NULL COMMENT 'STOP_LOSS / TAKE_PROFIT / TRAILING_STOP / AI_WEAK / MARKET_RISK / POSITION_RISK',
  `alert_level` VARCHAR(20) NOT NULL DEFAULT 'MEDIUM' COMMENT 'LOW / MEDIUM / HIGH / CRITICAL',
  `alert_title` VARCHAR(120) NOT NULL,
  `alert_message` VARCHAR(700) NOT NULL,
  `is_read` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_position_alert_once` (`position_id`, `alert_date`, `alert_type`),
  KEY `idx_position_alerts_user_read` (`user_id`, `is_read`, `alert_date`),
  KEY `idx_position_alerts_level` (`alert_level`, `alert_date`),
  CONSTRAINT `fk_position_alerts_user_id`
    FOREIGN KEY (`user_id`) REFERENCES `users`(`id`)
    ON DELETE CASCADE,
  CONSTRAINT `fk_position_alerts_position_id`
    FOREIGN KEY (`position_id`) REFERENCES `user_positions`(`id`)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='V2.1 持股風控提醒';
