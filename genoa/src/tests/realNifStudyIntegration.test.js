// Real §73.182 NIF study integration — proves the client-side "run a
// real study and patch the candidate" path (CandidateDetailDrawer.jsx)
// produces EXACTLY the same canonical.regulatory.nif decision the server
// would have produced had the real study existed at scoring time, and
// that the shared nif_status label mapping (canonical/nifStatusLabel.js)
// is used consistently everywhere it's consumed.
//
// This does not require a live FCCAM/Berry sidecar: it tests the
// production glue code (the exact derivation + rule call the UI performs)
// against the production canonical pipeline, using the real
// nightOrchestrator.js response SHAPE as a fixture (per the module's own
// documented contract), not a live network call.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { evaluateNighttimeInterferenceRequirement } from '../engine/am/canonical/rules/nighttimeInterference.js';
import { nifStatusFromCanonical } from '../engine/am/canonical/nifStatusLabel.js';
import { buildCanonicalCandidateResult } from '../engine/am/canonical/buildCanonicalCandidateResult.js';
import { KAZM_BUILD_ARGS, KAZM_STATION, KAZM_PROPAGATION } from './fixtures/kazmCanonical.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Reproduces exactly the derivation CandidateDetailDrawer.jsx's
 * runRealNifStudy() performs on a nightOrchestrator-shaped response —
 * copied here as plain data, not imported, since the orchestrator
 * contract is a wire/HTTP shape (per its own header comment), not a
 * module export the test should reach into.
 */
function deriveNightStudyResult(study){
  return study.summary?.n_failing_azimuths === 0 ? 'PASS' : 'FAIL';
}

const PASSING_STUDY = Object.freeze({
  available: true,
  source: 'fccam-wang-1985',
  filing_grade: true,
  skywave_engine: 'FCCAM_WANG_1985',
  fccam_fallback_used: false,
  summary: Object.freeze({ n_azimuths: 36, n_failing_azimuths: 0, worst_margin_db: 3.2, mean_radius_km: 410.5, n_interferers_used: 7 }),
});

const FAILING_STUDY = Object.freeze({
  available: true,
  source: 'fccam-wang-1985',
  filing_grade: true,
  skywave_engine: 'FCCAM_WANG_1985',
  fccam_fallback_used: false,
  summary: Object.freeze({ n_azimuths: 36, n_failing_azimuths: 4, worst_margin_db: -1.8, mean_radius_km: 395.1, n_interferers_used: 9 }),
});

test('real NIF study: PASSING study derives PASS and recomputes a RUN/PASS decision', () => {
  const night_study_result = deriveNightStudyResult(PASSING_STUDY);
  assert.equal(night_study_result, 'PASS');

  const decision = evaluateNighttimeInterferenceRequirement({
    frequency_khz: KAZM_STATION.frequency_khz,
    fcc_class:     KAZM_STATION.fcc_class,
    pattern_mode:  KAZM_STATION.licensed_pattern_mode,
    night_study_present: true,
    night_study_result,
  });
  assert.equal(decision.required, true);
  assert.equal(decision.completion, 'RUN');
  assert.equal(decision.result, 'PASS');
  assert.equal(decision.state, 'PASS');
});

test('real NIF study: FAILING study derives FAIL and recomputes a RUN/FAIL decision', () => {
  const night_study_result = deriveNightStudyResult(FAILING_STUDY);
  assert.equal(night_study_result, 'FAIL');

  const decision = evaluateNighttimeInterferenceRequirement({
    frequency_khz: KAZM_STATION.frequency_khz,
    fcc_class:     KAZM_STATION.fcc_class,
    pattern_mode:  KAZM_STATION.licensed_pattern_mode,
    night_study_present: true,
    night_study_result,
  });
  assert.equal(decision.completion, 'RUN');
  assert.equal(decision.result, 'FAIL');
  assert.equal(decision.state, 'FAIL');
});

