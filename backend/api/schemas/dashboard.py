from pydantic import BaseModel

# Response schemas
class StockOut(BaseModel):
    ticker: str
    name: str
    sector: str
    price: float
    changePct: float
    open: float
    close: float | None
    volume: int


class HoldingOut(BaseModel):
    ticker: str
    name: str
    price: float
    quantity: float
    profit: float


class SectorAllocationOut(BaseModel):
    name: str
    value: float   # percent of portfolio value
    color: str


class PerformancePointOut(BaseModel):
    label: str
    value: float


class DashboardData(BaseModel):
    totalPortfolioValue: float
    investedCapital: float
    totalProfit: float
    todayPnL: float