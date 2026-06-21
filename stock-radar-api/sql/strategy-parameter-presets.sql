-- V1.4-2：策略參數最佳化預設
CREATE TABLE IF NOT EXISTS strategy_parameter_presets (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  preset_key VARCHAR(64) NOT NULL,
  preset_name VARCHAR(120) NOT NULL,
  description VARCHAR(500) NULL,
  params_json JSON NOT NULL,
  is_default TINYINT(1) NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_strategy_parameter_presets_key (preset_key),
  KEY idx_strategy_parameter_presets_active (is_active, sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
