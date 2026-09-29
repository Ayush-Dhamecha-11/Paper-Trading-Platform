import type { Stock } from "../data/stocksData";
import { DASHBOARD_STOCKS_CACHE_KEY, getCachedData } from "./dataCache";

/**
 * Determines if the stock market is currently closed based on stock data.
 *
 * Per requirements:
 * - If market is OPEN: the close price in dashboard stock data is "--" (or null, undefined, 0, NaN).
 * - If market is CLOSED: the close price shows the official closing price (positive number > 0).
 */
export function isMarketClosed(stocks?: Stock[] | null): boolean {
  const stockList =
    stocks && stocks.length > 0
      ? stocks
      : getCachedData<Stock[]>(DASHBOARD_STOCKS_CACHE_KEY);

  if (!stockList || stockList.length === 0) {
    return false;
  }

  // Examine the stocks to determine market status
  let closedCount = 0;
  let validStockCount = 0;

  for (const s of stockList) {
    if (!s) continue;
    validStockCount++;

    const rawClose = s.close;

    // Check if close price represents an open market (i.e. displayed as "--" / unassigned)
    const isUnclosed =
      rawClose === null ||
      rawClose === undefined ||
      rawClose === "" ||
      rawClose === "--" ||
      rawClose === "-" ||
      Number.isNaN(Number(rawClose)) ||
      Number(rawClose) <= 0;

    if (!isUnclosed && Number(rawClose) > 0) {
      closedCount++;
    }
  }

  // If majority of available stocks show a closed price, the market is closed
  return validStockCount > 0 && closedCount > validStockCount / 2;
}

export const MARKET_CLOSED_MESSAGE =
  "You cannot trade right now because the stock market is closed. Trading will resume when the market opens.";
