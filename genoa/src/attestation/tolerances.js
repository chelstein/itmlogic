// Source Attestation Framework v2 — per-field tolerance rules.
//
// Deterministic disagreement thresholds for every filing-relevant
// field.  A pair of candidate values whose delta exceeds BOTH the
// absolute and relative tolerance (when both are defined; either one
// alone when only one is defined) is a conflict.
//
// Special comparators:
//   'distance_m'  — coordinates: delta is geodesic ground distance in
//                   meters (NOT decimal-degree delta).
//   'exact'       — categorical fields (class, channel, facility_id):
//                   any mismatch (case-insensitive string compare) conflicts.
//   'pattern'     — antenna pattern: compared by canonical hash.
//
// blocker_if_primary_missing: when true and no PRIMARY-authority
// candidate exists for the field, the resolver raises
// PRIMARY_SOURCE_MISSING as a blocker instead of a warning.

export const FIELD_TOLERANCES = Object.freeze({
  coordinates_lat_lon: Object.freeze({
    comparator:                'distance_m',
    absolute_tolerance:        10,            // meters ground distance
    conflict_code:             'SOURCE_CONFLICT_COORDINATES',
    blocker_if_primary_missing: true
  }),
  haat_m: Object.freeze({
    absolute_tolerance:        3,
    relative_tolerance_pct:    1,
    conflict_code:             'SOURCE_CONFLICT_HAAT',
    blocker_if_primary_missing: true
  }),
  rcamsl_m: Object.freeze({
    absolute_tolerance:        3,
    relative_tolerance_pct:    1,
    conflict_code:             'SOURCE_CONFLICT_RCAMSL',
    blocker_if_primary_missing: false
  }),
  ground_elevation_m: Object.freeze({
    absolute_tolerance:        5,
    relative_tolerance_pct:    2,
    conflict_code:             'SOURCE_CONFLICT',
    blocker_if_primary_missing: false
  }),
  erp_kw: Object.freeze({
    absolute_tolerance:        0.05,
    relative_tolerance_pct:    5,
    conflict_code:             'SOURCE_CONFLICT',
    blocker_if_primary_missing: true
  }),
  frequency_mhz: Object.freeze({
    absolute_tolerance:        0.001,          // 1 kHz — frequency is effectively exact
    conflict_code:             'SOURCE_CONFLICT',
    blocker_if_primary_missing: true
  }),
  channel: Object.freeze({
    comparator:                'exact',
    conflict_code:             'SOURCE_CONFLICT',
    blocker_if_primary_missing: false
  }),
  fcc_class: Object.freeze({
    comparator:                'exact',
    conflict_code:             'SOURCE_CONFLICT',
    blocker_if_primary_missing: true
  }),
  facility_id: Object.freeze({
    comparator:                'exact',
    conflict_code:             'SOURCE_CONFLICT',
    blocker_if_primary_missing: true
  }),
  asr_height_agl_m: Object.freeze({
    absolute_tolerance:        3,              // §17.4 registration tolerance
    conflict_code:             'SOURCE_CONFLICT_ASR_HEIGHT',
    blocker_if_primary_missing: false
  }),
  asr_height_amsl_m: Object.freeze({
    absolute_tolerance:        3,
    conflict_code:             'SOURCE_CONFLICT_ASR_HEIGHT',
    blocker_if_primary_missing: false
  }),
  tower_coordinates: Object.freeze({
    comparator:                'distance_m',
    absolute_tolerance:        10,
    conflict_code:             'SOURCE_CONFLICT_COORDINATES',
    blocker_if_primary_missing: false
  }),
  antenna_pattern: Object.freeze({
    comparator:                'pattern',
    conflict_code:             'SOURCE_CONFLICT',
    blocker_if_primary_missing: false
  })
});

// Default rule when a field key has no registered tolerance:
// numeric values conflict over 1% relative delta; non-numeric over
// exact mismatch.  Keeps the resolver total — every field resolves.
export const DEFAULT_TOLERANCE = Object.freeze({
  relative_tolerance_pct:    1,
  conflict_code:             'SOURCE_CONFLICT',
  blocker_if_primary_missing: false
});

export function toleranceFor(key){
  return FIELD_TOLERANCES[key] || DEFAULT_TOLERANCE;
}

// ---- comparators ----

const EARTH_M_PER_DEG_LAT = 111_320;

/** Geodesic-ish ground distance (m) between two {lat,lon} points (small deltas). */
export function coordDistanceM(a, b){
  if (!a || !b || !Number.isFinite(a.lat) || !Number.isFinite(a.lon) ||
      !Number.isFinite(b.lat) || !Number.isFinite(b.lon)) return null;
  const midLat = (a.lat + b.lat) / 2;
  const mLon = EARTH_M_PER_DEG_LAT * Math.cos(midLat * Math.PI / 180);
  const dx = (a.lon - b.lon) * mLon;
  const dy = (a.lat - b.lat) * EARTH_M_PER_DEG_LAT;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Compare two candidate values under a field's tolerance rule.
 * Returns { conflict, delta, tolerance } — delta/tolerance units depend
 * on the comparator (meters for distance_m, value units for numeric,
 * null for exact/pattern comparators).
 */
export function compareValues(key, a, b){
  const rule = toleranceFor(key);

  if (rule.comparator === 'distance_m'){
    const d = coordDistanceM(a, b);
    if (d == null) return { conflict: false, delta: null, tolerance: rule.absolute_tolerance };
    return { conflict: d > rule.absolute_tolerance, delta: +d.toFixed(1), tolerance: rule.absolute_tolerance };
  }

  if (rule.comparator === 'exact'){
    const sa = a == null ? '' : String(a).trim().toUpperCase();
    const sb = b == null ? '' : String(b).trim().toUpperCase();
    return { conflict: sa !== sb, delta: null, tolerance: null };
  }

  if (rule.comparator === 'pattern'){
    // Pattern values are compared by canonical-JSON identity.
    const sa = JSON.stringify(a ?? null);
    const sb = JSON.stringify(b ?? null);
    return { conflict: sa !== sb, delta: null, tolerance: null };
  }

  // Numeric comparator (default)
  const na = Number(a), nb = Number(b);
  if (!Number.isFinite(na) || !Number.isFinite(nb)){
    return { conflict: false, delta: null, tolerance: rule.absolute_tolerance ?? null };
  }
  const delta = Math.abs(na - nb);
  const absTol = rule.absolute_tolerance;
  const relTol = rule.relative_tolerance_pct != null
    ? Math.max(Math.abs(na), Math.abs(nb)) * rule.relative_tolerance_pct / 100
    : null;

  // Effective tolerance: the larger of the defined thresholds, so small
  // values use the absolute floor and large values use the relative band.
  let tol;
  if (absTol != null && relTol != null)      tol = Math.max(absTol, relTol);
  else if (absTol != null)                   tol = absTol;
  else if (relTol != null)                   tol = relTol;
  else                                       tol = 0;

  return { conflict: delta > tol, delta: +delta.toFixed(4), tolerance: +(+tol).toFixed(4) };
}
