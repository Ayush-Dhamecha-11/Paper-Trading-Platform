import { useEffect, useMemo, useState } from "react";
import DataState from "../components/DataState";
import Header from "../components/Header";
import {
  AllocationChart,
  AnalyticsChartCard,
  AnalyticsMetricCards,
  BenchmarkComparisonChart,
  DrawdownVolatilityChart,
  HorizontalBarChart,
  MonthlyReturnsHeatmap,
  PortfolioPnlChart,
  RiskReturnScatter,
  TradePnlChart,
} from "../components/Analytics/AnalyticsCharts";
import {
  ANALYTICS_RANGE_KEYS,
  DUMMY_ANALYTICS_DATA,
  type AnalyticsData,
  type AnalyticsRangeKey,
} from "../data/analyticsData";
import {
  getBackendBaseUrl,
  authenticatedFetch,
  getStoredUserInfo,
  logBackendResponse,
  logoutUser,
  setStoredUserInfo,
  type StoredUserInfo,
} from "../utils/authUtils";
import {
  getCachedData,
  setCachedData,
  DASHBOARD_SUMMARY_CACHE_KEY,
  HOLDINGS_CACHE_KEY,
} from "../utils/dataCache";
import { useTradeModal } from "../context/TradeContext";
import { ShoppingBag, ArrowRight } from "lucide-react";
import "../pages_css/analytics.css";

const API_BASE_URL =
  import.meta.env.VITE_BACKEND_URL ||
  import.meta.env.VITE_API_BASE_URL ||
  "http://localhost:8000";
const ANALYTICS_CACHE_KEY = "analytics_data";

function getCachedAnalyticsData() {
  return getCachedData<AnalyticsData>(ANALYTICS_CACHE_KEY);
}

async function loadAnalyticsData(): Promise<AnalyticsData> {
  console.debug("[AnalyticsPage] Loading analytics data", {
    apiBaseUrl: API_BASE_URL,
  });

  const response = await authenticatedFetch(`${API_BASE_URL}/api/analytics`, {
    credentials: "include",
  });
  logBackendResponse(response, "GET /api/analytics");

  if (!response.ok) {
    throw new Error("Analytics data failed to load.");
  }

  return (await response.json()) as AnalyticsData;
}

