// front/apps/collector-js/src/index.ts

/* apilog browser collector
 *
 * Responsibilities / 역할:
 * 1. Attach lightweight client-side tracking to any webpage.
 *    어떤 웹페이지에도 가볍게 붙는 클라이언트 트래킹 코드.
 *
 * 2. Capture behavioral events like:
 *    - page_view (when user loads a page)
 *    - click (when user clicks somewhere)
 *    - scroll depth (how far they scrolled)
 *    - dwell time (how long they stayed)
 *    브라우저에서 발생하는 사용자 행동 이벤트를 수집한다.
 *    - 페이지뷰 (페이지 로드 시점)
 *    - 클릭 지점
 *    - 스크롤 도달 깊이
 *    - 체류 시간
 *
 * 3. Convert them into a normalized analytics record that matches
 *    our InfluxDB "events" measurement schema.
 *    이 이벤트들을 InfluxDB `events` measurement 스키마 형태에 맞춰 정규화한다.
 *
 * 4. Batch and upload periodically to our backend
 *    (/api/ingest/events) rather than sending per-event.
 *    이벤트마다 보내지 않고 일정 주기로 묶어서(/api/ingest/events) 업로드한다.
 *
 * Privacy / 프라이버시:
 * - We NEVER capture raw innerText/innerHTML or form values.
 *   DOM 텍스트나 입력값 같은 민감한 실제 내용을 절대 수집하지 않는다.
 * - Instead we capture only structure (element signature, positions).
 *   대신 요소 구조 정보(셀렉터 해시, 좌표)만 수집한다.
 */

type CollectorOptions = {
  siteId: string;              // Which site/app this page belongs to. 어떤 사이트/앱인지 식별자.
  ingestUrl: string;           // API endpoint to POST batched events to. 배치 업로드할 API 엔드포인트 URL.
  pageVariant?: string;        // Page layout/experiment version. 페이지 레이아웃/배포 버전/실험군 식별자.
  utmSource?: string;          // Optional override for utm_source. utm_source 수동 지정 (선택).
  utmCampaign?: string;        // Optional override for utm_campaign. utm_campaign 수동 지정 (선택).
};

// This is the shape of a single logical analytics event before it's written
// into InfluxDB. Each record corresponds to one row write to the `events`
// measurement on the backend.
// InfluxDB로 적재하기 전, 이벤트 한 건의 논리적 형태.
// 백엔드에서 이 레코드 하나가 `events` measurement의 한 줄(포인트)이 된다.
type EventRecord = {
  // -----------------------
  // TAG FIELDS (indexed)  태그 (인덱스 되는 차원 값)
  // -----------------------

  site_id: string;            // Which product/site generated this event? 어떤 서비스/사이트인지.
  path: string;               // Normalized path (no query). 쿼리스트링 제거된 페이지 경로.
  page_variant: string;       // Variant / release ID / A/B bucket. A/B 버전, 릴리즈 식별자.
  event_name: string;         // "page_view", "click", etc. 이벤트 종류.
  element_hash: string | null;// Stable hash of the DOM element. DOM 요소를 대표하는 해시(히트맵 그룹용).
  device_type: string;        // "mobile" / "desktop" ... 디바이스 유형.
  browser_family: string;     // "Chrome", "Safari", ... 브라우저 계열.
  country_code: string | null;// ISO country code (can be filled server-side). 국가 코드(서버에서 IP기반으로 채워줄 수도 있음).
  utm_source: string | null;  // Marketing source. 마케팅 유입 소스.
  utm_campaign: string | null;// Campaign label. 캠페인 이름.

  // -----------------------
  // FIELD FIELDS (values)  필드 (카디널리티 높은 값 / 수치들)
  // -----------------------

  count: number;              // Always 1. We aggregate using SUM(count). 항상 1. sum(count)로 집계.
  session_id: string;         // Browser session identifier. 브라우저 세션 식별자(카디널리티 높음 → tag 금지).
  user_hash: string | null;   // (Optional) anonymized user ID. 익명 유저 식별용 해시(옵션).

  dwell_ms: number | null;    // How long user stayed (ms). 체류 시간(ms).
  scroll_pct: number | null;  // Max scroll depth (0~1). 이 페이지에서 도달한 최대 스크롤 비율(0~1).
  click_x: number | null;     // Click X (page coords). 클릭 지점 X 좌표(문서 기준 px).
  click_y: number | null;     // Click Y (page coords). 클릭 지점 Y 좌표(문서 기준 px).

  viewport_w: number;         // Viewport width at event time. 이벤트 순간의 뷰포트 가로(px).
  viewport_h: number;         // Viewport height at event time. 이벤트 순간의 뷰포트 세로(px).

  funnel_step: string | null; // Business funnel step label. 퍼널 단계 라벨(예: checkout_step2).
  error_flag: boolean | null; // Was this event associated with an error state? 에러/이상 상태 여부.
  bot_score: number | null;   // Bot/suspicious score (optional). 봇 의심 점수(옵션).
  extra_json: string | null;  // Arbitrary experimental metadata. 실험/추가정보를 JSON으로 담는 필드.

  // -----------------------
  // TIMESTAMP  타임스탬프
  // -----------------------

  ts: number;                 // Client-side timestamp (ms epoch). 클라이언트 기준 발생 시각 (epoch ms).
};

