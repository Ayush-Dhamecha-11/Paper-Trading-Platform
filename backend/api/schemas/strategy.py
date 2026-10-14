from typing import Literal, Optional
from pydantic import BaseModel


class TradeSuggestionOut(BaseModel):
    id: str
    ticker: str
    name: str
    action: Literal["buy", "sell"]
    quantity: float
    price: float
    status: Literal["pending", "executed"]
    executedAt: Optional[str] = None
