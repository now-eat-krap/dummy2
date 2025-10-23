/* snapshot-sdk.js — robust auto-queue SDK (success-based dedupe + SPA hook + debug) */
(function () {
  // ---------- helpers ----------
  function debugOn() {
    try { return ((scriptEl.dataset.debug || "").toLowerCase() === "on"); } catch(e){ return false; }
  }
  function log() { if (debugOn()) console.log("[snap-sdk]", ...arguments); }
  function warn(){ if (debugOn()) console.warn("[snap-sdk]", ...arguments); }

  // currentScript 폴백: Next Script일 때도 잡히도록
  function resolveScriptEl() {
    var s = document.currentScript;
    if (s) return s;
    var list = document.querySelectorAll('script[src*="snapshot-sdk.js"]');
    return list[list.length - 1] || null;
  }
  var scriptEl = resolveScriptEl() || { dataset: {} };

  // cfg 읽기
  function parseViewports(v) {
    return (v || "1366x900").split(",").map(function (x) { return x.trim(); }).filter(Boolean);
  }
  function canonicalUrl(raw) {
    var u = (raw || location.href.split("#")[0]);
    try { u = new URL(u, location.href).href; } catch(e){}
    return u;
  }
  function sameSchemeUrl(u, scheme) {
    try { var x = new URL(u); x.protocol = scheme + ":"; return x.href; } catch(e){ return u; }
  }

  // 구성 파싱
  var ds = scriptEl.dataset || {};
  var endpoint = (ds.endpoint || (location.origin));         // 기본: 같은 오리진
  var viewports = parseViewports(ds.viewports);
  var mode = (ds.mode || "auto").toLowerCase();              // auto | static | scroll
  var probe = ((ds.probe || "on").toLowerCase() === "on");
  var scrollee = ds.scrollContainer || null;
  var maxSteps = +(ds.maxSteps || 28);
  var waitMs   = +(ds.waitMs   || 700);
  var maxTime  = +(ds.maxTimeMs|| 45000);
  var minDelta = +(ds.minDelta || 80);
  var plateau  = +(ds.plateauNeed || 2);

  var url = canonicalUrl(ds.url); // 명시된 url이 있으면 사용
  if (!ds.url) url = canonicalUrl(location.href);

  // HTTPS 페이지에서 HTTP endpoint 쓰면 브라우저가 막음 → 스킴 맞추기
  try {
    var pageScheme = (location.protocol || "http:").replace(":", "");
    endpoint = sameSchemeUrl(endpoint, pageScheme);
  } catch (e) {}

  // ---------- core ----------
  function probeGrow() {
    if (!probe) return Promise.resolve({ heightGrew: true, probed: false });
    var before = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);
    try { window.scrollBy(0, Math.floor(window.innerHeight * 0.9)); } catch (e) {}
    return new Promise(function (r) { setTimeout(r, 350); }).then(function () {
      try { window.scrollBy(0, Math.floor(window.innerHeight * 0.9)); } catch (e) {}
      return new Promise(function (r) { setTimeout(r, 350); }).then(function () {
        var after = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);
        return { heightGrew: (after - before) > 64, probed: true };
      });
    });
  }

  function buildPayload(heightGrew) {
    var cap;
    if (mode === "static") cap = { mode: "static" };
    else if (mode === "scroll") cap = { mode: "scroll", maxSteps, waitMs, maxTimeMs: maxTime, minDeltaPx: minDelta, plateauNeed: plateau, scrollContainer: scrollee };
    else cap = heightGrew
        ? { mode: "scroll", maxSteps, waitMs, maxTimeMs: maxTime, minDeltaPx: minDelta, plateauNeed: plateau, scrollContainer: scrollee }
        : { mode: "static" };
    return { url, viewports, capture: cap };
  }

  function queueOnce(reason) {
    var key = "snap:queued:" + url;
    if (sessionStorage.getItem(key)) {
      log("skip dedupe", { url, reason: "already-queued" });
      return Promise.resolve(false);
    }
    var ep = (endpoint.replace(/\/$/, "") + "/queue");
    var will = (mode === "auto" ? probeGrow() : Promise.resolve({ heightGrew: true }));
    log("queue start", { url, endpoint: ep, reason, mode, viewports });

    return will.then(function (res) {
      var payload = buildPayload(!!res.heightGrew);
      return fetch(ep, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        mode: "cors",
        credentials: "omit",
      }).then(function (r) {
        if (r.ok) {
          sessionStorage.setItem(key, "1");   // ✅ 성공시에만 dedupe 표시
          log("queued OK", { url });
          return true;
        } else {
          warn("queue failed HTTP", r.status);
          return false;
        }
      }).catch(function (e) {
        warn("queue error", e && e.message);
        return false;
      });
    });
  }

  // 외부에서 수동 호출 가능하도록
  window.__snapQueue = function (u) {
    if (u) url = canonicalUrl(u);
    return queueOnce("manual");
  };

  // ---------- SPA hook ----------
  function hookSpa() {
    var last = canonicalUrl(location.href);
    function onChange() {
      var now = canonicalUrl(location.href);
      if (now === last) return;
      last = now;
      url = now; // 대상 URL 갱신
      // 실패/설정 변경 뒤 재큐잉 가능하도록 dedupe 해제
      sessionStorage.removeItem("snap:queued:" + now);
      queueOnce("spa-route");
    }
    var _push = history.pushState, _replace = history.replaceState;
    history.pushState = function(){ var r=_push.apply(this, arguments); setTimeout(onChange, 0); return r; };
    history.replaceState = function(){ var r=_replace.apply(this, arguments); setTimeout(onChange, 0); return r; };
    window.addEventListener("popstate", onChange);
  }

  // ---------- boot ----------
  function boot() { queueOnce("boot"); hookSpa(); }
  if (document.readyState === "complete" || document.readyState === "interactive") {
    setTimeout(boot, 0);
  } else {
    addEventListener("DOMContentLoaded", boot);
  }
})();
