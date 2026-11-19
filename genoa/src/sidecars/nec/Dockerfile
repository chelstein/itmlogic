# Genoa NEC sidecar — NEC2++ / PyNEC antenna modeling.
#
# LICENSE
#   NEC2++ is GPL v2.  This image distributes the GPL'd binaries +
#   the GPL-isolated bridge.  Genoa's main API image does NOT contain
#   any of these — the boundary is enforced by running this sidecar
#   as a separate container that the API talks to over HTTP only.
#
# WHY THIS LAYOUT
#   * Multi-stage: a `necpp-build` stage compiles PyNEC from source (the
#     PyPI sdist is broken; the apt `nec` package is no longer in the
#     default repos).  A slim `runtime` stage copies only the resulting
#     PyNEC module/.so + the Express server — nec_bridge.py only ever
#     does `import PyNEC`, so the standalone nec2++ CLI and libnecpp
#     (which necpp_src's own CMake build can also produce) are never
#     built or copied here; they would be dead weight.
#   * Debian Bookworm: ships Node 18 (the `node:` URI prefix that
#     server.js uses requires Node 14.13+, so Ubuntu 22.04's apt
#     Node 12 is not viable).
#   * Single CMD; one COPY of each file; one express install; one
#     final image.

# ───────────────── necpp-build stage ─────────────────
FROM debian:bookworm-slim AS necpp-build
ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates git build-essential \
        python3 python3-pip python3-numpy python3-dev \
    && rm -rf /var/lib/apt/lists/*

# necpp (upstream, as of its 2026 CMake migration) ships no pyproject.toml
# the Debian Bookworm-vintage setuptools (~68.x) can parse: it declares
# `license = "GPL-3.0-only"` using the PEP 639 SPDX-string form, which
# only setuptools >=69.3-ish understands — an older setuptools' schema
# validator rejects it outright ("project.license must be valid exactly
# by one definition"). Upgrade build-time tooling before touching PyNEC's
# pyproject.toml; this does not affect the runtime image (separate stage,
# pip/setuptools aren't copied into it).
#
# NOT installing apt's `swig` package here -- Debian Bookworm ships SWIG
# 4.1.0, which generates C++ wrapper code using legacy CPython macros
# (PyTuple_GET_ITEM, PyList_SET_ITEM, direct PyTypeObject struct access,
# etc.) that Python's Limited API (Py_LIMITED_API, which PyNEC's setup.py
# always builds against for its ABI3 wheel) deliberately hides -- this
# fails to compile with errors like "'PyTuple_GET_ITEM' was not declared
# in this scope" and "invalid use of incomplete type 'PyTypeObject'".
# Verified directly: SWIG 4.1.0 fails this exact build; SWIG 4.5.1
# (installed via pip below, the current PyPI release as of this fix)
# generates Limited-API-compatible code and builds cleanly. Installing
# SWIG via pip instead of apt sidesteps the Debian release's SWIG version
# entirely, rather than depending on backports or a newer base image.
RUN pip3 install --break-system-packages --upgrade pip setuptools wheel swig

WORKDIR /build

# Build PyNEC from source. necpp (the `necpp_src` submodule) migrated its
# build system from autotools (Makefile.git/configure) to CMake upstream;
# this sidecar only ever consumes it via `import PyNEC` (nec_bridge.py
# never shells out to the standalone nec2++ CLI or links libnecpp
# directly), so PyNEC's own setup.py — which compiles necpp_src's .cpp
# sources straight into the Python extension — is sufficient on its own;
# no separate `cmake`/`make install` of necpp_src/libnecpp is needed or
# produced.
RUN git clone --depth=1 --recurse-submodules https://github.com/tmolteno/python-necpp.git python-necpp

WORKDIR /build/python-necpp/PyNEC
RUN ln -s ../necpp_src . \
 && swig -Wall -c++ -python PyNEC.i \
 && pip3 install --no-build-isolation --break-system-packages . \
 && python3 -c "import PyNEC; print('PyNEC OK at', PyNEC.__file__)"

# ───────────────── runtime stage ─────────────────
FROM debian:bookworm-slim AS runtime
ENV DEBIAN_FRONTEND=noninteractive

# Runtime deps only — no compilers, no git, no swig.
RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates python3 python3-numpy nodejs npm wget \
    && rm -rf /var/lib/apt/lists/*

# Copy only the build artifacts; no source, no toolchain. nec_bridge.py
# only ever does `import PyNEC` — never shells out to a standalone
# nec2++ CLI or links libnecpp directly — so only PyNEC's own module +
# compiled extension are needed (neither is produced by this build
# anymore; see the necpp-build stage comment).
#
# PyNEC's setup.py builds an ABI3 (Python stable-ABI) wheel, so the
# compiled extension is named `_PyNEC.abi3.so` — NOT the
# `_PyNEC.cpython-311-...so` name an API-version-specific (non-ABI3)
# build would produce. Verified directly: building PyNEC from this exact
# upstream commit produces /usr/local/lib/python3.11/dist-packages/
# {PyNEC.py, _PyNEC.abi3.so} on Python 3.11.
COPY --from=necpp-build /usr/local/lib/python3.11/dist-packages/PyNEC.py \
                        /usr/local/lib/python3.11/dist-packages/PyNEC.py
COPY --from=necpp-build /usr/local/lib/python3.11/dist-packages/_PyNEC.abi3.so \
                        /usr/local/lib/python3.11/dist-packages/_PyNEC.abi3.so

WORKDIR /app

# Sidecar source — single COPY of each file.
COPY server.js     /app/server.js
COPY nec_bridge.py /app/nec_bridge.py
RUN chmod +x /app/nec_bridge.py

# server.js is ESM (`import` statements) and depends on Express.
# Both requirements must be satisfied or `node /app/server.js` exits
# at boot with SyntaxError or Cannot-find-module 'express'.
RUN echo '{ "name": "genoa-nec-sidecar", "version": "0.1.0", "type": "module", "private": true }' > /app/package.json \
 && npm install --omit=dev express \
 && node -e "import('express').then(()=>console.log('express OK'))"

ENV SIDECAR_PORT=8085 \
    BRIDGE_TIMEOUT_MS=60000 \
    PYNEC_PYTHON_BIN=python3

EXPOSE 8085

# Healthcheck verifies both the Node server and PyNEC import.
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD wget -qO - http://localhost:8085/health | grep -q '"pynec_available":true' \
   || exit 1

CMD ["node", "/app/server.js"]
