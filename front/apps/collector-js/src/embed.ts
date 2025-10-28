(function () {
  // 방어: 브라우저에서만 실행
  if (typeof window === "undefined" || typeof document === "undefined") {
    return;
  }

  // 한 번만 실행되도록 가드
  if ((window as any).__APILOG_EMBED_BOOTED__) {
    return;
  }
  (window as any).__APILOG_EMBED_BOOTED__ = true;

  // ---- 타입 선언들 ----

  interface InitConfig {
    siteId: string;
    ingestUrl: string;
    pageVariant?: string;
    utmSource?: string;
    utmCampaign?: string;
  }

  interface ApilogStub {
    __q: Array<[string, IArguments | any[]]>;
    init: (...args: any[]) => void;
    markFunnelStep: (...args: any[]) => void;
    markError: (...args: any[]) => void;
    flushNow: (...args: any[]) => void;
  }

  interface ApilogFinal extends ApilogStub {
    // 실제 bootstrap.ts(collector.iife.js)에서 주입되는 최종 구현
    // init(cfg: InitConfig): void; ...
  }

  // ---- 유틸 함수들 ----

  function getCurrentScript(): HTMLScriptElement | null {
    // document.currentScript가 제일 정확함. 없다면 마지막 <script> 추정
    const cur = document.currentScript as HTMLScriptElement | null;
    if (cur && cur.tagName && cur.tagName.toLowerCase() === "script") {
      return cur;
    }
    const scripts = document.getElementsByTagName("script");
    return scripts.length
      ? (scripts[scripts.length - 1] as HTMLScriptElement)
      : null;
  }

  // 아직 collector.iife.js가 로드되기 전까지 쓸 스텁을 window.apilog에 심는다.
  function ensureApilogStub(win: Window & { apilog?: ApilogStub }): ApilogStub {
    if (win.apilog && typeof win.apilog === "object") {
      return win.apilog;
    }

    const q: Array<[string, IArguments | any[]]> = [];

    const stub: ApilogStub = {
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
      __q: q,
    };

    win.apilog = stub;
    return stub;
  }

  // 현재 embed.js의 src 기준으로 collector 번들 URL을 만든다.
  // 기존 코드는 apilog.js를 불렀는데
  // 우리는 빌드 산출물을 collector.iife.js로 둘 거라 그걸 가리키게 한다.
  function getCollectorUrl(embedScriptEl: HTMLScriptElement): string {
    const embedSrc = embedScriptEl.getAttribute("src") || "";
    const lastSlash = embedSrc.lastIndexOf("/");
    const base = lastSlash >= 0 ? embedSrc.slice(0, lastSlash) : "";
    // dist 폴더 기준 nginx에서 /apilog/collector.iife.js 로 서비스한다고 가정
    // 즉 embed.js가 /apilog/embed.js 라면 collector도 같은 디렉토리에 있다고 보면 됨
    return base ? base + "/collector.iife.js" : "collector.iife.js";
  }

  function readInitConfigFromScript(el: HTMLScriptElement): InitConfig {
    return {
      siteId: el.getAttribute("data-site-id") || "",
      ingestUrl: el.getAttribute("data-ingest-url") || "",
      pageVariant: el.getAttribute("data-page-variant") || "",
      utmSource: el.getAttribute("data-utm-source") || "",
      utmCampaign: el.getAttribute("data-utm-campaign") || "",
    };
  }

  // collector.iife.js를 동적으로 로드한다.
  function loadCollectorScript(
    url: string,
    onLoad: () => void,
    onError: () => void
  ) {
    const s = document.createElement("script");
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

  // collector.iife.js 로드가 끝난 다음에:
  // 1) window.apilog.init(cfg) 호출
  // 2) 큐(__q)에 쌓인 호출들 재생
  function finalizeInit(win: Window & { apilog?: ApilogFinal }, cfg: InitConfig) {
    try {
      if (win.apilog && typeof win.apilog.init === "function") {
        win.apilog.init(cfg);
      }

      const maybeQ = win.apilog && (win.apilog as any).__q;
      if (maybeQ && Array.isArray(maybeQ)) {
        for (let i = 0; i < maybeQ.length; i++) {
          const pair = maybeQ[i];
          const method = pair[0];
          const argsLike = pair[1];

          if (
            win.apilog &&
            typeof (win.apilog as any)[method] === "function"
          ) {
            try {
              // IArguments -> 진짜 배열로 변환해서 호출
              const arrArgs = Array.prototype.slice.call(argsLike);
              (win.apilog as any)[method].apply(null, arrArgs);
            } catch (err) {
              // swallow
            }
          }
        }
        (win.apilog as any).__q = [];
      }
    } catch (e) {
      // swallow
    }
  }

  // ---- main flow ----

  const win = window as Window & { apilog?: ApilogStub };
  const me = getCurrentScript();

  // 만약 script 태그를 못 찾으면 (이상한 환경) 그냥 stub만 깔고 종료
  if (!me) {
    ensureApilogStub(win);
    return;
  }

  // 현재 embed.js script 태그에서 data-* 읽어 config 만든다
  const initConfig = readInitConfigFromScript(me);

  // 아직 collector.iife.js 안 로드된 상태라 stub 먼저 주입
  ensureApilogStub(win);

  // collector.iife.js 경로 계산
  const collectorUrl = getCollectorUrl(me);

  // collector.iife.js 로드, 완료 후 init + 큐 재생
  loadCollectorScript(
    collectorUrl,
    function onOk() {
      finalizeInit(win as any, initConfig);
    },
    function onErr() {
      // fail silently. 분석 스니펫은 사이트를 깨면 안 된다.
    }
  );
})();
