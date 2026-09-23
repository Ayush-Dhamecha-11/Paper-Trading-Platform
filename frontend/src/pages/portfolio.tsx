import { useEffect, useMemo, useState } from "react";
import Header from "../components/Header";
import {
  AllocationChart,
  AnalyticsChartCard,
  BenchmarkComparisonChart,
} from "../components/Analytics/AnalyticsCharts";
import type { AllocationPoint, TimeSeriesPoint } from "../data/analyticsData";
import { authenticatedFetch, getBackendBaseUrl, getStoredUserInfo, logBackendResponse, logoutUser, setStoredUserInfo, type StoredUserInfo } from "../utils/authUtils";
import { formatChangePercent, formatCurrency } from "../utils/formatters";
import { useTradeModal } from "../context/TradeContext";
import "../pages_css/portfolio.css";

type PortfolioHolding = {
  ticker: string;
  name: string;
  sector: string;
  quantity: number;
  averagePrice: number;
  currentPrice: number;
  previousClose: number;
};

type PortfolioData = {
  summary: {
    portfolioValue: number;
    investedCapital: number;
    totalProfit: number;
    todayPnL: number;
    totalReturnPct: number;
  };
  performanceSeries: TimeSeriesPoint[];
  sectorAllocation: AllocationPoint[];
  holdings: PortfolioHolding[];
};

type HoldingPerformanceFilter = "all" | "profit" | "loss";

// Replace this fixture with the backend response shape when /api/portfolio is ready.
const DUMMY_PORTFOLIO_DATA: PortfolioData = {
  summary: {
    portfolioValue: 129959,
    investedCapital: 114004,
    totalProfit: 15955,
    todayPnL: 1240,
    totalReturnPct: 14,
  },
  performanceSeries: [
    { label: "Mar", portfolio: 100, benchmark: 100, pnl: 0 },
    { label: "Apr", portfolio: 103, benchmark: 101, pnl: 3100 },
    { label: "May", portfolio: 101, benchmark: 102.8, pnl: 1200 },
    { label: "Jun", portfolio: 107, benchmark: 104.4, pnl: 7050 },
    { label: "Jul", portfolio: 112, benchmark: 107, pnl: 12100 },
    { label: "Aug", portfolio: 114, benchmark: 110.3, pnl: 14000 },
  ],
  sectorAllocation: [
    { label: "Banking", value: 30, color: "#5996eb" },
    { label: "IT", value: 24, color: "#24c6dc" },
    { label: "Energy", value: 22, color: "#20d89b" },
    { label: "FMCG", value: 14, color: "#f5b942" },
    { label: "Pharma", value: 10, color: "#f56b6b" },
  ],
  holdings: [
    { ticker: "RELIANCE", name: "Reliance Industries", sector: "Energy", quantity: 24, averagePrice: 2440, currentPrice: 2653.33, previousClose: 2620 },
    { ticker: "HDFCBANK", name: "HDFC Bank", sector: "Banking", quantity: 48, averagePrice: 1580, currentPrice: 1660.42, previousClose: 1648 },
    { ticker: "ICICIBANK", name: "ICICI Bank", sector: "Banking", quantity: 36, averagePrice: 1120, currentPrice: 1268.06, previousClose: 1252 },
    { ticker: "SBIN", name: "State Bank of India", sector: "Banking", quantity: 54, averagePrice: 720, currentPrice: 777.78, previousClose: 770 },
    { ticker: "TCS", name: "Tata Consultancy Services", sector: "IT", quantity: 18, averagePrice: 3500, currentPrice: 3844.44, previousClose: 3810 },
    { ticker: "INFY", name: "Infosys", sector: "IT", quantity: 30, averagePrice: 1420, currentPrice: 1578.67, previousClose: 1565 },
    { ticker: "ITC", name: "ITC Limited", sector: "FMCG", quantity: 80, averagePrice: 430, currentPrice: 452.5, previousClose: 448 },
    { ticker: "HINDUNILVR", name: "Hindustan Unilever", sector: "FMCG", quantity: 24, averagePrice: 2380, currentPrice: 2550, previousClose: 2518 },
    { ticker: "SUNPHARMA", name: "Sun Pharmaceutical", sector: "Pharma", quantity: 26, averagePrice: 1450, currentPrice: 1544.62, previousClose: 1560 },
    { ticker: "CIPLA", name: "Cipla", sector: "Pharma", quantity: 34, averagePrice: 1210, currentPrice: 1282.94, previousClose: 1270 },
  ],
};

