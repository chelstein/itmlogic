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

const SYSTEM_PROMPT =
  'You are an FCC broadcast engineering-exhibit consistency auditor.  You are given a ' +
  'condensed snapshot of a generated propagation exhibit (validation verdict, engineering ' +
  'conclusion, HAAT validation, and contour summary).  Identify ONLY concrete internal ' +
  'contradictions or claims that are physically/regulatorily impossible given the other ' +
  'values shown.  Do NOT restate the exhibit, do NOT speculate, do NOT comment on filing ' +
  'merits.  When grounding CFR text is provided, use it to check citations.  Respond as a ' +
  'JSON array of {"issue":"<one sentence>","severity":"WARNING|INFO"}; empty array [] if ' +
  'internally consistent.\n\n' +
  'IMPORTANT: Do NOT flag regulatory_pass=false and haat_status=REVIEW (or PASS) as ' +
  'contradictory.  These are independent checks.  An station can have a valid or ' +
  'reviewable HAAT calculation and STILL fail §73.215 contour protection due to ' +
  'interference geometry — they measure different things.  Only flag the combination if ' +
  'the regulatory failure is explicitly attributed to a HAAT error (e.g. haat_status=INVALID ' +
  'while regulatory_pass=true claiming a HAAT-dependent compliance).\n\n' +
  'IMPORTANT: If haat_input_suspected_type=tower_agl_entered_as_haat, the operator likely ' +
  'entered tower height AGL instead of HAAT.  The operative HAAT is terrain-derived and ' +
  'is the correct value for RF calculations.  Do NOT treat the difference between ' +
  'operator-entered and terrain-derived HAAT as a contradiction when this flag is set — ' +
  'it is a known and labeled input issue, not an internal inconsistency.\n\n' +
  'SOURCE AUTHORITY CONTEXT: source_attestation_confidence reflects the provenance quality of ' +
  'engineering inputs (FCC LMS=1.00, USGS DEM=0.95, engine-derived=0.90, operator-only=0.50, ' +
  'AI-inferred=0.10).  source_operator_only_fields lists values with no authoritative cross-check. ' +
  'source_attestation_conflicts names fields where two independent sources disagree beyond tolerance. ' +
  'Low source confidence is a DATA QUALITY issue, not a contour math issue — do NOT flag it as ' +
  'an internal engineering contradiction unless the confidence problem would directly invalidate ' +
  'a specific regulatory conclusion shown in the exhibit.';

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

  // Full HAAT lineage context — enables the AI to distinguish operator
  // input issues from genuine engineering contradictions.
  const s = hv.stats || {};
  const lineage = exhibit?.haat_lineage || {};
  const operatorEnteredM  = s.operator_m ?? lineage.operator_entered_m ?? null;
  const operativeM        = lineage.operative_m ?? (hv.basis === 'terrain_derived' ? s.mean_m : s.operator_m);
  const operativeBasis    = lineage.operative_basis ?? hv.basis ?? null;
  const operativeSource   = lineage.operative_source ?? null;
  const aglSuspected      = hv.agl_suspected === true;
  const suspectedInputType = aglSuspected ? 'tower_agl_entered_as_haat' : 'haat_as_entered';
  const haatValidationWarnings = (hv.issues || [])
    .filter(i => i.severity === 'WARNING')
    .map(i => i.code)
    .join(',') || 'none';

  if (operatorEnteredM != null) lines.push(`haat_operator_entered_m=${operatorEnteredM}`);
  if (operativeM != null)       lines.push(`haat_operative_for_filing_m=${operativeM}`);
  if (operativeBasis)           lines.push(`haat_operative_basis=${operativeBasis}`);
  if (operativeSource)          lines.push(`haat_operative_source=${operativeSource}`);
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

  let findings = [];
  try {
    const m = out.content.match(/\[[\s\S]*\]/);   // tolerate prose around the JSON
    if (m) findings = JSON.parse(m[0]);
  } catch { /* leave empty; raw content preserved below */ }

  return {
    available: true,
    grounded:  !!grounding,
    model:     out.model,
    findings:  Array.isArray(findings) ? findings : [],
    raw:       out.content
  };
}
