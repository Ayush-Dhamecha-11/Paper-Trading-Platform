from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from api.routers import analytics, auth, dashboard, portfolio, profile, strategy, trade
from jobs.auto_trade_cron import start_auto_trade_scheduler, stop_auto_trade_scheduler


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: Start background scheduler which automatically executes catch-up trades
    # on restart/wakeup during market hours, and continues periodic market checks.
    start_auto_trade_scheduler(check_interval_seconds=360)
    yield
    # Shutdown
    stop_auto_trade_scheduler()


app = FastAPI(title="Paper Trading Platform", lifespan=lifespan)

# CORS settings
origins = [
    "http://localhost:5173",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(profile.router)
app.include_router(dashboard.router)
app.include_router(analytics.router)
app.include_router(portfolio.router)
app.include_router(trade.router)
app.include_router(strategy.router)
