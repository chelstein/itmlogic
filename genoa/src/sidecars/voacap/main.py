"""Genoa VOACAP advisory sidecar — FastAPI wrapper around the NTIA/ITS
VOACAP (Voice of America Coverage Analysis Program) HF propagation
prediction tool via jawatson/voacapl.

REGULATORY POSTURE
  ALL responses carry advisory:true, filing_effect:'none'.
  VOACAP output provides ionospheric context for AM nighttime skywave
  studies; it NEVER substitutes for FCC §73.190(c) / §73.182 math.

ENDPOINTS
  GET  /healthz                → { ok, binary_present, itshfbc_present }
  GET  /version                → { engine, binary_sha256, itshfbc_path }
  POST /run/path               → advisory reliability per frequency per hour
"""

import hashlib
import json
import logging
import math
import os
import re
import subprocess
import tempfile
import time
from pathlib import Path
from typing import List, Optional

from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel, Field, field_validator

log = logging.getLogger("voacap-sidecar")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

VOACAP_BIN   = Path("/usr/local/bin/voacapl")
ITSHFBC_PATH = Path(os.environ.get("VOACAP_ITSHFBC", "/opt/voacap/itshfbc"))
API_TOKEN    = (os.environ.get("VOACAP_API_TOKEN") or "").strip()
START_ISO    = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def _read_file(p: Path) -> Optional[str]:
    try:
        return p.read_text().strip() or None
    except FileNotFoundError:
        return None


BIN_SHA256 = _read_file(Path("/app/.voacap_bin_sha256"))

app = FastAPI(title="Genoa VOACAP Advisory Sidecar", version="1.0.0")


# ── auth ──────────────────────────────────────────────────────────────

def check_token(authorization: Optional[str] = Header(default=None)):
    if not API_TOKEN:
        return
    if authorization != f"Bearer {API_TOKEN}":
        raise HTTPException(status_code=401, detail="Unauthorized")


# ── health / version ──────────────────────────────────────────────────

@app.get("/healthz")
def healthz():
    return {
        "ok":              VOACAP_BIN.exists() and ITSHFBC_PATH.is_dir(),
        "binary_present":  VOACAP_BIN.exists(),
        "itshfbc_present": ITSHFBC_PATH.is_dir(),
        "started_at":      START_ISO,
    }


@app.get("/version")
def version(_=Depends(check_token)):
    return {
        "engine":        "voacap",
        "binary_path":   str(VOACAP_BIN),
        "binary_sha256": BIN_SHA256,
        "itshfbc_path":  str(ITSHFBC_PATH),
        "advisory":      True,
        "filing_effect": "none",
        "license_basis": "NTIA/ITS VOACAP: 17 USC §105 (US Government public domain); "
                         "voacapl Linux port by James Watson: MIT License",
        "regulation":    "Advisory only — NOT a substitute for 47 CFR §73.190(c) / §73.182",
        "started_at":    START_ISO,
    }


# ── input model ───────────────────────────────────────────────────────

class RunPathRequest(BaseModel):
    tx_lat:           float = Field(..., ge=-90,   le=90)
    tx_lon:           float = Field(..., ge=-180,  le=180)
    rx_lat:           float = Field(..., ge=-90,   le=90)
    rx_lon:           float = Field(..., ge=-180,  le=180)
    freq_mhz:         List[float] = Field(..., min_length=1, max_length=11)
    month:            int  = Field(..., ge=1, le=12)
    ssn:              int  = Field(50, ge=0, le=300)
    power_kw:         float = Field(1.0, gt=0, le=50_000)
    required_snr_db:  float = Field(48.0, ge=0, le=120)

    @field_validator("freq_mhz")
    @classmethod
    def clamp_freq(cls, v):
        # VOACAP models HF (2–30 MHz).  Clamp up to 2 MHz minimum so
        # AM-band advisory calls (0.535–1.705 MHz) use the nearest
        # valid VOACAP frequency (2.0 MHz) as a proxy for MF skywave
        # ionospheric state.
        clamped = []
        for f in v:
            if f <= 0 or not math.isfinite(f):
                raise ValueError(f"freq_mhz must be positive finite, got {f}")
            clamped.append(max(2.0, min(30.0, f)))
        # deduplicate while preserving order
        seen = set()
        out = []
        for f in clamped:
            key = round(f, 3)
            if key not in seen:
                seen.add(key)
                out.append(round(f, 3))
        return out


# ── VOACAP input generator ────────────────────────────────────────────

