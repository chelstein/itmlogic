// Orchestration: turns an HTTP compute request into a full
// genoa.exhibit.v2.  Resolves sidecars, runs the engine, attaches
// validation, renders narrative.  All structural; no math.
//
// Outcome-A wiring (see docs/ztr-data-audit.md):
//   - facility lookup           → ZTR /api/broadcast/stations
//   - rich station enrichment   → ZTR /api/radiodns/station/:id
//       which carries _fcc_contour (geo.fcc.gov) and _captures.
//   - per-radial §73.313 HAAT   → ZTR /api/broadcast/stations/:id/terrain-haat
//   - FCC curve cross-validate  → compare engine polygons to _fcc_contour
//   - SDR evidence              → _captures
// Each enrichment emits provenance; warnings/blockers clear ONLY when
// real, sourced evidence is present.

import { compute }              from '../../engine/index.js';
import { runValidationSuite }   from '../../engine/validation/runner.js';
import { renderNarrative }      from '../../narrative/generator.js';
import { sidecars }             from './sidecars.js';
import { getCached, putCached } from './facilityCache.js';
import { validateAgainstFccContour } from '../../evidence/curveValidation/ztrFccContourValidator.js';
import { runCurveReferenceValidation } from '../../validation/curveReferenceValidation.js';
import { W }                    from '../../types/warnings.js';

let _validationCache = null;
let _validationCachedAt = 0;
const VALIDATION_TTL_MS = 5 * 60 * 1000;

export async function getOrRunValidation(){
  const now = Date.now();
  if (_validationCache && (now - _validationCachedAt) < VALIDATION_TTL_MS){
    return _validationCache;
  }
  _validationCache = await runValidationSuite();
  _validationCachedAt = now;
  return _validationCache;
}

