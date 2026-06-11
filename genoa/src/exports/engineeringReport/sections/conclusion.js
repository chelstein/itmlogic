// Engineering conclusion — final compliance disposition.
//
// This section is the audit-facing summary of "does this exhibit file?"
// Its disposition is computed by the finding ontology's `verdictFor()`
// reducer so the conclusion CANNOT contradict the validation verdict,
// the annotations, or the rule-specific component statuses.
//
// Legacy status strings (preserved for backwards compatibility with the
// report TXT renderer and downstream tests):
//
//   NON-COMPLIANT                  — filing-blocker / general blocker /
//                                    filing-grade FAIL without alt-rule
//                                    offset.
//   COMPLIANT VIA ALTERNATE RULE   — §73.207 fail + §73.215 pass.
//   ENGINEERING REVIEW REQUIRED    — screening-grade failures, warnings,
//                                    or INCOMPLETE components.
//   COMPLIANT                      — full all-clear or "compliant for the
//                                    checks evaluated" (NOT_RUN downgrade).
//
// New (additive) fields exposed on the returned section:
//
//   verdict                — the raw Verdict.* value from the ontology,
//   confidence             — Confidence.* cap from the ontology,
//   scope                  — Scope.* from the ontology (CHECKS_EVALUATED
//                            etc. so the conclusion can honestly read
//                            "compliant for the checks evaluated").
//   narrative_fragments    — composable sentences derived from the
//                            verdict; the prose `narrative` is built
//                            from these plus the rule-specific context
//                            already known to this section.

import {
  FindingStatus,
  verdictFor,
  legacyConclusionStatus,
  Verdict
} from '../../../engine/finding/ontology.js';
import { wordingFor, rewordForReport } from '../../../engine/finding/serviceWording.js';

