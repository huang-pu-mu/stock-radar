-- V1.3-1-1 自選股提醒資料表
-- 使用方式：
-- 1. cd D:\code\stock-radar\stock-radar-api
-- 2. npm run alerts:setup
-- 3. npm run alerts:generate

CREATE TABLE IF NOT EXISTS `watchlist_alert_rules` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `user_id` int(10) unsigned NOT NULL COMMENT '使用者 ID',
  `stock_code` varchar(20) NOT NULL COMMENT '股票 / ETF 代號',
  `is_active` tinyint(1) NOT NULL DEFAULT 1 COMMENT '是否啟用提醒規則',
  `foreign_buy_streak_enabled` tinyint(1) NOT NULL DEFAULT 1 COMMENT '外資連買提醒',
  `foreign_buy_streak_days` int(11) NOT NULL DEFAULT 3 COMMENT '外資連買門檻天數',
  `investment_trust_buy_streak_enabled` tinyint(1) NOT NULL DEFAULT 1 COMMENT '投信連買提醒',
  `investment_trust_buy_streak_days` int(11) NOT NULL DEFAULT 3 COMMENT '投信連買門檻天數',
  `major_holder_enabled` tinyint(1) NOT NULL DEFAULT 1 COMMENT '主力 / 大戶籌碼提醒',
  `major_holder_ratio_change_threshold` decimal(10,4) NOT NULL DEFAULT 0.3000 COMMENT '大戶持股比例增加門檻，單位：百分點',
  `volume_enabled` tinyint(1) NOT NULL DEFAULT 1 COMMENT '成交量放大提醒',
  `volume_ratio_threshold` decimal(10,4) NOT NULL DEFAULT 1.5000 COMMENT '成交量放大倍數門檻',
  `chip_score_enabled` tinyint(1) NOT NULL DEFAULT 1 COMMENT '籌碼分數達標提醒',
  `chip_score_threshold` int(11) NOT NULL DEFAULT 80 COMMENT '籌碼分數提醒門檻',
  `calendar_enabled` tinyint(1) NOT NULL DEFAULT 1 COMMENT '行事曆事件提醒',
  `calendar_days_before` int(11) NOT NULL DEFAULT 14 COMMENT '提前提醒天數',
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_watchlist_alert_rules_user_stock` (`user_id`,`stock_code`),
  KEY `idx_watchlist_alert_rules_stock` (`stock_code`),
  KEY `idx_watchlist_alert_rules_active` (`is_active`),
  CONSTRAINT `fk_watchlist_alert_rules_user_id` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='V1.3 自選股提醒規則表';

CREATE TABLE IF NOT EXISTS `watchlist_alerts` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `user_id` int(10) unsigned NOT NULL COMMENT '使用者 ID',
  `stock_code` varchar(20) NOT NULL COMMENT '股票 / ETF 代號',
  `stock_name` varchar(80) DEFAULT NULL COMMENT '股票 / ETF 名稱',
  `alert_date` date NOT NULL COMMENT '提醒分析日期，通常為最近交易日',
  `reference_date` date NOT NULL COMMENT '觸發資料日期，例如交易日、集保週資料日、行事曆事件日',
  `alert_type` varchar(50) NOT NULL COMMENT '提醒類型',
  `alert_level` varchar(20) NOT NULL DEFAULT 'normal' COMMENT '提醒等級：high/normal/low',
  `title` varchar(150) NOT NULL COMMENT '提醒標題',
  `message` text NOT NULL COMMENT '提醒內容',
  `metric_name` varchar(80) DEFAULT NULL COMMENT '指標名稱',
  `metric_value` decimal(20,4) DEFAULT NULL COMMENT '指標值',
  `threshold_value` decimal(20,4) DEFAULT NULL COMMENT '門檻值',
  `source_table` varchar(80) DEFAULT NULL COMMENT '來源資料表',
  `source_id` bigint(20) unsigned NOT NULL DEFAULT 0 COMMENT '來源資料 ID，非單筆來源時為 0',
  `is_read` tinyint(1) NOT NULL DEFAULT 0 COMMENT '是否已讀',
  `read_at` datetime DEFAULT NULL COMMENT '已讀時間',
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_watchlist_alert_unique` (`user_id`,`stock_code`,`alert_date`,`reference_date`,`alert_type`,`source_id`),
  KEY `idx_watchlist_alerts_user_date` (`user_id`,`alert_date`,`is_read`),
  KEY `idx_watchlist_alerts_stock` (`stock_code`),
  KEY `idx_watchlist_alerts_type` (`alert_type`),
  KEY `idx_watchlist_alerts_read` (`is_read`),
  CONSTRAINT `fk_watchlist_alerts_user_id` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='V1.3 自選股提醒結果表';
