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

  INTERPOLATION_UNDOCUMENTED:    { severity: 'blocker', phase: 'engine',
    title: 'Interpolation undocumented',
    description: 'The interpolation method used to read the FCC curve is not recorded. Filing-grade exhibits require documented interpolation.' },

  FCC_METHOD_MISSING:            { severity: 'blocker', phase: 'engine',
    title: 'FCC method missing',
    description: 'No deterministic FCC method is associated with this contour. Cannot file.' },

  REFERENCE_CASES_MISSING:       { severity: 'blocker', phase: 'engine',
    title: 'Reference validation cases missing',
    description: 'The reference validation suite has zero cases for this service. Cannot certify the engine.' },

  HAAT_IMPOSSIBLE:               { severity: 'blocker', phase: 'engine',
    title: 'Per-radial HAAT outside physical bounds',
    description: 'One or more per-radial HAAT values fall outside the [-200, 4000] m physical range, almost always indicating a tx_amsl_m / haat_m confusion in the terrain pipeline.  Filing readiness is blocked until the bundle is recomputed.' },

  HAAT_MEAN_INCONSISTENT:        { severity: 'blocker', phase: 'engine',
    title: 'Per-radial HAAT inconsistent with operator HAAT',
    description: 'Mean per-radial HAAT differs from the operator-supplied HAAT by more than ±300 m. Suggests the antenna AMSL was substituted with HAAT (or vice-versa) somewhere in the terrain pipeline.' },

  HAAT_SUPPRESSED_NO_TERRAIN_BASIS: { severity: 'blocker', phase: 'engine',
    title: 'Per-radial HAAT invalid due to missing terrain basis',
    description: 'Per-radial HAAT values were computed without a real terrain basis (no inputs.overall_height_amsl_m, no successful tx-site DEM probe).  Display suppressed; contour distances still authoritative under FCC §73.333 curves using operator HAAT.' },

  HAAT_FALLBACK_ONLY:            { severity: 'warning', phase: 'engine',
    title: 'Per-radial HAAT in fallback-only mode',
    description: 'Per-radial HAAT bundle present but no terrain basis attached. Column suppressed in Appendix A; operator HAAT is used for contour interpolation.' },

  OPERATIVE_HAAT_OPERATOR_ONLY:  { severity: 'warning', phase: 'engine',
    title: 'Operative HAAT is operator-entered (no terrain evidence)',
    description: 'No terrain evidence or FCC license data is available; the operator-entered HAAT is used as the operative value for RF calculations. Obtain terrain analysis (§73.313 arc-averaged per-radial HAAT) for a defensible filing.' },

  HAAT_CONTRADICTION:            { severity: 'blocker', phase: 'engine',
    title: 'HAAT validation contradiction detected',
    description: 'Consistency guard found a divergence between haat_validation.status and the per-radial HAAT actually present in the exhibit. Release blocked to prevent misleading Appendix A output.' },

  HAAT_SUSPECT_OUTLIERS:         { severity: 'warning', phase: 'engine',
    title: 'Per-radial HAAT outliers',
    description: 'One or more per-radial HAAT values are physically possible but uncommon (below -50 m). Engineer of record should confirm the antenna is intentionally below surrounding terrain.' },

  HAAT_OPERATOR_TERRAIN_RELATIVE_MISMATCH: { severity: 'warning', phase: 'engine',
    title: 'Operator-entered HAAT differs materially from terrain-derived HAAT (relative delta)',
    description: 'The operator-entered HAAT differs from the terrain-derived mean HAAT by more than the relative threshold (typically 50%).  This often indicates AGL tower height was entered instead of §73.313 arc-averaged HAAT.  Terrain-derived HAAT remains authoritative for RF calculations unless the engineer of record manually overrides it after review.' },

  LIKELY_AGL_ENTERED_AS_HAAT:    { severity: 'warning', phase: 'engine',
    title: 'Operator-entered HAAT is suspiciously low — possible AGL/HAAT confusion',
    description: 'The operator-entered HAAT is much lower than the terrain-derived mean HAAT, which is the characteristic signature of tower height AGL being entered as HAAT.  Per §73.313, HAAT is measured relative to average terrain elevation within 3–16 km of the transmitter site, not tower height above ground.  The terrain-derived HAAT is used for RF calculations; the operator-entered value is preserved for display only.' },

  HAAT_INVALID:                  { severity: 'blocker', phase: 'engine',
    title: 'Per-radial HAAT validation: impossible values — terrain compute failed',
    description: 'HAAT validation reports impossible per-radial values (outside physical bounds).  This typically means antenna AMSL was not resolved or the terrain DEM probe failed.  Supply inputs.overall_height_amsl_m or wait for the terrain DEM probe to succeed before recomputing.' },

  HAAT_SUSPECT:                  { severity: 'warning', phase: 'engine',
    title: 'Per-radial HAAT validation: outliers detected — engineering review required',
    description: 'HAAT validation reports one or more per-radial outliers.  The values are within physical bounds but warrant engineer review to confirm they reflect real terrain effects (deep valleys or elevated sites) rather than a computation artefact.' },

  HAAT_NOT_TERRAIN_DERIVED:      { severity: 'warning', phase: 'engine',
    title: 'Per-radial HAAT was not computed from a terrain DEM',
    description: 'The terrain sidecar was unavailable or not configured, so per-radial HAAT was not derived from a digital elevation model.  FCC §73.313 requires arc-averaged terrain HAAT for filing-grade exhibits; operator-entered HAAT is used as a placeholder.  Enable the terrain sidecar to compute defensible per-radial HAAT.' },

  HAAT_DISCREPANCY:              { severity: 'warning', phase: 'engine',
    title: 'Filed HAAT differs from terrain-derived advisory HAAT',
    description: 'The HAAT filed with this exhibit differs from the terrain-derived advisory mean HAAT by more than 20%.  This may indicate an input error or a legitimate site-specific terrain feature.  The engineer of record should confirm which value is correct before filing.' },

  HAAT_OPERATOR_SUSPECT:         { severity: 'warning', phase: 'engine',
    title: 'HAAT validation: operator-entered HAAT is suspect',
    description: 'The HAAT validation engine flagged the operator-entered HAAT as suspect relative to the terrain-derived value.  The terrain-derived HAAT was used for RF calculations.  Engineer of record must confirm the operative HAAT before filing.' },

  HAAT_LIKELY_AGL:               { severity: 'warning', phase: 'engine',
    title: 'Operator-entered HAAT appears to be tower height AGL',
    description: 'The operator-entered HAAT appears to be tower height above ground level (AGL) rather than the §73.313 arc-averaged HAAT relative to average terrain within 3–16 km.  The terrain-derived HAAT was used for RF calculations; the operator-entered value is displayed with a warning.  Verify and correct the HAAT input before filing.' },

  TERRAIN_LIMITED:               { severity: 'warning', phase: 'engine',
    title: 'Exhibit in terrain-limited mode',
    description: 'Per-radial terrain analysis suppressed (DEM unavailable or no resolved AMSL). Contour distances still computed under FCC §73.333 curves using operator HAAT, but the per-radial HAAT column, terrain severity scoring, and engineering-confidence terrain inputs are unavailable.' },

  TERRAIN_HAAT_REJECTED:         { severity: 'warning', phase: 'engine',
    title: 'Upstream terrain-HAAT response rejected',
    description: 'A terrain sidecar returned per-radial HAAT values that failed plausibility checks (outside physical bounds or inconsistent with operator HAAT). Bundle rejected; pipeline fell through to the resolver-backed multi-source DEM path.' },

  TX_AMSL_UNRESOLVED:            { severity: 'blocker', phase: 'engine',
    title: 'Antenna AMSL unresolved — per-radial HAAT unreliable',
    description: 'Could not resolve antenna AMSL: neither inputs.overall_height_amsl_m supplied nor ground-elevation probe at the transmitter site succeeded.  Per-radial HAAT cannot be computed without a real AMSL basis; terrain pipeline skipped.  Supply overall_height_amsl_m (the "radiation center AMSL" field on FCC Form 301) to resolve.' },

  FREQUENCY_OUT_OF_BAND:         { severity: 'blocker', phase: 'input',
    title: 'Frequency outside US broadcast band',
    description: 'The submitted frequency is outside the US broadcast band for the specified service (AM: 530–1710 kHz; FM/LPFM/FX: 88.0–108.0 MHz).  This almost always indicates a unit-conversion error — e.g. an FM frequency entered in kHz instead of MHz.  FCC §73.333/§73.184 curves do not apply outside these ranges; no contour distances can be computed.  Correct the frequency before resubmitting.' },

  ERP_VARIANCE_FROM_LICENSE:     { severity: 'warning', phase: 'evidence',
    title: 'Proposed ERP differs from FCC-licensed ERP',
    description: 'The operator-entered ERP deviates from the FCC-licensed ERP by more than 5 %.  This may indicate an intentional modification (CP, STA, or power increase application) or a data-entry error.  If this is a modification exhibit, the variance is expected and this warning is informational.  If this is a license-verification exhibit, correct the ERP to match the FCC record before filing.' },

  FCC_CLASS_DEFAULTED:           { severity: 'info', phase: 'engine',
    title: 'FCC class not supplied — Class A default applied',
    description: 'No FCC class was provided; §73.215 contour protection used the Class A protected-field default (60 dBu).  Class A is the most protective option; using it is conservative and will not produce false-pass results, but may flag interference pairs that a lower-class station (C, C0, C1, C2, B, B1) would be permitted to fail under the actual applicable threshold (54 dBu).  Supply inputs.fcc_class for a class-specific study.' },

  SIDECAR_UNAVAILABLE:           { severity: 'warning', phase: 'sidecar',
    title: 'Optional sidecar unavailable',
    description: 'An optional sidecar (terrain / measurement / identity) is not configured or did not respond.' },

  FACILITY_LOOKUP_UNAVAILABLE:   { severity: 'warning', phase: 'sidecar',
    title: 'Facility lookup unavailable',
    description: 'Read-only facility database (zerotrustradio) was not reachable. Facility metadata is not validated.' },

  CP_LOOKUP_FALLBACK:            { severity: 'warning', phase: 'sidecar',
    title: 'CP pending-application lookup fell back to licensed record',
    description: 'A study_mode=\'cp\' request was made but no pending or granted-no-construction application was found in the FCC LMS pending-applications database for this facility ID.  The licensed record was used instead.  If the CP application was recently filed, retry after the FCC\'s LMS indexing delay (typically 24–48 h).  CP parameters (power, pattern) may need to be entered manually.' },

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
    description: 'Transmitter latitude / longitude are missing. The engine can compute contour distances along radials but cannot project polygons or generate the GeoJSON map. Filing requires verified facility coordinates.' },

  // ---- FCC geo contour cross-check (external evidence; NOT a blocker) ----
  // The FCC's published contour from geo.fcc.gov uses terrain-aware
  // ITM under the hood; Genoa's free-space §73.333 F(50,50) lookup is
  // a different method.  A mismatch is engineering-meaningful but is
  // EVIDENCE, not a curve-validation failure.  These warnings replace
  // the previous habit of emitting CURVE_VALIDATION_MISSING when the
  // FCC cross-check disagreed.

  FCC_GEO_CROSSCHECK_FAILED:       { severity: 'warning', phase: 'evidence',
    title: 'FCC geo contour cross-check failed',
    description: 'Engine output deviates from the FCC published contour beyond the cross-check tolerance.  This is external evidence — the FCC contour is computed with a terrain-aware method (ITM) that the engine does not yet replicate.  Engineering review required; CURVE_VALIDATION_MISSING is unaffected.' },

  FCC_GEO_CROSSCHECK_SKIPPED:      { severity: 'warning', phase: 'evidence',
    title: 'FCC geo contour cross-check skipped',
    description: 'No usable _fcc_contour was returned by the upstream (geo.fcc.gov / ZTR proxy).  The cross-check did not run.  This does not affect curve validation status.' },

  // ---- Regulatory compliance (47 CFR §73.807 / §73.811 / §74.1204) ----
  // These warnings are emitted by the regulatory compliance modules
  // (src/engine/regulatory/) when an exhibit fails — or cannot complete
  // — its rule check.

  LPFM_RULE_VIOLATION: { severity: 'blocker', phase: 'engine',
    title: 'LPFM rule violation (47 CFR §73.807 / §73.811)',
    description: 'The exhibit fails one or more LPFM rules: §73.807 service-contour distance / minimum-separation, or §73.811 ERP and antenna-height ceiling.  The exhibit is not filable as an LPFM application.' },

  TRANSLATOR_INTERFERENCE: { severity: 'blocker', phase: 'engine',
    title: 'FM translator interference (47 CFR §74.1204)',
    description: 'The translator fails one or more §74.1204 D/U interference gates against a nearby primary station.  Filing requires that all D/U ratios be satisfied.' },

  FM_CONTOUR_PROTECTION_VIOLATION: { severity: 'warning', phase: 'engine',
    title: 'FM short-spacing contour-protection — simplified study flagged a violation (47 CFR §73.215)',
    description: 'Genoa\'s simplified §73.215 study (single-bearing contour-edge methodology, see src/engine/regulatory/section_73_215.js header) detected D/U gate violations against one or more nearby full-service FM stations.  This is CONSERVATIVE relative to the FCC\'s actual polygon-vs-polygon contour-overlap test — a point-bearing failure can over-flag stations the licensed engineer\'s full polygon study would clear.  Required next step: licensed-engineer polygon-overlap review before filing-grade go/no-go.  Genoa surfaces the §73.215 study results on regulatory_compliance.studies for that review.' },

  FM_MINIMUM_SEPARATION_VIOLATION: { severity: 'warning', phase: 'engine',
    title: 'FM §73.207(b) minimum-distance separation not met',
    description: 'The proposed FM station fails the §73.207(b) Table A minimum-distance separation against one or more nearby full-service FM stations.  When §73.215 contour protection passes, this is informational — the filing can cite §73.215 instead.  When §73.215 also fails, the station does not qualify under either rule and the filing requires an alternative (e.g., a major-change application with reduced ERP / HAAT, or a directional antenna pattern).' },

  FM_TV_CH6_PROTECTION_VIOLATION: { severity: 'warning', phase: 'engine',
    title: 'FM reserved-band TV ch.6 protection — simplified study flagged a violation (47 CFR §73.525)',
    description: 'Genoa\'s simplified §73.525 study (single-bearing F(50,10)↔Grade B contour-edge methodology, same simplification as §73.215) detected a §73.525(b) D/U gate violation against one or more active TV channel 6 stations.  This is CONSERVATIVE relative to the FCC\'s actual polygon-vs-polygon overlap.  Required next step: licensed-engineer review with full polygon overlap before filing.  Most full-power ch.6 stations were repacked in the 2009 DTV transition; LPTV / Class A "Franken FM" residuals are the active concern.' },

  ASR_MISMATCH: { severity: 'warning', phase: 'evidence',
    title: 'ASR / application data mismatch (47 CFR §17.4)',
    description: 'The Antenna Structure Registration (ASR) record disagrees with the application\'s antenna data on one or more fields (coordinates, overall height AGL/AMSL).  Filing requires consistency between Form 302 / 301 and the ASR record on file with the FCC.  A minor mismatch may be a quantization artefact; a major mismatch indicates either the application or the ASR record needs to be corrected before filing.' },

  FAA_DETERMINATION_EXPIRED: { severity: 'warning', phase: 'evidence',
    title: 'FAA OE/AAA determination expired (FAA Order JO 7400.2 §6-3-3)',
    description: 'The FAA OE/AAA Form 7460-2 Determination of No Hazard (or conditional determination) for this antenna structure has passed its expiration date.  DNHs are valid for 18 months from the determination date; past that window, the proponent must re-file Form 7460-1 and obtain a fresh determination before filing the FCC application.  Either re-study or update the application to reflect the structure as it is currently authorized.' },

  TOWER_COMPLIANCE_GAP: { severity: 'warning', phase: 'evidence',
    title: 'Tower marking / lighting gap vs ASR record (47 CFR §17.21 / §17.23)',
    description: 'Genoa\'s rules-derived marking + lighting recommendation (per §17.21, §17.23, FAA AC 70/7460-1L) does not match the ASR record\'s actual lighting_requirement / painting_requirement.  An FAA-issued case-specific lighting letter typically explains a benign mismatch; absence of a lighting requirement on a structure where the rules require one indicates either a stale ASR record or a non-compliant structure.  The engineer-of-record must confirm the FAA letter is on file before filing.' },

  COMPUTE_TIMEOUT_PARTIAL: { severity: 'warning', phase: 'evidence',
    title: 'Compute completed with partial evidence (budget exceeded)',
    description: 'One or more network-bound evidence fetches were skipped because the per-request compute budget (COMPUTE_BUDGET_MS, default 4.5 minutes) was exhausted.  The exhibit numbers are still correct — the engine math is local and runs unconditionally — but the named evidence steps did not complete and their warnings (e.g. CONSTANT_HAAT_ASSUMED, MISSING_NEARBY_STATIONS) may be elevated as a result.  Re-run the compute when upstreams are responsive, or raise COMPUTE_BUDGET_MS / DigitalOcean App Platform http_request_timeout if the underlying source is consistently slow.' },

  NEC_MODEL_UNAVAILABLE: { severity: 'warning', phase: 'sidecar',
    title: 'NEC2++ antenna model unavailable',
    description: 'The Genoa NEC sidecar (NEC2++ / PyNEC, GPL v2 isolated) was not reachable, returned an error, or the PyNEC dependency is missing on the sidecar host.  Compute proceeded without the NEC evidence section.  When the sidecar is healthy, the exhibit gains directional pattern + feedpoint impedance + near-field RF exposure for §73.62 / §73.150 / §73.45 / OET-65 reviews.  Set NEC_SIDECAR_URL or check the sidecar /health endpoint.' },

  NEC_MODEL_INVALID_GEOMETRY: { severity: 'warning', phase: 'sidecar',
    title: 'NEC antenna model rejected (invalid geometry)',
    description: 'The supplied antenna geometry failed the sidecar\'s schema or sanity checks (zero-length wire, non-numeric field, segment-vs-radius proportions, unsupported ground type, missing excitation).  See evidence.nec_model.detail for the specific failure and correct the input.' },

  NEC_GROUND_MODEL_LIMITATION: { severity: 'warning', phase: 'sidecar',
    title: 'NEC ground model is PEC (perfect conductor)',
    description: 'The model used a perfect-electrical-conductor (PEC) ground assumption.  PEC overestimates ground efficiency for AM towers over real soil; use type=sommerfeld with conductivity_s_m + dielectric_constant for filing-grade analysis.  The §73.62 / §73.150 RTA the FCC accepts uses Sommerfeld real ground.' },

  NEC_NEAR_FIELD_APPROXIMATION: { severity: 'warning', phase: 'sidecar',
    title: 'NEC near-field uses MoM current distribution',
    description: 'NEC2++ near-field is computed at sample points using the assumed wire-current distribution from the MoM solve.  Accuracy degrades within roughly λ/8 of the conductors.  For OET-65 monitor-point analysis at AM frequencies, place sample points outside that radius or supply additional measured-current data.' },

  NEC_LICENSE_BOUNDARY_EXTERNAL: { severity: 'info', phase: 'sidecar',
    title: 'NEC evidence sourced from GPL-isolated external sidecar',
    description: 'NEC2++ is GPL v2.  This evidence was produced by an isolated sidecar process that Genoa talks to over HTTP only — Genoa\'s own codebase does not link or embed any GPL\'d code.  evidence.nec_model.provenance.license_boundary is stamped "external sidecar" so reviewers can verify the boundary is preserved.' },

  AM_GROUND_SIGMA_ZONE_ESTIMATE: { severity: 'warning', phase: 'sidecar',
    title: 'AM ground conductivity resolved from FCC M3 zone table (screening-grade)',
    description: 'Neither the ZTR /api/m3/conductivity proxy nor the local AM_m3.tif GeoTIFF was available.  Genoa fell back to a geographic zone estimate from the FCC §73.190 Figure M3 representative values (±50% accuracy vs. the raster).  The AM groundwave and NIF results in this exhibit are SCREENING-GRADE — acceptable for preliminary site studies but not for FCC filing.  Deploy AM_m3.tif to /opt/genoa/live-data/m3/ or configure the ZTR sidecar (FACILITY_SIDECAR_URL) to obtain filing-grade σ.  evidence.ground_conductivity.filing_grade is set to "screening".  evidence.ground_conductivity.tier_attempts records each upstream attempt.' },

  AM_GROUND_SIGMA_UNRESOLVED: { severity: 'blocker', phase: 'sidecar',
    title: 'AM ground conductivity could not be resolved from any source',
    description: 'Genoa could not resolve ground conductivity from any tier: (1) operator-supplied inputs.ground_sigma_mS_m, (2) ZTR /api/m3/conductivity proxy, (3) local AM_m3.tif GeoTIFF, (4) FCC M3 zone table.  The site is likely outside CONUS/Alaska/Hawaii or all lookups failed.  Supply inputs.ground_sigma_mS_m explicitly (FCC §73.190 M3 zone value for the tower site) and recompute.  evidence.ground_conductivity.tier_attempts records each upstream failure for diagnosis.' },

  LMS_DATA_UNAVAILABLE: { severity: 'warning', phase: 'evidence',
    title: 'FCC LMS / public-file data unavailable',
    description: 'Genoa could not reach the FCC FMQ/AMQ database or publicfiles.fcc.gov for this station.  Filing-grade exhibits should cross-reference the FCC\'s authoritative record (license expiration, status, last action, public-file folder presence).  Re-run the compute when the upstream is responsive, or pull the data manually from https://transition.fcc.gov/fcc-bin/fmq and https://publicfiles.fcc.gov/.' },

  LICENSE_EXPIRING_SOON: { severity: 'warning', phase: 'evidence',
    title: 'FCC license expires soon',
    description: 'The FCC license for this station expires within the lookahead window (default 180 days; configurable via LICENSE_EXPIRING_SOON_DAYS).  License renewal under §73.3539 must be filed in the renewal window or the authorization may lapse.  See evidence.fcc_lms.license.license_expiration_date.' },

  LICENSE_EXPIRED: { severity: 'blocker', phase: 'evidence',
    title: 'FCC license has expired',
    description: 'The FCC license for this station expired before the compute date.  No new exhibit can be filed against an expired authorization; renewal under §73.3539 or a new application is required.  See evidence.fcc_lms.license.license_expiration_date.' },

  LMS_DATA_MISMATCH: { severity: 'warning', phase: 'evidence',
    title: 'FCC LMS record disagrees with application data',
    description: 'The FCC FMQ/AMQ row for this station carries values (ERP, HAAT, frequency, class, lat/lon) that do not match the application inputs.  Filing requires consistency between Form 302 / 301 and the FCC\'s authoritative record.  See evidence.fcc_lms.cross_check.mismatches for the specific field-level deltas.' },

  PUBLIC_FILE_INCOMPLETE: { severity: 'warning', phase: 'evidence',
    title: 'Public inspection file appears incomplete (47 CFR §73.3526 / §73.3527)',
    description: 'Genoa\'s probe of the licensee\'s publicfiles.fcc.gov folder did not find one or more of the §73.3526 / §73.3527 required sub-folders (EEO Public File Report, Issues and Programs Lists, Political File, Authorizations, Citizen Agreements, etc.).  Reviewers may flag the application during routine inspection.  See evidence.fcc_lms.public_file.required_folders.missing.' },

  FCC_PARITY_VERIFIED: { severity: 'info', phase: 'validation',
    title: 'Genoa output verified bit-exact against FCC distance.json',
    description: 'A live comparison between Genoa\'s computed contour distances and the FCC\'s public distance.json endpoint passed at every sampled (radial × contour) point within tolerance.  evidence.fcc_parity_report carries the per-sample table; reviewers can replay the FCC API calls themselves to verify.' },

  FCC_PARITY_DELTA: { severity: 'warning', phase: 'validation',
    title: 'Genoa contour distance differs from FCC distance.json',
    description: 'One or more sampled (radial × contour) points differ from the FCC\'s public distance.json endpoint output beyond tolerance.  This is unusual — Genoa\'s vendored engine is the same code that backs the FCC endpoint.  Likely causes: upstream rate-limit returning stale data, DNS / proxy intercepting the call, or an engine-version drift.  See evidence.fcc_parity_report.samples for the per-sample deltas.' },

  SDR_CALIBRATION_MISSING: { severity: 'warning', phase: 'evidence',
    title: 'SDR captures present but receiver calibration metadata absent',
    description: 'The SDR captures attached to this exhibit do not carry the receiver-calibration metadata required by §73.314 (FM) / §73.186 (AM) for filing-grade measurement evidence: antenna gain, cable loss, LNA gain, and the calibration date.  The captures still ship as provenance, but their measured field-strength values are uncalibrated and the predicted-vs-measured residual table reflects raw deltas only.  Add the calibration block to the ZTR rich-station response or to each capture record to lift this warning.' },

  SDR_RESIDUAL_LARGE: { severity: 'warning', phase: 'evidence',
    title: 'SDR predicted-vs-measured residual exceeds 10 dB',
    description: 'The RMS residual between Genoa\'s predicted field strength (FCC §73.333 / §73.184 curves) and the calibrated SDR-measured field exceeds 10 dB across the captured locations.  This typically indicates terrain shadowing or multipath that the simplified §73.333 model does not capture (use options.use_itm = true for terrain-aware coverage), or a calibration error in the receiver chain.  See evidence.measurements.residuals for the per-row table.' },

  AM_73_24G_FAIL: { severity: 'blocker', phase: 'engine',
    title: 'AM §73.24(g) blanket-interference population ratio exceeds 1%',
    description: 'The population within the 1000 mV/m blanket-interference contour exceeds 1.0% of the population within the 25 mV/m service contour (47 CFR §73.24(g)).  The licensee must submit a blanketing-interference remediation plan (§73.88 — AM blanketing; §73.318 is the FM equivalent) and commit to receiver-treatment funds before filing.  This is a pre-construction showing requirement.' },

  AM_73_24J_FAIL: { severity: 'blocker', phase: 'engine',
    title: 'AM §73.24(i) community coverage — 5 mV/m contour does not encompass city of license',
    description: 'The proposed station\'s 5 mV/m groundwave service contour does not encompass the entire community of license (47 CFR §73.24(i)).  The facility as proposed cannot serve its community of license with the required daytime service level and does not qualify for a construction permit on these parameters.' },

  AM_INTERNATIONAL_TREATY_ZONE: { severity: 'warning', phase: 'engine',
    title: 'AM transmitter site inside US/MX or US/CA bilateral treaty zone',
    description: 'The proposed transmitter coordinates fall within a US/Mexico or US/Canada bilateral AM treaty zone.  Stations in these zones must protect co-channel and adjacent-channel foreign stations per the applicable bilateral agreement (NARBA or US/Canada agreement) under 47 CFR §73.1650 (international agreements) / §73.182.  A separate bilateral interference study is required before this application can be filed; the engineer of record must perform it and attach the exhibit to the FCC submission.  This engine does not produce bilateral treaty studies.' },

  AM_DA_PATTERN_COMPLIANCE_FAIL: { severity: 'blocker', phase: 'engine',
    title: 'AM DA pattern §73.150 compliance failure',
    description: 'The directional antenna pattern filed with this exhibit fails one or more §73.150 pattern-shape compliance checks (smoothness, max-to-min ratio, or RMS minimum field).  The FCC field-intensity analysis (§73.62 / §73.150) uses the authorized pattern; a failing pattern means the filed pattern does not conform to §73.150 construction standards.  The engineer of record must correct the DA pattern before filing.' },

  CONTOUR_MONOTONICITY_VIOLATION: { severity: 'blocker', phase: 'engine',
    title: 'Contour distance monotonicity violation',
    description: 'For one or more radials, a weaker-threshold contour has a shorter computed distance than a stronger-threshold contour.  This is physically impossible under FCC curve propagation and indicates a data-corruption event, an interpolation error, or a contour-ID assignment bug.  Filing readiness is blocked; re-run compute and inspect the radial table for the flagged radials.' },

  AM_NIGHTTIME_PROTECTION_VIOLATION: { severity: 'warning', phase: 'engine',
    title: 'AM nighttime skywave — simplified §73.190 study flagged a violation (47 CFR §73.182(k) / §73.190)',
    description: 'Genoa\'s simplified §73.182(k) / §73.190 SS-1 study (Wang formulation with geographic-lat midpoint approximation, see src/engine/curves/fcc/skywave.mjs header) detected a nighttime-skywave protection violation against one or more nearby AM stations.  Statutory basis: §73.182(k) (nighttime interference-free service / RSS combination per §73.185) using the SS-1 (50%) skywave field-strength formulation of §73.190.  This study is CONSERVATIVE relative to a full IGRF geomagnetic-lat transform with directional-pattern RSS integration over the great-circle azimuth — required for filing-grade go/no-go.  Required next step: licensed-engineer §73.182(k) RSS analysis before filing.  Genoa surfaces the nighttime-skywave study results on regulatory_compliance.studies for that review.' },
  // Rule-basis note for AM_NIGHTTIME_PROTECTION_VIOLATION (kept in
  // source comment, not rendered text): the daytime-radiation rule
  // at 47 CFR §73.187 is a separate provision and is not the basis
  // for this nighttime check.  See engine/regulatory/citations.js
  // for the canonical AM_NIGHTTIME_NIF / AM_SKYWAVE_CHARTS entries.

  OET65_NEAR_FIELD_REQUIRED: { severity: 'warning', phase: 'engine',
    title: 'OET-65 near-field analysis required (47 CFR §1.1310)',
    description: 'The far-field §1.1310 compliance distance falls inside the near-field boundary λ/(2π) at this frequency.  The far-field power-density formula is not accurate inside that zone; OET-65 §3.B near-field analysis using the antenna current distribution is required for filing-grade compliance.  Common at AM frequencies where λ/(2π) reaches tens of meters.' },

  OET65_BOUNDARY_VIOLATION: { severity: 'blocker', phase: 'engine',
    title: 'OET-65 / §1.1310 site-boundary MPE violation',
    description: 'The §1.1310 power density at the site boundary exceeds the uncontrolled (general-population) MPE limit at the operating frequency.  Filing requires either restricting public access out to the OET-65 compliance distance, demonstrating pattern downtilt that reduces the field at ground-level public-access points, or a §1.1310(d) waiver.' },

  MISSING_NEARBY_STATIONS: { severity: 'warning', phase: 'evidence',
    title: 'Nearby-stations list missing',
    description: 'No list of nearby primary stations was attached to the exhibit, so the §74.1204 D/U interference study could not run.  Provide evidence.nearby_primaries to complete the translator analysis.' },

  BUILD_UNVERSIONED: { severity: 'warning', phase: 'sidecar',
    title: 'Build SHA is "uncommitted" — replay-token build identity unreliable',
    description: 'The engine resolved to SHA "uncommitted" because no Docker .build_sha, GIT_COMMIT_SHA env-var, or .git/HEAD was found at startup.  The build_attestation.sha field is non-unique; two exhibits with different code may share the same "uncommitted" SHA.  Deploy via Docker or set GIT_COMMIT_SHA to fix.' },

  SIGMA_CLAMP: { severity: 'warning', phase: 'engine',
    title: 'AM σ rounded or clamped to FCC M3 grid (47 CFR §73.184)',
    description: 'The §73.184 groundwave grid is keyed on integer σ ∈ {1..8} mS/m (§73.190 Figure M3).  The typed conductivity was rounded to the nearest grid value, or clamped to the 1 / 8 mS/m boundary for out-of-range soils (wet/marine commonly ≥10 mS/m).  Distances reflect the boundary curve, not the typed σ.  See exhibit.evidence.ground_constants for the input vs. used values.' },

  // ─── AM nighttime NIF (§73.182) warning codes ────────────────────────────

  FCCAM_UNAVAILABLE_BERRY_FALLBACK: { severity: 'blocker', phase: 'sidecar',
    title: 'FCCAM sidecar unavailable — Berry 1968 screening used for NIF study',
    description: 'The FCCAM sidecar (FCCAM_SIDECAR_URL) was configured but unreachable at compute time.  The §73.182 NIF study ran on the Berry 1968 analytical screening engine instead.  Berry results are SCREENING-GRADE per §73.190(c) — the exhibit cannot be filed on this NIF study alone.  Re-run with the FCCAM Wang 1985 sidecar online before filing.' },

  AM_NIGHT_NIF_MARGINAL: { severity: 'info', phase: 'engine',
    title: 'AM §73.182 NIF study: marginal margin miss (advisory, FCCAM filing-grade)',
    description: 'The §73.182 nighttime NIF study (FCCAM Wang 1985) found azimuths with a failing margin within the engineering advisory band (≤ 0.5 dB over ≤ 10% of azimuths).  FCC practice does not treat a sub-decibel margin as a filing blocker at this scale.  Engineer of record should review the binding-azimuth detail in Appendix F-1.' },

  AM_NIGHT_NIF_MARGINAL_SCREENING: { severity: 'info', phase: 'engine',
    title: 'AM §73.182 NIF study: marginal margin miss (advisory, Berry screening-grade)',
    description: 'The §73.182 nighttime NIF study (Berry 1968 screening) found azimuths with a failing margin within the advisory band (≤ 0.5 dB over ≤ 10% of azimuths).  Berry 1968 under-estimates field strength in most regimes — this may resolve when re-run with FCCAM Wang 1985.  Not a filing blocker at this scale; FCCAM confirmation strengthens the case.' },

  AM_NIGHT_NIF_REVIEW: { severity: 'warning', phase: 'engine',
    title: 'AM §73.182 NIF study: failing margins require engineering review (FCCAM filing-grade)',
    description: 'The §73.182 nighttime NIF study (FCCAM Wang 1985) found meaningful failing margins (> 0.5 dB; ≤ 2.0 dB over ≤ 25% of azimuths).  Engineer of record should review the binding-azimuth detail in Appendix F-1 and decide whether a minor pattern tweak or §73.99 reduced-power authority is warranted before filing.' },

  AM_NIGHT_NIF_FAIL_SCREENING: { severity: 'warning', phase: 'engine',
    title: 'AM §73.182 NIF study: significant failures detected (Berry screening-grade)',
    description: 'The §73.182 nighttime NIF study (Berry 1968 screening) found significant failing margins.  Berry 1968 is screening-grade per §73.190(c) — re-run with FCCAM (Wang 1985) before filing.  If FCCAM also fails, a full §73.182(k) RSS analysis by the engineer of record is required.' },

  AM_NIGHT_NIF_FAIL: { severity: 'blocker', phase: 'engine',
    title: 'AM §73.182 NIF study: significant failure (FCCAM filing-grade) — engineering review required',
    description: 'The §73.182 nighttime NIF study (FCCAM Wang 1985) found significant failing margins (> 2.0 dB or > 25% of azimuths).  This is filing-grade evidence of a protection violation under §73.182.  A full §73.182(k) RSS analysis and/or facility modification (pattern, power, class) by the engineer of record is required before filing.' },

  // ─── County boundary / FCC county overlay warnings ──────────────────────

  COUNTY_BOUNDARY_DATASET_MISSING: { severity: 'blocker', phase: 'evidence',
    title: 'FCC county boundary dataset not found at configured path',
    description: 'The FCC-derived county boundary GeoJSON (us_counties_fcc.geojson) was not found at the configured FCC_COUNTY_GEOJSON_PATH.  County overlay analysis cannot run.  For filing-grade output, this dataset is required.  Do not silently fall back to the live FCC CGI — set FCC_COUNTY_GEOJSON_PATH to the merged dataset.' },

  COUNTY_BOUNDARY_LOAD_FAILED: { severity: 'blocker', phase: 'evidence',
    title: 'FCC county boundary dataset failed to load',
    description: 'The FCC county boundary GeoJSON was found but could not be parsed or failed integrity checks.  County overlay analysis is blocked.  Check the file for corruption and verify the dataset_sha256 matches the expected value.' },

  COUNTY_BOUNDARY_FEATURE_PARSE_WARNING: { severity: 'warning', phase: 'evidence',
    title: 'FCC county boundary: some features could not be parsed',
    description: 'One or more county features in us_counties_fcc.geojson could not be parsed (missing Name, malformed geometry, or ambiguous county name format).  The dataset is partially valid; analysis continues with the valid features.' },

  COUNTY_INTERSECTION_FAILED: { severity: 'warning', phase: 'evidence',
    title: 'County intersection computation failed for one or more counties',
    description: 'The contour-vs-county polygon intersection threw an error for one or more counties.  Those counties are excluded from the coverage table.  Re-run or inspect the exhibit.evidence.county_overlay.errors array.' },

  COUNTY_GEOMETRY_INVALID: { severity: 'warning', phase: 'evidence',
    title: 'One or more county boundary geometries are invalid (self-intersecting or unclosed)',
    description: 'The FCC KML boundary for one or more counties was unclosed or self-intersecting and could not be reliably polygonized.  Those counties are marked geometry_valid=false and excluded from filing-grade intersection analysis.' },

  COUNTY_OVERLAY_PARTIAL_DATASET: { severity: 'warning', phase: 'evidence',
    title: 'FCC county boundary dataset is partial (18 FCC endpoint misses documented)',
    description: 'The us_counties_fcc.geojson dataset covers 3,207 of approximately 3,225 FCC county-equivalents; 18 FCC KML endpoints did not return valid boundaries.  The dataset is marked partial_but_valid=true.  Studies are not failed on account of the 18 missing counties unless the contour area directly intersects a known-missing county.' },

  COUNTY_MISSING_INTERSECTION: { severity: 'blocker', phase: 'evidence',
    title: 'Contour intersects a county known to be missing from the FCC KML dataset',
    description: 'The study area overlaps a county that was one of the 18 FCC endpoint misses in the county boundary dataset.  No county boundary polygon is available for that county; the intersection analysis for it is not possible.  The engineer of record must independently verify county coverage before filing.' },

  // ─── Source attestation framework (PR #330) ─────────────────────────────
  // These codes live in source_attestation.blockers / source_attestation.warnings,
  // NOT in exhibit.blockers / exhibit.warnings.  That keeps offline test exhibits
  // that lack FCC LMS data from receiving false source-authority blockers.

  SOURCE_UNVERIFIED: { severity: 'blocker', phase: 'evidence',
    title: 'Source confidence below filing-grade threshold (70%)',
    description: 'The overall source confidence across all engineering values is below 70%, the minimum required for a filing-grade exhibit.  Too many values rely solely on operator input without cross-check against an authoritative record (FCC LMS, ASR, terrain DEM).  Obtain FCC LMS license data, terrain DEM evidence, and ASR data to raise confidence before filing.' },

  SOURCE_CONFLICT: { severity: 'warning', phase: 'evidence',
    title: 'Cross-source authority conflict detected',
    description: 'Two independent authoritative sources disagree on an engineering value beyond its tolerance threshold (coordinates >10 m, tower height >3 m, ERP >5%, RCAMSL >20 m, frequency mismatch, FCC class mismatch, HAAT >50%).  The engineer of record must reconcile the conflict and certify the operative value before filing.' },

  SOURCE_OPERATOR_ONLY: { severity: 'warning', phase: 'evidence',
    title: 'Engineering value rests on operator input only (no cross-check)',
    description: 'This engineering value has not been cross-checked against any authoritative record (FCC LMS, ASR, terrain DEM, FAA OE/AAA).  Operator-entered values have a trust score of 0.50; two independent authoritative sources raise confidence above 0.90.  Obtain corroborating evidence to strengthen the filing.' },

  SOURCE_HASH_MISSING: { severity: 'info', phase: 'evidence',
    title: 'Evidence source hash not available',
    description: 'One or more evidence source records could not be fingerprinted because they were absent from the exhibit at attestation time.  The filed PDF will not carry a SHA-256 provenance hash for those sources.  Re-run with live FCC LMS and ASR evidence attached to generate a complete hash chain.' },

  SOURCE_CONFIDENCE_LOW: { severity: 'warning', phase: 'evidence',
    title: 'Source confidence below 85% — engineering review recommended',
    description: 'The overall source confidence is between 70% and 85%.  The exhibit clears the minimum filing threshold but has not reached the 85% "well-corroborated" band.  Engineering review is required to confirm operator-entered values before filing.' },

  SOURCE_AUTHORITY_UNKNOWN: { severity: 'info', phase: 'evidence',
    title: 'Source authority could not be determined for one or more fields',
    description: 'One or more engineering values have unknown source authority (trust score 0.0).  This typically means the field was not populated by any recognized source — not operator input, not an FCC record, not a terrain DEM.  Investigate the missing provenance and supply the value from an authoritative source.' },

  // ─── Source freshness + evidence lock framework (PR #331) ────────────────

  SOURCE_STALE: { severity: 'warning', phase: 'evidence',
    title: 'Authoritative source record is stale',
    description: 'An evidence source record is older than the staleness threshold for its authority type (FCC LMS/ASR >30 days, FAA OE/AAA >90 days).  Stale records are still usable but require engineering review before filing.  Re-fetch the source record to restore current status.' },

  SOURCE_AGING: { severity: 'info', phase: 'evidence',
    title: 'Authoritative source record is aging',
    description: 'An evidence source record has passed the aging-notice threshold (FCC LMS/ASR >14 days, FAA >30 days) but has not yet reached the stale threshold.  No filing action required, but re-fetching the record ahead of filing is prudent.' },

  SOURCE_TIMESTAMP_MISSING: { severity: 'warning', phase: 'evidence',
    title: 'Source record has no retrieval or modification timestamp',
    description: 'An authoritative evidence record does not carry a retrieved_at or source_last_modified timestamp.  Without a timestamp, Genoa cannot assess freshness.  Ensure the source fetch pipeline stamps every record with at least a retrieved_at timestamp.' },

  SOURCE_REFRESH_REQUIRED: { severity: 'blocker', phase: 'evidence',
    title: 'Critical source record must be refreshed before filing',
    description: 'A source record that is authoritative for a filing-critical field (frequency, coordinates, RCAMSL, tower height, FCC class) is both stale and flagged refresh_required.  Filing is blocked until the record is re-fetched and the freshness threshold is cleared.' },

  SOURCE_RECORD_CHANGED: { severity: 'blocker', phase: 'evidence',
    title: 'Source record has changed since exhibit was generated',
    description: 'A source evidence record that was locked at exhibit generation time has a different content hash now.  The exhibit engineering values may no longer agree with the current authoritative record.  Re-compute the exhibit from the updated source record before filing.' },

  SOURCE_EVIDENCE_LOCK_MISSING: { severity: 'blocker', phase: 'evidence',
    title: 'Evidence lock entry missing for a critical source',
    description: 'A critical source (FCC LMS, FCC ASR) is present in evidence but has no corresponding entry in the evidence lock, or the evidence lock itself is absent.  Filing-grade exhibits require a complete evidence lock so auditors can verify that source records have not changed since the study was computed.' },

  SOURCE_EVIDENCE_LOCK_INVALID: { severity: 'blocker', phase: 'evidence',
    title: 'Evidence lock hash mismatch — source record changed after locking',
    description: 'The SHA-256 fingerprint of one or more evidence records does not match the value stored in the evidence lock.  This means a source record was modified or replaced after the exhibit was computed.  The exhibit must be recomputed from the current source records.' },

  SOURCE_EVIDENCE_LOCK_STALE: { severity: 'warning', phase: 'evidence',
    title: 'Evidence lock is older than the source freshness window',
    description: 'The evidence lock was generated more than the staleness threshold ago.  The lock hashes may still be valid, but the underlying source records should be re-fetched and the exhibit recomputed to produce a lock stamped with current data.' },

  // ─── Readiness gate codes (used in readiness/index.js blockers/warnings) ──

  FIELD_INVALID: { severity: 'blocker', phase: 'input',
    title: 'Required input field is missing or invalid',
    description: 'A required engineering input field is absent, null, or outside its valid range.  The exhibit cannot proceed to computation until all required fields are supplied with valid values.' },

  COMPLIANCE_FAILURE: { severity: 'blocker', phase: 'engine',
    title: 'Regulatory compliance check failed',
    description: 'One or more FCC regulatory compliance checks (contour protection, separation, power limits) produced a failing result.  The filing is blocked; the engineer of record must resolve the compliance failure before submitting.' },

  ASR_UNREGISTERED: { severity: 'blocker', phase: 'evidence',
    title: 'Tower above ASR threshold but not registered (47 CFR §17.7)',
    description: 'The antenna support structure exceeds the 47 CFR §17.7 registration threshold but no Antenna Structure Registration (ASR) number is attached to the exhibit.  FCC LMS will reject Form 301 / 302 submissions for structures above this threshold without a valid ASR number.' },

  ENGINEER_CONFIRMATION_NEEDED: { severity: 'warning', phase: 'export',
    title: 'Exhibit requires engineer-of-record confirmation before filing',
    description: 'One or more exhibit parameters require explicit certification by a licensed professional engineer before the filing can be submitted to the FCC.  Review the exhibit findings and sign off.' },

  TERRAIN_EVIDENCE_MISSING: { severity: 'warning', phase: 'evidence',
    title: 'Terrain evidence not attached — HAAT is operator-entered',
    description: 'No terrain DEM evidence was attached to this exhibit.  Per-radial HAAT is set to the operator-entered value rather than a terrain-computed value.  FCC §73.313 requires arc-averaged terrain HAAT for filing-grade FM exhibits; attach terrain evidence to compute a defensible HAAT.' },

  ENGINE_BLOCKER: { severity: 'blocker', phase: 'engine',
    title: 'Engine-level blocker surfaced from exhibit',
    description: 'The propagation engine produced one or more blocker-severity issues that prevent this exhibit from reaching a READY determination.  See exhibit.blockers for the specific engine-level failure details.' },

  FIELD_CONFLICT: { severity: 'warning', phase: 'evidence',
    title: 'Conflicting values for one or more engineering fields',
    description: 'Two inputs or evidence sources provide different values for the same engineering field and the conflict was not automatically resolved.  The engineer of record must identify the authoritative value and reconcile the conflict before filing.' },

  OET65_REQUIRED: { severity: 'warning', phase: 'engine',
    title: 'OET-65 RF exposure evaluation required (47 CFR §1.1310)',
    description: 'This station\'s ERP and frequency combination meets or exceeds the §1.1310 threshold requiring a formal RF exposure (MPE) evaluation per OET Bulletin 65.  The evaluation has not been performed or has not been attached to this exhibit.  A signed OET-65 compliance study is required for filing.' },

  OET65_MISSING: { severity: 'info', phase: 'engine',
    title: 'OET-65 RF exposure evaluation not attached',
    description: 'No OET-65 RF exposure study is attached to this exhibit.  If the station\'s ERP and frequency place it above the §1.1310 evaluation threshold, an OET-65 study is required; otherwise this is advisory only.' },

  SDR_MISSING: { severity: 'info', phase: 'evidence',
    title: 'No SDR field-measurement captures attached',
    description: 'No SigMF SDR measurement captures are attached to this exhibit.  Field measurements provide empirical evidence of actual radiated field strength and are valuable for engineering review, though they are not required for FCC filing.' },

  AM_PHYSICS_MISSING: { severity: 'info', phase: 'evidence',
    title: 'AM SOMNEC2D physics advisory not run',
    description: 'The SOMNEC2D AM ground-wave physics advisory analysis was not run for this exhibit.  SOMNEC2D provides a numerical electromagnetic check on the antenna system\'s effective ground resistance and efficiency, which is particularly valuable for AM DA filings.' },

  // ─── Directional antenna pattern checks (daPatternCheck.js) ─────────────

  DA_PATTERN_MISSING: { severity: 'blocker', phase: 'input',
    title: 'Directional antenna pattern required but not provided',
    description: 'The exhibit uses a directional antenna but no horizontal radiation pattern was supplied.  A horizontal radiation pattern (Table of Relative Field Values per §73.316) is required for Form 301-FM filings with directional antennas.  Provide the pattern before continuing.' },

  DA_PATTERN_UNCONFIRMED: { severity: 'warning', phase: 'input',
    title: 'Directional antenna pattern present but not confirmed',
    description: 'A horizontal radiation pattern is attached but it has not been confirmed by the engineer of record.  Pattern verification is required before filing a directional antenna exhibit.' },

  DA_PATTERN_INVALID: { severity: 'blocker', phase: 'input',
    title: 'Directional antenna pattern fails §73.316 validity checks',
    description: 'The supplied horizontal radiation pattern fails one or more §73.316 validity checks (e.g., normalization, radial count, suppression ratio).  Correct the pattern before filing.' },

  DA_PATTERN_INCOMPLETE: { severity: 'warning', phase: 'input',
    title: 'Directional antenna pattern is missing radials',
    description: 'The horizontal radiation pattern does not include all required radials (typically every 10° per §73.316).  Missing radials will be interpolated, which may reduce pattern accuracy.  Provide a complete 36-radial pattern for filing-grade exhibits.' },

  DA_PATTERN_UNNORMALIZED: { severity: 'warning', phase: 'input',
    title: 'Directional antenna pattern is not normalized to unity maximum',
    description: 'The maximum relative field value in the pattern is not 1.000.  §73.316 requires the pattern to be normalized so the maximum relative field equals 1.000.  The pattern has been auto-normalized for computation; verify the normalization is correct before filing.' },

  DA_SUPPRESSION_UNVERIFIED: { severity: 'warning', phase: 'input',
    title: 'DA suppression ratio not independently verified',
    description: 'The directional antenna suppression ratio has not been cross-checked against a measured or FCC-approved value.  The suppression ratio affects contour distances in the protected directions; an unverified ratio is a filing risk for short-spaced directional applications.' },

  // ─── AM site optimizer / relocation screening ────────────────────────────

  SCORE_CLUSTERED: { severity: 'warning', phase: 'engine',
    title: 'Score clustering detected — optimizer may not differentiate sites',
    description: 'More than 10 candidates share the same composite score.  This typically means the active goal mix does not have enough variation to distinguish candidate sites from each other (e.g., only one goal enabled, or all candidates are at the same ground conductivity).  Enable additional goals or narrow the search radius.' },

  REACH_PLACEHOLDER: { severity: 'warning', phase: 'engine',
    title: 'Identical daytime reach values across many candidates — propagation may be flat',
    description: 'More than 10 candidates share the same daytime reach estimate.  This is expected when the screening engine has no per-site ground conductivity raster and uses the same regional σ bin for all points.  The reach values are not differentiating candidates by propagation geometry; per-site DEM conductivity integration is required for filing-grade reach estimates.' }
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
    // Collapse to one warning per code.  When the same code appears
    // multiple times (e.g. the engine emits a detail-less default and
    // the API service emits a richer one), prefer the entry with a
    // non-empty `detail` so the UI shows the most informative copy.
    const byCode = new Map();
    for (const w of warnings){
      const prev = byCode.get(w.code);
      if (!prev){ byCode.set(w.code, w); continue; }
      if (!prev.detail && w.detail) byCode.set(w.code, w);
    }
    return [...byCode.values()];
  }
}
