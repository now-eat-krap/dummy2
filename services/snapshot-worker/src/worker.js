// Snapshot Worker
// - 역할: 큐 디렉토리의 작업을 읽어 Puppeteer로 fullPage WebP를 생성하고, 로컬 캐시에 저장
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import puppeteer from 'puppeteer';

const QUEUE_DIR = process.env.QUEUE_DIR || '/data/queue';
const OUT_DIR   = process.env.OUT_DIR   || '/data/snapshots';
const USER_DATA_DIR = process.env.USER_DATA_DIR || undefined; // Chromium HTTP 캐시 공유
const MAX_CONC  = Number(process.env.MAX_CONC || 2);

await fs.mkdir(QUEUE_DIR, { recursive: true });
await fs.mkdir(OUT_DIR, { recursive: true });

function idOf(url){ return crypto.createHash('sha1').update(url).digest('hex'); }

async function capture(url, viewports, captureCfg) {
  const browser = await puppeteer.launch({
    headless: true,
    userDataDir: USER_DATA_DIR,
    args: ['--no-sandbox','--disable-setuid-sandbox']
  });

  try {
    for (const vp of viewports) {
      const [w,h] = String(vp).split('x').map(Number);
      const page = await browser.newPage();
      await page.setViewport({ width:w, height:h });

      // 3rd-party 과도한 리소스 차단 (대역 절감)
      await page.setRequestInterception(true);
      page.on('request', req => {
        const u = req.url(); const type = req.resourceType();
        if (/google-analytics|gtag|hotjar|segment|doubleclick|facebook|tiktok/i.test(u)) return req.abort();
        if (type === 'media' || type === 'websocket') return req.abort();
        req.continue();
      });

      await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

      // scroll 모드면 간단 스크롤 루프
      if (captureCfg?.mode === 'scroll') {
        const steps = captureCfg.maxSteps || 8;
        const wait  = captureCfg.waitMs || 700;
        const sel   = captureCfg.scrollContainer || null;
        for (let i=0;i<steps;i++) {
          if (sel) {
            await page.evaluate(s => {
              const el = document.querySelector(s);
              if (el) el.scrollBy(0, Math.floor(el.clientHeight*0.9));
              else window.scrollBy(0, Math.floor(window.innerHeight*0.9));
            }, sel);
          } else {
            await page.evaluate(() => window.scrollBy(0, Math.floor(window.innerHeight*0.9)));
          }
          await page.waitForTimeout(wait);
        }
      }

      const id = idOf(url);
      const base = path.join(OUT_DIR, id);
      await fs.mkdir(base, { recursive: true });
      const out = path.join(base, `${w}x${h}.webp`);
      await page.screenshot({ path: out, type: 'webp', fullPage: true });
      await page.close();
      console.log('[snapshot]', url, '->', out);
    }
  } finally {
    await browser.close();
  }
}

async function run() {
  while (true) {
    const files = (await fs.readdir(QUEUE_DIR)).filter(f => f.endsWith('.json'));
    if (!files.length) {
      await new Promise(r => setTimeout(r, 1500));
      continue;
    }
    const batch = files.slice(0, MAX_CONC);
    await Promise.all(batch.map(async f => {
      const p = path.join(QUEUE_DIR, f);
      try {
        const job = JSON.parse(await fs.readFile(p, 'utf8'));
        await capture(job.url, job.viewports || ['1366x900'], job.capture);
      } catch (e) {
        console.error('[worker][error]', f, e);
      } finally {
        try { await fs.unlink(p); } catch {}
      }
    }));
  }
}

run().catch(e => { console.error(e); process.exit(1); });
