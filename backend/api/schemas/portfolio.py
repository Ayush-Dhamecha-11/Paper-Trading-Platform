from pydantic import BaseModel

# Response schemas - mirror portfolio.tsx's PortfolioData exactly
class PortfolioSummaryOut(BaseModel):
    portfolioValue: float
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


class PortfolioData(BaseModel):
    summary: PortfolioSummaryOut
    performanceSeries: list[TimeSeriesPointOut]
    sectorAllocation: list[AllocationPointOut]
    holdings: list[PortfolioHoldingOut]