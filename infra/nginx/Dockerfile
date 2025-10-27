# infra/nginx/Dockerfile

FROM nginx:alpine

RUN mkdir -p /usr/share/nginx/html/apilog

COPY front/apps/dashboard/dist /usr/share/nginx/html
COPY front/apps/collector-js/dist /usr/share/nginx/html/apilog
COPY infra/nginx/nginx.conf /etc/nginx/nginx.conf
