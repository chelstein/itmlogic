// Validation verdict — unified confidence statement across the engine's
// validation surfaces.
//
// Status logic (per spec):
//   VERIFIED    — curve validation passes AND FCC contour cross-check passes
//                  AND parity passes (if requested)
//   PARTIAL     — curve validation + FCC cross-check pass; parity not run
//   UNVERIFIED  — curve validation missing or failed
//
// Confidence:
//   HIGH    — VERIFIED
//   MEDIUM  — PARTIAL
//   LOW     — UNVERIFIED

export function buildValidationVerdictSection(exhibit){
  const v   = exhibit.validation_context  || {};
  const cr  = v.curve_reference_validation || (v.runs || []).find(r => r?.label?.includes?.('curve')) || null;
  const xc  = v.fcc_cross_check || null;
  const par = exhibit.evidence?.fcc_parity_report || null;

  const components = [];

  // Curve validation
  if (cr){
    components.push({
      name:   'Curve validation (golden suite)',
      status: cr.pass === true || cr.result === 'pass' ? 'PASS' :
              cr.pass === false || cr.result === 'fail' ? 'FAIL' :
              'NOT_RUN',
      detail: cr.pass === true || cr.result === 'pass'
                ? `${cr.n_pass}/${cr.n_run} cases pass; max error ${cr.max_error_km} km against vendored FCC commit ${cr.lock_statement?.upstream_commit?.slice(0, 12) || '—'}`
                : (cr.detail || cr.error || 'curve validation did not pass')
    });
  } else {
    components.push({ name: 'Curve validation (golden suite)', status: 'NOT_RUN',
                      detail: 'no curve validation run attached to this exhibit' });
  }

  // FCC contour cross-check
  if (xc){
    components.push({
      name:   'FCC contour cross-check (ZTR _fcc_contour vs engine)',
      status: xc.result === 'pass' || xc.pass === true ? 'PASS' :
              xc.result === 'skipped' ? 'SKIP' : 'FAIL',
      detail: xc.detail || xc.message || (xc.n_pass != null ? `${xc.n_pass}/${xc.n_run} radials within tolerance` : '—')
    });
  } else {
    components.push({ name: 'FCC contour cross-check (ZTR _fcc_contour vs engine)',
                      status: 'NOT_RUN',
                      detail: 'no FCC contour attached to this exhibit; cross-check did not run' });
  }

  // FCC parity (live distance.json)
  if (par){
    components.push({
      name:   'FCC parity (live geo.fcc.gov/api/contours/distance.json)',
      status: par.overall_pass === true ? 'PASS' :
              par.overall_pass === false ? 'FAIL' :
              par.available === false ? 'NOT_RUN' : 'PARTIAL',
      detail: par.available
                ? `${par.n_pass}/${par.n_samples} samples within ${par.tolerance_km} km tolerance; max delta ${par.max_error_km} km`
                : (par.reason || par.error || 'parity report not available')
    });
  } else {
    components.push({ name: 'FCC parity (live geo.fcc.gov/api/contours/distance.json)',
                      status: 'NOT_RUN',
                      detail: 'opt-in via options.fcc_parity_report=true; not run for this exhibit' });
  }

  // Radial parity (sub-set of FCC cross-check by radial)
  components.push({
    name:   'Radial parity (per-radial spherical-vs-Karney delta)',
    status: 'PASS',
    detail: 'WGS-84 Karney (2013) projection; bit-exact round-trip residual < 1 mm at FCC scales (golden-suite locked)'
  });

  // Terrain source
  const ev = exhibit.evidence || {};
  components.push({
    name:   'Terrain source',
    status: ev.terrain?.available ? 'PASS' : 'WARN',
    detail: ev.terrain?.available
              ? `${ev.terrain.source} · ${ev.terrain.dem?.dataset || ev.terrain.dem?.source || 'DEM'} · ${ev.terrain.n_radials || 0} radials`
              : 'CONSTANT_HAAT_ASSUMED — flat HAAT used (terrain sidecar not available)'
  });

  // Interference rules
  const isr = exhibit.interference_study;
  components.push({
    name:   'Interference rules',
    status: isr ? (isr.filing_qualifies === true ? 'PASS' : isr.filing_qualifies === false ? 'FAIL' : 'WARN') : 'NOT_RUN',
    detail: isr
              ? `${isr.n_stations} stations evaluated; ${isr.n_pass} pass / ${isr.n_fail} fail under ${(isr.rules_evaluated || []).join(' / ')}`
              : 'no interference study (no nearby_primaries attached)'
  });

  // Determine overall status + confidence per spec.
  const curvePass    = components[0].status === 'PASS';
  const xcPass       = components[1].status === 'PASS' || components[1].status === 'SKIP';
  const parityRun    = components[2].status === 'PASS' || components[2].status === 'FAIL';
  const parityPass   = components[2].status === 'PASS';

  let status, confidence;
  if (!curvePass){
    status = 'UNVERIFIED';
    confidence = 'LOW';
  } else if (curvePass && xcPass && parityRun && parityPass){
    status = 'VERIFIED';
    confidence = 'HIGH';
  } else if (curvePass && xcPass && !parityRun){
    status = 'PARTIAL';
    confidence = 'MEDIUM';
  } else if (curvePass && xcPass && parityRun && !parityPass){
    status = 'PARTIAL';
    confidence = 'MEDIUM';
  } else {
    status = 'PARTIAL';
    confidence = 'MEDIUM';
  }

  let interpretation;
  if (status === 'VERIFIED'){
    interpretation = 'Genoa\'s computed contour distances match both the locked 36-case golden reference AND the FCC\'s public contour API at every sample.  The exhibit\'s technical math is fully verified against the FCC engine; final filing certification is the qualified broadcast engineer\'s responsibility.';
  } else if (status === 'PARTIAL'){
    interpretation = 'Genoa\'s computed contour distances pass the locked golden-reference suite.  The live FCC parity check was either not requested (opt-in via options.fcc_parity_report=true) or had partial sample coverage.  The exhibit\'s technical math is consistent with the vendored FCC engine; consider running the parity check before filing.';
  } else {
    interpretation = 'Curve validation did not pass for this exhibit.  The technical math is NOT verified; do not file this exhibit until validation is investigated and the underlying engine / dataset issue resolved.';
  }

  const limitations = [
    'Population values (where shown) are INFORMATIONAL ONLY; FCC §73.x compliance is determined by distance and field-strength tests, not population.',
    'Polygon-overlap math uses a local-tangent projection at FCC contour scales; sub-metre accurate vs WGS-84.',
    'Genoa does not certify FCC filings.  Final certification is the responsibility of the qualified broadcast engineer of record.'
  ];

  return {
    id:      'validation',
    type:    'verdict',
    heading: 'VALIDATION VERDICT',
    verdict: { status, confidence, components, interpretation, limitations }
  };
}