// ---------------------------------------------------------------------------
// Time helpers / 시간 관련 유틸
// ---------------------------------------------------------------------------

function now(): number {
  // Returns current time in ms since Unix epoch.
  // 현재 시간을 epoch ms 단위로 반환.
  return Date.now();
}

// ---------------------------------------------------------------------------
// ID / Session helpers / 세션 & 식별자 유틸
// ---------------------------------------------------------------------------

function uuid(): string {
  // Very small random-ish ID generator.
  // 가벼운 랜덤 ID 생성기 (충분히 세션 식별자로 사용 가능).
  return (
    Math.random().toString(16).slice(2) +
    Math.random().toString(16).slice(2) +
    Math.random().toString(16).slice(2)
  ).slice(0, 32);
}

function getOrCreateSessionId(): string {
  // We store a session ID in sessionStorage, so it resets per tab "lifetime".
  // sessionStorage에 세션ID를 넣어서 탭 생명주기 동안 유지.
  // If sessionStorage is blocked (e.g. privacy mode), fallback to in-memory.
  // 만약 sessionStorage 접근 불가하면 window 전역 메모리에 저장한다.
  try {
    const KEY = "_apilog_session";
    const existing = sessionStorage.getItem(KEY);
    if (existing) return existing;
    const fresh = uuid();
    sessionStorage.setItem(KEY, fresh);
    return fresh;
  } catch {
    // sessionStorage may be inaccessible due to browser privacy settings.
    // 어떤 브라우저 환경에서는 sessionStorage 자체가 막혀 있을 수 있다.
    if (!(window as any).__apilog_sess) {
      (window as any).__apilog_sess = uuid();
    }
    return (window as any).__apilog_sess;
  }
}

// ---------------------------------------------------------------------------
// Environment detection / 환경 감지 (디바이스/브라우저 등)
// ---------------------------------------------------------------------------

function detectDeviceType(): string {
  // Very simple mobile/desktop detector by UA sniffing.
  // 간단한 UA 기반 모바일/데스크탑 판별 (완벽하지 않아도 MVP용으론 충분).
  const ua = navigator.userAgent.toLowerCase();
  if (/mobi|android|iphone|ipad/.test(ua)) return "mobile";
  return "desktop";
}

function detectBrowserFamily(): string {
  // Group browsers into broad "families" for analytics dimension.
  // 브라우저를 대표적인 계열로 뭉뚱그려서 분석용 차원으로 쓸 값.
  const ua = navigator.userAgent;
  if (ua.includes("Chrome")) return "Chrome";
  if (ua.includes("Safari")) return "Safari";
  if (ua.includes("Firefox")) return "Firefox";
  if (ua.includes("Edge")) return "Edge";
  return "Other";
}

// ---------------------------------------------------------------------------
// Scroll depth calculation / 스크롤 도달 깊이 계산
// ---------------------------------------------------------------------------

function getMaxScrollPct(): number {
  // Calculate how far (in % of total page height) the user has seen.
  // 유저가 페이지의 어느 지점까지 봤는지 전체 높이 대비 비율을 계산.
  const doc = document.documentElement;
  const body = document.body;

  // Current scrollTop (px from top).
  // 현재 스크롤 위치(px).
  const scrollTop =
    window.pageYOffset || doc.scrollTop || body.scrollTop || 0;

  // Viewport height (visible window height in px).
  // 현재 화면에 보이는 높이(px).
  const viewportH = window.innerHeight || doc.clientHeight;

  // Full document height.
  // 문서 전체 높이(px). (여러 속성 중 최대)
  const fullH = Math.max(
    body.scrollHeight,
    body.offsetHeight,
    doc.clientHeight,
    doc.scrollHeight,
    doc.offsetHeight
  );

  // "maxSeen" = bottom edge of viewport in page coordinates.
  // maxSeen은 현재 화면의 바닥선이 문서 전체 기준으로 어디까지 내려갔는지(px).
  const maxSeen = scrollTop + viewportH;

  if (fullH <= 0) return 0;

  let pct = maxSeen / fullH;
  if (pct > 1) pct = 1;
  return pct;
}

