from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from .influx import write_events, query_top_pages
import uvicorn
import os
from typing import Any, Dict

app = FastAPI()

# ---- CORS ----
allow_origin = os.getenv("CORS_ALLOW_ORIGIN", "*")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[allow_origin] if allow_origin != "*" else ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/api/health")
async def health():
    return {"ok": True}

@app.post("/api/ingest/events")
async def ingest_events(req: Request):
    body: Dict[str, Any] = await req.json()
    events = body.get("events", [])
    write_events(events)
    return {"ok": True, "received": len(events)}

@app.get("/api/query/top-pages")
async def top_pages():
    rows = query_top_pages()
    return {"rows": rows}

if __name__ == "__main__":
    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=False)
