-- 雷達之星 Stock Radar V2.4 部位模擬與風險觀察
-- 可重複執行，不會破壞既有資料

CREATE TABLE IF NOT EXISTS `portfolio_plans` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `plan_name` VARCHAR(100) NOT NULL DEFAULT '主要部位計畫',
  `total_capital` DECIMAL(18,2) NOT NULL DEFAULT 0,
  `cash_amount` DECIMAL(18,2) NOT NULL DEFAULT 0,
  `target_position_pct` DECIMAL(8,4) NOT NULL DEFAULT 70.0000,
  `max_single_stock_pct` DECIMAL(8,4) NOT NULL DEFAULT 20.0000,
  `max_industry_pct` DECIMAL(8,4) NOT NULL DEFAULT 35.0000,
  `max_risk_exposure_pct` DECIMAL(8,4) NOT NULL DEFAULT 70.0000,
  `market_mode` VARCHAR(20) NOT NULL DEFAULT 'RANGE',
  `note` VARCHAR(500) NULL,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_portfolio_plans_user_active` (`user_id`, `is_active`),
  KEY `idx_portfolio_plans_market_mode` (`market_mode`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `portfolio_plan_positions` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `plan_id` BIGINT UNSIGNED NOT NULL,
  `stock_code` VARCHAR(20) NOT NULL,
  `stock_name` VARCHAR(100) NULL,
  `market_type` VARCHAR(20) NULL,
  `industry` VARCHAR(100) NULL,
  `planned_amount` DECIMAL(18,2) NOT NULL DEFAULT 0,
  `planned_price` DECIMAL(12,4) NULL,
  `planned_shares` DECIMAL(18,4) NOT NULL DEFAULT 0,
  `planned_lots` DECIMAL(18,4) NOT NULL DEFAULT 0,
  `target_weight_pct` DECIMAL(8,4) NOT NULL DEFAULT 0,
  `batch_no` INT NOT NULL DEFAULT 1,
  `batch_note` VARCHAR(500) NULL,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_portfolio_plan_positions_user_plan` (`user_id`, `plan_id`, `is_active`),
  KEY `idx_portfolio_plan_positions_stock` (`stock_code`),
  CONSTRAINT `fk_portfolio_plan_positions_plan` FOREIGN KEY (`plan_id`) REFERENCES `portfolio_plans` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `portfolio_risk_snapshots` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `plan_id` BIGINT UNSIGNED NOT NULL,
  `snapshot_date` DATE NOT NULL,
  `total_capital` DECIMAL(18,2) NOT NULL DEFAULT 0,
  `invested_amount` DECIMAL(18,2) NOT NULL DEFAULT 0,
  `cash_amount` DECIMAL(18,2) NOT NULL DEFAULT 0,
  `position_count` INT NOT NULL DEFAULT 0,
  `position_ratio_pct` DECIMAL(8,4) NOT NULL DEFAULT 0,
  `cash_ratio_pct` DECIMAL(8,4) NOT NULL DEFAULT 0,
  `largest_single_stock_pct` DECIMAL(8,4) NOT NULL DEFAULT 0,
  `largest_industry_pct` DECIMAL(8,4) NOT NULL DEFAULT 0,
  `risk_exposure_pct` DECIMAL(8,4) NOT NULL DEFAULT 0,
  `market_mode` VARCHAR(20) NOT NULL DEFAULT 'RANGE',
  `portfolio_risk_level` VARCHAR(20) NOT NULL DEFAULT 'NORMAL',
  `risk_summary` VARCHAR(500) NULL,
  `ai_action` VARCHAR(100) NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_portfolio_risk_snapshot` (`user_id`, `plan_id`, `snapshot_date`),
  KEY `idx_portfolio_risk_snapshots_user_date` (`user_id`, `snapshot_date`),
  KEY `idx_portfolio_risk_snapshots_level` (`portfolio_risk_level`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
