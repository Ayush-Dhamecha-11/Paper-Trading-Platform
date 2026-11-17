"""One-time repair utility for rebuilding portfolio snapshot history."""

import logging
import sys
from datetime import date
from pathlib import Path

from sqlalchemy import select

current_dir = Path(__file__).resolve().parent
parent_dir = current_dir.parent
sys.path.append(str(parent_dir))

from api.services.market_data import today_ist
from api.services.portfolio_accounting import rebuild_all_snapshots
from db.database import SessionLocal
from db.models import PriceHistory

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)


if __name__ == "__main__":
    db = SessionLocal()
    try:
        start = db.execute(select(PriceHistory.day).order_by(PriceHistory.day.asc()).limit(1)).scalar_one_or_none()
        end = today_ist()
        if start is None:
            logger.info("No PriceHistory rows found; nothing to rebuild.")
            raise SystemExit(0)

        written = rebuild_all_snapshots(db, start, end)
        logger.info("Rebuilt/updated %s portfolio snapshot rows from %s through %s", written, start, end)
    finally:
        db.close()
