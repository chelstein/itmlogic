// FCC FMQ / AMQ direct fallback for callsign lookup.
//
// PURPOSE
//   Genoa's primary facility source is chelstein/zerotrustradio.  When
//   ZTR returns zero rows (e.g. a legacy / historical / out-of-catalog
//   call sign like KDKB), Genoa falls back to the FCC's public
//   pipe-delimited dump at:
//
//     https://transition.fcc.gov/fcc-bin/fmq?call=<call>&list=4   (FM/LPFM/FX)
//     https://transition.fcc.gov/fcc-bin/amq?call=<call>&list=4   (AM)
//
//   This is the same source Radio-Locator and other third-party tools
//   scrape under the hood.  Public, no auth, deterministic — perfect
//   for a fallback evidence path.
//
// PARSING
//   Each row is `|`-delimited with fixed column positions.  Columns are
//   right-padded with spaces; we trim every cell.  The exact field
//   lineup differs slightly between FMQ and AMQ:
//
//   FMQ (list=4):
//     1  callsign
//     2  frequency (e.g. "100.7 MHz")
//     3  service       (FM, FX, FS, FB, FL, FT)
//     4  channel
//     5  pattern       (DA / ND)
//     6  polarization  (H / V / C)
//     7  FCC class     (A, B, B1, C, C1, C2, C3, C0, D, L1)
//     8  status code
//     9  status        (LIC / CP)
//     10 city
//     11 state
//     12 country code
//     13 file number
//     14 ERP H         ("100. kW")
//     15 ERP V or "Directional"
//     16 HAAT H (m)
//     17 HAAT V (m)
//     18 facility_id
//     19 N|S    20 deg    21 min    22 sec
//     23 W|E    24 deg    25 min    26 sec
//     27 licensee
//
//   AMQ (list=4):
//     1  callsign
//     2  frequency ("1030 kHz")
//     3  service ("AM")
//     4  channel (blank)
//     5  time period  (DAY / NIG / UNL)
//     6  time period verbose
//     7  FCC class    (A / B / C / D)
//     8  night class
//     9  status       (LIC / CP)
//     10 city
//     11 state
//     12 country code
//     13 file number
//     14 ERP day/night kW
//     15 "Directional" / blank
//     16 augmentation indicator (NOT haat — AM is groundwave)
//     17 (blank)
//     18 facility_id
//     19 N|S    20 deg    21 min    22 sec
//     23 W|E    24 deg    25 min    26 sec
//     27 licensee
//
// OUTPUT SHAPE
//   Returns a list of `facility` objects matching the same shape as the
//   ZTR-normalized row (call, facility_id, service, fcc_class,
//   frequency, frequency_unit, erp_kw, haat_m, lat, lon, city, state,
//   country_code, licensee, status, facility_lookup_source { upstream:
//   'fcc-fmq' | 'fcc-amq', endpoint, fetched_at }).  Fields that the
//   FCC dump doesn't carry stay null — never fabricate.

const FMQ_BASE = 'https://transition.fcc.gov/fcc-bin/fmq';
const AMQ_BASE = 'https://transition.fcc.gov/fcc-bin/amq';
const DEFAULT_TIMEOUT_MS = 12_000;

const KIND_TO_SERVICE = {
  FM:   'FM',
  FX:   'FX',         // FM translator
  FB:   'FX',         // FM booster (treat as translator-class)
  FS:   'FM',         // FM auxiliary station — treated as FM
  FT:   'FX',
  FL:   'LPFM',       // legacy LPFM service code
  L1:   'LPFM',
  AM:   'AM'
};

export function makeFccFmqClient({
  fmqUrl    = FMQ_BASE,
  amqUrl    = AMQ_BASE,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  fetchFn   = (typeof fetch === 'function' ? fetch : null)
} = {}){
  if (!fetchFn) return null;

  return {
    fmqUrl, amqUrl,

    async searchByCallsign(call){
      const cs = String(call || '').trim().toUpperCase();
      if (cs.length < 2){
        return { rows: [], source: null, error: 'callsign must be at least 2 characters' };
      }
      // Hit FMQ and AMQ in parallel; merge results.
      const [fm, am] = await Promise.all([
        fetchFmq(cs, fmqUrl, timeoutMs, fetchFn),
        fetchAmq(cs, amqUrl, timeoutMs, fetchFn)
      ]);
      const errs = [fm.error, am.error].filter(Boolean);
      const rows = [...(fm.rows || []), ...(am.rows || [])];
      // Dedupe by (callsign, service, facility_id).  FMQ tends to
      // return one row per license action; we want one row per facility.
      const seen = new Set();
      const dedup = [];
      for (const r of rows){
        const k = `${r.call}|${r.service}|${r.facility_id || ''}`;
        if (seen.has(k)) continue;
        seen.add(k);
        dedup.push(r);
      }
      if (dedup.length === 0 && errs.length === 2){
        return { rows: [], source: null, error: errs.join('; ') };
      }
      return {
        rows:   dedup,
        count:  dedup.length,
        source: 'fcc-fmq+amq'
      };
    }
  };
}

async function fetchFmq(call, baseUrl, timeoutMs, fetchFn){
  const url = `${baseUrl}?call=${encodeURIComponent(call)}&list=4`;
  try {
    const r = await fetchFn(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!r.ok) return { rows: [], error: `HTTP ${r.status} from FMQ` };
    const text = await r.text();
    const rows = text.split(/\r?\n/)
      .map(line => parseRow(line, /* isAm = */ false, url))
      .filter(Boolean);
    return { rows };
  } catch (e){
    return { rows: [], error: `FMQ fetch failed: ${e.message}` };
  }
}

