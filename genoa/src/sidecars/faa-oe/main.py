"""Genoa FAA OE sidecar — scrapes oeaaa.faa.gov for OE/AAA case files.

ENDPOINTS
  GET  /health                  → liveness + FAA host reachability
  GET  /api/v1/oe/{asn}         → FAA OE/AAA case file, normalized JSON

AUTH
  When FAA_OE_API_TOKEN is set, all endpoints except /health require
  Authorization: Bearer <token>.  Same pattern as FCCAM and ASR sidecars.

WHY A SIDECAR
  The FAA does not publish a JSON API for OE/AAA.  Case file data lives
  at oeaaa.faa.gov/oeaaa/external/searchAction.jsp?action=showCaseFile
  &studyId={asn} as HTML.  This sidecar scrapes and normalizes that page
  into clean JSON so faaOeClient.js can parse a stable contract.

OUTPUT SHAPE (per faaOeClient.js normalizeFaaOeRecord)
  {
    available, study_number, determination, determination_date,
    expiration_date, structure_type, latitude_deg, longitude_deg,
    height_agl_m, height_amsl_m, conditions: [str], hazard_summary
  }

DETERMINATION VALUES
  'DNH'         — No Hazard
  'DOH'         — Hazard
  'CONDITIONAL' — Conditional No Hazard
  'WITHDRAWN'   — Withdrawn
  'PENDING'     — Pending / not yet adjudicated

REGULATORY CITATIONS
  - 47 CFR §17.7  — structures subject to FAA notification
  - 47 CFR §17.17 — application of FAA determination
  - FAA Order JO 7400.2 §6-3-3 — DNH expiration (18 months)
  - FAA Advisory Circular AC 70/7460-1M — obstruction marking/lighting
"""

import os
import re
import time
from typing import Optional

import requests
from bs4 import BeautifulSoup
from fastapi import Depends, FastAPI, Header, HTTPException

# ---------------------------------------------------------------------------
# config
# ---------------------------------------------------------------------------

API_TOKEN      = (os.environ.get("FAA_OE_API_TOKEN") or "").strip()
FAA_OE_ROOT    = "https://oeaaa.faa.gov/oeaaa/external"
CASE_FILE_URL  = FAA_OE_ROOT + "/searchAction.jsp?action=showCaseFile&studyId={asn}"

SESSION_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (compatible; Genoa-FAA-OE-Sidecar/1.0; "
        "+https://github.com/chelstein/itmlogic)"
    ),
    "Accept": "text/html,application/xhtml+xml",
}

SCRAPE_TIMEOUT_S = 15
START_ISO = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

# ---------------------------------------------------------------------------
# auth dependency
# ---------------------------------------------------------------------------

def require_token(authorization: Optional[str] = Header(default=None)):
    if not API_TOKEN:
        return
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="bearer token required")
    given = authorization.split(" ", 1)[1].strip()
    if given != API_TOKEN:
        raise HTTPException(status_code=401, detail="bad token")


# ---------------------------------------------------------------------------
# HTML scraper
# ---------------------------------------------------------------------------

def _scrape_case_file(asn: str) -> dict:
    url = CASE_FILE_URL.format(asn=requests.utils.quote(str(asn), safe=""))
    try:
        resp = requests.get(url, headers=SESSION_HEADERS, timeout=SCRAPE_TIMEOUT_S)
    except requests.exceptions.Timeout:
        return {"available": False, "error": "FAA OE/AAA request timed out", "endpoint": url}
    except requests.exceptions.RequestException as e:
        return {"available": False, "error": f"FAA OE/AAA request failed: {e}", "endpoint": url}

    if resp.status_code == 404:
        return {"available": False, "error": "ASN not found on oeaaa.faa.gov", "endpoint": url}
    if resp.status_code != 200:
        return {
            "available": False,
            "error": f"FAA OE/AAA returned HTTP {resp.status_code}",
            "endpoint": url,
        }

    return _parse_case_html(resp.text, asn=asn, endpoint=url)


