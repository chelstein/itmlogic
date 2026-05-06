# Genoa NEC sidecar — NEC2++ / PyNEC antenna modeling.
#
# LICENSE
#   NEC2++ is GPL v2.  This image distributes the GPL'd binaries +
#   the GPL-isolated bridge.  Genoa's main API image does NOT contain
#   any of these — the boundary is enforced by running this sidecar
#   as a separate container that the API talks to over HTTP only.
#
# BUILD
#   cd src/sidecars/nec
#   docker build -t genoa-nec-sidecar:0.1.0 .
#
# RUN
#   docker run --rm -p 8085:8085 \
#     -e SIDECAR_PORT=8085 \
#     -e BRIDGE_TIMEOUT_MS=60000 \
#     genoa-nec-sidecar:0.1.0
#
# Genoa API talks to this via:
#   NEC_SIDECAR_URL=http://nec-sidecar:8085

FROM debian:bookworm-slim AS base
ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates \
        nec \
        python3 \
        python3-pip \
        python3-numpy \
        nodejs \
        npm \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# PyNEC pulls necpp transitively.
COPY requirements.txt /app/requirements.txt
RUN pip3 install --no-cache-dir --break-system-packages -r requirements.txt

# Sidecar source.
COPY server.js     /app/server.js
COPY nec_bridge.py /app/nec_bridge.py
RUN chmod +x /app/nec_bridge.py

# Express is the only Node dependency; vendor it locally.
RUN npm init -y >/dev/null 2>&1 \
 && npm install --omit=dev express >/dev/null 2>&1

ENV SIDECAR_PORT=8085 \
    BRIDGE_TIMEOUT_MS=60000 \
    PYNEC_PYTHON_BIN=python3

EXPOSE 8085

# Healthcheck verifies both the Node server AND PyNEC import.
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD wget -qO - http://localhost:8085/health | grep -q '"ok":true' \
   || exit 1

CMD ["node", "/app/server.js"]
