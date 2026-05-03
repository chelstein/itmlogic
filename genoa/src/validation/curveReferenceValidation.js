// curve_reference_validation — internal pinned-dataset golden suite.
//
// PURPOSE
//   Prove that the deterministic engine + the pinned §73.333 F(50,50)
//   curve dataset + the linear-log10 / linear-linear interpolation
//   produce the values they must.  PASS clears CURVE_VALIDATION_MISSING.
//   This is the ONLY system that touches that blocker.
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

  for (const c of fixture.cases || []){
    if (c.service !== 'FM'){
      results.push({ id: c.id, status: 'skipped', reason: 'service ' + c.service + ' not in FM golden suite' });
      continue;
    }
    try {
      const d = await fmContourDistance_km({
        datasetByName,
        mode:        c.mode || '50,50',
        target_dBu:  c.target_dBu,
        erp_kW:      c.erp_kw ?? c.erp_kW,
        haat_m:      c.haat_m
      });
      const err = Math.abs(d - c.expected_distance_km);
      const pass = err <= tolerance_km;
      n_run += 1;
      if (pass) n_pass += 1;
      max_err = Math.max(max_err, err);
      sum_err += err;
      results.push({
        id:                    c.id,
        label:                 c.label,
        target_dBu:            c.target_dBu,
        expected_distance_km:  c.expected_distance_km,
        computed_distance_km:  d,
        error_km:              err,
        tolerance_km,
        status:                pass ? 'pass' : 'fail'
      });
    } catch (e){
      n_run += 1;
      results.push({ id: c.id, status: 'error', error: String(e.message) });
    }
  }

  const pass = n_run > 0 && n_pass === n_run;
  const out = {
    name:             fixture.name || 'fm-f5050-golden',
    description:      fixture.description || null,
    method:           fixture.method || '47 CFR §73.333 F(50,50)',
    curve_dataset: {
      version:     fixture.curve_dataset?.version  || manifest.version,
      meta_sha256: fixture.curve_dataset?.meta_sha256 || manifest.meta_sha256
    },
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