// ---------------------------------------------------------------------------
// DOM element signature / DOM 요소 시그니처
// ---------------------------------------------------------------------------
// We do NOT send full innerText or full DOM, for privacy + cardinality reasons.
// Instead, we create a “selector-ish” path and hash it.
// 개인정보/카디널리티 문제 때문에 DOM 텍스트 전체를 보내지 않는다.
// 대신 안정적인 셀렉터 비슷한 경로를 만들고 그걸 해시한다.

function buildDomSelector(el: Element): string {
  /* Build a short-ish CSS-like path from the element up to <body>.
   * 현재 요소에서 시작해서 body까지 거슬러 올라가며
   * 태그명, 제한된 클래스명, nth-of-type 정보를 조합한 경로를 만든다.
   *
   * We explicitly AVOID innerText/PII.
   * 민감한 텍스트는 절대 포함하지 않는다.
   */
  const parts: string[] = [];
  let current: Element | null = el;

  // limit depth to avoid super-long selectors
  // 너무 깊은 DOM까지 타지 않도록 depth 제한(성능+프라이버시)
  while (current && current.nodeType === 1 && parts.length < 6) {
    const tag = current.tagName.toLowerCase();

    // If element has an ID, that's usually the strongest stable hook.
    // id가 있으면 그걸로 충분히 고유할 가능성이 높으므로 바로 사용.
    if (current.id) {
      parts.unshift(`${tag}#${current.id}`);
      break;
    }

    // include up to 2 class names (sanitized), to improve uniqueness
    // 상위 2개의 class만 포함 (너무 많은 class는 카디널리티 ↑)
    let classPart = "";
    if (current.classList && current.classList.length > 0) {
      const classes = Array.from(current.classList)
        .slice(0, 2)
        .map((c) => sanitizeCssIdent(c))
        .filter(Boolean);
      if (classes.length > 0) {
        classPart = "." + classes.join(".");
      }
    }

    // nth-of-type to disambiguate siblings with same tagName.
    // 같은 태그가 반복되는 형제들 사이에서 구분하기 위해 nth-of-type 사용.
    const nth = nthOfType(current);

    parts.unshift(`${tag}${classPart}${nth}`);

    // Stop once we hit <body> (don't go all the way to <html>, usually enough).
    // body까지 올라오면 충분하므로 중단.
    if (current.tagName.toLowerCase() === "body") break;

    current = current.parentElement;
  }

  return parts.join(" > ");
}

function sanitizeCssIdent(s: string): string {
  // Replace characters that are not safe for a CSS-like token.
  // CSS 셀렉터에 쓰기 애매한 문자들은 '_'로 치환해서 안정화.
  return s.replace(/[^a-zA-Z0-9\-_]/g, "_");
}

function nthOfType(el: Element): string {
  // Return :nth-of-type(N) for this element within its parent,
  // but only if there are multiple siblings of same tag.
  // 부모 안에서 같은 태그가 여러개일 때만 :nth-of-type(N)을 붙여준다.
  if (!el.parentNode) return "";
  const tag = el.tagName;
  let index = 0;
  let count = 0;

  for (const child of Array.from(el.parentNode.childNodes)) {
    if (child.nodeType === 1 && (child as Element).tagName === tag) {
      count++;
      if (child === el) {
        index = count;
        break;
      }
    }
  }

  // if only one sibling of that tag, no need to add nth-of-type
  // 유일한 태그면 nth-of-type을 굳이 붙이지 않는다.
  if (index === 0 || count === 1) return "";
  return `:nth-of-type(${index})`;
}

function hashString(input: string): string {
  /* Tiny custom hash → short stable string.
   * 짧은 해시 생성기.
   *
   * We don't need crypto-grade; just need stable bucketing for heatmap grouping.
   * 암호학적으로 강할 필요는 없고, 히트맵 그룹핑에만 쓰면 된다.
   */
  let hash1 = 5381;
  let hash2 = 52711;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    hash1 = (hash1 * 33) ^ ch;
    hash2 = (hash2 * 33) ^ ch;
  }
  const h = (Math.abs(hash1 + hash2 * 15619) >>> 0).toString(36);
  return h;
}

