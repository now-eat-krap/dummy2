from fastapi import FastAPI, BackgroundTasks, Request
from fastapi.responses import HTMLResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from pathlib import Path
from typing import List, Optional
import asyncio, time, json, io, os, hashlib
from PIL import Image

DATA_DIR = Path(os.getenv("DATA_DIR", "./data"))
SNAP_DIR = DATA_DIR / "snapshots"
SNAP_DIR.mkdir(parents=True, exist_ok=True)

DEFAULT_VIEWPORTS = ["1366x900"]
CAPTURE_TTL_SEC = int(os.getenv("CAPTURE_TTL_SEC", "43200"))
MAX_TILES = int(os.getenv("MAX_TILES", "50"))

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
app.mount("/snapshots", StaticFiles(directory=str(SNAP_DIR)), name="snapshots")

PUBLIC_DIR = Path(__file__).resolve().parents[1] / "public"
app.mount("/public", StaticFiles(directory=str(PUBLIC_DIR)), name="public")

def sha1(s: str) -> str:
    return hashlib.sha1(s.encode("utf-8")).hexdigest()

class QueueItem(BaseModel):
    url: str
    viewports: List[str] = DEFAULT_VIEWPORTS
    capture: Optional[dict] = None

@app.get("/")
def home():
    return PlainTextResponse("OK: POST /queue , GET /view?url=...&vp=1366x900")

@app.get("/healthz")
def healthz():
    return PlainTextResponse("ok")

@app.post("/queue")
async def queue(job: QueueItem, bg: BackgroundTasks):
    sid = sha1(job.url)
    fresh = True
    for vp in job.viewports:
        single = SNAP_DIR / sid / f"{vp}.webp"
        manifest = SNAP_DIR / sid / vp / "manifest.json"
        if single.exists():
            if time.time() - single.stat().st_mtime > CAPTURE_TTL_SEC: fresh = False
        elif manifest.exists():
            if time.time() - manifest.stat().st_mtime > CAPTURE_TTL_SEC: fresh = False
        else:
            fresh = False
    if not fresh:
        bg.add_task(capture_job, job.model_dump())
    return {"ok": True, "id": sid, "queued": (not fresh)}

@app.get("/view", response_class=HTMLResponse)
async def view(request: Request, url: str, vp: str = "1366x900"):
    sid = sha1(url)
    manifest_path = SNAP_DIR / sid / vp / "manifest.json"
    width = int(vp.split("x")[0])
    if manifest_path.exists():
        man = json.loads(manifest_path.read_text("utf-8"))
        tiles_html = "\n".join(
            f'<img class="tile" src="/snapshots/{sid}/{vp}/{t["file"]}" alt="tile">'
            for t in man.get("tiles", [])
        )
        partial_badge = '<span class="badge">부분 캡처 (∞)</span>'
    else:
        img = f'/snapshots/{sid}/{vp}.webp'
        tiles_html = f'<img class="tile" src="{img}" alt="snapshot">'
        partial_badge = ''
    html = f'''<!doctype html>
<html><head><meta charset="utf-8"><title>Snapshot Viewer</title>
<style>
body{{background:#0b0b0b;color:#eaeaea;font-family:system-ui, -apple-system, Segoe UI, Roboto, sans-serif}}
.wrap{{max-width:1400px;margin:20px auto;padding:0 16px}}
.viewer{{position:relative;width:{width}px;border:1px solid #333;border-radius:10px;background:#111;overflow:hidden}}
.tile{{display:block;width:100%}}
.badge{{display:inline-block;padding:4px 8px;border-radius:999px;border:1px solid #444;background:#181818;color:#bbb;font-size:12px;margin-left:8px}}
input,select,button{{background:#161616;color:#ddd;border:1px solid #333;border-radius:8px;padding:6px 10px}}
header{{display:flex;gap:8px;align-items:center;margin-bottom:12px}}
</style></head>
<body><div class="wrap">
<header>
  <form action="/view" method="get">
    <label>URL</label>
    <input name="url" size="60" value="{url}">
    <label>Viewport</label>
    <select name="vp">
      <option {'selected' if vp=='1366x900' else ''}>1366x900</option>
      <option {'selected' if vp=='390x844' else ''}>390x844</option>
    </select>
    <button type="submit">Load</button>
  </form>
  {partial_badge}
</header>
<div class="viewer">{tiles_html}</div>
</div></body></html>'''
    return HTMLResponse(html)

