// Structured warning codes.  Every warning emitted by Genoa MUST come
// from this enum.  Free-text only appears in the `detail` field; the
// `code` is what readiness scoring, exports, and the UI all switch on.
//
// Severity:
//   blocker   - filing readiness will fail; engineering review required
//   warning   - reduces readiness score, does not block
//   info      - reported but does not affect readiness
//
// Phase:
//   input | engine | evidence | sidecar | export | narrative

export const WARNING_CODES = Object.freeze({
  FACILITY_ID_MISSING:           { severity: 'warning', phase: 'input',
    title: 'Facility ID missing',
    description: 'No FCC facility ID was provided. Engineering review required to confirm the station identity.' },

  CURVE_VALIDATION_MISSING:      { severity: 'blocker', phase: 'engine',
    title: 'Curve validation missing',
    description: 'No reference validation cases have been run against the active curve dataset. Filing-grade exhibits require validation.' },

  CONSTANT_HAAT_ASSUMED:         { severity: 'warning', phase: 'engine',
    title: 'Constant HAAT assumed',
    description: 'The same HAAT was applied to every radial. §73.313 calls for arc-averaged per-radial HAAT; consider enabling the terrain sidecar.' },

  TERRAIN_NOT_APPLIED:           { severity: 'warning', phase: 'evidence',
    title: 'Terrain not applied',
    description: 'Per-radial terrain HAAT was requested but no terrain profile was applied. Falling back to the user-entered HAAT.' },

  SDR_MEASUREMENTS_MISSING:      { severity: 'info',    phase: 'evidence',
    title: 'SDR measurements missing',
    description: 'No SigMF measurement records are attached to this exhibit. Field measurements are evidence, not authority.' },

  SDR_MEASUREMENTS_NOT_CALIBRATED: { severity: 'warning', phase: 'evidence',
    title: 'SDR measurements not calibrated',
    description: 'Attached SigMF captures lack calibration metadata. Measured field strengths are reported as raw indications.' },

  POPULATION_PLACEHOLDER:        { severity: 'warning', phase: 'engine',
    title: 'Population estimate is a placeholder',
    description: 'Population is computed against a uniform density placeholder. A Census/ACS dispatch is required for filing.' },

  AM_ENGINE_NOT_IMPLEMENTED:     { severity: 'blocker', phase: 'engine',
    title: 'AM engine not implemented',
    description: 'AM groundwave §73.184 sigma-aware curve grid is not yet ingested; engine refused to interpolate.' },

  INTERPOLATION_UNDOCUMENTED:    { severity: 'blocker', phase: 'engine',
    title: 'Interpolation undocumented',
    description: 'The interpolation method used to read the FCC curve is not recorded. Filing-grade exhibits require documented interpolation.' },

  FCC_METHOD_MISSING:            { severity: 'blocker', phase: 'engine',
    title: 'FCC method missing',
    description: 'No deterministic FCC method is associated with this contour. Cannot file.' },

  REFERENCE_CASES_MISSING:       { severity: 'blocker', phase: 'engine',
    title: 'Reference validation cases missing',
    description: 'The reference validation suite has zero cases for this service. Cannot certify the engine.' },

  SIDECAR_UNAVAILABLE:           { severity: 'warning', phase: 'sidecar',
    title: 'Optional sidecar unavailable',
    description: 'An optional sidecar (terrain / measurement / identity) is not configured or did not respond.' },

  FACILITY_LOOKUP_UNAVAILABLE:   { severity: 'warning', phase: 'sidecar',
    title: 'Facility lookup unavailable',
    description: 'Read-only facility database (zerotrustradio) was not reachable. Facility metadata is not validated.' },

  RADIODNS_VALIDATION_UNAVAILABLE: { severity: 'warning', phase: 'sidecar',
    title: 'RadioDNS validation unavailable',
    description: 'RadioDNS resolver did not respond. Hybrid-radio identity is not confirmed.' },

  REFERENCE_CASE_NOT_AUTHORITATIVE: { severity: 'warning', phase: 'engine',
    title: 'Reference case is non-authoritative',
    description: 'A reference case used at validation time is marked authoritative=false. It may guard against engine regressions but cannot certify the curve dataset for filing.' },

  REFERENCE_EXPECTED_CONTOURS_MISSING: { severity: 'warning', phase: 'engine',
    title: 'Reference expected contours missing',
    description: 'A reference case carries no expected contour distances; the suite cannot run a numeric pass/fail for it.' },

  FACILITY_COORDINATES_MISSING:    { severity: 'blocker', phase: 'input',
    title: 'Facility coordinates missing',
    description: 'Transmitter latitude / longitude are missing. The engine can compute contour distances along radials but cannot project polygons or generate the GeoJSON map. Filing requires verified facility coordinates.' }
});

export class W {
  static make(code, detail = null, extras = null){
    if (!WARNING_CODES[code]) throw new Error(`unknown warning code: ${code}`);
    const meta = WARNING_CODES[code];
    return Object.freeze({
      code,
      severity:    meta.severity,
      phase:       meta.phase,
      title:       meta.title,
      description: meta.description,
      detail:      detail || null,
      ...(extras ? { extras } : {})
    });
  }
  static codes(){ return Object.keys(WARNING_CODES); }
  static dedupe(warnings){
    const seen = new Map();
    for (const w of warnings){
      const key = w.code + '|' + (w.detail || '');
      if (!seen.has(key)) seen.set(key, w);
    }
    return [...seen.values()];
  }
}
