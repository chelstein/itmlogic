# Genoa FAA OE sidecar — scrapes oeaaa.faa.gov/oeaaa/external for
# OE/AAA case file data per 47 CFR §17.7 / §17.17.
#
# DEPLOY (operator, on droplet):
#   docker build -t genoa-faa-oe .
#   docker run -d --name genoa-faa-oe \
#     -p 8093:8093 \
#     -e FAA_OE_API_TOKEN="$(openssl rand -hex 32)" \
#     --restart unless-stopped genoa-faa-oe
#
# Then set in Genoa App Platform:
#   FAA_OE_SIDECAR_URL=http://159.223.153.153:8093
#   FAA_OE_API_TOKEN=<same token>
#
# The container is stateless; all scraping is live against oeaaa.faa.gov.

FROM python:3.12-slim
ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

COPY main.py /app/main.py

ENV PORT=8093
EXPOSE 8093

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD curl -fsS http://127.0.0.1:${PORT}/health || exit 1

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8093"]