function ChartRangeSwitcher({
  range,
  onRangeChange,
  label,
}: Readonly<{
  range: AnalyticsRangeKey;
  onRangeChange: (range: AnalyticsRangeKey) => void;
  label: string;
}>) {
  return (
    <div className="analytics-range-switcher" aria-label={label}>
      {ANALYTICS_RANGE_KEYS.map((key) => (
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
  );
}

function AnalyticsPage() {
  const [userInfo, setUserInfo] = useState(() => {
    const storedUserInfo = getStoredUserInfo();

    return {
      name: storedUserInfo?.name?.trim() || "User",
      email: storedUserInfo?.email?.trim() || "--",
    };
  });
  const { openTrade } = useTradeModal();
  const [benchmarkRange, setBenchmarkRange] = useState<AnalyticsRangeKey>("6M");
  const [portfolioRange, setPortfolioRange] = useState<AnalyticsRangeKey>("6M");
  const [riskRange, setRiskRange] = useState<AnalyticsRangeKey>("6M");
  const [alphaRange, setAlphaRange] = useState<AnalyticsRangeKey>("6M");
  const [analyticsStatus, setAnalyticsStatus] = useState<"loading" | "ready" | "empty" | "error">("loading");
  const [analyticsRequestKey, setAnalyticsRequestKey] = useState(0);
  const [analyticsData, setAnalyticsData] = useState<AnalyticsData>(
    () => getCachedAnalyticsData() ?? DUMMY_ANALYTICS_DATA
  );
  const benchmarkSeries = useMemo(
    () => analyticsData?.performanceSeries?.[benchmarkRange] ?? [],
    [analyticsData?.performanceSeries, benchmarkRange]
  );
  const portfolioSeries = useMemo(
    () => analyticsData?.performanceSeries?.[portfolioRange] ?? [],
    [analyticsData?.performanceSeries, portfolioRange]
  );
  const riskSeries = useMemo(
    () => analyticsData?.performanceSeries?.[riskRange] ?? [],
    [analyticsData?.performanceSeries, riskRange]
  );
  const alphaSeries = useMemo(
    () => analyticsData?.performanceSeries?.[alphaRange] ?? [],
    [analyticsData?.performanceSeries, alphaRange]
  );
  const stockAllocationTotal = useMemo(
    () => (analyticsData?.stockAllocation ?? []).reduce((sum, stock) => sum + stock.value, 0),
    [analyticsData?.stockAllocation]
  );

  // ─── Guard checks to only show charts that actually have values ────────────
  const hasBenchmarkSeries = useMemo(
    () =>
      benchmarkSeries.length > 0 &&
      benchmarkSeries.some(
        (p) => (p.portfolio ?? 0) !== 0 || (p.benchmark ?? 0) !== 0
      ),
    [benchmarkSeries]
  );

  const hasPortfolioSeries = useMemo(
    () =>
      portfolioSeries.length > 0 &&
      portfolioSeries.some(
        (p) => (p.portfolio ?? 0) !== 0 || (p.pnl ?? 0) !== 0
      ),
    [portfolioSeries]
  );

  const hasSectorAllocation = useMemo(
    () =>
      (analyticsData.sectorAllocation ?? []).length > 0 &&
      analyticsData.sectorAllocation.some((p) => p.value > 0),
    [analyticsData.sectorAllocation]
  );

  const hasStockAllocation = useMemo(
    () =>
      (analyticsData.stockAllocation ?? []).length > 0 &&
      analyticsData.stockAllocation.some((p) => p.value > 0),
    [analyticsData.stockAllocation]
  );

  const hasPnlByStock = useMemo(
    () =>
      (analyticsData.pnlByStock ?? []).length > 0 &&
      analyticsData.pnlByStock.some((p) => p.value !== 0),
    [analyticsData.pnlByStock]
  );

  const hasRiskSeries = useMemo(
    () =>
      riskSeries.length > 0 &&
      riskSeries.some(
        (p) => (p.drawdown ?? 0) !== 0 || (p.volatility ?? 0) !== 0
      ),
    [riskSeries]
  );

  const hasRiskByStock = useMemo(
    () =>
      (analyticsData.riskByStock ?? []).length > 0 &&
      analyticsData.riskByStock.some(
        (p) => p.returnPct !== 0 || p.volatilityPct !== 0
      ),
    [analyticsData.riskByStock]
  );

  const hasReturnDistribution = useMemo(
    () =>
      (analyticsData.returnDistribution ?? []).length > 0 &&
      analyticsData.returnDistribution.some((p) => p.value > 0),
    [analyticsData.returnDistribution]
  );

  const hasTradingMetrics = useMemo(
    () =>
      (analyticsData.tradingMetrics ?? []).length > 0 &&
      analyticsData.tradingMetrics.some(
        (m) => m.value && m.value !== "--" && m.value !== "0"
      ),
    [analyticsData.tradingMetrics]
  );

  const hasTradePnl = useMemo(
    () =>
      (analyticsData.tradePnl ?? []).length > 0 &&
      analyticsData.tradePnl.some((v) => v !== 0),
    [analyticsData.tradePnl]
  );

  const hasMonthlyReturns = useMemo(
    () =>
      (analyticsData.monthlyReturns ?? []).length > 0 &&
      analyticsData.monthlyReturns.some((m) => m.value !== 0),
    [analyticsData.monthlyReturns]
  );

  const hasAlphaSeries = useMemo(
    () =>
      alphaSeries.length > 0 &&
      alphaSeries.some((p) => (p.alpha ?? 0) !== 0),
    [alphaSeries]
  );

  const hasSummaryMetrics = useMemo(
    () =>
      (analyticsData.summary ?? []).length > 0 &&
      analyticsData.summary.some((m) => m.value && m.value !== "--"),
    [analyticsData.summary]
  );

  useEffect(() => {
    let isMounted = true;
    const storedUserInfo = getStoredUserInfo();
    const cachedAnalyticsData = getCachedAnalyticsData();

    authenticatedFetch(`${getBackendBaseUrl()}/api/profile`, {
      credentials: "include",
    })
      .then(async (response) => {
        logBackendResponse(response, "GET /api/profile");

        if (!response.ok) {
          throw new Error("Unable to load user information.");
        }

        return (await response.json()) as {
          name?: string;
          email?: string;
          preference?: StoredUserInfo;
        };
      })
      .then((profile) => {
        if (!isMounted) {
          return;
        }

        const nextUserInfo: StoredUserInfo = {
          name: profile.name,
          email: profile.email,
          theme: profile.preference?.theme,
          auto_trade: profile.preference?.auto_trade,
        };

        setStoredUserInfo(nextUserInfo);
        setUserInfo({
          name: nextUserInfo.name?.trim() || "User",
          email: nextUserInfo.email?.trim() || "--",
        });
      })
      .catch(() => {
        if (!isMounted) {
          return;
        }

        setUserInfo({
          name: storedUserInfo?.name?.trim() || "User",
          email: storedUserInfo?.email?.trim() || "--",
        });
      });

    const refreshAnalyticsData = () => loadAnalyticsData()
      .then((data) => {
        if (!isMounted) {
          return;
        }

        console.debug("[AnalyticsPage] Analytics data ready", data);
        const isEmpty =
          !data ||
          ((!data.stockAllocation || data.stockAllocation.length === 0) &&
           (!data.sectorAllocation || data.sectorAllocation.length === 0));

        if (isEmpty) {
          setAnalyticsStatus("empty");
        } else {
          setCachedData(ANALYTICS_CACHE_KEY, data);
          setAnalyticsData(data);
          setAnalyticsStatus("ready");
        }
      })
      .catch((error) => {
        if (!isMounted) {
          return;
        }

        console.error("[AnalyticsPage] Analytics data failed to load", error);
        if (cachedAnalyticsData && (cachedAnalyticsData.stockAllocation?.length > 0 || cachedAnalyticsData.sectorAllocation?.length > 0)) {
          setAnalyticsStatus("ready");
        } else {
          setAnalyticsStatus("empty");
        }
      });

    void refreshAnalyticsData();

    const handleDataRefresh = () => {
      sessionStorage.removeItem(ANALYTICS_CACHE_KEY);
      sessionStorage.removeItem(DASHBOARD_SUMMARY_CACHE_KEY);
      sessionStorage.removeItem(HOLDINGS_CACHE_KEY);
      void refreshAnalyticsData();
    };
    window.addEventListener("trade-executed", handleDataRefresh);
    window.addEventListener("capital-updated", handleDataRefresh);

    const refreshTimer = window.setInterval(() => {
      void refreshAnalyticsData();
    }, 60_000);

    return () => {
      isMounted = false;
      window.clearInterval(refreshTimer);
      window.removeEventListener("trade-executed", handleDataRefresh);
      window.removeEventListener("capital-updated", handleDataRefresh);
    };
  }, [analyticsRequestKey]);

  useEffect(() => {
    console.debug("[AnalyticsPage] Chart ranges changed", {
      benchmarkRange,
      portfolioRange,
      riskRange,
      alphaRange,
    });
  }, [alphaRange, benchmarkRange, portfolioRange, riskRange]);

  const handleLogout = async () => {
    await logoutUser({ redirectTo: "/login" });
  };

  const handleAnalyticsRetry = () => {
    setAnalyticsStatus(getCachedAnalyticsData() ? "ready" : "loading");
    setAnalyticsRequestKey((current) => current + 1);
  };

  if (analyticsStatus !== "ready") {
    return (
      <main className="analytics-page">
        <Header
          userName={userInfo.name}
          userEmail={userInfo.email}
          onLogout={handleLogout}
        />
        <div className="analytics-shell">
          <section className="analytics-hero">
            <div>
              <p className="analytics-kicker">Advanced analytics</p>
              <h1>Portfolio intelligence</h1>
            </div>
          </section>
          {analyticsStatus === "loading" && (
            <DataState
              status="loading"
              title="Loading analytics data"
              message="Fetching the latest portfolio analytics."
            />
          )}
          {analyticsStatus === "empty" && (
            <section className="analytics-empty-state" role="status">
              <div className="analytics-empty-icon-wrap" aria-hidden="true">
                <ShoppingBag size={34} />
              </div>
              <h2>You don&apos;t have any stocks in your portfolio so nothing to show</h2>
              <p>
                Your portfolio is currently empty. Start trading stocks to unlock detailed performance analytics, benchmark comparisons, and sector allocation charts.
              </p>
              <div className="analytics-empty-actions">
                <button
                  type="button"
                  className="analytics-btn-primary"
                  onClick={() => openTrade()}
                >
                  <span>Start Trading</span>
                  <ArrowRight size={16} aria-hidden="true" />
                </button>
                <a href="/dashboard" className="analytics-btn-secondary">
                  Explore Stocks
                </a>
              </div>
            </section>
          )}
          {analyticsStatus === "error" && (
            <DataState
              status="error"
              title="Analytics data failed to load"
              message="The backend did not return analytics data. Please try again."
              onRetry={handleAnalyticsRetry}
            />
          )}
        </div>
      </main>
    );
  }

  return (
    <main className="analytics-page">
      <Header
        userName={userInfo.name}
        userEmail={userInfo.email}
        onLogout={handleLogout}
      />

      <div className="analytics-shell">
        <section className="analytics-hero">
          <div>
            <p className="analytics-kicker">Advanced analytics</p>
            <h1>Portfolio intelligence</h1>
          </div>
        </section>

        {hasSummaryMetrics && (
          <AnalyticsMetricCards metrics={analyticsData.summary} />
        )}

        <section className="analytics-grid">
          {hasBenchmarkSeries && (
            <AnalyticsChartCard
              title="Portfolio vs NIFTY 50"
              eyebrow="Performance"
              wide
              actions={
                <ChartRangeSwitcher
                  range={benchmarkRange}
                  onRangeChange={setBenchmarkRange}
                  label="Portfolio benchmark time range"
                />
              }
            >
              <BenchmarkComparisonChart points={benchmarkSeries} />
            </AnalyticsChartCard>
          )}

          {hasPortfolioSeries && (
            <AnalyticsChartCard
              title="Portfolio Value / P&L"
              eyebrow="Growth"
              actions={
                <ChartRangeSwitcher
                  range={portfolioRange}
                  onRangeChange={setPortfolioRange}
                  label="Portfolio value time range"
                />
              }
            >
              <PortfolioPnlChart points={portfolioSeries} />
            </AnalyticsChartCard>
          )}

          {hasSectorAllocation && (
            <AnalyticsChartCard title="Sector Allocation" eyebrow="Composition">
              <AllocationChart points={analyticsData.sectorAllocation} />
            </AnalyticsChartCard>
          )}

          {hasStockAllocation && (
            <AnalyticsChartCard
              title="Stock Allocation"
              eyebrow="Concentration"
              actions={<span className="analytics-total-badge">Total {stockAllocationTotal}%</span>}
            >
              <HorizontalBarChart points={analyticsData.stockAllocation} showTotal />
            </AnalyticsChartCard>
          )}

          {hasPnlByStock && (
            <AnalyticsChartCard title="P&L by Stock" eyebrow="Contribution">
              <HorizontalBarChart points={analyticsData.pnlByStock} valueSuffix="" />
            </AnalyticsChartCard>
          )}

          {hasRiskSeries && (
            <AnalyticsChartCard
              title="Drawdown & Rolling Volatility"
              eyebrow="Risk"
              wide
              actions={
                <ChartRangeSwitcher
                  range={riskRange}
                  onRangeChange={setRiskRange}
                  label="Risk analytics time range"
                />
              }
            >
              <DrawdownVolatilityChart points={riskSeries} />
            </AnalyticsChartCard>
          )}

          {hasRiskByStock && (
            <AnalyticsChartCard title="Risk vs Return by Stock" eyebrow="Advanced risk">
              <RiskReturnScatter points={analyticsData.riskByStock} />
            </AnalyticsChartCard>
          )}

          {hasReturnDistribution && (
            <AnalyticsChartCard title="Daily Return Distribution" eyebrow="Distribution">
              <HorizontalBarChart points={analyticsData.returnDistribution} valueSuffix=" days" />
            </AnalyticsChartCard>
          )}

          {hasTradingMetrics && (
            <AnalyticsChartCard title="Trading Performance" eyebrow="Trades">
              <AnalyticsMetricCards metrics={analyticsData.tradingMetrics} />
            </AnalyticsChartCard>
          )}

          {hasTradePnl && (
            <AnalyticsChartCard title="Cumulative P&L by Trade" eyebrow="Consistency">
              <TradePnlChart tradePnl={analyticsData.tradePnl} />
            </AnalyticsChartCard>
          )}

          {hasMonthlyReturns && (
            <AnalyticsChartCard title="Monthly Returns Heatmap" eyebrow="Seasonality">
              <MonthlyReturnsHeatmap months={analyticsData.monthlyReturns} />
            </AnalyticsChartCard>
          )}

          {hasAlphaSeries && (
            <AnalyticsChartCard
              title="Cumulative Alpha"
              eyebrow="Outperformance"
              actions={
                <ChartRangeSwitcher
                  range={alphaRange}
                  onRangeChange={setAlphaRange}
                  label="Cumulative alpha time range"
                />
              }
            >
              <PortfolioPnlChart
                points={alphaSeries.map((point) => ({
                  ...point,
                  portfolio: point.alpha ?? 0,
                  pnl: point.alpha ?? 0,
                }))}
              />
            </AnalyticsChartCard>
          )}
        </section>
      </div>
    </main>
  );
}

export default AnalyticsPage;
