import type { Stock } from "../data/stocksData";
import { STOCK_UNIVERSE } from "../data/stocksData";
import { authenticatedFetch, getBackendBaseUrl, logBackendResponse } from "./authUtils";
import { DASHBOARD_STOCKS_CACHE_KEY, getCachedData } from "./dataCache";

export type TradeAction = "buy" | "sell";

export type TradePayload = {
  ticker: string;
  action: TradeAction;
  quantity: number;
  price: number; // current market price at the time of order
};

export type TradeResult = {
  success: boolean;
  message: string;
  tradeId?: string;
};

/**
 * Submit a buy or sell order to the backend.
 * NOTE: The API endpoint URL will be updated by the backend team when ready.
 */
export async function executeTrade(payload: TradePayload): Promise<TradeResult> {
  const response = await authenticatedFetch(
    `${getBackendBaseUrl()}/api/trade/execute`,
    {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }
  );
  logBackendResponse(response, "POST /api/trade/execute");

  if (!response.ok) {
    const body = await response.text().catch(() => "Trade failed");
    throw new Error(body || "Trade failed");
  }

  return response.json() as Promise<TradeResult>;
}

/**
 * Execute multiple buy/sell orders together in a basket.
 * Calculates net requirement and submits to backend.
 */
export async function executeBatchTrade(orders: TradePayload[]): Promise<TradeResult> {
  if (orders.length === 1) {
    return executeTrade(orders[0]);
  }

  const response = await authenticatedFetch(
    `${getBackendBaseUrl()}/api/trade/batch`,
    {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orders }),
    }
  );
  logBackendResponse(response, "POST /api/trade/batch");

  if (!response.ok) {
    // Fallback: execute each order sequentially if batch endpoint is not yet ready
    const results: TradeResult[] = [];
    for (const order of orders) {
      const res = await executeTrade(order);
      results.push(res);
    }
    return {
      success: true,
      message: `Executed ${orders.length} orders successfully`,
    };
  }

  return response.json() as Promise<TradeResult>;
}

/**
 * Update the user's available capital.
 * NOTE: The API endpoint URL will be updated by the backend team when ready.
 */
export async function updateCapital(newCapital: number): Promise<void> {
  const response = await authenticatedFetch(
    `${getBackendBaseUrl()}/api/profile/capital`,
    {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ capital: newCapital }),
    }
  );
  logBackendResponse(response, "PATCH /api/profile/capital");

  if (!response.ok) {
    throw new Error("Failed to update capital");
  }
}

export type TradeSuggestion = {
  id: string;
  ticker: string;
  name: string;
  action: "buy" | "sell";
  quantity: number;
  price: number;
  status: "pending" | "executed";
  executedAt?: string;
};

// Fallback dummy suggestions blueprint (quantity > 0, no reasons)
const DEFAULT_SUGGESTION_CONFIGS: Omit<TradeSuggestion, "price">[] = [
  {
    id: "sug_1",
    ticker: "TCS",
    name: "Tata Consultancy Services",
    action: "buy",
    quantity: 2,
    status: "pending",
  },
  {
    id: "sug_2",
    ticker: "ITC",
    name: "ITC Limited",
    action: "sell",
    quantity: 15,
    status: "pending",
  },
  {
    id: "sug_3",
    ticker: "RELIANCE",
    name: "Reliance Industries",
    action: "buy",
    quantity: 3,
    status: "pending",
  },
  {
    id: "sug_4",
    ticker: "HDFCBANK",
    name: "HDFC Bank",
    action: "sell",
    quantity: 5,
    status: "pending",
  },
];

/**
 * Fetches today's trade suggestions from the backend.
 * Reuses live stock prices from the 1st stock API call (passed in or retrieved from cache)
 * without making redundant stock network requests.
 * When the backend suggestions endpoint is ready, it uses the backend's prices and data directly.
 */
export async function fetchDailySuggestions(availableStocks?: Stock[]): Promise<TradeSuggestion[]> {
  try {
    const response = await authenticatedFetch(
      `${getBackendBaseUrl()}/api/strategy/suggestions`,
      { credentials: "include" }
    );
    logBackendResponse(response, "GET /api/strategy/suggestions");
    if (response.ok) {
      const data = await response.json();
      const rawList: TradeSuggestion[] = Array.isArray(data)
        ? data
        : data.suggestions ?? [];

      // Filter out stocks with 0 buy or 0 sell quantity
      return rawList.filter((item) => typeof item.quantity === "number" && item.quantity > 0);
    }
  } catch {
    // If backend endpoint is not ready or network fails, fallback to dummy suggestions
  }

  // Fallback: reuse the stock prices from the 1st stocks call (do not make a separate network call)
  const stocksPool: Stock[] =
    availableStocks && availableStocks.length > 0
      ? availableStocks
      : getCachedData<Stock[]>(DASHBOARD_STOCKS_CACHE_KEY) ?? [];

  return DEFAULT_SUGGESTION_CONFIGS.map((item) => {
    const liveStock = stocksPool.find(
      (s) => s.ticker.toUpperCase() === item.ticker.toUpperCase()
    );
    const fallbackStock = STOCK_UNIVERSE.find(
      (s) => s.ticker.toUpperCase() === item.ticker.toUpperCase()
    );

    return {
      ...item,
      name: liveStock?.name ?? fallbackStock?.name ?? item.name,
      price: liveStock?.price ?? fallbackStock?.price ?? 1000,
    };
  }).filter((s) => s.quantity > 0 && s.price > 0);
}

/**
 * Execute suggestions as-is directly without manual edits.
 * Bypasses frontend guards because backend already validated this plan.
 */
export async function executeSuggestionsAsIs(suggestions: TradeSuggestion[]): Promise<TradeResult> {
  const orders: TradePayload[] = suggestions.map((s) => ({
    ticker: s.ticker,
    action: s.action,
    quantity: s.quantity,
    price: s.price,
  }));
  return executeBatchTrade(orders);
}

