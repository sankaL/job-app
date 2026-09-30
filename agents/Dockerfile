FROM python:3.12-bookworm

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

COPY pyproject.toml .

RUN pip install --no-cache-dir . && \
    python -m playwright install --with-deps chromium

COPY . .

RUN pip install --no-cache-dir --no-deps .

CMD ["arq", "worker.WorkerSettings"]
