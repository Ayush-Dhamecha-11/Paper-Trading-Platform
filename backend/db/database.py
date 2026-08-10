from urllib.parse import quote_plus
from sqlalchemy import create_engine, text

# Define Supabase database credentials
PROJECT_REF = "nthyiixbsltmulaqiiuf" 
DB_USER = f"postgres.{PROJECT_REF}"
DB_PASS = "AaVvBb126*_"
DB_HOST = "aws-0-ap-south-1.pooler.supabase.com"
DB_PORT = "6543"
DB_NAME = "postgres"

# URL-encode the password to prevent connection string parsing errors
safe_password = quote_plus(DB_PASS)

# Construct the connection URL using the psycopg2 driver
# Format: postgresql+driver://user:password@host:port/dbname
DATABASE_URL = f"postgresql+psycopg2://{DB_USER}:{safe_password}@{DB_HOST}:{DB_PORT}/{DB_NAME}"

# Initialize the engine
engine = create_engine(DATABASE_URL, pool_pre_ping=True)

# Test the connection
try:
    with engine.connect() as connection:
        result = connection.execute(text("SELECT NOW();"))
        print("Connection successful! Current time:", result.scalar())
except Exception as e:
    print("Connection failed:", e)