def _parse_case_html(html: str, *, asn: str, endpoint: str) -> dict:
    soup = BeautifulSoup(html, "lxml")

    # Check for "not found" / "no results" page signals.
    body_text = soup.get_text(separator=" ", strip=True).lower()
    if "no results" in body_text and "study" not in body_text:
        return {"available": False, "error": "ASN not found (no results page)", "endpoint": endpoint}

    # Build a flat label→value map from all <th>/<td> and <label>/<span>
    # pairs in the page tables.  The FAA OE/AAA JSP renders data in both
    # <table> and <dl>/<dt>/<dd> structures depending on the vintage.
    lv: dict[str, str] = {}
    for table in soup.find_all("table"):
        rows = table.find_all("tr")
        for row in rows:
            cells = row.find_all(["th", "td"])
            if len(cells) >= 2:
                label = cells[0].get_text(separator=" ", strip=True)
                value = cells[1].get_text(separator=" ", strip=True)
                if label:
                    lv[label.lower()] = value
            # Also handle rows where the first td is a label class
            if len(cells) == 1 and cells[0].get("class"):
                continue
    # <dl><dt>label</dt><dd>value</dd></dl>
    for dl in soup.find_all("dl"):
        for dt in dl.find_all("dt"):
            dd = dt.find_next_sibling("dd")
            if dd:
                lv[dt.get_text(strip=True).lower()] = dd.get_text(strip=True)

    # ---------------------------------------------------------------------------
    # field extraction
    # ---------------------------------------------------------------------------

    study_number   = _first(lv, ["aeronautical study number", "study number", "case number", "asn"]) or str(asn)
    raw_determ     = _first(lv, ["outcome", "determination", "case outcome", "final determination", "status"])
    determination  = _normalize_determination(raw_determ)
    det_date       = _parse_date(_first(lv, ["date issued", "issue date", "determination date", "issued"]))
    exp_date       = _parse_date(_first(lv, ["expiration date", "expires", "date expires", "valid through"]))
    struct_type    = _first(lv, ["structure type", "type of structure", "structure"])
    lat_raw        = _first(lv, ["latitude", "lat"])
    lon_raw        = _first(lv, ["longitude", "long", "lon"])
    lat_deg        = _parse_dms(lat_raw)
    lon_deg        = _parse_dms(lon_raw)
    agl_raw        = _first(lv, ["height agl", "agl height", "height above ground", "agl"])
    amsl_raw       = _first(lv, ["height amsl", "amsl height", "height above msl", "amsl", "elevation amsl"])
    height_agl_m   = _feet_to_m(_extract_feet(agl_raw))
    height_amsl_m  = _feet_to_m(_extract_feet(amsl_raw))

    # Conditions / remarks — often in a separate <ul>/<ol> or <div>
    conditions = _extract_conditions(soup)
    hazard_summary = _first(lv, ["hazard summary", "summary", "remarks", "findings"]) or None
    if not hazard_summary and determination == "DOH":
        hazard_summary = raw_determ  # surface the raw determination text for DOH

    # Validity check — if we couldn't extract a determination the page is
    # either a login redirect, a "no results" page, or an HTML structure
    # change.  study_number falls back to the caller's ASN so it is never
    # a reliable signal; determination is the authoritative gate.
    if not determination:
        return {
            "available": False,
            "error": "Could not parse FAA OE/AAA case file — determination not found (page structure unrecognized or login redirect)",
            "endpoint": endpoint,
            "html_snippet": html[:500],
        }

    return {
        "available":          True,
        "source":             "faa-oe-sidecar",
        "endpoint":           endpoint,
        "study_number":       study_number,
        "determination":      determination,
        "determination_date": det_date,
        "expiration_date":    exp_date,
        "structure_type":     struct_type,
        "latitude_deg":       lat_deg,
        "longitude_deg":      lon_deg,
        "height_agl_m":       height_agl_m,
        "height_amsl_m":      height_amsl_m,
        "conditions":         conditions,
        "hazard_summary":     hazard_summary,
    }


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------

def _first(lv: dict, keys: list) -> Optional[str]:
    for k in keys:
        if k in lv and lv[k]:
            return lv[k]
    return None


def _normalize_determination(raw: Optional[str]) -> Optional[str]:
    if not raw:
        return None
    s = raw.upper().strip()
    if "NO HAZARD" in s or "DNH" in s:
        if "CONDITIONAL" in s:
            return "CONDITIONAL"
        return "DNH"
    if "HAZARD" in s or "DOH" in s:
        return "DOH"
    if "CONDITIONAL" in s:
        return "CONDITIONAL"
    if "WITHDRAWN" in s or "WITHDRAW" in s:
        return "WITHDRAWN"
    if "PENDING" in s or "IN PROCESS" in s:
        return "PENDING"
    return raw.strip() or None


def _parse_date(raw: Optional[str]) -> Optional[str]:
    """Convert M/D/YYYY or MM/DD/YYYY to ISO YYYY-MM-DD.  Returns None on failure."""
    if not raw:
        return None
    # Common US date format: 01/15/2024 or 1/15/2024
    m = re.search(r"(\d{1,2})[/\-](\d{1,2})[/\-](\d{4})", raw)
    if m:
        mo, dy, yr = m.group(1), m.group(2), m.group(3)
        return f"{yr}-{int(mo):02d}-{int(dy):02d}"
    # ISO already: 2024-01-15
    m = re.search(r"(\d{4})[/\-](\d{1,2})[/\-](\d{1,2})", raw)
    if m:
        yr, mo, dy = m.group(1), m.group(2), m.group(3)
        return f"{yr}-{int(mo):02d}-{int(dy):02d}"
    return None


