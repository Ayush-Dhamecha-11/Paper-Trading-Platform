"""
backend/api/routers/trade.py
    POST /api/trade/execute        - single order  (executeTrade)
    POST /api/trade/batch          - basket of orders (executeBatchTrade)
    PATCH /api/profile/capital     - set cash_balance directly (TradeModal's "Edit Capital")

All the actual execution logic lives in api/services/trade_service.py -
this file only validates the request shape, loads the portfolio, calls
the service, and translates TradeError into an HTTP error response.

"""

import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from api.dependencies.auth import get_current_user
from api.dependencies.portfolio import get_or_create_portfolio
from api.services.trade_service import OrderRequest, TradeError, execute_batch
from api.schemas.trade import TradePayload, BatchTradePayload, TradeResult, UpdateCapitalPayload
from db.database import get_db

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["trade"])


# POST /api/trade/execute - single order
@router.post("/trade/execute", response_model=TradeResult)
def trade_execute(
    payload: TradePayload,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    
    portfolio = get_or_create_portfolio(db, user["id"])

    try:
        request = OrderRequest(symbol=payload.ticker, action=payload.action, quantity=payload.quantity, price=payload.price)
        result = execute_batch(db, portfolio, [request])

    except TradeError as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))

    return TradeResult(success=result.success, message=result.message)



# POST /api/trade/batch - basket of orders, all-or-nothing
@router.post("/trade/batch", response_model=TradeResult)
def trade_batch(
    payload: BatchTradePayload,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    
    portfolio = get_or_create_portfolio(db, user["id"])

    try:
        requests = [
            OrderRequest(symbol=o.ticker, action=o.action, quantity=o.quantity, price=o.price)
            for o in payload.orders
        ]
        result = execute_batch(db, portfolio, requests)

    except TradeError as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))

    return TradeResult(success=result.success, message=result.message)


# PATCH /api/profile/capital - TradeModal's "Edit Capital" control
@router.patch("/profile/capital")
def update_capital(
    payload: UpdateCapitalPayload,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):

    portfolio = get_or_create_portfolio(db, user["id"])
    portfolio.cash_balance = payload.capital
    db.commit()

    return {"message": "Capital updated", "capital": float(portfolio.cash_balance)}