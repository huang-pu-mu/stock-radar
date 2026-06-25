-- Stock Radar V2.5 每日投資作戰室
-- 可重複執行，不會刪除既有資料

CREATE TABLE IF NOT EXISTS `daily_war_room_reports` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `report_date` DATE NOT NULL COMMENT '作戰室報告日期',
  `market_mode` VARCHAR(20) NOT NULL DEFAULT 'RANGE' COMMENT 'BULL / RANGE / BEAR',
  `market_risk_score` DECIMAL(8,2) NULL,
  `global_risk_score` DECIMAL(8,2) NULL,
  `portfolio_risk_level` VARCHAR(20) NOT NULL DEFAULT 'NORMAL',
  `top_watch_count` INT NOT NULL DEFAULT 0,
  `hold_count` INT NOT NULL DEFAULT 0,
  `reduce_count` INT NOT NULL DEFAULT 0,
  `risk_alert_count` INT NOT NULL DEFAULT 0,
  `industry_strength_summary` VARCHAR(255) NULL,
  `market_summary` TEXT NULL,
  `global_summary` TEXT NULL,
  `position_summary` TEXT NULL,
  `ai_strategy_summary` TEXT NULL,
  `action_summary` TEXT NULL,
  `line_message` TEXT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_daily_war_room_report_date` (`report_date`),
  KEY `idx_daily_war_room_mode` (`market_mode`, `report_date`),
  KEY `idx_daily_war_room_risk` (`portfolio_risk_level`, `report_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='V2.5 每日投資作戰室主報告';

CREATE TABLE IF NOT EXISTS `daily_war_room_items` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `report_id` BIGINT UNSIGNED NOT NULL,
  `report_date` DATE NOT NULL,
  `section_type` VARCHAR(30) NOT NULL COMMENT 'MARKET / GLOBAL / WATCH / HOLD / REDUCE / RISK / INDUSTRY / ACTION',
  `stock_code` VARCHAR(20) NULL,
  `stock_name` VARCHAR(100) NULL,
  `industry` VARCHAR(100) NULL,
  `priority` INT NOT NULL DEFAULT 50,
  `score` DECIMAL(8,2) NULL,
  `title` VARCHAR(160) NOT NULL,
  `message` VARCHAR(800) NULL,
  `action_text` VARCHAR(300) NULL,
  `meta_json` LONGTEXT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_daily_war_room_items_report` (`report_id`, `section_type`, `priority`),
  KEY `idx_daily_war_room_items_date` (`report_date`, `section_type`, `priority`),
  KEY `idx_daily_war_room_items_stock` (`stock_code`, `report_date`),
  CONSTRAINT `fk_daily_war_room_items_report`
    FOREIGN KEY (`report_id`) REFERENCES `daily_war_room_reports` (`id`)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='V2.5 每日投資作戰室明細項目';
