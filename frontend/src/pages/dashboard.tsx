import { useEffect, useState, type ReactNode } from "react";
import DataState from "../components/DataState";
import Header from "../components/Header";
import StockTable from "../components/StockTable/StockTable";
import { STOCK_UNIVERSE, type Stock } from "../data/stocksData";
import {
  getStoredUserInfo,
  authenticatedFetch,
  logBackendResponse,
  logoutUser,
  setStoredUserInfo,
} from "../utils/authUtils";
import {
  DASHBOARD_STOCKS_CACHE_KEY,
  DASHBOARD_SUMMARY_CACHE_KEY,
  HOLDINGS_CACHE_KEY,
  CAPITAL_CACHE_KEY,
  getCachedData,
  setCachedData,
} from "../utils/dataCache";
import { fetchDashboardStocks } from "../utils/dashboardPrefetch";
import { formatCurrency } from "../utils/formatters";
import { useTradeModal } from "../context/TradeContext";
import StrategyBanner from "../components/StrategyBanner/StrategyBanner";
import "../pages_css/dashboard.css";

/*
const rangeData: Record<"30D" | "6M" | "1Y", number[]> = {
  "30D": [110, 118, 124, 132, 128, 140, 148, 152, 160, 155, 168, 170],
  "6M": [90, 96, 104, 110, 118, 123, 131, 138, 146, 155, 162, 170],
  "1Y": [60, 68, 74, 82, 95, 101, 112, 125, 138, 150, 165, 170],
};

const sectorAllocation = [
  { name: "Technology", value: 42, color: "#21d9a3" },
  { name: "Healthcare", value: 18, color: "#34b3ff" },
  { name: "Finance", value: 15, color: "#8b7cff" },
  { name: "Energy", value: 13, color: "#fbbf24" },
  { name: "Consumer", value: 12, color: "#ff7b72" },
];
*/

export type DashboardHolding = {
  ticker: string;
  name?: string;
  quantity: number;
  price?: number;
  currentPrice?: number;
  profit?: number;
  profitLoss?: number;
  averagePrice?: number;
  previousClose?: number;
};

const API_BASE_URL =
  import.meta.env.VITE_BACKEND_URL ||
  import.meta.env.VITE_API_BASE_URL ||
  "http://localhost:8000";

type PortfolioSummary = {
  totalPortfolioValue: number;
  capitalBalance?: number;
  accountEquity?: number;
  investedCapital: number;
  totalProfit: number;
  todayPnL: number;
  yesterdayPnL?: number;
};

async function fetchStocks(): Promise<Stock[]> {
  return fetchDashboardStocks();
}

async function fetchHoldings(): Promise<DashboardHolding[]> {
  try {
    const response = await authenticatedFetch(`${API_BASE_URL}/api/portfolio`, {
      credentials: "include",
    });
    logBackendResponse(response, "GET /api/portfolio (dashboard holdings)");

    if (!response.ok) {
      return getCachedData<DashboardHolding[]>(HOLDINGS_CACHE_KEY) ?? [];
    }

    const data = (await response.json()) as { holdings?: DashboardHolding[] } | DashboardHolding[];
    const list = Array.isArray(data) ? data : (data.holdings ?? []);
    setCachedData(HOLDINGS_CACHE_KEY, list);
    return list;
  } catch (error) {
    console.error("Unable to load holdings:", error);
    return getCachedData<DashboardHolding[]>(HOLDINGS_CACHE_KEY) ?? [];
  }
}

async function fetchPortfolioSummary(): Promise<PortfolioSummary> {
  const response = await authenticatedFetch(`${API_BASE_URL}/api/dashboard`, {
    credentials: "include",
  });
  logBackendResponse(response, "GET /api/dashboard");

  if (!response.ok) {
    throw new Error("Unable to load portfolio summary from backend");
  }

  return response.json();
}

async function fetchUserInfo(): Promise<{
  name: string;
  email: string;
  preference: {
    theme: "Light" | "Dark";
    auto_trade: boolean;
  };
}> {
  const response = await authenticatedFetch(`${API_BASE_URL}/api/profile`, {
    credentials: "include",
  });
  logBackendResponse(response, "GET /api/profile");

  if (!response.ok) {
    throw new Error("Unable to load user information from backend");
  }

  return response.json();
}

