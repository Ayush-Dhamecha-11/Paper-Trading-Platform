export const DASHBOARD_SUMMARY_CACHE_KEY = "dashboard_summary";
export const DASHBOARD_STOCKS_CACHE_KEY = "dashboard_stocks";
export const CAPITAL_CACHE_KEY = "user_capital";
export const HOLDINGS_CACHE_KEY = "portfolio_holdings";

export function getCachedData<T>(key: string): T | null {
  const cachedValue = sessionStorage.getItem(key);

  if (!cachedValue) {
    return null;
  }

  try {
    return JSON.parse(cachedValue) as T;
  } catch {
    sessionStorage.removeItem(key);
    return null;
  }
}

export function setCachedData<T>(key: string, value: T) {
  sessionStorage.setItem(key, JSON.stringify(value));
}
