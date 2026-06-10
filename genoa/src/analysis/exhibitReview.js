// Advisory AI exhibit-review pass.
//
// Runs the assembled exhibit's verdict / conclusion / HAAT / contour
// surface through the DO inference router's engineering-exhibit-
// validation policy (grounded in the FCC Part-73 KB and the DO RF-
// engineering KB when available) and returns INTERNAL-CONSISTENCY
// findings — e.g. "FILING READINESS: READY while the conclusion is
// NON-COMPLIANT", or "flat HAAT but varying per-radial distances".
//
// STRICTLY ADVISORY.  This never changes contour distances, §73.x
// compliance determinations, readiness gates, or any deterministic
// engine output.  It emits warnings + an advisory section the engineer
// of record reviews.  No MODEL_ACCESS_KEY → no-op (returns null), so
// offline/local/test runs are unaffected.

import * as aiRouter from '../services/aiRouter.js';
import * as fccKb from '../services/fccKb.js';
import * as doKb from '../services/doKb.js';

// Allowed advisory finding categories.  Every category is an OBSERVATION
// class, never an engineering judgment:
//   INCONSISTENCY       — two exhibit surfaces contradict each other
//   MISSING_EVIDENCE    — a claim lacks the evidence record that should back it
//   UNRESOLVED_CONFLICT — two sources disagree and no declared basis resolves it
//   DOCUMENTATION_GAP   — a section/field the exhibit format requires is absent
//   TRACEABILITY_GAP    — a value cannot be traced to a source or provenance record
export const FINDING_CATEGORIES = Object.freeze([
  'INCONSISTENCY',
  'MISSING_EVIDENCE',
  'UNRESOLVED_CONFLICT',
  'DOCUMENTATION_GAP',
  'TRACEABILITY_GAP'
]);

const SYSTEM_PROMPT =
  'You are an FCC broadcast engineering-exhibit consistency auditor.  You are given a ' +
  'condensed snapshot of a generated propagation exhibit (validation verdict, engineering ' +
  'conclusion, HAAT validation, and contour summary).  Identify ONLY concrete internal ' +
  'contradictions or claims that are physically/regulatorily impossible given the other ' +
  'values shown.  Do NOT restate the exhibit, do NOT speculate, do NOT comment on filing ' +
  'merits.  When grounding CFR text is provided, use it to check citations.  Respond as a ' +
  'JSON array of {"issue":"<one sentence>","severity":"WARNING|INFO",' +
  '"category":"INCONSISTENCY|MISSING_EVIDENCE|UNRESOLVED_CONFLICT|DOCUMENTATION_GAP|TRACEABILITY_GAP"}; ' +
  'empty array [] if internally consistent.\n\n' +
  'SCOPE LOCK — you may ONLY inspect: (a) internal consistency, (b) source provenance, ' +
  '(c) traceability of values to evidence, and (d) missing evidence.  You may NOT inspect ' +
  'or pronounce on: compliance determination, filing readiness, rule interpretation, or ' +
  'engineering conclusions.  Those belong exclusively to the deterministic engines and the ' +
  'engineer of record.\n\n' +
  'YOU MUST NEVER DETERMINE WHICH ENGINEERING VALUE IS CORRECT.  You may not declare any ' +
  'HAAT value correct or incorrect, declare FCC-record values wrong, declare computed ' +
  'values correct, override engineer intent, or override source authority.  When two ' +
  'values disagree, report the disagreement as an UNRESOLVED_CONFLICT (or note it is ' +
  'declared/resolved) — never adjudicate it.\n\n' +
  'IMPORTANT: Do NOT flag regulatory_pass=false and haat_status=REVIEW (or PASS) as ' +
  'contradictory.  These are independent checks.  An station can have a valid or ' +
  'reviewable HAAT calculation and STILL fail §73.215 contour protection due to ' +
  'interference geometry — they measure different things.  Only flag the combination if ' +
  'the regulatory failure is explicitly attributed to a HAAT error (e.g. haat_status=INVALID ' +
  'while regulatory_pass=true claiming a HAAT-dependent compliance).\n\n' +
  'IMPORTANT: If haat_input_suspected_type=tower_agl_entered_as_haat, the operator likely ' +
  'entered tower height AGL instead of HAAT.  The operative HAAT basis is declared by the ' +
  'deterministic engine in the HAAT BASIS AND GOVERNANCE block; you do not adjudicate it.  ' +
  'Do NOT treat the difference between operator-entered and terrain-derived HAAT as a ' +
  'contradiction when this flag is set — it is a known and labeled input issue, not an ' +
  'internal inconsistency.\n\n' +
  'SOURCE AUTHORITY CONTEXT: source_attestation_confidence reflects the provenance quality of ' +
  'engineering inputs (FCC LMS=1.00, USGS DEM=0.95, engine-derived=0.90, operator-only=0.50, ' +
  'AI-inferred=0.10).  source_operator_only_fields lists values with no authoritative cross-check. ' +
  'source_attestation_conflicts names fields where two independent sources disagree beyond tolerance. ' +
  'Low source confidence is a DATA QUALITY issue, not a contour math issue — do NOT flag it as ' +
  'an internal engineering contradiction unless the confidence problem would directly invalidate ' +
  'a specific regulatory conclusion shown in the exhibit.\n\n' +
  'SOURCE FRESHNESS AND EVIDENCE LOCK: source_stale lists sources older than their staleness ' +
  'threshold.  evidence_lock_status indicates whether the evidence lock is valid, invalid, ' +
  'missing, or not_verified.  source_record_changed lists sources whose evidence hash changed ' +
  'after locking.  Report a stale, changed, or unlocked authoritative source record (FCC LMS, ' +
  'ASR) as a TRACEABILITY_GAP or MISSING_EVIDENCE finding; do not make any filing-readiness ' +
  'recommendation about it.  evidence_lock_status=not_verified means the lock was created ' +
  'this session and has not yet been re-verified — this is normal for fresh exhibits.';