# -------- Playwright capture --------
async def auto_scroll_smart(page, *, container=None, maxSteps=28, maxTimeMs=45000, waitMs=700, minDeltaPx=80, plateauNeed=2):
    import time as _t
    started = _t.time()
    async def get_height():
        return await page.evaluate("""(sel) => {
          const docH = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
          if (!sel) return docH;
          const el = document.querySelector(sel);
          return el ? el.scrollHeight : docH;
        }""", container)
    lastH = await get_height()
    plateau = 0
    for _ in range(maxSteps):
        await page.evaluate("""(sel) => {
          const by = (vh)=> Math.floor(vh * 0.9);
          if (sel) {
            const el = document.querySelector(sel);
            if (el) el.scrollBy(0, by(el.clientHeight));
            else window.scrollBy(0, by(window.innerHeight));
          } else {
            window.scrollBy(0, by(window.innerHeight));
          }
        }""", container)
        await page.wait_for_timeout(waitMs)
        try:
            await page.wait_for_load_state('networkidle', timeout=5000)
        except:
            pass
        h = await get_height()
        grown = h - lastH
        lastH = h
        plateau = plateau + 1 if grown < minDeltaPx else 0
        if plateau >= plateauNeed or (_t.time() - started) * 1000 > maxTimeMs:
            break
    return lastH

async def capture_infinite(page, out_dir: Path, width: int, height: int, *, container=None, scroll_cfg=None):
    out_dir.mkdir(parents=True, exist_ok=True)
    await page.set_viewport_size({"width": width, "height": height})
    contentH = await auto_scroll_smart(page, **(scroll_cfg or {}), container=container)
    tiles = []
    y = 0
    idx = 0
    while y < contentH and idx < MAX_TILES:
        await page.evaluate("(_y)=>window.scrollTo(0,_y)", y)
        await page.wait_for_timeout(200)
        png = await page.screenshot(full_page=False, type="png", clip={"x":0,"y":0,"width":width,"height":min(height, contentH - y)})
        img = Image.open(io.BytesIO(png))
        buf = io.BytesIO()
        img.save(buf, format="WEBP", quality=90)
        file = f"{idx:03d}.webp"
        (out_dir / file).write_bytes(buf.getbuffer())
        tiles.append({"y": y, "file": file})
        y += min(height, contentH - y)
        idx += 1
    manifest = {
        "partial": True,
        "viewport": f"{width}x{height}",
        "tileHeight": height,
        "tiles": tiles,
        "coveragePx": tiles[-1]["y"] + height if tiles else 0,
    }
    (out_dir / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")

async def capture_static(page, out_file: Path, width: int, height: int):
    out_file.parent.mkdir(parents=True, exist_ok=True)
    await page.set_viewport_size({"width": width, "height": height})
    png = await page.screenshot(full_page=True, type="png")
    img = Image.open(io.BytesIO(png))
    buf = io.BytesIO()
    img.save(buf, format="WEBP", quality=90)
    out_file.write_bytes(buf.getbuffer())

async def run_capture(url: str, viewports: List[str], capture: Optional[dict]):
    from playwright.async_api import async_playwright
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True, args=['--no-sandbox'])
        try:
            for vp in viewports:
                w, h = map(int, vp.lower().split("x"))
                page = await browser.new_page()
                await page.goto(url, wait_until="networkidle", timeout=60000)
                sid = sha1(url)
                if capture and capture.get("mode") == "scroll":
                    out_dir = SNAP_DIR / sid / vp
                    await capture_infinite(
                        page, out_dir, w, h,
                        container=capture.get("scrollContainer"),
                        scroll_cfg={
                            "maxSteps": int(capture.get("maxSteps", 28)),
                            "maxTimeMs": int(capture.get("maxTimeMs", 45000)),
                            "waitMs": int(capture.get("waitMs", 700)),
                            "minDeltaPx": int(capture.get("minDeltaPx", 80)),
                            "plateauNeed": int(capture.get("plateauNeed", 2)),
                        },
                    )
                else:
                    out_file = SNAP_DIR / sid / f"{vp}.webp"
                    await capture_static(page, out_file, w, h)
                await page.close()
        finally:
            await browser.close()

def capture_job(job: dict):
    url = job["url"]; viewports = job.get("viewports") or DEFAULT_VIEWPORTS
    capture = job.get("capture") or {"mode": "scroll", "maxSteps": 20, "waitMs": 700}
    asyncio.run(run_capture(url, viewports, capture))
