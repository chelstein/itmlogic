// Source Attestation Framework v2 — operative value resolver.
//
// Deterministic decision tree selecting ONE operative value for a
// filing-relevant field from N candidate attested values:
//
//   1. Validate all candidates (invalid ones never become operative).
//   2. Apply the source authority hierarchy (PRIMARY → SECONDARY →
//      TERTIARY → OPERATOR_SUPPLIED; ADVISORY never operative).
//      MANUAL_ENGINEER_OVERRIDE outranks everything when it carries a
//      reason + reviewer; without them it raises OVERRIDE_INVALID and
//      is excluded.
//   3. Apply per-field tolerances; pairwise-compare candidates and
//      stamp conflict records onto the losing candidates.
//   4. Select the operative value (highest authority; ties broken by
//      confidence HIGH>MEDIUM>LOW, then freshest fetched_at, then
//      stable input order).
//   5. Return all candidates with operative flags, plus blockers and
//      warnings derived from the canonical issue-code registry.
//
// Statuses:
//   RESOLVED                  one operative value, no conflicts
//   RESOLVED_WITH_CONFLICT    operative selected, but ≥1 conflict exists
//   UNRESOLVED                no valid candidate at all
//   SOURCE_UNVERIFIED         operative exists but only UNKNOWN-authority candidates
//   SOURCE_CONFLICT           two same-rank authorities conflict — no deterministic winner
//   MANUAL_OVERRIDE_REQUIRED  conflict requires the engineer of record to decide

import { AUTHORITY_LEVEL, AUTHORITY_RANK, compareAuthority, validateManualOverride, SOURCE_TYPE } from './sourceAuthority.js';
import { toleranceFor, compareValues } from './tolerances.js';
import { validateAttestedValue } from './attestedValue.js';
import { makeIssue } from './issueCodes.js';

export const RESOLUTION_STATUS = Object.freeze({
  RESOLVED:                 'RESOLVED',
  RESOLVED_WITH_CONFLICT:   'RESOLVED_WITH_CONFLICT',
  UNRESOLVED:               'UNRESOLVED',
  SOURCE_UNVERIFIED:        'SOURCE_UNVERIFIED',
  SOURCE_CONFLICT:          'SOURCE_CONFLICT',
  MANUAL_OVERRIDE_REQUIRED: 'MANUAL_OVERRIDE_REQUIRED'
});

const CONF_RANK = { HIGH: 0, MEDIUM: 1, LOW: 2 };

function severityFor(rule){
  // Conflicts against a PRIMARY source on blocker-critical fields read
  // as WARNING by default; escalation to blocker happens at the filing-
  // status layer when the conflict stays unresolved.
  return 'WARNING';
}

/**
 * Resolve the operative value for one field.
 *
 * @param {string} key        field key (e.g. 'haat_m')
 * @param {Array}  candidates attested values (makeAttestedValue output or compatible)
 * @param {object} options    { now } for deterministic tests
 * @returns resolution object (see module doc)
 */
