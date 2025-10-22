/**
 * (구버전) 스냅샷 큐 전용 스니펫
 * - 새 프로젝트에선 ba-combined.js 사용을 권장합니다.
 */
(() => {
  const S = document.currentScript;
  const EP = (S && S.dataset.endpoint) || (new URL(S.src)).origin || 'http://localhost:8082';
  const VPs = ((S && S.dataset.viewports) || '1366x900').split(',').map(s=>s.trim()).filter(Boolean);
  const PROBE_ATTR = ((S && S.dataset.probe) || 'off').toLowerCase() === 'on';
  const PROBE_QS   = /\blf=probe\b/.test(location.search);
  const PROBE_LS   = (typeof localStorage!=='undefined' && localStorage.getItem('lf_probe') === '1');
  const PROBE = PROBE_ATTR || PROBE_QS || PROBE_LS;

  const url = location.href.split('#')[0];
  const key = 'lf:snap:queued:' + url;
  if (sessionStorage.getItem(key)) return;
  sessionStorage.setItem(key, '1');

  const pageSize = { w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight };
  let usesIO = false, hasLoadMoreBtn = false, scrollContainer = null;

  try {
    const _IO = window.IntersectionObserver;
    window.IntersectionObserver = function(cb, opts) { usesIO = true; return new _IO(cb, opts); };
    scrollContainer = (() => {
      let best=null, area=0;
      for (const el of document.querySelectorAll('body, body *')) {
        const st = getComputedStyle(el);
        if (/(auto|scroll)/.test(st.overflowY) && el.scrollHeight - el.clientHeight > 48) {
          const a = el.clientWidth * el.clientHeight;
          if (a > area) { best = el; area = a; }
        }
      }
      if (!best) return null;
      if (best.id) return '#'+best.id;
      const cls = (best.className||'').toString().trim().split(/\s+/).slice(0,3).join('.');
      if (cls) return best.tagName.toLowerCase()+'.'+cls;
      return best.tagName.toLowerCase();
    })();
    const txtMatch = (t) => /더보기|더 불러오기|load more|show more|more/i.test(t);
    for (const el of document.querySelectorAll('a,button')) {
      const t = (el.innerText||'').trim();
      const ar = el.getAttribute('aria-label')||'';
      if ((t && txtMatch(t)) || (ar && txtMatch(ar))) { hasLoadMoreBtn = true; break; }
    }
  } catch {}

  const doProbe = async () => {
    if (!PROBE) return { probed:false };
    const before = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);
    for (let i=0;i<3;i++){
      try{
        window.scrollBy(0, Math.floor(window.innerHeight*0.9));
        await new Promise(r=>setTimeout(r, 600));
      }catch{}
    }
    const after = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);
    return { probed:true, heightGrew: (after - before) > 64 };
  };

  const send = (payload) => {
    fetch(EP.replace(/\/+$/,'') + '/queue', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) }).catch(()=>{});
  };

  (async () => {
    const probe = await doProbe();
    const capture = (() => {
      if (probe.probed && probe.heightGrew) return { mode:'scroll', maxSteps: 12, waitMs: 700, scrollContainer };
      if (usesIO || hasLoadMoreBtn)      return { mode:'scroll', maxSteps: 8, waitMs: 700, scrollContainer };
      return { mode:'static' };
    })();
    send({ url, viewports: VPs, pageSize, capture, hints:{ usesIO, hasLoadMoreBtn, scrollContainer } });
  })();
})();
