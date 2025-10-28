(function () {
  // ===========================================================================
  // 0. Guard: run in browser only / 브라우저 환경에서만 실행
  // ===========================================================================
  if (typeof window === "undefined" || typeof document === "undefined") {
    return;
  }

  // window를 any로 단언해서 커스텀 프로퍼티(apilog, __apilog_sess 등) 쓸 때 TS 에러 안 나게 함
  const win = window as any;

  // ---- 타입들 --------------------------------------------------------------

  interface InitConfig {
    siteId: string;
    ingestUrl: string;
    pageVariant?: string;
    utmSource?: string;
    utmCampaign?: string;
  }

  interface ApilogAPIStub {
    __q?: Array<{ fn: string; args: any[] }>;
    init?: (config: InitConfig) => void;
    markFunnelStep?: (stepName: string) => void;
    markError?: (info: unknown) => void;
    flushNow?: () => void;
  }

  // We'll attach final API onto this same object so we don't lose the stub.
  // embed.js가 window.apilog = { __q: [...] } 형태의 스텁을 먼저 만들어놨다고 가정.
  // 그대로 재사용하면서 실제 구현만 덮어쓴다.
  const globalApi: ApilogAPIStub = win.apilog || {};
  if (!globalApi.__q) {
    globalApi.__q = [];
  }

  // ===========================================================================
  // 1. Small utility helpers / 작은 유틸 함수들
  // ===========================================================================

  function now(): number {
    return Date.now();
  }

  function uuid(): string {
    return (
      Math.random().toString(16).slice(2) +
      Math.random().toString(16).slice(2) +
      Math.random().toString(16).slice(2)
    ).slice(0, 32);
  }

  function getOrCreateSessionId(): string {
    // 같은 탭 내에서는 같은 세션 ID 유지
    try {
      const KEY = "_apilog_session";
      const existing = sessionStorage.getItem(KEY);
      if (existing) return existing;
      const fresh = uuid();
      sessionStorage.setItem(KEY, fresh);
      return fresh;
    } catch {
      // 세션스토리지가 막히는 환경(프라이버시 모드 등) 대비하여 window 전역 fallback
      if (!win.__apilog_sess) {
        win.__apilog_sess = uuid();
      }
      return win.__apilog_sess;
    }
  }

  function detectDeviceType(): "mobile" | "desktop" {
    const ua = navigator.userAgent.toLowerCase();
    if (/mobi|android|iphone|ipad/.test(ua)) return "mobile";
    return "desktop";
  }

  function detectBrowserFamily(): string {
    const ua = navigator.userAgent;
    if (ua.indexOf("Chrome") !== -1) return "Chrome";
    if (ua.indexOf("Safari") !== -1) return "Safari";
    if (ua.indexOf("Firefox") !== -1) return "Firefox";
    if (ua.indexOf("Edg") !== -1 || ua.indexOf("Edge") !== -1) return "Edge";
    return "Other";
  }

  function getUtmParam(key: string): string | null {
    try {
      const url = new URL(window.location.href);
      return url.searchParams.get(key);
    } catch {
      return null;
    }
  }

  function normalizePath(pathname: string): string {
    return pathname.split("?")[0];
  }

  // ===========================================================================
  // 2. Scroll depth / 스크롤 도달 깊이 계산
  // ===========================================================================
  function getMaxScrollPct(): number {
    const doc = document.documentElement;
    const body = document.body;

    const scrollTop =
      window.pageYOffset || doc.scrollTop || body.scrollTop || 0;

    const viewportH = window.innerHeight || doc.clientHeight;

    const fullH = Math.max(
      body.scrollHeight,
      body.offsetHeight,
      doc.clientHeight,
      doc.scrollHeight,
      doc.offsetHeight
    );

    const maxSeen = scrollTop + viewportH;
    if (fullH <= 0) return 0;

    let pct = maxSeen / fullH;
    if (pct > 1) pct = 1;
    return pct;
  }

  // ===========================================================================
  // 3. DOM element "signature" for clicks / 클릭된 요소 시그니처
  // ===========================================================================
  function sanitizeCssIdent(s: string): string {
    return s.replace(/[^a-zA-Z0-9\-_]/g, "_");
  }

  function nthOfType(el: Element): string {
    if (!el.parentNode) return "";
    const tag = el.tagName;
    let index = 0;
    let count = 0;

    const children = el.parentNode.childNodes;
    for (let i = 0; i < children.length; i++) {
      const child = children[i] as Element;
      if (child.nodeType === 1 && child.tagName === tag) {
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

  function buildDomSelector(el: Element): string {
    const parts: string[] = [];
    let current: Element | null = el;
    const depthLimit = 6;

    while (current && current.nodeType === 1 && parts.length < depthLimit) {
      const tag = current.tagName.toLowerCase();

      if ((current as HTMLElement).id) {
        parts.unshift(tag + "#" + (current as HTMLElement).id);
        break;
      }

      let classPart = "";
      if (
        (current as HTMLElement).classList &&
        (current as HTMLElement).classList.length > 0
      ) {
        const classes: string[] = [];
        const cl = (current as HTMLElement).classList;
        for (let i = 0; i < cl.length && i < 2; i++) {
          const c = sanitizeCssIdent(cl[i] || "");
          if (c) classes.push(c);
        }
        if (classes.length > 0) {
          classPart = "." + classes.join(".");
        }
      }

      const nth = nthOfType(current);
      parts.unshift(tag + classPart + nth);

      if (tag === "body") {
        break;
      }
      current = current.parentElement;
    }

    return parts.join(" > ");
  }

  function hashString(input: string): string {
    let hash1 = 5381;
    let hash2 = 52711;
    for (let i = 0; i < input.length; i++) {
      const ch = input.charCodeAt(i);
      hash1 = (hash1 * 33) ^ ch;
      hash2 = (hash2 * 33) ^ ch;
    }
    return (Math.abs(hash1 + hash2 * 15619) >>> 0).toString(36);
  }

  function getElementSignature(
    el: Element,
    clickX: number,
    clickY: number
  ): {
    selector: string;
    elementHash: string;
    relX: number | null;
    relY: number | null;
  } {
    const selector = buildDomSelector(el);
    const elementHash = hashString(selector);

    const rect = (el as HTMLElement).getBoundingClientRect();

    const viewportX = clickX - window.scrollX;
    const viewportY = clickY - window.scrollY;

    let relX: number | null = null;
    let relY: number | null = null;
    if (rect.width > 0 && rect.height > 0) {
      relX = (viewportX - rect.left) / rect.width;
      relY = (viewportY - rect.top) / rect.height;

      if (relX < 0) relX = 0;
      if (relX > 1) relX = 1;
      if (relY < 0) relY = 0;
      if (relY > 1) relY = 1;
    }

    return {
      selector,
      elementHash,
      relX,
      relY,
    };
  }

  // ===========================================================================
  // 4. Throttle helper / 쓰로틀
  // ===========================================================================
  function throttle<T extends (...args: any[]) => void>(
    fn: T,
    ms: number
  ): (...args: Parameters<T>) => void {
    let last = 0;
    let timer: number | null = null;
    let pendingArgs: Parameters<T> | null = null;

    function run() {
      if (pendingArgs) {
        fn.apply(null, pendingArgs);
        pendingArgs = null;
        last = Date.now();
      }
      timer = null;
    }

    return function throttled(...args: Parameters<T>) {
      const nowTime = Date.now();
      const diff = nowTime - last;

      if (diff >= ms && !timer) {
        last = nowTime;
        fn.apply(null, args);
      } else {
        pendingArgs = args;
        if (!timer) {
          timer = window.setTimeout(run, Math.max(ms - diff, 0));
        }
      }
    };
  }

  // ===========================================================================
  // 5. BatchQueue
  // ===========================================================================
  interface EventRecord {
    [key: string]: any;
    ts: number;
  }

  class BatchQueue {
    buf: EventRecord[];
    flushTimer: number | null;
    flushInterval: number;
    maxBatch: number;
    endpoint: string;

    constructor(endpoint: string) {
      this.buf = [];
      this.flushTimer = null;
      this.flushInterval = 5000;
      this.maxBatch = 50;
      this.endpoint = endpoint;
    }

    push(ev: EventRecord) {
      this.buf.push(ev);

      if (this.buf.length >= this.maxBatch) {
        this.flush(false);
        return;
      }

      if (this.flushTimer == null) {
        this.flushTimer = window.setTimeout(() => {
          this.flush(false);
        }, this.flushInterval);
      }
    }

    flush(sync: boolean) {
      if (this.buf.length === 0) return;

      const batch = this.buf;
      this.buf = [];

      if (this.flushTimer != null) {
        clearTimeout(this.flushTimer);
        this.flushTimer = null;
      }

      const payload = { events: batch };

      if (sync && navigator.sendBeacon) {
        try {
          const blob = new Blob([JSON.stringify(payload)], {
            type: "application/json",
          });
          navigator.sendBeacon(this.endpoint, blob);
          return;
        } catch {
          // ignore, fallback to fetch
        }
      }

      fetch(this.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        keepalive: !!sync,
        body: JSON.stringify(payload),
      }).catch(() => {});
    }
  }

  // ===========================================================================
  // 6. ApiLogCollector
  // ===========================================================================
  interface CollectorOpts {
    siteId: string;
    ingestUrl: string;
    pageVariant?: string;
    utmSource?: string | null;
    utmCampaign?: string | null;
  }

  class ApiLogCollector {
    opts: CollectorOpts;
    sessionId: string;
    startTime: number;
    destroyed: boolean;
    maxScrollSeen: number;
    q: BatchQueue;

    constructor(opts: CollectorOpts) {
      this.opts = opts;
      this.sessionId = getOrCreateSessionId();
      this.startTime = now();
      this.destroyed = false;
      this.maxScrollSeen = getMaxScrollPct();
      this.q = new BatchQueue(opts.ingestUrl);

      this.installListeners();
      this.emitPageView();
    }

    installListeners() {
      // CLICK LISTENER
      document.addEventListener(
        "click",
        (ev: MouseEvent) => {
          const docEl = document.documentElement;
          const scrollX = window.pageXOffset || docEl.scrollLeft || 0;
          const scrollY = window.pageYOffset || docEl.scrollTop || 0;

          // MouseEvent에는 pageX/pageY, clientX/clientY 전부 있음
          const x = (ev.pageX || (ev.clientX + scrollX) || 0);
          const y = (ev.pageY || (ev.clientY + scrollY) || 0);

          const targetEl = (ev.target as Element) || document.body;
          this.emitClick(targetEl, x, y);
        },
        true // capture
      );

      // SCROLL LISTENER (THROTTLED)
      const onScroll = throttle(() => {
        const pct = getMaxScrollPct();
        if (pct > this.maxScrollSeen) {
          this.maxScrollSeen = pct;
        }
      }, 250);

      window.addEventListener("scroll", onScroll, { passive: true });

      // BEFOREUNLOAD
      window.addEventListener("beforeunload", () => {
        this.emitScrollDepth();
        this.emitDwell();

        this.q.flush(true);
        this.destroyed = true;
      });
    }

    baseTags(eventName: string, elementHash: string | null) {
      return {
        site_id: this.opts.siteId,
        path: normalizePath(location.pathname),
        page_variant: this.opts.pageVariant || "default",
        event_name: eventName,
        element_hash: elementHash || null,
        device_type: detectDeviceType(),
        browser_family: detectBrowserFamily(),
        country_code: null as string | null,
        utm_source: this.opts.utmSource ?? getUtmParam("utm_source"),
        utm_campaign: this.opts.utmCampaign ?? getUtmParam("utm_campaign"),
      };
    }

    baseFields() {
      const vw =
        window.innerWidth || document.documentElement.clientWidth || 0;
      const vh =
        window.innerHeight || document.documentElement.clientHeight || 0;

      return {
        count: 1,
        session_id: this.sessionId,
        user_hash: null as string | null,
        dwell_ms: null as number | null,
        scroll_pct: null as number | null,
        click_x: null as number | null,
        click_y: null as number | null,
        viewport_w: vw,
        viewport_h: vh,
        funnel_step: null as string | null,
        error_flag: null as boolean | null,
        bot_score: null as number | null,
        extra_json: null as string | null,
      };
    }

    pushRecord(partial: Record<string, any>) {
      const rec: EventRecord = Object.assign(
        {
          ts: partial.ts != null ? partial.ts : now(),
        },
        partial
      );
      this.q.push(rec);
    }

    emitPageView() {
      const rec = Object.assign(
        {},
        this.baseTags("page_view", null),
        this.baseFields(),
        {
          dwell_ms: 0,
          scroll_pct: this.maxScrollSeen,
          ts: now(),
        }
      );
      this.pushRecord(rec);
    }

    emitClick(targetEl: Element, absX: number, absY: number) {
      const sig = getElementSignature(targetEl, absX, absY);

      const rec = Object.assign(
        {},
        this.baseTags("click", sig.elementHash),
        this.baseFields(),
        {
          click_x: absX,
          click_y: absY,
          extra_json: JSON.stringify({
            rel_x: sig.relX,
            rel_y: sig.relY,
            selector: sig.selector,
          }),
          ts: now(),
        }
      );

      this.pushRecord(rec);
    }

    emitScrollDepth() {
      const pct = this.maxScrollSeen;

      const rec = Object.assign(
        {},
        this.baseTags("scroll", null),
        this.baseFields(),
        {
          scroll_pct: pct,
          ts: now(),
        }
      );

      this.pushRecord(rec);
    }

    emitDwell() {
      const dur = now() - this.startTime;

      const rec = Object.assign(
        {},
        this.baseTags("page_view_dwell", null),
        this.baseFields(),
        {
          dwell_ms: dur,
          scroll_pct: this.maxScrollSeen,
          ts: now(),
        }
      );

      this.pushRecord(rec);
    }

    markFunnelStep(stepName: string) {
      const rec = Object.assign(
        {},
        this.baseTags("funnel_step", null),
        this.baseFields(),
        {
          funnel_step: stepName,
          ts: now(),
        }
      );
      this.pushRecord(rec);
    }

    markError(info: unknown) {
      const rec = Object.assign(
        {},
        this.baseTags("error", null),
        this.baseFields(),
        {
          error_flag: true,
          extra_json: info
            ? JSON.stringify(info).slice(0, 1024)
            : null,
          ts: now(),
        }
      );
      this.pushRecord(rec);
    }

    flush() {
      this.q.flush(false);
    }
  }

  // ===========================================================================
  // 7. Singleton management / 싱글턴 관리
  // ===========================================================================
  let __apilog_singleton: ApiLogCollector | null = null;

  function initCollector(opts: InitConfig): ApiLogCollector {
    if (__apilog_singleton) return __apilog_singleton;

    __apilog_singleton = new ApiLogCollector({
      siteId: opts.siteId,
      ingestUrl: opts.ingestUrl,
      pageVariant: opts.pageVariant,
      utmSource: opts.utmSource ?? null,
      utmCampaign: opts.utmCampaign ?? null,
    });

    return __apilog_singleton;
  }

  function markFunnelStep(stepName: string): void {
    if (__apilog_singleton) {
      __apilog_singleton.markFunnelStep(stepName);
    }
  }

  function markError(info: unknown): void {
    if (__apilog_singleton) {
      __apilog_singleton.markError(info);
    }
  }

  function flushNow(): void {
    if (__apilog_singleton) {
      __apilog_singleton.flush();
    }
  }

  // ===========================================================================
  // 8. Attach final API onto window.apilog
  // ===========================================================================
  globalApi.init = function (config: InitConfig) {
    initCollector(config);
  };

  globalApi.markFunnelStep = function (stepName: string) {
    markFunnelStep(stepName);
  };

  globalApi.markError = function (info: unknown) {
    markError(info);
  };

  globalApi.flushNow = function () {
    flushNow();
  };

  // embed.js에서 만든 스텁 객체를 실제 구현으로 업그레이드
  win.apilog = globalApi;
})();
