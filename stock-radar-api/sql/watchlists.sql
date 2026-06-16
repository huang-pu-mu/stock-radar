-- 自選股資料表
-- 執行位置：MariaDB / HeidiSQL
-- 用途：依 Google 登入後的 users.id 分開保存每個人的自選股

CREATE TABLE IF NOT EXISTS watchlists (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id INT UNSIGNED NOT NULL,
  stock_code VARCHAR(20) NOT NULL,
  note VARCHAR(255) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_watchlists_user_stock (user_id, stock_code),
  KEY idx_watchlists_user_created (user_id, created_at),
  KEY idx_watchlists_stock_code (stock_code),
  CONSTRAINT fk_watchlists_user_id
    FOREIGN KEY (user_id) REFERENCES users(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
