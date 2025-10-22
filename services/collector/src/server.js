// Collector Service
// - 역할: 브라우저 스니펫(ba.js/ba-combined.js)에서 전송하는 이벤트를 수신하여 InfluxDB에 적재
// - 엔드포인트: POST /ba
import express from 'express';
import cors from 'cors';
import { InfluxDB, Point } from '@influxdata/influxdb-client';

const app = express();
app.use(express.json({ limit:'256kb' }));

const ALLOW_ORIGINS = process.env.ALLOW_ORIGINS || '*';
app.use(cors({ origin: ALLOW_ORIGINS === '*' ? true : ALLOW_ORIGINS.split(',') }));

const INFLUX_URL = process.env.INFLUX_URL;
const INFLUX_TOKEN = process.env.INFLUX_TOKEN;
const INFLUX_ORG = process.env.INFLUX_ORG;
const INFLUX_BUCKET = process.env.INFLUX_BUCKET;

const influx = new InfluxDB({ url: INFLUX_URL, token: INFLUX_TOKEN });
const writeApi = influx.getWriteApi(INFLUX_ORG, INFLUX_BUCKET, 'ns');

// 스니펫 정적 파일 서빙(ba.js, ba-combined.js)
app.use(express.static('public'));

app.post('/ba', async (req, res) => {
  try {
    const e = req.body || {};
    const site = e.site || 'default';
    const url = e.url || (req.get('referer') || '').split('#')[0];

    if (e.type === 'click') {
      const p = new Point('events_click')
        .tag('site', site).tag('url', url)
        .intField('x', e.x || 0).intField('y', e.y || 0)
        .intField('vw', e.vp?.w || 0).intField('vh', e.vp?.h || 0);
      writeApi.writePoint(p);
    } else if (e.type === 'scroll') {
      const p = new Point('events_scroll')
        .tag('site', site).tag('url', url)
        .intField('y', e.y || 0).intField('max', e.max || 0)
        .intField('vw', e.vp?.w || 0).intField('vh', e.vp?.h || 0);
      writeApi.writePoint(p);
    } else if (e.type === 'route') {
      const p = new Point('events_route').tag('site', site).tag('url', url).intField('v', 1);
      writeApi.writePoint(p);
    }
    res.json({ ok:true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok:false, error:String(e) });
  }
});

const port = Number(process.env.PORT || 8080);
app.listen(port, () => console.log('[collector] listening on', port));