function getElementSignature(el: Element, clickX: number, clickY: number) {
  /* Build metadata for a clicked element:
   * - selector (human-ish description of node position)
   * - elementHash (hashed selector, used as tag `element_hash`)
   * - relX / relY (where inside the element the click happened, 0~1)
   *
   * 클릭된 요소에 대한 시그니처 정보를 만든다:
   * - selector: 사람 친화적인 DOM 경로 표현
   * - elementHash: selector를 해시한 안정 ID (element_hash 태그로 사용)
   * - relX / relY: 요소 내부에서의 상대 클릭 위치(0~1)
   *
   * NOTE:
   * We will NOT send innerText or attribute values like emails, etc.
   * 민감 정보(텍스트, 이메일 등)는 절대 포함하지 않는다.
   */

  const selector = buildDomSelector(el);
  const elementHash = hashString(selector);

  // Get element bounding box for relative click location.
  // 요소의 경계박스를 이용해 상대 클릭 좌표를 계산한다.
  const rect = el.getBoundingClientRect();

  // Click position relative to viewport.
  // 뷰포트 기준에서의 클릭 좌표(px).
  const viewportX = clickX - window.scrollX;
  const viewportY = clickY - window.scrollY;

  // Compute percentage inside the element bounds.
  // 요소 내부에서의 상대 위치 (0~1 범위로 정규화).
  let relX: number | null = null;
  let relY: number | null = null;
  if (rect.width > 0 && rect.height > 0) {
    relX = (viewportX - rect.left) / rect.width;
    relY = (viewportY - rect.top) / rect.height;
    // clamp to [0,1]
    // 0~1 범위로 보정.
    relX = Math.min(Math.max(relX, 0), 1);
    relY = Math.min(Math.max(relY, 0), 1);
  }

  return {
    selector,
    elementHash,
    relX,
    relY,
  };
}

// ---------------------------------------------------------------------------
// Throttle helper / 쓰로틀 유틸
// ---------------------------------------------------------------------------

function throttle<T extends (...args: any[]) => any>(fn: T, ms: number): T {
  /* Basic throttle: ensures `fn` isn't called more than once within `ms`,
   * but guarantees we run with the latest args after the delay.
   *
   * 기본 쓰로틀: ms 간격보다 자주 호출 안 되게 막되,
   * 마지막 호출 인자를 잃지 않게 한다.
   */
  let last = 0;
  let timer: number | null = null;
  let pendingArgs: any[] | null = null;

  function run() {
    if (pendingArgs) {
      fn.apply(null, pendingArgs);
      pendingArgs = null;
      last = Date.now();
    }
    timer = null;
  }

  return function (...args: any[]) {
    const now = Date.now();
    const diff = now - last;

    if (diff >= ms && !timer) {
      // It's been long enough; call immediately.
      // 충분히 시간이 지났다면 즉시 실행.
      last = now;
      fn.apply(null, args);
    } else {
      // Too soon: save args, schedule.
      // 아직 ms 안 지났으면 나중에 실행되도록 예약.
      pendingArgs = args;
      if (!timer) {
        timer = window.setTimeout(run, ms - diff);
      }
    }
  } as T;
}

// ---------------------------------------------------------------------------
// Batch queue + upload / 배치 큐 & 업로드 로직
// ---------------------------------------------------------------------------

class BatchQueue {
  private buf: EventRecord[] = [];
  private flushTimer: number | null = null;

  // How often we push data to backend in normal operation.
  // 평소 업로드 주기(ms).
  private readonly flushInterval = 5000; // 5 seconds / 5초마다 전송 시도

  // If buffer grows beyond this, we flush immediately to avoid memory blow-up.
  // 버퍼가 이 크기를 넘으면 메모리 폭증 막기 위해 바로 전송.
  private readonly maxBatch = 50;

  private readonly endpoint: string;

  constructor(endpoint: string) {
    this.endpoint = endpoint;
  }

  push(ev: EventRecord) {
    // Add event to buffer.
    // 이벤트를 버퍼에 쌓는다.
    this.buf.push(ev);

    // If we already have a lot, flush immediately.
    // 한 번에 너무 많이 쌓이면 즉시 전송.
    if (this.buf.length >= this.maxBatch) {
      this.flush();
      return;
    }

    // Otherwise, ensure a timer exists that will flush eventually.
    // 그렇지 않다면 타이머를 설정해서 일정 주기 후 전송되도록 한다.
    if (this.flushTimer == null) {
      this.flushTimer = window.setTimeout(() => {
        this.flush();
      }, this.flushInterval);
    }
  }

