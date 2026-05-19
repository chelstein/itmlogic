// HAAT plausibility validator — Phase-1 hardening.
//
// Sanity-checks the per-radial HAAT bundle against the operator's
// claimed HAAT and a handful of physical bounds.  Surfaces three
// kinds of finding:
//
//   - blocker (HAAT_IMPOSSIBLE)        — values that cannot be
//        correct under any terrain configuration (e.g. operator HAAT
//        + 500 m but mean per-radial HAAT — 200 m, the classic
//        symptom of the haat_m-passed-as-tx_amsl_m bug we just fixed).
//        These STOP the filing-readiness gate.
//
//   - warn  (HAAT_SUSPECT_OUTLIERS)    — most radials plausible but a
//        few way out of band.  Filing can proceed but the engineer
//        of record should look.
//
//   - info  (HAAT_OPERATOR_SUPPLIED /  — tells the report renderer
//             HAAT_TERRAIN_DERIVED)      whether to label Appendix A
//        as operator-supplied or terrain-derived, with the basis.
//
// Returned shape:
//
//   {
//     status:        'PASS' | 'SUSPECT' | 'INVALID' | 'NOT_RUN',
//     basis:         'operator_supplied' | 'terrain_derived' | 'flat' | 'unknown',
//     issues:        [{ code, severity, detail, az_deg? }],
//     stats: {
//       n_radials, n_finite, n_negative, n_implausible,
//       mean_m, min_m, max_m,
//       operator_m, delta_mean_vs_operator_m
//     },
//     tx_amsl_resolved: passthrough from exhibit.evidence.tx_amsl_resolved
//   }
//
// PURE — no I/O, no side effects.  Caller decides whether to push
// the issues into exhibit.warnings.

// Plausibility bounds for terrestrial FM/TV HAAT in metres.
//
// HAAT is "antenna AMSL minus mean terrain along radial".  Negative
// HAAT is physically possible (antenna in a valley, surrounded by
// higher terrain) but is rare for a licensed broadcast facility and
// almost never the design intent.  We use a soft lower bound of -50
// m (anything below that is treated as implausible without explicit
// proof) and a hard floor of -200 m (anything below that is treated
// as an IMPOSSIBLE_HAAT blocker — would imply a basement transmitter
// inside a 200 m crater).
//
// Upper bound 4000 m covers every continental US broadcast site
// (highest licensed FM HAAT in the US is around KOST-FM Mt. Wilson
// at ~1700 m).  Anything above 4000 m is treated as implausible.
const HARD_FLOOR_M     = -200;
const SOFT_FLOOR_M     = -50;
const HARD_CEILING_M   = 4000;
// When operator HAAT is positive, the mean per-radial HAAT should
// land within ±300 m of it under realistic terrain.  Larger deltas
// flag the haat-as-amsl bug class.
const MEAN_DELTA_LIMIT_M = 300;

