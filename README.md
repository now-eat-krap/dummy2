# Logflow (Local Heatmap + Snapshot Cache) — Starter (with Combined Snippet)

**로컬**에서 동작하는 경량 웹 분석/히트맵 & 스냅샷 파이프라인 샘플입니다.  
이번 버전은 **한 줄 스니펫(ba-combined.js)** 으로 **이벤트 수집 + 스냅샷 큐**가 동시에 동작합니다.

## 빠른 시작
```bash
docker compose -f docker/docker-compose.yml up -d --build
```

브라우저에서:
- 대시보드(정적): http://localhost:8083/heatmap-viewer.html

분석하려는 웹사이트에 아래 **한 줄**만 넣으세요:
```html
<script src="http://localhost:8080/ba-combined.js"
        data-site="logflow"
        data-collect="http://localhost:8080/ba"
        data-snapshot="http://localhost:8082"
        data-click="true" data-scroll="true" data-spa="true"
        data-viewports="1366x900,390x844"
        data-probe="off" defer></script>
```

> 참고: 예전처럼 두 스크립트(ba.js, ba-snapshot.js)로 분리해도 작동합니다.  
> 하지만 운영에선 위 **단일 스니펫** 사용을 권장합니다.
