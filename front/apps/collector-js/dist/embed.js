(function () {
  if (typeof window !== "undefined") {
    if (window.__APILOG_EMBED_BOOTED__) {
      return;
    }
    window.__APILOG_EMBED_BOOTED__ = true;
  }

  function getCurrentScript() {
    var cur = document.currentScript;
    if (cur && cur.tagName && cur.tagName.toLowerCase() === "script") {
      return cur;
    }
    var scripts = document.getElementsByTagName("script");
    return scripts.length ? scripts[scripts.length - 1] : null;
  }

  function ensureApilogStub(win) {
    if (win.apilog && typeof win.apilog === "object") {
      return win.apilog;
    }

    var q = [];
    var stub = {
      init: function () { q.push(["init", arguments]); },
      markFunnelStep: function () { q.push(["markFunnelStep", arguments]); },
      markError: function () { q.push(["markError", arguments]); },
      flushNow: function () { q.push(["flushNow", arguments]); },
      __q: q
    };

    win.apilog = stub;
    return stub;
  }

  function getCollectorUrl(embedScriptEl) {
    var embedSrc = embedScriptEl.getAttribute("src") || "";
    var lastSlash = embedSrc.lastIndexOf("/");
    var base = lastSlash >= 0 ? embedSrc.slice(0, lastSlash) : "";
    return base ? (base + "/apilog.js") : "apilog.js";
  }

  function readInitConfigFromScript(el) {
    return {
      siteId: el.getAttribute("data-site-id") || "",
      ingestUrl: el.getAttribute("data-ingest-url") || "",
      pageVariant: el.getAttribute("data-page-variant") || "",
      utmSource: el.getAttribute("data-utm-source") || "",
      utmCampaign: el.getAttribute("data-utm-campaign") || ""
    };
  }

  function loadCollectorScript(url, onLoad, onError) {
    var s = document.createElement("script");
    s.src = url;
    s.async = true;
    s.defer = true;
    s.crossOrigin = "anonymous";

    s.onload = function () { onLoad(); };
    s.onerror = function () { onError(); };

    document.head.appendChild(s);
  }

  function finalizeInit(win, cfg) {
    try {
      if (win.apilog && typeof win.apilog.init === "function") {
        win.apilog.init(cfg);
      }

      var maybeQ = win.apilog && win.apilog.__q;
      if (maybeQ && Array.isArray(maybeQ)) {
        for (var i = 0; i < maybeQ.length; i++) {
          var pair = maybeQ[i];
          var method = pair[0];
          var args = pair[1];
          if (win.apilog && typeof win.apilog[method] === "function") {
            try { win.apilog[method].apply(null, args); } catch (err) {}
          }
        }
        win.apilog.__q = [];
      }
    } catch (e) {}
  }

  if (typeof window === "undefined" || typeof document === "undefined") {
    return;
  }

  var win = window;
  var me = getCurrentScript();
  if (!me) {
    ensureApilogStub(win);
    return;
  }

  var initConfig = readInitConfigFromScript(me);
  ensureApilogStub(win);

  var collectorUrl = getCollectorUrl(me);

  loadCollectorScript(
    collectorUrl,
    function () {
      finalizeInit(win, initConfig);
    },
    function () {
      // fail silently
    }
  );
})();