async function loadPortfolioData(): Promise<PortfolioData> {
  const response = await authenticatedFetch(`${getBackendBaseUrl()}/api/portfolio`, {
    credentials: "include",
  });
  logBackendResponse(response, "GET /api/portfolio");

  if (!response.ok) {
    throw new Error("Portfolio data failed to load.");
  }

  return (await response.json()) as PortfolioData;
}

function PortfolioPage() {
  const { openTrade } = useTradeModal();
  const [status, setStatus] = useState<"ready">("ready");
  const [data, setData] = useState<PortfolioData>(DUMMY_PORTFOLIO_DATA);
  const [holdingSearch, setHoldingSearch] = useState("");
  const [holdingSector, setHoldingSector] = useState("all");
  const [holdingPerformance, setHoldingPerformance] = useState<HoldingPerformanceFilter>("all");
  const [userInfo, setUserInfo] = useState(() => {
    const stored = getStoredUserInfo();
    return { name: stored?.name?.trim() || "User", email: stored?.email?.trim() || "--" };
  });

  useEffect(() => {
    let isMounted = true;

    authenticatedFetch(`${getBackendBaseUrl()}/api/profile`, { credentials: "include" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Profile failed to load");
        return (await response.json()) as { name?: string; email?: string; preference?: StoredUserInfo };
      })
      .then((profile) => {
        if (!isMounted) return;
        const nextUserInfo = { name: profile.name, email: profile.email, theme: profile.preference?.theme, auto_trade: profile.preference?.auto_trade };
        setStoredUserInfo(nextUserInfo);
        setUserInfo({ name: nextUserInfo.name?.trim() || "User", email: nextUserInfo.email?.trim() || "--" });
      })
      .catch(() => undefined);

    loadPortfolioData()
      .then((portfolio) => {
        if (!isMounted) return;
        setData(portfolio);
        setStatus("ready");
      })
      .catch(() => {
        if (isMounted) {
          setData(DUMMY_PORTFOLIO_DATA);
          setStatus("ready");
        }
      });

    return () => { isMounted = false; };
  }, []);

  const holdings = useMemo(() => data.holdings.map((holding) => {
    const marketValue = holding.quantity * holding.currentPrice;
    const investedValue = holding.quantity * holding.averagePrice;
    const profitLoss = marketValue - investedValue;
    const dailyGainLoss = holding.quantity * (holding.currentPrice - holding.previousClose);
    return {
      ...holding,
      marketValue,
      profitLoss,
      profitLossPct: investedValue ? (profitLoss / investedValue) * 100 : 0,
      dailyGainLoss,
      dailyChangePct: holding.previousClose ? ((holding.currentPrice - holding.previousClose) / holding.previousClose) * 100 : 0,
    };
  }), [data.holdings]);

  const holdingSectors = useMemo(
    () => Array.from(new Set(holdings.map((holding) => holding.sector))).sort((left, right) => left.localeCompare(right)),
    [holdings]
  );

  const filteredHoldings = useMemo(() => {
    const normalizedSearch = holdingSearch.trim().toLowerCase();

    return holdings.filter((holding) => {
      const matchesSearch =
        !normalizedSearch ||
        holding.ticker.toLowerCase().includes(normalizedSearch) ||
        holding.name.toLowerCase().includes(normalizedSearch);
      const matchesSector = holdingSector === "all" || holding.sector === holdingSector;
      const matchesPerformance =
        holdingPerformance === "all" ||
        (holdingPerformance === "profit" && holding.profitLoss >= 0) ||
        (holdingPerformance === "loss" && holding.profitLoss < 0);

      return matchesSearch && matchesSector && matchesPerformance;
    });
  }, [holdingPerformance, holdingSearch, holdingSector, holdings]);

  const handleLogout = async () => { await logoutUser({ redirectTo: "/login" }); };

  return (
    <main className="portfolio-page">
      <Header userName={userInfo.name} userEmail={userInfo.email} onLogout={handleLogout} />
      <div className="portfolio-shell">
        <section className="portfolio-hero">
          <div>
            <p className="portfolio-kicker">Portfolio workspace</p>
            <h1>Portfolio</h1>
            <p>Track performance, allocation, and every position in one view.</p>
          </div>
          <span className="portfolio-live-status"><span /> Live portfolio</span>
        </section>

        {status === "ready" && <>
          <section className="portfolio-stat-grid" aria-label="Portfolio performance statistics">
            <article><span>Portfolio value</span><strong>{formatCurrency(data.summary.portfolioValue)}</strong><small>Current market value</small></article>
            <article><span>Invested capital</span><strong>{formatCurrency(data.summary.investedCapital)}</strong><small>Cost basis</small></article>
            <article className={data.summary.totalProfit >= 0 ? "positive" : "negative"}><span>Total P/L</span><strong>{formatCurrency(data.summary.totalProfit)}</strong><small>{formatChangePercent(data.summary.totalReturnPct)} overall return</small></article>
            <article className={data.summary.todayPnL >= 0 ? "positive" : "negative"}><span>Today&apos;s P/L</span><strong>{formatCurrency(data.summary.todayPnL)}</strong><small>Daily movement</small></article>
          </section>

          <section className="portfolio-chart-grid">
            <AnalyticsChartCard title="Portfolio performance" eyebrow="Growth">
              <BenchmarkComparisonChart points={data.performanceSeries} />
            </AnalyticsChartCard>
            <AnalyticsChartCard title="Sector allocation" eyebrow="Composition">
              <AllocationChart points={data.sectorAllocation} />
            </AnalyticsChartCard>
          </section>

          <section className="portfolio-holdings-panel">
            <div className="portfolio-section-heading">
              <div><p>Positions</p><h2>Holdings</h2></div>
              <span>{filteredHoldings.length} of {holdings.length} positions</span>
            </div>
            <div className="portfolio-holding-filters">
              <label>
                <span>Search holdings</span>
                <input
                  type="search"
                  placeholder="Ticker or stock name"
                  value={holdingSearch}
                  onChange={(event) => setHoldingSearch(event.target.value)}
                />
              </label>
              <label>
                <span>Sector</span>
                <select value={holdingSector} onChange={(event) => setHoldingSector(event.target.value)}>
                  <option value="all">All sectors</option>
                  {holdingSectors.map((sector) => <option key={sector} value={sector}>{sector}</option>)}
                </select>
              </label>
              <label>
                <span>Performance</span>
                <select value={holdingPerformance} onChange={(event) => setHoldingPerformance(event.target.value as HoldingPerformanceFilter)}>
                  <option value="all">All positions</option>
                  <option value="profit">Profitable</option>
                  <option value="loss">Loss-making</option>
                </select>
              </label>
            </div>
            <div className="portfolio-table-wrap">
              <table className="portfolio-holdings-table">
                <thead><tr><th>Stock</th><th>Qty</th><th>Current price</th><th>Last price</th><th>Market value</th><th>P/L</th><th>Day change</th><th className="portfolio-action-col">Action</th></tr></thead>
                <tbody>{filteredHoldings.map((holding) => (
                  <tr key={holding.ticker}>
                    <td><strong>{holding.ticker}</strong><span>{holding.name} · {holding.sector}</span></td>
                    <td>{holding.quantity.toLocaleString("en-IN")}</td>
                    <td>{formatCurrency(holding.currentPrice)}</td>
                    <td>{formatCurrency(holding.previousClose)}</td>
                    <td>{formatCurrency(holding.marketValue)}</td>
                    <td className={holding.profitLoss >= 0 ? "positive" : "negative"}><strong>{formatCurrency(holding.profitLoss)}</strong><span>{formatChangePercent(holding.profitLossPct)}</span></td>
                    <td className={holding.dailyGainLoss >= 0 ? "positive" : "negative"}><strong>{formatCurrency(holding.dailyGainLoss)}</strong><span>{formatChangePercent(holding.dailyChangePct)}</span></td>
                    <td className="portfolio-action-col">
                      <button
                        type="button"
                        className="portfolio-sell-btn"
                        onClick={() => openTrade(
                          { ticker: holding.ticker, name: holding.name, price: holding.currentPrice },
                          "sell"
                        )}
                        aria-label={`Sell ${holding.ticker}`}
                      >
                        Sell
                      </button>
                    </td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </section>
        </>}
      </div>
    </main>
  );
}

export default PortfolioPage;
