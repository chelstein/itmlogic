# Genoa VOACAP advisory sidecar — FastAPI wrapper around the NTIA/ITS
# VOACAP (Voice of America Coverage Analysis Program) HF propagation
# prediction tool via the jawatson/voacapl Linux port.
#
# VOACAP is public-domain software from NTIA/ITS (US Government work
# product, 17 USC §105).  The voacapl port by James Watson is licensed
# under the MIT License.
#
# OUTPUT: advisory only — filing_effect: "none" on every response.
# VOACAP results provide ionospheric context for AM nighttime skywave
# studies but NEVER substitute for FCC §73.190(c) / §73.182 math.
#
# DEPLOY (operator, on droplet):
#   docker build -t genoa-voacap .
#   docker run -d --name genoa-voacap \
#     -p 8086:8086 \
#     -e VOACAP_API_TOKEN="$(openssl rand -hex 32)" \
#     --restart unless-stopped genoa-voacap

# ── Stage 1: build voacapl from source ────────────────────────────────
FROM debian:bookworm-slim AS builder

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates git \
        gfortran automake autoconf libtool make \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build
RUN git clone --depth 1 https://github.com/jawatson/voacapl.git .
RUN ./autogen.sh \
    && ./configure --prefix=/opt/voacap \
    && make -j4 \
    && make install \
    && sha256sum /opt/voacap/bin/voacapl | awk '{print $1}' > /opt/voacap/.voacap_bin_sha256

# ── Stage 2: runtime image ────────────────────────────────────────────
FROM python:3.11-slim

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates curl libgfortran5 \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /opt/voacap/bin/voacapl      /usr/local/bin/voacapl
COPY --from=builder /opt/voacap/.voacap_bin_sha256 /app/.voacap_bin_sha256
COPY --from=builder /build/itshfbc               /opt/voacap/itshfbc

WORKDIR /app

RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

COPY main.py /app/main.py

ENV VOACAP_ITSHFBC=/opt/voacap/itshfbc
ENV PORT=8086
EXPOSE 8086

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -fsS http://127.0.0.1:${PORT}/healthz || exit 1

CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT}"]