async function fetchAmq(call, baseUrl, timeoutMs, fetchFn){
  const url = `${baseUrl}?call=${encodeURIComponent(call)}&list=4`;
  try {
    const r = await fetchFn(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!r.ok) return { rows: [], error: `HTTP ${r.status} from AMQ` };
    const text = await r.text();
    const rows = text.split(/\r?\n/)
      .map(line => parseRow(line, /* isAm = */ true, url))
      .filter(Boolean);
    return { rows };
  } catch (e){
    return { rows: [], error: `AMQ fetch failed: ${e.message}` };
  }
}

/* -------------------- parser -------------------- */

export function parseRow(line, isAm, endpoint){
  if (!line || !line.includes('|')) return null;
  // Split on `|`.  A row "|A|B|C|" becomes ['', 'A', 'B', 'C', ''] —
  // strip the leading and trailing empty cells.
  const parts = line.split('|');
  if (parts.length < 27) return null;
  const c = parts.slice(1).map(s => s.trim());
  // c[0]..c[26] is the contiguous data block (FMQ has more cols past
  // 27 for tower / antenna registration; we don't need them).
  const callsign = c[0];
  if (!callsign) return null;

  // Frequency: "100.7  MHz" or "1030  kHz"
  const freq = parseFrequency(c[1]);
  if (!freq) return null;

  const serviceCode = (c[2] || '').toUpperCase();
  const service = KIND_TO_SERVICE[serviceCode] || (isAm ? 'AM' : null);
  if (!service) return null;

  // Status: AMQ has it at c[8], FMQ has it at c[8] too.
  const status = (c[8] || '').toUpperCase();
  // Skip non-active records (CANCEL, EXPIRED, etc.); keep LIC and CP.
  if (status && !/^(LIC|CP|MOD|MOD-LIC)/.test(status)) return null;

  const city = c[9] || null;
  const state = c[10] || null;
  const country_code = c[11] || null;
  const erp_kw = parseErp(c[13]);
  const haat_m = isAm ? null : parseFloatField(c[15]);
  const facility_id = (c[17] || '').replace(/^0+/, '') || c[17] || null;

  const lat_hemi = c[18];
  const lat = parseDms(lat_hemi, c[19], c[20], c[21]);
  const lon_hemi = c[22];
  const lon = parseDmsLon(lon_hemi, c[23], c[24], c[25]);

  const fcc_class = (c[6] || '').trim() || null;
  const licensee = c[26] || null;

  // Pattern: FMQ col 5 carries DA / ND for directional vs
  // non-directional FM antennas.  AMQ col 5 is a time period (DAY /
  // NIG / UNL) — not a pattern — so we don't attempt to derive
  // pattern_mode for AM here (AM directionality lives in pattern
  // tables filed separately under §73.151).
  const patternCode = (c[4] || '').trim().toUpperCase();
  const pattern_mode = isAm ? null
                            : (patternCode === 'DA' ? 'DA' : 'ND');

  return {
    facility_id:    facility_id || null,
    call:           callsign,
    station_name:   null,
    service,
    fcc_class,
    pattern_mode,
    frequency:      freq.value,
    frequency_unit: freq.unit,
    erp_kw,
    haat_m,
    lat,
    lon,
    city,
    state,
    country_code,
    licensee,
    status:         status || null,
    facility_lookup_source: {
      upstream:              isAm ? 'fcc-amq' : 'fcc-fmq',
      endpoint:              endpoint || null,
      fetched_at:            new Date().toISOString(),
      upstream_source_field: 'fcc'
    }
  };
}

function parseFrequency(s){
  if (!s) return null;
  const m = s.match(/^([\d.]+)\s*(MHz|kHz)$/i);
  if (!m) return null;
  const v = parseFloat(m[1]);
  if (!Number.isFinite(v)) return null;
  return { value: v, unit: m[2].toLowerCase() === 'khz' ? 'kHz' : 'MHz' };
}

function parseErp(s){
  if (!s) return null;
  const m = String(s).match(/([\d.]+)/);
  if (!m) return null;
  const v = parseFloat(m[1]);
  return Number.isFinite(v) ? v : null;
}

function parseFloatField(s){
  if (!s) return null;
  const v = parseFloat(s);
  return Number.isFinite(v) ? v : null;
}

function parseDms(hemi, deg, min, sec){
  const d = parseFloat(deg), m = parseFloat(min), sx = parseFloat(sec);
  if (!Number.isFinite(d) || !Number.isFinite(m) || !Number.isFinite(sx)) return null;
  const v = d + m/60 + sx/3600;
  if (!Number.isFinite(v)) return null;
  return (String(hemi).toUpperCase() === 'S') ? -v : v;
}

function parseDmsLon(hemi, deg, min, sec){
  const d = parseFloat(deg), m = parseFloat(min), sx = parseFloat(sec);
  if (!Number.isFinite(d) || !Number.isFinite(m) || !Number.isFinite(sx)) return null;
  const v = d + m/60 + sx/3600;
  if (!Number.isFinite(v)) return null;
  // FCC convention: W is positive in the dump but Genoa convention is
  // negative longitude west of Greenwich.
  return (String(hemi).toUpperCase() === 'W') ? -v : v;
}
