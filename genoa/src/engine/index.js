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
import { fxRadialTable, FX_DEFAULT_CONTOURS, FX_METHOD, FX_REGULATORY_METADATA, fxInputGuards } from './translators/contour.js';
import { amRadialTable, AM_DEFAULT_CONTOURS, amWarnings } from './am/groundwave.js';
import { checkLpfmCompliance } from './regulatory/lpfm.js';
import { checkTranslatorInterference } from './regulatory/translator.js';
import { checkSection73215 }            from './regulatory/section_73_215.js';
import { checkSection73207 }            from './regulatory/section_73_207.js';
import { checkSection73525 }            from './regulatory/section_73_525.js';
import { checkSection73187 }            from './regulatory/section_73_187.js';
import { checkOet65, OET65_PROVENANCE } from './regulatory/oet65.js';
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
      // Per-contour `mode` selects F(50,50) for the service contour and
      // F(50,10) for the §74.1204(a)+(c) interfering contours.  The
      // top-level mode here is the legacy default for any callers that
      // pass a contour entry without its own mode field.
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
    // Stamp the §74.1204(c) D/U gate table + interfering-contour
    // derivations onto the compliance block so the JSON exhibit / TXT
    // export / UI can render the regulatory thresholds alongside the
    // study results.  This is sourced data (47 CFR §74.1204), not a
    // computed assumption.
    regulatory_compliance.regulatory_metadata = FX_REGULATORY_METADATA;
    if (regulatory_compliance.missing_nearby_stations){
      warnings.push(W.make('MISSING_NEARBY_STATIONS'));
    } else if (regulatory_compliance.pass === false){
      warnings.push(W.make('TRANSLATOR_INTERFERENCE',
        regulatory_compliance.violations.map(v => `${v.cite}: ${v.message}`).join(' | ')));
    }
  } else if (service === 'FM'){
    // 47 CFR §73.215 — full-service FM contour-protection short-spacing.
    // Only runs when nearby full-service FM stations are supplied via
    // evidence.nearby_primaries.  When the list is missing, the engine
    // emits MISSING_NEARBY_STATIONS — same convention as §74.1204 above.
    const allNearby = Array.isArray(evidence.nearby_primaries) ? evidence.nearby_primaries : [];
    // §73.215 governs full-service FM ↔ full-service FM only.  Strip
    // translators (FX) and LPFM out of the list so a mis-classified
    // entry can't generate a spurious §73.215 violation.
    const nearbyStations = allNearby.filter(p => {
      const svc = String(p?.service || '').toUpperCase();
      return svc === 'FM' || svc === '';
    });
    regulatory_compliance = checkSection73215({
      subject: {
        erp_kw: erp_kW, haat_m, frequency_mhz: freq, lat, lon,
        fcc_class: inputs.fcc_class || null,
        call: inputs.call || null, facility_id
      },
      nearbyStations
    });
    if (regulatory_compliance.missing_nearby_stations){
      warnings.push(W.make('MISSING_NEARBY_STATIONS'));
    } else if (regulatory_compliance.pass === false){
      warnings.push(W.make('FM_CONTOUR_PROTECTION_VIOLATION',
        regulatory_compliance.violations.map(v => `${v.cite}: ${v.message}`).join(' | ')));
    }
    // 47 CFR §73.207 — minimum-distance separation table A.  Runs as
    // a CROSS-REFERENCE alongside the §73.215 contour study.  A
    // §73.207 failure with §73.215 pass is informational (the station
    // qualifies via §73.215 contour protection); §73.207 failure
    // with §73.215 also failing escalates the FM_CONTOUR_PROTECTION_VIOLATION
    // by stamping FM_MINIMUM_SEPARATION_VIOLATION (warning, not blocker —
    // the §73.215 blocker is the operative one when both fail).
    const sep73_207 = checkSection73207({
      subject: { lat, lon, fcc_class: inputs.fcc_class || null, frequency_mhz: freq,
                 call: inputs.call || null, facility_id },
      nearbyStations
    });
    regulatory_compliance.section_73_207 = sep73_207;
    if (sep73_207.pass === false){
      const sec73_215_pass = regulatory_compliance.pass === true;
      warnings.push(W.make('FM_MINIMUM_SEPARATION_VIOLATION',
        sec73_215_pass
          ? `Station fails §73.207(b) minimum-distance separation but qualifies via §73.215 contour protection.  Filing must cite §73.215.  Failed pairs: ${sep73_207.violations.length}.`
          : `Station fails BOTH §73.207(b) minimum-distance separation (${sep73_207.violations.length} pair(s)) AND §73.215 contour protection.  Filing requires either rule to clear.`));
    }
    // 47 CFR §73.525 — TV channel 6 protection (reserved-band FM 88.1-91.9 MHz).
    // Skipped when frequency is outside reserved band; pass-by-default
    // when no nearby ch.6 emitters are supplied.
    const ch6Stations = Array.isArray(evidence.tv_ch6_stations) ? evidence.tv_ch6_stations : [];
    const sec73_525 = checkSection73525({
      subject: { erp_kw: erp_kW, haat_m, frequency_mhz: freq, lat, lon,
                 fcc_class: inputs.fcc_class || null,
                 call: inputs.call || null, facility_id },
      tvCh6Stations: ch6Stations
    });
    regulatory_compliance.section_73_525 = sec73_525;
    if (sec73_525.pass === false){
      warnings.push(W.make('FM_TV_CH6_PROTECTION_VIOLATION',
        sec73_525.violations.map(v => `${v.cite}: ${v.message}`).join(' | ')));
    }
  } else if (service === 'AM'){
    // 47 CFR §73.187 — AM nighttime skywave protection.
    // Runs only when nearby AM stations are supplied via
    // evidence.nearby_primaries.  Without the list the engine emits
    // MISSING_NEARBY_STATIONS — same convention as §74.1204 / §73.215.
    const allNearby = Array.isArray(evidence.nearby_primaries) ? evidence.nearby_primaries : [];
    // §73.187 governs AM ↔ AM only.
    const nearbyAm = allNearby.filter(p => {
      const svc = String(p?.service || '').toUpperCase();
      return svc === 'AM' || svc === '';
    });
    regulatory_compliance = checkSection73187({
      subject: {
        erp_kw:           erp_kW,
        frequency_khz:    Number(freq),       // AM uses kHz at engine boundary
        lat, lon,
        fcc_class:        inputs.fcc_class || null,
        ground_sigma_msm: Number(inputs.ground_sigma_mS_m) || Number(sigma) || null,
        rss_erp_kw:       Number(inputs.rss_erp_kw) || null,
        call:             inputs.call || null,
        facility_id
      },
      nearbyStations: nearbyAm
    });
    if (regulatory_compliance.missing_nearby_stations){
      warnings.push(W.make('MISSING_NEARBY_STATIONS'));
    } else if (regulatory_compliance.pass === false){
      warnings.push(W.make('AM_NIGHTTIME_PROTECTION_VIOLATION',
        regulatory_compliance.violations.map(v => `${v.cite}: ${v.message}`).join(' | ')));
    }
  }

  // ---- OET-65 / §1.1310 RF exposure compliance --------------------
  // Universal — runs for every service (FM/LPFM/FX/AM) whenever ERP
  // and frequency are present.  The §1.1310 MPE limits cover the
  // 0.3 MHz – 100 GHz band so the analysis applies to all broadcast.
  // Frequency input convention: AM in kHz at the engine boundary; we
  // convert to MHz for the OET-65 lookup which is published in MHz.
  let oet65 = null;
  const freq_mhz_for_oet65 = service === 'AM' ? Number(freq) / 1000 : Number(freq);
  if (Number.isFinite(erp_kW) && erp_kW > 0
      && Number.isFinite(freq_mhz_for_oet65) && freq_mhz_for_oet65 > 0){
    oet65 = checkOet65({
      erp_kw:           erp_kW,
      frequency_mhz:    freq_mhz_for_oet65,
      service,
      // Pattern factor and ground-reflection are caller-overridable
      // via inputs.oet65_*; defaults are the conservative OET-65
      // worst-case (main lobe, free space).
      pattern_factor:   Number.isFinite(Number(inputs.oet65_pattern_factor))
                          ? Number(inputs.oet65_pattern_factor) : 1.0,
      ground_reflection: !!inputs.oet65_ground_reflection,
      site_boundary_m:   Number.isFinite(Number(inputs.site_boundary_m))
                          ? Number(inputs.site_boundary_m) : null,
      site_height_m:     Number.isFinite(Number(inputs.site_height_m))
                          ? Number(inputs.site_height_m)   : null
    });
    if (oet65.near_field?.required_for_filing){
      warnings.push(W.make('OET65_NEAR_FIELD_REQUIRED',
        `Far-field compliance distance ${oet65.compliance.uncontrolled.distance_m} m at ${freq_mhz_for_oet65.toFixed(3)} MHz is inside the near-field boundary λ/(2π) = ${oet65.near_field.boundary_m} m.  OET-65 §3.B near-field analysis required for filing-grade compliance.`));
    }
    if (oet65.compliance?.boundary_check?.pass === false){
      warnings.push(W.make('OET65_BOUNDARY_VIOLATION',
        `Power density ${oet65.compliance.boundary_check.power_density_mw_cm2} mW/cm² at site boundary (slant ${oet65.compliance.boundary_check.slant_distance_m} m) exceeds §1.1310 uncontrolled MPE ${oet65.compliance.boundary_check.mpe_uncontrolled_mw_cm2} mW/cm².  Public access must be restricted out to ${oet65.compliance.uncontrolled.distance_m} m or pattern downtilt / ground-reflection assumptions revisited.`));
    }
  } else {
    oet65 = {
      cite:    '47 CFR §1.1310',
      pass:    null,
      study_inputs: { erp_kw: erp_kW, frequency_mhz: freq_mhz_for_oet65 },
      notes:   ['OET-65 study skipped: erp_kw and frequency required.']
    };
  }

  // ---- Polygons + GeoJSON ------------------------------------------
  // If lat/lon are missing, polygons and GeoJSON cannot be built.
  // The radial table (azimuth + contour distances) is still produced;
  // exhibits without coordinates remain useful as an engineering view
  // of the contour distance solver but cannot be plotted on a map.
  //
  // Projection.  Default 'wgs84-karney' (Karney 2013 geodesic on the
  // WGS-84 ellipsoid; sub-nanometre round-trip residual at FCC scales).
  // Set options.projection = 'fcc-spherical' for byte-equivalent vertex
  // coordinates with FCC contours.js (great-circle on a sphere of
  // radius 6371 km).
  // Accepts the legacy alias 'wgs84-vincenty' for backwards-compatibility;
  // both map to the Karney path.
  const projection =
    options.projection === 'fcc-spherical'  ? 'fcc-spherical' :
    options.projection === 'wgs84-vincenty' ? 'wgs84-karney'  :
                                              'wgs84-karney';
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
      curve_engine:   service === 'AM' ? 'fcc-canonical' : fmEngine,
      interpolation:  service === 'AM'
        ? 'FCC groundwave field-grid lookup (Sommerfeld-Norton) — discrete σ {1..8} mS/m × 10 kHz frequency steps; no interpolation across σ'
        : (fmEngine === 'fcc-canonical'
            ? 'FCC bivariate cubic surface fit (ITPLBV) — vendored from contours-api-node'
            : 'log10-distance vs ascending field; linear along HAAT'),
      dataset:        service === 'AM'
        ? 'fcc/contours-api-node@b55870d (gwave.js + data/gwave_field.json)'
        : (fmEngine === 'fcc-canonical'
            ? 'fcc/contours-api-node@b55870d (tvfm_curves.js)'
            : curve_prov.curve_version),
      dataset_meta_sha256: service === 'AM'
        ? '0ba81eca1bda166e36d34906dfdbc72c730a976d91a3356c12b1ccde2a8b059f'
        : (fmEngine === 'fcc-canonical'
            ? '58a0cd0eed98353509f39ea56e6f3a1e9ec94e6882a412be4c97bdf79cb6c28a'
            : curve_prov.meta_sha256),
      engine_module:  service === 'AM' ? 'src/engine/am/groundwave.js' :
                      service === 'LPFM' ? 'src/engine/lpfm/contour.js' :
                      service === 'FX'   ? 'src/engine/translators/contour.js' :
                                            'src/engine/fm/contour.js',
      formula_summary: service === 'AM'
        ? 'FCC amDistance(sigma, dielectric, freq_kHz, target_mV/m, fs1km) — vendored Sommerfeld-Norton groundwave from contours-api-node@b55870d (gwave.js); fs1km = 100·sqrt(P_kW) mV/m at 1 km; identical output to geo.fcc.gov/api/contours/amDistance.json.'
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
  // OET-65 / §1.1310 RF exposure compliance — universal across services.
  exhibit.oet65 = oet65;
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
