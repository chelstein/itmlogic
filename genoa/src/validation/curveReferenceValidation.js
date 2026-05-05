// curve_reference_validation — internal pinned-dataset golden suite.
//
// PURPOSE
//   Prove that the deterministic engine + the pinned curve datasets +
//   the canonical FCC interpolation produce the values they must.
//   PASS clears CURVE_VALIDATION_MISSING.  This is the ONLY system
//   that touches that blocker.
//
//   The suite covers ALL three curve families used by the engine:
//
//     FM F(50,50)  — 47 CFR §73.333 service contour  (fmContourDistance_km mode='50,50')
//     FM F(50,10)  — 47 CFR §73.333 interfering contour (mode='50,10' — used by §74.1204)
//     AM groundwave — 47 CFR §73.183 / §73.184 (fccAmDistanceKm against the gwave field grid)
//
//   LPFM and FX share the FM curve datasets (LPFM is full-service
//   F(50,50); FX is F(50,50) + F(50,10) per §74.1204(a)+(c)) so passing
//   the FM cases also locks the LPFM / FX engine paths.
//
// NOT THIS LAYER
//   External FCC geo contour cross-check is a separate evidence
//   channel (see src/evidence/curveValidation/ztrFccContourValidator.js).
//   FCC mismatch emits FCC_GEO_CROSSCHECK_{FAILED,SKIPPED}, never
//   CURVE_VALIDATION_MISSING.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { fmContourDistance_km } from '../engine/fm/contour.js';
import { fccAmDistanceKm }      from '../engine/curves/fcc/index.mjs';
import { loadDataset, loadManifest } from '../engine/curves/loader.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let _cache = null;
let _cachedAt = 0;
const TTL_MS = 5 * 60 * 1000;

export async function runCurveReferenceValidation({ fixturePath = null } = {}){
  const now = Date.now();
  if (_cache && (now - _cachedAt) < TTL_MS) return _cache;

  const file = fixturePath || path.resolve(__dirname, 'fixtures', 'fm-f5050-golden.json');
  const fixture = JSON.parse(await fs.readFile(file, 'utf8'));
  const manifest = await loadManifest();

  const tolerance_km = Number(fixture.tolerance_km) || 0.1;
  const datasetByName = name => loadDataset(name);

  const results = [];
  let n_run  = 0;
  let n_pass = 0;
  let max_err = 0;
  let sum_err = 0;
  // Per-family counters so the result stamp can show coverage breadth.
  const byFamily = {
    'FM F(50,50)':   { n_run: 0, n_pass: 0 },
    'FM F(50,10)':   { n_run: 0, n_pass: 0 },
    'AM groundwave': { n_run: 0, n_pass: 0 }
  };

  for (const c of fixture.cases || []){
    let computed = null;
    let family = null;
    let target = null;
    let unit = null;
    try {
      if (c.service === 'FM'){
        const mode = c.mode || '50,50';
        family = mode === '50,10' ? 'FM F(50,10)' : 'FM F(50,50)';
        target = c.target_dBu;
        unit   = 'dBu';
        computed = await fmContourDistance_km({
          datasetByName,
          mode,
          target_dBu:    c.target_dBu,
          erp_kW:        c.erp_kw ?? c.erp_kW,
          haat_m:        c.haat_m,
          frequency_mhz: c.frequency_mhz ?? null,
          engine:        'fcc-canonical'
        });
      } else if (c.service === 'AM'){
        family = 'AM groundwave';
        target = c.target_mvm;
        unit   = 'mV/m';
        const r = fccAmDistanceKm({
          frequency_khz:    c.frequency_khz,
          target_mvm:       c.target_mvm,
          conductivity_msm: c.conductivity_msm,
          dielectric:       c.dielectric,           // optional; defaults to FCC §73.184 ε=15
          erp_kw:           c.erp_kw ?? c.erp_kW
        });
        computed = r.distance_km;
      } else {
        results.push({ id: c.id, status: 'skipped', reason: `service ${c.service} not handled by runner` });
        continue;
      }
      const err = Math.abs(computed - c.expected_distance_km);
      const pass = err <= tolerance_km;
      n_run += 1;
      if (pass) n_pass += 1;
      max_err = Math.max(max_err, err);
      sum_err += err;
      if (byFamily[family]){
        byFamily[family].n_run  += 1;
        if (pass) byFamily[family].n_pass += 1;
      }
      results.push({
        id:                    c.id,
        label:                 c.label,
        family,
        target,
        target_unit:           unit,
        expected_distance_km:  c.expected_distance_km,
        computed_distance_km:  computed,
        error_km:              err,
        tolerance_km,
        status:                pass ? 'pass' : 'fail'
      });
    } catch (e){
      n_run += 1;
      results.push({ id: c.id, status: 'error', family, error: String(e.message) });
    }
  }

  const pass = n_run > 0 && n_pass === n_run;
  const out = {
    name:             fixture.name || 'genoa-curve-golden',
    description:      fixture.description || null,
    method:           fixture.method || '47 CFR §73.333 + §73.183/§73.184',
    curve_dataset: {
      version:     fixture.curve_dataset?.version  || manifest.version,
      meta_sha256: fixture.curve_dataset?.meta_sha256 || manifest.meta_sha256
    },
    coverage_by_family: byFamily,
    fixture_path:     path.relative(process.cwd(), file),
    ran_at:           new Date().toISOString(),
    tolerance_km,
    n_run, n_pass,
    max_error_km:     n_run ? max_err : null,
    mean_error_km:    n_run ? (sum_err / n_run) : null,
    results,
    result:           n_run === 0 ? 'no_cases' : (pass ? 'pass' : 'fail'),
    pass
  };
  _cache = out;
  _cachedAt = now;
  return out;
}

// Test hook: forget the cached run so a follow-up call re-reads the
// fixture from disk.  Used by tests that want fresh runs back-to-back.
export function _resetCurveReferenceValidationCache(){
  _cache = null;
  _cachedAt = 0;
}
