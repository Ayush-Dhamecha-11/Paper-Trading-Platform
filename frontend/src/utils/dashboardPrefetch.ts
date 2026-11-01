import type { Stock } from "../data/stocksData";
import type { AnalyticsData } from "../data/analyticsData";
import type { PortfolioData } from "../pages/portfolio";
import {
  authenticatedFetch,
  getBackendBaseUrl,
  logBackendResponse,
  setStoredUserInfo,
} from "./authUtils";
import {
  DASHBOARD_STOCKS_CACHE_KEY,
  DASHBOARD_SUMMARY_CACHE_KEY,
  CAPITAL_CACHE_KEY,
  HOLDINGS_CACHE_KEY,
  PORTFOLIO_CACHE_KEY,
  ANALYTICS_CACHE_KEY,
  SUGGESTIONS_CACHE_KEY,
  getCachedData,
  setCachedData,
} from "./dataCache";
import { fetchDailySuggestions, type TradeSuggestion } from "./tradeApi";

type PortfolioSummary = {
  totalPortfolioValue: number;
  capitalBalance?: number;
  accountEquity?: number;
  investedCapital: number;
  totalProfit: number;
  todayPnL: number;
  yesterdayPnL?: number;
};

let stocksRequest: Promise<Stock[]> | null = null;
let stocksFreshUntil = 0;

let portfolioRequest: Promise<PortfolioData> | null = null;
let portfolioFreshUntil = 0;

let analyticsRequest: Promise<AnalyticsData> | null = null;
let analyticsFreshUntil = 0;

let suggestionsRequest: Promise<TradeSuggestion[]> | null = null;
let suggestionsFreshUntil = 0;

export function fetchDashboardStocks(): Promise<Stock[]> {
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
      stocksFreshUntil = Date.now() + 10000;
      return stocks;
    })
    .finally(() => {
      stocksRequest = null;
    });

  return stocksRequest;
}

export function fetchPortfolioData(): Promise<PortfolioData> {
  const cached = getCachedData<PortfolioData>(PORTFOLIO_CACHE_KEY);

  if (cached && Date.now() < portfolioFreshUntil) {
    return Promise.resolve(cached);
  }

  if (portfolioRequest !== null) {
    return portfolioRequest;
  }

  portfolioRequest = authenticatedFetch(`${getBackendBaseUrl()}/api/portfolio`, {
    credentials: "include",
  })
    .then(async (response) => {
      logBackendResponse(response, "GET /api/portfolio");
      if (!response.ok) {
        throw new Error("Unable to load portfolio from backend");
      }

      const data = (await response.json()) as PortfolioData;
      if (data) {
        setCachedData(PORTFOLIO_CACHE_KEY, data);
        if (Array.isArray(data.holdings)) {
          setCachedData(HOLDINGS_CACHE_KEY, data.holdings);
        }
      }
      portfolioFreshUntil = Date.now() + 15000;
      return data;
    })
    .finally(() => {
      portfolioRequest = null;
    });

  return portfolioRequest;
}

export function fetchAnalyticsData(): Promise<AnalyticsData> {
  const cached = getCachedData<AnalyticsData>(ANALYTICS_CACHE_KEY);

  if (cached && Date.now() < analyticsFreshUntil) {
    return Promise.resolve(cached);
  }

  if (analyticsRequest !== null) {
    return analyticsRequest;
  }

  analyticsRequest = authenticatedFetch(`${getBackendBaseUrl()}/api/analytics`, {
    credentials: "include",
  })
    .then(async (response) => {
      logBackendResponse(response, "GET /api/analytics");
      if (!response.ok) {
        throw new Error("Unable to load analytics from backend");
      }

      const data = (await response.json()) as AnalyticsData;
      if (data) {
        setCachedData(ANALYTICS_CACHE_KEY, data);
      }
      analyticsFreshUntil = Date.now() + 15000;
      return data;
    })
    .finally(() => {
      analyticsRequest = null;
    });

  return analyticsRequest;
}

export function fetchSuggestionsData(stocks?: Stock[]): Promise<TradeSuggestion[]> {
  const cached = getCachedData<TradeSuggestion[]>(SUGGESTIONS_CACHE_KEY);

  if (cached && Date.now() < suggestionsFreshUntil) {
    return Promise.resolve(cached);
  }

  if (suggestionsRequest !== null) {
    return suggestionsRequest;
  }

  suggestionsRequest = fetchDailySuggestions(stocks)
    .then((data) => {
      if (data && data.length > 0) {
        setCachedData(SUGGESTIONS_CACHE_KEY, data);
      }
      suggestionsFreshUntil = Date.now() + 30000;
      return data;
    })
    .finally(() => {
      suggestionsRequest = null;
    });

  return suggestionsRequest;
}

export function warmDashboardData() {
  const backendBaseUrl = getBackendBaseUrl();

  const stocksReq = fetchDashboardStocks();

  const summaryReq = authenticatedFetch(`${backendBaseUrl}/api/dashboard`, {
    credentials: "include",
  })
    .then(async (response) => {
      logBackendResponse(response, "GET /api/dashboard (prefetch)");
      if (!response.ok) {
        throw new Error("Unable to load portfolio summary from backend");
      }

      const summary = (await response.json()) as PortfolioSummary;
      setCachedData(DASHBOARD_SUMMARY_CACHE_KEY, summary);
      if (typeof summary.capitalBalance === "number") {
        setCachedData(CAPITAL_CACHE_KEY, summary.capitalBalance);
      }
      return summary;
    })
    .catch(() => null);

  const profileReq = authenticatedFetch(`${backendBaseUrl}/api/profile`, {
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
      return profile;
    })
    .catch(() => null);

  const portfolioReq = fetchPortfolioData().catch(() => null);
  const analyticsReq = fetchAnalyticsData().catch(() => null);
  const suggestionsReq = fetchSuggestionsData().catch(() => []);

  return Promise.allSettled([
    stocksReq,
    summaryReq,
    profileReq,
    portfolioReq,
    analyticsReq,
    suggestionsReq,
  ]).then((results) => {
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("dashboard-data-warmed"));
    }
    return results;
  });
}
