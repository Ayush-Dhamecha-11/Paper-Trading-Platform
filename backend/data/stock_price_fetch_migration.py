import logging
import sys
from pathlib import Path
import io
import pandas as pd
import yfinance as yf
from datetime import datetime, timedelta, date
from typing import Dict, List, Tuple
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert

# path of the current directory
current_dir = Path(__file__).resolve().parent

# path of the parent directory
parent_dir = current_dir.parent

# Adding the parent directory to the Python path
sys.path.append(str(parent_dir))

from db.database import SessionLocal
from db.supabase_client import supabase
from db.models import PriceHistory, UniverseStock

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)


class HistDataFetcher:

    def __init__(self):
        # Upsert in chunks rather than one INSERT per row
        self.CHUNK_SIZE = 1000

    def get_csv_from_supabase(self, bucket_name: str, file_path: str) -> pd.DataFrame:
        try:
            file_bytes = supabase.storage.from_(bucket_name).download(file_path)
            
            data_stream = io.BytesIO(file_bytes)
            df = pd.read_csv(data_stream)
            return df

        except Exception as e:
            print(f"Error fetching CSV: {e}")
            return None

    def fetch_stock_data(self, tickers, start_date=None, end_date=None, interval='1d', allhist = False) -> Tuple[Dict[str, pd.DataFrame], List[Dict]]:
        """
        Fetch daily OHLCV price history + fundamental info for all stocks.

        Returns
            historical_data : dict {symbol -> DataFrame}
        """

        if end_date is None:
            end_date = datetime.now()
        if start_date is None:
            start_date = end_date - timedelta(days=5 * 365)

        logger.info(f"Fetching historical data and company data for stocks from {start_date.date()} to {end_date.date()}")

        historical_data = {}
        metadata = []

        for i, symbol in enumerate(tickers):

            # Historical price data
            try:
                logger.info(f"[{i+1}/{len(tickers)}] Fetching prices and metadata: {symbol}")
                if symbol == "^CNX100":
                    ticker = yf.Ticker(symbol)
                else:
                    ticker = yf.Ticker(f'{symbol}.NS')

                df = ticker.history(start=start_date, end=end_date, interval=interval, auto_adjust=True)

                if df.empty:
                    logger.warning(f"  No price data for {symbol} — skipping")
                    continue

                df.columns = [col.lower() for col in df.columns]
                #print(df.index.name)
                if df.index.name == "index" or df.index.name == "date" or df.index.name == "Date": 
                    df.index.name = "day"

                df.index = pd.to_datetime(df.index).date
                #df.index = df.index.strftime('%Y-%m-%d')
                df["volume"] = df["volume"].astype(int)

                for col in ("open", "high", "low", "close"):
                    df[col] = df[col].astype(float)

                #df = df.ffill()

                if str(df.index[0]) == "2011-12-01" or not allhist:  # CNX100 doesn't have data that far back
                    historical_data[symbol] = df
                    logger.info(f"satisfied --> {symbol}: {len(df)} trading days")

                    info = ticker.info
                    data = {
                        'symbol': symbol,
                        'name': info.get('longName', 'N/A'),
                        'sector': info.get('sector', 'N/A'),
                        'industry': info.get('industry', 'N/A'), 
                    }
                    metadata.append(data)

                else:
                    logger.info(f"not sufficient data --> {symbol}: {len(df)} trading days, start date: {df.index[0]}")

            except Exception as e:
                logger.error(f"  Price fetch failed for {symbol}: {e}")
                continue

        logger.info(f"Successfully fetched prices and company info for {len(historical_data)} stocks")

        return historical_data, metadata

    def fetch_ohlcv(self, db, target_date: date) -> dict | None:
        """
        Fetch one day of OHLCV for via yfinance.
        """

        #tickers = self.get_csv_from_supabase(bucket_name="data-files", file_path="stock_universe.csv")
        tickers = db.execute(select(UniverseStock.symbol)).scalars().all()
        start = target_date
        end = target_date + timedelta(days=1)  # end is exclusive
        info = []

        for symbol in tickers:

            try:
                logger.info(f"Fetching OHLCV for {symbol}")
                if symbol == "^CNX100":
                    ticker = yf.Ticker(symbol)
                else:
                    ticker = yf.Ticker(f"{symbol}.NS")
                hist = ticker.history(start=start, end=end, interval="1d", auto_adjust=True)
            
                if hist.empty:
                    return None
            
                row = hist.iloc[0]

                info.append({
                    "symbol": symbol,
                    "day": target_date,
                    "open": float(row["Open"]),
                    "high": float(row["High"]),
                    "low": float(row["Low"]),
                    "close": float(row["Close"]),
                    "volume": int(row["Volume"]),
                })

            except Exception as e:
                logger.error(f"Failed to fetch OHLCV for {symbol}: {e}")
                continue

        return info

    def upload_stock_universe(self, metadata: List[Dict[str, str]]) -> None:
        """
        Upload the stock universe data to the database.
        """

        db = SessionLocal()
        try:
            logger.info("Uploading stock universe to the database...")
            stmt = pg_insert(UniverseStock).values(metadata)
            stmt = stmt.on_conflict_do_update(
                index_elements=["symbol"],
                set_={
                    "name": stmt.excluded.name,
                    "sector": stmt.excluded.sector,
                    "industry": stmt.excluded.industry,
                },
            )
            db.execute(stmt)
            db.commit()
            logger.info("Stock universe uploaded successfully.")
        except Exception as e:
            db.rollback()
            logger.error(f"Failed to upload stock universe: {e}")
        finally:
            db.close()


    def upsert_chunk(self, db, rows: list[dict]) -> None:
        stmt = pg_insert(PriceHistory).values(rows)
        stmt = stmt.on_conflict_do_update(
            index_elements=["symbol", "day"],
            set_={
                "open": stmt.excluded.open,
                "high": stmt.excluded.high,
                "low": stmt.excluded.low,
                "close": stmt.excluded.close,
                "volume": stmt.excluded.volume,
            },
        )
        db.execute(stmt)


    def migrate_historical_data(self, historical_data: Dict[str, pd.DataFrame]) -> int:
        """Returns the number of rows upserted."""

        db = SessionLocal()
        stocks = db.execute(select(UniverseStock.symbol)).scalars().all()
        to_migrate = {}
        for sym, val in historical_data.items():
            if sym in stocks:
                to_migrate[sym] = val
            else:
                logger.warning(f"Skipping {sym} as it is not in the stock universe.")
        total = 0
        try:
            df = pd.concat(to_migrate.values(), keys=to_migrate.keys(), names=["symbol", "day"]).reset_index()
            df = df.drop(columns=["dividends", "stock splits"], errors="ignore")
            df = df[["symbol", "day", "open", "high", "low", "close", "volume"]]
            records = df.to_dict(orient="records")

            for i in range(0, len(records), self.CHUNK_SIZE):
                chunk = records[i : i + self.CHUNK_SIZE]
                self.upsert_chunk(db, chunk)
                total += len(chunk)
                logger.info(f"Upserted {total}/{len(records)} rows")

            db.commit()
            logger.info(f"Done. {total} rows upserted into price_history.")
            return total

        except Exception:
            db.rollback()
            raise
        finally:
            db.close()


    def migrate_daily_data(self, target_date: date) -> tuple[int, int]:
        """
        Fetch + upsert EOD prices for the whole universe on target_date.
        """
        db = SessionLocal()
        logger.info(f"Fetching EOD prices for all stocks on {target_date}")
        price_data = self.fetch_ohlcv(db, target_date)
        self.upsert_chunk(db, price_data)    
        db.commit()
        logger.info(f"Daily price migration successful for {len(price_data)} symbols on {target_date}")


    def run_and_fetch(self, start_date=None, end_date=None):
            """
            Returns
                historical_data : dict {symbol -> OHLCV DataFrame}
            """
    
            logger.info("-" * 60)
            logger.info("NSE DATA FETCHING AND MIGRATION")
            logger.info("-" * 60)

            stock_universe = self.get_csv_from_supabase(bucket_name="data-files", file_path="stock_universe.csv")
            if stock_universe is None:
                logger.error("Failed to fetch stock universe from Supabase. Exiting.")
                return
            stock_list = stock_universe['Symbol'].tolist()
            stock_list.append('^CNX100')
            historical_data, metadata = self.fetch_stock_data(stock_list, start_date, end_date, allhist=False)
            #self.upload_stock_universe(metadata)
            self.migrate_historical_data(historical_data)
     
            logger.info("-" * 60)
            logger.info("Data fetch and migration completed successfully!")
            logger.info("-" * 60)
     

def main():

    data_fetcher = HistDataFetcher()
    end_date   = datetime(2026, 9, 8)
    start_date = datetime(2026, 8, 27)

    data_fetcher.run_and_fetch(start_date=start_date, end_date=end_date)

if __name__ == "__main__":
    main()