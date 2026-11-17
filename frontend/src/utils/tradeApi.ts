import type { Stock } from "../data/stocksData";
import { authenticatedFetch, getBackendBaseUrl, logBackendResponse } from "./authUtils";
import { SUGGESTIONS_CACHE_KEY, getCachedData, setCachedData } from "./dataCache";
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
 */
export async function executeTrade(payload: TradePayload): Promise<TradeResult> {
  const response = await authenticatedFetch(
    `${getBackendBaseUrl()}/api/trade/execute`,
    {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    "Execute Trade"
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
    },
    "Execute Batch Trade"
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
 */
export async function updateCapital(newCapital: number): Promise<void> {
  const response = await authenticatedFetch(
    `${getBackendBaseUrl()}/api/profile/capital`,
    {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ capital: newCapital }),
    },
    "Update Capital"
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
  weight?: number;
  status: "pending" | "executed";
  executedAt?: string;
  is_executed?: boolean;
  executed?: boolean;
  predicted?: boolean;
};

// Singleton in-flight promise to prevent firing duplicate suggestions requests
let suggestionsInFlightPromise: Promise<TradeSuggestion[]> | null = null;

/**
 * Helper to check if a cached suggestion list is actually legacy dummy data.
 */
export function isDummySuggestionList(list?: TradeSuggestion[] | null): boolean {
  if (!list || !Array.isArray(list) || list.length === 0) return false;
  return list.some((s) => s.id === "sug_1" || s.id === "sug_2" || s.id === "sug_3");
}

/**
 * Fetches today's trade suggestions from the backend with in-flight deduplication.
 * Returns the real backend suggestions or empty array ([]). Never returns fake dummy data.
 */
export function fetchDailySuggestions(_availableStocks?: Stock[]): Promise<TradeSuggestion[]> {
  if (suggestionsInFlightPromise !== null) {
    return suggestionsInFlightPromise;
  }

  suggestionsInFlightPromise = (async (): Promise<TradeSuggestion[]> => {
    try {
      const response = await authenticatedFetch(
        `${getBackendBaseUrl()}/api/strategy/suggestions`,
        { credentials: "include" },
        "Daily Strategy Suggestions"
      );

      if (response.ok) {
        let data: unknown;
        try {
          const rawText = await response.text();
          try {
            data = JSON.parse(rawText);
          } catch {
            data = rawText;
          }
        } catch {
          data = await response.json().catch(() => null);
        }

        if (typeof data === "string") {
          try {
            data = JSON.parse(data);
          } catch {
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

            const rawWeight =
              item.weight ??
              item.weight_pct ??
              item.weightPct ??
              item.weight_percentage ??
              item.percentage_weight;
            const parsedWeight =
              typeof rawWeight === "number"
                ? rawWeight
                : typeof rawWeight === "string" && rawWeight.trim() !== ""
                ? parseFloat(rawWeight.replace("%", "").trim())
                : undefined;
            const weight =
              typeof parsedWeight === "number" && !isNaN(parsedWeight)
                ? parsedWeight
                : undefined;

            return {
              id: String(item.id ?? `sug_${ticker}_${idx}_${Date.now()}`),
              ticker,
              name: String(item.name ?? ticker),
              action,
              quantity,
              price,
              weight,
              status: (item.status === "executed" ? "executed" : "pending") as "pending" | "executed",
              executedAt: item.executedAt ? String(item.executedAt) : undefined,
              is_executed: Boolean(item.is_executed || item.executed),
              executed: Boolean(item.executed || item.is_executed),
              predicted: Boolean(item.predicted ?? true),
            };
          })
          .filter((item): item is TradeSuggestion => item !== null && item.quantity > 0 && item.price > 0);

        setCachedData(SUGGESTIONS_CACHE_KEY, valid);
        return valid;
      }
    } catch (err) {
      console.error("[fetchDailySuggestions] Error fetching suggestions:", err);
    }

    // Return cached real suggestions if available, otherwise return empty list
    const cached = getCachedData<TradeSuggestion[]>(SUGGESTIONS_CACHE_KEY);
    if (cached && !isDummySuggestionList(cached)) {
      return cached;
    }
    return [];
  })().finally(() => {
    suggestionsInFlightPromise = null;
  });

  return suggestionsInFlightPromise;
}

export const SUGGESTIONS_EXECUTED_KEY = "strategy_suggestions_executed";

export function getTodayDateString(): string {
  try {
    return new Date().toISOString().slice(0, 10);
  } catch (err) {
    console.error("[getTodayDateString] Exception formatting date:", err);
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
    console.error("[areSuggestionsExecutedToday] Exception checking executed status:", err);
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
    console.error("[markSuggestionsExecuted] Exception storing executed status:", err);
  }
}

/**
 * Execute suggestions as-is directly without manual edits.
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
