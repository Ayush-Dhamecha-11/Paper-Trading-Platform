from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from api.routers import auth, dashboard, analytics, profile

app = FastAPI(title="Paper Trading Platform")

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