  flush(sync = false) {
    // Send all buffered events to backend, then clear buffer.
    // 버퍼에 쌓인 이벤트를 한 번에 전송하고 비운다.

    if (this.buf.length === 0) return;

    const batch = this.buf;
    this.buf = [];

    // clear any scheduled flush timer
    // 예약된 타이머도 비운다 (중복 전송 방지).
    if (this.flushTimer != null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    const payload = {
      events: batch,
    };

    // If sync=true, we're probably in `beforeunload`.
    // Use sendBeacon if available to avoid dropping data.
    //
    // sync=true인 경우 대개 페이지 떠나기 직전(beforeunload) 시나리오.
    // 지원된다면 navigator.sendBeacon으로 최대한 안전하게 전송.
    if (sync && navigator.sendBeacon) {
      try {
        const blob = new Blob([JSON.stringify(payload)], {
          type: "application/json",
        });
        navigator.sendBeacon(this.endpoint, blob);
        return;
      } catch {
        // If sendBeacon fails, we'll fall back to fetch with keepalive below.
        // sendBeacon이 실패하면 아래 fetch keepalive 사용.
      }
    }

    // Fire-and-forget POST.
    // 실패해도 재시도 안 함 (클라이언트는 최대한 조용히 있어야 하므로).
    //
    // keepalive: true lets the request try to finish during unload.
    // keepalive: true 옵션은 탭이 닫히는 순간에도 전송을 "시도"하게 해준다.
    fetch(this.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      keepalive: sync, // try to send even if page is closing / 페이지 닫힐 때도 시도
      body: JSON.stringify(payload),
    }).catch(() => {
      // We intentionally swallow errors: analytics should never break the app.
      // 에러는 콘솔에 찍지 않고 무시한다. 분석 로직 때문에 앱이 깨지면 안 된다.
    });
  }
}

// ---------------------------------------------------------------------------
// Collector main class / 메인 수집기 클래스
// ---------------------------------------------------------------------------

class ApiLogCollector {
  private opts: CollectorOptions;
  private sessionId: string;
  private startTime: number;    // page load timestamp. 페이지 시작 시각.
  private destroyed = false;    // whether we've torn down. 이미 unload됐는지 여부.
  private maxScrollSeen = 0;    // max scroll depth observed so far. 지금까지 본 최대 스크롤 도달 비율.
  private q: BatchQueue;        // batching queue. 배치 전송 큐.

  constructor(opts: CollectorOptions) {
    this.opts = opts;
    this.sessionId = getOrCreateSessionId(); // stable within this tab session / 현재 탭에서 유지될 세션 ID
    this.startTime = now();
    this.q = new BatchQueue(opts.ingestUrl);

    // initialize scroll depth baseline
    // 초기 스크롤 깊이 (대개 0 근처지만 혹시 상단 아닌 위치에서 열릴 수도 있으니 계산)
    this.maxScrollSeen = getMaxScrollPct();

    this.installListeners();
    this.emitPageView(); // record initial page_view event on load / 로드시 page_view 기록
  }

  private installListeners() {
    // CLICK LISTENER
    // 클릭 이벤트 리스너
    document.addEventListener(
      "click",
      (ev) => {
        // We'll capture click coordinates in page space (absolute scroll).
        // 클릭 좌표를 페이지 전체 기준 좌표(px)로 계산한다.
        const docEl = document.documentElement;
        const scrollX = window.pageXOffset || docEl.scrollLeft;
        const scrollY = window.pageYOffset || docEl.scrollTop;

        let x = 0;
        let y = 0;
        if ("pageX" in ev && "pageY" in ev) {
          // MouseEvent.pageX/Y is already "page coords"
          // pageX/pageY는 이미 문서 전체 좌표.
          x = (ev as MouseEvent).pageX ?? 0;
          y = (ev as MouseEvent).pageY ?? 0;
        } else if ("clientX" in ev && "clientY" in ev) {
          // Fallback: client coords + scroll offset
          // 대체경로: clientX/Y에 현재 스크롤 보정치 더함.
          x = ((ev as MouseEvent).clientX ?? 0) + scrollX;
          y = ((ev as MouseEvent).clientY ?? 0) + scrollY;
        }

        const targetEl = (ev.target as Element) || document.body;
        this.emitClick(targetEl, x, y);
      },
      true // capture phase: try to get original target early / 캡처 단계에서 걸어 원본 타깃 최대한 보존
    );

    // SCROLL LISTENER (THROTTLED)
    // 스크롤 이벤트 (쓰로틀 적용)
    const onScroll = throttle(() => {
      const pct = getMaxScrollPct();
      if (pct > this.maxScrollSeen) {
        this.maxScrollSeen = pct;
      }
    }, 250);
    window.addEventListener("scroll", onScroll, { passive: true });

    // BEFOREUNLOAD HANDLER
    // 페이지 떠나기 직전 처리:
    // - 최종 스크롤 깊이 전송
    // - 최종 체류 시간 전송
    // - 즉시 배치 flush (sendBeacon / keepalive)
    window.addEventListener("beforeunload", () => {
      this.emitScrollDepth(); // final scroll depth / 마지막 스크롤깊이
      this.emitDwell();       // final dwell time / 마지막 체류시간

      this.q.flush(true);     // sync flush, try sendBeacon / 즉시 flush (sendBeacon 시도)
      this.destroyed = true;
    });
  }

