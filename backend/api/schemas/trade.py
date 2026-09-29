from pydantic import BaseModel, Field


class TradePayload(BaseModel):
    ticker: str
    action: str
    quantity: float = Field(gt=0)
    # Legacy frontend field. The backend intentionally ignores it for
    # execution and obtains the market price server-side.
    price: float | None = None


class BatchTradePayload(BaseModel):
    orders: list[TradePayload]


class TradeResult(BaseModel):
    success: bool
    message: str
    tradeId: str | None = None


class UpdateCapitalPayload(BaseModel):
    # Target free-cash/capital balance after the operation.
    # Higher than the current balance = deposit; lower = withdrawal.
    capital: float = Field(ge=0)