export function resolveOperativeValue(key, candidates, options = {}){
  const rule = toleranceFor(key);
  const warnings = [];
  const blockers = [];
  const all = Array.isArray(candidates) ? candidates.map(c => ({ ...c, operative: false, conflicts: [...(c.conflicts || [])] })) : [];

  // ---- 1. validate ----
  const valid = [];
  for (const c of all){
    const v = validateAttestedValue(c);
    if (!v.valid){
      c.notes = [...(c.notes || []), `excluded: ${v.errors.join('; ')}`];
      continue;
    }
    // Manual override governance: reason + reviewer required to participate.
    if (c.source_type === SOURCE_TYPE.MANUAL_ENGINEER_OVERRIDE){
      const ov = validateManualOverride(c);
      if (!ov.valid){
        blockers.push(makeIssue('OVERRIDE_INVALID', { key, detail: ov.errors.join('; ') }));
        c.notes = [...(c.notes || []), `override excluded: ${ov.errors.join('; ')}`];
        continue;
      }
    }
    valid.push(c);
  }

  if (valid.length === 0){
    if (rule.blocker_if_primary_missing){
      blockers.push(makeIssue('PRIMARY_SOURCE_MISSING', { key }));
    }
    return {
      key,
      operative_value:        null,
      operative_source_type:  null,
      confidence:             null,
      status:                 RESOLUTION_STATUS.UNRESOLVED,
      candidates:             all,
      warnings:               warnings.map(w => w.code),
      blockers:               blockers.map(b => b.code),
      issues:                 [...blockers, ...warnings]
    };
  }

  // ---- 2./3. pairwise conflict detection ----
  let anyConflict = false;
  for (let i = 0; i < valid.length; i++){
    for (let j = i + 1; j < valid.length; j++){
      const a = valid[i], b = valid[j];
      const cmp = compareValues(key, a.value, b.value);
      if (!cmp.conflict) continue;
      anyConflict = true;
      // Stamp the conflict on the LOWER-authority candidate (or both when equal rank).
      const ord = compareAuthority(a.authority_level, b.authority_level);
      const stamp = (loser, winner) => {
        loser.conflicts.push({
          against_source_type: winner.source_type,
          delta:               cmp.delta,
          tolerance:           cmp.tolerance,
          severity:            severityFor(rule),
          code:                rule.conflict_code
        });
      };
      if (ord < 0)      stamp(b, a);
      else if (ord > 0) stamp(a, b);
      else { stamp(a, b); stamp(b, a); }
      if (!warnings.some(w => w.code === rule.conflict_code)){
        warnings.push(makeIssue(rule.conflict_code, { key, delta: cmp.delta, tolerance: cmp.tolerance }));
      }
    }
  }

  // ---- 4. rank and select operative ----
  // ADVISORY sources never become operative.
  const eligible = valid.filter(c => c.authority_level !== AUTHORITY_LEVEL.ADVISORY);
  const ranked = [...eligible].sort((a, b) => {
    // Manual override outranks everything (it's PRIMARY + explicit governance).
    const ovA = a.source_type === SOURCE_TYPE.MANUAL_ENGINEER_OVERRIDE ? 0 : 1;
    const ovB = b.source_type === SOURCE_TYPE.MANUAL_ENGINEER_OVERRIDE ? 0 : 1;
    if (ovA !== ovB) return ovA - ovB;
    const auth = compareAuthority(a.authority_level, b.authority_level);
    if (auth !== 0) return auth;
    const conf = (CONF_RANK[a.confidence] ?? 3) - (CONF_RANK[b.confidence] ?? 3);
    if (conf !== 0) return conf;
    const ta = Date.parse(a.fetched_at || 0) || 0;
    const tb = Date.parse(b.fetched_at || 0) || 0;
    if (ta !== tb) return tb - ta;              // freshest first
    return eligible.indexOf(a) - eligible.indexOf(b);  // stable
  });

  const winner = ranked[0] || null;

  // ---- equal-rank unresolvable conflict check ----
  // Two candidates of the SAME authority rank conflicting with no
  // manual override present → no deterministic winner.
  let sameRankConflict = false;
  if (winner && anyConflict){
    const winnerRank = AUTHORITY_RANK[winner.authority_level];
    sameRankConflict = ranked.some(c =>
      c !== winner &&
      AUTHORITY_RANK[c.authority_level] === winnerRank &&
      c.source_type !== SOURCE_TYPE.MANUAL_ENGINEER_OVERRIDE &&
      winner.source_type !== SOURCE_TYPE.MANUAL_ENGINEER_OVERRIDE &&
      (c.conflicts.some(cf => cf.against_source_type === winner.source_type) ||
       winner.conflicts.some(cf => cf.against_source_type === c.source_type))
    );
  }

  // ---- supporting issue codes ----
  const hasPrimary = valid.some(c => c.authority_level === AUTHORITY_LEVEL.PRIMARY);
  if (!hasPrimary && rule.blocker_if_primary_missing){
    blockers.push(makeIssue('PRIMARY_SOURCE_MISSING', { key }));
  }
  const allOperator = valid.every(c => c.authority_level === AUTHORITY_LEVEL.OPERATOR_SUPPLIED);
  if (allOperator){
    warnings.push(makeIssue('OPERATOR_SUPPLIED_ONLY', { key }));
  }
  const allUnknown = valid.every(c => c.authority_level === AUTHORITY_LEVEL.UNKNOWN);
  if (allUnknown){
    warnings.push(makeIssue('SOURCE_UNVERIFIED', { key }));
  }
  if (winner && !allOperator && winner.authority_level !== AUTHORITY_LEVEL.PRIMARY && hasPrimary === false &&
      winner.authority_level !== AUTHORITY_LEVEL.UNKNOWN &&
      valid.length > 0 && rule.blocker_if_primary_missing === false){
    // Operative came from below PRIMARY because nothing better existed.
    warnings.push(makeIssue('AUTHORITY_DOWNGRADED', { key, operative_authority: winner.authority_level }));
  }

  // ---- 5. status ----
  let status;
  if (!winner){
    status = RESOLUTION_STATUS.UNRESOLVED;
  } else if (sameRankConflict){
    status = RESOLUTION_STATUS.MANUAL_OVERRIDE_REQUIRED;
    blockers.push(makeIssue('MANUAL_OVERRIDE_REQUIRED', { key }));
  } else if (allUnknown){
    status = RESOLUTION_STATUS.SOURCE_UNVERIFIED;
  } else if (anyConflict){
    status = RESOLUTION_STATUS.RESOLVED_WITH_CONFLICT;
  } else {
    status = RESOLUTION_STATUS.RESOLVED;
  }

  if (winner && status !== RESOLUTION_STATUS.MANUAL_OVERRIDE_REQUIRED){
    winner.operative = true;
  }

  return {
    key,
    operative_value:        winner && winner.operative ? winner.value : null,
    operative_source_type:  winner && winner.operative ? winner.source_type : null,
    operative_unit:         winner && winner.operative ? (winner.unit ?? null) : null,
    confidence:             winner && winner.operative ? winner.confidence : null,
    status,
    candidates:             all,
    warnings:               warnings.map(w => w.code),
    blockers:               blockers.map(b => b.code),
    issues:                 [...blockers, ...warnings]
  };
}
