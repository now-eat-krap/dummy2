from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from .influx import write_events, query_top_pages
import uvicorn
import os
from typing import Any, Dict

app = FastAPI()

# ---- CORS 설정 ----
# 브라우저가 다른 origin(포트 80)에서 이 API(8080)로 POST 할 수 있게 허용하는 부분
allow_origin = os.getenv("CORS_ALLOW_ORIGIN", "*")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"] if allow_origin == "*" else [allow_origin],
    allow_credentials=False,   # <- 여기 중요! 쿠키 안 쓰니까 False로
    allow_methods=["*"],       # OPTIONS / POST / GET 등 전부 허용
    allow_headers=["*"],       # Content-Type 등 전부 허용
)

@app.get("/api/health")
async def health():
    return {"ok": True}

@app.post("/api/ingest/events")
async def ingest_events(req: Request):
    # SDK에서 보내는 payload: { events: [...] }
    body: Dict[str, Any] = await req.json()
    events = body.get("events", [])
    write_events(events)  # Influx에 적재
    return {"ok": True, "received": len(events)}

@app.get("/api/query/top-pages")
async def top_pages():
    rows = query_top_pages()
    return {"rows": rows}

if __name__ == "__main__":
    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=False)
