// Snapshot Queue API
// - 역할: 브라우저 스니펫이 보낸 { url, viewports, capture }를 큐 파일로 저장
// - 워커는 이 큐를 읽어 Puppeteer로 WebP 스냅샷을 생성
import express from 'express';
import cors from 'cors';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

const app = express();
app.use(express.json({ limit: '256kb' }));
app.use(cors({ origin: true }));

const QUEUE_DIR = process.env.QUEUE_DIR || '/data/queue';
await fs.mkdir(QUEUE_DIR, { recursive: true });

// 정적 스니펫(레거시) 제공
app.use(express.static('public'));

app.post('/queue', async (req, res) => {
  try {
    const { url, viewports = ['1366x900'], pageSize, capture, hints } = req.body || {};
    if (!url) return res.status(400).json({ ok:false, error:'missing url' });
    const id = crypto.createHash('sha1').update(url).digest('hex');
    const file = path.join(QUEUE_DIR, `${id}.json`);
    const payload = { url, viewports, pageSize, capture, hints, ts: Date.now() };
    await fs.writeFile(file, JSON.stringify(payload, null, 2));
    res.json({ ok:true, id });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok:false, error:String(e) });
  }
});

const port = Number(process.env.PORT || 8082);
app.listen(port, () => console.log('[snapshot-api] listening on', port));