def _parse_dms(raw: Optional[str]) -> Optional[float]:
    """Parse DMS 40-44-54.4N or decimal 40.748444; returns signed decimal degrees."""
    if not raw:
        return None
    s = raw.strip()
    # DMS with hyphens or degrees-minutes-seconds: 40-44-54.4 N
    m = re.match(
        r"(-?\d+)[\-°d]\s*(\d+)[\-'m]\s*(\d+(?:\.\d+)?)[\"s]?\s*([NSEW]?)",
        s, re.IGNORECASE
    )
    if m:
        deg = int(m.group(1))
        mn  = int(m.group(2))
        sec = float(m.group(3))
        hem = m.group(4).upper()
        dd = deg + mn / 60 + sec / 3600
        if hem in ("S", "W"):
            dd = -dd
        return round(dd, 6)
    # Decimal degrees with optional hemisphere: 40.748444 or -111.886139
    m = re.match(r"(-?\d+\.\d+)\s*([NSEW]?)", s, re.IGNORECASE)
    if m:
        dd = float(m.group(1))
        hem = m.group(2).upper()
        if hem in ("S", "W"):
            dd = -abs(dd)
        return round(dd, 6)
    return None


def _extract_feet(raw: Optional[str]) -> Optional[float]:
    """Pull the first number from a string like '180 Feet AGL' or '4,480'."""
    if not raw:
        return None
    cleaned = raw.replace(",", "")
    m = re.search(r"-?\d+(?:\.\d+)?", cleaned)
    if m:
        try:
            return float(m.group(0))
        except ValueError:
            return None
    return None


def _feet_to_m(feet: Optional[float]) -> Optional[float]:
    if feet is None:
        return None
    return round(feet * 0.3048, 2)


def _extract_conditions(soup: BeautifulSoup) -> list:
    """Pull conditions / lighting & marking requirements from the HTML.

    The FAA OE page lists conditions in different ways depending on the
    determination vintage:
      - <ul>/<ol> with <li> items near a "Conditions" heading
      - A table section labelled "Conditions" or "Remarks"
      - A <div class="conditions"> block
    We try all three and return the first non-empty list.
    """
    # Look for a heading that says "Conditions" or "Remarks"
    for heading_tag in ["h2", "h3", "h4", "b", "strong", "th", "td"]:
        for el in soup.find_all(heading_tag):
            text = el.get_text(strip=True).lower()
            if "condition" in text or "remark" in text or "lighting" in text:
                # Collect the next sibling list or paragraphs
                nxt = el.find_next_sibling()
                if nxt and nxt.name in ("ul", "ol"):
                    items = [li.get_text(strip=True) for li in nxt.find_all("li") if li.get_text(strip=True)]
                    if items:
                        return items
                # Also check if conditions are in a following table row
                parent = el.parent
                if parent and parent.name == "td":
                    row = parent.parent
                    nxt_row = row.find_next_sibling("tr")
                    if nxt_row:
                        items = [td.get_text(strip=True) for td in nxt_row.find_all("td") if td.get_text(strip=True)]
                        if items:
                            return items

    # Fallback: any <ul>/<ol> with 3+ items (typical conditions block)
    for ul in soup.find_all(["ul", "ol"]):
        items = [li.get_text(strip=True) for li in ul.find_all("li") if li.get_text(strip=True)]
        if len(items) >= 3:
            return items

    return []


# ---------------------------------------------------------------------------
# app
# ---------------------------------------------------------------------------

app = FastAPI(title="genoa-faa-oe-sidecar", version="1.0.0")


@app.get("/health")
def health():
    """Liveness probe — also checks FAA OE host reachability."""
    faa_reachable = False
    try:
        r = requests.get(
            FAA_OE_ROOT + "/searchAction.jsp?action=showSearchAcceptedDeterminations",
            headers=SESSION_HEADERS,
            timeout=5,
            allow_redirects=False,
        )
        faa_reachable = r.status_code < 600
    except Exception:
        pass
    return {
        "ok":            True,
        "faa_reachable": faa_reachable,
        "started_at":    START_ISO,
        "regulation":    "47 CFR §17.7 / §17.17",
    }


@app.get("/api/v1/oe/{asn}", dependencies=[Depends(require_token)])
def get_oe_case(asn: str):
    """Fetch and normalize an FAA OE/AAA case file by Aeronautical Study Number."""
    asn = asn.strip()
    if not asn:
        raise HTTPException(status_code=400, detail="asn is required")
    result = _scrape_case_file(asn)
    if not result.get("available"):
        raise HTTPException(status_code=404, detail=result.get("error", "not found"))
    return result
