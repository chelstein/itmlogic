// Orchestration: turns an HTTP compute request into a full
// genoa.exhibit.v2.  Resolves sidecars, runs the engine, attaches
// validation, renders narrative.  All structural; no math.

import { compute }              from '../../engine/index.js';
import { runValidationSuite }   from '../../engine/validation/runner.js';
import { renderNarrative }      from '../../narrative/generator.js';
import { radialHaat }           from '../../engine/haat/radial.js';
import { sidecars }             from './sidecars.js';
import { getCached, putCached } from './facilityCache.js';
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

  // ---- Resolve facility_id (if provided) and fill missing inputs ----
  // Genoa never fabricates ERP / HAAT / coordinates.  If the caller
  // supplied facility_id, we look up the row in the cache or via the
  // facility client adapter (chelstein/zerotrustradio + optional n8n)
  // and use those fields ONLY where the caller did not specify the
  // value themselves.
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
      // Fill missing fields ONLY — never overwrite user-provided values.
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

  // Optional terrain sidecar.  If the user requested per-radial HAAT we
  // try the terrain sidecar; on any failure the engine falls back to
  // flat HAAT and emits the appropriate warning.
  if (options.use_terrain && inputs.tx_amsl_m && inputs.service !== 'AM'){
    evidence.terrain_haat_requested = true;
    const radials = [];
    const step = Number(inputs.radial_step_deg) || 1;
    for (let az = 0; az < 360; az += step) radials.push(az);
    const result = await radialHaat({
      terrainClient: sidecars.terrain,
      tx_lat:        Number(inputs.lat),
      tx_lon:        Number(inputs.lon),
      tx_amsl_m:     Number(inputs.tx_amsl_m),
      radials_deg:   radials
    });
    if (result){
      evidence.terrain_haat_per_radial = result;
      evidence.terrain = {
        available:  true,
        source:     result[0]?.terrain_profile_source || 'terrain-sidecar',
        profiles:   result.map(({ az, haat_computed_m, haat_input_m }) => ({ az, haat_computed_m, haat_input_m }))
      };
    }
  }

  // Identity sidecar (best-effort, attached as evidence only).
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

  // Pre-attach validation so the engine sees it.
  const validationRun = await getOrRunValidation();

  const exhibit = await compute({
    inputs,
    evidence,
    options: {
      operator:     options.operator     || null,
      organization: options.organization || null,
      user_agent:   options.user_agent   || null,
      validation: {
        runs: [validationRun],
        reference_cases_present: validationRun.reference_cases_present
      }
    }
  });

  // Stamp the resolved facility into the exhibit BEFORE narrative render
  // so the narrative can read it.  Genoa cached the row; the upstream
  // FCC source remains read-only.
  if (facilityResolution){
    exhibit.facility_metadata = {
      cached:                 true,
      facility_lookup_source: facilityResolution.source,
      raw:                    facilityResolution.facility
    };
    // Drop the FACILITY_LOOKUP_UNAVAILABLE warning the engine added by
    // default; we resolved the facility through the adapter.
    exhibit.warnings = exhibit.warnings.filter(w => w.code !== 'FACILITY_LOOKUP_UNAVAILABLE');
  }
  if (facilityWarnings.length){
    // We're about to push richer FACILITY_LOOKUP_UNAVAILABLE warnings
    // (with detail).  Strip the engine's default detail-less version so
    // the UI doesn't show the same code twice.
    const facilityCodes = new Set(facilityWarnings.map(w => w.code));
    exhibit.warnings = exhibit.warnings.filter(w => !facilityCodes.has(w.code));
    for (const w of facilityWarnings) exhibit.warnings.push(w);
  }

  exhibit.narrative = renderNarrative(exhibit);

  // If a configured sidecar was unhealthy, surface that as a warning
  // even if the engine didn't already record it.
  if (process.env.TERRAIN_SIDECAR_URL && !sidecars.terrain){
    exhibit.warnings.push(W.make('SIDECAR_UNAVAILABLE', 'TERRAIN_SIDECAR_URL configured but client construction failed.'));
  }
  exhibit.warnings  = W.dedupe(exhibit.warnings);
  exhibit.blockers  = exhibit.warnings.filter(w => w.severity === 'blocker');
  exhibit.degraded_mode    = exhibit.warnings.length > 0;
  exhibit.degraded_reasons = exhibit.warnings.map(w => w.code);

  return exhibit;
}
