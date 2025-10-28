// src/index.ts
// 내부 앱(React/Vite 등)에서 import 해서 쓰는 SDK 엔트리.
// 외부 사이트용 <script> 경로( embed.js + collector.iife.js )랑 별개로,
// 우리 코드에서 직접 초기화/호출하고 싶을 때 사용한다.
//
// 나중에는 bootstrap.ts 안의 ApiLogCollector 클래스를 공용 모듈로 빼서
// 여기서도 동일한 인스턴스를 만들도록 바꿀 예정.
// 지금은 Docker 빌드 통과 + 최소 동작용 placeholder 버전이다.

export interface InitConfig {
  siteId: string;
  ingestUrl: string;
  pageVariant?: string;
  utmSource?: string;
  utmCampaign?: string;
}

// 내부 싱글턴 상태.
// 이건 페이지 전역(window.apilog)을 쓰지 않고
// SDK import한 쪽(React 앱 등)만의 로컬 상태를 관리한다.
let started = false;

let runtimeConfig: InitConfig | null = null;

/**
 * initCollector
 *
 * 대시보드/내부앱에서 수집을 시작하고 싶을 때 호출.
 * embed.js 경로를 안 쓰고도 추적을 붙일 수 있게 하기 위한 진입점.
 *
 * 실제 수집기 풀버전은 bootstrap.ts의 ApiLogCollector인데,
 * 지금은 placeholder로만 둔다.
 */
export function initCollector(cfg: InitConfig): void {
  if (started) {
    // 이미 초기화된 경우 두 번 하지 않음.
    return;
  }
  started = true;
  runtimeConfig = cfg;

  // TODO(실제 구현):
  //  - ApiLogCollector 같은 객체를 import해서 생성
  //  - 클릭/스크롤/체류시간 이벤트 핸들링 시작
  //  - 배치 큐로 cfg.ingestUrl에 POST
  //
  // 지금은 placeholder 로그만 남긴다.
  console.log("[apilog SDK] initCollector()", cfg);
}

/**
 * markFunnelStep
 *
 * 내부 앱에서 특정 퍼널 단계를 기록하고 싶을 때.
 * ex) markFunnelStep("dashboard_loaded")
 */
export function markFunnelStep(stepName: string): void {
  if (!started) {
    // 아직 init 이전이면 그냥 무시 (오류 안 던짐. 프로덕션에서 안전하게 하려고)
    return;
  }

  // TODO: 나중엔 실제 이벤트 큐에 넣을 예정
  console.log("[apilog SDK] markFunnelStep()", stepName, {
    siteId: runtimeConfig?.siteId,
  });
}

/**
 * markError
 *
 * 에러 이벤트를 수집용으로 남기고 싶을 때.
 * 민감/PII는 직접 넣지 않도록 주의해야 한다.
 */
export function markError(info: unknown): void {
  if (!started) {
    return;
  }

  // TODO: 나중엔 batch queue에 {event_name: "error", extra_json: info} 넣을 예정
  console.log("[apilog SDK] markError()", info, {
    siteId: runtimeConfig?.siteId,
  });
}

/**
 * flushNow
 *
 * 지금까지 쌓인 이벤트를 즉시 서버로 보내고 싶을 때 호출.
 * 실제 collector 구현에서는 BatchQueue.flush(false)를 호출해주면 된다.
 */
export function flushNow(): void {
  if (!started) {
    return;
  }

  // TODO: 배치 큐 flush 호출
  console.log("[apilog SDK] flushNow()", {
    siteId: runtimeConfig?.siteId,
  });
}

/**
 * isStarted
 *
 * 디버깅용. collector가 초기화됐는지 여부만 확인 가능하게 제공.
 * 대시보드 같은 내부 툴에서 상태 UI 띄울 때 쓸 수 있음.
 */
export function isStarted(): boolean {
  return started;
}

/**
 * getRuntimeConfig
 *
 * 현재 collector 설정값 (siteId, ingestUrl 등)을 조회할 수 있게 해준다.
 * read-only로 제공하고, 수정은 initCollector로만 하게 할 거다.
 */
export function getRuntimeConfig(): InitConfig | null {
  return runtimeConfig;
}