// ---------------------------------------------------------------------------
// Finding sanitizer — enforces the advisory scope lock in code, not just in
// the prompt.  Two rules:
//
//   1. Every finding carries a category from FINDING_CATEGORIES.  A missing
//      or unknown category defaults to INCONSISTENCY (observation class) —
//      findings are never invented or upgraded, only labeled.
//
//   2. Findings that act as engineering judgments are DROPPED.  The AI layer
//      may surface inconsistencies, contradictions, missing evidence, missing
//      provenance, and unresolved conflicts; it may never declare which
//      engineering value is correct, declare FCC values wrong, declare
//      computed values correct, pronounce a compliance determination, or
//      pronounce filing readiness.  Those belong exclusively to the
//      deterministic engines and the engineer of record.
//
// Dropped findings are returned separately (suppressed[]) so QA can audit
// what the model attempted to assert.
// ---------------------------------------------------------------------------
const JUDGMENT_PATTERNS = [
  /\bis the correct (value|haat|erp|height)\b/i,
  /\bis (the )?(in)?correct\b/i,
  /\b(value|haat|record|figure) is (simply |clearly |plainly )?wrong\b/i,
  /\bshould (be used|control|govern|replace)\b/i,
  /\bmust (be used|control|govern|replace)\b/i,
  /\brecommend (using|adopting|filing|granting)\b/i,
  /\bthe (fcc|licensed|authorized) (value|haat|record) (is|appears) (wrong|incorrect|invalid|erroneous)\b/i,
  /\bthe (terrain|computed|derived) (value|haat|mean) (is|appears) (correct|right|valid|accurate)\b/i,
  /\b(facility|exhibit|station) (is|is not|isn['’]t) (filing[- ]ready|ready to file|compliant|non-?compliant)\b/i,
  /\bthis (filing|application) (should|must|may) (be granted|be dismissed|proceed)\b/i,
  /\boverride the (engineer|declared basis|source authority)\b/i
];

export function sanitizeFindings(rawFindings){
  const findings   = [];
  const suppressed = [];
  for (const f of (Array.isArray(rawFindings) ? rawFindings : [])){
    const issue = String(f?.issue || '').trim();
    if (!issue) continue;
    if (JUDGMENT_PATTERNS.some(re => re.test(issue))){
      suppressed.push({ ...f, suppressed_reason: 'ENGINEERING_JUDGMENT_OUT_OF_SCOPE' });
      continue;
    }
    const cat = String(f?.category || '').toUpperCase();
    findings.push({
      issue,
      severity: String(f?.severity || 'INFO').toUpperCase() === 'WARNING' ? 'WARNING' : 'INFO',
      category: FINDING_CATEGORIES.includes(cat) ? cat : 'INCONSISTENCY'
    });
  }
  return { findings, suppressed };
}

// Build a compact, deterministic snapshot of the consistency-relevant
// surface.  Kept small (the router bills per token) and stable (so the
// same exhibit yields the same prompt → reproducible advisory).
export function snapshot(exhibit){
  const v  = exhibit?.validation_verdict || exhibit?.verdict || {};
  const cat = v.categories || {};
  const hv = exhibit?.haat_validation || {};
  const lines = [];
  lines.push(`service=${exhibit?.station_inputs?.service || '?'} call=${exhibit?.station_inputs?.call || '?'}`);
  if (cat.computational) lines.push(`computational=${cat.computational.status}`);
  if (cat.external)      lines.push(`external_parity=${cat.external.status}`);
  if (cat.filing)        lines.push(`filing_readiness=${cat.filing.status}`);
  if (v.status)          lines.push(`verdict_status=${v.status}`);
  for (const c of (v.components || [])){
    if (c?.name && c?.status) lines.push(`component: ${c.name} = ${c.status}`);
  }
  if (exhibit?.regulatory_compliance?.pass != null)
    lines.push(`regulatory_pass=${exhibit.regulatory_compliance.pass}`);
  if (exhibit?.engineering_conclusion?.conclusion)
    lines.push(`engineering_conclusion=${exhibit.engineering_conclusion.conclusion}`);
  if (hv.status) lines.push(`haat_validation_status=${hv.status} haat_basis=${hv.basis || '?'}`);

  // Full HAAT authority context — enables the AI to distinguish operator
  // input issues from genuine engineering contradictions, and to correctly
  // identify which of the three distinct HAAT concepts applies.
  const s = hv.stats || {};
  const lineage = exhibit?.haat_lineage || {};
  const ha = exhibit?.haat_authority || {};
  const operatorEnteredM  = s.operator_m ?? lineage.operator_entered_m ?? ha.operator_declared_haat_m ?? null;
  const filingControllingM    = ha.filing_controlling_haat_m ?? lineage.operative_m ?? (hv.basis === 'terrain_derived' ? s.mean_m : s.operator_m);
  const filingControllingBasis = ha.filing_controlling_haat_basis ?? lineage.operative_basis ?? hv.basis ?? null;
  const filingControllingSource = ha.filing_controlling_haat_source ?? lineage.operative_source ?? null;
  const aglSuspected      = hv.agl_suspected === true;
  const suspectedInputType = aglSuspected ? 'tower_agl_entered_as_haat' : 'haat_as_entered';
  const haatValidationWarnings = (hv.issues || [])
    .filter(i => i.severity === 'WARNING')
    .map(i => i.code)
    .join(',') || 'none';

  if (operatorEnteredM != null)         lines.push(`haat_operator_entered_m=${operatorEnteredM}`);
  if (ha.authorized_haat_m != null)     lines.push(`haat_fcc_authorized_m=${ha.authorized_haat_m}`);
  if (ha.computed_average_haat_m != null) lines.push(`haat_computed_73_313_mean_m=${ha.computed_average_haat_m}`);
  if (filingControllingM != null)       lines.push(`filing_controlling_haat_m=${filingControllingM}`);
  if (filingControllingBasis)           lines.push(`filing_controlling_haat_basis=${filingControllingBasis}`);
  if (filingControllingSource)          lines.push(`filing_controlling_haat_source=${filingControllingSource}`);
  if (ha.haat_conflict_status)          lines.push(`haat_conflict_status=${ha.haat_conflict_status}`);
  lines.push(`haat_input_suspected_type=${suspectedInputType}`);
  lines.push(`haat_validation_warnings=${haatValidationWarnings}`);

  if (s.min_m != null && s.max_m != null){
    lines.push(`haat_per_radial_range=[${s.min_m}, ${s.max_m}] mean=${s.mean_m}`);
    if (s.relative_delta != null){
      lines.push(`haat_operator_vs_terrain_relative_delta=${(s.relative_delta * 100).toFixed(1)}%`);
    }
  }

  // When regulatory_pass is false, name the failing component(s) explicitly so
  // the AI can distinguish interference-rule failures from HAAT/curve failures.
  if (exhibit?.regulatory_compliance?.pass === false){
    const failed = (v.components || []).filter(c => c?.status === 'FAIL').map(c => c.name);
    if (failed.length) lines.push(`regulatory_fail_reason=${failed.join(',')}`);
    lines.push('note=regulatory_pass=false and haat_validation_status=REVIEW are independent checks; interference geometry alone can cause regulatory_pass=false');
  }
  // Source attestation — lets the AI know when operator input is the sole
  // authority for critical values, or when cross-source conflicts exist.
  const sa = exhibit?.source_attestation;
  if (sa){
    if (sa.overall_confidence != null)
      lines.push(`source_attestation_confidence=${(sa.overall_confidence * 100).toFixed(0)}%`);
    if (sa.conflicts?.length){
      const conflictFields = sa.conflicts.map(c => c.field).join(',');
      lines.push(`source_attestation_conflicts=${conflictFields}`);
    }
    const operatorOnly = (sa.field_scores || Object.values(sa.fields || {}))
      .filter(s => s.verification_status === 'operator_only')
      .map(s => s.field)
      .join(',');
    if (operatorOnly) lines.push(`source_operator_only_fields=${operatorOnly}`);

    // Source freshness context.
    const sfMap = sa.source_freshness ?? {};
    const staleSources = Object.entries(sfMap)
      .filter(([, r]) => r.freshness_status === 'stale')
      .map(([k]) => k)
      .join(',');
    if (staleSources) lines.push(`source_stale=${staleSources}`);

    // Evidence lock status.
    const lv = sa._lock_verification ?? null;
    const el = sa.evidence_lock      ?? null;
    if (el){
      const lockStatus = lv ? (lv.valid ? 'valid' : 'invalid') : 'not_verified';
      lines.push(`evidence_lock_status=${lockStatus}`);
      if (lv && !lv.valid && lv.mismatches?.length){
        lines.push(`source_record_changed=${lv.mismatches.map(m => m.source).join(',')}`);
      }
    } else {
      lines.push('evidence_lock_status=missing');
    }
  }

  // Contour distance spread — computed per contour type so the AI compares
  // min/max within the same contour, not across service vs protected contours.
  const rt = Array.isArray(exhibit?.radial_table) ? exhibit.radial_table : [];
  const perContour = {};
  for (const r of rt){
    const cd = r?.contour_distances_km || {};
    for (const k of Object.keys(cd)){
      const d = Number(cd[k]);
      if (Number.isFinite(d)){ (perContour[k] = perContour[k] || []).push(d); }
    }
  }
  for (const [k, vals] of Object.entries(perContour)){
    lines.push(`contour_${k}_spread_km=[${Math.min(...vals).toFixed(2)}, ${Math.max(...vals).toFixed(2)}]`);
  }
  return lines.join('\n');
}

// Pull grounding chunks from FCC Part 73 KB and the DO RF-engineering KB
// in parallel.  Best-effort; ungrounded if neither KB is authorized.
async function groundingFor(exhibit){
  const fccEnabled  = fccKb.isEnabled();
  const doKbEnabled = doKb.isEnabled();
  if (!fccEnabled && !doKbEnabled) return '';

  const svc = String(exhibit?.station_inputs?.service || '').toUpperCase();
  const fccQuery = svc === 'AM'
    ? '§73.182 nighttime interference RSS and §73.184 groundwave protected contours'
    : '§73.215 contour protection and §73.207 minimum distance separation';
  const doQuery = svc === 'AM'
    ? 'AM broadcast propagation groundwave conductivity terrain interference'
    : 'FM broadcast contour protection interference distance separation';

  const [fccResult, doResult] = await Promise.all([
    fccEnabled  ? fccKb.retrieve(fccQuery, { k: 2 }) : Promise.resolve({ available: false, chunks: [] }),
    doKbEnabled ? doKb.retrieve(doQuery,   { k: 2 }) : Promise.resolve({ available: false, chunks: [] }),
  ]);

  const parts = [];
  if (fccResult.available && fccResult.chunks?.length)
    parts.push('FCC Part 73 excerpts:\n' + fccResult.chunks.map(c => c.text.slice(0, 800)).join('\n---\n'));
  if (doResult.available && doResult.chunks?.length)
    parts.push('RF engineering reference:\n' + doResult.chunks.map(c => c.text.slice(0, 800)).join('\n---\n'));

  return parts.length ? 'Grounding:\n' + parts.join('\n\n') : '';
}

export async function reviewExhibit(exhibit){
  if (!aiRouter.isEnabled()) return null;   // no key → advisory layer off
  const snap = snapshot(exhibit);
  const grounding = await groundingFor(exhibit);
  const user = grounding ? `${snap}\n\n${grounding}` : snap;

  const out = await aiRouter.complete({ system: SYSTEM_PROMPT, user, maxTokens: 600 });
  if (!out.available) return { available: false, reason: out.reason, grounded: !!grounding };

  let parsed = [];
  try {
    const m = out.content.match(/\[[\s\S]*\]/);   // tolerate prose around the JSON
    if (m) parsed = JSON.parse(m[0]);
  } catch { /* leave empty; raw content preserved below */ }

  // Enforce the advisory scope lock: categorize every finding and drop
  // anything that acts as an engineering judgment (see sanitizeFindings).
  const { findings, suppressed } = sanitizeFindings(parsed);

  return {
    available: true,
    grounded:  !!grounding,
    model:     out.model,
    findings,
    // Findings the scope filter removed — kept for QA audit, never rendered.
    suppressed_findings: suppressed,
    raw:       out.content
  };
}
