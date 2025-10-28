########################################
# 1) dashboard 빌드 (React/Vite)
########################################
FROM node:20-alpine AS build-dashboard

# 작업 디렉토리: /app/dashboard
WORKDIR /app/dashboard

# 먼저 package.json / lock만 복사해서 deps 설치
COPY front/apps/dashboard/package.json ./
COPY front/apps/dashboard/package-lock.json ./
RUN npm ci

# 이제 실제 소스 전체 복사
COPY front/apps/dashboard ./

# Vite 빌드 -> /app/dashboard/dist 생성
RUN npm run build

########################################
# 2) collector-js 빌드 (Rollup/TS)
########################################
FROM node:20-alpine AS build-collector

WORKDIR /app/collector

# 1. package.json만 복사
COPY front/apps/collector-js/package.json ./

# 2. lockfile 없이 일반 install (devDependencies도 깔림)
#    - 여기서 NODE_ENV=production 같은 거 걸면 devDeps 안 깔려서 rollup 못 돌아감
RUN npm install

# 3. 나머지 소스 복사 (src/, tsconfig.json, rollup.config.mjs 등)
COPY front/apps/collector-js ./

# 4. 빌드 (rollup -c 가 package.json의 "build" 스크립트여야 함)
RUN npm run build


########################################
# 3) 런타임: Nginx로 정적 서빙
########################################
FROM nginx:alpine AS runtime

# nginx 기본 mime.types 등은 이미 이미지 안에 들어있음
# 정적 파일 위치 준비
RUN mkdir -p /usr/share/nginx/html \
    && mkdir -p /usr/share/nginx/html/apilog

# 3-1. 대시보드 SPA 정적 파일을 루트(/)에 복사
COPY --from=build-dashboard /app/dashboard/dist /usr/share/nginx/html

# 3-2. collector-js 번들(dist)을 /apilog/ 밑에 복사
#   여기에는 embed.js, collector.iife.js, index.js 등이 들어있음
COPY --from=build-collector /app/collector/dist /usr/share/nginx/html/apilog

# 3-3. nginx 설정 덮어쓰기
COPY infra/nginx/nginx.conf /etc/nginx/nginx.conf

# (선택) HEALTHCHECK 같은 거 나중에 추가 가능
# EXPOSE 80
