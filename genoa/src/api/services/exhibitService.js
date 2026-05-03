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
  const ztrStationId = facilityResolution?.facility?.facility_lookup_source?.ztr_id;
  if (ztrStationId && sidecars.facility?.getRichStation){
    richStation = await sidecars.facility.getRichStation(ztrStationId);
    if (richStation?.available){
      // FCC contour (cross-check input)
      const fc = await sidecars.facility.getFccContour({ stationId: ztrStationId, rich: richStation });
      if (fc.available) fccContourResp = fc;
      // SDR evidence
      const sdr = await sidecars.facility.getSdrEvidence({ stationId: ztrStationId, rich: richStation });
      if (sdr.available) sdrResp = sdr;
    }
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
  // Pre-attach the local reference-cases run so the engine has SOMETHING.
  // We may replace it below with the FCC cross-check if it passes.
  const validationRun = await getOrRunValidation();
  let validationContext = {
    runs: [validationRun],
    reference_cases_present: validationRun.reference_cases_present
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
    // Append to the runs list so the local suite is still visible.
    exhibit.validation = {
      runs:                    [validationRun, crossCheckRun],
      reference_cases_present: crossCheckRun.reference_cases_present || validationRun.reference_cases_present
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

  if (crossCheckRun?.authoritative_pass){
    warnings = warnings.filter(w => w.code !== 'CURVE_VALIDATION_MISSING');
  } else if (crossCheckRun && !crossCheckRun.authoritative_pass){
    // Cross-check ran but didn't pass: keep the blocker, attach detail.
    warnings = warnings.filter(w => w.code !== 'CURVE_VALIDATION_MISSING');
    warnings.push(W.make('CURVE_VALIDATION_MISSING',
      `FCC contour cross-check failed: ${crossCheckRun.n_run - crossCheckRun.n_pass} of ${crossCheckRun.n_run} contours out of tolerance (max error ${crossCheckRun.max_error_km?.toFixed(2)} km).`));
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
