-- V1.4-4-1 通知外送資料表
-- 使用方式：
-- 1. cd D:\code\stock-radar\stock-radar-api
-- 2. npm run notifications:setup
-- 3. 設定 LINE_CHANNEL_ACCESS_TOKEN 後，可在前端發送測試通知

CREATE TABLE IF NOT EXISTS `notification_channels` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `user_id` int(10) unsigned NOT NULL COMMENT '使用者 ID',
  `channel_type` varchar(32) NOT NULL COMMENT '通知通道：line/email/telegram',
  `channel_name` varchar(64) NOT NULL DEFAULT 'LINE 通知' COMMENT '通道顯示名稱',
  `destination_type` varchar(20) NOT NULL DEFAULT 'user' COMMENT 'LINE 目標類型：user/group/room',
  `destination_id` varchar(128) NOT NULL COMMENT 'LINE User ID / Group ID / Room ID',
  `is_enabled` tinyint(1) NOT NULL DEFAULT 1 COMMENT '是否啟用',
  `config_json` JSON DEFAULT NULL,
  `last_tested_at` datetime DEFAULT NULL COMMENT '最後測試時間',
  `last_error` text DEFAULT NULL COMMENT '最後錯誤訊息',
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_notification_channels_user_type_dest` (`user_id`,`channel_type`,`destination_id`),
  KEY `idx_notification_channels_user` (`user_id`,`channel_type`,`is_enabled`),
  CONSTRAINT `fk_notification_channels_user_id` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='V1.4 通知外送通道設定';

CREATE TABLE IF NOT EXISTS `notification_send_logs` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `user_id` int(10) unsigned NOT NULL COMMENT '使用者 ID',
  `channel_id` bigint(20) unsigned DEFAULT NULL COMMENT '通知通道 ID',
  `channel_type` varchar(32) NOT NULL COMMENT '通知通道：line/email/telegram',
  `template_key` varchar(64) NOT NULL DEFAULT 'manual_test' COMMENT '通知範本代號',
  `title` varchar(150) NOT NULL COMMENT '通知標題',
  `message_text` text NOT NULL COMMENT '通知內容',
  `status` varchar(20) NOT NULL DEFAULT 'pending' COMMENT 'pending/sent/failed',
  `provider_message_id` varchar(128) DEFAULT NULL COMMENT '外部平台訊息 ID',
  `error_message` text DEFAULT NULL COMMENT '錯誤訊息',
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_notification_logs_user_created` (`user_id`,`created_at`),
  KEY `idx_notification_logs_channel` (`channel_id`,`status`),
  CONSTRAINT `fk_notification_logs_user_id` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_notification_logs_channel_id` FOREIGN KEY (`channel_id`) REFERENCES `notification_channels` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='V1.4 通知外送紀錄';
