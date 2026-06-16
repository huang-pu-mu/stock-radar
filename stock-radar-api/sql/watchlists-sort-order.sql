-- 自選股排序欄位
-- 執行位置：MariaDB / HeidiSQL
-- 用途：讓每個 Google 帳號的自選股可以調整順序

ALTER TABLE watchlists
  ADD COLUMN IF NOT EXISTS sort_order INT UNSIGNED NOT NULL DEFAULT 0 AFTER note;

CREATE INDEX IF NOT EXISTS idx_watchlists_user_sort
  ON watchlists (user_id, sort_order, created_at);

UPDATE watchlists
SET sort_order = id * 10
WHERE sort_order = 0;
