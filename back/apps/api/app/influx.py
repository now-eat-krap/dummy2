import os
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

def _ns(ts_ms: int) -> int:
    # convert ms to ns for Influx timestamps
    return ts_ms * 1_000_000

def write_events(events: list[dict]):
    points = []
    for ev in events:
        site_id        = ev.get("site_id", "")
        path           = ev.get("path", "")
        event_name     = ev.get("event_name", "")
        device_type    = ev.get("device_type", "")
        browser_family = ev.get("browser_family", "")
        country_code   = ev.get("country_code", "")
        utm_source     = ev.get("utm_source", "")
        utm_campaign   = ev.get("utm_campaign", "")

        p = (
            Point("events")
            .tag("site_id", site_id)
            .tag("path", path)
            .tag("event_name", event_name)
            .tag("device_type", device_type)
            .tag("browser_family", browser_family)
            .tag("country_code", country_code)
            .tag("utm_source", utm_source)
            .tag("utm_campaign", utm_campaign)
            .field("count", int(ev.get("count", 1)))
            .field("session_id", ev.get("session_id", ""))
            .field("user_hash", ev.get("user_hash", ""))
            .field("scroll_pct", float(ev["scroll_pct"]) if ev.get("scroll_pct") is not None else 0.0)
            .field("click_x", int(ev["click_x"]) if ev.get("click_x") is not None else 0)
            .field("click_y", int(ev["click_y"]) if ev.get("click_y") is not None else 0)
            .field("funnel_step", ev.get("funnel_step", ""))
            .field("error_flag", bool(ev.get("error_flag", False)))
            .field("bot_score", float(ev.get("bot_score", 0.0)))
            .field("extra_json", ev.get("extra_json", ""))
            .time(_ns(int(ev.get("timestamp", 0))))
        )
        points.append(p)

    if points:
        _write.write(bucket=INFLUX_BUCKET, org=INFLUX_ORG, record=points)

def query_top_pages():
    # last 1h, only page_view, sum(count) group by path, top 10
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
