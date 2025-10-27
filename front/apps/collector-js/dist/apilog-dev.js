(function () {
  let _cfg = null;
  let _buffer = [];
  let _sessionId = genSessionId();
  let _userHash = genUserHash();

  function init(config) {
    _cfg = config || {};

    trackEvent({
      event_name: "page_view",
      path: location.pathname,
      extra: { referrer: document.referrer || "" }
    });

    window.addEventListener("click", function (ev) {
      trackEvent({
        event_name: "click",
        path: location.pathname,
        click_x: ev.clientX,
        click_y: ev.clientY,
        extra: {
          tag: (ev.target && ev.target.tagName) || "",
          text: getSafeText(ev.target)
        }
      });
    });

    let maxScrollPct = 0;
    window.addEventListener("scroll", function () {
      const pct = calcScrollPct();
      if (pct > maxScrollPct) {
        maxScrollPct = pct;
        trackEvent({
          event_name: "scroll",
          path: location.pathname,
          scroll_pct: pct
        });
      }
    });
  }

  function trackEvent(e) {
    const now = Date.now();
    const device_type = /Mobi/i.test(navigator.userAgent) ? "mobile" : "desktop";

    const point = {
      timestamp: now,
      site_id: _cfg.siteId || "",
      path: e.path || location.pathname,
      event_name: e.event_name || "custom",
      device_type,
      browser_family: detectBrowserFamily(),
      country_code: "",
      utm_source: "",
      utm_campaign: "",
      count: 1,
      session_id: _sessionId,
      user_hash: _userHash,
      scroll_pct: e.scroll_pct != null ? e.scroll_pct : null,
      click_x: e.click_x != null ? e.click_x : null,
      click_y: e.click_y != null ? e.click_y : null,
      funnel_step: "",
      error_flag: false,
      bot_score: 0,
      extra_json: JSON.stringify(e.extra || {})
    };

    _buffer.push(point);
  }

  async function flushNow() {
    if (_buffer.length === 0) {
        return;
    }

    const payload = {
      site_id: _cfg.siteId || "",
      ingest_url: _cfg.ingestUrl || "",
      events: _buffer.slice()
    };

    console.log("[apilog] sending batch ->", payload);

    try {
      if (_cfg.ingestUrl) {
        const res = await fetch(_cfg.ingestUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        if (!res.ok) {
          console.warn("[apilog] ingest failed", res.status);
        } else {
          console.log("[apilog] ingest ok");
          _buffer = [];
        }
      } else {
        console.warn("[apilog] no ingestUrl; skip network");
      }
    } catch (err) {
      console.warn("[apilog] ingest error", err);
    }
  }

  function calcScrollPct() {
    const doc = document.documentElement;
    const scrollTop = window.scrollY || doc.scrollTop || 0;
    const winH = window.innerHeight || doc.clientHeight || 0;
    const fullH = Math.max(
      doc.scrollHeight,
      doc.offsetHeight,
      doc.clientHeight,
      document.body ? document.body.scrollHeight : 0,
      document.body ? document.body.offsetHeight : 0
    );
    if (!fullH) return 0;
    const pct = (scrollTop + winH) / fullH;
    return Math.max(0, Math.min(1, pct));
  }

  function getSafeText(el) {
    if (!el) return "";
    try {
      const t = (el.innerText || el.textContent || "").trim();
      return t.slice(0, 30);
    } catch (_) {
      return "";
    }
  }

  function detectBrowserFamily() {
    const ua = navigator.userAgent;
    if (/Chrome\//i.test(ua) && !/Edge\//i.test(ua)) return "Chrome";
    if (/Safari\//i.test(ua) && /Version\//i.test(ua)) return "Safari";
    if (/Firefox\//i.test(ua)) return "Firefox";
    if (/Edg\//i.test(ua) || /Edge\//i.test(ua)) return "Edge";
    return "Other";
  }

  function genSessionId() {
    return "sess_" + Math.random().toString(36).slice(2, 10);
  }
  function genUserHash() {
    return "u_" + Math.random().toString(36).slice(2, 10);
  }

  const api = {
    init,
    trackEvent,
    flushNow,
    markFunnelStep(stepName) {
      trackEvent({
        event_name: "funnel_step",
        path: location.pathname,
        extra: { step: stepName }
      });
    },
    markError(info) {
      trackEvent({
        event_name: "error",
        path: location.pathname,
        extra: {
          message: info && info.message ? info.message : "",
          severity: info && info.severity ? info.severity : "info"
        }
      });
    }
  };

  if (window.apilog && window.apilog.__q) {
    const q = window.apilog.__q;
    window.apilog = api;
    for (let i = 0; i < q.length; i++) {
      const [method, args] = q[i];
      if (typeof api[method] === "function") {
        try { api[method].apply(null, args); } catch (_e) {}
      }
    }
  } else {
    window.apilog = api;
  }
})();