export function buildConclusionSection(exhibit){
  const ann      = Array.isArray(exhibit.annotations) ? exhibit.annotations : [];
  const blockers = ann.filter(a => a?.severity === 'blocker' || a?.level === 'blocker');
  const warnings = ann.filter(a => a?.severity === 'warning' || a?.level === 'warning');

  const isr      = exhibit.interference_study || null;
  const sec207   = exhibit.regulatory_compliance?.section_73_207 || null;
  const rc       = exhibit.regulatory_compliance || null;
  const sec215Pass = rc && rc.cite === '47 CFR §73.215' && rc.pass === true;
  const sec207Fail = sec207 && sec207.pass === false;

  const svc      = String(exhibit?.station_inputs?.service || '').toUpperCase();
  const vocab    = wordingFor(svc);

  // ---------- Translate exhibit state into ontology components ----------
  //
  // Each rule surface that materially affects the disposition becomes
  // a component with a FindingStatus.  The verdictFor() reducer then
  // applies the documented invariants (I1..I8) to compute the verdict
  // without this section needing to encode the precedence rules itself.

  const components = [];

  // AM nighttime §73.182 NIF — filing-controlling rule.  A FCCAM-sourced
  // failure is a FILING_BLOCKER; a Berry-screening failure is
  // SCREENING_FAIL (advisory).
  const nif = exhibit.evidence?.am_night_nif || null;
  const nifFailing = svc === 'AM' && nif && nif.available && (
    (Number(nif.summary?.n_failing_azimuths) || 0) > 0 ||
    (Number.isFinite(Number(nif.summary?.worst_margin_db)) && Number(nif.summary?.worst_margin_db) < 0)
  );
  const nifSourceIsScreening = nif && /berry/i.test(
    String(nif.provenance?.upstream_skywave || nif.source || '')
  );
  if (nifFailing){
    components.push({
      name:   `AM nighttime allocation (${vocab.allocation_rule_cite} NIF)`,
      cite:   vocab.allocation_rule_cite,
      status: nifSourceIsScreening ? FindingStatus.SCREENING_FAIL : FindingStatus.FILING_BLOCKER,
      detail: nif.summary || null
    });
  }

  // AM §73.24(i) principal-community 5 mV/m coverage — filing-controlling.
  // overall_pass:null means prerequisites were missing (not measured); only
  // push a component when the check actually ran and returned a definitive fail.
  const cov73_24j = (svc === 'AM') ? (exhibit.am_city_coverage_compliance || null) : null;
  if (cov73_24j && cov73_24j.overall_pass === false){
    components.push({
      name:   '§73.24(i) principal-community 5 mV/m coverage',
      cite:   '47 CFR §73.24(i)',
      status: FindingStatus.FILING_BLOCKER,
      detail: { coverage_pct: cov73_24j.coverage_pct, summary: cov73_24j.summary }
    });
  }

  // Primary-rule interference study (§73.207 + alt-rule §73.215).
  if (isr && isr.filing_qualifies === false){
    components.push({
      name:   'Interference study (primary rules)',
      cite:   (isr.rules_evaluated || []).join(' / ') || '§73.207',
      status: FindingStatus.BLOCKER,
      detail: isr
    });
  }
  if (sec207Fail && sec215Pass){
    // §73.215 alt-rule pass component MUST appear for verdictFor()
    // to recognise the alt-rule offset (Invariant I8).
    components.push({
      name:   'Interference study (primary rule §73.207)',
      cite:   '§73.207',
      status: FindingStatus.BLOCKER,
      detail: sec207
    });
    components.push({
      name:   'Contour protection alternative (§73.215)',
      cite:   '§73.215',
      status: FindingStatus.PASS,
      scope:  'ALT_RULE',
      detail: rc
    });
  }

  // Annotation-level blockers (one ontology component each so the
  // verdict reducer can apply Invariant I2 uniformly).
  for (const b of blockers){
    components.push({
      name:   b.code || b.id || 'annotation',
      cite:   b.cite || null,
      status: b.filing_blocker === true ? FindingStatus.FILING_BLOCKER : FindingStatus.BLOCKER,
      detail: b.message || b.detail || ''
    });
  }

  // ---------- Run the ontology reducer ----------
  const v = verdictFor({
    components,
    blockers,
    warnings
  });

  // ---------- Build the prose narrative ----------
  //
  // Take the verdict's narrative_fragments[] as the spine and decorate
  // with rule-specific context (NIF summary, failed-rule list, etc.).
  let narrative;
  // Detect existing-licensed-facility context for narrative framing.
  const _rcEx = exhibit?.regulatory_compliance || exhibit?.regulatoryContext || {};
  const _isExisting = _rcEx.facility_status === 'licensed'
                   || _rcEx.facilityStatus   === 'licensed'
                   || _rcEx.study_intent     === 'existing_facility_review'
                   || _rcEx.studyIntent      === 'existing_facility_review';
  const _operatingLabel = _isExisting ? 'licensed nighttime operating mode' : 'proposed nighttime operating mode';

  if (v.status === Verdict.NOT_FILING_READY){
    if (cov73_24j && cov73_24j.overall_pass === false && !nifFailing){
      const pct = Number.isFinite(cov73_24j.coverage_pct)
        ? (cov73_24j.coverage_pct * 100).toFixed(1)
        : '?';
      narrative =
        `The 47 CFR §73.24(i) principal-community coverage check indicates the 5 mV/m ` +
        `daytime groundwave contour encompasses only ${pct}% of the city-of-license boundary.  ` +
        `The rule requires the 5 mV/m contour to encompass the entire principal community.  ` +
        (_isExisting
          ? `This is an existing licensed facility; the coverage shortfall may reflect legacy site conditions or a historic waiver.  ` +
            `Any modification or new-CP filing that affects the daytime contour must address the §73.24(i) standard.`
          : `Facility redesign (transmitter site relocation, increased TPO, or DA re-patterning) ` +
            `is required prior to filing.`);
    } else if (nifFailing && !nifSourceIsScreening){
      const s = nif.summary || {};
      narrative =
        `The 47 CFR ${vocab.allocation_rule_cite} ${vocab.service_label} nighttime allocation study indicates ` +
        `the facility does not qualify at its ${_operatingLabel}/` +
        `${vocab.erp_term.toLowerCase()}.  ` +
        // Bug 5 fix: the NIF summary field is `n_azimuths` (emitted by
        // nightOrchestrator.js), not `azimuths_evaluated`.  Using the
        // wrong key produced "36/?" (undefined coerced by ??) or "36/1".
        `${s.n_failing_azimuths ?? '?'}/${s.n_azimuths ?? s.azimuths_evaluated ?? '?'} evaluated azimuths fail the ${vocab.nighttime_interference_cite || vocab.interference_cite} D/U protection ratio; ` +
        `worst binding margin ${Number.isFinite(Number(s.worst_margin_db)) ? Number(s.worst_margin_db).toFixed(2) + ' dB' : 'n/a'}.  ` +
        (_isExisting
          ? `This is an existing licensed facility; the NIF shortfall may reflect legacy/grandfathered conditions.  Any modification or new-CP filing must address the §73.182(k) NIF standard (${vocab.waiver_options}).`
          : `Facility redesign (${vocab.waiver_options}) is required prior to filing.`);
    } else {
      narrative = sentenceJoin(v.narrative_fragments);
    }
  } else if (v.status === Verdict.SCREENING_ADVISORY && nifFailing && nifSourceIsScreening){
    const s = nif.summary || {};
    narrative =
      `The 47 CFR ${vocab.allocation_rule_cite} ${vocab.service_label} nighttime allocation study was run on the advisory ` +
      'screening engine (Berry 1968 analytical) and reports ' + (s.n_failing_azimuths ?? '?') + ' failing azimuth(s) ' +
      `(worst margin ${Number.isFinite(Number(s.worst_margin_db)) ? Number(s.worst_margin_db).toFixed(2) + ' dB' : 'n/a'}).  ` +
      `Re-run with FCCAM (Wang 1985) before filing to obtain a defensible ${vocab.skywave_cite || '§73.190(c)'} result; ` +
      `a Berry-only failure is advisory and may not bind under ${vocab.nighttime_interference_cite || vocab.interference_cite}/${vocab.skywave_cite || '§73.190(c)'}.` +
      (_isExisting ? '  For this existing licensed station, a Berry screening failure is a review condition, not a prohibition on operation.' : '');
  } else if (v.status === Verdict.NON_COMPLIANT && isr && isr.filing_qualifies === false){
    // Reuse the failed-rules synthesis from the prior implementation so
    // the conclusion can't claim §73.207 failed when only §73.215 did.
    const failedRules = new Set();
    for (const s of (isr.stations || [])){
      if (s.pass_overall === false){
        for (const cite of (s.failed_rules || [])) failedRules.add(cite);
      }
    }
    const ruleDescriptors = {
      '§73.207(b)':          '§73.207 minimum distance separation',
      '§73.215':             '§73.215 contour protection',
      '§74.1204':            '§74.1204 translator-interference protection',
      // AM nighttime skywave protection — grounded in §73.182(k) (NIF/RSS)
      // and §73.190 (SS-1/SS-2 charts).  See engine/regulatory/citations.js.
      // §73.187 is "Limitation on daytime radiation" (a different rule)
      // and is no longer emitted by the engine as a nighttime cite.
      '§73.182(k)':          '§73.182(k) AM nighttime interference-free service (NIF / RSS)',
      '§73.182(k) / §73.190': '§73.182(k)/§73.190 AM nighttime skywave protection',
      '§73.190':             '§73.190 AM nighttime skywave (SS-1/SS-2 charts)'
    };
    const failedList = [...failedRules]
      .map(c => ruleDescriptors[c] || c)
      .filter(Boolean);
    const failedPhrase = failedList.length === 0
      ? 'the applicable interference rules'
      : failedList.length === 1
        ? failedList[0]
        : failedList.slice(0, -1).join(', ') + ' and ' + failedList[failedList.length - 1];
    // Soften the wording when this is a licensed/operating facility
    // review.  Saying "facility redesign required prior to filing"
    // for a station that's been on the air for decades is the wrong
    // framing — the station is already authorized; current-rule
    // conflicts may be grandfathered, waived, or historically
    // authorized.  Only "redesign required prior to filing" when the
    // study intent is a new/modification application that hasn't
    // been authorized yet.
    const rc          = exhibit?.regulatory_compliance || {};
    const studyIntent = String(rc.study_intent || '').toLowerCase();
    const interp      = String(rc.interpretation || '').toLowerCase();
    const isLegacyReview = studyIntent === 'existing_facility_review'
                        || interp.includes('legacy')
                        || interp === 'licensed_with_legacy_conflicts'
                        || _isExisting
                        || exhibit?.haat_authority?.provenance?.facility_status === 'licensed';
    if (isLegacyReview){
      narrative =
        `Current-rule contour analysis identified conflicts under ${failedPhrase}.\n\n` +
        'This facility is licensed and operating.\n\n' +
        'The existence of current-rule conflicts does not independently determine ' +
        'authorization status.\n\n' +
        'Conflicts may reflect:\n' +
        '• grandfathered facilities\n' +
        '• waivers\n' +
        '• legacy authorizations\n' +
        '• previously approved facilities\n\n' +
        'Further engineering review is required before drawing licensing ' +
        'conclusions.  Genoa does not determine FCC legal authorization status; ' +
        'any modification application that would change parameters affecting the ' +
        'listed conflicts will need engineering review, waiver analysis, or ' +
        'redesign before filing.';
    } else {
      narrative =
        'The interference study indicates the subject facility does not qualify under the applicable rule sets.  ' +
        `The facility does not qualify under ${failedPhrase} ` +
        'for all required protected facilities.  Facility redesign, waiver analysis, or further engineering review is required prior to filing.';
    }
  } else if (v.status === Verdict.COMPLIANT_VIA_ALT_RULE){
    narrative =
      `The subject facility does not meet the minimum distance separation requirements of 47 CFR ${vocab.allocation_rule_cite} with respect to ` +
      `one or more nearby facilities, but qualifies under the contour-protection alternative of 47 CFR ${vocab.interference_cite}.  ` +
      `Filing is acceptable under the ${vocab.interference_cite} alternative.`;
  } else if (v.status === Verdict.ENGINEERING_REVIEW){
    narrative =
      'The technical analyses do not flag a rule failure, but one or more advisory findings warrant review by the ' +
      'qualified broadcast engineer of record before filing.';
  } else if (v.status === Verdict.COMPLIANT_FOR_CHECKS){
    narrative =
      'The subject facility meets the applicable technical requirements for the checks evaluated in this exhibit.  ' +
      'One or more prerequisite-dependent checks were not run; see the validation section for scope details.';
  } else {
    narrative =
      'The subject facility meets all applicable technical requirements evaluated in this exhibit.  ' +
      'No blocker- or warning-level findings were raised by the engine.';
  }

  // Append FCCGW physics variance advisory when any contour level deviates
  // more than 10% from the FCC §73.184 curve distance.  Advisory only —
  // filing_effect:'none'; does not affect verdict or contour distances.
  const FCCGW_VARIANCE_WARN_PCT = 10;
  const fccgwComp = exhibit.evidence?.am_physics_fccgw?.contour_comparisons;
  if (svc === 'AM' && Array.isArray(fccgwComp)){
    const highVar = fccgwComp.filter(c =>
      c.available !== false &&
      Number.isFinite(c.variance_pct) &&
      c.variance_pct > FCCGW_VARIANCE_WARN_PCT
    );
    if (highVar.length > 0){
      const items = highVar.map(c =>
        `${c.field_mvm} mV/m (FCC curve: ${c.fcc_curve_km} km, OET R86-1: ${c.fccgw_physics_km} km, Δ=${c.variance_pct}%)`
      ).join('; ');
      narrative +=
        `  [ADVISORY — Independent Physics Validation] The FCC/OET R86-1 ground-wave model predicts ` +
        `contour distances that differ from the FCC §73.184 curve values by more than ` +
        `${FCCGW_VARIANCE_WARN_PCT}% for the following contour level(s): ${items}.  ` +
        `This is advisory only and does not modify filing-controlling contour distances.  ` +
        `Variance may reflect site-specific ground conductivity; cross-check σ measurements ` +
        `or consider a radial-segmented conductivity study.`;
    }
  }

  // Audit-friendly rewordings.
  narrative = rewordForReport(narrative);

  // Surface the headline annotations so the conclusion is auditable.
  const findings = [
    ...blockers.map(b => ({ severity: 'BLOCKER', code: b.code || b.id || '—', message: b.message || b.detail || '' })),
    ...warnings.map(w => ({ severity: 'WARNING', code: w.code || w.id || '—', message: w.message || w.detail || '' }))
  ];

  // ---------- Display status: licensed vs proposed distinction ----------
  //
  // "CONCLUSION: NON-COMPLIANT" is the wrong headline for a licensed,
  // operating facility — current-rule conflicts on a licensed station may
  // reflect grandfathered facilities, waivers, or legacy authorizations,
  // and the label must not read as a determination of authorization
  // status.  The machine-readable `status` field is unchanged (downstream
  // consumers and the ontology contract depend on it); `display_status`
  // is what the renderers print.
  const legacyStatus = legacyConclusionStatus(v.status);
  const isLicensedFacilityReview =
    _isExisting ||
    exhibit?.haat_authority?.provenance?.facility_status === 'licensed' ||
    String(exhibit?.regulatory_compliance?.interpretation || '').toLowerCase().includes('legacy');
  const display_status = (legacyStatus === 'NON-COMPLIANT' && isLicensedFacilityReview)
    ? 'CURRENT-RULE CONFLICTS IDENTIFIED'
    : legacyStatus;

  return {
    id:      'conclusion',
    type:    'conclusion',
    heading: 'ENGINEERING CONCLUSION',
    // Legacy status string for backwards compatibility (machine-readable).
    status:  legacyStatus,
    // Engineer-facing label printed by the renderers.  Identical to
    // `status` except for licensed facilities with current-rule conflicts.
    display_status,
    // New ontology surface — additive.
    verdict:             v.status,
    confidence:          v.confidence,
    scope:               v.scope,
    narrative_fragments: v.narrative_fragments,
    narrative,
    findings
  };
}

function sentenceJoin(fragments){
  if (!Array.isArray(fragments) || fragments.length === 0) return '';
  return fragments
    .map(s => String(s || '').trim())
    .filter(Boolean)
    .map(s => s.charAt(0).toUpperCase() + s.slice(1))
    .map(s => /[.!?]$/.test(s) ? s : s + '.')
    .join('  ');
}
