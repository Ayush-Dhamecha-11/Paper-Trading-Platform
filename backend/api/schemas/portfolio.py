from pydantic import BaseModel


class PortfolioSummaryOut(BaseModel):
    # Value of holdings only. Free cash/capital is separate.
    portfolioValue: float
    capitalBalance: float
    accountEquity: float
    investedCapital: float
    totalProfit: float
    todayPnL: float
    totalReturnPct: float


class TimeSeriesPointOut(BaseModel):
    label: str
    portfolio: float
    benchmark: float | None = None
    pnl: float | None = None


class AllocationPointOut(BaseModel):
    label: str
    value: float
    color: str


class PortfolioHoldingOut(BaseModel):
    ticker: str
    name: str
    sector: str
    quantity: float
    averagePrice: float
    currentPrice: float
    previousClose: float
    # Backend-computed values are returned as well so frontend calculations
    # cannot accidentally use entry price as the current mark.
    unrealizedPnL: float
    dayPnL: float
    marketValue: float


class PortfolioData(BaseModel):
    summary: PortfolioSummaryOut
    performanceSeries: list[TimeSeriesPointOut]
    sectorAllocation: list[AllocationPointOut]
    holdings: list[PortfolioHoldingOut]