export function validateHaat(exhibit){
  const inputs = exhibit?.station_inputs || {};
  const evidence = exhibit?.evidence || {};
  const operatorHaat = Number(inputs.haat_m);
  const haatResolved = evidence.tx_amsl_resolved || null;
  const perRadial   = Array.isArray(evidence.terrain_haat_per_radial)
    ? evidence.terrain_haat_per_radial
    : [];

  const issues = [];

  // No per-radial bundle attached — either AM (§73.184 doesn't use
  // DEM by design) or terrain wasn't requested.  Status NOT_RUN.
  if (perRadial.length === 0){
    return {
      status: 'NOT_RUN',
      basis:  inputs.service === 'AM' ? 'not_applicable_am' : 'flat',
      issues: [],
      stats: {
        n_radials: 0, n_finite: 0, n_negative: 0, n_implausible: 0,
        mean_m: null, min_m: null, max_m: null,
        operator_m: Number.isFinite(operatorHaat) ? operatorHaat : null,
        delta_mean_vs_operator_m: null
      },
      tx_amsl_resolved: haatResolved
    };
  }

  const haats = perRadial
    .map(r => Number(r?.haat_m))
    .filter(Number.isFinite);
  const n = haats.length;
  const mean = n > 0 ? haats.reduce((a, b) => a + b, 0) / n : null;
  const min  = n > 0 ? Math.min(...haats) : null;
  const max  = n > 0 ? Math.max(...haats) : null;
  const nNeg = haats.filter(h => h < 0).length;
  const nImpl = haats.filter(h => h < HARD_FLOOR_M || h > HARD_CEILING_M).length;

  // Basis: how was tx_amsl determined?
  let basis = 'unknown';
  if (haatResolved){
    if (haatResolved.source === 'operator_supplied') basis = 'operator_supplied';
    else if (haatResolved.source === 'derived')      basis = 'terrain_derived';
    else basis = 'flat';
  }

  // Per-radial implausibility check.  When >0 radials fall outside
  // [HARD_FLOOR_M, HARD_CEILING_M], the bundle is unusable.
  if (nImpl > 0){
    const worst = haats.reduce((acc, h) => {
      if (h < HARD_FLOOR_M || h > HARD_CEILING_M){
        if (!acc || Math.abs(h) > Math.abs(acc)) return h;
      }
      return acc;
    }, null);
    issues.push({
      code:     'HAAT_IMPOSSIBLE',
      severity: 'blocker',
      detail:   `${nImpl}/${n} per-radial HAAT values fall outside the physical range [${HARD_FLOOR_M}, ${HARD_CEILING_M}] m (worst observed ${worst?.toFixed?.(1)} m).  Almost certainly a tx_amsl_m / haat_m confusion in the upstream pipeline.  Per-radial HAAT cannot be trusted for §73.313 terrain compute.`
    });
  }

  // Mean-vs-operator delta check.  Catches the haat-as-amsl bug
  // pattern even when individual radials happen to stay within the
  // hard floor — e.g. operator HAAT 581 m, mean per-radial -170 m,
  // delta -750 m, all radials in [-275, -141] (KZLZ symptom).
  if (Number.isFinite(operatorHaat) && Number.isFinite(mean)){
    const delta = mean - operatorHaat;
    if (Math.abs(delta) > MEAN_DELTA_LIMIT_M){
      issues.push({
        code:     'HAAT_MEAN_INCONSISTENT',
        severity: 'blocker',
        detail:   `Mean per-radial HAAT (${mean.toFixed(1)} m) differs from operator-supplied HAAT (${operatorHaat.toFixed(1)} m) by ${delta.toFixed(1)} m — well beyond the ±${MEAN_DELTA_LIMIT_M} m tolerance.  Suggests the antenna AMSL was substituted with HAAT (or vice-versa) somewhere in the terrain pipeline.`
      });
    }
  }

  // Soft-floor outlier check.  Some radials are between
  // [HARD_FLOOR_M, SOFT_FLOOR_M] — physically possible but worth
  // flagging.  Warn, do not block.
  const nSoftOutliers = haats.filter(h => h < SOFT_FLOOR_M && h >= HARD_FLOOR_M).length;
  if (nSoftOutliers > 0 && nImpl === 0){
    issues.push({
      code:     'HAAT_SUSPECT_OUTLIERS',
      severity: 'warning',
      detail:   `${nSoftOutliers}/${n} per-radial HAAT values fall below ${SOFT_FLOOR_M} m (range [${min.toFixed(1)}, ${max.toFixed(1)}] m).  Physically possible for a transmitter in a deep valley but uncommon; engineer of record should confirm the antenna is intentionally below surrounding terrain.`
    });
  }

  // Final status:
  //  - INVALID:  any blocker → HAAT cannot be used
  //  - SUSPECT:  warnings only
  //  - PASS:     no issues
  let status = 'PASS';
  if (issues.some(i => i.severity === 'blocker')) status = 'INVALID';
  else if (issues.some(i => i.severity === 'warning')) status = 'SUSPECT';

  return {
    status,
    basis,
    issues,
    stats: {
      n_radials:                n,
      n_finite:                 n,
      n_negative:               nNeg,
      n_implausible:            nImpl,
      mean_m:                   mean != null ? Math.round(mean * 10) / 10 : null,
      min_m:                    min  != null ? Math.round(min  * 10) / 10 : null,
      max_m:                    max  != null ? Math.round(max  * 10) / 10 : null,
      operator_m:               Number.isFinite(operatorHaat) ? operatorHaat : null,
      delta_mean_vs_operator_m: (Number.isFinite(mean) && Number.isFinite(operatorHaat))
                                ? Math.round((mean - operatorHaat) * 10) / 10
                                : null
    },
    tx_amsl_resolved: haatResolved
  };
}
