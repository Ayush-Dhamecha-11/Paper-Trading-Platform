import {
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Filler,
  Legend,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip,
  type ChartData,
  type ChartOptions,
} from "chart.js";
import { Bar, Line, Scatter } from "react-chartjs-2";
import { AllocationDoughnutChart } from "../../utils/chartUtils";
import type {
  AllocationPoint,
  MonthlyReturn,
  StockRiskPoint,
  TimeSeriesPoint,
  TradingMetric,
} from "../../data/analyticsData";
import "./AnalyticsCharts.css";

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, Tooltip, Legend, Filler);

const chartText = "#9fb3c8";
const chartGrid = "rgba(148, 163, 184, 0.18)";

function sharedChartOptions(title?: string): ChartOptions<"line" | "bar" | "scatter"> {
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: {
      mode: "nearest",
      intersect: false,
    },
    plugins: {
      legend: {
        display: true,
        labels: {
          color: chartText,
          boxWidth: 10,
          usePointStyle: true,
        },
      },
      tooltip: {
        enabled: true,
        backgroundColor: "rgba(7, 20, 38, 0.96)",
        titleColor: "#b7faff",
        bodyColor: "#f7fbff",
        borderColor: "rgba(126, 243, 255, 0.5)",
        borderWidth: 1,
        padding: 10,
        displayColors: true,
      },
      title: {
        display: Boolean(title),
        text: title,
        color: chartText,
      },
    },
    scales: {
      x: {
        grid: { display: false },
        ticks: { color: chartText },
        border: { display: false },
      },
      y: {
        grid: { color: chartGrid },
        ticks: { color: chartText },
        border: { display: false },
      },
    },
  };
}

export function AnalyticsMetricCards({ metrics }: Readonly<{ metrics: TradingMetric[] }>) {
  return (
    <section className="analytics-metric-grid">
      {metrics.map((metric) => (
        <article key={metric.label} className={`analytics-metric-card ${metric.tone ?? "neutral"}`}>
          <span>{metric.label}</span>
          <strong>{metric.value}</strong>
        </article>
      ))}
    </section>
  );
}

export function AnalyticsChartCard({
  title,
  eyebrow,
  children,
  actions,
  wide = false,
}: Readonly<{
  title: string;
  eyebrow: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
  wide?: boolean;
}>) {
  return (
    <article className={`analytics-chart-card ${wide ? "wide" : ""}`}>
      <div className="analytics-chart-header">
        <div>
          <p>{eyebrow}</p>
          <h2>{title}</h2>
        </div>
        {actions}
      </div>
      <div className="analytics-chart-body">{children}</div>
    </article>
  );
}

export function BenchmarkComparisonChart({ points }: Readonly<{ points: TimeSeriesPoint[] }>) {
  const data: ChartData<"line"> = {
    labels: points.map((point) => point.label),
    datasets: [
      {
        label: "Portfolio",
        data: points.map((point) => point.portfolio),
        borderColor: "#20d89b",
        backgroundColor: "rgba(32, 216, 155, 0.14)",
        borderWidth: 3,
        pointRadius: 4,
        pointHoverRadius: 7,
        fill: true,
        tension: 0.35,
      },
      {
        label: "NIFTY 50",
        data: points.map((point) => point.benchmark ?? 0),
        borderColor: "#5996eb",
        backgroundColor: "rgba(89, 150, 235, 0.1)",
        borderWidth: 3,
        pointRadius: 4,
        pointHoverRadius: 7,
        fill: false,
        tension: 0.35,
      },
    ],
  };

  return <Line data={data} options={sharedChartOptions("Normalized to 100") as ChartOptions<"line">} />;
}

export function PortfolioPnlChart({ points }: Readonly<{ points: TimeSeriesPoint[] }>) {
  const data: ChartData<"line"> = {
    labels: points.map((point) => point.label),
    datasets: [
      {
        label: "Portfolio value index",
        data: points.map((point) => point.portfolio),
        borderColor: "#24c6dc",
        backgroundColor: "rgba(36, 198, 220, 0.12)",
        borderWidth: 3,
        pointHoverRadius: 7,
        yAxisID: "y",
        fill: true,
        tension: 0.34,
      },
      {
        label: "P&L",
        data: points.map((point) => point.pnl ?? 0),
        borderColor: "#f5b942",
        backgroundColor: "rgba(245, 185, 66, 0.12)",
        borderWidth: 2,
        pointHoverRadius: 7,
        yAxisID: "y1",
        fill: false,
        tension: 0.34,
      },
    ],
  };

  return (
    <Line
      data={data}
      options={{
        ...(sharedChartOptions() as ChartOptions<"line">),
        scales: {
          y: { grid: { color: chartGrid }, ticks: { color: chartText }, border: { display: false } },
          y1: {
            position: "right",
            grid: { drawOnChartArea: false },
            ticks: { color: chartText },
            border: { display: false },
          },
          x: { grid: { display: false }, ticks: { color: chartText }, border: { display: false } },
        },
      }}
    />
  );
}

