// Genoa engine — public entry.
//
// One function: compute({ inputs, evidence, options }) -> exhibit.v2
//
// Determinism contract:
//   - Same inputs + same curve dataset version + same engine version
//     ALWAYS produce the same exhibit (down to radial-table values and
//     polygon vertex coordinates).
//   - The engine never reaches out to a network at compute time.  All
//     evidence (terrain HAAT per radial, measurements, identity) must
//     be PRE-RESOLVED by the caller and handed in via `evidence`.
//   - The engine never calls AI.  It does not import the narrative
//     module.  Narrative is rendered on top of the exhibit as a
//     separate post-processing step.

import { loadDataset, loadManifest, curveProvenance } from './curves/loader.js';
import { destPoint } from './geometry/geodesic.js';
import { fccSphericalDestPoint, FCC_ORCHESTRATION_PROVENANCE } from './curves/fcc/orchestration.mjs';
import { closeRing, ringArea_km2 } from './geometry/polygon.js';
import { contourFeature, featureCollection } from './geometry/geojson.js';
import { parsePatternTable } from './pattern/parse.js';
import { patternFactor } from './pattern/factor.js';
import { flatHaatPerRadial } from './haat/flat.js';
import { fmRadialTable, FM_DEFAULT_CONTOURS, FM_INTERP, FM_INTERP_FCC, FM_CONTOUR_METHODS, FM_ENGINE_DEFAULT } from './fm/contour.js';
import { fmInputGuards } from './fm/rules.js';
import { lpfmRadialTable, LPFM_DEFAULT_CONTOURS, LPFM_METHOD, lpfmInputGuards } from './lpfm/contour.js';
import { fxRadialTable, FX_DEFAULT_CONTOURS, FX_METHOD, fxInputGuards } from './translators/contour.js';
import { amRadialTable, AM_DEFAULT_CONTOURS, amWarnings } from './am/groundwave.js';
import { checkLpfmCompliance } from './regulatory/lpfm.js';
import { checkTranslatorInterference } from './regulatory/translator.js';
import { W } from '../types/warnings.js';
import { emptyExhibit } from '../types/schema.js';
import { readiness } from '../types/readiness.js';
import { ENGINE_SIGNATURE, ENGINE_VERSION as SIG_VERSION } from './signature.js';

export const ENGINE_VERSION = SIG_VERSION;

const SOFTWARE_VERSIONS = Object.freeze({
  genoa_engine:  ENGINE_VERSION,
  node:          process.versions?.node || 'unknown',
  schema:        'genoa.exhibit.v2'
});

function methodFor(service){
  switch (service){
    case 'FM':   return { method: FM_CONTOUR_METHODS.F50_50, regs: ['§73.313', '§73.333'] };
    case 'LPFM': return { method: LPFM_METHOD,                regs: ['§73.811', '§73.333'] };
    case 'FX':   return { method: FX_METHOD,                  regs: ['§74.1204', '§73.333'] };
    case 'AM':   return { method: '47 CFR §73.183 / §73.184 groundwave', regs: ['§73.183', '§73.184'] };
    default: throw new Error(`unknown service: ${service}`);
  }
}

function radialList(step_deg){
  const out = [];
  for (let az = 0; az < 360; az += step_deg) out.push(az);
  return out;
}