  // -----------------------------------------------------------------------
  // Emitters (send logical event records into the queue)
  // 이벤트 생성기 (논리 이벤트를 큐에 push)
  // -----------------------------------------------------------------------

  private baseTags(
    eventName: string,
    elementHash: string | null
  ): Pick<
    EventRecord,
    | "site_id"
    | "path"
    | "page_variant"
    | "event_name"
    | "element_hash"
    | "device_type"
    | "browser_family"
    | "country_code"
    | "utm_source"
    | "utm_campaign"
  > {
    /* This builds the tag portion (low-cardinality dimensions).
     * 이 함수는 tag 값(낮은 카디널리티 차원값)을 만든다.
     *
     * - site_id, path, page_variant: tells us "which page / which version"
     *   site_id / path / page_variant: 어느 페이지(어느 릴리즈)인지.
     *
     * - event_name: page_view / click / scroll ...
     *   event_name: 이벤트 종류.
     *
     * - element_hash: stable ID of the clicked element, for heatmaps.
     *   element_hash: 히트맵에서 요소별로 묶기 위한 안정적인 해시.
     *
     * - utm_source / utm_campaign: marketing attribution.
     *   마케팅 유입 분석을 위한 UTM 값.
     */

    return {
      site_id: this.opts.siteId,
      path: normalizePath(location.pathname),
      page_variant: this.opts.pageVariant || "default",
      event_name: eventName,
      element_hash: elementHash,
      device_type: detectDeviceType(),
      browser_family: detectBrowserFamily(),
      country_code: null, // We'll often enrich this server-side using IP geo.
                          // 국가 정보는 서버(IP 기반)에서 넣도록 비워둘 수 있다.
      utm_source: this.opts.utmSource || getUtmParam("utm_source"),
      utm_campaign: this.opts.utmCampaign || getUtmParam("utm_campaign"),
    };
  }

  private baseFields(): Pick<
    EventRecord,
    | "count"
    | "session_id"
    | "user_hash"
    | "dwell_ms"
    | "scroll_pct"
    | "click_x"
    | "click_y"
    | "viewport_w"
    | "viewport_h"
    | "funnel_step"
    | "error_flag"
    | "bot_score"
    | "extra_json"
  > {
    /* This builds the field portion:
     *  high-cardinality identifiers (session_id),
     *  numeric metrics (dwell_ms, scroll_pct),
     *  runtime context (viewport size),
     *  plus optional business info (funnel_step).
     *
     * 이 함수는 Influx field들 (카디널리티 높은 값과 수치들)을 만든다:
     *  - session_id: 세션 식별자 (카디널리티 ↑ → 절대 tag로 두지 말기)
     *  - dwell_ms, scroll_pct: 행동 지표
     *  - viewport_w/h: 화면 상태
     *  - funnel_step: 퍼널 단계 같은 비즈니스 라벨
     */

    const vw = window.innerWidth || document.documentElement.clientWidth;
    const vh = window.innerHeight || document.documentElement.clientHeight;

    return {
      count: 1,
      session_id: this.sessionId,
      user_hash: null,      // You can inject an anon user ID later if app has login.
                            // 앱에 로그인 개념이 있으면 나중에 익명 유저ID를 넣을 수 있다.
      dwell_ms: null,
      scroll_pct: null,
      click_x: null,
      click_y: null,
      viewport_w: vw,
      viewport_h: vh,
      funnel_step: null,
      error_flag: null,
      bot_score: null,
      extra_json: null,
    };
  }