export function AllocationChart({ points }: Readonly<{ points: AllocationPoint[] }>) {
  return (
    <AllocationDoughnutChart
      sectors={points.map((point) => ({
        name: point.label,
        value: point.value,
        color: point.color,
      }))}
    />
  );
}

export function HorizontalBarChart({
  points,
  valueSuffix = "%",
  showTotal = false,
}: Readonly<{
  points: AllocationPoint[];
  valueSuffix?: string;
  showTotal?: boolean;
}>) {
  const total = points.reduce((sum, point) => sum + point.value, 0);
  const data: ChartData<"bar"> = {
    labels: points.map((point) => point.label),
    datasets: [
      {
        label: showTotal ? `Total ${total.toLocaleString("en-IN")}${valueSuffix}` : "Value",
        data: points.map((point) => point.value),
        backgroundColor: points.map((point) => point.color),
        borderRadius: 8,
      },
    ],
  };

  return (
    <Bar
      data={data}
      options={{
        ...(sharedChartOptions() as ChartOptions<"bar">),
        indexAxis: "y",
        plugins: {
          ...(sharedChartOptions() as ChartOptions<"bar">).plugins,
          legend: { display: false },
          tooltip: {
            ...(sharedChartOptions() as ChartOptions<"bar">).plugins?.tooltip,
            callbacks: {
              label: (context) => ` ${Number(context.parsed.x).toLocaleString("en-IN")}${valueSuffix}`,
            },
          },
        },
      }}
    />
  );
}

export function DrawdownVolatilityChart({ points }: Readonly<{ points: TimeSeriesPoint[] }>) {
  const data: ChartData<"line"> = {
    labels: points.map((point) => point.label),
    datasets: [
      {
        label: "Drawdown %",
        data: points.map((point) => point.drawdown ?? 0),
        borderColor: "#f56b6b",
        backgroundColor: "rgba(245, 107, 107, 0.12)",
        borderWidth: 3,
        pointHoverRadius: 7,
        fill: true,
        tension: 0.35,
      },
      {
        label: "30D Volatility %",
        data: points.map((point) => point.volatility ?? 0),
        borderColor: "#8b7cff",
        backgroundColor: "rgba(139, 124, 255, 0.1)",
        borderWidth: 3,
        pointHoverRadius: 7,
        fill: false,
        tension: 0.35,
      },
    ],
  };

  return <Line data={data} options={sharedChartOptions() as ChartOptions<"line">} />;
}

export function RiskReturnScatter({ points }: Readonly<{ points: StockRiskPoint[] }>) {
  const data: ChartData<"scatter"> = {
    datasets: [
      {
        label: "Stocks",
        data: points.map((point) => ({ x: point.volatilityPct, y: point.returnPct })),
        pointBackgroundColor: "#24c6dc",
        pointBorderColor: "#f7fbff",
        pointRadius: 6,
        pointHoverRadius: 9,
      },
    ],
  };

  return (
    <Scatter
      data={data}
      options={{
        ...(sharedChartOptions() as ChartOptions<"scatter">),
        plugins: {
          ...(sharedChartOptions() as ChartOptions<"scatter">).plugins,
          tooltip: {
            ...(sharedChartOptions() as ChartOptions<"scatter">).plugins?.tooltip,
            callbacks: {
              label: (context) => {
                const stock = points[context.dataIndex];
                return ` ${stock.ticker}: return ${stock.returnPct}%, volatility ${stock.volatilityPct}%`;
              },
            },
          },
        },
      }}
    />
  );
}

export function TradePnlChart({ tradePnl }: Readonly<{ tradePnl: number[] }>) {
  let runningTotal = 0;
  const cumulative = tradePnl.map((value) => {
    runningTotal += value;
    return runningTotal;
  });

  const data: ChartData<"line"> = {
    labels: tradePnl.map((_, index) => `T${index + 1}`),
    datasets: [
      {
        label: "Cumulative P&L",
        data: cumulative,
        borderColor: "#20d89b",
        backgroundColor: "rgba(32, 216, 155, 0.12)",
        borderWidth: 3,
        pointHoverRadius: 7,
        fill: true,
        tension: 0.28,
      },
    ],
  };

  return <Line data={data} options={sharedChartOptions() as ChartOptions<"line">} />;
}

export function MonthlyReturnsHeatmap({ months }: Readonly<{ months: MonthlyReturn[] }>) {
  return (
    <div className="monthly-heatmap">
      {months.map((month) => (
        <div
          key={month.month}
          className={`heatmap-cell ${month.value >= 0 ? "gain" : "loss"}`}
          style={{ "--heat": Math.min(Math.abs(month.value) / 5, 1) } as React.CSSProperties}
        >
          <span>{month.month}</span>
          <strong>{month.value > 0 ? "+" : ""}{month.value.toFixed(1)}%</strong>
        </div>
      ))}
    </div>
  );
}
