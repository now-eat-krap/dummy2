// Heatmap API
// - 역할: InfluxDB에서 클릭 좌표를 집계하여 대시보드에 전달
// - 엔드포인트: GET /heatmap?url=...&range=-24h
import express from 'express';
import cors from 'cors';
import { InfluxDB } from '@influxdata/influxdb-client';

const app = express();
const ALLOW_ORIGINS = process.env.ALLOW_ORIGINS || '*';
app.use(cors({ origin: ALLOW_ORIGINS === '*' ? true : ALLOW_ORIGINS.split(',') }));

const { INFLUX_URL, INFLUX_TOKEN, INFLUX_ORG } = process.env;
const influx = new InfluxDB({ url: INFLUX_URL, token: INFLUX_TOKEN });
const queryApi = influx.getQueryApi(INFLUX_ORG);

// GET /heatmap?url=...&range=-24h
app.get('/heatmap', async (req, res) => {
  const url = req.query.url;
  const rng = req.query.range || '-24h';
  if (!url) return res.status(400).json({ ok:false, error:'missing url' });

  const flux = `
  from(bucket: "${process.env.INFLUX_BUCKET}")
    |> range(start: ${rng})
    |> filter(fn: (r) => r._measurement == "events_click" and r.url == "${(url+'').replace(/"/g,'\"')}")
    |> pivot(rowKey:["_time"], columnKey:["_field"], valueColumn:"_value")
    |> keep(columns: ["x","y","vw","vh","_time"])
  `;

  const points = [];
  try {
    await queryApi.collectRows(flux, {
      next(row, tableMeta) {
        const o = tableMeta.toObject(row);
        points.push({ x:o.x, y:o.y, vw:o.vw, vh:o.vh, t:o._time });
      },
      error(err) { throw err; },
      complete() {}
    });
    res.json({ ok:true, points });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok:false, error:String(e) });
  }
});

const port = Number(process.env.PORT || 8081);
app.listen(port, () => console.log('[heatmap-api] listening on', port));
