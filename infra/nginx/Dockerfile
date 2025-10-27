FROM nginx:alpine

RUN mkdir -p /usr/share/nginx/html/apilog

# dashboard 정적 파일 배포
COPY front/apps/dashboard/dist /usr/share/nginx/html

# collector-js 빌드 결과(js) 배포
COPY front/apps/collector-js/dist /usr/share/nginx/html/apilog

# nginx 설정
COPY infra/nginx/nginx.conf /etc/nginx/nginx.conf
