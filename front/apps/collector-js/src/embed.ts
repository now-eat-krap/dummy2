/**
 * apilog embed loader
 * -------------------
 * This script is meant to be built to a single standalone file (embed.js)
 * that users can drop on their site via:
 *
 *    <script src="https://cdn.example.com/apilog/embed.js"
 *            data-site-id="main"
 *            data-ingest-url="https://api.example.com/api/ingest/events"
 *            data-page-variant="release-2025-10-27"
 *            defer async></script>
 *
 * When this runs:
 *  1. It ensures window.apilog exists (creates a stub if needed).
 *  2. It dynamically loads the real collector (apilog.js).
 *  3. Once loaded, it calls apilog.init(...) automatically with config.
 *
 * 이 스크립트는 embed.js로 번들되어 외부 사이트에 한 줄로 붙습니다.
 * 동작 순서:
 *  1. window.apilog가 없으면 임시 스텁(큐 사용 가능)으로 만들어 준다.
 *  2. 실제 수집기(apilog.js)를 동적으로 로드한다.
 *  3. 로드 후, apilog.init(...)을 자동으로 호출해 초기화한다.
 */

(() => {
  // ---- Types / 인터페이스 정의 -------------------------------------------------

  /**
   * Config passed to apilog.init(...)
   * apilog.init(...)에 전달되는 설정 정보
   */
  interface InitConfig {
    siteId: string;            // Project/site identifier  | 어떤 사이트/프로젝트인지 구분하는 ID
    ingestUrl: string;         // Backend ingest endpoint  | 이벤트 수집 서버 주소(FastAPI /api/ingest/events)
    pageVariant?: string;      // Release / A/B label      | 현재 페이지/릴리즈/AB 테스트 버전 라벨(선택)
    utmSource?: string;        // Force UTM source         | UTM 소스 강제 지정(없으면 자동 추출)
    utmCampaign?: string;      // Force UTM campaign       | UTM 캠페인 강제 지정
  }

  /**
   * Minimal shape we expect the real collector to expose on window.
   * 실제 수집 스크립트(apilog.js)가 window.apilog로 제공해야 하는 함수들의 형태
   */
  interface ApilogAPI {
    init: (config: InitConfig) => void;
    markFunnelStep: (stepName: string) => void;
    markError: (info: { message: string; severity?: string }) => void;
    flushNow: () => void;
    __q?: Array<[string, IArguments | ArrayLike<unknown>]>;
  }

  // ---- Utility helpers / 유틸 함수 --------------------------------------------

  /**
   * Get the <script> element that loaded this embed, in a CSP-safe-ish way.
   * 현재 실행 중인 이 embed 스크립트를 로드한 <script> DOM 요소를 가져온다.
   *
   * Why:
   * - document.currentScript works in modern browsers
   * - If it's null (very old/edge cases with async loaders), we fallback
   *   to last <script> in DOM.
   *
   * document.currentScript은 대부분의 브라우저에서 동작.
   * 혹시 null일 경우(아주 드문 async 케이스) 마지막 <script> 태그를 사용.
   */
  function getCurrentScript(): HTMLScriptElement | null {
    const cur = document.currentScript;
    if (cur && cur instanceof HTMLScriptElement) {
      return cur;
    }
    const scripts = document.getElementsByTagName("script");
    return scripts.length ? (scripts[scripts.length - 1] as HTMLScriptElement) : null;
  }

  /**
   * Make/ensure a global stub at window.apilog that queues calls until
   * the real script (apilog.js) loads.
   *
   * 실제 수집 스크립트(apilog.js)가 로드되기 전까지,
   * apilog.* 호출을 큐에 쌓아두는 스텁을 window.apilog에 올린다.
   *
   * This mirrors how GA / Clarity style bootstraps work.
   * GA나 Clarity 같은 추적 스크립트들이 쓰는 패턴과 동일.
   */
  function ensureApilogStub(win: any): ApilogAPI {
    if (win.apilog && typeof win.apilog === "object") {
      // If user already injected us once, reuse it.
      // 이미 apilog가 있다면(중복 embed 방어), 그걸 그대로 사용.
      return win.apilog as ApilogAPI;
    }

    const q: Array<[string, IArguments | ArrayLike<unknown>]> = [];

    const stub: ApilogAPI = {
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

  /**
   * Compute base URL for apilog.js based on this embed.js src.
   * embed.js가 로드된 URL을 기준으로 apilog.js가 같은 디렉토리에 있다고 가정하고
   * 그 경로를 계산한다.
   *
   * ex)
   *   embed.js -> https://cdn.example.com/apilog/embed.js
   *   returns  -> https://cdn.example.com/apilog/apilog.js
   *
   * 만약 경로 구조를 바꾸고 싶으면 여기만 수정하면 된다.
   */
  function getCollectorUrl(embedScriptEl: HTMLScriptElement): string {
    const embedSrc = embedScriptEl.getAttribute("src") || "";
    // strip filename
    // 파일명(embed.js) 떼고 디렉토리 경로만 남긴다.
    const lastSlash = embedSrc.lastIndexOf("/");
    const base = lastSlash >= 0 ? embedSrc.slice(0, lastSlash) : "";
    return base ? `${base}/apilog.js` : "apilog.js";
  }

  /**
   * Extract config from <script data-*> attributes.
   * <script data-*>에 적힌 설정값(site-id, ingest-url 등)을 읽어온다.
   */
  function readInitConfigFromScript(el: HTMLScriptElement): InitConfig {
    // We use getAttribute instead of dataset to also work with dashed names
    // dataset 대신 getAttribute를 쓰면 data-site-id 처럼 하이픈 포함된 것도 안전하게 읽힘.
    const siteId = el.getAttribute("data-site-id") || "";
    const ingestUrl = el.getAttribute("data-ingest-url") || "";
    const pageVariant = el.getAttribute("data-page-variant") || "";

    const utmSource = el.getAttribute("data-utm-source") || "";
    const utmCampaign = el.getAttribute("data-utm-campaign") || "";

    // Basic validation / 최소한의 유효성 체크
    // NOTE(EN): We don't throw, we just fill empty strings. Host page must not break.
    // NOTE(KO): 절대 throw하지 않는다. 호스트 페이지가 깨지면 안 되므로 빈 문자열로 둔다.
    return {
      siteId,
      ingestUrl,
      pageVariant,
      utmSource: utmSource || undefined,
      utmCampaign: utmCampaign || undefined
    };
  }

  /**
   * Dynamically load the real collector script (apilog.js).
   * 실제 수집기(apilog.js)를 동적으로 <script>로 주입한다.
   *
   * - async/defer set for non-blocking load.
   *   async/defer를 통해 DOM 파싱을 막지 않는다.
   *
   * - crossorigin="anonymous" to allow CDNs and avoid noisy console errors.
   *   CDN 캐시 등을 고려해 crossorigin 부여.
   */
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

    s.onload = () => {
      onLoad();
    };
    s.onerror = () => {
      // Swallow errors silently so we never break host page UX.
      // 로드 실패해도 호스트 페이지 UX는 절대 깨지지 않도록 조용히 무시.
      onError();
    };

    document.head.appendChild(s);
  }

  /**
   * After apilog.js is loaded, we need to:
   * 1. Replace the stub with the real implementation (which apilog.js should do itself).
   * 2. Call apilog.init(config).
   * 3. (Optionally) replay any queued calls that happened before load.
   *
   * apilog.js 로드 이후 해야 할 일:
   * 1. stub은 apilog.js가 자기 로직으로 덮어쓴다고 가정.
   * 2. apilog.init(config)를 호출한다.
   * 3. 로드 전에 쌓였던 큐(__q)를 재생한다.
   *
   * NOTE:
   * - apilog.js 최종 번들은 window.apilog를 실제 구현체로 바꾸면서,
   *   내부에서 __q를 읽어 순서대로 drain하도록 설계하는 게 이상적.
   * - 여기서도 방어적으로 한 번 더 drain 시도할 수 있게 해둔다.
   */
  function finalizeInit(
    win: any,
    cfg: InitConfig
  ) {
    try {
      if (win.apilog && typeof win.apilog.init === "function") {
        win.apilog.init(cfg);
      }

      // Optional safety drain:
      // 혹시 apilog.js에서 아직 큐를 안 비웠으면 우리가 한 번 더 시도.
      const maybeQ = win.apilog && win.apilog.__q;
      if (maybeQ && Array.isArray(maybeQ)) {
        for (let i = 0; i < maybeQ.length; i++) {
          const [method, args] = maybeQ[i];
          if (win.apilog && typeof win.apilog[method] === "function") {
            try {
              // eslint-disable-next-line prefer-spread
              win.apilog[method].apply(null, args as any);
            } catch {
              // swallow
            }
          }
        }
        // clear queue after replay
        // 재생 후에는 큐 비워준다.
        win.apilog.__q = [];
      }
    } catch {
      // Never throw to host.
      // 절대 throw하지 말 것. 추적기 하나 때문에 고객 페이지 깨지면 안 됨.
    }
  }

  // ---- Main bootstrap logic / 메인 부트스트랩 로직 -----------------------------

  // Guard for non-browser environments (SSR, tests)
  // SSR(서버사이드 렌더)나 테스트 환경에서 window/document가 없을 수도 있으므로 방어.
  if (typeof window === "undefined" || typeof document === "undefined") {
    // Do nothing on server.
    // 서버 환경에서는 아무것도 하지 않는다.
    return;
  }

  const win = window as any;

  // 1. figure out which <script> tag we are (to read data-* attrs)
  //    지금 실행 중인 embed <script> 태그를 찾는다. (data-* 읽어야 하니까)
  const me = getCurrentScript();
  if (!me) {
    // If we can't locate ourselves, we still try to create a stub
    // and bail quietly. Host page must not crash.
    //
    // 만약 currentScript를 못 찾으면, 그래도 stub은 만든 뒤 조용히 종료.
    ensureApilogStub(win);
    return;
  }

  // 2. read init config from <script data-...>
  //    스크립트 태그의 data- 속성에서 설정값(siteId 등)을 읽는다.
  const initConfig = readInitConfigFromScript(me);

  // 3. ensure stub exists (so page code can already call window.apilog.*)
  //    진짜 수집기 로딩 전에도 window.apilog.*를 호출할 수 있도록 스텁을 만든다.
  const stub = ensureApilogStub(win);

  // 4. build URL for the real collector script (apilog.js)
  //    실제 수집기(apilog.js)의 URL을 만든다.
  const collectorUrl = getCollectorUrl(me);

  // 5. load the real collector script
  //    실제 수집기를 동적으로 로드한다.
  loadCollectorScript(
    collectorUrl,
    () => {
      // onLoad: collector loaded successfully
      // 로드 성공 시: init 호출 + 큐 드레인
      finalizeInit(win, initConfig);
    },
    () => {
      // onError: if apilog.js fails to load, we fail silently.
      // 로드 실패 시: 조용히 포기 (호스트 사이트는 절대 깨지면 안 된다)
    }
  );

  // NOTE:
  // We intentionally DO NOT call init() here yet because apilog.js
  // may not have replaced the stub at this exact tick.
  // finalizeInit() runs after onload.
  //
  // init()를 여기서 바로 부르지 않는 이유:
  // 아직 apilog.js가 스텁을 실제 구현으로 교체하기 전일 수 있어서.
  // onload 이후 finalizeInit()에서 안전하게 처리한다.
})();
