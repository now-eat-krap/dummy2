# 1) Build dashboard (Preact/Vite) + collector-js (tsup)
FROM node:18-alpine AS builder

# workdir
WORKDIR /app

# copy root workspace stuff (pnpm-lock.yaml 등 있으면 그것도 같이 복사)
COPY front/apps/dashboard/package.json front/apps/dashboard/
COPY front/apps/collector-js/package.json front/apps/collector-js/
COPY front/apps/collector-js/tsconfig.json front/apps/collector-js/
# 만약 monorepo라 pnpm-workspace.yaml / root package.json이 있다면 그것도 COPY해야 함
COPY pnpm-workspace.yaml ./
COPY package.json ./

# install deps
RUN corepack enable && corepack prepare pnpm@latest --activate
RUN pnpm install --frozen-lockfile

# copy actual source now
COPY front/apps/dashboard front/apps/dashboard
COPY front/apps/collector-js front/apps/collector-js

# build dashboard (vite build)
WORKDIR /app/front/apps/dashboard
RUN pnpm build

# build collector-js (tsup build)
WORKDIR /app/front/apps/collector-js
RUN pnpm build

# 2) Final nginx image
FROM nginx:alpine

# make subdir for apilog assets
RUN mkdir -p /usr/share/nginx/html/apilog

# copy built dashboard static -> nginx root
COPY --from=builder /app/front/apps/dashboard/dist /usr/share/nginx/html

# copy built collector-js bundle -> /apilog
COPY --from=builder /app/front/apps/collector-js/dist /usr/share/nginx/html/apilog

# copy nginx config
COPY infra/nginx/nginx.conf /etc/nginx/nginx.conf