  private pushRecord(r: Partial<EventRecord>) {
    // Normalize timestamp. 타임스탬프 보정(없으면 now()).
    const full = {
      ...r,
      ts: r.ts ?? now(),
    } as EventRecord;

    // Actually enqueue for batch upload.
    // 실제로 배치 큐에 적재한다.
    this.q.push(full);
  }

  private emitPageView() {
    /* Fire once on page load.
     * 페이지 로드시 한 번 전송하는 page_view 이벤트.
     *
     * We also include the initial scroll_pct (often ~0), so dashboards
     * can see immediate above-the-fold visibility stats.
     *
     * 초기 scroll_pct도 같이 넣어서 "페이지 진입 시점에 이미 어느 정도
     * 스크롤된 상태였는가?" 같은 분석 가능.
     */
    const rec: EventRecord = {
      ...this.baseTags("page_view", null),
      ...this.baseFields(),
      dwell_ms: 0,
      scroll_pct: this.maxScrollSeen,
      ts: now(),
    };
    this.pushRecord(rec);
  }

  private emitClick(targetEl: Element, absX: number, absY: number) {
    /* Capture click event.
     * 클릭 이벤트 기록.
     *
     * We compute:
     *  - element signature (elementHash + selector)
     *  - click coordinates in page space
     *  - relative click position inside the element (rel_x / rel_y)
     *
     * 아래 정보를 수집:
     *  - 요소 시그니처(elementHash + selector)
     *  - 페이지 전체 기준 클릭 좌표
     *  - 요소 내부 기준 상대 좌표(rel_x / rel_y)
     *
     * NOTE:
     * We store `selector` + rel_x/rel_y inside extra_json instead of tags,
     * to avoid exploding tag cardinality. elementHash alone becomes the tag.
     *
     * selector, rel_x, rel_y는 tag로 올리면 카디널리티가 폭발하므로
     * extra_json 안에 string으로만 넣고,
     * 태그로는 hash만(element_hash) 넣는다.
     */

    const sig = getElementSignature(targetEl, absX, absY);

    const rec: EventRecord = {
      ...this.baseTags("click", sig.elementHash),
      ...this.baseFields(),
      click_x: absX,
      click_y: absY,
      extra_json: JSON.stringify({
        rel_x: sig.relX,
        rel_y: sig.relY,
        selector: sig.selector, // DOM selector-like path for debugging & heatmap overlay
                                // 디버깅/히트맵 오버레이용 경로 표현 (민감 텍스트 없음)
      }),
      ts: now(),
    };

    this.pushRecord(rec);
  }

  private emitScrollDepth() {
    /* Send final/max scroll depth (0~1) before unload.
     * 언로드 직전에 지금까지 관측된 최대 스크롤 도달 비율을 전송한다.
     *
     * Dashboards can aggregate AVG/MAX(scroll_pct) by path/page_variant
     * to generate scroll maps.
     *
     * path/page_variant 별로 AVG/MAX(scroll_pct)를 보면
     * 스크롤맵/리드 뎁스 분석이 가능해진다.
     */
    const pct = this.maxScrollSeen;
    const rec: EventRecord = {
      ...this.baseTags("scroll", null),
      ...this.baseFields(),
      scroll_pct: pct,
      ts: now(),
    };
    this.pushRecord(rec);
  }

  private emitDwell() {
    /* Send dwell time in ms = how long the user stayed on this page.
     * 현재 페이지에서 머문 총 시간(ms)을 전송한다.
     *
     * This gets emitted on unload to capture total session-on-page.
     * 언로드 시점에 보내서 "이 페이지에 얼마나 머물렀나"를 알 수 있다.
     */
    const dur = now() - this.startTime;
    const rec: EventRecord = {
      ...this.baseTags("page_view_dwell", null),
      ...this.baseFields(),
      dwell_ms: dur,
      scroll_pct: this.maxScrollSeen,
      ts: now(),
    };
    this.pushRecord(rec);
  }

  // -----------------------------------------------------------------------
  // Public API for custom business signals
  // 사용자/비즈니스용 커스텀 시그널 공개 API
  // -----------------------------------------------------------------------

