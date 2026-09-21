import type { Stock } from "../data/stocksData";
import {
  authenticatedFetch,
  getBackendBaseUrl,
  logBackendResponse,
  setStoredUserInfo,
} from "./authUtils";
import {
  DASHBOARD_STOCKS_CACHE_KEY,
  DASHBOARD_SUMMARY_CACHE_KEY,
  getCachedData,
  setCachedData,
} from "./dataCache";

type PortfolioSummary = {
  totalPortfolioValue: number;
  investedCapital: number;
  totalProfit: number;
  todayPnL: number;
  yesterdayPnL?: number;
};

let stocksRequest: Promise<Stock[]> | null = null;
let stocksFreshUntil = 0;

export function fetchDashboardStocks() {
  const cachedStocks = getCachedData<Stock[]>(DASHBOARD_STOCKS_CACHE_KEY);

  if (cachedStocks && Date.now() < stocksFreshUntil) {
    return Promise.resolve(cachedStocks);
  }

  if (stocksRequest !== null) {
    return stocksRequest;
  }

  stocksRequest = authenticatedFetch(`${getBackendBaseUrl()}/api/stocks`, {
    credentials: "include",
  })
    .then(async (response) => {
      logBackendResponse(response, "GET /api/stocks");
      if (!response.ok) {
        throw new Error("Unable to load stocks from backend");
      }

      const data = (await response.json()) as Stock[] | { stocks?: Stock[] };
      const stocks = Array.isArray(data) ? data : data.stocks ?? [];
      setCachedData(DASHBOARD_STOCKS_CACHE_KEY, stocks);
      stocksFreshUntil = Date.now() + 5000;
      return stocks;
    })
    .finally(() => {
      stocksRequest = null;
    });

  return stocksRequest;
}

export function warmDashboardData() {
  const backendBaseUrl = getBackendBaseUrl();

  const stocksRequest = fetchDashboardStocks();

  const summaryRequest = authenticatedFetch(`${backendBaseUrl}/api/dashboard`, {
    credentials: "include",
  })
    .then(async (response) => {
      logBackendResponse(response, "GET /api/dashboard (prefetch)");
      if (!response.ok) {
        throw new Error("Unable to load portfolio summary from backend");
      }

      const summary = (await response.json()) as PortfolioSummary;
      setCachedData(DASHBOARD_SUMMARY_CACHE_KEY, summary);
    });

  const profileRequest = authenticatedFetch(`${backendBaseUrl}/api/profile`, {
    credentials: "include",
  })
    .then(async (response) => {
      logBackendResponse(response, "GET /api/profile (prefetch)");
      if (!response.ok) {
        throw new Error("Unable to load user information from backend");
      }

      const profile = (await response.json()) as {
        name?: string;
        email?: string;
        preference?: {
          theme?: "Light" | "Dark";
          auto_trade?: boolean;
        };
      };

      setStoredUserInfo({
        name: profile.name,
        email: profile.email,
        theme: profile.preference?.theme,
        auto_trade: profile.preference?.auto_trade,
      });
    });

  return Promise.allSettled([stocksRequest, summaryRequest, profileRequest]);
}