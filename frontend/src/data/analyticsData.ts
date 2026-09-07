export type AnalyticsRangeKey = "1W" | "1M" | "3M" | "6M" | "1Y" | "ALL";

export type TimeSeriesPoint = {
  label: string;
  portfolio: number;
  benchmark?: number;
  pnl?: number;
  alpha?: number;
  drawdown?: number;
  volatility?: number;
};

export type AllocationPoint = {
  label: string;
  value: number;
  color: string;
};

export type StockRiskPoint = {
  ticker: string;
  returnPct: number;
  volatilityPct: number;
};

export type TradingMetric = {
  label: string;
  value: string;
  tone?: "good" | "bad" | "neutral";
};

export type MonthlyReturn = {
  month: string;
  value: number;
};

export type AnalyticsData = {
  summary: TradingMetric[];
  tradingMetrics: TradingMetric[];
  performanceSeries: Record<AnalyticsRangeKey, TimeSeriesPoint[]>;
  sectorAllocation: AllocationPoint[];
  stockAllocation: AllocationPoint[];
  pnlByStock: AllocationPoint[];
  returnDistribution: AllocationPoint[];
  riskByStock: StockRiskPoint[];
  tradePnl: number[];
  monthlyReturns: MonthlyReturn[];
};

export const ANALYTICS_RANGE_KEYS: AnalyticsRangeKey[] = ["1W", "1M", "3M", "6M", "1Y", "ALL"];

const ANALYTICS_HOLDINGS = [
  {
    ticker: "RELIANCE",
    sector: "Energy",
    weightPct: 18,
    pnl: 5120,
    color: "#20d89b",
    returnPct: 18,
    volatilityPct: 22,
  },
  {
    ticker: "HDFCBANK",
    sector: "Banking",
    weightPct: 12,
    pnl: 3820,
    color: "#5996eb",
    returnPct: 12,
    volatilityPct: 16,
  },
  {
    ticker: "ICICIBANK",
    sector: "Banking",
    weightPct: 10,
    pnl: 1850,
    color: "#f5b942",
    returnPct: 13,
    volatilityPct: 18,
  },
  {
    ticker: "SBIN",
    sector: "Banking",
    weightPct: 8,
    pnl: -980,
    color: "#f56b6b",
    returnPct: 8,
    volatilityPct: 27,
  },
  {
    ticker: "TCS",
    sector: "IT",
    weightPct: 17,
    pnl: 6420,
    color: "#24c6dc",
    returnPct: 15,
    volatilityPct: 14,
  },
  {
    ticker: "INFY",
    sector: "IT",
    weightPct: 7,
    pnl: 2840,
    color: "#8b7cff",
    returnPct: 11,
    volatilityPct: 20,
  },
  {
    ticker: "ITC",
    sector: "FMCG",
    weightPct: 8,
    pnl: 1240,
    color: "#d9a441",
    returnPct: 9,
    volatilityPct: 13,
  },
  {
    ticker: "HINDUNILVR",
    sector: "FMCG",
    weightPct: 6,
    pnl: 760,
    color: "#f5b942",
    returnPct: 7,
    volatilityPct: 11,
  },
  {
    ticker: "SUNPHARMA",
    sector: "Pharma",
    weightPct: 8,
    pnl: 1680,
    color: "#c86be8",
    returnPct: 10,
    volatilityPct: 15,
  },
  {
    ticker: "CIPLA",
    sector: "Pharma",
    weightPct: 6,
    pnl: 620,
    color: "#f56b6b",
    returnPct: 6,
    volatilityPct: 12,
  },
];

const SECTOR_COLORS: Record<string, string> = {
  Banking: "#5996eb",
  IT: "#24c6dc",
  Energy: "#20d89b",
  FMCG: "#f5b942",
  Pharma: "#f56b6b",
};

const SECTOR_ORDER = ["Banking", "IT", "Energy", "FMCG", "Pharma"];

