-- 雷達之星 Stock Radar V3.2 AI 每日推薦引擎
-- 定位：每日根據數據產生推薦候選股票；不串券商、不自動下單，所有交易仍需人工確認。

CREATE TABLE IF NOT EXISTS `ai_daily_recommendations` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `recommendation_date` DATE NOT NULL,
  `stock_code` VARCHAR(20) NOT NULL,
  `stock_name` VARCHAR(100) NULL,
  `market_type` VARCHAR(20) NULL,
  `industry` VARCHAR(100) NULL,
  `recommendation_rank` INT NOT NULL DEFAULT 0,
  `recommendation_type` VARCHAR(30) NOT NULL DEFAULT 'WATCH' COMMENT 'BUY / PULLBACK / WATCH / AVOID',
  `recommendation_label` VARCHAR(50) NOT NULL DEFAULT '觀察',
  `ai_buy_score` DECIMAL(8,4) NOT NULL DEFAULT 0,
  `entry_timing_score` DECIMAL(8,4) NOT NULL DEFAULT 0,
  `risk_adjusted_score` DECIMAL(8,4) NOT NULL DEFAULT 0,
  `chase_risk_score` DECIMAL(8,4) NOT NULL DEFAULT 0,
  `exit_risk_score` DECIMAL(8,4) NOT NULL DEFAULT 0,
  `ai_strength_score` DECIMAL(8,4) NULL,
  `market_risk_score` DECIMAL(8,4) NULL,
  `global_risk_score` DECIMAL(8,4) NULL,
  `chip_factor_score` DECIMAL(8,4) NULL,
  `technical_factor_score` DECIMAL(8,4) NULL,
  `main_force_factor_score` DECIMAL(8,4) NULL,
  `big_holder_factor_score` DECIMAL(8,4) NULL,
  `fundamental_factor_score` DECIMAL(8,4) NULL,
  `industry_fund_score` DECIMAL(8,4) NULL,
  `close_price` DECIMAL(18,4) NULL,
  `suggested_entry_low` DECIMAL(18,4) NULL,
  `suggested_entry_high` DECIMAL(18,4) NULL,
  `stop_loss_price` DECIMAL(18,4) NULL,
  `take_profit_price` DECIMAL(18,4) NULL,
  `position_sizing_note` VARCHAR(300) NULL,
  `recommend_reason` VARCHAR(900) NULL,
  `risk_control_plan` VARCHAR(900) NULL,
  `invalid_condition` VARCHAR(700) NULL,
  `line_summary` VARCHAR(900) NULL,
  `manual_confirm_required` TINYINT(1) NOT NULL DEFAULT 1 COMMENT '必須人工確認，不自動送券商、不自動下單',
  `source_signal_id` BIGINT UNSIGNED NULL,
  `source_module` VARCHAR(80) NOT NULL DEFAULT 'AI_SELECTION',
  `meta_json` LONGTEXT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_ai_daily_recommendation` (`recommendation_date`, `stock_code`),
  KEY `idx_ai_daily_recommendation_date_type` (`recommendation_date`, `recommendation_type`, `recommendation_rank`),
  KEY `idx_ai_daily_recommendation_score` (`recommendation_date`, `ai_buy_score`),
  KEY `idx_ai_daily_recommendation_market` (`market_type`, `recommendation_date`),
  KEY `idx_ai_daily_recommendation_manual` (`manual_confirm_required`, `recommendation_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='V3.2 AI 每日推薦主表';

