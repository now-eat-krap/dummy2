/**
 * Logflow Combined Snippet (Collector + Snapshot Queue)
 * ----------------------------------------------------
 * 목적: 한 줄 <script>로 이벤트 수집(클릭/스크롤/SPA 라우팅)과
 *       스냅샷 큐 등록(무한스크롤 힌트/옵션)까지 모두 처리합니다.
 *
 * 사용 예:
 * <script src="http://localhost:8080/ba-combined.js"
 *         data-site="logflow"
 *         data-collect="http://localhost:8080/ba"
 *         data-snapshot="http://localhost:8082"
 *         data-click="true" data-scroll="true" data-spa="true"
 *         data-viewports="1366x900,390x844"
 *         data-probe="off" defer></script>
 */
(() => {
  // ---- 설정 ----
  const S = document.currentScript;
  const COLLECT  = (S && (S.dataset.collect || S.dataset.endpoint)) || "http://localhost:8080/ba";
  const SNAPSHOT = (S && (S.dataset.snapshot || S.dataset["endpointSnapshot"])) || "http://localhost:8082";
  const SITE = (S && S.dataset.site) || "logflow";
  const ENABLE_CLICK  = (S && S.dataset.click) === "true";
  const ENABLE_SCROLL = (S && S.dataset.scroll) === "true";
  const ENABLE_SPA    = (S && S.dataset.spa) === "true";
  const VIEWPORTS = ((S && S.dataset.viewports) || "1366x900").split(",").map(s => s.trim()).filter(Boolean);
  const PROBE_ATTR = ((S && S.dataset.probe) || "off").toLowerCase() === "on";
  const PROBE_QS   = /\blf=probe\b/.test(location.search);
  const PROBE_LS   = (typeof localStorage!=="undefined" && localStorage.getItem("lf_probe") === "1");
  const PROBE = PROBE_ATTR || PROBE_QS || PROBE_LS;

  const NOW = () => new Date().toISOString();
  const URL_NOHASH = () => location.href.split("#")[0];

  // 공용 전송
  function post(url, payload) {
    try {
      const body = JSON.stringify(payload);
      if (navigator.sendBeacon) {
        const ok = navigator.sendBeacon(url, new Blob([body], { type: "application/json" }));
        if (ok) return;
      }
      fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body }).catch(() => {});
    } catch {}
  }

  // ---- 이벤트 수집 ----
  if (ENABLE_CLICK) {
    addEventListener("click", (e) => {
      post(COLLECT, { type:"click", site:SITE, url:URL_NOHASH(), x:e.clientX, y:e.clientY, vp:{w:innerWidth,h:innerHeight}, t:NOW() });
    }, { passive:true });
  }
  if (ENABLE_SCROLL) {
    let last = 0;
    addEventListener("scroll", () => {
      const ts = Date.now(); if (ts - last < 1000) return; last = ts;
      post(COLLECT, { type:"scroll", site:SITE, url:URL_NOHASH(), y:scrollY, max:Math.max(document.documentElement.scrollHeight, document.body.scrollHeight), vp:{w:innerWidth,h:innerHeight}, t:NOW() });
    }, { passive:true });
  }
  if (ENABLE_SPA) {
    const push = history.pushState;
    history.pushState = function(...args){ push.apply(this,args); setTimeout(()=>post(COLLECT,{type:"route",site:SITE,url:URL_NOHASH(),t:NOW()}),0) };
    addEventListener("popstate", ()=> post(COLLECT,{type:"route",site:SITE,url:URL_NOHASH(),t:NOW()}));
  }

  // ---- 스냅샷 큐 등록 ----
  const onceKey = "lf:snap:queued:" + URL_NOHASH();
  if (sessionStorage.getItem(onceKey)) return;
  sessionStorage.setItem(onceKey, "1");

  const pageSize = { w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight };

  let usesIO = false, hasLoadMoreBtn = false, scrollContainer = null;
  try {
    const _IO = window.IntersectionObserver;
    window.IntersectionObserver = function(cb, opts){ usesIO = true; return new _IO(cb, opts); };
    scrollContainer = (() => {
      let best=null, area=0;
      for (const el of document.querySelectorAll("body, body *")) {
        const st = getComputedStyle(el);
        if (/(auto|scroll)/.test(st.overflowY) && el.scrollHeight - el.clientHeight > 48) {
          const a = el.clientWidth * el.clientHeight;
          if (a > area) { best = el; area = a; }
        }
      }
      if (!best) return null;
      if (best.id) return "#" + best.id;
      const cls = (best.className||"").toString().trim().split(/\s+/).slice(0,3).join(".");
      if (cls) return best.tagName.toLowerCase()+"."+cls;
      return best.tagName.toLowerCase();
    })();
    const txtMatch = (t) => /더보기|더 불러오기|load more|show more|more/i.test(t);
    for (const el of document.querySelectorAll("a,button")) {
      const t = (el.innerText||"").trim();
      const ar = el.getAttribute("aria-label")||"";
      if ((t && txtMatch(t)) || (ar && txtMatch(ar))) { hasLoadMoreBtn = true; break; }
    }
  } catch {}

  const doProbe = async () => {
    if (!PROBE) return { probed:false };
    const before = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);
    const tgtSel = scrollContainer;
    for (let i=0;i<3;i++){
      try{
        if (tgtSel) {
          const el = document.querySelector(tgtSel);
          if (el) el.scrollBy(0, Math.floor(el.clientHeight*0.9));
          else window.scrollBy(0, Math.floor(window.innerHeight*0.9));
        } else {
          window.scrollBy(0, Math.floor(window.innerHeight*0.9));
        }
        await new Promise(r=>setTimeout(r, 600));
      }catch{}
    }
    const after = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);
    return { probed:true, heightGrew: (after - before) > 64 };
  };

  const sendQueue = (payload) => post(SNAPSHOT.replace(/\/+$/,'') + "/queue", payload);

  (async () => {
    const probe = await doProbe();
    const capture = (() => {
      if (probe.probed && probe.heightGrew) return { mode:"scroll", maxSteps:12, waitMs:700, scrollContainer };
      if (usesIO || hasLoadMoreBtn)        return { mode:"scroll", maxSteps: 8, waitMs:700, scrollContainer };
      return { mode:"static" };
    })();
    sendQueue({ url: URL_NOHASH(), viewports: VIEWPORTS, pageSize, capture, hints:{ usesIO, hasLoadMoreBtn, scrollContainer } });
  })();
})();
