// DA Pattern Readiness Check — Trust Sprint #4
//
// §73.316 requires an FCC-approved horizontal radiation pattern table for
// directional-antenna (DA) FM stations.  The engine captures pattern data
// but has never enforced the filing gate.  This module adds the trust layer:
// it returns blockers and warnings that buildReadinessReport() merges into
// the main readiness output.
//
// NOT a new FCC rule — §73.316 is already on Form 301-FM Section III.
// This adds the readiness enforcement that was previously missing.

const MIN_RADIALS = 36; // §73.316: at least 36 evenly spaced radials at intervals of not greater than 10° (0° through 350°)

// Normalize a pattern entry to { azimuth_deg, relative_field } regardless of format.
// Accepts: [azimuth_deg, relative_field] array OR { azimuth_deg|azimuth|az, relative_field|field|value|rf }
function normalizeEntry(e) {
  if (Array.isArray(e) && e.length >= 2) {
    return { azimuth_deg: Number(e[0]), relative_field: Number(e[1]) };
  }
  if (e && typeof e === 'object') {
    const az = e.azimuth_deg ?? e.azimuth ?? e.az;
    const rf = e.relative_field ?? e.field ?? e.value ?? e.rf;
    return { azimuth_deg: Number(az), relative_field: Number(rf) };
  }
  return null;
}

// Find the best available pattern, in priority order.
function resolvePattern(exhibit) {
  const si = exhibit.station_inputs ?? {};
  const ev = exhibit.evidence ?? {};
  if (Array.isArray(ev.nec_pattern_table) && ev.nec_pattern_table.length > 0) return ev.nec_pattern_table;
  if (Array.isArray(si.pattern)           && si.pattern.length > 0)           return si.pattern;
  if (Array.isArray(ev.da_pattern)        && ev.da_pattern.length > 0)        return ev.da_pattern;
  if (Array.isArray(ev.pattern_data)      && ev.pattern_data.length > 0)      return ev.pattern_data;
  return null;
}

// Return { claimed: true } when pattern_mode='DA'|'D' is explicit,
// { claimed: false, implied: true } when pattern data is present without declaration,
// or null when the station is clearly non-directional.
function detectDirectional(exhibit) {
  const si = exhibit.station_inputs ?? {};
  const mode = si.pattern_mode ?? si.pattern_type ?? null;
  if (mode === 'DA' || mode === 'D') return { claimed: true, mode };
  const pattern = resolvePattern(exhibit);
  if (pattern && pattern.length > 0)  return { claimed: false, implied: true };
  return null;
}

export function checkDaPatternReadiness(exhibit) {
  const blockers = [];
  const warnings = [];

  const si      = exhibit.station_inputs ?? {};
  const service = si.service ?? '';
  const isFM    = service === 'FM' || service === 'LPFM' || service === 'FX';
  // §73.316 DA pattern rules apply to FM-band services.  AM uses §73.150.
  if (!isFM) return { blockers, warnings };

  const directional = detectDirectional(exhibit);
  if (!directional) return { blockers, warnings }; // omni / NDA — no DA checks

  const mode    = si.pattern_mode ?? si.pattern_type ?? null;
  const pattern = resolvePattern(exhibit);

  // ── Check 1: explicit DA but no pattern table anywhere ─────────────────────

  if (directional.claimed && !pattern) {
    blockers.push({
      code:    'DA_PATTERN_MISSING',
      message: `Antenna declared directional (pattern_mode=${mode}) but no horizontal radiation pattern table is present`,
      rule:    '47 CFR §73.316',
      field:   'antenna-pattern-table',
      remedy:  'Provide a complete horizontal pattern table in station_inputs.pattern or via NEC pattern evidence',
    });
    return { blockers, warnings }; // no further checks without data
  }

  // ── Check 2: pattern data present but pattern_mode not declared ─────────────

  if (!directional.claimed) {
    warnings.push({
      code:    'DA_PATTERN_UNCONFIRMED',
      message: 'Horizontal pattern table is present but pattern_mode is not set to DA — station will be treated as directional for filing purposes',
      rule:    '47 CFR §73.316',
      field:   'antenna-pattern',
    });
  }

  // ── Check 3: validate each entry ───────────────────────────────────────────

  const normalized = [];
  let hasInvalid = false;

  for (const entry of pattern) {
    const e = normalizeEntry(entry);
    if (!e || !Number.isFinite(e.azimuth_deg) || !Number.isFinite(e.relative_field)) {
      hasInvalid = true;
      break;
    }
    if (e.azimuth_deg < 0 || e.azimuth_deg >= 360) {
      hasInvalid = true;
      break;
    }
    // relative_field > 2.0 is almost certainly a data error (pattern should be ≤1.0 normalized)
    if (e.relative_field < 0 || e.relative_field > 2.0) {
      hasInvalid = true;
      break;
    }
    normalized.push(e);
  }

  if (hasInvalid) {
    blockers.push({
      code:    'DA_PATTERN_INVALID',
      message: 'Horizontal radiation pattern contains invalid entries (non-numeric, azimuth out of 0–359°, or relative_field out of valid range)',
      rule:    '47 CFR §73.316',
      field:   'antenna-pattern-table',
      remedy:  'Correct pattern entries: azimuth must be 0–359°, relative_field must be 0.0–1.0 (normalized)',
    });
    return { blockers, warnings };
  }

  // ── Check 4: insufficient azimuthal coverage ───────────────────────────────

  if (normalized.length < MIN_RADIALS) {
    warnings.push({
      code:    'DA_PATTERN_INCOMPLETE',
      message: `Horizontal pattern has ${normalized.length} azimuth point(s); §73.316 requires at least ${MIN_RADIALS} radials tabulated at 10° intervals (0° through 350°)`,
      rule:    '47 CFR §73.316',
      field:   'antenna-pattern-table',
    });
  }

  // ── Check 5: pattern not normalized to 1.0 at maximum ─────────────────────

  const maxField = normalized.length > 0 ? Math.max(...normalized.map(e => e.relative_field)) : null;
  if (maxField != null && maxField < 0.95) {
    warnings.push({
      code:    'DA_PATTERN_UNNORMALIZED',
      message: `Pattern maximum relative_field is ${maxField.toFixed(3)} — FCC standard requires normalization to 1.000 at the maximum radiation azimuth`,
      rule:    '47 CFR §73.316',
      field:   'antenna-pattern-table',
    });
  }

  // ── Check 6: no suppression verification (FM §73.316 only) ─────────────────
  // The engine computes suppression in the mitigation advisor but does not store
  // a structured result in the exhibit.  Without it we cannot confirm §73.316
  // directional-pattern compliance.  Flag as WARNING so engineers know the gap.

  const hasSuppression =
    !!(exhibit.evidence?.suppression_db || exhibit.evidence?.pattern_suppression);
  if (!hasSuppression) {
    warnings.push({
      code:    'DA_SUPPRESSION_UNVERIFIED',
      message: '§73.316 directional pattern compliance cannot be confirmed — no azimuthal suppression ratio calculation is present in the exhibit evidence',
      rule:    '47 CFR §73.316',
      field:   'antenna-pattern-table',
    });
  }

  return { blockers, warnings };
}
