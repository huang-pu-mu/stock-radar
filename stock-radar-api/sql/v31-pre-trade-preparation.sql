-- 雷達之星 Stock Radar V3.1 半自動交易前置準備
-- 定位：交易前檢查清單、人工確認、操作紀錄保存；不串券商、不自動下單。

CREATE TABLE IF NOT EXISTS `pre_trade_plans` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT UNSIGNED NULL,
  `plan_date` DATE NOT NULL,
  `stock_code` VARCHAR(20) NULL,
  `stock_name` VARCHAR(80) NULL,
  `industry` VARCHAR(80) NULL,
  `plan_type` VARCHAR(30) NOT NULL DEFAULT 'WATCH',
  `source_recommendation_id` BIGINT UNSIGNED NULL,
  `source_module` VARCHAR(60) NOT NULL DEFAULT 'TRADING_ASSISTANT',
  `entry_condition` TEXT NULL,
  `risk_control_plan` TEXT NULL,
  `stop_loss_price` DECIMAL(12,2) NULL,
  `take_profit_price` DECIMAL(12,2) NULL,
  `planned_price` DECIMAL(12,2) NULL,
  `planned_shares` INT NULL,
  `position_size_pct` DECIMAL(8,2) NULL,
  `max_risk_amount` DECIMAL(14,2) NULL,
  `manual_confirm_required` TINYINT(1) NOT NULL DEFAULT 1 COMMENT '必須人工確認，不自動送券商',
  `user_confirmed` TINYINT(1) NOT NULL DEFAULT 0,
  `confirmation_status` VARCHAR(30) NOT NULL DEFAULT 'PENDING',
  `compare_status` VARCHAR(30) NOT NULL DEFAULT 'WAITING',
  `actual_result_note` TEXT NULL,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_pre_trade_plan_date` (`plan_date`),
  KEY `idx_pre_trade_user` (`user_id`, `is_active`),
  KEY `idx_pre_trade_stock` (`stock_code`),
  KEY `idx_pre_trade_status` (`confirmation_status`, `compare_status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `pre_trade_check_items` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `plan_id` BIGINT UNSIGNED NOT NULL,
  `checklist_date` DATE NOT NULL,
  `check_group` VARCHAR(50) NOT NULL,
  `check_item` VARCHAR(200) NOT NULL,
  `check_status` VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  `is_required` TINYINT(1) NOT NULL DEFAULT 1,
  `sort_order` INT NOT NULL DEFAULT 100,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_pre_trade_check_plan` (`plan_id`),
  KEY `idx_pre_trade_check_date` (`checklist_date`, `check_group`),
  CONSTRAINT `fk_pre_trade_check_plan`
    FOREIGN KEY (`plan_id`) REFERENCES `pre_trade_plans` (`id`)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `pre_trade_action_logs` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT UNSIGNED NULL,
  `plan_id` BIGINT UNSIGNED NULL,
  `action_date` DATE NOT NULL,
  `action_type` VARCHAR(50) NOT NULL,
  `action_message` TEXT NOT NULL,
  `before_json` JSON NULL,
  `after_json` JSON NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_pre_trade_log_date` (`action_date`),
  KEY `idx_pre_trade_log_user` (`user_id`),
  KEY `idx_pre_trade_log_plan` (`plan_id`),
  CONSTRAINT `fk_pre_trade_log_plan`
    FOREIGN KEY (`plan_id`) REFERENCES `pre_trade_plans` (`id`)
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
