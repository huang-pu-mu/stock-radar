-- Stock Radar V3.0 實戰交易輔助系統
-- 可重複執行，不會刪除既有資料
-- 定位：交易計畫、人工確認、模擬下單與操作輔助，不做自動下單

CREATE TABLE IF NOT EXISTS `trading_assistant_accounts` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT UNSIGNED NOT NULL COMMENT 'Google 登入使用者 ID',
  `account_name` VARCHAR(100) NOT NULL DEFAULT '主要帳戶',
  `broker_name` VARCHAR(100) NULL,
  `account_type` VARCHAR(30) NOT NULL DEFAULT 'REAL' COMMENT 'REAL / PAPER / SIMULATION',
  `total_capital` DECIMAL(18,2) NOT NULL DEFAULT 0,
  `cash_balance` DECIMAL(18,2) NOT NULL DEFAULT 0,
  `default_risk_pct` DECIMAL(8,4) NOT NULL DEFAULT 2.0000,
  `note` VARCHAR(500) NULL,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_trading_assistant_accounts_user` (`user_id`, `is_active`),
  KEY `idx_trading_assistant_accounts_type` (`account_type`, `is_active`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='V3.0 交易輔助帳戶設定';

CREATE TABLE IF NOT EXISTS `trading_plans` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `account_id` BIGINT UNSIGNED NULL,
  `plan_date` DATE NOT NULL,
  `stock_code` VARCHAR(20) NOT NULL,
  `stock_name` VARCHAR(100) NULL,
  `market_type` VARCHAR(20) NULL,
  `plan_type` VARCHAR(20) NOT NULL DEFAULT 'WATCH' COMMENT 'BUY / SELL / WATCH / REDUCE',
  `strategy_source` VARCHAR(80) NOT NULL DEFAULT 'AI_MULTI_FACTOR',
  `planned_price` DECIMAL(18,4) NULL,
  `planned_shares` INT NOT NULL DEFAULT 0,
  `planned_lots` DECIMAL(12,4) NOT NULL DEFAULT 0,
  `stop_loss_price` DECIMAL(18,4) NULL,
  `take_profit_price` DECIMAL(18,4) NULL,
  `position_ratio_pct` DECIMAL(8,4) NOT NULL DEFAULT 0,
  `risk_amount` DECIMAL(18,2) NOT NULL DEFAULT 0,
  `ai_strength_score` DECIMAL(8,4) NULL,
  `market_mode` VARCHAR(20) NOT NULL DEFAULT 'RANGE',
  `plan_status` VARCHAR(30) NOT NULL DEFAULT 'PLANNED' COMMENT 'PLANNED / WAITING_CONFIRM / EXECUTED / CANCELLED',
  `user_confirmed` TINYINT(1) NOT NULL DEFAULT 0,
  `confirm_note` VARCHAR(500) NULL,
  `note` VARCHAR(800) NULL,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_trading_plans_user_date` (`user_id`, `plan_date`, `is_active`),
  KEY `idx_trading_plans_stock` (`stock_code`, `plan_date`),
  KEY `idx_trading_plans_status` (`plan_status`, `plan_date`),
  CONSTRAINT `fk_trading_plans_account`
    FOREIGN KEY (`account_id`) REFERENCES `trading_assistant_accounts` (`id`)
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='V3.0 交易計畫與人工確認';

CREATE TABLE IF NOT EXISTS `trading_plan_orders` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `plan_id` BIGINT UNSIGNED NOT NULL,
  `order_side` VARCHAR(20) NOT NULL DEFAULT 'BUY' COMMENT 'BUY / SELL',
  `order_type` VARCHAR(30) NOT NULL DEFAULT 'LIMIT' COMMENT 'LIMIT / MARKET / STOP',
  `order_price` DECIMAL(18,4) NULL,
  `order_shares` INT NOT NULL DEFAULT 0,
  `estimated_amount` DECIMAL(18,2) NOT NULL DEFAULT 0,
  `order_status` VARCHAR(30) NOT NULL DEFAULT 'DRAFT' COMMENT 'DRAFT / CONFIRMED / SENT_MANUAL / CANCELLED',
  `manual_confirm_required` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_trading_plan_orders_user` (`user_id`, `order_status`),
  KEY `idx_trading_plan_orders_plan` (`plan_id`),
  CONSTRAINT `fk_trading_plan_orders_plan`
    FOREIGN KEY (`plan_id`) REFERENCES `trading_plans` (`id`)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='V3.0 模擬下單草稿，不自動送券商';

CREATE TABLE IF NOT EXISTS `trading_assistant_recommendations` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `recommendation_date` DATE NOT NULL,
  `stock_code` VARCHAR(20) NULL,
  `stock_name` VARCHAR(100) NULL,
  `industry` VARCHAR(100) NULL,
  `recommendation_type` VARCHAR(30) NOT NULL DEFAULT 'WATCH' COMMENT 'WATCH / BUY_PLAN / REDUCE / RISK_CHECK',
  `priority` INT NOT NULL DEFAULT 50,
  `ai_strength_score` DECIMAL(8,4) NULL,
  `market_mode` VARCHAR(20) NOT NULL DEFAULT 'RANGE',
  `suggested_action` VARCHAR(300) NULL,
  `risk_note` VARCHAR(600) NULL,
  `plan_note` VARCHAR(800) NULL,
  `source_module` VARCHAR(80) NOT NULL DEFAULT 'WAR_ROOM',
  `meta_json` LONGTEXT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_trading_recommendations_date` (`recommendation_date`, `recommendation_type`, `priority`),
  KEY `idx_trading_recommendations_stock` (`stock_code`, `recommendation_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='V3.0 每日交易輔助建議';

CREATE TABLE IF NOT EXISTS `trading_assistant_reports` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `report_date` DATE NOT NULL,
  `market_mode` VARCHAR(20) NOT NULL DEFAULT 'RANGE',
  `recommendation_count` INT NOT NULL DEFAULT 0,
  `buy_plan_count` INT NOT NULL DEFAULT 0,
  `reduce_plan_count` INT NOT NULL DEFAULT 0,
  `risk_check_count` INT NOT NULL DEFAULT 0,
  `manual_confirm_count` INT NOT NULL DEFAULT 0,
  `action_summary` TEXT NULL,
  `line_message` TEXT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_trading_assistant_report_date` (`report_date`),
  KEY `idx_trading_assistant_report_mode` (`market_mode`, `report_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='V3.0 實戰交易輔助每日報告';
