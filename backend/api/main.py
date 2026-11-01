from fastapi import FastAPI
from api.routers import auth

app = FastAPI(title="Paper Trading Platform")
app.include_router(auth.router)