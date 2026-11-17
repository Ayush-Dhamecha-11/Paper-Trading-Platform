from pydantic import BaseModel

# Response schemas - mirror analyticsData.ts exactly
class TradingMetricOut(BaseModel):
    label: str
    value: str
    tone: str | None = None


class TimeSeriesPointOut(BaseModel):
    label: str
    portfolio: float
    benchmark: float | None = None
    pnl: float | None = None
    alpha: float | None = None
    drawdown: float | None = None
    volatility: float | None = None


class AllocationPointOut(BaseModel):
    label: str
    value: float
    color: str


class StockRiskPointOut(BaseModel):
    ticker: str
    returnPct: float
    volatilityPct: float


class MonthlyReturnOut(BaseModel):
    month: str
    value: float


class AnalyticsData(BaseModel):
    summary: list[TradingMetricOut]
    tradingMetrics: list[TradingMetricOut]
    performanceSeries: dict[str, list[TimeSeriesPointOut]]
    sectorAllocation: list[AllocationPointOut]
    stockAllocation: list[AllocationPointOut]
    pnlByStock: list[AllocationPointOut]
    returnDistribution: list[AllocationPointOut]
    riskByStock: list[StockRiskPointOut]
    tradePnl: list[float]
    monthlyReturns: list[MonthlyReturnOut]