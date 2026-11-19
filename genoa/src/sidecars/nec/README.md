# Genoa NEC sidecar

NEC2++ / PyNEC Method-of-Moments antenna modeling, running as an
**isolated sidecar process** that Genoa talks to over HTTP.

## Why a separate sidecar

NEC2++ ([tmolteno/necpp](https://github.com/tmolteno/necpp)) is **GPL
v2**.  Genoa's main codebase is not GPL.  The license boundary is
enforced by keeping NEC2++ in this sidecar — the API container
**never** imports, links, or statically embeds NEC2++ / PyNEC.  Every
result is treated as external evidence carrying
`provenance.license_boundary = "external sidecar"`.

## Regulatory uses (Genoa side)

- **47 CFR §73.62 / §73.150** — directional AM RTA (radiation
  theoretical analysis) for new tower-array applications and major
  modifications.
- **47 CFR §73.45** — MEOV monitor-point fields for licensed
  directional AM proof of performance.
- **47 CFR §1.1310 / OET-65** — near-field RF exposure at AM
  frequencies, where the far-field formulas in `engine/regulatory/oet65.js`
  are not valid within λ/(2π) (≈ 47 m at 1 MHz).

## HTTP API

| Method | Path | Purpose |
|---|---|---|
| `GET`  | `/health` | Liveness + PyNEC availability probe. Always 200. |
| `POST` | `/model/run` | Run an arbitrary wire-segment model. |
| `POST` | `/model/am-array` | Convenience: build vertical-tower AM array from `frequency_khz` + `towers[]` and run. |
| `POST` | `/model/near-field` | Add additional probe points to an existing model and run. |

### Request — `POST /model/run`

```json
{
  "frequency_mhz": 1.0,
  "ground": {
    "type": "sommerfeld",
    "conductivity_s_m":  0.005,
    "dielectric_constant": 13
  },
  "wires": [
    {
      "tag": 1, "segments": 21,
      "x1": 0, "y1": 0, "z1": 0,
      "x2": 0, "y2": 0, "z2": 75,
      "radius_m": 0.25
    }
  ],
  "excitations": [
    { "tag": 1, "segment": 1, "voltage_real": 1, "voltage_imag": 0 }
  ],
  "pattern": {
    "theta_start": 90, "theta_stop": 90, "theta_step": 1,
    "phi_start":   0,  "phi_stop": 359,  "phi_step":  1
  },
  "near_field": {
    "enabled": true,
    "points": [{ "x": 10, "y": 0, "z": 2 }]
  }
}
```

### Response

```json
{
  "ok": true,
  "model_valid": true,
  "frequency_mhz": 1.0,
  "geometry": { "n_wires": 1, "total_length_m": 75, "n_segments": 21 },
  "ground":   { "type": "sommerfeld", "conductivity_s_m": 0.005, "dielectric_constant": 13 },
  "feedpoint": { "r_ohm": 36.5, "x_ohm": 21.4, "vswr_50": 1.43 },
  "pattern":   { "theta_deg": [...], "phi_deg": [...], "gain_dbi": [[...]] },
  "near_field": [
    { "x": 10, "y": 0, "z": 2, "e_v_m": 12.3, "h_a_m": 0.04, "s_mw_cm2": 0.2 }
  ],
  "warnings": ["..."],
  "provenance": {
    "engine":           "necpp/PyNEC",
    "source":           "NEC2++ sidecar",
    "license_boundary": "external sidecar",
    "sidecar_version":  "0.1.0",
    "generated_at":     "2026-...",
    "model_hash":       "sha256-of-canonical-input"
  }
}
```

## Local development

⚠️ Two install gotchas on Debian/Ubuntu:

1. There is **no `nec` apt package** on Bookworm / Jammy any more.
2. The PyPI `PyNEC` sdist is **broken** — it ships without the
   `necpp_src/` subdirectory the build needs, so `pip install PyNEC`
   produces a stub `.so` with no `PyInit__PyNEC` symbol and you get
   `ImportError: dynamic module does not define module export function`
   on import.

**The reliable path** (what the Dockerfile in this repo does):

> necpp (the `necpp_src` submodule) migrated its build system from
> autotools (`Makefile.git`/`./configure`) to CMake upstream, so the
> `make -f Makefile.git && ./configure ...` steps this section used to
> document no longer exist in the source tree (that's exactly what broke
> the Docker build — see the Dockerfile's own comments). This sidecar
> only ever does `import PyNEC` (never the standalone `nec2++` CLI or
> `libnecpp` directly), and PyNEC's own `setup.py` compiles `necpp_src`'s
> `.cpp` sources straight into the Python extension — no separate
> `cmake`/`make install` of `necpp_src` is needed.

```bash
# Build deps. Deliberately NOT installing apt's `swig` package here --
# Debian Bookworm / Ubuntu Jammy ship SWIG 4.1.0, which generates C++
# wrapper code using legacy CPython macros (PyTuple_GET_ITEM,
# PyList_SET_ITEM, direct PyTypeObject struct access, etc.) that fail to
# compile against Python's Limited API, which PyNEC's setup.py always
# builds against for its ABI3 wheel -- errors like "'PyTuple_GET_ITEM'
# was not declared in this scope" and "invalid use of incomplete type
# 'PyTypeObject'". Verified directly: SWIG 4.1.0 fails this exact build;
# a modern SWIG (installed via pip below) generates Limited-API-compatible
# code and builds cleanly.
sudo apt-get install -y \
    git build-essential \
    python3 python3-pip python3-numpy python3-dev

# Debian Bookworm's / Ubuntu Jammy's apt-vintage setuptools (~68.x)
# cannot parse PyNEC's pyproject.toml (it declares `license =
# "GPL-3.0-only"` using the PEP 639 SPDX-string form, which only
# setuptools >=69.3-ish understands) -- upgrade first or `pip install .`
# fails with "project.license must be valid exactly by one definition".
# Also installs a modern SWIG (see above) instead of apt's stale one.
sudo pip3 install --break-system-packages --upgrade pip setuptools wheel swig

# Clone the real source repo (NOT pip).  --recurse-submodules pulls
# the necpp_src C++ engine.
git clone --depth=1 --recurse-submodules \
    https://github.com/tmolteno/python-necpp.git
cd python-necpp/PyNEC
ln -s ../necpp_src .
swig -Wall -c++ -python PyNEC.i
sudo pip3 install --no-build-isolation --break-system-packages .

# Verify
python3 -c "import PyNEC; print(PyNEC.__file__)"

# Run the sidecar's own regression smoke test (verifies PyNEC import,
# feedpoint impedance, and the NEC2 grazing-angle-singularity handling
# below -- not just that the module imports).
python3 ~/genoa/src/sidecars/nec/smoke_test.py

# Run the sidecar (back in genoa repo)
cd ~/genoa/src/sidecars/nec
SIDECAR_PORT=8085 node server.js
```

Smoke-test:

```bash
curl -s http://localhost:8085/health | jq
# expect { "pynec_available": true, ... }

curl -s -X POST -H 'content-type: application/json' \
  -d '{"frequency_mhz":1.0,"ground":{"type":"pec"},
       "wires":[{"tag":1,"segments":21,"x1":0,"y1":0,"z1":0,
                  "x2":0,"y2":0,"z2":75,"radius_m":0.25}],
       "excitations":[{"tag":1,"segment":1,"voltage_real":1,"voltage_imag":0}],
       "pattern":{"theta_start":90,"theta_stop":90,"theta_step":1,
                  "phi_start":0,"phi_stop":355,"phi_step":45}}' \
  http://localhost:8085/model/run | jq '.pattern.gain_dbi[0]'
# expect: a row of ~5.08 dBi (textbook quarter-wave monopole gain)
```

⚠️ **AM/MF ground-wave note (ground.type=sommerfeld, theta=90):** the PEC
smoke test above works at the exact horizon (theta=90) because PEC's
image-theory ground is well-defined there. `ground.type=sommerfeld` —
the realistic finite-conductivity ground model this sidecar documents
for AM towers over real soil — is numerically singular at the *exact*
horizon and returns NEC2's `-999.99` dBi sentinel there, not a real
field value. The bridge detects this (ground=sommerfeld AND
theta includes exactly 90) and returns an explicit
`NEC_GRAZING_ANGLE_SINGULARITY` warning rather than letting a caller
mistake `-999.99` for "no signal" — for the DA pattern optimizer
(`--optimize`) specifically, it returns `achieved_suppression_db: null`
and `converged: false` instead of a fabricated number (this used to
silently report things like `"achieved_suppression_db": 800.512` — a
physically impossible suppression figure computed from the sentinel).
Query theta slightly off 90 (e.g. 89) for a horizontal-plane-adjacent
real value, or use NEC2's dedicated ground-wave RP-card option if the
true grazing-incidence groundwave field is needed — this bridge does
not select that option automatically; see `smoke_test.py` for a worked
example of both the failing (theta=90) and working (theta=89) cases.

## Docker (recommended)

The Dockerfile uses a multi-stage build that compiles PyNEC from the
`tmolteno/python-necpp` source repo (avoiding both the missing `nec`
apt package and the broken PyPI sdist). It builds only PyNEC's Python
extension, not the standalone `nec2++` CLI / `libnecpp` (this sidecar
never uses either -- see the Dockerfile's own comments).

```bash
docker build -t genoa-nec-sidecar:0.1.0 .
docker run --rm -p 8085:8085 genoa-nec-sidecar:0.1.0
# HEALTHCHECK verifies pynec_available:true at boot.

curl -s http://localhost:8085/health | jq
```

## Genoa API integration

Set `NEC_SIDECAR_URL` on the Genoa API deploy:

```
NEC_SIDECAR_URL=http://nec-sidecar:8085
```

When the sidecar is unreachable or PyNEC is missing, Genoa emits a
`NEC_MODEL_UNAVAILABLE` warning but compute does not fail — the
exhibit ships without the NEC evidence section.

## Warnings emitted on the Genoa side

| Code | Meaning |
|---|---|
| `NEC_MODEL_UNAVAILABLE` | Sidecar unreachable or PyNEC not installed. |
| `NEC_MODEL_INVALID_GEOMETRY` | Caller-supplied model failed schema / sanity. |
| `NEC_GROUND_MODEL_LIMITATION` | PEC ground assumed; real soil typically Sommerfeld. |
| `NEC_NEAR_FIELD_APPROXIMATION` | Near-field accuracy degrades within ≈ λ/8 of conductors. |
| `NEC_LICENSE_BOUNDARY_EXTERNAL` | Stamped on every NEC evidence block — GPL boundary preserved. |
