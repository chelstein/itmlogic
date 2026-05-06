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
import { extractHaatFromContour } from '../../evidence/fccContoursClient.js';
import { runCurveReferenceValidation } from '../../validation/curveReferenceValidation.js';
import { W }                    from '../../types/warnings.js';
import { computeHaatMultiSource } from '../../evidence/terrain/elevationClient.js';
import { makeBudget }              from './computeBudget.js';

let _validationCache = null;
let _validationCachedAt = 0;
const VALIDATION_TTL_MS = 5 * 60 * 1000;

// FM service-contour threshold per §73.211 — used by §73.215 and the
// ITM-aware coverage analysis.  Returns null for non-FM services.
function service73215Threshold(klass){
  if (!klass) return 60;                  // default to Class A 60 dBu
  const k = String(klass).toUpperCase().replace(/\s+/g, '').replace('CLASS', '');
  // Class A / LPFM / FX → 60 dBu protected; others → 54 dBu.
  if (['A', 'LP100', 'LP10', 'D', 'FX'].includes(k)) return 60;
  return 54;
}

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
  // Wall-clock budget for ALL network-bound evidence fetches.  Default
  // 4.5 min (env COMPUTE_BUDGET_MS).  Slow / unreachable upstreams are
  // skipped past the deadline and surface as a COMPUTE_TIMEOUT_PARTIAL
  // warning naming each step that ran out of time.  The engine compute
  // itself (radial table + polygons + GeoJSON) is not budgeted.
  const budget = makeBudget(options.compute_budget_ms);
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
        const sdr = await sidecars.facility.getSdrEvidence({
          stationId: ztrStationId,
          rich:      richStation,
          service:   inputs.service     // AM filter for ZTR's mixed-service rich-station bundle
        });
        if (sdr.available) sdrResp = sdr;
        // Even when the SDR pull found no captures, retain the probe
        // result on evidence so the exhibit's measurements block can
        // explain which field names were checked and which keys
        // actually appear on the rich-station response.  This is
        // crucial for diagnosing "we know KVLV has audio captures but
        // they don't show up": the station_keys list reveals whether
        // ZTR exposed the data under a name we don't yet recognise.
        else if (sdr) sdrResp = sdr;   // available=false + diagnostics
      }
      // ASR (47 CFR §17.4) cross-check — extract tower-registration
      // data from the same rich-station response.  Defensive against
      // ZTR schema variants; falls through to ASR_SIDECAR_URL when
      // ZTR rich payload doesn't carry asr_number.
      try {
        const { makeAsrClient, checkAsrAgainstApplication } = await import('../../evidence/asrClient.js');
        const asrClient = makeAsrClient();
        if (asrClient){
          let asr = asrClient.extractFromRichStation(richStation);
          if (!asr.available && asr.error?.includes('did not carry an asr_number') && inputs.asr_number){
            asr = await asrClient.getByAsrNumber(inputs.asr_number);
          }
          const asrResult = checkAsrAgainstApplication({
            asr,
            application: {
              asr_number:             inputs.asr_number || null,
              lat:                    inputs.lat,
              lon:                    inputs.lon,
              overall_height_m:       inputs.overall_height_m || null,
              overall_height_amsl_m:  inputs.overall_height_amsl_m || null
            }
          });
          if (asr.available || asr.error){
            evidence.asr = asrResult;
          }
        }
      } catch { /* swallow — ASR is informational, not load-bearing */ }
    }
  }

  // ---- 2b. FCC Contours direct fallback ----
  // When ZTR didn't supply a contour (not configured, station not in ZTR,
  // or _fcc_contour missing), hit geo.fcc.gov/api/contours/entity.json
  // directly using the facility_id + service from inputs.  This is the
  // same public API ZTR proxies — public, no auth, always available.
  //
  // Gated to dBu-scored services (FM / LPFM / FX / FS / FB).  AM polygons
  // are mV/m, and the cross-check validator only matches dBu polygons by
  // design (ztrFccContourValidator.js filters on field_strength.unit ===
  // 'dBu').  Calling the FCC API for AM here would always produce
  // n_run=0 and emit a misleading FCC_GEO_CROSSCHECK_SKIPPED warning
  // that degrades readiness for no engineering reason.
  const FCC_CONTOUR_DBU_SERVICES = new Set(['FM', 'LPFM', 'FX', 'FS', 'FB']);
  if (!fccContourResp
      && sidecars.fccContours
      && inputs.facility_id
      && FCC_CONTOUR_DBU_SERVICES.has(String(inputs.service || '').toUpperCase())){
    try {
      const fc = await sidecars.fccContours.getContour(inputs.facility_id, inputs.service);
      if (fc.available) fccContourResp = fc;
    } catch { /* ignore; cross-check stays null */ }
  }

  // ---- 2c. Per-radial HAAT directly from the FCC contour ----
  // The FCC contour response carries `contourData[].haat` — the per-
  // radial HAAT FCC used to compute its contour, sourced from the
  // NED 1-arc-second DEM.  When we have it, hand it to the engine so
  // CONSTANT_HAAT_ASSUMED clears with sourced data — no separate
  // terrain sidecar required.  Subsamples to inputs.radial_step_deg.
  // Only applies to dBu-scored services (HAAT is meaningless for AM).
  if (fccContourResp?.available
      && FCC_CONTOUR_DBU_SERVICES.has(String(inputs.service || '').toUpperCase())){
    const step = Number(inputs.radial_step_deg) || 10;
    const haatBundle = extractHaatFromContour(fccContourResp, step);
    if (haatBundle && haatBundle.n_finite > 0){
      const flat_m = Number(inputs.haat_m);
      let n_dem = 0, n_flat = 0;
      evidence.terrain_haat_per_radial = haatBundle.radials.map(r => {
        if (Number.isFinite(r.haat_m)){
          n_dem++;
          return {
            az:                     r.azimuth_deg,
            haat_input_m:           flat_m,
            haat_computed_m:        r.haat_m,
            haat_source:            'fcc_contour_radial_haat',
            terrain_profile_source: haatBundle.elevation_data_source
          };
        }
        n_flat++;
        return {
          az:                     r.azimuth_deg,
          haat_input_m:           flat_m,
          haat_computed_m:        flat_m,
          haat_source:            'user_flat (no FCC HAAT for this radial)',
          terrain_profile_source: null
        };
      });
      evidence.terrain = {
        available:  true,
        source:     'geo.fcc.gov',
        endpoint:   haatBundle.endpoint,
        method:     'per-radial HAAT extracted from FCC contour response (geo.fcc.gov/api/contours/entity.json contourData[].haat)',
        dem:        { source: 'FCC NED', dataset: haatBundle.elevation_data_source },
        fetched_at: fccContourResp.fetched_at || new Date().toISOString(),
        n_radials:  haatBundle.radials.length,
        n_radials_dem_sourced:   n_dem,
        n_radials_flat_fallback: n_flat,
        rcamsl_m:   haatBundle.rcamsl,
        profiles:   haatBundle.radials.map(r => ({
          az:              r.azimuth_deg,
          haat_computed_m: r.haat_m
        }))
      };
    }
  }

  // ---- 3. Per-radial §73.313 HAAT (ZTR terrain-haat path) ----
  // Pulled from ZTR's terrain-haat endpoint (Outcome A; PR
  // chelstein/zerotrustradio#243).  Only used when the request opts in
  // (`options.use_terrain` true) AND the facility carries lat/lon AND
  // the service isn't AM (groundwave doesn't use HAAT).  ZTR is
  // arc-averaged DEM (more granular than the FCC contour's per-radial
  // HAAT) so it overrides the FCC-extracted bundle if both are
  // available.
  if (options.use_terrain
      && inputs.facility_id
      && inputs.service !== 'AM'
      && sidecars.facility?.getTerrainHaatRadials){
    const step = Number(inputs.radial_step_deg) || 10;
    terrainResp = await budget.withDeadline('ztr_terrain_haat',
      () => sidecars.facility.getTerrainHaatRadials({
        facility_id:     String(inputs.facility_id),
        radial_step_deg: step
      }), { minMs: 5_000 });
    if (terrainResp?.available && Array.isArray(terrainResp.radials) && terrainResp.radials.length){
      // Count DEM-sourced radials BEFORE deciding whether to commit this
      // path.  ZTR sometimes returns a 200 with all-null haat_m (its
      // upstream DEM rate-limited or its facility lat/lon missing).  In
      // that case we must NOT mark evidence.terrain available, otherwise
      // step 3c (direct multi-source elevation) is skipped and the
      // exhibit ships flat HAAT under a "OpenTopoData SRTM 30m" banner.
      // Counting first lets step 3c rescue zero-coverage responses.
      const flat_m = Number(inputs.haat_m);
      let n_dem = 0, n_flat = 0;
      const candidate = terrainResp.radials.map(r => {
        if (Number.isFinite(r.haat_m)){
          n_dem++;
          return {
            az:                     r.azimuth_deg,
            haat_input_m:           flat_m,
            haat_computed_m:        r.haat_m,
            haat_source:            'arc_averaged_dem',
            terrain_profile_source: terrainResp.dem?.source || 'zerotrustradio'
          };
        }
        n_flat++;
        return {
          az:                     r.azimuth_deg,
          haat_input_m:           flat_m,
          haat_computed_m:        flat_m,
          haat_source:            'user_flat (no DEM coverage)',
          terrain_profile_source: null
        };
      });
      if (n_dem > 0){
        // Engine accepts the bundle; commit it to evidence.
        evidence.terrain_haat_per_radial = candidate;
        evidence.terrain = {
          available:  true,
          source:     terrainResp.source || 'zerotrustradio',
          endpoint:   terrainResp.endpoint,
          method:     terrainResp.method,
          dem:        terrainResp.dem,
          fetched_at: terrainResp.fetched_at,
          n_radials:  terrainResp.n_radials,
          n_radials_dem_sourced:   n_dem,
          n_radials_flat_fallback: n_flat,
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
        // ZTR returned a shape but no usable DEM data — leave
        // evidence.terrain unset so step 3c can run the direct
        // multi-source elevation client.  Mark request as attempted.
        evidence.terrain_haat_requested = true;
        evidence.terrain_ztr_attempted = {
          available:  false,
          source:     terrainResp.source || 'zerotrustradio',
          endpoint:   terrainResp.endpoint,
          n_radials:  terrainResp.n_radials,
          reason:     'ZTR returned radials but none carried a finite haat_m (upstream DEM rate-limited, facility coordinates missing, or off-DEM-coverage)',
          fetched_at: terrainResp.fetched_at
        };
      }
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

  // ---- 3c. Direct multi-source terrain HAAT fallback ----
  // When terrain was requested but no HAAT has been sourced yet (sidecar
  // unavailable, no ZTR terrain endpoint, no FCC contour), compute §73.313
  // arc-averaged HAAT directly using three public elevation APIs:
  //   1. USGS 3DEP EPQS  (same NED dataset FCC uses)
  //   2. Open-Meteo Elevation API  (Copernicus DEM / SRTM3)
  //   3. OpenTopoData SRTM-30m  (NASA SRTM 1-arcsec)
  // Sources are tried in parallel; results are cross-validated.  This runs
  // entirely without a sidecar so it degrades gracefully when sidecars are
  // down or not yet provisioned.
  if (options.use_terrain
      && inputs.service !== 'AM'
      && Number.isFinite(Number(inputs.lat))
      && Number.isFinite(Number(inputs.lon))
      && Number.isFinite(Number(inputs.haat_m))
      && !evidence.terrain?.available){
    const step      = Number(inputs.radial_step_deg) || 10;
    const radials   = [];
    for (let az = 0; az < 360; az += step) radials.push(az);
    try {
      const tr = await budget.withDeadline('multi_source_dem',
        () => computeHaatMultiSource({
          tx_lat:      Number(inputs.lat),
          tx_lon:      Number(inputs.lon),
          tx_amsl_m:   Number(inputs.haat_m),   // antenna AMSL (best available)
          radials_deg: radials,
          from_km:     3,
          to_km:       16,
          samples:     27
        }), { minMs: 10_000 });
      if (tr?.haat_per_radial?.length === radials.length){
        const flat_m = Number(inputs.haat_m);
        let n_dem = 0, n_flat = 0;
        // Keep ALL radials so the array length matches radials_deg.length
        // (the engine requires strict equality to accept the bundle).
        // For radials where the multi-source elevation client returned
        // null (no DEM coverage — e.g. offshore samples), fall back to
        // the user-input flat HAAT for that single radial and tag the
        // source honestly so the radial table shows exactly where DEM
        // coverage gapped.
        evidence.terrain_haat_per_radial = tr.haat_per_radial.map(r => {
          if (Number.isFinite(r.haat_m)){
            n_dem++;
            return {
              az:                     r.az,
              haat_input_m:           flat_m,
              haat_computed_m:        r.haat_m,
              haat_source:            'arc_averaged_dem_direct',
              terrain_profile_source: tr.dem_source
            };
          }
          n_flat++;
          return {
            az:                     r.az,
            haat_input_m:           flat_m,
            haat_computed_m:        flat_m,
            haat_source:            'user_flat (no DEM coverage)',
            terrain_profile_source: null
          };
        });
        evidence.terrain = {
          available:                  true,
          source:                     tr.provider,
          method:                     '§73.313 arc-averaged HAAT via direct multi-source elevation API (no sidecar)',
          dem:                        { source: tr.provider, dataset: tr.dem_source },
          fetched_at:                 tr.fetched_at,
          n_radials:                  tr.haat_per_radial.length,
          n_radials_dem_sourced:      n_dem,
          n_radials_flat_fallback:    n_flat,
          cross_validated:            tr.cross_validated,
          cross_validate_tolerance_m: tr.cross_validate_tolerance_m,
          agreement_m:                tr.agreement_m,
          terrain_sources:            tr.sources,
          profiles:                   tr.haat_per_radial.map(r => ({
            az:              r.az,
            haat_computed_m: r.haat_m,
            avg_elev_m:      r.avg_elev_m,
            min_elev_m:      r.min_elev_m,
            max_elev_m:      r.max_elev_m
          }))
        };
      }
    } catch { /* best-effort; sidecar-less path; swallow */ }
  }

  // ---- 3d. ITM-aware coverage analysis (terrain path-loss) ----
  // Optional, opt-in via options.use_itm.  Two-tier fallback:
  //   1. SPLAT sidecar via predictItmCoverage() — full Longley-Rice
  //      ITM v1.2.2 fidelity when the sidecar has DEM tiles
  //      provisioned and exposes /api/v1/splat/run-inline.
  //   2. JS Bullington + ITU-R P.526 engine via computeItmCoverage()
  //      — uses the multi-source DEM client (USGS/Open-Meteo/
  //      OpenTopoData) directly; works without a sidecar.
  // Reports per-radial terrain-vs-FCC contour delta on
  // evidence.itm_coverage so the exhibit can render a "terrain map"
  // alongside the §73.333 baseline.
  //
  // Slow (~30-90s for 36 radials × 40 samples).  Off by default; set
  // options.use_itm = true to opt in.
  if (options.use_itm
      && inputs.service !== 'AM'
      && Number.isFinite(Number(inputs.lat))
      && Number.isFinite(Number(inputs.lon))
      && Number.isFinite(Number(inputs.haat_m))
      && Number.isFinite(Number(inputs.frequency))
      && Number.isFinite(Number(inputs.erp_kw))){
    const step = Number(inputs.radial_step_deg) || 10;
    const radials = [];
    for (let az = 0; az < 360; az += step) radials.push(az);
    const target = service73215Threshold(inputs.fcc_class) || 60;

    // Tier 1: SPLAT sidecar (high-fidelity).
    let splatAttempt = null;
    if (sidecars.splat && options.itm_engine !== 'js'){
      try {
        splatAttempt = await budget.withDeadline('splat_itm_sidecar',
          () => sidecars.splat.predictItmCoverage({
            tx: {
              call:              inputs.call || null,
              lat:               Number(inputs.lat),
              lon:               Number(inputs.lon),
              amsl_m:            Number(inputs.haat_m),
              antenna_height_m:  Number(inputs.haat_m),
              frequency_mhz:     Number(inputs.frequency),
              erp_kw:            Number(inputs.erp_kw),
              polarization:      inputs.polarization || 'V'
            },
            max_distance_km:  Number(options.itm_to_km)   || 80,
            target_field_dbu: target,
            radial_step_deg:  step
          }), { minMs: 15_000 });
        if (splatAttempt?.available){
          evidence.itm_coverage = {
            ...splatAttempt,
            engine: 'splat-itm-v1.2.2',
            tier:   'high-fidelity'
          };
        }
      } catch (err){
        splatAttempt = { available: false, error: String(err.message) };
      }
    }

    // Tier 2: JS Bullington + ITU-R P.526 (fallback).
    if (!evidence.itm_coverage){
      try {
        const { computeItmCoverage } = await import('../../engine/coverage/itm_radial.js');
        const itm = await budget.withDeadline('itm_coverage_js',
          () => computeItmCoverage({
            tx_lat:           Number(inputs.lat),
            tx_lon:           Number(inputs.lon),
            tx_amsl_m:        Number(inputs.haat_m),
            erp_kw:           Number(inputs.erp_kw),
            haat_m:           Number(inputs.haat_m),
            frequency_mhz:    Number(inputs.frequency),
            radials_deg:      radials,
            target_field_dbu: target,
            from_km:          Number(options.itm_from_km) || 1,
            to_km:            Number(options.itm_to_km)   || 80,
            samples:          Number(options.itm_samples) || 40,
            fcc_mode:         options.itm_fcc_mode || '50,50'
          }), { minMs: 15_000 });
        if (itm?.available){
          evidence.itm_coverage = {
            ...itm,
            engine: 'genoa-bullington-p526',
            tier:   'js-fallback',
            splat_sidecar_attempted: splatAttempt
              ? { available: splatAttempt.available, error: splatAttempt.error || null,
                  sidecar_enhancement_required: splatAttempt.sidecar_enhancement_required || null }
              : { available: false, error: 'SPLAT sidecar not configured' }
          };
        } else {
          evidence.itm_coverage_attempted = { available: false, error: itm.error };
        }
      } catch (err){
        evidence.itm_coverage_attempted = { available: false, error: String(err.message) };
      }
    }
  }

  // ---- 4. SDR evidence — pre-attach so engine sees it ----
  if (sdrResp?.available){
    evidence.measurements = {
      available:                true,
      source:                   sdrResp.source,
      endpoint:                 sdrResp.endpoint,
      fetched_at:               sdrResp.fetched_at,
      // captures_field exposes which ZTR field-name shape carried the
      // records (_captures, captures, sdr_captures, …).  Useful for
      // diagnosing schema drift across ZTR releases.
      captures_field:           sdrResp.captures_field || '_captures',
      n_records:                sdrResp.n_records,
      n_records_raw:            sdrResp.n_records_raw ?? sdrResp.n_records,
      n_dropped_service_filter: sdrResp.n_dropped_service_filter ?? 0,
      n_dropped_sanity_filter:  sdrResp.n_dropped_sanity_filter ?? 0,
      service_filter:           inputs.service ? String(inputs.service).toUpperCase() : null,
      calibrated:               !!sdrResp.calibrated,
      records:                  sdrResp.records
    };
  } else if (sdrResp){
    // Probe ran but no captures landed.  Retain the diagnostic so
    // operators can see why (which field names were checked, which
    // keys ZTR actually exposed on the rich-station response).
    evidence.measurements_probe = {
      available:           false,
      source:              sdrResp.source,
      endpoint:            sdrResp.endpoint,
      n_records:           0,
      reason:              sdrResp.error || 'no captures returned',
      checked_field_names: sdrResp.checked_field_names || null,
      station_keys:        sdrResp.station_keys || null,
      service_filter:      inputs.service ? String(inputs.service).toUpperCase() : null
    };
  }

  // ---- 5. Identity (RadioDNS / RDS / EAS) — with ZTR fallback ----
  // Identity has two tiers:
  //   1. Identity sidecar (chelstein/massdns + EAS-Tools + audio-fp).
  //      When wired, returns multi-source confirmations.
  //   2. ZTR /api/radiodns/station/:id rich-station RadioDNS data.
  //      ZTR's resolver carries PI/GCC/FQDN/bearer/service URLs directly
  //      on the station object, so when the identity sidecar is down or
  //      unwired we still get a RadioDNS confirmation from ZTR.
  // The two tiers are not mutually exclusive — we prefer the sidecar
  // when it returns confirmations, fall back to ZTR otherwise, and
  // merge sources from both when both produce data.
  let identityFromSidecar = null;
  if (sidecars.identity && (inputs.call || inputs.facility_id)){
    try {
      identityFromSidecar = await sidecars.identity.resolve({
        call:           inputs.call,
        facility_id:    inputs.facility_id,
        frequency:      inputs.frequency,
        frequency_unit: inputs.service === 'AM' ? 'kHz' : 'MHz'
      });
    } catch {/* swallow; fall through to ZTR */}
  }

  let identityFromZtr = null;
  if (ztrStationId && sidecars.facility?.getRadioDnsFromZtr){
    try {
      identityFromZtr = await sidecars.facility.getRadioDnsFromZtr({
        stationId: ztrStationId,
        rich:      richStation
      });
    } catch {/* swallow; identity is best-effort */}
  }

  // Merge: sidecar takes precedence; ZTR contributes RadioDNS when
  // the sidecar didn't.  At least one confirmed source → available.
  const sidecarConfirmed = identityFromSidecar?.confirmations?.length > 0;
  const ztrConfirmed     = identityFromZtr?.available;
  if (sidecarConfirmed || ztrConfirmed){
    const mergedSources       = [];
    const mergedConfirmations = [];
    if (identityFromSidecar){
      mergedSources.push(...(identityFromSidecar.sources || []));
      mergedConfirmations.push(...(identityFromSidecar.confirmations || []));
    }
    if (identityFromZtr?.available){
      // Only add ZTR's RadioDNS if the sidecar didn't already produce
      // a confirmed RadioDNS source — avoid duplicate kinds.
      const haveRadioDns = mergedConfirmations.some(c => c.kind === 'radiodns' && c.status === 'confirmed');
      if (!haveRadioDns){
        mergedSources.push(...(identityFromZtr.sources || []));
        mergedConfirmations.push(...(identityFromZtr.confirmations || []));
      }
    }
    evidence.identity = {
      available:    true,
      requested_at: new Date().toISOString(),
      sources:      mergedSources,
      confirmations: mergedConfirmations,
      tiers_used:   [
        sidecarConfirmed ? 'identity-sidecar' : null,
        ztrConfirmed && !sidecarConfirmed ? 'zerotrustradio-radiodns' : null
      ].filter(Boolean)
    };
  } else if (identityFromSidecar){
    // Sidecar reachable but no confirmations; preserve its detail.
    evidence.identity = identityFromSidecar;
  }

  // identity_probe — diagnostic block surfaced even when nothing
  // confirmed.  Lets the operator see WHICH field names were checked
  // and which keys ZTR's rich-station response actually carries, so
  // a missing variant can be added in one line.  Same pattern as
  // measurements_probe for SDR captures.
  if (!evidence.identity?.available && (identityFromSidecar || identityFromZtr)){
    evidence.identity_probe = {
      available:                  false,
      sidecar:                    identityFromSidecar
        ? { configured: true,  reachable: !identityFromSidecar.error,
            n_sources:   (identityFromSidecar.sources || []).length,
            n_confirmations: (identityFromSidecar.confirmations || []).length,
            error:       identityFromSidecar.error || null }
        : { configured: false },
      ztr_radiodns:               identityFromZtr
        ? { configured: true,  reachable: !identityFromZtr.error || identityFromZtr.error.includes('no RadioDNS'),
            error:               identityFromZtr.error || null,
            checked_field_names: identityFromZtr.checked_field_names || null,
            checked_subobjects:  identityFromZtr.checked_subobjects  || null,
            station_keys:        identityFromZtr.station_keys        || null,
            endpoint:            identityFromZtr.endpoint            || null }
        : { configured: false }
    };
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

  // ---- 6b. §74.1204 nearby-primaries proximity search (FX only) ----
  // For FM translator exhibits with coordinates and a frequency, hit
  // FCC FMQ for every channel relationship governed by §74.1204(a) (co-
  // channel + ±200/400/600 kHz adjacents + ±10.6/10.8 MHz IF) and
  // proximity-filter to within TRANSLATOR_NEARBY_RADIUS_KM (default
  // 300 km).  The result lands on evidence.nearby_primaries, which the
  // engine's checkTranslatorInterference consumes verbatim to run the
  // per-station D/U study.  Without this attach, the engine emits
  // MISSING_NEARBY_STATIONS — honest, but the study can't run.
  // FM (full-service) also needs nearby_primaries for the §73.215
  // contour-protection short-spacing study.  Same FCC FMQ source, same
  // §74.1204-style channel-offset queries (co + ±200/400/600 kHz, IF).
  // The engine filters the list to FM-only inside checkSection73215.
  // AM nighttime §73.187 also pulls a list — same upstream (FCC AMQ
  // direct), wider default radius (1500 km vs 300 km) for skywave reach.
  const svc = String(inputs.service || '').toUpperCase();
  const wantsNearby = ['FX', 'FM', 'AM'].includes(svc);
  if (wantsNearby
      && Number.isFinite(Number(inputs.lat))
      && Number.isFinite(Number(inputs.lon))
      && Number.isFinite(Number(inputs.frequency))
      && sidecars.facility?.getNearbyPrimaries
      && process.env.TRANSLATOR_NEARBY_DISABLE !== '1'){
    try {
      const nbArgs = svc === 'AM' ? {
        lat:                 Number(inputs.lat),
        lon:                 Number(inputs.lon),
        frequency_khz:       Number(inputs.frequency),    // engine takes AM in kHz
        service:             'AM',
        radius_km:           Number(process.env.AM_NEARBY_RADIUS_KM) || 1500,
        exclude_facility_id: inputs.facility_id || null
      } : {
        lat:                 Number(inputs.lat),
        lon:                 Number(inputs.lon),
        frequency_mhz:       Number(inputs.frequency),
        service:             svc,
        radius_km:           Number(process.env.TRANSLATOR_NEARBY_RADIUS_KM) || 300,
        exclude_facility_id: inputs.facility_id || null
      };
      const nb = await budget.withDeadline('nearby_primaries_fmq',
        () => sidecars.facility.getNearbyPrimaries(nbArgs),
        { minMs: 15_000 });
      if (nb?.available){
        let primaries = nb.primaries;
        let enrichment = null;
        // Per-station environmental enrichment from ZTR rich-station
        // data (M3 conductivity, RSS-equivalent ERP for directional,
        // sunrise/sunset offsets).  Lifts §73.215 and §73.187 study
        // accuracy beyond conservative defaults.  Concurrency-capped
        // and fail-soft: stations not in ZTR pass through unchanged.
        if (sidecars.facility?.enrichNearbyFromZtr
            && process.env.NEARBY_ZTR_ENRICH_DISABLE !== '1'
            && primaries.length > 0){
          try {
            const e = await budget.withDeadline('nearby_ztr_enrichment',
              () => sidecars.facility.enrichNearbyFromZtr(primaries, {
                concurrency: Number(process.env.NEARBY_ZTR_ENRICH_CONCURRENCY) || 10
              }), { minMs: 5_000 });
            if (e){
              primaries  = e.primaries;
              enrichment = {
                n_enriched: e.n_enriched,
                n_total:    e.n_total,
                fields:     ['ground_sigma_msm', 'rss_erp_kw', 'sunrise_offset_min', 'sunset_offset_min'],
                source:     'zerotrustradio',
                errors:     e.errors?.length ? e.errors.slice(0, 5) : null
              };
            }
          } catch (err){
            enrichment = { n_enriched: 0, n_total: primaries.length, error: String(err.message), source: 'zerotrustradio' };
          }
        }
        evidence.nearby_primaries = primaries;
        evidence.nearby_primaries_provenance = {
          source:       nb.source,
          method:       nb.method,
          upstream_api: nb.upstream_api,
          radius_km:    nb.radius_km,
          n_queries:    nb.n_queries,
          n_in_radius:  nb.n_in_radius,
          fetched_at:   nb.fetched_at,
          errors:       nb.errors,
          ztr_enrichment: enrichment
        };
      }
    } catch { /* swallow; engine emits MISSING_NEARBY_STATIONS honestly */ }
  }

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
  } else if (evidence.identity_probe){
    exhibit.evidence.identity_probe = evidence.identity_probe;
  }
  if (evidence.splat){
    exhibit.evidence.splat = evidence.splat;
  }
  if (evidence.asr){
    exhibit.evidence.asr = evidence.asr;
    if (evidence.asr.cross_check?.matches === false){
      const detail = evidence.asr.cross_check.mismatches
        .map(m => `${m.field}: ASR=${m.asr_value} vs application=${m.app_value}${m.delta_arcsec ? ` (Δ ${m.delta_arcsec} arcsec)` : ''}${m.delta_m ? ` (Δ ${m.delta_m} m)` : ''}`)
        .join(' | ');
      const hasMajor = evidence.asr.cross_check.mismatches.some(m => m.severity === 'major');
      let warnings = exhibit.warnings || [];
      warnings.push(W.make('ASR_MISMATCH',
        `ASR ${evidence.asr.asr_number}${hasMajor ? ' MAJOR' : ''} mismatch (${evidence.asr.cross_check.n_mismatches}): ${detail}`));
      exhibit.warnings = warnings;
    }
  }
  if (evidence.nearby_primaries_provenance){
    exhibit.evidence.nearby_primaries           = evidence.nearby_primaries;
    exhibit.evidence.nearby_primaries_provenance = evidence.nearby_primaries_provenance;
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

  // ---- §74.1204 nearby-primaries proximity search reconciliation ----
  // The engine emits MISSING_NEARBY_STATIONS whenever nearby_primaries
  // is empty.  When the orchestrator's FCC FMQ proximity search ran
  // successfully (provenance attached), an empty result is a positive
  // §74.1204 outcome (no nearby restricted-channel stations) — not
  // missing data.  Drop the warning in that case; the provenance block
  // on the exhibit records that the search was performed.
  if (evidence.nearby_primaries_provenance?.source){
    warnings = warnings.filter(w => w.code !== 'MISSING_NEARBY_STATIONS');
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
    name:               curveRefRun?.name || 'genoa-curve-golden',
    method:             curveRefRun?.method || null,
    fixture_path:       curveRefRun?.fixture_path || null,
    curve_dataset:      curveRefRun?.curve_dataset || null,
    coverage_by_family: curveRefRun?.coverage_by_family || null,
    tolerance_km:       curveRefRun?.tolerance_km ?? null,
    ran_at:             curveRefRun?.ran_at || null,
    n_run:              curveRefRun?.n_run ?? 0,
    n_pass:             curveRefRun?.n_pass ?? 0,
    max_error_km:       curveRefRun?.max_error_km ?? null,
    mean_error_km:      curveRefRun?.mean_error_km ?? null,
    result:             curveRefRun?.result || 'no_cases'
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

  // Compute-budget summary.  When any network-bound evidence fetches
  // were skipped past the deadline, surface them as one warning with
  // the named steps + elapsed wall-clock so an operator can see
  // exactly which upstreams ran out of time.
  const skipped = budget.skipped();
  if (skipped.length > 0){
    warnings.push(W.make('COMPUTE_TIMEOUT_PARTIAL',
      `Skipped ${skipped.length} fetch(es) past the ${budget.budget_ms} ms budget at ${budget.elapsed_ms()} ms elapsed: ${skipped.map(s => s.name).join(', ')}.  Raise COMPUTE_BUDGET_MS or the deploy's HTTP gateway timeout if a particular source is consistently slow.`));
  }
  exhibit.compute_budget = {
    budget_ms:   budget.budget_ms,
    elapsed_ms:  budget.elapsed_ms(),
    skipped
  };

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
