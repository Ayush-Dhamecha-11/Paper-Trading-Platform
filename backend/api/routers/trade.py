"""
Trade API routes.

The browser may still send a legacy `price` field, but execution ignores it.
The backend obtains the execution price itself so clients cannot create a
portfolio using stale or manipulated prices.
"""

import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from api.dependencies.auth import get_current_user
from api.dependencies.portfolio import get_or_create_portfolio
from api.schemas.trade import BatchTradePayload, TradePayload, TradeResult, UpdateCapitalPayload
from api.services.market_data import MarketDataError
from api.services.trade_service import D, OrderRequest, TradeError, calculate_capital_delta, execute_batch
from db.database import get_db
from db.models import CapitalTransaction, Portfolio

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["trade"])


@router.post("/trade/execute", response_model=TradeResult)
def trade_execute(
    payload: TradePayload,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    portfolio = get_or_create_portfolio(db, user["id"])

    try:
        request = OrderRequest(
            symbol=payload.ticker,
            action=payload.action,
            quantity=payload.quantity,
        )
        execute_batch(db, portfolio, [request])
    except MarketDataError as exc:
        db.rollback()
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except TradeError as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return TradeResult(success=True, message="Trade executed successfully")


@router.post("/trade/batch", response_model=TradeResult)
def trade_batch(
    payload: BatchTradePayload,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    portfolio = get_or_create_portfolio(db, user["id"])

    try:
        requests = [
            OrderRequest(
                symbol=order.ticker,
                action=order.action,
                quantity=order.quantity,
            )
            for order in payload.orders
        ]
        execute_batch(db, portfolio, requests)
    except MarketDataError as exc:
        db.rollback()
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except TradeError as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return TradeResult(success=True, message="Trades executed successfully")


@router.patch("/profile/capital")
def update_capital(
    payload: UpdateCapitalPayload,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    """Set the user's spendable cash/capital balance.

    The payload is the TARGET cash balance, not a P&L reset.
      * higher target -> deposit
      * lower target -> withdrawal

    Every change is recorded in CapitalTransaction so historical P&L and
    daily returns can exclude external cash flows. Existing positions are
    never changed by a capital update.
    """
    portfolio = get_or_create_portfolio(db, user["id"])

    locked_portfolio = db.execute(
        select(Portfolio)
        .where(Portfolio.user_id == portfolio.user_id)
        .with_for_update()
    ).scalar_one()
    portfolio = locked_portfolio

    new_capital = D(payload.capital)
    if not new_capital.is_finite() or new_capital < 0:
        raise HTTPException(status_code=400, detail="Capital must be a finite non-negative amount.")

    current_capital = D(portfolio.cash_balance)
    try:
        delta, transaction_type = calculate_capital_delta(
            current_capital,
            new_capital,
        )
    except TradeError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    if delta == 0:
        return {
            "message": "Capital unchanged",
            "capital": float(new_capital),
            "change": 0.0,
            "transactionType": "none",
        }

    # The withdrawal is limited to free cash. Money committed to open long
    # positions and short margin is not part of spendable capital.
    if delta < 0 and abs(delta) > current_capital:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Insufficient free capital for withdrawal: available "
                f"{current_capital:.2f}, requested {abs(delta):.2f}"
            ),
        )

    portfolio.cash_balance = new_capital

    db.add(
        CapitalTransaction(
            user_id=portfolio.user_id,
            amount=delta,
            transaction_type=transaction_type,
            description=(
                "Manual capital deposit"
                if transaction_type == "deposit"
                else "Manual capital withdrawal"
            ),
        )
    )

    db.commit()

    message = {
        "deposit": "Capital deposited successfully",
        "withdrawal": "Capital withdrawn successfully",
    }[transaction_type]

    return {
        "message": message,
        "capital": float(new_capital),
        "change": float(delta),
        "transactionType": transaction_type,
    }

