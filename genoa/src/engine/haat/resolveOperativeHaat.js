// Central "operative HAAT" resolver.
//
// Returns the single authoritative HAAT scalar to use for RF engineering
// calculations (§73.215 contour checks, §73.525, OET-65, interference
// studies, etc.).  Never lets a raw operator-entered value be used when
// validated terrain evidence exists.
//
// Resolution order:
//   1. terrain-derived mean from a non-INVALID validateHaat() result
//   2. mean of per-radial DEM values from evidence (covers in-engine calls
//      before validateHaat() has run)
//   3. evidence.terrain.haat_m  (pre-computed terrain mean from sidecar)
//   4. FCC-licensed / authorized HAAT from evidence
//   5. operator-entered inputs.haat_m  (fallback only; emits warning)
//
// Return shape:
//   { haat_m, basis, source, confidence, operator_entered_m, warnings[] }
//
// Classifications:
//   A) raw input capture / display          → may use inputs.haat_m directly
//   B) validation comparison                → may use inputs.haat_m directly
//   C) RF engineering calculation           → MUST use resolveOperativeHaat()

export function resolveOperativeHaat({ inputs = {}, evidence = {}, haatValidation = null } = {}) {
  const warnings = [];
  const operatorHaat = (() => {
    const n = Number(inputs.haat_m);
    return Number.isFinite(n) ? n : NaN;
  })();

  // 1. Validated terrain-derived mean — most authoritative.
  //    Accept only if basis is terrain_derived and status is not INVALID
  //    (INVALID means the terrain computation itself is suspect).
  if (
    haatValidation != null &&
    haatValidation.basis === 'terrain_derived' &&
    haatValidation.status !== 'INVALID' &&
    Number.isFinite(haatValidation.stats?.mean_m)
  ) {
    return {
      haat_m:            haatValidation.stats.mean_m,
      basis:             'terrain_derived',
      source:            'haat_validation.stats.mean_m',
      confidence:        'high',
      operator_entered_m: Number.isFinite(operatorHaat) ? operatorHaat : null,
      warnings
    };
  }

  // 2. Compute mean from evidence.terrain_haat_per_radial directly.
  //    This covers the common in-engine path where resolveOperativeHaat()
  //    is called before validateHaat() has been run by the orchestrator.
  const perRadialEntries = Array.isArray(evidence?.terrain_haat_per_radial)
    ? evidence.terrain_haat_per_radial
    : [];
  if (perRadialEntries.length >= 3) {
    const vals = perRadialEntries
      .map(r => {
        // Prefer haat_computed_m (DEM-derived) over haat_m (may be operator copy).
        const cv = Number(r?.haat_computed_m);
        if (Number.isFinite(cv)) return cv;
        const mv = Number(r?.haat_m);
        return Number.isFinite(mv) ? mv : null;
      })
      .filter(v => v != null);
    if (vals.length >= 3) {
      const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
      // Sanity: a valid terrain-derived mean must be above hard floor.
      // A garbage mean (e.g. −857 m from KZLZ inversion) should fall through
      // to the operator fallback rather than silently poisoning §73.215.
      if (Number.isFinite(mean) && mean > -200) {
        return {
          haat_m:            Math.round(mean * 10) / 10,
          basis:             'terrain_derived',
          source:            'evidence.terrain_haat_per_radial.mean',
          confidence:        'high',
          operator_entered_m: Number.isFinite(operatorHaat) ? operatorHaat : null,
          warnings
        };
      }
    }
  }

  // 3. evidence.terrain.haat_m — pre-computed terrain mean from sidecar.
  const terrainEvHaat = Number(evidence?.terrain?.haat_m);
  if (Number.isFinite(terrainEvHaat) && terrainEvHaat > -200) {
    return {
      haat_m:            terrainEvHaat,
      basis:             'terrain_evidence',
      source:            'evidence.terrain.haat_m',
      confidence:        'medium',
      operator_entered_m: Number.isFinite(operatorHaat) ? operatorHaat : null,
      warnings
    };
  }

  // 4. FCC-licensed / authorized HAAT.
  const fccHaat = (() => {
    const n = Number(
      evidence?.fcc_licensed?.haat_m
      ?? evidence?.facility?.haat_m
      ?? evidence?.fcc_facility?.haat_m
    );
    return Number.isFinite(n) && n > 0 ? n : NaN;
  })();
  if (Number.isFinite(fccHaat)) {
    return {
      haat_m:            fccHaat,
      basis:             'fcc_authorized',
      source:            'evidence.fcc_licensed.haat_m',
      confidence:        'medium',
      operator_entered_m: Number.isFinite(operatorHaat) ? operatorHaat : null,
      warnings
    };
  }

  // 5. Operator-entered fallback.
  warnings.push({
    code:    'OPERATIVE_HAAT_OPERATOR_ONLY',
    message: 'No terrain evidence or FCC license data available; operator-entered HAAT is used for RF calculations. Obtain terrain analysis for a defensible filing.'
  });
  return {
    haat_m:            Number.isFinite(operatorHaat) ? operatorHaat : NaN,
    basis:             'operator_input',
    source:            'inputs.haat_m',
    confidence:        'low',
    operator_entered_m: Number.isFinite(operatorHaat) ? operatorHaat : null,
    warnings
  };
}
