// Deploy Hook
// - 역할: GitHub 등에서 배포/푸시 웹훅을 받아 변경된 경로를 URL로 매핑하고 스냅샷 큐에 등록
import express from 'express';
import crypto from 'crypto';
import fetch from 'node-fetch';
import fs from 'fs/promises';

const app = express();
// GitHub의 HMAC 검증을 위해 raw body 필요
app.use('/webhook/github', express.raw({ type: '*/*' }));
app.use(express.json());

const SNAPSHOT_API = process.env.SNAPSHOT_API || 'http://localhost:8082';
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || '';
const ROUTE_MAP_FILE = process.env.ROUTE_MAP_FILE || './route_map.json';

async function loadRoutes() {
  try { return JSON.parse(await fs.readFile(ROUTE_MAP_FILE,'utf8')); }
  catch { return []; }
}

function mapPathToUrls(changedPath, routes) {
  return routes.filter(r => changedPath.startsWith(r.pattern)).map(r => r.url);
}

async function queueUrls(urls) {
  const uniq = [...new Set(urls)];
  for (const url of uniq) {
    await fetch(`${SNAPSHOT_API}/queue`, {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ url, viewports:['1366x900','390x844'] })
    });
  }
}

app.post('/webhook/github', async (req, res) => {
  try {
    if (WEBHOOK_SECRET) {
      const sig = 'sha256=' + crypto.createHmac('sha256', WEBHOOK_SECRET).update(req.body).digest('hex');
      const got = req.headers['x-hub-signature-256'];
      if (sig !== got) return res.status(401).send('invalid signature');
    }
    const payload = JSON.parse(req.body.toString('utf8'));
    const files = new Set();
    for (const c of payload.commits || []) {
      (c.added||[]).forEach(f => files.add(f));
      (c.modified||[]).forEach(f => files.add(f));
      (c.removed||[]).forEach(f => files.add(f));
    }
    let urls = [];
    const routes = await loadRoutes();
    if (files.size === 0) {
      urls = routes.map(r => r.url);
    } else {
      for (const f of files) urls.push(...mapPathToUrls(f, routes));
      if (!urls.length) urls = ['/']; // fallback
    }
    await queueUrls(urls);
    res.json({ ok:true, queued: urls });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok:false, error:String(e) });
  }
});

const port = Number(process.env.PORT || 8084);
app.listen(port, () => console.log('[deploy-hook] listening on', port));