const sectorAllocation = SECTOR_ORDER.map((sector) => ({
  label: sector,
  value: ANALYTICS_HOLDINGS.filter((holding) => holding.sector === sector).reduce(
    (sum, holding) => sum + holding.weightPct,
    0
  ),
  color: SECTOR_COLORS[sector],
}));

export const DUMMY_ANALYTICS_DATA: AnalyticsData = {
  summary: [
    { label: "Portfolio Value", value: "₹1,29,959", tone: "neutral" },
    { label: "Total Return", value: "+14.0%", tone: "good" },
    { label: "Today's P&L", value: "+₹1,240", tone: "good" },
    { label: "Alpha vs NIFTY 50", value: "+3.6%", tone: "good" },
    { label: "Sharpe Ratio", value: "1.42", tone: "good" },
    { label: "Max Drawdown", value: "-6.8%", tone: "bad" },
  ],
  tradingMetrics: [
    { label: "Win Rate", value: "62%", tone: "good" },
    { label: "Average Win", value: "₹2,840", tone: "good" },
    { label: "Average Loss", value: "-₹1,190", tone: "bad" },
    { label: "Profit Factor", value: "1.84", tone: "good" },
    { label: "Best Trade", value: "₹8,450", tone: "good" },
    { label: "Worst Trade", value: "-₹3,220", tone: "bad" },
  ],
  performanceSeries: {
    "1W": [
      { label: "Mon", portfolio: 100, benchmark: 100, pnl: 0, alpha: 0, drawdown: 0, volatility: 13 },
      { label: "Tue", portfolio: 101.4, benchmark: 100.8, pnl: 740, alpha: 0.6, drawdown: -0.4, volatility: 14 },
      { label: "Wed", portfolio: 102.2, benchmark: 101.1, pnl: 1340, alpha: 1.1, drawdown: -0.2, volatility: 16 },
      { label: "Thu", portfolio: 101.6, benchmark: 100.6, pnl: 970, alpha: 1.0, drawdown: -0.9, volatility: 15 },
      { label: "Fri", portfolio: 103.8, benchmark: 101.8, pnl: 2380, alpha: 2.0, drawdown: 0, volatility: 17 },
    ],
    "1M": [
      { label: "W1", portfolio: 100, benchmark: 100, pnl: 0, alpha: 0, drawdown: 0, volatility: 12 },
      { label: "W2", portfolio: 102.8, benchmark: 101.4, pnl: 2800, alpha: 1.4, drawdown: -1.2, volatility: 15 },
      { label: "W3", portfolio: 101.9, benchmark: 102, pnl: 2100, alpha: -0.1, drawdown: -2.0, volatility: 18 },
      { label: "W4", portfolio: 106.4, benchmark: 103.1, pnl: 6400, alpha: 3.3, drawdown: -0.5, volatility: 16 },
    ],
    "3M": [
      { label: "Jun", portfolio: 100, benchmark: 100, pnl: 0, alpha: 0, drawdown: 0, volatility: 12 },
      { label: "Jul", portfolio: 104, benchmark: 102.1, pnl: 4100, alpha: 1.9, drawdown: -1.3, volatility: 15 },
      { label: "Aug", portfolio: 111.5, benchmark: 106.6, pnl: 11500, alpha: 4.9, drawdown: -2.1, volatility: 17 },
    ],
    "6M": [
      { label: "Mar", portfolio: 100, benchmark: 100, pnl: 0, alpha: 0, drawdown: 0, volatility: 11 },
      { label: "Apr", portfolio: 103, benchmark: 101, pnl: 3100, alpha: 2, drawdown: -1.8, volatility: 14 },
      { label: "May", portfolio: 101, benchmark: 102.8, pnl: 1200, alpha: -1.8, drawdown: -4.2, volatility: 20 },
      { label: "Jun", portfolio: 107, benchmark: 104.4, pnl: 7050, alpha: 2.6, drawdown: -1.5, volatility: 16 },
      { label: "Jul", portfolio: 112, benchmark: 107, pnl: 12100, alpha: 5, drawdown: -0.8, volatility: 15 },
      { label: "Aug", portfolio: 114, benchmark: 110.3, pnl: 14000, alpha: 3.7, drawdown: 0, volatility: 18 },
    ],
    "1Y": [
      { label: "Sep", portfolio: 100, benchmark: 100, pnl: 0, alpha: 0, drawdown: 0, volatility: 12 },
      { label: "Oct", portfolio: 98, benchmark: 99.2, pnl: -1900, alpha: -1.2, drawdown: -3.2, volatility: 19 },
      { label: "Nov", portfolio: 104, benchmark: 102, pnl: 4200, alpha: 2, drawdown: -1.6, volatility: 16 },
      { label: "Dec", portfolio: 108, benchmark: 104.6, pnl: 8300, alpha: 3.4, drawdown: -1.1, volatility: 14 },
      { label: "Jan", portfolio: 106, benchmark: 105.4, pnl: 6500, alpha: 0.6, drawdown: -3.7, volatility: 18 },
      { label: "Feb", portfolio: 111, benchmark: 108.2, pnl: 11200, alpha: 2.8, drawdown: -1.8, volatility: 17 },
      { label: "Mar", portfolio: 116, benchmark: 111.5, pnl: 15955, alpha: 4.5, drawdown: -0.7, volatility: 15 },
    ],
    ALL: [
      { label: "Start", portfolio: 100, benchmark: 100, pnl: 0, alpha: 0, drawdown: 0, volatility: 10 },
      { label: "Q1", portfolio: 107, benchmark: 104, pnl: 7200, alpha: 3, drawdown: -2.8, volatility: 16 },
      { label: "Q2", portfolio: 112, benchmark: 108, pnl: 12100, alpha: 4, drawdown: -4.4, volatility: 18 },
      { label: "Q3", portfolio: 119, benchmark: 113, pnl: 18900, alpha: 6, drawdown: -2.1, volatility: 15 },
      { label: "Now", portfolio: 123, benchmark: 116, pnl: 23200, alpha: 7, drawdown: -1.2, volatility: 14 },
    ],
  },
  sectorAllocation,
  stockAllocation: ANALYTICS_HOLDINGS.map((holding) => ({
    label: holding.ticker,
    value: holding.weightPct,
    color: holding.color,
  })),
  pnlByStock: ANALYTICS_HOLDINGS.map((holding) => ({
    label: holding.ticker,
    value: holding.pnl,
    color: holding.pnl >= 0 ? "#20d89b" : "#f56b6b",
  })),
  returnDistribution: [
    { label: "-3%", value: 2, color: "#f56b6b" },
    { label: "-2%", value: 5, color: "#f56b6b" },
    { label: "-1%", value: 12, color: "#f5b942" },
    { label: "0%", value: 20, color: "#24c6dc" },
    { label: "+1%", value: 18, color: "#20d89b" },
    { label: "+2%", value: 9, color: "#20d89b" },
    { label: "+3%", value: 4, color: "#20d89b" },
  ],
  riskByStock: ANALYTICS_HOLDINGS.map((holding) => ({
    ticker: holding.ticker,
    returnPct: holding.returnPct,
    volatilityPct: holding.volatilityPct,
  })),
  tradePnl: [1200, -650, 2200, 950, -1180, 3400, 1800, -420, 2800, 4100, -1320, 2400],
  monthlyReturns: [
    { month: "Jan", value: 2.4 },
    { month: "Feb", value: -1.2 },
    { month: "Mar", value: 3.1 },
    { month: "Apr", value: 1.8 },
    { month: "May", value: -2.6 },
    { month: "Jun", value: 4.2 },
    { month: "Jul", value: 2.9 },
    { month: "Aug", value: 3.6 },
    { month: "Sep", value: -0.4 },
    { month: "Oct", value: 1.2 },
    { month: "Nov", value: 2.1 },
    { month: "Dec", value: 3.8 },
  ],
};
