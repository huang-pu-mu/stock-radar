import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pool from "../db.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const sqlFilePath = path.join(__dirname, "..", "sql", "strategy-parameter-presets.sql");

const PRESETS = [
  {
    preset_key: "balanced",
    preset_name: "平衡參數",
    description: "保留 V1.3 的篩選精神，適合作為每日觀察基準。",
    is_default: 1,
    sort_order: 10,
    params: {
      min_strategy_score: 0,
      min_chip_score: 70,
      min_legal_score: 20,
      min_volume_score: 12,
      min_price_score: 8,
      min_total_net_lots: 1,
      min_large_holder_ratio_change: 0,
      event_window_days: 30,
    },
  },
  {
    preset_key: "conservative",
    preset_name: "保守參數",
    description: "提高分數與門檻，適合只想看較強訊號的情境。",
    is_default: 0,
    sort_order: 20,
    params: {
      min_strategy_score: 100,
      min_chip_score: 80,
      min_legal_score: 30,
      min_volume_score: 15,
      min_price_score: 10,
      min_total_net_lots: 500,
      min_large_holder_ratio_change: 0.5,
      event_window_days: 14,
    },
  },
  {
    preset_key: "aggressive",
    preset_name: "積極參數",
    description: "降低部分門檻，適合想先擴大觀察名單再人工篩選。",
    is_default: 0,
    sort_order: 30,
    params: {
      min_strategy_score: 0,
      min_chip_score: 60,
      min_legal_score: 10,
      min_volume_score: 8,
      min_price_score: 5,
      min_total_net_lots: 1,
      min_large_holder_ratio_change: 0,
      event_window_days: 45,
    },
  },
];

function splitSqlStatements(sqlText) {
  return sqlText
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      return trimmed && !trimmed.startsWith("--");
    })
    .join("\n")
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

async function main() {
  let conn;

  try {
    console.log("開始建立 V1.4-2 策略參數最佳化預設");
    const sqlText = await fs.readFile(sqlFilePath, "utf8");
    const statements = splitSqlStatements(sqlText);
    conn = await pool.getConnection();

    for (const statement of statements) {
      await conn.query(statement);
    }

    for (const preset of PRESETS) {
      await conn.query(
        `
        INSERT INTO strategy_parameter_presets (
          preset_key,
          preset_name,
          description,
          params_json,
          is_default,
          is_active,
          sort_order
        ) VALUES (?, ?, ?, ?, ?, 1, ?)
        ON DUPLICATE KEY UPDATE
          preset_name = VALUES(preset_name),
          description = VALUES(description),
          params_json = VALUES(params_json),
          is_default = VALUES(is_default),
          is_active = VALUES(is_active),
          sort_order = VALUES(sort_order),
          updated_at = CURRENT_TIMESTAMP
        `,
        [
          preset.preset_key,
          preset.preset_name,
          preset.description,
          JSON.stringify(preset.params),
          preset.is_default,
          preset.sort_order,
        ],
      );
    }

    console.log("建立完成：strategy_parameter_presets");
    console.log("已建立預設：平衡參數、保守參數、積極參數");
  } catch (error) {
    console.error("建立 V1.4-2 策略參數最佳化預設失敗");
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    if (conn) conn.release();
    await pool.end();
  }
}

main();
