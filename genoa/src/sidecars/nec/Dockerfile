# Genoa NEC sidecar — NEC2++ / PyNEC antenna modeling.
#
# LICENSE
#   NEC2++ is GPL v2.  This image distributes the GPL'd binaries +
#   the GPL-isolated bridge.  Genoa's main API image does NOT contain
#   any of these — the boundary is enforced by running this sidecar
#   as a separate container that the API talks to over HTTP only.
#
# WHY WE BUILD FROM SOURCE
#   The PyPI `PyNEC` sdist ships without the necpp_src/ subdirectory
#   the build needs, so `pip install PyNEC` produces a broken module
#   (ImportError: dynamic module does not define module export
#   function).  The Debian / Ubuntu `nec` apt package is also no
#   longer in the default repos on Bookworm/Jammy.  The reliable
#   path is to clone tmolteno/python-necpp with submodules, build
#   necpp from source, then build PyNEC against it.  This Dockerfile
#   does exactly that.
#
# BUILD
#   cd src/sidecars/nec
#   docker build -t genoa-nec-sidecar:0.1.0 .
#
# RUN
#   docker run --rm -p 8085:8085 genoa-nec-sidecar:0.1.0
#
# Genoa API talks to this via:
#   NEC_SIDECAR_URL=http://nec-sidecar:8085

FROM debian:bookworm-slim AS necpp-build
ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates git build-essential autoconf automake libtool \
        swig pkg-config python3 python3-pip python3-numpy python3-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build

# Build NEC2++ + PyNEC from source.  --recurse-submodules pulls
# necpp_src; ./configure --without-lapack avoids the LAPACK dep
# (it's only used for some optimization paths Genoa doesn't exercise).
RUN git clone --depth=1 --recurse-submodules https://github.com/tmolteno/python-necpp.git python-necpp
WORKDIR /build/python-necpp/necpp_src
RUN make -f Makefile.git \
 && ./configure --without-lapack \
 && make -j"$(nproc)" \
 && make install \
 && ldconfig
WORKDIR /build/python-necpp/PyNEC
RUN ln -s ../necpp_src . \
 && swig -Wall -c++ -python PyNEC.i \
 && pip3 install --no-build-isolation --break-system-packages . \
 && python3 -c "import PyNEC; print('PyNEC OK at', PyNEC.__file__)"

# ---------- runtime image ----------
FROM debian:bookworm-slim AS runtime
ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates python3 python3-numpy nodejs npm wget \
    && rm -rf /var/lib/apt/lists/*

# Pull NEC2++ binaries + libnecpp + the installed PyNEC module from the
# build stage.  Nothing else from /build comes across.
COPY --from=necpp-build /usr/local/bin/nec2++           /usr/local/bin/nec2++
COPY --from=necpp-build /usr/local/lib/libnecpp.so      /usr/local/lib/libnecpp.so
COPY --from=necpp-build /usr/local/lib/libnecpp.la      /usr/local/lib/libnecpp.la
COPY --from=necpp-build /usr/local/lib/libnecpp.a       /usr/local/lib/libnecpp.a
COPY --from=necpp-build /usr/local/lib/python3.11/dist-packages/PyNEC.py \
                        /usr/local/lib/python3.11/dist-packages/PyNEC.py
COPY --from=necpp-build /usr/local/lib/python3.11/dist-packages/_PyNEC.cpython-311-x86_64-linux-gnu.so \
                        /usr/local/lib/python3.11/dist-packages/_PyNEC.cpython-311-x86_64-linux-gnu.so
RUN ldconfig

WORKDIR /app

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
  CMD wget -qO - http://localhost:8085/health | grep -q '"pynec_available":true' \
   || exit 1

CMD ["node", "/app/server.js"]