  public markFunnelStep(stepName: string) {
    /* Record a funnel_step event:
     * signup_step1, checkout_shipping, checkout_payment, etc.
     *
     * 특정 비즈니스 퍼널 단계를 마킹할 때 사용:
     *  - signup_step1
     *  - checkout_shipping
     *  - checkout_payment
     * 등
     */
    const rec: EventRecord = {
      ...this.baseTags("funnel_step", null),
      ...this.baseFields(),
      funnel_step: stepName,
      ts: now(),
    };
    this.pushRecord(rec);
  }

  public markError(info?: { message?: string; severity?: string }) {
    /* Record that an error-like state occurred.
     * 에러나 비정상 상태를 기록한다.
     *
     * `info` (message/severity) is stored in extra_json.
     * info(message/severity)는 extra_json에만 넣고,
     * 개인 식별 정보(PII)는 절대 넣지 말 것.
     */
    const rec: EventRecord = {
      ...this.baseTags("error", null),
      ...this.baseFields(),
      error_flag: true,
      extra_json: info
        ? JSON.stringify(info).slice(0, 1024) // limit size / 문자열 길이 제한
        : null,
      ts: now(),
    };
    this.pushRecord(rec);
  }

  public flush() {
    /* Manually force-flush the batch queue.
     * 배치 큐를 강제로 즉시 전송.
     */
    this.q.flush(false);
  }
}

// ---------------------------------------------------------------------------
// Helpers for UTM / path normalization
// UTM 파라미터 & 경로 정규화 유틸
// ---------------------------------------------------------------------------

function getUtmParam(key: string): string | null {
  // Safely parse UTM params from URL.
  // URL에서 utm 파라미터를 안전하게 파싱.
  try {
    const url = new URL(window.location.href);
    return url.searchParams.get(key);
  } catch {
    return null;
  }
}

function normalizePath(pathname: string): string {
  // Normalize path value before storing:
  // - strip any query or trailing artifacts if you want.
  //   (MVP에서는 그냥 pathname 그대로.)
  //
  // path를 저장하기 전에 정규화:
  // - 쿼리스트링 같은 건 빼고 path만 사용
  // - MVP에서는 그대로 반환하지만 향후 /user/123 → /user/:id 식 치환도 가능.
  return pathname.split("?")[0];
}

// ---------------------------------------------------------------------------
// Global singleton + public window API
// 전역 싱글턴 + window에 노출되는 퍼블릭 API
// ---------------------------------------------------------------------------

let singleton: ApiLogCollector | null = null;

/**
 * initCollector
 * Initialize the analytics collector once per page load.
 * 페이지 로드시 한 번만 호출해서 수집기를 초기화한다.
 *
 * Usage (simple embed):
 * 사용 예:
 *
 * <script>
 *   apilog.init({
 *     siteId: "main",
 *     ingestUrl: "https://your.api.host/api/ingest/events",
 *     pageVariant: "2025-10-27-release"
 *   });
 * </script>
 */
export function initCollector(opts: CollectorOptions) {
  if (singleton) return singleton;
  singleton = new ApiLogCollector(opts);
  return singleton;
}

/**
 * markFunnelStep
 * Mark a business step in the funnel (signup step, checkout step...)
 * 비즈니스 퍼널의 특정 단계를 명시적으로 기록한다 (회원가입 단계, 결제 단계 등).
 */
export function markFunnelStep(stepName: string) {
  singleton?.markFunnelStep(stepName);
}

/**
 * markError
 * Log an error-like state for QA / monitoring dashboards.
 * 에러 상태나 예외 상황을 기록해서 QA/모니터링 대시보드에서 볼 수 있게 한다.
 */
export function markError(info?: { message?: string; severity?: string }) {
  singleton?.markError(info);
}

/**
 * flushNow
 * Force immediate batch flush.
 * 현재까지 쌓인 이벤트를 즉시 전송한다.
 */
export function flushNow() {
  singleton?.flush();
}

// We attach a minimal global shim so integrators can just drop a script tag
// and call `apilog.init(...)` without importing modules.
// 전역 window.apilog에 얇은 shim을 붙인다.
// 이렇게 하면 번들된 UMD를 <script>로 넣고 바로 apilog.init(...)을 호출할 수 있다.
declare global {
  interface Window {
    apilog?: {
      init: typeof initCollector;
      markFunnelStep: typeof markFunnelStep;
      markError: typeof markError;
      flushNow: typeof flushNow;
    };
  }
}

// If not already defined, define it.
// 이미 정의돼 있지 않다면 window.apilog를 셋업한다.
if (typeof window !== "undefined") {
  if (!window.apilog) {
    window.apilog = {
      init: initCollector,
      markFunnelStep,
      markError,
      flushNow,
    };
  }
}