export async function compute({ inputs, evidence = {}, options = {} } = {}){
  // ---- Strict contract guards ----
  // These intentionally throw rather than emit warnings — they signal
  // a programming error in the caller, not a property of the exhibit.
  if (!inputs || typeof inputs !== 'object'){
    const e = new Error('INVALID_INPUTS: compute(inputs, ...) requires an object');
    e.code = 'INVALID_INPUTS';
    throw e;
  }
  if (!options || !options.validation){
    const e = new Error('VALIDATION_CONTEXT_REQUIRED: compute() requires options.validation (the result of runValidationSuite()). Pass {runs: [...], reference_cases_present: bool}.');
    e.code = 'VALIDATION_CONTEXT_REQUIRED';
    throw e;
  }

  const warnings = [];

  // ---- Inputs --------------------------------------------------------
  const service = String(inputs.service || 'FM').toUpperCase();
  const erp_kW  = Number(inputs.erp_kw);
  const haat_m  = Number(inputs.haat_m);
  const lat     = (inputs.lat === null || inputs.lat === undefined || inputs.lat === '') ? NaN : Number(inputs.lat);
  const lon     = (inputs.lon === null || inputs.lon === undefined || inputs.lon === '') ? NaN : Number(inputs.lon);
  const freq    = Number(inputs.frequency);
  const step    = Number(inputs.radial_step_deg) || 1;
  const sigma   = Number(inputs.ground_sigma_mS_m);
  const pattern_text = inputs.pattern_table || null;
  const pattern = pattern_text ? parsePatternTable(pattern_text) : null;
  const facility_id  = inputs.facility_id ? String(inputs.facility_id) : null;

  if (!facility_id || facility_id === '—'){
    warnings.push(W.make('FACILITY_ID_MISSING'));
  }

  const hasCoords = Number.isFinite(lat) && Number.isFinite(lon);
  if (!hasCoords){
    warnings.push(W.make('FACILITY_COORDINATES_MISSING'));
  }

  // ---- Method binding -----------------------------------------------
  const { method, regs } = methodFor(service);

  // ---- HAAT per radial ----------------------------------------------
  const radials_deg = radialList(step);
  let haatPerRadial;
  if (service === 'AM'){
    haatPerRadial = radials_deg.map(az => ({
      az,
      haat_input_m:           null,
      haat_computed_m:        null,
      haat_source:            'n/a (AM groundwave)',
      terrain_profile_source: null
    }));
  } else if (evidence.terrain_haat_per_radial && evidence.terrain_haat_per_radial.length === radials_deg.length){
    haatPerRadial = evidence.terrain_haat_per_radial;
  } else {
    haatPerRadial = flatHaatPerRadial(radials_deg, haat_m);
    warnings.push(W.make('CONSTANT_HAAT_ASSUMED'));
    if (evidence.terrain_haat_requested){
      warnings.push(W.make('TERRAIN_NOT_APPLIED', 'Per-radial terrain HAAT was requested but the terrain sidecar did not return data.'));
      warnings.push(W.make('SIDECAR_UNAVAILABLE', 'terrain sidecar unavailable; falling back to flat HAAT.'));
    }
  }

  // ---- Engine guards by service -------------------------------------
  if (service === 'FM') {
    warnings.push(...fmInputGuards({ erp_kW, haat_m, frequency_mhz: freq }));
  } else if (service === 'LPFM') {
    warnings.push(...lpfmInputGuards({ erp_kW }));
    warnings.push(...fmInputGuards({ erp_kW, haat_m, frequency_mhz: freq }));
  } else if (service === 'FX') {
    warnings.push(...fxInputGuards({ erp_kW }));
    warnings.push(...fmInputGuards({ erp_kW, haat_m, frequency_mhz: freq }));
  } else if (service === 'AM') {
    // AM frequency is in kHz at the engine boundary.
    warnings.push(...amWarnings({
      frequency_khz:    Number(freq),
      conductivity_msm: Number(sigma),
      erp_kw:           erp_kW
    }));
    if (!Number.isFinite(sigma) || sigma <= 0){
      warnings.push(W.make('FCC_METHOD_MISSING', 'Ground conductivity (M3) is required for any AM groundwave run.'));
    }
  }

  // ---- Radial table + contours --------------------------------------
  const factorFn = az => patternFactor(pattern, az);
  let contours, radial_table;
  // Engine selection.  Default to the vendored FCC-canonical path
  // (matches geo.fcc.gov/api/contours) so Genoa output is FCC-equivalent.
  // Caller can opt back to the legacy v0.2 lookup via
  //   options.engine = 'v0.2-legacy'
  // for regression / debugging.
  const fmEngine = options.engine || FM_ENGINE_DEFAULT;

  switch (service){
    case 'FM':
      contours     = FM_DEFAULT_CONTOURS;
      radial_table = await fmRadialTable({
        datasetByName: loadDataset, mode: '50,50', contours,
        erp_kW, patternFactorFn: factorFn, haatPerRadial,
        frequency_mhz: freq, engine: fmEngine
      });
      break;
    case 'LPFM':
      contours     = LPFM_DEFAULT_CONTOURS;
      radial_table = await lpfmRadialTable({
        datasetByName: loadDataset, mode: '50,50', contours,
        erp_kW, patternFactorFn: factorFn, haatPerRadial,
        frequency_mhz: freq, engine: fmEngine
      });
      break;
    case 'FX':
      contours     = FX_DEFAULT_CONTOURS;
      radial_table = await fxRadialTable({
        datasetByName: loadDataset, mode: '50,50', contours,
        erp_kW, patternFactorFn: factorFn, haatPerRadial,
        frequency_mhz: freq, engine: fmEngine
      });
      break;
    case 'AM':
      contours     = AM_DEFAULT_CONTOURS;
      radial_table = amRadialTable({
        erp_kW,
        frequency_khz:    Number(freq),       // AM frequency is kHz at the input boundary
        conductivity_msm: Number(sigma),
        patternFactorFn:  factorFn,
        radials_deg,
        contours
      });
      break;
  }

  // ---- Regulatory compliance (§73.811 / §74.1204) -------------------
  // LPFM exhibits get §73.811 service-contour + ERP-ceiling check.
  // FM-translator exhibits get §74.1204 D/U short-spacing study against
  // any primary stations supplied via evidence.nearby_primaries.  All
  // results are stamped on exhibit.regulatory_compliance for downstream
  // consumers; rule failures bubble up as typed warnings.
  let regulatory_compliance = null;
  if (service === 'LPFM'){
    regulatory_compliance = await checkLpfmCompliance({
      erp_kw:        erp_kW,
      haat_m,
      frequency_mhz: freq,
      fcc_class:     inputs.fcc_class || 'LP100'
    });
    if (regulatory_compliance.pass === false){
      warnings.push(W.make('LPFM_RULE_VIOLATION',
        regulatory_compliance.violations.map(v => `${v.cite}: ${v.message}`).join(' | ')));
    }
  } else if (service === 'FX'){
    const primaries = Array.isArray(evidence.nearby_primaries) ? evidence.nearby_primaries : [];
    regulatory_compliance = checkTranslatorInterference({
      translator: {
        erp_kw: erp_kW, haat_m, frequency_mhz: freq, lat, lon,
        call: inputs.call || null, facility_id
      },
      primaries
    });
    if (regulatory_compliance.missing_nearby_stations){
      warnings.push(W.make('MISSING_NEARBY_STATIONS'));
    } else if (regulatory_compliance.pass === false){
      warnings.push(W.make('TRANSLATOR_INTERFERENCE',
        regulatory_compliance.violations.map(v => `${v.cite}: ${v.message}`).join(' | ')));
    }
  }

  // ---- Polygons + GeoJSON ------------------------------------------
  // If lat/lon are missing, polygons and GeoJSON cannot be built.
  // The radial table (azimuth + contour distances) is still produced;
  // exhibits without coordinates remain useful as an engineering view
  // of the contour distance solver but cannot be plotted on a map.
  //
  // Projection.  Default 'wgs84-vincenty' (Genoa's PR A path, sub-mm
  // ellipsoid error).  Set options.projection = 'fcc-spherical' for
  // byte-equivalent vertex coordinates with FCC contours.js
  // (great-circle on a sphere of radius 6371 km).
  const projection = options.projection === 'fcc-spherical' ? 'fcc-spherical' : 'wgs84-vincenty';
  const projectVertex = projection === 'fcc-spherical'
    ? (lt, ln, az, d) => fccSphericalDestPoint(lt, ln, az, d)
    : (lt, ln, az, d) => destPoint(lt, ln, az, d);
  const polygons = [];
  const features = [];
  for (const c of contours){
    const dists = radial_table.map(r => r.contour_distances_km?.[c.id]).filter(Number.isFinite);
    const mean_radial_km = dists.length ? dists.reduce((a,b)=>a+b,0) / dists.length : null;
    let closed = [];
    let area_km2 = null;
    if (hasCoords){
      const ring = [];
      for (const r of radial_table){
        const d = r.contour_distances_km?.[c.id];
        if (!Number.isFinite(d) || d <= 0) continue;
        ring.push(projectVertex(lat, lon, r.azimuth_deg, d));
      }
      closed = closeRing(ring);
      area_km2 = closed.length >= 4 ? ringArea_km2(closed) : null;
    }
    polygons.push({
      contour_id:        c.id,
      label:             c.label,
      field_strength:    c.field_dBu ? { value: c.field_dBu, unit: 'dBu' } : { value: c.field_mvm, unit: 'mV/m' },
      ring_latlng:       closed,
      mean_radial_km,
      area_km2,
      method,
      vertex_count:      closed.length,
      closed:            closed.length >= 4,
      polygon_unavailable_reason: hasCoords ? null : 'facility coordinates missing'
    });
    if (hasCoords && closed.length >= 4){
      features.push(contourFeature(closed, {
        contour_id:    c.id,
        label:         c.label,
        field_strength_dbu: c.field_dBu ?? null,
        field_strength_mvm: c.field_mvm ?? null,
        method,
        mean_radial_km,
        area_km2,
        call:          inputs.call || null,
        facility_id:   facility_id || null
      }));
    }
  }
  const geojson = featureCollection(features);

  // ---- Population (null until orchestrator attaches sourced evidence) -
  // The engine does NOT fabricate a population number.  The orchestrator
  // (exhibitService.js step 8a) replaces this with a sourced estimate
  // from the FCC Census Block API (geo.fcc.gov/api/census/area) or an
  // operator-configured POPULATION_EVIDENCE_URL sidecar.  If neither is
  // reachable, primary/protected stay null and POPULATION_PLACEHOLDER
  // persists so reviewers see exactly what's missing.
  const population_estimate = {
    primary:           null,
    protected:         null,
    model:             null,
    method:            'placeholder',
    source:            null
  };
  warnings.push(W.make('POPULATION_PLACEHOLDER'));

  // ---- Validation block ---------------------------------------------
  // The engine does NOT execute the validation suite at compute time
  // (the suite is run separately via /api/exhibits/:id/readiness or
  // the worker).  At compute time it only records whether validation
  // has been previously attached.
  const validation = options.validation || { runs: [], reference_cases_present: false };
  // CURVE_VALIDATION_MISSING is cleared by EITHER:
  //   (a) any validation.runs[] entry with `pass: true` — covers the
  //       curve_reference_validation golden fixture suite (the
  //       authoritative-for-Genoa system per PR #30 directive), OR
  //   (b) a legacy run with `authoritative_pass: true`.
  // The orchestrator's warnings reconciliation may also clear or
  // restate this independently.
  const passing = (validation.runs || []).some(r =>
    r && (r.pass === true || r.authoritative_pass === true));
  if (!passing){
    warnings.push(W.make('CURVE_VALIDATION_MISSING'));
  }

  // ---- Evidence block ----------------------------------------------
  const evidenceBlock = {
    terrain:      evidence.terrain      || { available: false, source: null, profiles: [] },
    measurements: evidence.measurements || { available: false, source: null, calibrated: false, records: [] },
    identity:     evidence.identity     || { available: false, sources: [], confirmations: [] },
    uncertainty:  evidence.uncertainty  || null
  };
  if (!evidenceBlock.measurements.available){
    warnings.push(W.make('SDR_MEASUREMENTS_MISSING'));
  } else if (!evidenceBlock.measurements.calibrated){
    warnings.push(W.make('SDR_MEASUREMENTS_NOT_CALIBRATED'));
  }

  // ---- Provenance --------------------------------------------------
  await loadManifest();
  const curve_prov = await curveProvenance();

  // ---- Assemble exhibit --------------------------------------------
  const exhibit = emptyExhibit();
  exhibit.generated_at      = new Date().toISOString();
  exhibit.engine_signature  = ENGINE_SIGNATURE;
  exhibit.software_versions = SOFTWARE_VERSIONS;
  // Pick the interp-provenance block matching the engine that ran.
  // FCC-canonical → vendored bivariate cubic surface fit.  Legacy →
  // Genoa's earlier linear-log10.  AM doesn't use either.
  const interpBlock = (service === 'AM')
    ? { along_field: 'n/a', along_haat: 'n/a', source: '47 CFR §73.184 groundwave (engine NOT IMPLEMENTED)' }
    : (fmEngine === 'fcc-canonical' ? FM_INTERP_FCC : FM_INTERP);

  exhibit.method_versions   = {
    method,
    regulations:    regs,
    curve_dataset:  curve_prov,
    curve_engine:   service === 'AM' ? null : fmEngine,
    interp:         interpBlock,
    projection,
    fcc_orchestration: FCC_ORCHESTRATION_PROVENANCE
  };
  exhibit.operator_metadata = {
    operator:       options.operator    || null,
    organization:   options.organization || null,
    user_agent:     options.user_agent  || null
  };
  exhibit.station_inputs    = {
    call:           inputs.call || null,
    facility_id:    facility_id,
    service,
    fcc_class:      inputs.fcc_class || null,
    frequency:      freq,
    frequency_unit: service === 'AM' ? 'kHz' : 'MHz',
    erp_kw:         erp_kW,
    haat_m_input:   service === 'AM' ? null : haat_m,
    lat, lon,
    ground_sigma_mS_m: service === 'AM' ? sigma : null,
    pattern:        pattern || 'ND',
    radial_step_deg: step
  };
  exhibit.facility_metadata = {
    cached:         false,
    facility_lookup_source: null,
    raw:            null
  };
  if (!exhibit.facility_metadata.cached){
    warnings.push(W.make('FACILITY_LOOKUP_UNAVAILABLE'));
  }
  exhibit.calculation_method = {
    name:           method,
    regulations:    regs,
    engine_module:  service === 'AM' ? 'src/engine/am/groundwave.js' :
                    service === 'LPFM' ? 'src/engine/lpfm/contour.js' :
                    service === 'FX'   ? 'src/engine/translators/contour.js' :
                                          'src/engine/fm/contour.js',
    engine_version: ENGINE_VERSION
  };
  exhibit.interpolation = interpBlock;
  // calculation_trace shows HOW each contour distance was derived.
  // Engineers reading the saved exhibit can reproduce the lookup
  // step-by-step from these inputs + the pinned curve dataset.
  exhibit.calculation_trace = {
    [service.toLowerCase()]: {
      mode:           service === 'AM' ? 'groundwave' : 'F(50,50)',
      contours:       contours.map(c => ({
        id:           c.id,
        target_dBu:   c.field_dBu ?? null,
        target_mvm:   c.field_mvm ?? null
      })),
      erp_kw:         erp_kW,
      haat_m:         haat_m ?? null,
      haat_source:    haatPerRadial[0]?.haat_source || 'unknown',
      pattern_factor_applied: !!pattern,
      curve_engine:   service === 'AM' ? null : fmEngine,
      interpolation:  service === 'AM'
        ? 'n/a'
        : (fmEngine === 'fcc-canonical'
            ? 'FCC bivariate cubic surface fit (ITPLBV) — vendored from contours-api-node'
            : 'log10-distance vs ascending field; linear along HAAT'),
      dataset:        fmEngine === 'fcc-canonical'
        ? 'fcc/contours-api-node@b55870d (tvfm_curves.js)'
        : curve_prov.curve_version,
      dataset_meta_sha256: fmEngine === 'fcc-canonical'
        ? '58a0cd0eed98353509f39ea56e6f3a1e9ec94e6882a412be4c97bdf79cb6c28a'
        : curve_prov.meta_sha256,
      engine_module:  service === 'AM' ? 'src/engine/am/groundwave.js' :
                      service === 'LPFM' ? 'src/engine/lpfm/contour.js' :
                      service === 'FX'   ? 'src/engine/translators/contour.js' :
                                            'src/engine/fm/contour.js',
      formula_summary: service === 'AM'
        ? 'unattenuated reference E0 = 100·sqrt(P_kW) mV/m at 1 km; per-distance attenuation NOT YET IMPLEMENTED.'
        : (fmEngine === 'fcc-canonical'
            ? 'FCC tvfmfs_metric(erp, haat, channel, target_dBu, fs_or_dist=2, curve) — vendored bivariate cubic surface fit over the FCC §73.333 tabulation; identical output to geo.fcc.gov/api/contours/distance.json.'
            : 'effective_dBu = target_dBu − 10·log10(ERP_kW); look up log10(distance) vs effective field at each HAAT row, then interpolate the per-row distances along the HAAT axis.')
    }
  };
  exhibit.contour_definitions = contours.map(c => ({
    id:    c.id,
    label: c.label,
    field_strength: c.field_dBu ? { value: c.field_dBu, unit: 'dBu' }
                                 : { value: c.field_mvm, unit: 'mV/m' }
  }));
  exhibit.radial_table = radial_table;
  exhibit.polygons     = polygons;
  exhibit.geojson      = geojson;
  exhibit.evidence     = evidenceBlock;
  exhibit.validation   = validation;
  exhibit.uncertainty  = evidenceBlock.uncertainty;
  exhibit.population_estimate = population_estimate;
  exhibit.warnings     = W.dedupe(warnings);
  // Top-level blockers are a derived view of warnings (severity ===
  // 'blocker') so downstream systems can switch on a single field
  // without re-implementing the warning type taxonomy.
  exhibit.blockers         = exhibit.warnings.filter(w => w.severity === 'blocker');
  exhibit.degraded_mode    = exhibit.warnings.length > 0;
  exhibit.degraded_reasons = exhibit.warnings.map(w => w.code);
  exhibit.filing_readiness = readiness({ warnings: exhibit.warnings, exhibit });
  exhibit.regulatory_compliance = regulatory_compliance;
  exhibit.exports      = {
    json:        'pending',
    txt:         'pending',
    geojson:     'pending',
    pdf:         'not_implemented',
    generated_at: null   // populated by exporters when they actually render
  };
  exhibit.narrative    = null; // rendered separately
  return exhibit;
}
