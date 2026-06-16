-- 將 stocks.industry 內的數字產業代碼轉成中文產業名稱
-- 執行一次即可；之後 npm run industries 也已改成會自動轉中文。

UPDATE stocks
SET industry = CASE CAST(TRIM(industry) AS UNSIGNED)
  WHEN 1 THEN '水泥工業'
  WHEN 2 THEN '食品工業'
  WHEN 3 THEN '塑膠工業'
  WHEN 4 THEN '紡織纖維'
  WHEN 5 THEN '電機機械'
  WHEN 6 THEN '電器電纜'
  WHEN 7 THEN '化學生技醫療'
  WHEN 8 THEN '玻璃陶瓷'
  WHEN 9 THEN '造紙工業'
  WHEN 10 THEN '鋼鐵工業'
  WHEN 11 THEN '橡膠工業'
  WHEN 12 THEN '汽車工業'
  WHEN 14 THEN '建材營造'
  WHEN 15 THEN '航運業'
  WHEN 16 THEN '觀光事業'
  WHEN 17 THEN '金融保險'
  WHEN 18 THEN '貿易百貨'
  WHEN 20 THEN '其他'
  WHEN 21 THEN '化學工業'
  WHEN 22 THEN '生技醫療業'
  WHEN 23 THEN '油電燃氣業'
  WHEN 24 THEN '半導體業'
  WHEN 25 THEN '電腦及週邊設備業'
  WHEN 26 THEN '光電業'
  WHEN 27 THEN '通信網路業'
  WHEN 28 THEN '電子零組件業'
  WHEN 29 THEN '電子通路業'
  WHEN 30 THEN '資訊服務業'
  WHEN 31 THEN '其他電子業'
  WHEN 32 THEN '文化創意業'
  WHEN 33 THEN '農業科技業'
  WHEN 34 THEN '電子商務'
  WHEN 35 THEN '綠能環保'
  WHEN 36 THEN '數位雲端'
  WHEN 37 THEN '運動休閒'
  WHEN 38 THEN '居家生活'
  ELSE industry
END,
updated_at = NOW()
WHERE TRIM(industry) REGEXP '^[0-9]+$';

SELECT industry, COUNT(*) AS count
FROM stocks
GROUP BY industry
ORDER BY count DESC;
