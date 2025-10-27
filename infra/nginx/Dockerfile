########################################
# Stage 1: build frontend assets
# 프론트(dashboard + collector-js) 빌드 단계
########################################
FROM node:18-alpine AS builder

# ---- build dashboard -------------------------------------------------
WORKDIR /build/dashboard

# 1) 먼저 의존성만 복사해서 설치 (캐시 잘 먹게)
#    package-lock.json 없으면 그냥 package.json만 COPY 하고 npm install로 가면 돼.
COPY front/apps/dashboard/package.json front/apps/dashboard/package-lock.json* ./

RUN npm install

# 2) 나머지 소스 복사
COPY front/apps/dashboard ./

# 3) 실제 빌드 (예: vite build)
#    package.json 안에 "build": "vite build" 같은 스크립트 있다고 가정
RUN npm run build


# ---- build collector-js ----------------------------------------------
WORKDIR /build/collector-js

COPY front/apps/collector-js/package.json front/apps/collector-js/package-lock.json* ./

RUN npm install

COPY front/apps/collector-js ./

# collector-js도 "build": "tsc && (tsup || rollup 등)" 같은 빌드 스크립트 있다고 가정
RUN npm run build


########################################
# Stage 2: runtime nginx
# 실제 서비스 컨테이너 (정적 파일만 서빙)
########################################
FROM nginx:alpine

# nginx 기본 루트 안에 /apilog 서브디렉토리까지 준비
RUN mkdir -p /usr/share/nginx/html/apilog

# dashboard 정적 결과물 복사
COPY --from=builder /build/dashboard/dist /usr/share/nginx/html

# collector-js 번들 결과물 복사 (embed.js / apilog.js 등)
COPY --from=builder /build/collector-js/dist /usr/share/nginx/html/apilog

# nginx 설정 복사
COPY infra/nginx/nginx.conf /etc/nginx/nginx.conf
