# 1) Build stage: dashboard, collector-js 번들 만들기
FROM node:20-alpine AS build

WORKDIR /app

# dashboard 의존성 설치 & 빌드
COPY front/apps/dashboard/package.json front/apps/dashboard/package-lock.json ./front/apps/dashboard/
WORKDIR /app/front/apps/dashboard
RUN npm ci
COPY front/apps/dashboard ./ 
RUN npm run build

# collector-js 의존성 설치 & 빌드
WORKDIR /app
COPY front/apps/collector-js/package.json front/apps/collector-js/package-lock.json ./front/apps/collector-js/
WORKDIR /app/front/apps/collector-js
RUN npm ci
COPY front/apps/collector-js ./
RUN npm run build

# 2) Runtime stage: nginx로 서빙
FROM nginx:alpine

# 기본 루트 + /apilog 디렉토리 준비
RUN mkdir -p /usr/share/nginx/html && \
    mkdir -p /usr/share/nginx/html/apilog

# dashboard 정적 빌드물 → 루트(/)
COPY --from=build /app/front/apps/dashboard/dist /usr/share/nginx/html

# collector-js 빌드물 → /apilog/*
COPY --from=build /app/front/apps/collector-js/dist /usr/share/nginx/html/apilog

# nginx 설정 반영
COPY infra/nginx/nginx.conf /etc/nginx/nginx.conf