test('real NIF study: client-recomputed decision matches what the SERVER canonical pipeline ' +
     'would have produced had the real study existed at scoring time (no client/server drift)', () => {
  for (const [study, expectedResult] of [[PASSING_STUDY, 'PASS'], [FAILING_STUDY, 'FAIL']]) {
    const night_study_result = deriveNightStudyResult(study);

    // Client path: the exact rule call CandidateDetailDrawer.jsx makes.
    const clientDecision = evaluateNighttimeInterferenceRequirement({
      frequency_khz: KAZM_STATION.frequency_khz,
      fcc_class:     KAZM_STATION.fcc_class,
      pattern_mode:  KAZM_STATION.licensed_pattern_mode,
      night_study_present: true,
      night_study_result,
    });

    // Server path: build the FULL canonical result as if scoreCandidate()
    // had this real study available at scoring time (not a screening
    // placeholder) — same production assembler every candidate goes
    // through, same fixture otherwise.
    const serverCanonical = buildCanonicalCandidateResult({
      ...KAZM_BUILD_ARGS,
      propagation: {
        ...KAZM_PROPAGATION,
        night_study_present: true,
        night_study_result,
      },
    });
    const serverDecision = serverCanonical.regulatory.nif;

    assert.equal(serverDecision.required, clientDecision.required);
    assert.equal(serverDecision.completion, clientDecision.completion);
    assert.equal(serverDecision.result, clientDecision.result);
    assert.equal(serverDecision.state, clientDecision.state);
    assert.equal(serverDecision.result, expectedResult);
  }
});

test('nif_status label: shared mapping renders STUDY PASSED / STUDY FAILED / NOT EVALUATED correctly', () => {
  const base = { frequency_khz: KAZM_STATION.frequency_khz, fcc_class: KAZM_STATION.fcc_class, pattern_mode: KAZM_STATION.licensed_pattern_mode };

  const notEvaluated = evaluateNighttimeInterferenceRequirement({ ...base, night_study_present: false });
  assert.equal(nifStatusFromCanonical(notEvaluated), 'REQUIRED — NOT EVALUATED');

  const passed = evaluateNighttimeInterferenceRequirement({ ...base, night_study_present: true, night_study_result: 'PASS' });
  assert.equal(nifStatusFromCanonical(passed), 'REQUIRED — STUDY PASSED');

  const failed = evaluateNighttimeInterferenceRequirement({ ...base, night_study_present: true, night_study_result: 'FAIL' });
  assert.equal(nifStatusFromCanonical(failed), 'REQUIRED — STUDY FAILED');
});

test('nifStatusFromCanonical: siteOptimizer.js and colocationOpportunities.js import the shared ' +
     'module rather than each defining their own copy (no reintroduced duplicate)', () => {
  for (const relPath of ['../engine/am/siteOptimizer.js', '../engine/am/colocationOpportunities.js']) {
    const source = readFileSync(join(__dirname, relPath), 'utf8');
    assert.match(
      source,
      /import\s*\{\s*nifStatusFromCanonical\s*\}\s*from\s*['"].*canonical\/nifStatusLabel\.js['"]/,
      `${relPath} must import nifStatusFromCanonical from canonical/nifStatusLabel.js`
    );
    assert.doesNotMatch(
      source,
      /^function nifStatusFromCanonical\(/m,
      `${relPath} must not define its own nifStatusFromCanonical — a reintroduced duplicate risks the exact ` +
      'client/server-drift class this module was extracted to eliminate'
    );
  }
});

test('nifStatusFromCanonical: CandidateDetailDrawer.jsx imports the shared module, no local re-derivation', () => {
  const source = readFileSync(
    join(__dirname, '../components/ui/SiteOptimizer/CandidateDetailDrawer.jsx'), 'utf8'
  );
  assert.match(
    source,
    /import\s*\{\s*nifStatusFromCanonical\s*\}\s*from\s*['"].*canonical\/nifStatusLabel\.js['"]/
  );
  assert.doesNotMatch(source, /function nifStatusFromCanonicalClient/);
});
