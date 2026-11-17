"""
Shared helper for routes that need "the current user's portfolio."
Auto-creates an empty portfolio on first access, so
the frontend never has to special-case "user has no portfolio yet" -
a brand-new user just sees zeros until they place their first trade.
"""

import os
from datetime import datetime, timezone
from sqlalchemy import select
from sqlalchemy.orm import Session
from db.models import CapitalTransaction, Portfolio

# Starting paper-trading cash balance for a newly created portfolio.
DEFAULT_INITIAL_CAPITAL = float(os.getenv("DEFAULT_INITIAL_CAPITAL", "100000"))


def get_or_create_portfolio(db: Session, user_id) -> Portfolio:
    portfolio = db.execute(
        select(Portfolio).where(Portfolio.user_id == user_id)
    ).scalar_one_or_none()

    if portfolio is not None:
        return portfolio

    portfolio = Portfolio(
        user_id=user_id,    
        initial_capital=DEFAULT_INITIAL_CAPITAL,
        cash_balance=DEFAULT_INITIAL_CAPITAL,
        # Portfolio value is holdings value only; a new account has no holdings.
        portfolio_value=0,
        created_at=datetime.now(timezone.utc),
    )
    db.add(portfolio)
    db.flush()

    # Record the free cash grant as an external capital contribution.
    db.add(
        CapitalTransaction(
            user_id=user_id,
            amount=DEFAULT_INITIAL_CAPITAL,
            transaction_type="deposit",
            created_at=portfolio.created_at,
            description="Initial paper-trading capital",
        )
    )
    db.commit()
    db.refresh(portfolio)
    return portfolio