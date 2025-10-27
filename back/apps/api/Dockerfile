FROM python:3.11-slim

RUN pip install --no-cache-dir fastapi uvicorn[standard] influxdb-client

WORKDIR /app
COPY app /app/app

ENV PYTHONUNBUFFERED=1

CMD ["python", "-m", "app.main"]
