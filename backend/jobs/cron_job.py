import logging
import sys
from datetime import date
from pathlib import Path

# path of the current directory
current_dir = Path(__file__).resolve().parent

# path of the parent directory
parent_dir = current_dir.parent

# Adding the parent directory to the Python path
sys.path.append(str(parent_dir))

from data.stock_price_fetch_migration import HistDataFetcher
from data.feature_comp_migration import compute_for_date
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)
 
 
def run(target_date: date | None = None) -> None:
    target_date = target_date or date.today()
    logger.info(f"--- Daily CRON job starting for {target_date} ---")

    # Fetch and migrate price data daily
    fetcher = HistDataFetcher()
    fetcher.migrate_daily_data(target_date)
    logger.info(f"[1/1] price fetch complete for {target_date}")
 
    # Compute firm characteristics from new price_history rows
    written, _ = compute_for_date(target_date)
    logger.info(f"[2/2] characteristics computation complete for {target_date} - {written} rows written")
     
    # TODO: run AFM + GNN inference -> write model_predictions
    # TODO: mark portfolios to market -> append portfolio_snapshots
 
    logger.info("--- Daily pipeline finished ---")
 
 
if __name__ == "__main__":
    try:
        run()
    except Exception:
        logger.exception("Daily pipeline failed")
        sys.exit(1)