CREATE TABLE IF NOT EXISTS `ai_recommendation_reasons` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `recommendation_id` BIGINT UNSIGNED NOT NULL,
  `reason_group` VARCHAR(50) NOT NULL,
  `reason_type` VARCHAR(50) NOT NULL DEFAULT 'POSITIVE' COMMENT 'POSITIVE / RISK / ENTRY / EXIT / INVALID',
  `reason_text` VARCHAR(500) NOT NULL,
  `sort_order` INT NOT NULL DEFAULT 100,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_ai_reason_recommendation` (`recommendation_id`, `sort_order`),
  KEY `idx_ai_reason_group` (`reason_group`, `reason_type`),
  CONSTRAINT `fk_ai_reason_recommendation`
    FOREIGN KEY (`recommendation_id`) REFERENCES `ai_daily_recommendations` (`id`)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='V3.2 AI 推薦理由明細';

CREATE TABLE IF NOT EXISTS `ai_recommendation_scores` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `recommendation_id` BIGINT UNSIGNED NOT NULL,
  `factor_key` VARCHAR(60) NOT NULL,
  `factor_name` VARCHAR(100) NOT NULL,
  `factor_score` DECIMAL(8,4) NOT NULL DEFAULT 0,
  `factor_weight` DECIMAL(8,4) NOT NULL DEFAULT 0,
  `weighted_score` DECIMAL(8,4) NOT NULL DEFAULT 0,
  `factor_note` VARCHAR(500) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_ai_score_factor` (`recommendation_id`, `factor_key`),
  KEY `idx_ai_score_key` (`factor_key`, `factor_score`),
  CONSTRAINT `fk_ai_score_recommendation`
    FOREIGN KEY (`recommendation_id`) REFERENCES `ai_daily_recommendations` (`id`)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='V3.2 AI 推薦因子分數明細';

CREATE TABLE IF NOT EXISTS `ai_recommendation_performance` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `recommendation_id` BIGINT UNSIGNED NOT NULL,
  `recommendation_date` DATE NOT NULL,
  `stock_code` VARCHAR(20) NOT NULL,
  `entry_close_price` DECIMAL(18,4) NULL,
  `return_1d_pct` DECIMAL(10,4) NULL,
  `return_3d_pct` DECIMAL(10,4) NULL,
  `return_5d_pct` DECIMAL(10,4) NULL,
  `return_10d_pct` DECIMAL(10,4) NULL,
  `max_return_pct` DECIMAL(10,4) NULL,
  `min_return_pct` DECIMAL(10,4) NULL,
  `performance_status` VARCHAR(30) NOT NULL DEFAULT 'WAITING' COMMENT 'WAITING / SUCCESS / PARTIAL / FAIL',
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_ai_perf_recommendation` (`recommendation_id`),
  KEY `idx_ai_perf_date_stock` (`recommendation_date`, `stock_code`),
  KEY `idx_ai_perf_status` (`performance_status`, `recommendation_date`),
  CONSTRAINT `fk_ai_perf_recommendation`
    FOREIGN KEY (`recommendation_id`) REFERENCES `ai_daily_recommendations` (`id`)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='V3.2 AI 推薦後績效追蹤';

CREATE TABLE IF NOT EXISTS `ai_recommendation_rules` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `rule_key` VARCHAR(80) NOT NULL,
  `rule_name` VARCHAR(120) NOT NULL,
  `rule_group` VARCHAR(60) NOT NULL DEFAULT 'GENERAL',
  `rule_value` VARCHAR(120) NOT NULL,
  `rule_description` VARCHAR(500) NULL,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_ai_recommendation_rule` (`rule_key`),
  KEY `idx_ai_recommendation_rule_group` (`rule_group`, `is_active`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='V3.2 AI 推薦規則門檻';

INSERT INTO `ai_recommendation_rules` (`rule_key`, `rule_name`, `rule_group`, `rule_value`, `rule_description`) VALUES
('BUY_SCORE_MIN', '可買進最低 AI Buy Score', 'THRESHOLD', '80', 'AI Buy Score >= 80 才能列入可買進候選。'),
('MARKET_RISK_MIN', '可買進最低 Market Risk Score', 'THRESHOLD', '60', '市場風險分數低於 60 時不列入可買進。'),
('GLOBAL_RISK_MIN', '可買進最低 Global Risk Score', 'THRESHOLD', '60', '全球風險分數低於 60 時不列入可買進。'),
('MAX_RECOMMENDATIONS', '每日推薦數量上限', 'OUTPUT', '10', '每日可買進與等拉回候選合計建議上限。'),
('MANUAL_CONFIRM_REQUIRED', '人工確認必要', 'SAFETY', '1', 'V3.2 僅提供建議，不自動下單。')
ON DUPLICATE KEY UPDATE
  `rule_value` = VALUES(`rule_value`),
  `rule_description` = VALUES(`rule_description`),
  `is_active` = 1,
  `updated_at` = CURRENT_TIMESTAMP;
