import pool from "../db.js";

async function main() {
  const conn = await pool.getConnection();

  try {
    console.log("開始同步 ETF 主檔");

    await conn.query(
      `
      UPDATE stocks
      SET security_type = 'ETF', industry = 'ETF'
      WHERE stock_code REGEXP '^00[0-9A-Z]+'
         OR industry = 'ETF'
         OR market_type = 'ETF'
      `,
    );

    const result = await conn.query(
      `
      INSERT INTO etf_profiles (
        stock_code,
        stock_name,
        market_type,
        fund_type,
        source,
        source_url
      )
      SELECT
        stock_code,
        stock_name,
        market_type,
        'ETF',
        'stocks table sync',
        'database:stocks'
      FROM stocks
      WHERE security_type = 'ETF'
         OR industry = 'ETF'
         OR stock_code REGEXP '^00[0-9A-Z]+'
      ON DUPLICATE KEY UPDATE
        stock_name = VALUES(stock_name),
        market_type = VALUES(market_type),
        fund_type = VALUES(fund_type),
        source = VALUES(source),
        source_url = VALUES(source_url),
        updated_at = CURRENT_TIMESTAMP
      `,
    );

    const countRows = await conn.query("SELECT COUNT(*) AS count FROM etf_profiles");
    console.log(`ETF 主檔同步完成，目前 ${countRows[0]?.count || 0} 筆`);
    if (result?.affectedRows !== undefined) console.log(`異動筆數：${result.affectedRows}`);
  } catch (error) {
    console.error("同步 ETF 主檔失敗");
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    conn.release();
    await pool.end();
  }
}

main();