/*
export function DashboardPerformanceCharts({
  range,
  onRangeChange,
}: Readonly<{
  range: ChartRangeKey;
  onRangeChange: (range: ChartRangeKey) => void;
}>) {
  const chartValues = rangeData[range];
  const chartLabels = Array.from({ length: chartValues.length }, (_, index) => `P${index + 1}`);

  return (
    <>
      <div className="panel chart-panel">
        <div className="panel-header">
          <div>
            <p className="panel-label">Performance</p>
            <h2>Profit over time</h2>
          </div>

          <div className="range-switcher" aria-label="Filter time range">
            {(Object.keys(rangeData) as ChartRangeKey[]).map((key) => (
              <button
                key={key}
                type="button"
                className={range === key ? "active" : ""}
                onClick={() => onRangeChange(key)}
              >
                {key}
              </button>
            ))}
          </div>
        </div>

        <div className="chart-wrap">
          <ProfitLineChart values={chartValues} labels={chartLabels} />
        </div>
      </div>

      <div className="panel allocation-panel">
        <div className="panel-header simple-header">
          <div>
            <p className="panel-label">Allocation</p>
            <h2>Sector mix</h2>
          </div>
        </div>

        <div className="allocation-content">
          <AllocationDoughnutChart sectors={sectorAllocation} />
        </div>
      </div>
    </>
  );
}
*/

