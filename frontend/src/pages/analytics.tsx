import { useEffect, useMemo, useState } from "react";
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
import { logoutUser } from "../utils/authUtils";
import "../pages_css/analytics.css";

const API_BASE_URL =
  import.meta.env.VITE_BACKEND_URL ||
  import.meta.env.VITE_API_BASE_URL ||
  "http://localhost:8000";

async function loadAnalyticsData(): Promise<AnalyticsData> {
  console.debug("[AnalyticsPage] Loading analytics data", {
    apiBaseUrl: API_BASE_URL,
  });

  /*
   * Backend integration ready block:
   * When the backend endpoint is available, replace the dummy return below
   * with this fetch. Return the same AnalyticsData shape used by
   * DUMMY_ANALYTICS_DATA.
   *
   * const response = await fetch(`${API_BASE_URL}/api/analytics`);
   * if (!response.ok) {
   *   throw new Error("Unable to load analytics data");
   * }
   * return (await response.json()) as AnalyticsData;
   */

  return DUMMY_ANALYTICS_DATA;
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
  const [benchmarkRange, setBenchmarkRange] = useState<AnalyticsRangeKey>("6M");
  const [portfolioRange, setPortfolioRange] = useState<AnalyticsRangeKey>("6M");
  const [riskRange, setRiskRange] = useState<AnalyticsRangeKey>("6M");
  const [alphaRange, setAlphaRange] = useState<AnalyticsRangeKey>("6M");
  const [analyticsData, setAnalyticsData] = useState<AnalyticsData>(DUMMY_ANALYTICS_DATA);
  const benchmarkSeries = useMemo(
    () => analyticsData.performanceSeries[benchmarkRange],
    [analyticsData.performanceSeries, benchmarkRange]
  );
  const portfolioSeries = useMemo(
    () => analyticsData.performanceSeries[portfolioRange],
    [analyticsData.performanceSeries, portfolioRange]
  );
  const riskSeries = useMemo(
    () => analyticsData.performanceSeries[riskRange],
    [analyticsData.performanceSeries, riskRange]
  );
  const alphaSeries = useMemo(
    () => analyticsData.performanceSeries[alphaRange],
    [analyticsData.performanceSeries, alphaRange]
  );
  const stockAllocationTotal = useMemo(
    () => analyticsData.stockAllocation.reduce((sum, stock) => sum + stock.value, 0),
    [analyticsData.stockAllocation]
  );

  useEffect(() => {
    let isMounted = true;

    loadAnalyticsData()
      .then((data) => {
        if (!isMounted) {
          return;
        }

        console.debug("[AnalyticsPage] Analytics data ready", data);
        setAnalyticsData(data);
      })
      .catch((error) => {
        if (!isMounted) {
          return;
        }

        console.error("[AnalyticsPage] Falling back to dummy analytics data", error);
        setAnalyticsData(DUMMY_ANALYTICS_DATA);
      });

    return () => {
      isMounted = false;
    };
  }, []);

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

  return (
    <main className="analytics-page">
      <Header
        userName="Jenil Shah"
        userEmail="jenilshah740@gmail.com"
        onLogout={handleLogout}
      />

      <div className="analytics-shell">
        <section className="analytics-hero">
          <div>
            <p className="analytics-kicker">Advanced analytics</p>
            <h1>Portfolio intelligence</h1>
          </div>
        </section>

        <AnalyticsMetricCards metrics={analyticsData.summary} />

        <section className="analytics-grid">
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

          <AnalyticsChartCard title="Sector Allocation" eyebrow="Composition">
            <AllocationChart points={analyticsData.sectorAllocation} />
          </AnalyticsChartCard>

          <AnalyticsChartCard
            title="Stock Allocation"
            eyebrow="Concentration"
            actions={<span className="analytics-total-badge">Total {stockAllocationTotal}%</span>}
          >
            <HorizontalBarChart points={analyticsData.stockAllocation} showTotal />
          </AnalyticsChartCard>

          <AnalyticsChartCard title="P&L by Stock" eyebrow="Contribution">
            <HorizontalBarChart points={analyticsData.pnlByStock} valueSuffix="" />
          </AnalyticsChartCard>

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

          <AnalyticsChartCard title="Risk vs Return by Stock" eyebrow="Advanced risk">
            <RiskReturnScatter points={analyticsData.riskByStock} />
          </AnalyticsChartCard>

          <AnalyticsChartCard title="Daily Return Distribution" eyebrow="Distribution">
            <HorizontalBarChart points={analyticsData.returnDistribution} valueSuffix=" days" />
          </AnalyticsChartCard>

          <AnalyticsChartCard title="Trading Performance" eyebrow="Trades">
            <AnalyticsMetricCards metrics={analyticsData.tradingMetrics} />
          </AnalyticsChartCard>

          <AnalyticsChartCard title="Cumulative P&L by Trade" eyebrow="Consistency">
            <TradePnlChart tradePnl={analyticsData.tradePnl} />
          </AnalyticsChartCard>

          <AnalyticsChartCard title="Monthly Returns Heatmap" eyebrow="Seasonality">
            <MonthlyReturnsHeatmap months={analyticsData.monthlyReturns} />
          </AnalyticsChartCard>

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
        </section>
      </div>
    </main>
  );
}

export default AnalyticsPage;