export async function computeExhibit(req){
  const inputs   = { ...(req.inputs   || {}) };
  const options  = req.options  || {};
  const evidence = {};
  const facilityWarnings = [];
  let facilityResolution = null;
  let richStation        = null;   // raw ZTR /api/radiodns/station/:id response
  let terrainResp        = null;   // raw ZTR /api/.../terrain-haat response
  let fccContourResp     = null;   // { available, source, endpoint, contour }
  let sdrResp            = null;   // { available, source, endpoint, n_records, records }

  // ---- 1. Resolve facility_id ----
  if (inputs.facility_id){
    const cached = await getCached(String(inputs.facility_id));
    let facility = cached?.facility || null;
    let source   = cached?.source   || null;
    if (!facility && sidecars.facility){
      const r = await sidecars.facility.getById(String(inputs.facility_id));
      if (r.facility){
        facility = r.facility;
        source   = r.source;
        await putCached(facility).catch(() => {});
      } else if (!r.source){
        facilityWarnings.push(W.make('FACILITY_LOOKUP_UNAVAILABLE', r.error || 'no facility source reachable'));
      }
    } else if (!facility && !sidecars.facility){
      facilityWarnings.push(W.make('FACILITY_LOOKUP_UNAVAILABLE',
        'No facility data source configured (ZERO_TRUST_RADIO_READONLY_URL / N8N_BASE_URL).'));
    }
    if (facility){
      const fillIfMissing = (k, v) => { if (inputs[k] === undefined || inputs[k] === null || inputs[k] === '') inputs[k] = v; };
      fillIfMissing('call',            facility.call);
      fillIfMissing('service',         facility.service);
      fillIfMissing('fcc_class',       facility.fcc_class);
      fillIfMissing('frequency',       facility.frequency);
      fillIfMissing('erp_kw',          facility.erp_kw);
      fillIfMissing('haat_m',          facility.haat_m);
      fillIfMissing('lat',             facility.lat);
      fillIfMissing('lon',             facility.lon);
      facilityResolution = { source, facility };
    }
  }

  // ---- 2. Rich station enrichment (FCC contour + captures) ----
  // Needs a ZTR station id, which is on the normalized facility row's
  // facility_lookup_source.ztr_id.  Skip silently when unavailable.
  //
  // SDR evidence gating: ZTR's capture infrastructure currently only
  // produces meaningful evidence for AM stations (FM-band capture
  // coverage is not yet in place).  Pulling FM "captures" today would
  // attach noise as evidence and clear SDR_MEASUREMENTS_MISSING
  // dishonestly.  The gate is service-aware and configurable via
  // SDR_EVIDENCE_SERVICES (CSV, default "AM") so FM can be flipped on
  // when the capture coverage is ready — no code change required.
  const SDR_SERVICES = (process.env.SDR_EVIDENCE_SERVICES || 'AM')
    .split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
  const sdrEnabledForService = SDR_SERVICES.includes(String(inputs.service || '').toUpperCase());

  const ztrStationId = facilityResolution?.facility?.facility_lookup_source?.ztr_id;
  if (ztrStationId && sidecars.facility?.getRichStation){
    richStation = await sidecars.facility.getRichStation(ztrStationId);
    if (richStation?.available){
      // FCC contour (cross-check input) — pulled for every service.
      const fc = await sidecars.facility.getFccContour({ stationId: ztrStationId, rich: richStation });
      if (fc.available) fccContourResp = fc;
      // SDR evidence — gated by service.
      if (sdrEnabledForService){
        const sdr = await sidecars.facility.getSdrEvidence({ stationId: ztrStationId, rich: richStation });
        if (sdr.available) sdrResp = sdr;
      }
    }
  }

  // ---- 2b. FCC Contours direct fallback ----
  // When ZTR didn't supply a contour (not configured, station not in ZTR,
  // or _fcc_contour missing), hit geo.fcc.gov/api/contours/entity.json
  // directly using the facility_id + service from inputs.  This is the
  // same public API ZTR proxies — public, no auth, always available.
  if (!fccContourResp && sidecars.fccContours && inputs.facility_id && inputs.service){
    try {
      const fc = await sidecars.fccContours.getContour(inputs.facility_id, inputs.service);
      if (fc.available) fccContourResp = fc;
    } catch { /* ignore; cross-check stays null */ }
  }

  // ---- 3. Per-radial §73.313 HAAT ----
  // Pulled from ZTR's terrain-haat endpoint (Outcome A; PR
  // chelstein/zerotrustradio#243).  Only used when the request opts in
  // (`options.use_terrain` true) AND the facility carries lat/lon AND
  // the service isn't AM (groundwave doesn't use HAAT).
  if (options.use_terrain
      && inputs.facility_id
      && inputs.service !== 'AM'
      && sidecars.facility?.getTerrainHaatRadials){
    const step = Number(inputs.radial_step_deg) || 10;
    terrainResp = await sidecars.facility.getTerrainHaatRadials({
      facility_id:     String(inputs.facility_id),
      radial_step_deg: step
    });
    if (terrainResp?.available && Array.isArray(terrainResp.radials) && terrainResp.radials.length){
      // Hand the engine its per-radial HAAT in the shape it expects.
      evidence.terrain_haat_per_radial = terrainResp.radials
        .filter(r => Number.isFinite(r.haat_m))
        .map(r => ({
          az:                     r.azimuth_deg,
          haat_input_m:           Number(inputs.haat_m) || null,
          haat_computed_m:        r.haat_m,
          haat_source:            'arc_averaged_dem',
          terrain_profile_source: terrainResp.dem?.source || 'zerotrustradio'
        }));
      evidence.terrain = {
        available:  true,
        source:     terrainResp.source || 'zerotrustradio',
        endpoint:   terrainResp.endpoint,
        method:     terrainResp.method,
        dem:        terrainResp.dem,
        fetched_at: terrainResp.fetched_at,
        n_radials:  terrainResp.n_radials,
        profiles:   terrainResp.radials.map(r => ({
          az:                r.azimuth_deg,
          haat_computed_m:   r.haat_m,
          avg_elev_m:        r.avg_elev_m,
          min_elev_m:        r.min_elev_m,
          max_elev_m:        r.max_elev_m,
          samples:           r.samples
        }))
      };
    } else {
      evidence.terrain_haat_requested = true;
    }
  }

  // ---- 3b. SPLAT sidecar capability probe (provenance only today) ----
  // When SPLAT_SIDECAR_URL is configured, probe the sidecar's health +
  // version and stamp the result on evidence.splat.  We do NOT compute
  // engineering output via SPLAT yet — that requires DEM tiles
  // provisioned in the sidecar's WORKDIR plus an inline-QTH route the
  // sidecar doesn't yet expose.  This wiring puts the connection in
  // place so the moment those land, switching the engine over is a
  // single-call change in this same block.
  if (sidecars.splat){
    try {
      const cap = await sidecars.splat.capability();
      evidence.splat = cap.available
        ? {
            available:        true,
            source:           cap.source,
            endpoint:         cap.endpoint,
            sidecar_name:     cap.sidecar_name,
            splat_bin:        cap.splat_bin,
            workdir:          cap.workdir,
            dem_provisioned:  cap.dem_provisioned,
            note:             cap.notes
          }
        : {
            available: false,
            source:    null,
            error:     cap.error
          };
    } catch (e){
      evidence.splat = { available: false, source: null, error: String(e.message) };
    }
  }

  // ---- 4. SDR evidence — pre-attach so engine sees it ----
  if (sdrResp?.available){
    evidence.measurements = {
      available:  true,
      source:     sdrResp.source,
      endpoint:   sdrResp.endpoint,
      fetched_at: sdrResp.fetched_at,
      n_records:  sdrResp.n_records,
      calibrated: !!sdrResp.calibrated,
      records:    sdrResp.records
    };
  }

  // ---- 5. Identity sidecar (best-effort) ----
  if (sidecars.identity && (inputs.call || inputs.facility_id)){
    try {
      const ident = await sidecars.identity.resolve({
        call:           inputs.call,
        facility_id:    inputs.facility_id,
        frequency:      inputs.frequency,
        frequency_unit: inputs.service === 'AM' ? 'kHz' : 'MHz'
      });
      evidence.identity = ident;
    } catch {/* swallow; identity is best-effort */}
  }

  // ---- 6. Validation context ----
  // Two INDEPENDENT validation systems:
  //   a) curve_reference_validation — internal golden fixtures that
  //      pin the engine + dataset + interpolation against known
  //      values.  PASS clears CURVE_VALIDATION_MISSING.  This is the
  //      ONLY system that touches that blocker.
  //   b) fcc_geo_contour_crosscheck — external comparison against
  //      ZTR's _fcc_contour proxy.  PASS / FAIL / SKIP are reported
  //      as evidence (FCC_GEO_CROSSCHECK_FAILED / SKIPPED warnings),
  //      never as CURVE_VALIDATION_MISSING.  See PRs #24, this PR.
  const curveRefRun = await runCurveReferenceValidation();
  // The legacy reference-cases run (smoke + KSLX seed) is still
  // surfaced for engine-regression visibility, but no longer drives
  // CURVE_VALIDATION_MISSING — the golden fixture does.
  const legacyRun = await getOrRunValidation();
  let validationContext = {
    runs: [curveRefRun, legacyRun],
    reference_cases_present: curveRefRun.pass || legacyRun.reference_cases_present
  };

  // ---- 7. Compute ----
  const exhibit = await compute({ inputs, evidence, options: {
    operator:     options.operator     || null,
    organization: options.organization || null,
    user_agent:   options.user_agent   || null,
    validation:   validationContext
  }});

  // ---- 8a. Population evidence (sourced; never invented) ----
  // Ask the population adapter for an estimate over the SERVICE contour
  // (first/largest polygon) when the upstream is configured AND the
  // engine actually produced a closed polygon.  If anything in the
  // chain fails or the response is malformed, leave the engine's
  // placeholder estimate in place — the warning persists.
  let populationResp = null;
  const servicePoly = (exhibit.polygons || []).find(p => p.closed && p.ring_latlng?.length);
  const serviceFeature = (exhibit.geojson?.features || [])[0];
  if (sidecars.population && serviceFeature && servicePoly){
    try {
      populationResp = await sidecars.population.populationForContour({
        geojson:       serviceFeature,
        contour_label: servicePoly.label
      });
    } catch (e){
      populationResp = { available: false, source: null, error: String(e.message) };
    }
  }
  if (populationResp?.available){
    exhibit.population_estimate = {
      primary:       populationResp.persons,
      protected:     null,
      model:         populationResp.method,
      method:        populationResp.method,
      source:        populationResp.source,
      dataset:       populationResp.dataset,
      vintage:       populationResp.vintage,
      endpoint:      populationResp.endpoint,
      fetched_at:    populationResp.fetched_at,
      sha256:        populationResp.sha256,
      contour_label: populationResp.contour_label
    };
  } else if (populationResp){
    // Reachable but malformed/HTTP error: stamp the failure reason on
    // the placeholder so the UI can surface why the warning persists.
    exhibit.population_estimate = {
      ...(exhibit.population_estimate || {}),
      attempted_source: 'POPULATION_EVIDENCE_URL',
      attempt_status:   'failed',
      attempt_error:    populationResp.error || null,
      attempt_missing:  populationResp.missing || null,
      attempt_endpoint: populationResp.endpoint || null
    };
  }

  // ---- 8b. Cross-validate engine output against FCC contour ----
  // The cross-check requires the engine's polygons + station coords,
  // both available now.  If the FCC contour is reachable AND the
  // cross-check passes, REPLACE the validation context with this run
  // (it's authoritative — it's a comparison to the FCC's own answer).
  let crossCheckRun = null;
  if (fccContourResp?.available){
    crossCheckRun = validateAgainstFccContour(exhibit, fccContourResp.contour, {
      source:       fccContourResp.source,
      endpoint:     fccContourResp.endpoint,
      upstream_api: fccContourResp.upstream_api
    });
    // Append the FCC cross-check to the runs list so it sits next to
    // the curve-reference run and the legacy regression run.
    exhibit.validation = {
      runs:                    [curveRefRun, legacyRun, crossCheckRun],
      reference_cases_present: curveRefRun.pass
                               || crossCheckRun.reference_cases_present
                               || legacyRun.reference_cases_present
    };
  }

  // ---- 9. Provenance: facility / terrain / curve / sdr ----
  if (facilityResolution){
    const f = facilityResolution.facility;
    exhibit.facility_metadata = {
      cached:                 true,
      facility_lookup_source: facilityResolution.source,
      facility_endpoint:      f?.facility_lookup_source?.endpoint || null,
      facility_updated_at:    f?.facility_lookup_source?.fetched_at || null,
      raw:                    f
    };
  }
  if (evidence.terrain?.available){
    exhibit.evidence.terrain = evidence.terrain;
  }
  if (evidence.measurements?.available){
    exhibit.evidence.measurements = evidence.measurements;
  }
  if (evidence.identity){
    exhibit.evidence.identity = evidence.identity;
  }
  if (evidence.splat){
    exhibit.evidence.splat = evidence.splat;
  }

  // ---- 10. Reconcile warnings against actual evidence ----
  // The engine pre-emptively emits CONSTANT_HAAT_ASSUMED, FACILITY_LOOKUP_UNAVAILABLE,
  // SDR_MEASUREMENTS_MISSING, and CURVE_VALIDATION_MISSING based on its
  // local view.  Now that we have real evidence, drop the ones that
  // shouldn't apply.
  let warnings = exhibit.warnings || [];

  if (facilityResolution){
    warnings = warnings.filter(w => w.code !== 'FACILITY_LOOKUP_UNAVAILABLE');
  } else if (facilityWarnings.length){
    const codes = new Set(facilityWarnings.map(w => w.code));
    warnings = warnings.filter(w => !codes.has(w.code));
    warnings.push(...facilityWarnings);
  }

  if (evidence.terrain?.available){
    warnings = warnings.filter(w => w.code !== 'CONSTANT_HAAT_ASSUMED' && w.code !== 'TERRAIN_NOT_APPLIED');
  } else if (evidence.terrain_haat_requested){
    // Asked for it, didn't get it.
    warnings.push(W.make('TERRAIN_NOT_APPLIED', 'Terrain HAAT requested via ZTR but no radials returned; falling back to flat HAAT.'));
  }

  if (evidence.measurements?.available){
    warnings = warnings.filter(w => w.code !== 'SDR_MEASUREMENTS_MISSING');
    if (!evidence.measurements.calibrated){
      // Real captures, but no calibration metadata: warn instead.
      const has = warnings.find(w => w.code === 'SDR_MEASUREMENTS_NOT_CALIBRATED');
      if (!has) warnings.push(W.make('SDR_MEASUREMENTS_NOT_CALIBRATED',
        `Attached ${evidence.measurements.n_records} capture(s) from ${evidence.measurements.source} carry no calibration metadata.`));
    }
  } else if (!sdrEnabledForService){
    // No SDR evidence pulled because the service isn't in the
    // SDR_EVIDENCE_SERVICES gate (default: AM only).  Replace the
    // engine's default SDR_MEASUREMENTS_MISSING with one that names
    // the gate so reviewers know it isn't a missing-data bug.
    warnings = warnings.filter(w => w.code !== 'SDR_MEASUREMENTS_MISSING');
    warnings.push(W.make('SDR_MEASUREMENTS_MISSING',
      `SDR capture coverage not yet enabled for service "${inputs.service}". ZTR captures only the services in SDR_EVIDENCE_SERVICES (currently: ${SDR_SERVICES.join(', ')}); flip this on by setting SDR_EVIDENCE_SERVICES once FM-band capture is in place.`));
  }

  // Population: clear ONLY when we have a fully-validated record from
  // a real upstream.  Malformed or missing responses keep the warning.
  if (populationResp?.available){
    warnings = warnings.filter(w => w.code !== 'POPULATION_PLACEHOLDER');
  } else if (populationResp && !populationResp.available){
    // Upstream was reachable but returned malformed data: keep the
    // warning AND attach detail describing what was missing.
    warnings = warnings.filter(w => w.code !== 'POPULATION_PLACEHOLDER');
    const detail = populationResp.missing?.length
      ? `Upstream returned malformed population evidence; missing fields: ${populationResp.missing.join(', ')}.`
      : `Population upstream attempt failed: ${populationResp.error || 'unknown'}.`;
    warnings.push(W.make('POPULATION_PLACEHOLDER', detail));
  }

  // ---- Curve reference validation (drives CURVE_VALIDATION_MISSING) ----
  // PASS clears the blocker.  This is the ONLY system that touches it.
  // Internal golden fixtures pin the engine + dataset + interpolation;
  // failure means engine drift, dataset corruption, or interp regression.
  if (curveRefRun?.pass){
    warnings = warnings.filter(w => w.code !== 'CURVE_VALIDATION_MISSING');
  } else {
    // Replace any prior CURVE_VALIDATION_MISSING (default-detail one
    // emitted by the engine pre-compute) with a curve-reference-specific
    // detail so reviewers know which suite failed.
    warnings = warnings.filter(w => w.code !== 'CURVE_VALIDATION_MISSING');
    const detail = curveRefRun?.n_run === 0
      ? 'Internal golden fixture suite produced no runnable cases; pinned-dataset validation could not score.'
      : `Internal golden fixture suite failed: ${curveRefRun.n_run - curveRefRun.n_pass} of ${curveRefRun.n_run} cases out of tolerance (max error ${curveRefRun.max_error_km?.toFixed(3)} km, tolerance ${curveRefRun.tolerance_km} km).  This means the engine + curve dataset are not producing their pinned values — engine drift, dataset corruption, or interpolation regression.`;
    warnings.push(W.make('CURVE_VALIDATION_MISSING', detail));
  }

  // ---- FCC geo contour cross-check (independent, evidence-only) ----
  // Drives FCC_GEO_CROSSCHECK_FAILED / FCC_GEO_CROSSCHECK_SKIPPED.
  // NEVER drives CURVE_VALIDATION_MISSING.  The FCC's published contour
  // uses a terrain-aware ITM method that the engine doesn't replicate;
  // a mismatch is engineering evidence, not a curve-validation failure.
  if (crossCheckRun?.authoritative_pass){
    // No warning — the cross-check passes (or absent).
  } else if (crossCheckRun && !crossCheckRun.authoritative_pass){
    if (!crossCheckRun.reference_cases_present || crossCheckRun.n_run === 0){
      warnings.push(W.make('FCC_GEO_CROSSCHECK_SKIPPED',
        'ZTR returned no usable _fcc_contour for this station (geo.fcc.gov may be unreachable, the station has no published FCC contour yet, or the response was malformed).'));
    } else {
      warnings.push(W.make('FCC_GEO_CROSSCHECK_FAILED',
        `${crossCheckRun.n_run - crossCheckRun.n_pass} of ${crossCheckRun.n_run} FCC contours out of tolerance (max error ${crossCheckRun.max_error_km?.toFixed(2)} km, tolerance ${crossCheckRun.tolerance_km} km).  FCC's contour is terrain-aware (ITM); the engine is free-space §73.333.  This deviation is expected for sites with terrain shadowing.`));
    }
  } else if (richStation?.available && !fccContourResp){
    // Rich-station reached but no _fcc_contour.
    warnings.push(W.make('FCC_GEO_CROSSCHECK_SKIPPED',
      'ZTR rich-station endpoint returned no usable _fcc_contour for this station.'));
    crossCheckRun = {
      source:                  'zerotrustradio',
      endpoint:                richStation.endpoint || null,
      upstream_api:            'https://geo.fcc.gov/api/contours/entity.json',
      method:                  'FCC contour cross-check (geo.fcc.gov)',
      tolerance_km:            null,
      ran_at:                  new Date().toISOString(),
      n_run: 0, n_pass: 0,
      max_error_km:            null,
      authoritative_pass:      false,
      reference_cases_present: false,
      result:                  'skipped'
    };
  }
  // Surface BOTH validation systems directly on the exhibit's
  // validation block so the Provenance UI can render them without
  // peeling the array.
  exhibit.validation = exhibit.validation || { runs: [] };
  exhibit.validation.curve_reference_validation = {
    name:           curveRefRun?.name || 'fm-f5050-golden',
    method:         curveRefRun?.method || null,
    fixture_path:   curveRefRun?.fixture_path || null,
    curve_dataset:  curveRefRun?.curve_dataset || null,
    tolerance_km:   curveRefRun?.tolerance_km ?? null,
    ran_at:         curveRefRun?.ran_at || null,
    n_run:          curveRefRun?.n_run ?? 0,
    n_pass:         curveRefRun?.n_pass ?? 0,
    max_error_km:   curveRefRun?.max_error_km ?? null,
    mean_error_km:  curveRefRun?.mean_error_km ?? null,
    result:         curveRefRun?.result || 'no_cases'
  };
  if (crossCheckRun){
    exhibit.validation.fcc_cross_check = {
      source:       crossCheckRun.source,
      endpoint:     crossCheckRun.endpoint,
      upstream_api: crossCheckRun.upstream_api,
      method:       crossCheckRun.method,
      tolerance_km: crossCheckRun.tolerance_km,
      ran_at:       crossCheckRun.ran_at,
      n_run:        crossCheckRun.n_run,
      n_pass:       crossCheckRun.n_pass,
      max_error_km: crossCheckRun.max_error_km,
      result:       crossCheckRun.authoritative_pass ? 'pass' : (crossCheckRun.reference_cases_present ? 'fail' : 'skipped')
    };
  }

  if (process.env.TERRAIN_SIDECAR_URL && !sidecars.terrain){
    warnings.push(W.make('SIDECAR_UNAVAILABLE', 'TERRAIN_SIDECAR_URL configured but client construction failed.'));
  }

  exhibit.warnings         = W.dedupe(warnings);
  exhibit.blockers         = exhibit.warnings.filter(w => w.severity === 'blocker');
  exhibit.degraded_mode    = exhibit.warnings.length > 0;
  exhibit.degraded_reasons = exhibit.warnings.map(w => w.code);

  // Re-run readiness now that warnings/blockers are accurate.
  const { readiness } = await import('../../types/readiness.js');
  exhibit.filing_readiness = readiness({ warnings: exhibit.warnings, exhibit });

  exhibit.narrative = renderNarrative(exhibit);

  return exhibit;
}