def _dir_str(value: float, pos_label: str, neg_label: str) -> str:
    """Return (abs_value, direction_label) for VOACAP CIRCUIT card."""
    return (abs(value), pos_label if value >= 0 else neg_label)


def _build_input(req: RunPathRequest, title: str = "Genoa Advisory") -> str:
    tx_lat_v, tx_lat_d = _dir_str(req.tx_lat, "N", "S")
    tx_lon_v, tx_lon_d = _dir_str(req.tx_lon, "E", "W")
    rx_lat_v, rx_lat_d = _dir_str(req.rx_lat, "N", "S")
    rx_lon_v, rx_lon_d = _dir_str(req.rx_lon, "E", "W")

    freq_str = "  ".join(f"{f:.3f}" for f in req.freq_mhz)

    lines = [
        f"VOACAP  0100  {title[:60]}",
        "System             0.0000   3  89     0     0     0     0.000     0.000     0     0",
        f"CIRCUIT           {tx_lat_v:.2f} {tx_lat_d} {tx_lon_v:.2f} {tx_lon_d}  {rx_lat_v:.2f} {rx_lat_d}  {rx_lon_v:.2f} {rx_lon_d}",
        "Minimum Angle          3.000",
        f"Season                 {req.month}",
        f"SSN                   {req.ssn}",
        f"Power                  {req.power_kw:.3f}",
        "ANTENNA          1    1   30    2   0.000   0.000  gain  0.000  0.000",
        "ANTENNA          2    1   30    2   0.000   0.000  gain  0.000  0.000",
        f"FREQUENCY              {freq_str}",
        "Method                14",
        "Execute",
        "",
    ]
    return "\n".join(lines)


# ── VOACAP output parser ──────────────────────────────────────────────

def _parse_output(text: str, freqs: List[float]) -> List[dict]:
    """Parse voacapl Method 14 output into per-frequency reliability records.

    voacapl Method 14 outputs one section per frequency with 24 hourly
    reliability values (0–100) that look like:

        FREQ=  7.030 MHz
        ...
         HOUR  1  2  3 ... 24
               45 52 61 ... 50

    or in older format:

        7.030   6  50  ...
         1  2  3 ... 24
        45 52 61 ... 50

    We search for sequences of 24 integers ≤ 100 that follow a
    frequency reference line and associate them with the closest
    requested frequency.
    """
    results = []
    # Split into per-frequency blocks by looking for frequency headers.
    # Both "FREQ=  7.030" and standalone "  7.030  6  50" patterns occur.
    freq_header_re = re.compile(
        r'FREQ\s*=\s*([\d.]+)\s*MHz',
        re.IGNORECASE
    )
    # Fallback: a line beginning with the frequency value itself
    freq_bare_re = re.compile(r'^\s*([\d.]+)\s+\d+\s+\d+\s+')

    # Reliability block: a line (or two lines) of 24 integers each ≤ 100
    reliability_re = re.compile(r'(?:^|\s)(\d{1,3})(?=\s|$)')

    lines = text.splitlines()
    freq_sections: list[tuple[float, int]] = []  # (freq_mhz, line_index)

    for i, line in enumerate(lines):
        m = freq_header_re.search(line)
        if m:
            freq_sections.append((float(m.group(1)), i))
            continue
        m2 = freq_bare_re.match(line)
        if m2:
            candidate = float(m2.group(1))
            if 1.5 <= candidate <= 32.0:
                freq_sections.append((candidate, i))

    hour_label_re = re.compile(r'^\s*HOUR\b', re.IGNORECASE)

    def is_hour_labels(nums: list) -> bool:
        """Return True when nums is the sequential 1..24 hour-label row."""
        if len(nums) < 24:
            return False
        return nums[:24] == list(range(1, 25))

    def extract_24(start_line: int) -> Optional[List[int]]:
        """Look ahead from start_line for 24 reliability values.

        Skips any line that contains the 'HOUR' keyword or that is the
        sequential 1..24 hour-label row — both appear before the actual
        reliability integers in Method 14 output and would otherwise be
        mistakenly captured as reliability data.
        """
        values: List[int] = []
        for j in range(start_line, min(start_line + 30, len(lines))):
            line = lines[j]
            # Skip HOUR header lines explicitly.
            if hour_label_re.search(line):
                continue
            nums = [int(x) for x in re.findall(r'\b(\d{1,3})\b', line)
                    if int(x) <= 100]
            # Skip the sequential 1..24 hour-label row.
            if is_hour_labels(nums):
                continue
            values.extend(nums)
            if len(values) >= 24:
                return values[:24]
        return None if len(values) < 24 else values[:24]

    # Build a set of parsed results keyed by rounded freq.
    parsed: dict[float, List[int]] = {}
    for freq, line_idx in freq_sections:
        hourly = extract_24(line_idx + 1)
        if hourly and len(hourly) == 24:
            key = round(freq, 3)
            if key not in parsed:
                parsed[key] = hourly

    # Match parsed results to requested frequencies (nearest within 0.05 MHz).
    for req_f in freqs:
        best_key = None
        best_dist = float("inf")
        for k in parsed:
            d = abs(k - req_f)
            if d < best_dist:
                best_dist = d
                best_key = k
        if best_key is not None and best_dist <= 0.5:
            hourly = parsed[best_key]
            mean_rel = sum(hourly) / len(hourly)
            results.append({
                "freq_mhz":           req_f,
                "freq_mhz_used":      best_key,
                "hourly_reliability": hourly,
                "mean_reliability":   round(mean_rel, 1),
            })
        else:
            results.append({
                "freq_mhz":           req_f,
                "freq_mhz_used":      None,
                "hourly_reliability": None,
                "mean_reliability":   None,
                "note":               "voacapl produced no output for this frequency",
            })

    return results


