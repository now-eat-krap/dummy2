/**
 * (구버전) 이벤트 수집 전용 스니펫
 * - 새 프로젝트에선 ba-combined.js 사용을 권장합니다.
 */
(() => {
  const S = document.currentScript;
  const endpoint = (S && S.dataset.endpoint) || "http://localhost:8080/ba";
  const site = (S && S.dataset.site) || "logflow";
  const enableClick = (S && S.dataset.click) === "true";
  const enableScroll = (S && S.dataset.scroll) === "true";
  const spa = (S && S.dataset.spa) === "true";

  function send(payload){
    try {
      navigator.sendBeacon && navigator.sendBeacon(endpoint, new Blob([JSON.stringify(payload)], {type:'application/json'}));
    } catch {}
    fetch(endpoint, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) }).catch(()=>{});
  }
  const now = () => new Date().toISOString();
  const urlNoHash = () => location.href.split('#')[0];

  if (enableClick) {
    addEventListener('click', (e) => {
      send({ type:'click', site, url: urlNoHash(), x:e.clientX, y:e.clientY, vp:{w:innerWidth,h:innerHeight}, t: now() });
    }, { passive:true });
  }

  if (enableScroll) {
    let last = 0;
    addEventListener('scroll', () => {
      const ts = Date.now(); if (ts - last < 1000) return; last = ts;
      send({ type:'scroll', site, url:urlNoHash(), y:scrollY, max:Math.max(document.documentElement.scrollHeight, document.body.scrollHeight), vp:{w:innerWidth,h:innerHeight}, t: now() });
    }, { passive:true });
  }

  if (spa) {
    const push = history.pushState;
    history.pushState = function(...args){ push.apply(this,args); setTimeout(()=>send({type:'route',site,url:urlNoHash(),t:now()}),0) };
    addEventListener('popstate', ()=> send({type:'route',site,url:urlNoHash(),t:now()}));
  }
})();