export function DashboardHoldingsTable({ holdings: tableHoldings }: { holdings?: DashboardHolding[] } = {}) {
  const displayHoldings = tableHoldings ?? getCachedData<DashboardHolding[]>(HOLDINGS_CACHE_KEY) ?? [];
  return (
    <div className="panel holdings-panel">
      <div className="panel-header">
        <div>
          <p className="panel-label">Portfolio</p>
          <h2>Holdings</h2>
        </div>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Ticker</th>
              <th>Name</th>
              <th>Price</th>
              <th>Qty</th>
              <th>P/L</th>
            </tr>
          </thead>
          <tbody>
            {displayHoldings.map((stock) => (
              <tr key={stock.ticker}>
                <td>{stock.ticker}</td>
                <td>{stock.name ?? stock.ticker}</td>
                <td>{formatCurrency(stock.currentPrice ?? stock.price ?? 0)}</td>
                <td>{stock.quantity}</td>
                <td className={(stock.profit ?? stock.profitLoss ?? 0) >= 0 ? "profit-value" : "loss-value"}>
                  {formatCurrency(stock.profit ?? stock.profitLoss ?? 0)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DashboardPage() {
  const { openTrade } = useTradeModal();
  // const notice = (() => {
  //   const savedNotice = window.sessionStorage.getItem("auth_notice");

  //   if (!savedNotice) {
  //     return null;
  //   }

  //   try {
  //     const parsedNotice = JSON.parse(savedNotice) as {
  //       text?: string;
  //       type?: "success" | "error";
  //     };

  //     if (!parsedNotice.text) {
  //       return null;
  //     }

  //     return {
  //       text: parsedNotice.text,
  //       type: parsedNotice.type === "error" ? "error" : "success",
  //     };
  //   } catch {
  //     window.sessionStorage.removeItem("auth_notice");
  //     return null;
  //   }
  // })();

  const [cachedStocks] = useState(() => getCachedData<Stock[]>(DASHBOARD_STOCKS_CACHE_KEY));
  const [stocks, setStocks] = useState<Stock[]>(cachedStocks ?? []);
  const [stocksLoading, setStocksLoading] = useState(!cachedStocks);
  const [stocksFailed, setStocksFailed] = useState(false);

  const cachedHoldings = getCachedData<DashboardHolding[]>(HOLDINGS_CACHE_KEY);
  const [holdings, setHoldings] = useState<DashboardHolding[]>(cachedHoldings ?? []);

  const cachedSummary = getCachedData<PortfolioSummary>(DASHBOARD_SUMMARY_CACHE_KEY);
  const [portfolioSummary, setPortfolioSummary] = useState<PortfolioSummary>(
    cachedSummary ?? {
      totalPortfolioValue: 0,
      investedCapital: 0,
      totalProfit: 0,
      todayPnL: 0,
      yesterdayPnL: undefined,
    }
  );
  const [summaryLoading, setSummaryLoading] = useState(!cachedSummary);

  const [userInfo, setUserInfo] = useState(() => {
    const storedUserInfo = getStoredUserInfo();

    return {
      name: storedUserInfo?.name?.trim() || "User",
      email: storedUserInfo?.email?.trim() || "--",
    };
  });

  useEffect(() => {
    let isMounted = true;

    const refreshStocks = () => fetchStocks()
      .then((backendStocks) => {
        if (!isMounted) {
          return;
        }

        setStocks(backendStocks.length > 0 ? backendStocks : STOCK_UNIVERSE);
        setCachedData(
          DASHBOARD_STOCKS_CACHE_KEY,
          backendStocks.length > 0 ? backendStocks : STOCK_UNIVERSE
        );
        setStocksFailed(false);
      })
      .catch(() => {
        if (!isMounted) {
          return;
        }

        setStocksFailed(!cachedStocks);
      })
      .finally(() => {
        if (isMounted) {
          setStocksLoading(false);
        }
      });

    const refreshHoldings = () => fetchHoldings()
      .then((backendHoldings) => {
        if (!isMounted) {
          return;
        }
        setHoldings(backendHoldings);
      })
      .catch((error) => {
        console.error("Unable to load holdings:", error);
      });

    const refreshPortfolioSummary = () => fetchPortfolioSummary()
      .then((backendSummary) => {
        if (!isMounted) {
          return;
        }

        setPortfolioSummary({
          totalPortfolioValue: backendSummary.totalPortfolioValue,
          capitalBalance: backendSummary.capitalBalance,
          accountEquity: backendSummary.accountEquity,
          investedCapital: backendSummary.investedCapital,
          totalProfit: backendSummary.totalProfit,
          todayPnL: backendSummary.todayPnL,
          yesterdayPnL: backendSummary.yesterdayPnL,
        });
        setCachedData(DASHBOARD_SUMMARY_CACHE_KEY, backendSummary);
        if (typeof backendSummary.capitalBalance === "number") {
          setCachedData(CAPITAL_CACHE_KEY, backendSummary.capitalBalance);
        }
      })
      .catch((error) => {
        console.error("Unable to load portfolio summary:", error);
      })
      .finally(() => {
        if (isMounted) {
          setSummaryLoading(false);
        }
      });

    const storedUserInfo = getStoredUserInfo();

    const refreshUserInfo = () => fetchUserInfo()
      .then((backendUser) => {
        if (!isMounted) {
          return;
        }

        const userData = {
          name: backendUser.name,
          email: backendUser.email,
          theme: backendUser.preference.theme,
          auto_trade: backendUser.preference.auto_trade,
        };

        setStoredUserInfo(userData);

        setUserInfo({
          name: backendUser.name?.trim() || "User",
          email: backendUser.email?.trim() || "--",
        });
      })
      .catch((error) => {
        console.error("Unable to load user information:", error);

        if (!isMounted) {
          return;
        }

        setUserInfo({
          name: storedUserInfo?.name?.trim() || "User",
          email: storedUserInfo?.email?.trim() || "--",
        });
      });

    void refreshStocks();
    void refreshHoldings();
    void refreshPortfolioSummary();
    void refreshUserInfo();

    const handleDataRefresh = () => {
      sessionStorage.removeItem(DASHBOARD_SUMMARY_CACHE_KEY);
      sessionStorage.removeItem(DASHBOARD_STOCKS_CACHE_KEY);
      sessionStorage.removeItem(HOLDINGS_CACHE_KEY);
      sessionStorage.removeItem("analytics_data");
      setSummaryLoading(true);
      void refreshStocks();
      void refreshHoldings();
      void refreshPortfolioSummary();
      void refreshUserInfo();
    };

    window.addEventListener("trade-executed", handleDataRefresh);
    window.addEventListener("capital-updated", handleDataRefresh);

    const refreshTimer = window.setInterval(() => {
      void refreshStocks();
      void refreshHoldings();
      void refreshPortfolioSummary();
      void refreshUserInfo();
    }, 60_000);

    return () => {
      isMounted = false;
      window.clearInterval(refreshTimer);
      window.removeEventListener("trade-executed", handleDataRefresh);
      window.removeEventListener("capital-updated", handleDataRefresh);
    };
  }, [cachedStocks]);

  const handleLogout = async () => {
    await logoutUser({ redirectTo: "/login" });
  };

  const hasYesterdayPnL =
    typeof portfolioSummary.yesterdayPnL === "number" &&
    portfolioSummary.yesterdayPnL !== 0;
  const dailyChangePercent = hasYesterdayPnL
    ? ((portfolioSummary.todayPnL - portfolioSummary.yesterdayPnL!) /
        Math.abs(portfolioSummary.yesterdayPnL!)) *
      100
    : null;
  const dailyChangeSign = dailyChangePercent !== null && dailyChangePercent >= 0 ? "+" : "";
  const dailyChangeLabel =
    dailyChangePercent === null
      ? "No comparison data"
      : `${dailyChangeSign}${dailyChangePercent.toFixed(2)}% vs yesterday`;

  let stockContent: ReactNode;
  if (stocksLoading) {
    stockContent = (
      <DataState
        status="loading"
        title="Loading available stocks"
        message="Fetching the latest stock universe."
      />
    );
  } else if (stocksFailed) {
    stockContent = (
      <DataState
        status="error"
        title="Available stocks failed to load"
        message="The backend did not return the stock universe."
      />
    );
  } else {
    stockContent = (
      <StockTable
        stocks={stocks}
        title="Available Stocks"
        subtitle="Click any row to trade · Search, filter and sort the full NSE stock universe"
        visibleRows={8}
        onRowClick={(stock) =>
          openTrade({ ticker: stock.ticker, name: stock.name, price: stock.price })
        }
      />
    );
  }

  return (
    <main className="dashboard-page">
      <Header
        userName={userInfo.name}
        userEmail={userInfo.email}
        onLogout={handleLogout}
      />

      {/* {notice && (
        <div className="toast-overlay">
          <div
            className={`toast-message ${notice.type}`}
            role="status"
            aria-live="polite"
          >
            {notice.text}
          </div>
        </div>
      )} */}

      <div className="dashboard-shell">
        <section className="dashboard-topbar">
          <div>
            <p className="dashboard-kicker">Portfolio overview</p>
            <h1>Dashboard</h1>
          </div>
        </section>

        <section className="dashboard-summary-grid">
          <div
            className={`summary-card ${
              portfolioSummary.todayPnL > 0
                ? "profit-card"
                : portfolioSummary.todayPnL < 0
                ? "loss-card"
                : ""
            }`}
          >
            <span>Today&apos;s Profit/Loss</span>
            <strong
              className={
                portfolioSummary.todayPnL > 0
                  ? "text-profit"
                  : portfolioSummary.todayPnL < 0
                  ? "text-loss"
                  : ""
              }
            >
              {summaryLoading ? "Loading..." : formatCurrency(portfolioSummary.todayPnL)}
            </strong>
            <small>{summaryLoading ? "Fetching latest data" : dailyChangeLabel}</small>
          </div>

          <div className="summary-card">
            <span>Portfolio Value</span>
            <strong>{summaryLoading ? "Loading..." : formatCurrency(portfolioSummary.totalPortfolioValue)}</strong>
            <small>{summaryLoading ? "Fetching latest data" : `Across ${holdings.length} ${holdings.length === 1 ? "holding" : "holdings"}`}</small>
          </div>

          <div className="summary-card">
            <span>Invested Capital</span>
            <strong>{summaryLoading ? "Loading..." : formatCurrency(portfolioSummary.investedCapital)}</strong>
            <small>{summaryLoading ? "Fetching latest data" : "Based on current positions"}</small>
          </div>

          <div
            className={`summary-card ${
              portfolioSummary.totalProfit > 0
                ? "profit-card"
                : portfolioSummary.totalProfit < 0
                ? "loss-card"
                : ""
            }`}
          >
            <span>Total P/L</span>
            <strong
              className={
                portfolioSummary.totalProfit > 0
                  ? "text-profit"
                  : portfolioSummary.totalProfit < 0
                  ? "text-loss"
                  : ""
              }
            >
              {summaryLoading ? "Loading..." : formatCurrency(portfolioSummary.totalProfit)}
            </strong>
            <small>{summaryLoading ? "Fetching latest data" : "Net realized + unrealized"}</small>
          </div>
        </section>

        {/* Daily Strategy & Auto-Trade Desk */}
        <StrategyBanner stocks={stocks} />

        <section className="dashboard-stock-section">
          {stockContent}
        </section>
      </div>
    </main>
  );
}

export default DashboardPage;