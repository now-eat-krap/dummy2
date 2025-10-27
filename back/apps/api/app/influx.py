import os
from typing import Any, Dict, List, Optional
from influxdb_client import InfluxDBClient, Point
from influxdb_client.client.write_api import SYNCHRONOUS

INFLUX_URL    = os.getenv("INFLUX_URL", "http://localhost:8086")
INFLUX_TOKEN  = os.getenv("INFLUX_TOKEN", "dev-token")
INFLUX_ORG    = os.getenv("INFLUX_ORG", "apilog")
INFLUX_BUCKET = os.getenv("INFLUX_BUCKET", "apilog_raw")

_client = InfluxDBClient(
    url=INFLUX_URL,
    token=INFLUX_TOKEN,
    org=INFLUX_ORG,
)

_write = _client.write_api(write_options=SYNCHRONOUS)
_query = _client.query_api()


# ---------- safe cast helpers (null 방어용) ----------

def _safe_str(v: Any, default: str = "") -> str:
    # None -> default, 나머지는 str()
    if v is None:
        return default
    return str(v)

def _safe_int(v: Any, default: Optional[int] = None) -> Optional[int]:
    # None -> default
    if v is None:
        return default
    try:
        # "123", 123.0 이런 것도 다 int로 바꿔줌
        return int(float(v))
    except (TypeError, ValueError):
        return default

def _safe_float(v: Any, default: Optional[float] = None) -> Optional[float]:
    # None -> default
    if v is None:
        return default
    try:
        return float(v)
    except (TypeError, ValueError):
        return default

def _safe_bool(v: Any, default: Optional[bool] = None) -> Optional[bool]:
    # None -> default
    if v is None:
        return default
    if isinstance(v, bool):
        return v
    if isinstance(v, (int, float)):
        return bool(v)
    if isinstance(v, str):
        lower = v.lower()
        if lower in ("true", "1", "yes", "y"):
            return True
        if lower in ("false", "0", "no", "n"):
            return False
    return default


def write_events(events: List[Dict[str, Any]]) -> None:
    """
    클라이언트가 보낸 이벤트 리스트를 InfluxDB measurement "events"로 적재.
    주요 매핑:
      - tags:
          site_id, path, page_variant, event_name, element_hash,
          device_type, browser_family, country_code,
          utm_source, utm_campaign
      - fields:
          count, session_id, user_hash,
          dwell_ms, scroll_pct, click_x, click_y,
          viewport_w, viewport_h,
          funnel_step, error_flag, bot_score, extra_json
      - time:
          ev["ts"] (ms 단위 epoch)
    """

    points: List[Point] = []

    for ev in events:
        # 클라이언트에서 보내는 타임스탬프는 ms 단위(Date.now()) => 그대로 ms precision으로 쓸 거라 그냥 저장
        ts_ms = _safe_int(ev.get("ts"))
        # 없으면 None인데 그 경우엔 Influx가 서버시간(now) 넣게 둘 수도 있음

        p = (
            Point("events")

            # ---------- TAGS (low-cardinality dimensions / 인덱스 값) ----------
            .tag("site_id",        _safe_str(ev.get("site_id")))
            .tag("path",           _safe_str(ev.get("path")))
            .tag("page_variant",   _safe_str(ev.get("page_variant")))    # <- 추가
            .tag("event_name",     _safe_str(ev.get("event_name")))
            .tag("element_hash",   _safe_str(ev.get("element_hash")))    # <- 추가
            .tag("device_type",    _safe_str(ev.get("device_type")))
            .tag("browser_family", _safe_str(ev.get("browser_family")))
            .tag("country_code",   _safe_str(ev.get("country_code")))
            .tag("utm_source",     _safe_str(ev.get("utm_source")))
            .tag("utm_campaign",   _safe_str(ev.get("utm_campaign")))

            # ---------- FIELDS (metrics / high-cardinality stuff) ----------
            .field("count",        _safe_int(ev.get("count"), 1) or 1)
            .field("session_id",   _safe_str(ev.get("session_id")))
            .field("user_hash",    _safe_str(ev.get("user_hash")))

            .field("dwell_ms",     _safe_int(ev.get("dwell_ms"), 0) or 0)
            .field("scroll_pct",   _safe_float(ev.get("scroll_pct"), 0.0) or 0.0)

            .field("click_x",      _safe_int(ev.get("click_x"), 0) or 0)
            .field("click_y",      _safe_int(ev.get("click_y"), 0) or 0)

            .field("viewport_w",   _safe_int(ev.get("viewport_w"), 0) or 0)
            .field("viewport_h",   _safe_int(ev.get("viewport_h"), 0) or 0)

            .field("funnel_step",  _safe_str(ev.get("funnel_step")))
            .field("error_flag",   _safe_bool(ev.get("error_flag"), False) or False)

            .field("bot_score",    _safe_float(ev.get("bot_score"), 0.0) or 0.0)
            .field("extra_json",   _safe_str(ev.get("extra_json")))
        )

        # 타임스탬프 반영 (ms precision으로 기록)
        if ts_ms is not None:
            p = p.time(ts_ms, write_precision="ms")

        points.append(p)

    if points:
        _write.write(
            bucket=INFLUX_BUCKET,
            org=INFLUX_ORG,
            record=points,
            write_precision="ms",  # 위에서 ms로 넣었으니까 여기서도 ms
        )


def query_top_pages():
    """
    최근 1시간 기준으로,
    event_name == "page_view" 인 이벤트들의 count 합계를 path별로 집계한 Top 10.
    """
    flux = f'''
from(bucket: "{INFLUX_BUCKET}")
  |> range(start: -1h)
  |> filter(fn: (r) => r._measurement == "events")
  |> filter(fn: (r) => r.event_name == "page_view")
  |> filter(fn: (r) => r._field == "count")
  |> group(columns: ["path"])
  |> sum()
  |> sort(columns: ["_value"], desc: true)
  |> limit(n: 10)
'''
    tables = _query.query(flux)
    rows = []
    for table in tables:
        for record in table.records:
            rows.append({
                "path": record["path"],
                "cnt": record["_value"],
            })
    return rows
