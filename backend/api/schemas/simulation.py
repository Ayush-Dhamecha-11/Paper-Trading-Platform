from __future__ import annotations

from typing import List, Optional
from pydantic import BaseModel, Field


class SimulationStockDetail(BaseModel):
    symbol: str
    weight: float
    price: float
    shares_ideal: float
    shares_floored: int
    diff_shares: float
    unallocated_cash: float
    pnl_ideal: float
    pnl_floored: float
    error_loss_pnl: float


class SimulationDailyPoint(BaseModel):
    date: str
    equity_ideal: float
    equity_floored: float
    return_ideal: float
    return_floored: float
    error_loss_pnl: float
    error_loss_return: float
    cumulative_error_loss: float
    unallocated_cash: float
    unallocated_cash_pct: float
    stocks: List[SimulationStockDetail] = []


class PerformanceMetrics(BaseModel):
    initial_capital: float
    final_equity: float
    total_return_pct: float
    annualized_return_pct: float
    annualized_volatility_pct: float
    annualized_sharpe: float


class ErrorLossSummary(BaseModel):
    total_error_loss_amount: float = Field(
        ..., description="Cumulative rupee loss due to flooring: ideal_equity - floored_equity"
    )
    total_error_loss_pct: float = Field(
        ..., description="Total error loss as a percentage of initial capital"
    )
    mean_daily_unallocated_cash: float = Field(
        ..., description="Average daily idle cash due to flooring (₹)"
    )
    mean_daily_unallocated_cash_pct: float = Field(
        ..., description="Average daily idle cash as a % of initial capital"
    )


class SimulationSummary(BaseModel):
    ideal: PerformanceMetrics
    floored: PerformanceMetrics
    error_loss: ErrorLossSummary


class SimulationResponse(BaseModel):
    status: str = "success"
    requested_start: str
    requested_end: str
    initial_capital: float
    trading_days: int
    summary: SimulationSummary
    daily: List[SimulationDailyPoint]


class SimulationRequest(BaseModel):
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    initial_capital: float = 1_000_000.0
    symbols: Optional[List[str]] = None
    model_name: Optional[str] = "attention_factor_longconv"