# ── run/path endpoint ─────────────────────────────────────────────────

@app.post("/run/path")
def run_path(req: RunPathRequest, _=Depends(check_token)):
    if not VOACAP_BIN.exists():
        raise HTTPException(status_code=503, detail="voacapl binary not found")
    if not ITSHFBC_PATH.is_dir():
        raise HTTPException(status_code=503, detail=f"ITSHFBC data directory not found: {ITSHFBC_PATH}")

    inp_sha256 = hashlib.sha256(
        json.dumps(req.model_dump(), sort_keys=True).encode()
    ).hexdigest()

    input_text = _build_input(req)

    with tempfile.TemporaryDirectory() as tmpdir:
        input_path  = Path(tmpdir) / "input.dat"
        output_path = Path(tmpdir) / "output.out"
        input_path.write_text(input_text)

        env = {**os.environ, "ITSHFBC": str(ITSHFBC_PATH)}
        try:
            result = subprocess.run(
                [str(VOACAP_BIN), str(output_path), str(input_path)],
                env=env,
                capture_output=True,
                text=True,
                timeout=30,
                cwd=tmpdir,
            )
        except subprocess.TimeoutExpired:
            raise HTTPException(status_code=503, detail="voacapl timed out after 30 s")
        except OSError as e:
            raise HTTPException(status_code=503, detail=f"voacapl exec error: {e}")

        stdout = result.stdout or ""
        stderr = result.stderr or ""

        # voacapl may write output to the file argument or to stdout.
        output_text = ""
        if output_path.exists():
            output_text = output_path.read_text()
        if not output_text.strip():
            output_text = stdout

        if result.returncode != 0 and not output_text.strip():
            log.error("voacapl rc=%d stderr=%s", result.returncode, stderr[:500])
            raise HTTPException(
                status_code=502,
                detail=f"voacapl exited with code {result.returncode}: {stderr[:200]}"
            )

    freq_results = _parse_output(output_text, req.freq_mhz)

    # Great-circle distance (approximate, for provenance context).
    def gc_km(la1, lo1, la2, lo2):
        R = 6371.0
        la1, lo1, la2, lo2 = map(math.radians, [la1, lo1, la2, lo2])
        dlat = la2 - la1
        dlon = lo2 - lo1
        a = math.sin(dlat/2)**2 + math.cos(la1)*math.cos(la2)*math.sin(dlon/2)**2
        return 2 * R * math.asin(min(1, math.sqrt(a)))

    dist_km = round(gc_km(req.tx_lat, req.tx_lon, req.rx_lat, req.rx_lon), 1)

    return {
        "advisory":       True,
        "filing_effect":  "none",
        "engine":         "voacap",
        "available":      True,
        "status":         "ok",
        "inp_sha256":     inp_sha256,
        "binary_sha256":  BIN_SHA256,
        "month":          req.month,
        "ssn":            req.ssn,
        "power_kw":       req.power_kw,
        "distance_km":    dist_km,
        "results":        freq_results,
        "note": (
            "Frequencies below 2 MHz (AM band) were clamped to 2.0 MHz; "
            "reliability values serve as a proxy for MF skywave ionospheric state."
            if any(f < 2.0 for f in req.freq_mhz) else None
        ),
    }
