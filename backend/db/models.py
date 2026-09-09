"""
SQLAlchemy ORM models
"""

import enum
import uuid
from datetime import date, datetime

from sqlalchemy import (
    ARRAY,
    BigInteger,
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Numeric,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column
from db.base import Base


# Enums
class OrderType(str, enum.Enum):
    BUY = "buy"
    SELL = "sell"


class OrderStatus(str, enum.Enum):
    FILLED = "filled"
    REJECTED = "rejected"


# Alembic
class AlembicVersion(Base):
    __tablename__ = "alembic_version"

    version_num: Mapped[str] = mapped_column(
        String,
        primary_key=True,
        nullable=False,
    )

    def __repr__(self) -> str:
        return f"<AlembicVersion {self.version_num}>"


# Universe Stocks
class UniverseStock(Base):
    """
    universe of investable stocks.
    """

    __tablename__ = "universe_stocks"

    symbol: Mapped[str] = mapped_column(
        String,
        primary_key=True,
        nullable=False,
    )

    name: Mapped[str] = mapped_column(
        String,
        nullable=False,
    )

    sector: Mapped[str | None] = mapped_column(
        String,
        nullable=True,
    )

    industry: Mapped[str | None] = mapped_column(
        String,
        nullable=True,
    )

    def __repr__(self) -> str:
        return f"<UniverseStock {self.symbol}>"


# Price History
class PriceHistory(Base):
    """
    Daily OHLCV price history for stocks in the universe.
    """

    __tablename__ = "price_history"

    symbol: Mapped[str] = mapped_column(
        ForeignKey(
            "universe_stocks.symbol",
            ondelete="CASCADE",
        ),
        primary_key=True,
        nullable=False,
    )

    day: Mapped[date] = mapped_column(
        Date,
        primary_key=True,
        nullable=False,
    )

    open: Mapped[float] = mapped_column(
        Numeric,
        nullable=False,
    )

    high: Mapped[float] = mapped_column(
        Numeric,
        nullable=False,
    )

    low: Mapped[float] = mapped_column(
        Numeric,
        nullable=False,
    )

    close: Mapped[float] = mapped_column(
        Numeric,
        nullable=False,
    )

    volume: Mapped[int] = mapped_column(
        BigInteger,
        nullable=False,
    )

    def __repr__(self) -> str:
        return f"<PriceHistory {self.symbol} {self.day}>"


# Portfolios
class Portfolio(Base):
    """
    One portfolio per user.
    """

    __tablename__ = "portfolios"

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        nullable=False,
    )

    initial_capital: Mapped[float] = mapped_column(
        Numeric,
        nullable=False,
    )

    cash_balance: Mapped[float] = mapped_column(
        Numeric,
        nullable=False,
    )

    portfolio_value: Mapped[float] = mapped_column(
        Numeric,
        nullable=False,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    def __repr__(self) -> str:
        return f"<Portfolio user_id={self.user_id}>"


# User Preferences
class UserPreference(Base):
    """
    User-specific application preferences.
    """

    __tablename__ = "user_preferences"

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        nullable=False,
    )

    theme: Mapped[str] = mapped_column(
        String,
        nullable=False,
    )

    auto_trade: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
    )

    def __repr__(self) -> str:
        return f"<UserPreference user_id={self.user_id}>"


# Model Predictions
class ModelPrediction(Base):
    """
    Model-generated portfolio predictions.
    One row is uniquely identified by:
        (model_name, as_of_date)
    """

    __tablename__ = "model_predictions"

    model_name: Mapped[str] = mapped_column(
        String,
        primary_key=True,
        nullable=False,
    )

    as_of_date: Mapped[date] = mapped_column(
        Date,
        primary_key=True,
        nullable=False,
    )

    k_factors: Mapped[int] = mapped_column(
        nullable=False,
    )

    weight_for_symbols: Mapped[list[float]] = mapped_column(
        ARRAY(Numeric),
        nullable=False,
    )

    def __repr__(self) -> str:
        return (
            f"<ModelPrediction "
            f"{self.model_name} "
            f"{self.as_of_date}>"
        )


# Orders
class Order(Base):
    """
    Trade/order history.
    Primary key: (symbol, timestamp, user_id)
    """

    __tablename__ = "orders"

    symbol: Mapped[str] = mapped_column(
        ForeignKey(
            "universe_stocks.symbol",
        ),
        primary_key=True,
        nullable=False,
    )

    quantity: Mapped[float] = mapped_column(
        Numeric,
        nullable=False,
    )

    price: Mapped[float] = mapped_column(
        Numeric,
        nullable=False,
    )

    order_type: Mapped[str] = mapped_column(
        String,
        nullable=False,
    )

    status: Mapped[str] = mapped_column(
        String,
        nullable=False,
    )

    timestamp: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        primary_key=True,
        nullable=False,
        server_default=func.now(),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        nullable=False,
    )

    def __repr__(self) -> str:
        return (
            f"<Order "
            f"{self.order_type} "
            f"{self.quantity} "
            f"{self.symbol} "
            f"@ {self.price}>"
        )


# Portfolio Snapshots
class PortfolioSnapshot(Base):
    """
    Daily portfolio snapshot.
    Primary key: (day, user_id)
    """

    __tablename__ = "portfolio_snapshots"

    day: Mapped[date] = mapped_column(
        Date,
        primary_key=True,
        nullable=False,
    )

    portfolio_value: Mapped[float] = mapped_column(
        Numeric,
        nullable=False,
    )

    cash_balance: Mapped[float] = mapped_column(
        Numeric,
        nullable=False,
    )

    daily_return: Mapped[float] = mapped_column(
        Numeric,
        nullable=False,
    )

    cumulative_return: Mapped[float] = mapped_column(
        Numeric,
        nullable=False,
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        nullable=False,
    )

    def __repr__(self) -> str:
        return (
            f"<PortfolioSnapshot "
            f"user_id={self.user_id} "
            f"day={self.day}>"
        )


# Positions
class Position(Base):
    """
    Current position held by a user.

    Primary key:
        (symbol, user_id)
    """

    __tablename__ = "positions"

    symbol: Mapped[str] = mapped_column(
        ForeignKey(
            "universe_stocks.symbol",
        ),
        primary_key=True,
        nullable=False,
    )

    quantity: Mapped[float] = mapped_column(
        Numeric,
        nullable=False,
    )

    avg_entry_price: Mapped[float] = mapped_column(
        Numeric,
        nullable=False,
    )

    opened_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        nullable=False,
    )

    def __repr__(self) -> str:
        return (
            f"<Position "
            f"user_id={self.user_id} "
            f"{self.symbol} "
            f"qty={self.quantity}>"
        )

class Characteristics(Base):
    """
    Firm characteristics computed from price_history,
    one row per (symbol, day).
    """

    __tablename__ = "firm_characteristics"

    symbol: Mapped[str] = mapped_column(
        ForeignKey("universe_stocks.symbol"),
        primary_key=True,
        nullable=False,
    )

    day: Mapped[date] = mapped_column(
        Date,
        primary_key=True,
        nullable=False,
        index=True,
    )

    features: Mapped[dict] = mapped_column(
        JSONB,
        nullable=False,
    )

    computed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
    )

    def __repr__(self) -> str:
        return f"<FirmCharacteristics {self.symbol} {self.day}>"