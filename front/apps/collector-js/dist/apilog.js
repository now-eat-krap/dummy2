(function () {
  // ===========================================================================
  // 0. Guard: run in browser only / 브라우저 환경에서만 실행
  // ===========================================================================

  if (typeof window === "undefined" || typeof document === "undefined") {
    return;
  }

  // We'll attach final API onto this same object so we don't lose the stub.
  // 이미 embed.js가 window.apilog = { __q: [...] } 형태의 스텁을 만들어놨다.
  // 그 객체를 그대로 재사용하면서 실제 구현 함수만 덮어쓴다.
  var globalApi = window.apilog || {};
  if (!globalApi.__q) {
    globalApi.__q = [];
  }

  // ===========================================================================
  // 1. Small utility helpers / 작은 유틸 함수들
  // ===========================================================================

  function now() {
    // current time in epoch ms / 현재 시간을 epoch ms로
    return Date.now();
  }

  function uuid() {
    // lightweight random id for session / 세션용 가벼운 랜덤 ID
    return (
      Math.random().toString(16).slice(2) +
      Math.random().toString(16).slice(2) +
      Math.random().toString(16).slice(2)
    ).slice(0, 32);
  }

  function getOrCreateSessionId() {
    // Keep a session ID stable for this tab using sessionStorage.
    // 같은 탭(세션) 동안은 같은 ID를 쓰고, 새 탭이면 새 ID.
    //
    // 일부 브라우저(프라이버시 모드 등)는 sessionStorage 접근이 막힐 수 있으므로
    // 그럴 땐 window 전역 변수로 fallback.
    try {
      var KEY = "_apilog_session";
      var existing = sessionStorage.getItem(KEY);
      if (existing) return existing;
      var fresh = uuid();
      sessionStorage.setItem(KEY, fresh);
      return fresh;
    } catch (e) {
      if (!window.__apilog_sess) {
        window.__apilog_sess = uuid();
      }
      return window.__apilog_sess;
    }
  }

  function detectDeviceType() {
    // Very rough mobile/desktop detector by UA.
    // UA로 모바일/데스크톱 대충 구분 (MVP 용도)
    var ua = navigator.userAgent.toLowerCase();
    if (/mobi|android|iphone|ipad/.test(ua)) return "mobile";
    return "desktop";
  }

  function detectBrowserFamily() {
    // Group browsers into broad families for dashboard dimensions.
    // 브라우저를 큰 계열로만 구분해서 분석 차원으로 사용
    var ua = navigator.userAgent;
    if (ua.indexOf("Chrome") !== -1) return "Chrome";
    if (ua.indexOf("Safari") !== -1) return "Safari";
    if (ua.indexOf("Firefox") !== -1) return "Firefox";
    if (ua.indexOf("Edg") !== -1 || ua.indexOf("Edge") !== -1) return "Edge";
    return "Other";
  }

  function getUtmParam(key) {
    // Read ?utm_source=... etc from current URL.
    // 현재 URL의 utm 파라미터 추출
    try {
      var url = new URL(window.location.href);
      return url.searchParams.get(key);
    } catch (e) {
      return null;
    }
  }

  function normalizePath(pathname) {
    // Normalize path before storing.
    // 쿼리스트링 등 제거하고 경로만 남김.
    // 필요하면 /user/123 → /user/:id 식 마스킹도 나중에 여기서 가능.
    return pathname.split("?")[0];
  }

  // ===========================================================================
  // 2. Scroll depth / 스크롤 도달 깊이 계산
  // ===========================================================================

  function getMaxScrollPct() {
    // How far down (0~1) the user has seen on the page.
    // 유저가 문서의 어느 지점까지 내려봤는지 비율(0~1)
    var doc = document.documentElement;
    var body = document.body;

    var scrollTop =
      window.pageYOffset || doc.scrollTop || body.scrollTop || 0;

    var viewportH = window.innerHeight || doc.clientHeight;

    var fullH = Math.max(
      body.scrollHeight,
      body.offsetHeight,
      doc.clientHeight,
      doc.scrollHeight,
      doc.offsetHeight
    );

    var maxSeen = scrollTop + viewportH;
    if (fullH <= 0) return 0;

    var pct = maxSeen / fullH;
    if (pct > 1) pct = 1;
    return pct;
  }

  // ===========================================================================
  // 3. DOM element "signature" for clicks / 클릭된 요소 시그니처
  //    (privacy-safe, no innerText)
  //    (텍스트 안 보냄. 구조 기반만)
  // ===========================================================================

  function sanitizeCssIdent(s) {
    // Clean class names etc so they can be used in a selector-ish string.
    // 셀렉터에 넣기 애매한 문자들은 '_'로 치환
    return s.replace(/[^a-zA-Z0-9\-_]/g, "_");
  }

  function nthOfType(el) {
    // :nth-of-type(N) helper to tell siblings apart.
    // 같은 태그가 부모 안에 여러 개면 몇 번째인지 붙여준다.
    if (!el.parentNode) return "";
    var tag = el.tagName;
    var index = 0;
    var count = 0;

    var children = el.parentNode.childNodes;
    for (var i = 0; i < children.length; i++) {
      var child = children[i];
      if (
        child.nodeType === 1 &&
        child.tagName === tag
      ) {
        count++;
        if (child === el) {
          index = count;
          break;
        }
      }
    }

    if (index === 0 || count === 1) return "";
    return ":nth-of-type(" + index + ")";
  }

  function buildDomSelector(el) {
    // Build a short-ish CSS-like path from this element up to <body>.
    // body까지 거슬러 올라가며 태그/일부 클래스/순번 정도만 기록.
    // 민감한 text, form values 등은 절대 포함 X.
    var parts = [];
    var current = el;
    var depthLimit = 6; // 너무 깊이 안 올라가게 제한

    while (current && current.nodeType === 1 && parts.length < depthLimit) {
      var tag = current.tagName.toLowerCase();

      if (current.id) {
        parts.unshift(tag + "#" + current.id);
        break;
      }

      // up to 2 classes only
      // 클래스는 상위 2개만 (너무 많으면 카디널리티 ↑)
      var classPart = "";
      if (current.classList && current.classList.length > 0) {
        var classes = [];
        for (var i = 0; i < current.classList.length && i < 2; i++) {
          var c = sanitizeCssIdent(current.classList[i]);
          if (c) classes.push(c);
        }
        if (classes.length > 0) {
          classPart = "." + classes.join(".");
        }
      }

      var nth = nthOfType(current);

      parts.unshift(tag + classPart + nth);

      if (tag === "body") {
        break;
      }
      current = current.parentElement;
    }

    return parts.join(" > ");
  }

  function hashString(input) {
    // Tiny non-crypto hash just to group clicks on same element.
    // 히트맵에서 같은 요소를 묶기 위한 짧은 해시 (보안용 아님)
    var hash1 = 5381;
    var hash2 = 52711;
    for (var i = 0; i < input.length; i++) {
      var ch = input.charCodeAt(i);
      hash1 = (hash1 * 33) ^ ch;
      hash2 = (hash2 * 33) ^ ch;
    }
    var h = (Math.abs(hash1 + hash2 * 15619) >>> 0).toString(36);
    return h;
  }

  function getElementSignature(el, clickX, clickY) {
    // We generate:
    //  - selector (DOM position summary, safe)
    //  - elementHash (hashed selector, stable id for heatmap)
    //  - relX / relY (relative click position inside element 0~1)
    //
    // 클릭된 요소에 대해
    //  - selector: 경로 요약(민감 텍스트 없음)
    //  - elementHash: selector 해시값(히트맵 key)
    //  - relX/relY: 요소 내부 상대 클릭 위치(0~1)
    var selector = buildDomSelector(el);
    var elementHash = hashString(selector);

    var rect = el.getBoundingClientRect();

    var viewportX = clickX - window.scrollX;
    var viewportY = clickY - window.scrollY;

    var relX = null;
    var relY = null;
    if (rect.width > 0 && rect.height > 0) {
      relX = (viewportX - rect.left) / rect.width;
      relY = (viewportY - rect.top) / rect.height;
      // clamp to 0~1
      if (relX < 0) relX = 0;
      if (relX > 1) relX = 1;
      if (relY < 0) relY = 0;
      if (relY > 1) relY = 1;
    }

    return {
      selector: selector,
      elementHash: elementHash,
      relX: relX,
      relY: relY
    };
  }

  // ===========================================================================
  // 4. Throttle helper / 쓰로틀 (scroll handler 등에서 사용)
  // ===========================================================================

  function throttle(fn, ms) {
    // Basic throttle:
    //  - don't run fn more than once every ms
    //  - keep the latest args and run after delay if spammed
    //
    // 일정 주기(ms)보다 자주 호출 안 되고,
    // 마지막 인자는 유지했다가 딜레이 끝나면 실행
    var last = 0;
    var timer = null;
    var pendingArgs = null;

    function run() {
      if (pendingArgs) {
        fn.apply(null, pendingArgs);
        pendingArgs = null;
        last = Date.now();
      }
      timer = null;
    }

    return function () {
      var nowTime = Date.now();
      var diff = nowTime - last;
      var args = Array.prototype.slice.call(arguments);

      if (diff >= ms && !timer) {
        last = nowTime;
        fn.apply(null, args);
      } else {
        pendingArgs = args;
        if (!timer) {
          timer = window.setTimeout(run, ms - diff);
        }
      }
    };
  }

  // ===========================================================================
  // 5. BatchQueue: buffer events and POST in batches
  //    배치 큐: 이벤트를 모아서 주기적으로 업로드
  // ===========================================================================

  function BatchQueue(endpoint) {
    this.buf = [];
    this.flushTimer = null;
    this.flushInterval = 5000; // ms, 기본 5초마다 전송 시도
    this.maxBatch = 50;        // 버퍼가 50개 넘으면 바로 전송
    this.endpoint = endpoint;
  }

  BatchQueue.prototype.push = function (ev) {
    this.buf.push(ev);

    // Too many events? flush immediately
    // 너무 많이 쌓이면 즉시 flush
    if (this.buf.length >= this.maxBatch) {
      this.flush(false);
      return;
    }

    // else schedule flush
    // 아니면 타이머로 지연 flush 예약
    if (this.flushTimer == null) {
      var self = this;
      this.flushTimer = window.setTimeout(function () {
        self.flush(false);
      }, this.flushInterval);
    }
  };

  BatchQueue.prototype.flush = function (sync) {
    // sync=true means "try to send right now because tab may be closing"
    // sync=true는 탭 닫히는중(beforeunload)일 수도 있다는 의미 → sendBeacon 우선
    if (this.buf.length === 0) return;

    var batch = this.buf;
    this.buf = [];

    if (this.flushTimer != null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    var payload = {
      events: batch
    };

    // Try navigator.sendBeacon first for unload-safe delivery
    // 페이지 떠나는 순간에도 최대한 안 잃어버리게 sendBeacon 시도
    if (sync && navigator.sendBeacon) {
      try {
        var blob = new Blob([JSON.stringify(payload)], {
          type: "application/json"
        });
        navigator.sendBeacon(this.endpoint, blob);
        return;
      } catch (e) {
        // fall through to fetch keepalive
      }
    }

    // Fire-and-forget fetch.
    // 실패해도 조용히 무시 (분석 코드가 사이트를 깨면 안 됨)
    fetch(this.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      keepalive: !!sync,
      body: JSON.stringify(payload)
    }).catch(function () {
      // ignore errors on purpose
    });
  };

  // ===========================================================================
  // 6. ApiLogCollector main class
  //    페이지에서 실제로 클릭/스크롤/체류시간 등 캡처하는 본체
  // ===========================================================================

  function ApiLogCollector(opts) {
    // opts: {
    //   siteId: string,
    //   ingestUrl: string,
    //   pageVariant?: string,
    //   utmSource?: string,
    //   utmCampaign?: string
    // }

    this.opts = opts;
    this.sessionId = getOrCreateSessionId(); // 세션ID(탭 단위)
    this.startTime = now();                  // 페이지 들어온 시각
    this.destroyed = false;                  // 언로드됐는지 여부
    this.maxScrollSeen = getMaxScrollPct();  // 지금까지 본 최대 스크롤 비율
    this.q = new BatchQueue(opts.ingestUrl); // 배치 큐

    // 이벤트 리스너 세팅
    this.installListeners();

    // 최초 page_view 이벤트 기록
    this.emitPageView();
  }

  // ---------- internal helpers on instance ---------------------------------

  ApiLogCollector.prototype.installListeners = function () {
    var self = this;

    // CLICK LISTENER
    // 클릭 좌표 + 타겟 엘리먼트 시그니처 수집
    document.addEventListener(
      "click",
      function (ev) {
        var docEl = document.documentElement;
        var scrollX = window.pageXOffset || docEl.scrollLeft || 0;
        var scrollY = window.pageYOffset || docEl.scrollTop || 0;

        var x = 0;
        var y = 0;
        if ("pageX" in ev && "pageY" in ev) {
          x = ev.pageX || 0;
          y = ev.pageY || 0;
        } else if ("clientX" in ev && "clientY" in ev) {
          x = (ev.clientX || 0) + scrollX;
          y = (ev.clientY || 0) + scrollY;
        }

        var targetEl = ev.target || document.body;
        self.emitClick(targetEl, x, y);
      },
      true // capture phase: get original target early
    );

    // SCROLL LISTENER (THROTTLED)
    // 스크롤 도중 최대 스크롤 비율 갱신 (250ms 쓰로틀)
    var onScroll = throttle(function () {
      var pct = getMaxScrollPct();
      if (pct > self.maxScrollSeen) {
        self.maxScrollSeen = pct;
      }
    }, 250);

    window.addEventListener("scroll", onScroll, { passive: true });

    // BEFOREUNLOAD HANDLER
    // 페이지 떠나기 직전 마지막 스크롤/체류시간 전송 후 즉시 flush
    window.addEventListener("beforeunload", function () {
      self.emitScrollDepth();
      self.emitDwell();

      self.q.flush(true); // sync flush
      self.destroyed = true;
    });
  };

  ApiLogCollector.prototype.baseTags = function (eventName, elementHash) {
    // Common tag-like dimensions for this event.
    // 태그 성격의 공통 차원 값들(낮은 카디널리티)
    return {
      site_id: this.opts.siteId,
      path: normalizePath(location.pathname),
      page_variant: this.opts.pageVariant || "default",
      event_name: eventName,
      element_hash: elementHash || null,
      device_type: detectDeviceType(),
      browser_family: detectBrowserFamily(),
      country_code: null, // optional: server can enrich from IP / 서버에서 IP기반 국가코드 넣어도 됨
      utm_source: this.opts.utmSource || getUtmParam("utm_source"),
      utm_campaign: this.opts.utmCampaign || getUtmParam("utm_campaign")
    };
  };

  ApiLogCollector.prototype.baseFields = function () {
    // Common fields: higher-cardinality ids and numeric metrics.
    // 공통 필드들: 세션ID(카디널리티 높음), 수치 데이터 등
    var vw =
      window.innerWidth || document.documentElement.clientWidth || 0;
    var vh =
      window.innerHeight || document.documentElement.clientHeight || 0;

    return {
      count: 1,                 // always 1 → we'll use sum(count) later
      session_id: this.sessionId,
      user_hash: null,          // place to inject anon user ID later if you want
      dwell_ms: null,
      scroll_pct: null,
      click_x: null,
      click_y: null,
      viewport_w: vw,
      viewport_h: vh,
      funnel_step: null,
      error_flag: null,
      bot_score: null,
      extra_json: null
    };
  };

  ApiLogCollector.prototype.pushRecord = function (partial) {
    // Combine partial record with timestamp
    // partial 정보에 timestamp(ts)까지 합쳐서 배치 큐로 밀어넣는다.
    var rec = Object.assign(
      {
        ts: partial.ts != null ? partial.ts : now()
      },
      partial
    );
    this.q.push(rec);
  };

  // ---------- emitters: create logical events and queue them ---------------

  ApiLogCollector.prototype.emitPageView = function () {
    // Called once on load.
    // 페이지 로드시 page_view 이벤트 한 번
    var rec = Object.assign(
      {},
      this.baseTags("page_view", null),
      this.baseFields(),
      {
        dwell_ms: 0,
        scroll_pct: this.maxScrollSeen,
        ts: now()
      }
    );
    this.pushRecord(rec);
  };

  ApiLogCollector.prototype.emitClick = function (targetEl, absX, absY) {
    // Capture "click" event for heatmap analysis.
    // 클릭 이벤트 → 히트맵용으로 element_hash 등 저장
    var sig = getElementSignature(targetEl, absX, absY);

    var rec = Object.assign(
      {},
      this.baseTags("click", sig.elementHash),
      this.baseFields(),
      {
        click_x: absX,
        click_y: absY,
        extra_json: JSON.stringify({
          rel_x: sig.relX,
          rel_y: sig.relY,
          selector: sig.selector // helpful for debugging overlay (no PII)
        }),
        ts: now()
      }
    );

    this.pushRecord(rec);
  };

  ApiLogCollector.prototype.emitScrollDepth = function () {
    // Before unload, send the max scroll depth we observed.
    // 언로드 직전 지금까지의 최대 스크롤 도달 비율 전송
    var pct = this.maxScrollSeen;

    var rec = Object.assign(
      {},
      this.baseTags("scroll", null),
      this.baseFields(),
      {
        scroll_pct: pct,
        ts: now()
      }
    );

    this.pushRecord(rec);
  };

  ApiLogCollector.prototype.emitDwell = function () {
    // Before unload, send how long user stayed on this page.
    // 언로드 직전 체류시간(ms) 전송
    var dur = now() - this.startTime;

    var rec = Object.assign(
      {},
      this.baseTags("page_view_dwell", null),
      this.baseFields(),
      {
        dwell_ms: dur,
        scroll_pct: this.maxScrollSeen,
        ts: now()
      }
    );

    this.pushRecord(rec);
  };

  // ---------- public API (funnel step / error / manual flush) ---------------

  ApiLogCollector.prototype.markFunnelStep = function (stepName) {
    // Custom business funnel step marker.
    // 비즈니스 퍼널 단계 기록 (예: checkout_step2)
    var rec = Object.assign(
      {},
      this.baseTags("funnel_step", null),
      this.baseFields(),
      {
        funnel_step: stepName,
        ts: now()
      }
    );
    this.pushRecord(rec);
  };

  ApiLogCollector.prototype.markError = function (info) {
    // Log an "error" style event with optional metadata in extra_json.
    // 에러 발생 같은 상태를 기록. (PII 넣지 말 것!)
    var rec = Object.assign(
      {},
      this.baseTags("error", null),
      this.baseFields(),
      {
        error_flag: true,
        extra_json: info
          ? JSON.stringify(info).slice(0, 1024) // cap size
          : null,
        ts: now()
      }
    );
    this.pushRecord(rec);
  };

  ApiLogCollector.prototype.flush = function () {
    // Manually flush queued events now.
    // 지금까지 쌓인 이벤트를 즉시 전송
    this.q.flush(false);
  };

  // ===========================================================================
  // 7. Singleton management / 싱글턴 관리
  //    (한 페이지에서 collector는 한 번만 초기화)
  // ===========================================================================

  var __apilog_singleton = null;

  function initCollector(opts) {
    // opts.siteId (string, required)
    // opts.ingestUrl (string, required)
    // opts.pageVariant / opts.utmSource / opts.utmCampaign (optional)

    if (__apilog_singleton) return __apilog_singleton;
    __apilog_singleton = new ApiLogCollector(opts);
    return __apilog_singleton;
  }

  function markFunnelStep(stepName) {
    if (__apilog_singleton) {
      __apilog_singleton.markFunnelStep(stepName);
    }
  }

  function markError(info) {
    if (__apilog_singleton) {
      __apilog_singleton.markError(info);
    }
  }

  function flushNow() {
    if (__apilog_singleton) {
      __apilog_singleton.flush();
    }
  }

  // ===========================================================================
  // 8. Attach final API onto window.apilog
  //    embed.js가 만든 스텁 객체를 "실제 구현"으로 업그레이드
  // ===========================================================================

  globalApi.init = function (config) {
    // config: {
    //   siteId: "main",
    //   ingestUrl: "http://host/api/ingest/events",
    //   pageVariant?: "...",
    //   utmSource?: "...",
    //   utmCampaign?: "..."
    // }
    initCollector(config);
  };

  globalApi.markFunnelStep = function (stepName) {
    markFunnelStep(stepName);
  };

  globalApi.markError = function (info) {
    markError(info);
  };

  globalApi.flushNow = function () {
    flushNow();
  };

  // keep the queue reference for finalizeInit in embed.js
  // embed.js 쪽 finalizeInit()이 __q에 쌓인 호출들을 순서대로 재생할 거라서,
  // 우리가 새 객체를 만들어버리면 안 되고 같은 객체를 유지해야 함.
  window.apilog = globalApi;
})();
