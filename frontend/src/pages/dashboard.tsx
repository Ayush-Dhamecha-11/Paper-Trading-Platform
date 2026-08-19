import { useMemo, useState } from "react";
import Header from "../components/Header";
import { AllocationDoughnutChart, ProfitLineChart, type ChartRangeKey } from "../utils/chartUtils";
import "../pages_css/dashboard.css";

const rangeData: Record<"30D" | "6M" | "1Y", number[]> = {
  "30D": [110, 118, 124, 132, 128, 140, 148, 152, 160, 155, 168, 170],
  "6M": [90, 96, 104, 110, 118, 123, 131, 138, 146, 155, 162, 170],
  "1Y": [60, 68, 74, 82, 95, 101, 112, 125, 138, 150, 165, 170],
};

const holdings = [
  { ticker: "AAPL", name: "Apple Inc.", price: 214.3, quantity: 120, profit: 3510.5 },
  { ticker: "MSFT", name: "Microsoft", price: 418.75, quantity: 80, profit: 4820.2 },
  { ticker: "NVDA", name: "NVIDIA", price: 128.9, quantity: 200, profit: 6125.4 },
  { ticker: "AMZN", name: "Amazon", price: 185.2, quantity: 140, profit: 2680.7 },
  { ticker: "TSLA", name: "Tesla", price: 211.5, quantity: 90, profit: -1180.9 },
];

const sectorAllocation = [
  { name: "Technology", value: 42, color: "#21d9a3" },
  { name: "Healthcare", value: 18, color: "#34b3ff" },
  { name: "Finance", value: 15, color: "#8b7cff" },
  { name: "Energy", value: 13, color: "#fbbf24" },
  { name: "Consumer", value: 12, color: "#ff7b72" },
];

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(value);
}

function DashboardPage() {
  const notice = (() => {
    const savedNotice = window.sessionStorage.getItem("auth_notice");

    if (!savedNotice) {
      return null;
    }

    try {
      const parsedNotice = JSON.parse(savedNotice) as { text?: string; type?: "success" | "error" };
      if (!parsedNotice.text) {
        return null;
      }

      return {
        text: parsedNotice.text,
        type: parsedNotice.type === "error" ? "error" : "success",
      };
    } catch {
      window.sessionStorage.removeItem("auth_notice");
      return null;
    }
  })();
  const [range, setRange] = useState<ChartRangeKey>("30D");

  const totalPortfolioValue = useMemo(
    () => holdings.reduce((sum, item) => sum + item.price * item.quantity, 0),
    []
  );
  const investedCapital = useMemo(
    () => holdings.reduce((sum, item) => sum + item.price * item.quantity * 0.88, 0),
    []
  );
  const totalProfit = useMemo(
    () => holdings.reduce((sum, item) => sum + item.profit, 0),
    []
  );
  const todayPnL = 1240.6;

  const chartValues = rangeData[range];
  const chartLabels = Array.from({ length: chartValues.length }, (_, index) => `P${index + 1}`);

  const handleLogout = async () => {
    try {
      await fetch(`${String(import.meta.env.VITE_BACKEND_URL || import.meta.env.BACKEND_URL || "http://localhost:8000").replace(/\/$/, "")}/auth/logout`, {
        method: "POST",
        credentials: "include",
        headers: {
          Accept: "application/json",
        },
      });
    } catch {
      // Ignore logout request errors and continue with local cleanup.
    }

    localStorage.removeItem("auth_token");
    localStorage.removeItem("refresh_token");
    localStorage.removeItem("auth_session");
    window.dispatchEvent(new CustomEvent("auth-success"));
    window.location.href = "/login";
  };

  return (
    <main className="dashboard-page">
      <Header
        userName="Jenil Shah"
        userEmail="jenilshah740@gmail.com"
        onLogout={handleLogout}
      />

      {notice && (
        <div className="toast-overlay">
          <div className={`toast-message ${notice.type}`} role="status" aria-live="polite">
            {notice.text}
          </div>
        </div>
      )}

      <div className="dashboard-shell">
        <section className="dashboard-topbar">
          <div>
            <p className="dashboard-kicker">Portfolio overview</p>
            <h1>Dashboard</h1>
          </div>
        </section>

        <section className="dashboard-summary-grid">
          <div className="summary-card profit-card">
            <span>Today&apos;s Profit/Loss</span>
            <strong>{formatCurrency(todayPnL)}</strong>
            <small>+3.4% vs yesterday</small>
          </div>

          <div className="summary-card">
            <span>Portfolio Value</span>
            <strong>{formatCurrency(totalPortfolioValue)}</strong>
            <small>Across {holdings.length} holdings</small>
          </div>

          <div className="summary-card">
            <span>Invested Capital</span>
            <strong>{formatCurrency(investedCapital)}</strong>
            <small>Based on current positions</small>
          </div>

          <div className="summary-card">
            <span>Total P/L</span>
            <strong>{formatCurrency(totalProfit)}</strong>
            <small>Net realized + unrealized</small>
          </div>
        </section>

        <section className="dashboard-grid">
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
                    onClick={() => setRange(key)}
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
                  {holdings.map((stock) => (
                    <tr key={stock.ticker}>
                      <td>{stock.ticker}</td>
                      <td>{stock.name}</td>
                      <td>{formatCurrency(stock.price)}</td>
                      <td>{stock.quantity}</td>
                      <td className={stock.profit >= 0 ? "profit-value" : "loss-value"}>
                        {formatCurrency(stock.profit)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

export default DashboardPage;
