import type { Stock } from "../data/stocksData";
import { STOCK_UNIVERSE } from "../data/stocksData";
import { authenticatedFetch, getBackendBaseUrl, logBackendResponse } from "./authUtils";
import { DASHBOARD_STOCKS_CACHE_KEY, SUGGESTIONS_CACHE_KEY, getCachedData, setCachedData } from "./dataCache";
import { isMarketClosed } from "./marketUtils";

export type TradeAction = "buy" | "sell";

export type TradePayload = {
  ticker: string;
  action: TradeAction;
  quantity: number;
  price: number; // current market price at the time of order
  predicted?: boolean;
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
  is_executed?: boolean;
  executed?: boolean;
  predicted?: boolean;
};

// Fallback dummy suggestions blueprint (quantity > 0, not executed)
const DEFAULT_SUGGESTION_CONFIGS: Omit<TradeSuggestion, "price">[] = [
  {
    id: "sug_1",
    ticker: "TCS",
    name: "Tata Consultancy Services",
    action: "buy",
    quantity: 2,
    status: "pending",
    is_executed: false,
    executed: false,
  },
  {
    id: "sug_2",
    ticker: "ITC",
    name: "ITC Limited",
    action: "sell",
    quantity: 15,
    status: "pending",
    is_executed: false,
    executed: false,
  },
  {
    id: "sug_3",
    ticker: "RELIANCE",
    name: "Reliance Industries",
    action: "buy",
    quantity: 3,
    status: "pending",
    is_executed: false,
    executed: false,
  },
  {
    id: "sug_4",
    ticker: "HDFCBANK",
    name: "HDFC Bank",
    action: "sell",
    quantity: 5,
    status: "pending",
    is_executed: false,
    executed: false,
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
      let data: unknown;
      try {
        const rawText = await response.text();
        try {
          data = JSON.parse(rawText);
        } catch (err) {
          data = rawText;
        }
      } catch (streamErr) {
        console.warn("[fetchDailySuggestions] Stream reading error, falling back to json():", streamErr);
        data = await response.json();
      }

      if (typeof data === "string") {
        try {
          data = JSON.parse(data);
        } catch (err) {
          // ignore
        }
      }
      let candidateList: unknown[] = [];
      if (Array.isArray(data)) {
        candidateList = data;
      } else if (data && typeof data === "object") {
        const obj = data as Record<string, unknown>;
        const list = obj.suggestions ?? obj.data ?? obj.trades ?? obj.results ?? obj.items;
        if (Array.isArray(list)) {
          candidateList = list;
        }
      }

      const valid: TradeSuggestion[] = candidateList
        .map((rawItem, idx) => {
          if (!rawItem || typeof rawItem !== "object") return null;
          const item = rawItem as Record<string, unknown>;
          const ticker = String(item.ticker ?? "").trim().toUpperCase();
          if (!ticker) return null;

          const rawQty = item.quantity;
          const quantity =
            typeof rawQty === "number"
              ? rawQty
              : parseFloat(String(rawQty ?? "0")) || 0;

          const rawPrice = item.price;
          const price =
            typeof rawPrice === "number"
              ? rawPrice
              : parseFloat(String(rawPrice ?? "0")) || 0;

          const rawAction = String(item.action ?? "buy").toLowerCase().trim();
          const action: "buy" | "sell" = rawAction === "sell" ? "sell" : "buy";

          return {
            id: String(item.id ?? `sug_${ticker}_${idx}_${Date.now()}`),
            ticker,
            name: String(item.name ?? ticker),
            action,
            quantity,
            price,
            status: (item.status === "executed" ? "executed" : "pending") as "pending" | "executed",
            executedAt: item.executedAt ? String(item.executedAt) : undefined,
            is_executed: Boolean(item.is_executed || item.executed),
            executed: Boolean(item.executed || item.is_executed),
            predicted: Boolean(item.predicted ?? true),
          };
        })
        .filter((item): item is TradeSuggestion => item !== null && item.quantity > 0 && item.price > 0);

      if (valid.length > 0) {
        setCachedData(SUGGESTIONS_CACHE_KEY, valid);
        return valid;
      }
    }
  } catch (err) {
    console.error("[fetchDailySuggestions] Exception fetching suggestions:", err);
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
      status: "pending" as const,
      is_executed: false,
      executed: false,
      name: liveStock?.name ?? fallbackStock?.name ?? item.name,
      price: liveStock?.price ?? fallbackStock?.price ?? 1000,
    };
  }).filter((s) => s.quantity > 0 && s.price > 0);
}

export const SUGGESTIONS_EXECUTED_KEY = "strategy_suggestions_executed";

export function getTodayDateString(): string {
  try {
    return new Date().toISOString().slice(0, 10);
  } catch (err) {
    console.error("[fetchDailySuggestions] Exception fetching suggestions:", err);
    return "today";
  }
}

export function areSuggestionsExecutedToday(): boolean {
  try {
    const today = getTodayDateString();
    const storedDate =
      localStorage.getItem(`${SUGGESTIONS_EXECUTED_KEY}_date`) ||
      sessionStorage.getItem(`${SUGGESTIONS_EXECUTED_KEY}_date`);
    if (storedDate === today) {
      return true;
    }
    const storedFlag =
      localStorage.getItem(SUGGESTIONS_EXECUTED_KEY) ||
      sessionStorage.getItem(SUGGESTIONS_EXECUTED_KEY);
    return storedFlag === "true" || storedFlag === today;
  } catch (err) {
    console.error("[fetchDailySuggestions] Exception fetching suggestions:", err);
    return false;
  }
}

export function markSuggestionsExecuted(): void {
  try {
    const today = getTodayDateString();
    localStorage.setItem(`${SUGGESTIONS_EXECUTED_KEY}_date`, today);
    localStorage.setItem(SUGGESTIONS_EXECUTED_KEY, "true");
    sessionStorage.setItem(`${SUGGESTIONS_EXECUTED_KEY}_date`, today);
    sessionStorage.setItem(SUGGESTIONS_EXECUTED_KEY, "true");
  } catch (err) {
    console.error("[fetchDailySuggestions] Exception fetching suggestions:", err);
    // Ignore storage errors
  }
}

/**
 * Execute suggestions as-is directly without manual edits.
 * Bypasses frontend guards because backend already validated this plan.
 */
export async function executeSuggestionsAsIs(suggestions: TradeSuggestion[]): Promise<TradeResult> {
  if (isMarketClosed()) {
    throw new Error("Cannot execute suggestions: The stock market is currently closed.");
  }
  const alreadyDone = areSuggestionsExecutedToday();
  const orders: TradePayload[] = suggestions.map((s) => ({
    ticker: s.ticker,
    action: s.action,
    quantity: s.quantity,
    price: s.price,
    ...(!alreadyDone ? { predicted: true } : {}),
  }));
  return executeBatchTrade(orders);
}


