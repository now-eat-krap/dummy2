FROM mcr.microsoft.com/playwright/python:v1.47.2-jammy
ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 DATA_DIR=/data CAPTURE_TTL_SEC=43200 MAX_TILES=50
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app ./app
RUN mkdir -p ${DATA_DIR} && chown -R pwuser:pwuser ${DATA_DIR}
VOLUME ["/data"]
EXPOSE 8080
RUN python -m playwright install chromium
CMD ["sh","-lc","uvicorn app.main:app --host 0.0.0.0 --port 8080"]
