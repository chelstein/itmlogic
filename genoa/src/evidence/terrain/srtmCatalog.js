// SRTM-3 tile catalog helpers — pure functions, no side effects.
//
// Two operations the provisioner cares about:
//   tilesForBounds({lat, lon, radius_km})  — given a tx + radius, return
//   the list of 1°×1° SRTM-3 tiles that need to be staged on the sidecar
//   so SPLAT has terrain coverage out to that radius.
//
//   parseSdfName(sdfName)  — given a .sdf filename produced by srtm2sdf
//   (e.g. "40:41:73:74.sdf"), return the lat/lon bounds it covers so the
//   provisioner can match an existing sidecar tile against a requested
//   .hgt name.  SPLAT writes longitudes in WEST-POSITIVE form in these
//   filenames, opposite of mathematical convention.
//
// Tile naming conventions:
//   .hgt source:  N40W074.hgt  → covers lat 40..41, lon -74..-73 (W)
//   .sdf output:  40:41:73:74.sdf  (lat_lo:lat_hi:lon_lo:lon_hi, W-pos)
//
// The conversion is deterministic so a "do we already have this tile?"
// check is just two function calls + a string compare.

const EARTH_R_KM = 6371.0088;

// ------------------------------------------------------------------
// Tile naming
// ------------------------------------------------------------------

// Build the SRTM .hgt filename that covers integer lat/lon.  Tiles are
// named after their SOUTHWEST corner — so a tile named N40W074 covers
// 40°N..41°N and 74°W..73°W.
export function hgtNameFor(lat_int, lon_int){
  const ns   = lat_int >= 0 ? 'N' : 'S';
  const ew   = lon_int >= 0 ? 'E' : 'W';
  const latS = String(Math.abs(lat_int)).padStart(2, '0');
  const lonS = String(Math.abs(lon_int)).padStart(3, '0');
  return `${ns}${latS}${ew}${lonS}.hgt`;
}

// Inverse of hgtNameFor.  Returns { lat, lon } for the tile's SW corner.
// Tolerates the .zip suffix that mirrors add.
export function parseHgtName(name){
  const m = /^([NS])(\d{2})([EW])(\d{3})\.(?:hgt|bil)(?:\.zip)?$/i.exec(name);
  if (!m) return null;
  const lat = (m[1].toUpperCase() === 'N' ? 1 : -1) * Number(m[2]);
  const lon = (m[3].toUpperCase() === 'E' ? 1 : -1) * Number(m[4]);
  return { lat, lon };
}

// Parse an SDF filename written by srtm2sdf.  These use W-positive
// longitudes — `40:41:73:74.sdf` means lat 40..41, lon 74..73 W.  We
// return mathematical (E-positive) coords so callers can compare
// directly against parseHgtName().
export function parseSdfName(name){
  const m = /^(-?\d+):(-?\d+):(-?\d+):(-?\d+)\.sdf$/.exec(name);
  if (!m) return null;
  const lat_lo = Number(m[1]);
  const lat_hi = Number(m[2]);
  const lon_lo_w = Number(m[3]);
  const lon_hi_w = Number(m[4]);
  // Flip W-positive back to E-positive math.  SPLAT's lon_lo > lon_hi
  // when traversing west-to-east, so the SW corner has the larger
  // W-positive value.  Pick the more western one for the SW corner.
  const sw_lon_e = -Math.max(lon_lo_w, lon_hi_w);
  const sw_lat   = Math.min(lat_lo, lat_hi);
  return { lat: sw_lat, lon: sw_lon_e };
}

// ------------------------------------------------------------------
// Tiles needed for a tx + radius
// ------------------------------------------------------------------

// Compute the integer lat/lon bounding box that contains a circle of
// radius_km centred on (lat, lon).  At higher latitudes a degree of
// longitude is shorter than a degree of latitude, so we widen the
// longitude bounds by the cos(lat) factor.
export function bboxFor({ lat, lon, radius_km }){
  const lat_deg = Math.abs(radius_km / 111.0);                    // 1° ≈ 111 km
  const lon_deg = Math.abs(radius_km / (111.0 * Math.max(0.05, Math.cos(lat * Math.PI / 180))));
  return {
    lat_min: Math.floor(lat - lat_deg),
    lat_max: Math.floor(lat + lat_deg),
    lon_min: Math.floor(lon - lon_deg),
    lon_max: Math.floor(lon + lon_deg),
  };
}

// Enumerate every SRTM-3 tile (.hgt name) needed to cover the bounding
// box of a tx + radius.  Returns a list of { name, lat, lon } where
// (lat, lon) is the tile's SW corner.
export function tilesForBounds({ lat, lon, radius_km }){
  if (!Number.isFinite(lat) || !Number.isFinite(lon)){
    return [];
  }
  const r = Math.max(0, Number(radius_km) || 0);
  const bb = bboxFor({ lat, lon, radius_km: r });
  const out = [];
  for (let y = bb.lat_min; y <= bb.lat_max; y++){
    for (let x = bb.lon_min; x <= bb.lon_max; x++){
      // Skip impossible coords.
      if (y < -56 || y > 60) continue;     // SRTM coverage is roughly 56°S..60°N
      if (x < -180 || x > 179) continue;
      out.push({ name: hgtNameFor(y, x), lat: y, lon: x });
    }
  }
  return out;
}

// ------------------------------------------------------------------
// Coverage check
// ------------------------------------------------------------------

// Given the sidecar's current SDF inventory (the array returned by
// splatClient.listSdfTiles().tiles), return the subset of `requested`
// tiles that are NOT yet provisioned.  Cheap O(n+m) set membership.
export function missingFrom(requested, sdfInventory){
  const have = new Set();
  for (const t of (sdfInventory || [])){
    const c = parseSdfName(String(t?.name || ''));
    if (c) have.add(`${c.lat}:${c.lon}`);
  }
  return requested.filter(t => !have.has(`${t.lat}:${t.lon}`));
}

// ------------------------------------------------------------------
// Mirror URL templates
// ------------------------------------------------------------------

// Public SRTM-3 mirrors.  The `urlFor` function picks one based on
// SRTM_TILE_URL_TEMPLATE — operator can override, default points at
// ESA STEP since it's been reliable for years and serves vanilla
// SRTMGL3 v3 tiles.
const DEFAULT_URL_TEMPLATE = 'https://step.esa.int/auxdata/dem/SRTMGL3/{name}.SRTMGL3.hgt.zip';

export function urlFor(hgtName, template = process.env.SRTM_TILE_URL_TEMPLATE || DEFAULT_URL_TEMPLATE){
  // SRTM tile names come in as `N40W074.hgt`.  Strip the .hgt suffix
  // before substitution because most mirror URL conventions append it
  // themselves (e.g. ESA STEP → `<base>.SRTMGL3.hgt.zip`).
  const stem = hgtName.replace(/\.(hgt|bil)(\.zip)?$/i, '');
  return template.replace('{name}', stem);
}
