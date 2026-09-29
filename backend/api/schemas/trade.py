from pydantic import BaseModel, Field

class TradePayload(BaseModel):
    ticker: str
    action: str   # "buy" | "sell"
    quantity: float
    price: float = 0.0   # accepted but NOT used for money math


class BatchTradePayload(BaseModel):
    orders: list[TradePayload]


class TradeResult(BaseModel):
    success: bool
    message: str
    tradeId: str | None = None


class UpdateCapitalPayload(BaseModel):
    capital: float = Field(ge=0)