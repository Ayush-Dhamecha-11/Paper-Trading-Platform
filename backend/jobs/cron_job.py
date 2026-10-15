import logging
import sys
from datetime import date, datetime
from pathlib import Path

current_dir = Path(__file__).resolve().parent
parent_dir = current_dir.parent
sys.path.append(str(parent_dir))

from api.services.market_data import today_ist
from sqlalchemy import select
from api.services.portfolio_accounting import write_daily_snapshots
from api.services.trade_service import mark_to_market_all_shorts
from data.feature_comp_migration import compute_for_date
from ML.models.predict_new import predict_next_day_portfolio
from data.stock_price_fetch_migration import HistDataFetcher
from db.database import SessionLocal
from db.models import PriceHistory

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)


def run(target_date: date | None = None) -> None:
    target_date = target_date or today_ist()
    """
    logger.info("--- Daily CRON job starting for %s ---", target_date)

    fetcher = HistDataFetcher()
    fetched = fetcher.migrate_daily_data(target_date)
    logger.info("[1/5] price fetch complete for %s: %s rows", target_date, fetched)
    
    # Do not create/mark a market day when Yahoo returned no EOD rows (weekend,
    # exchange holiday, or a provider outage).
    db = SessionLocal()
    try:
        has_prices = db.execute(
            select(PriceHistory.symbol)
            .where(PriceHistory.day == target_date)
            .limit(1)
        ).first() is not None

        if has_prices:
            forced = mark_to_market_all_shorts(db, target_date)
            logger.info("[2/5] short mark-to-market complete: %s force-closed", forced)

            snapshots = write_daily_snapshots(db, target_date)
            logger.info("[3/5] portfolio snapshots written: %s", snapshots)
        else:
            logger.info("[2-3/5] no EOD prices for %s; skipping MTM/snapshots", target_date)
    finally:
        db.close()

    #if has_prices:
    written, _ = compute_for_date(target_date)
    logger.info(
        "[4/5] characteristics computation complete for %s - %s rows written",
        target_date,
        written,
        )
    #else:
    #    logger.info("[4/5] no characteristics generated for non-trading day %s", target_date)
    """
    predicted = predict_next_day_portfolio(target_date)
    for key in predicted.keys():
        logger.info("[5/5] next-day portfolio prediction complete for %s - %s config", target_date, key)

    logger.info("--- Daily pipeline finished ---")


if __name__ == "__main__":
    try:
        run(datetime(2026, 10, 13))
    except Exception:
        logger.exception("Daily pipeline failed")
        sys.exit(1)
