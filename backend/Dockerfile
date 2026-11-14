FROM python:3.12-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# Build tooling is only needed while wheels are compiled, then removed.
RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt \
    && apt-get purge -y --auto-remove build-essential

COPY . .

RUN addgroup --system trustrag && adduser --system --ingroup trustrag trustrag \
    && chown -R trustrag:trustrag /app
USER trustrag

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers"]

# (Keep all your existing build and dependency installation steps above)

# Copy the start script into the container
COPY start.sh /app/start.sh
RUN chmod +x /app/start.sh

# Expose port and run the start script
EXPOSE 8000
CMD ["/app/start.sh"]
