import { query } from "../db.js";

export const MICROSTRUCTURE_TABLES = [
  {
    name: "realtime_quote_snapshots",
    sql: `
      CREATE TABLE IF NOT EXISTS realtime_quote_snapshots (
        id BIGINT NOT NULL AUTO_INCREMENT,
        stock_code VARCHAR(10) NOT NULL COMMENT '股票/ETF 代號',
        stock_name VARCHAR(80) DEFAULT NULL COMMENT '股票/ETF 名稱',
        market_type VARCHAR(20) DEFAULT NULL COMMENT '上市/上櫃',
        snapshot_at DATETIME NOT NULL COMMENT '快照時間',
        quote_date DATE DEFAULT NULL COMMENT '行情日期',
        quote_time TIME DEFAULT NULL COMMENT '行情時間',
        last_price DECIMAL(12,4) DEFAULT NULL COMMENT '成交價/最新價',
        price_change DECIMAL(12,4) DEFAULT NULL COMMENT '漲跌',
        price_change_percent DECIMAL(12,4) DEFAULT NULL COMMENT '漲跌幅%',
        open_price DECIMAL(12,4) DEFAULT NULL COMMENT '開盤價',
        high_price DECIMAL(12,4) DEFAULT NULL COMMENT '最高價',
        low_price DECIMAL(12,4) DEFAULT NULL COMMENT '最低價',
        previous_close DECIMAL(12,4) DEFAULT NULL COMMENT '昨收價',
        total_volume BIGINT DEFAULT NULL COMMENT '總成交股數',
        total_amount BIGINT DEFAULT NULL COMMENT '總成交金額',
        inside_volume_lots DECIMAL(18,2) DEFAULT NULL COMMENT '內盤成交張數',
        outside_volume_lots DECIMAL(18,2) DEFAULT NULL COMMENT '外盤成交張數',
        buy_price_1 DECIMAL(12,4) DEFAULT NULL COMMENT '委買一價',
        buy_volume_1 DECIMAL(18,2) DEFAULT NULL COMMENT '委買一張數',
        buy_price_2 DECIMAL(12,4) DEFAULT NULL COMMENT '委買二價',
        buy_volume_2 DECIMAL(18,2) DEFAULT NULL COMMENT '委買二張數',
        buy_price_3 DECIMAL(12,4) DEFAULT NULL COMMENT '委買三價',
        buy_volume_3 DECIMAL(18,2) DEFAULT NULL COMMENT '委買三張數',
        buy_price_4 DECIMAL(12,4) DEFAULT NULL COMMENT '委買四價',
        buy_volume_4 DECIMAL(18,2) DEFAULT NULL COMMENT '委買四張數',
        buy_price_5 DECIMAL(12,4) DEFAULT NULL COMMENT '委買五價',
        buy_volume_5 DECIMAL(18,2) DEFAULT NULL COMMENT '委買五張數',
        sell_price_1 DECIMAL(12,4) DEFAULT NULL COMMENT '委賣一價',
        sell_volume_1 DECIMAL(18,2) DEFAULT NULL COMMENT '委賣一張數',
        sell_price_2 DECIMAL(12,4) DEFAULT NULL COMMENT '委賣二價',
        sell_volume_2 DECIMAL(18,2) DEFAULT NULL COMMENT '委賣二張數',
        sell_price_3 DECIMAL(12,4) DEFAULT NULL COMMENT '委賣三價',
        sell_volume_3 DECIMAL(18,2) DEFAULT NULL COMMENT '委賣三張數',
        sell_price_4 DECIMAL(12,4) DEFAULT NULL COMMENT '委賣四價',
        sell_volume_4 DECIMAL(18,2) DEFAULT NULL COMMENT '委賣四張數',
        sell_price_5 DECIMAL(12,4) DEFAULT NULL COMMENT '委賣五價',
        sell_volume_5 DECIMAL(18,2) DEFAULT NULL COMMENT '委賣五張數',
        source VARCHAR(100) NOT NULL DEFAULT 'AUTHORIZED_SNAPSHOT' COMMENT '資料來源',
        source_url VARCHAR(500) DEFAULT NULL COMMENT '來源網址',
        is_realtime TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否為即時/近即時資料',
        raw_data LONGTEXT DEFAULT NULL COMMENT '原始資料 JSON',
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_realtime_quote_snapshot (stock_code, snapshot_at, source),
        KEY idx_realtime_quote_stock (stock_code),
        KEY idx_realtime_quote_snapshot_at (snapshot_at),
        KEY idx_realtime_quote_market (market_type)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='個股/ETF 即時行情與五檔快照表'
    `,
  },
  {
    name: "market_order_flow_snapshots",
    sql: `
      CREATE TABLE IF NOT EXISTS market_order_flow_snapshots (
        id BIGINT NOT NULL AUTO_INCREMENT,
        snapshot_at DATETIME NOT NULL COMMENT '快照時間',
        market_type VARCHAR(20) NOT NULL COMMENT '上市/上櫃',
        market_index DECIMAL(12,4) DEFAULT NULL COMMENT '大盤指數',
        index_change DECIMAL(12,4) DEFAULT NULL COMMENT '指數漲跌',
        total_buy_volume BIGINT DEFAULT NULL COMMENT '市場委買量',
        total_sell_volume BIGINT DEFAULT NULL COMMENT '市場委賣量',
        buy_sell_volume_diff BIGINT DEFAULT NULL COMMENT '委買委賣量差',
        total_buy_amount BIGINT DEFAULT NULL COMMENT '市場委買金額',
        total_sell_amount BIGINT DEFAULT NULL COMMENT '市場委賣金額',
        buy_sell_amount_diff BIGINT DEFAULT NULL COMMENT '委買委賣金額差',
        total_trade_amount BIGINT DEFAULT NULL COMMENT '成交金額',
        source VARCHAR(100) NOT NULL DEFAULT 'AUTHORIZED_SNAPSHOT' COMMENT '資料來源',
        source_url VARCHAR(500) DEFAULT NULL COMMENT '來源網址',
        is_realtime TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否為即時/近即時資料',
        raw_data LONGTEXT DEFAULT NULL COMMENT '原始資料 JSON',
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_market_order_flow_snapshot (snapshot_at, market_type, source),
        KEY idx_market_order_flow_market (market_type),
        KEY idx_market_order_flow_snapshot_at (snapshot_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='大盤買賣力道快照表'
    `,
  },
];

async function main() {
  console.log("====================================");
  console.log("Stock Radar V1.2 microstructure setup");
  console.log("====================================");

  for (const table of MICROSTRUCTURE_TABLES) {
    await query(table.sql);
    console.log(`✅ ${table.name} - 已確認`);
  }

  console.log("====================================");
  console.log("即時行情 / 五檔 / 大盤買賣力道資料表檢查完成");
  console.log("====================================");
  process.exit(0);
}

main().catch((error) => {
  console.error("❌ microstructure setup 失敗");
  console.error(error);
  process.exit(1);
});
