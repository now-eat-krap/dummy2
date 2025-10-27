(function () {
  // ===== 0. global guard (중복 실행 방지) =====
  // 이미 embed.js가 한 번 실행된 상태라면 바로 종료해버린다.
  if (typeof window !== "undefined") {
    if (window.__APILOG_EMBED_BOOTED__) {
      return;
    }
    window.__APILOG_EMBED_BOOTED__ = true;
  }

  // ===== helpers =====

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
      init: function () {
        q.push(["init", arguments]);
      },
      markFunnelStep: function () {
        q.push(["markFunnelStep", arguments]);
      },
      markError: function () {
        q.push(["markError", arguments]);
      },
      flushNow: function () {
        q.push(["flushNow", arguments]);
      },
      __q: q
    };

    win.apilog = stub;
    return stub;
  }

  // embed.js의 src 기준으로 apilog.js 경로 추론
  // 예: http://host/apilog/embed.js -> http://host/apilog/apilog.js
  function getCollectorUrl(embedScriptEl) {
    var embedSrc = embedScriptEl.getAttribute("src") || "";
    var lastSlash = embedSrc.lastIndexOf("/");
    var base = lastSlash >= 0 ? embedSrc.slice(0, lastSlash) : "";
    return base ? (base + "/apilog.js") : "apilog.js";
  }

  // data-* 속성에서 초기 설정 읽기
  function readInitConfigFromScript(el) {
    return {
      siteId: el.getAttribute("data-site-id") || "",
      ingestUrl: el.getAttribute("data-ingest-url") || "",
      pageVariant: el.getAttribute("data-page-variant") || "",
      utmSource: el.getAttribute("data-utm-source") || "",
      utmCampaign: el.getAttribute("data-utm-campaign") || ""
    };
  }

  // 실제 수집기(apilog.js)를 동적으로 <script>로 붙임
  function loadCollectorScript(url, onLoad, onError) {
    var s = document.createElement("script");
    s.src = url;
    s.async = true;
    s.defer = true;
    s.crossOrigin = "anonymous";

    s.onload = function () {
      onLoad();
    };
    s.onerror = function () {
      onError();
    };

    document.head.appendChild(s);
  }

  // apilog.js가 로드된 뒤 init(config) 호출 + 큐 재생
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
            try {
              win.apilog[method].apply(null, args);
            } catch (err) {
              // ignore
            }
          }
        }
        win.apilog.__q = [];
      }
    } catch (e) {
      // ignore
    }
  }

  // ===== main =====

  // SSR 등에서 window/document 없으면 그냥 나간다
  if (typeof window === "undefined" || typeof document === "undefined") {
    return;
  }

  var win = window;
  var me = getCurrentScript();
  if (!me) {
    // 혹시 못 찾으면 stub만 보장하고 종료
    ensureApilogStub(win);
    return;
  }

  var initConfig = readInitConfigFromScript(me);

  // 전역 apilog 스텁 준비
  ensureApilogStub(win);

  // apilog.js 경로 계산
  var collectorUrl = getCollectorUrl(me);

  // apilog.js 로드해서 초기화
  loadCollectorScript(
    collectorUrl,
    function () {
      finalizeInit(win, initConfig);
    },
    function () {
      // 조용히 실패
    }
  );
})();
