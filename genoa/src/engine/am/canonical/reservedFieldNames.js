// Reserved canonical-authoritative field names.
//
// These are the field names that now read from `candidate.canonical.*`
// (verified directly against src/engine/am/siteOptimizer.js — not
// reconstructed from memory or documentation, which can drift). No guide
// module (registered in guides/index.js, or — pending full migration — an
// inline guide IIFE inside scoreCandidate()) may use one of these as its
// own top-level key. buildGuideRegistry() enforces this for registered
// modules; the guide-collision test in guideRegistry.test.js additionally
// proves no unregistered inline guide key in siteOptimizer.js source
// collides with this set.
//
// PER_CANDIDATE_RESERVED_NAMES: literal keys inside scoreCandidate()'s own
// return object (canonical, nif_status, nif_required/_completion/_result —
// siteOptimizer.js ~3401-3411), plus fields assigned via property
// assignment on each candidate AFTER scoreCandidate() returns
// (internally_consistent ~304, tied_within_model_precision/tie_group_size/
// materially_better_than_baseline/scoring_display_label ~502-517). The
// post-processing fields can't be literal-key-clobbered by a guide (the
// post-processing assignment runs after and always wins), but a guide
// using the same name would have its own contribution silently discarded
// — reserved as a naming-hygiene guard, not just an override guard.
export const PER_CANDIDATE_RESERVED_NAMES = new Set([
  'canonical',
  'nif_status',
  'nif_required',
  'nif_completion',
  'nif_result',
  'internally_consistent',
  'tied_within_model_precision',
  'tie_group_size',
  'materially_better_than_baseline',
  'scoring_display_label',
]);

// RESPONSE_LEVEL_RESERVED_NAMES: fields on runSiteOptimizer()'s response
// object (not per-candidate) that read from canonical.* — verified at
// siteOptimizer.js ~415 (optimization_confidence, from
// scored[0].canonical.confidence/filingReadiness) and ~2224
// (candidate_set_recommendation, priorities from canonical.recommendation
// via advisoryFromCanonical()).
export const RESPONSE_LEVEL_RESERVED_NAMES = new Set([
  'optimization_confidence',
  'candidate_set_recommendation',
]);

// Union, for callers that don't need the per-candidate/response distinction
// (e.g. the guide-registry collision check, which only cares that a guide
// key never equals ANY reserved name).
export const RESERVED_CANONICAL_FIELD_NAMES = new Set([
  ...PER_CANDIDATE_RESERVED_NAMES,
  ...RESPONSE_LEVEL_RESERVED_NAMES,
]);
