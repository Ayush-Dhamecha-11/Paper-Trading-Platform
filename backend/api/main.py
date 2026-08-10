from fastapi import FastAPI

app = FastAPI()

@app.get("/")
def root():
    return {"message":"Backend Running"}

@app.get("/health")
def health():
    return {"status":"OK"}