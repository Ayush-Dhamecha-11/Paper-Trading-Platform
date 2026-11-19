"""
backend/api/routers/simulation.py

Simulation endpoint for live and historical portfolio performance.
Evaluates model target weights using:
1. Theoretical continuous decimal allocation
2. Indian market integer-share allocation (via floor)
3. Quantifies the tracking difference and decimal error loss over time.
"""

from __future__ import annotations

import logging
from datetime import date, datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
import numpy as np

from api.schemas.simulation import (
    ErrorLossSummary,
    PerformanceMetrics,
    SimulationDailyPoint,
    SimulationRequest,
    SimulationResponse,
    SimulationStockDetail,
    SimulationSummary,
)
from api.services.market_data import today_ist
from api.services.simulation_service import execute_simulation, simulate_integer_portfolio
from db.database import get_db

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["simulation"])


@router.get("/simulation", response_model=SimulationResponse)
def get_simulation(
    start_date: Optional[str] = Query(None, description="Start date (YYYY-MM-DD)"),
    end_date: Optional[str] = Query(None, description="End date (YYYY-MM-DD)"),
    initial_capital: float = Query(1_000_000.0, description="Initial investment capital in INR"),
    model_name: Optional[str] = Query("attention_factor_longconv", description="Model name"),
    db: Session = Depends(get_db),
):
    """
    Returns live and historical simulation data for the frontend.
    Computes integer shares (floored for India market), continuous ideal shares,
    and the tracking error loss incurred due to decimal flooring.
    """
    today = today_ist()
    end_d = datetime.strptime(end_date, "%Y-%m-%d").date() if end_date else today
    start_d = (
        datetime.strptime(start_date, "%Y-%m-%d").date()
        if start_date
        else (end_d - timedelta(days=90))
    )

    MIN_START_DATE = date(2013, 1, 1)
    if start_d < MIN_START_DATE:
        raise HTTPException(
            status_code=400,
            detail="start_date cannot be before 2013-01-01 (backend market data begins in 2013).",
        )

    if start_d > end_d:
        raise HTTPException(status_code=400, detail="start_date must be on or before end_date.")

    # Run simulation: uses DB predictions if available, or dynamically evaluates the ML model
    sim_data = execute_simulation(
        db=db,
        start_date=start_d,
        end_date=end_d,
        initial_capital=initial_capital,
        model_name=model_name,
    )

    if sim_data is None:
        # Fallback to empty baseline simulation structure
        sim_data = simulate_integer_portfolio(
            dates=[],
            symbols=[],
            weights=np.empty((0, 0)),
            prices=np.empty((0, 0)),
            initial_capital=initial_capital,
        )

    return SimulationResponse(
        status="success",
        requested_start=str(start_d),
        requested_end=str(end_d),
        initial_capital=initial_capital,
        trading_days=len(sim_data.get("daily", [])),
        summary=SimulationSummary(
            ideal=PerformanceMetrics(**sim_data.get("metrics_ideal", {
                "initial_capital": initial_capital,
                "final_equity": initial_capital,
                "total_return_pct": 0.0,
                "annualized_return_pct": 0.0,
                "annualized_volatility_pct": 0.0,
                "annualized_sharpe": 0.0,
            })),
            floored=PerformanceMetrics(**sim_data.get("metrics_floored", {
                "initial_capital": initial_capital,
                "final_equity": initial_capital,
                "total_return_pct": 0.0,
                "annualized_return_pct": 0.0,
                "annualized_volatility_pct": 0.0,
                "annualized_sharpe": 0.0,
            })),
            error_loss=ErrorLossSummary(
                total_error_loss_amount=sim_data.get("total_error_loss_amount", 0.0),
                total_error_loss_pct=sim_data.get("total_error_loss_pct", 0.0),
                mean_daily_unallocated_cash=sim_data.get("mean_daily_unallocated_cash", 0.0),
                mean_daily_unallocated_cash_pct=sim_data.get("mean_daily_unallocated_cash_pct", 0.0),
            ),
        ),
        daily=[
            SimulationDailyPoint(
                date=p["date"],
                equity_ideal=p["equity_ideal"],
                equity_floored=p["equity_floored"],
                return_ideal=p["return_ideal"],
                return_floored=p["return_floored"],
                error_loss_pnl=p["error_loss_pnl"],
                error_loss_return=p["error_loss_return"],
                cumulative_error_loss=p["cumulative_error_loss"],
                unallocated_cash=p["unallocated_cash"],
                unallocated_cash_pct=p["unallocated_cash_pct"],
                stocks=[SimulationStockDetail(**s) for s in p.get("stocks", [])],
            )
            for p in sim_data.get("daily", [])
        ],
    )


@router.post("/simulation/run", response_model=SimulationResponse)
def post_simulation(
    payload: SimulationRequest,
    db: Session = Depends(get_db),
):
    """POST endpoint to trigger simulation with a JSON request body."""
    return get_simulation(
        start_date=payload.start_date,
        end_date=payload.end_date,
        initial_capital=payload.initial_capital,
        model_name=payload.model_name,
        db=db,
    )
