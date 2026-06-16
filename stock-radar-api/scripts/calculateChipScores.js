import pool from "../db.js";

function getTaiwanToday() {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Taipei",
  }).format(new Date());
}

function normalizeDate(inputDate) {
  const dateText = inputDate || getTaiwanToday();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateText)) {
    throw new Error("日期格式錯誤，請使用 YYYY-MM-DD，例如 2026-06-16");
  }

  return dateText;
}

function number(value) {
  if (value === null || value === undefined) return 0;

  const result = Number(value);

  return Number.isNaN(result) ? 0 : result;
}

function average(values, minimumCount = 1) {
  const valid = values.map(number).filter((value) => value > 0);

  if (valid.length < minimumCount) return 0;

  return valid.reduce((sum, value) => sum + value, 0) / valid.length;
}

function sum(values) {
  return values.map(number).reduce((total, value) => total + value, 0);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function positiveStreak(rows, fieldName) {
  let count = 0;

  for (const row of rows) {
    if (number(row[fieldName]) > 0) {
      count++;
    } else {
      break;
    }
  }

  return count;
}

function getInstitutionStatus(label, latestNet, streak, fiveDayNet) {
  if (streak >= 3) return `${label}連買${streak}天`;
  if (streak === 2) return `${label}連買2天`;
  if (latestNet > 0 && fiveDayNet > 0) return `${label}偏多`;
  if (latestNet > 0) return `${label}轉買`;
  if (latestNet < 0) return `${label}賣超`;

  return `${label}中性`;
}

function getVolumeStatus(latestVolume, avg20Volume) {
  if (!latestVolume) return "量能資料不足";
  if (!avg20Volume) return "量能歷史不足";
  if (latestVolume >= avg20Volume * 2) return "爆量";
  if (latestVolume >= avg20Volume * 1.5) return "明顯量增";
  if (latestVolume >= avg20Volume * 1.2) return "溫和量增";
  if (latestVolume < avg20Volume * 0.7) return "量縮";

  return "量能正常";
}

function getPricePosition(closePrice, ma5, ma10, high20, low20) {
  if (!closePrice) return "股價資料不足";

  if (high20 > 0 && closePrice >= high20) return "突破20日高點";
  if (high20 > 0 && closePrice >= high20 * 0.97) return "接近20日高點";
  if (ma5 > 0 && ma10 > 0 && closePrice >= ma5 && closePrice >= ma10) {
    return "站上短期均線";
  }
  if (low20 > 0 && closePrice <= low20 * 1.05) return "低檔整理";

  return "歷史資料不足";
}

function calculateScore(prices, institutionalRows) {
  const latestPrice = prices[0];
  const previousPrice = prices[1] || null;

  const latestClose = number(latestPrice.close_price);
  const previousClose = previousPrice ? number(previousPrice.close_price) : 0;
  const latestVolume = number(latestPrice.volume);

  const closeList = prices.map((row) => number(row.close_price));
  const volumeList = prices.map((row) => number(row.volume));
  const highList = prices.map((row) =>
    number(row.high_price || row.close_price),
  );
  const lowList = prices.map((row) => number(row.low_price || row.close_price));

  const ma5 = average(closeList.slice(0, 5), 5);
  const ma10 = average(closeList.slice(0, 10), 10);
  const ma20 = average(closeList.slice(0, 20), 20);

  const avg5Volume = average(volumeList.slice(0, 5), 5);
  const avg20Volume = average(volumeList.slice(0, 20), 20);

  const validHighList = highList.filter((value) => value > 0);
  const validLowList = lowList.filter((value) => value > 0);

  const high20 =
    validHighList.length >= 20 ? Math.max(...validHighList.slice(0, 20)) : 0;

  const low20 =
    validLowList.length >= 20 ? Math.min(...validLowList.slice(0, 20)) : 0;

  const latestInstitution = institutionalRows[0] || {};

  const latestForeignNet = number(latestInstitution.foreign_net);
  const latestTrustNet = number(latestInstitution.investment_trust_net);
  const latestDealerNet = number(latestInstitution.dealer_net);
  const latestTotalNet = number(latestInstitution.total_net);

  const foreign5Net = sum(
    institutionalRows.slice(0, 5).map((row) => row.foreign_net),
  );

  const trust5Net = sum(
    institutionalRows.slice(0, 5).map((row) => row.investment_trust_net),
  );

  const dealer3Net = sum(
    institutionalRows.slice(0, 3).map((row) => row.dealer_net),
  );

  const foreignStreak = positiveStreak(institutionalRows, "foreign_net");
  const trustStreak = positiveStreak(institutionalRows, "investment_trust_net");

  let foreignScore = 0;

  if (latestForeignNet > 0) foreignScore += 8;
  if (latestForeignNet < 0) foreignScore -= 4;
  if (foreignStreak >= 2) foreignScore += Math.min(foreignStreak * 3, 9);
  if (latestVolume > 0 && latestForeignNet > latestVolume * 0.05) {
    foreignScore += 6;
  } else if (latestVolume > 0 && latestForeignNet > latestVolume * 0.02) {
    foreignScore += 3;
  }
  if (foreign5Net > 0) foreignScore += 4;

  foreignScore = clamp(foreignScore, 0, 25);

  let investmentTrustScore = 0;

  if (latestTrustNet > 0) investmentTrustScore += 10;
  if (latestTrustNet < 0) investmentTrustScore -= 4;
  if (trustStreak >= 2) {
    investmentTrustScore += Math.min(trustStreak * 4, 10);
  }
  if (trust5Net > 0) investmentTrustScore += 5;

  investmentTrustScore = clamp(investmentTrustScore, 0, 25);

  let dealerScore = 0;

  if (latestDealerNet > 0) dealerScore += 4;
  if (dealer3Net > 0) dealerScore += 3;
  if (latestTotalNet > 0) dealerScore += 3;

  dealerScore = clamp(dealerScore, 0, 10);

  let volumeScore = 0;

  if (avg20Volume > 0) {
    if (latestVolume >= avg20Volume * 2) volumeScore += 12;
    else if (latestVolume >= avg20Volume * 1.5) volumeScore += 9;
    else if (latestVolume >= avg20Volume * 1.2) volumeScore += 5;
  }

  if (avg5Volume > 0 && latestVolume >= avg5Volume) volumeScore += 4;
  if (previousClose > 0 && latestClose > previousClose) volumeScore += 4;

  volumeScore = clamp(volumeScore, 0, 20);

  let priceScore = 0;

  if (ma5 > 0 && latestClose >= ma5) priceScore += 5;
  if (ma10 > 0 && latestClose >= ma10) priceScore += 5;
  if (ma20 > 0 && latestClose >= ma20) priceScore += 4;
  if (high20 > 0 && latestClose >= high20 * 0.97) priceScore += 4;
  if (previousClose > 0 && latestClose > previousClose) priceScore += 2;

  priceScore = clamp(priceScore, 0, 20);

  const bigHolderScore = 0;

  const chipScore = clamp(
    foreignScore +
      investmentTrustScore +
      dealerScore +
      volumeScore +
      priceScore +
      bigHolderScore,
    0,
    100,
  );

  return {
    chipScore,
    foreignScore,
    investmentTrustScore,
    dealerScore,
    volumeScore,
    priceScore,
    bigHolderScore,
    foreignStatus: getInstitutionStatus(
      "外資",
      latestForeignNet,
      foreignStreak,
      foreign5Net,
    ),
    investmentTrustStatus: getInstitutionStatus(
      "投信",
      latestTrustNet,
      trustStreak,
      trust5Net,
    ),
    dealerStatus:
      latestDealerNet > 0
        ? "自營商買超"
        : latestDealerNet < 0
          ? "自營商賣超"
          : "自營商中性",
    bigHolderStatus: "尚未匯入大戶資料",
    volumeStatus: getVolumeStatus(latestVolume, avg20Volume),
    pricePosition: getPricePosition(latestClose, ma5, ma10, high20, low20),
  };
}

async function main() {
  const tradeDate = normalizeDate(process.argv[2]);
  const conn = await pool.getConnection();

  try {
    console.log(`開始計算籌碼分數：${tradeDate}`);

    const stocks = await conn.query(
      `
      SELECT 
        s.stock_code,
        s.stock_name,
        s.market_type
      FROM stocks s
      INNER JOIN daily_prices p
        ON s.stock_code = p.stock_code
       AND p.trade_date = ?
      WHERE s.is_active = 1
      ORDER BY s.stock_code
      `,
      [tradeDate],
    );

    let calculated = 0;
    let skipped = 0;

    const calculatedByMarket = {
      上市: 0,
      上櫃: 0,
      其他: 0,
    };

    const skippedByMarket = {
      上市: 0,
      上櫃: 0,
      其他: 0,
    };

    for (const stock of stocks) {
      const marketType = stock.market_type || "其他";

      const prices = await conn.query(
        `
        SELECT
          trade_date,
          open_price,
          high_price,
          low_price,
          close_price,
          volume
        FROM daily_prices
        WHERE stock_code = ?
          AND trade_date <= ?
        ORDER BY trade_date DESC
        LIMIT 20
        `,
        [stock.stock_code, tradeDate],
      );

      if (prices.length < 1) {
        skipped++;

        if (skippedByMarket[marketType] === undefined) {
          skippedByMarket[marketType] = 0;
        }

        skippedByMarket[marketType]++;

        continue;
      }

      const institutionalRows = await conn.query(
        `
        SELECT
          trade_date,
          foreign_net,
          investment_trust_net,
          dealer_net,
          total_net
        FROM institutional_trades
        WHERE stock_code = ?
          AND trade_date <= ?
        ORDER BY trade_date DESC
        LIMIT 10
        `,
        [stock.stock_code, tradeDate],
      );

      const result = calculateScore(prices, institutionalRows);

      await conn.query(
        `
        INSERT INTO chip_scores (
          stock_code,
          trade_date,
          chip_score,
          foreign_score,
          investment_trust_score,
          dealer_score,
          big_holder_score,
          volume_score,
          price_score,
          foreign_status,
          investment_trust_status,
          dealer_status,
          big_holder_status,
          volume_status,
          price_position
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          chip_score = VALUES(chip_score),
          foreign_score = VALUES(foreign_score),
          investment_trust_score = VALUES(investment_trust_score),
          dealer_score = VALUES(dealer_score),
          big_holder_score = VALUES(big_holder_score),
          volume_score = VALUES(volume_score),
          price_score = VALUES(price_score),
          foreign_status = VALUES(foreign_status),
          investment_trust_status = VALUES(investment_trust_status),
          dealer_status = VALUES(dealer_status),
          big_holder_status = VALUES(big_holder_status),
          volume_status = VALUES(volume_status),
          price_position = VALUES(price_position),
          updated_at = NOW()
        `,
        [
          stock.stock_code,
          tradeDate,
          result.chipScore,
          result.foreignScore,
          result.investmentTrustScore,
          result.dealerScore,
          result.bigHolderScore,
          result.volumeScore,
          result.priceScore,
          result.foreignStatus,
          result.investmentTrustStatus,
          result.dealerStatus,
          result.bigHolderStatus,
          result.volumeStatus,
          result.pricePosition,
        ],
      );

      calculated++;

      if (calculatedByMarket[marketType] === undefined) {
        calculatedByMarket[marketType] = 0;
      }

      calculatedByMarket[marketType]++;
    }

    console.log("籌碼分數計算完成");
    console.log(`股票數量：${stocks.length}`);
    console.log(`成功計算：${calculated}`);
    console.log(`略過股票：${skipped}`);
    console.log(
      `上市成功計算：${calculatedByMarket["上市"] || 0}，略過：${
        skippedByMarket["上市"] || 0
      }`,
    );
    console.log(
      `上櫃成功計算：${calculatedByMarket["上櫃"] || 0}，略過：${
        skippedByMarket["上櫃"] || 0
      }`,
    );
  } catch (error) {
    console.error("籌碼分數計算失敗");
    console.error(error.message);

    process.exitCode = 1;
  } finally {
    conn.release();
    await pool.end();
  }
}

main();
