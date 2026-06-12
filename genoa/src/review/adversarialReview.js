// Adversarial Review Engine — stress-tests an exhibit from the perspective of:
//   1. FCC Audio Division reviewer
//   2. FCC attorney
//   3. Consulting engineer
//   4. Opposing engineer filing an objection
//   5. Internal QA reviewer before submission
//
// NO FCC MATH.  Pure structural analysis of what is present, absent, or conflicting.
// Calls existing pure functions: buildLineageReport, buildReadinessReport,
// buildEngineeringReasoning, detectFieldConflicts.

import { buildLineageReport }        from '../exports/lmsFiling/lineage.js';
import { buildReadinessReport }      from '../exports/readiness/index.js';
import { buildEngineeringReasoning } from '../exports/readiness/reasoning.js';
import { detectFieldConflicts }      from '../exports/readiness/conflicts.js';

// ── Severity ranking ──────────────────────────────────────────────────────────

const SEVERITY_RANK = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };

function issue(category, severity, opts) {
  return {
    category,
    severity,
    field:             opts.field             ?? null,
    rule:              opts.rule              ?? null,
    reviewer_question: opts.reviewer_question,
    why_it_matters:    opts.why_it_matters,
    current_evidence:  opts.current_evidence  ?? null,
    gap:               opts.gap,
    recommended_fix:   opts.recommended_fix
  };
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * buildAdversarialReview(exhibit)
 *
 * Returns a structured challenge report: what reviewers will ask, what's
 * defensible, what's missing, and what the engineer must fix before filing.
 */
export function buildAdversarialReview(exhibit) {
  if (!exhibit || typeof exhibit !== 'object') {
    return _empty('(unknown)', '(unknown)');
  }

  const si  = exhibit.station_inputs  || {};
  const fm  = exhibit.facility_metadata || {};
  const raw = fm.raw                  || {};
  const rc  = exhibit.regulatory_compliance ?? null;
  const ev  = exhibit.evidence        || {};

  const service = String(si.service || '').toUpperCase();
  const isAM    = service === 'AM';
  const isFM    = service === 'FM';
  const isLPFM  = service === 'LPFM';
  const isFX    = service === 'FX';

  // Run sub-systems (all pure and synchronous)
  const lineage   = buildLineageReport(exhibit);
  const readiness = buildReadinessReport(exhibit);
  const reasoning = buildEngineeringReasoning(exhibit);
  const conflicts = detectFieldConflicts(exhibit);

  const points = [];

  // ── 1. coordinate_source ──────────────────────────────────────────────────

  const lat = si.lat;
  const lon = si.lon;
  const lookupSource = fm.facility_lookup_source;

  if (lat == null || lon == null || lat === '' || lon === '') {
    points.push(issue('coordinate_source', 'CRITICAL', {
      field: 'lat/lon',
      rule:  'FCC Form 301 technical data (NAD83 coordinates)',
      reviewer_question: 'What are the transmitter coordinates? Coordinates are absent from this exhibit.',
      why_it_matters:    'Every spacing, contour, and distance calculation depends on coordinates. Missing coordinates make the entire engineering exhibit unverifiable.',
      current_evidence:  null,
      gap:               'No transmitter coordinates present in station_inputs',
      recommended_fix:   'Provide NAD83 latitude and longitude to at least 4 decimal places'
    }));
  } else if (!lookupSource && !raw.lat && !raw.lon) {
    points.push(issue('coordinate_source', 'MEDIUM', {
      field: 'lat/lon',
      rule:  'FCC Form 301 technical data (NAD83 coordinates)',
      reviewer_question: `Where did these coordinates (${lat}, ${lon}) originate? LMS, FMQ, ASR, or operator input?`,
      why_it_matters:    'Coordinates without a verified external source are operator assertions only. If wrong, every downstream calculation is invalid.',
      current_evidence:  `lat=${lat}, lon=${lon} (no external source recorded)`,
      gap:               'No facility_lookup_source — coordinates not cross-referenced against FCC database',
      recommended_fix:   'Cross-reference coordinates against LMS or FMQ record; document source in facility_metadata.facility_lookup_source'
    }));
  }

  // ── 2. haat_support ───────────────────────────────────────────────────────

  const haatFiled = si.haat_m_input ?? si.haat_m;
  const radials   = Array.isArray(ev.terrain_haat_per_radial) ? ev.terrain_haat_per_radial : null;

  if (isFM || isLPFM) {
    if (haatFiled == null) {
      points.push(issue('haat_support', 'CRITICAL', {
        field: 'haat_m_input',
        rule:  '47 CFR §73.313(d)',
        reviewer_question: 'What is the filed HAAT and how was it computed?',
        why_it_matters:    'FM service contour distance is a direct function of HAAT. Without a filed HAAT value the 60 dBu contour cannot be computed and no spacing analysis is possible.',
        current_evidence:  null,
        gap:               'No HAAT value in station_inputs (haat_m_input or haat_m)',
        recommended_fix:   'Supply the FCC-accepted HAAT value in station_inputs.haat_m_input'
      }));
    } else if (!radials || radials.length === 0) {
      points.push(issue('haat_support', 'HIGH', {
        field: 'haat_m_input',
        rule:  '47 CFR §73.313(d)',
        reviewer_question: `Why is this filed HAAT of ${haatFiled} m trusted? What terrain source supports it?`,
        why_it_matters:    'An HAAT claim without terrain computation evidence is an unsupported assertion. An opposing engineer or FCC reviewer can challenge any undocumented HAAT.',
        current_evidence:  `Filed HAAT: ${haatFiled} m — no terrain radials in evidence`,
        gap:               'evidence.terrain_haat_per_radial is absent — terrain computation not recorded',
        recommended_fix:   'Run ITM terrain computation for all 8 standard radials and record in evidence.terrain_haat_per_radial'
      }));
    } else if (radials.length < 8) {
      points.push(issue('haat_support', 'MEDIUM', {
        field: 'haat_m_input',
        rule:  '47 CFR §73.313(d)',
        reviewer_question: `Only ${radials.length}/8 standard HAAT radials are present. Is this computation complete?`,
        why_it_matters:    'FCC arc-average HAAT uses all 8 standard radials. Fewer radials may bias the computed mean and overstate or understate coverage.',
        current_evidence:  `${radials.length} of 8 standard radials present`,
        gap:               `${8 - radials.length} standard HAAT radials missing from evidence`,
        recommended_fix:   'Compute terrain HAAT for all 8 standard azimuths: 0°, 45°, 90°, 135°, 180°, 225°, 270°, 315°'
      }));
    }
  }

  // HAAT conflict from reasoning engine
  const haatConflict = (reasoning.conclusions || []).find(c => c.id === 'haat-conflict' && c.result === 'FAIL');
  if (haatConflict) {
    points.push(issue('haat_support', 'CRITICAL', {
      field: 'haat_m_input',
      rule:  '47 CFR §73.313(d)',
      reviewer_question: 'Filed HAAT and terrain-derived HAAT diverge by more than 20%. Which value is authoritative and why does the discrepancy exist?',
      why_it_matters:    'A >20% HAAT discrepancy is a red flag: either the filed HAAT overstates coverage (fraudulent filing risk) or the terrain model is unreliable. Either way, the FCC reviewer will flag this.',
      current_evidence:  haatConflict.conclusion || 'HAAT conflict detected by terrain analysis',
      gap:               'Filed HAAT and terrain-computed HAAT differ by >20% with no explanation',
      recommended_fix:   'Reconcile the values. If the filed HAAT is correct, document why the terrain model diverges (steep terrain, data gap, custom radials). If the terrain value is correct, update the filed HAAT.'
    }));
  }

  // ── 3. contour_support ────────────────────────────────────────────────────

  if ((isFM || isLPFM) && !ev.contour_km) {
    points.push(issue('contour_support', 'HIGH', {
      field: 'service-contour-km',
      rule:  '47 CFR §73.313',
      reviewer_question: 'What is the predicted 60 dBu service contour distance and how was it computed?',
      why_it_matters:    'The service contour is the basis for all §73.207/§73.215 spacing calculations. Without a recorded contour value the spacing analysis cannot be independently reproduced.',
      current_evidence:  null,
      gap:               'No service contour value in evidence.contour_km',
      recommended_fix:   'Run FCC F(50,50) propagation and record the 60 dBu contour distance in evidence.contour_km'
    }));
  }

  // ── 4. spacing_support / unsupported_pass / unsupported_fail ──────────────

  if (rc === null || rc === undefined) {
    if (isFM || isLPFM) {
      points.push(issue('spacing_support', 'CRITICAL', {
        field: 'compliance-pass',
        rule:  '47 CFR §73.207',
        reviewer_question: 'Why is there no §73.207 spacing compliance record in this exhibit? Which stations were checked?',
        why_it_matters:    'FM CP applications require a §73.207 spacing check against all co-channel and adjacent-channel stations. Absent this record the filing is incomplete on its face.',
        current_evidence:  null,
        gap:               'regulatory_compliance is entirely absent from the exhibit',
        recommended_fix:   'Run §73.207 spacing analysis against FCC FM database and record results in regulatory_compliance'
      }));
    }
  } else {
    // Compliance present — check quality of the record
    if (rc.pass === true && !rc.section_73_207 && (isFM || isLPFM)) {
      points.push(issue('unsupported_pass', 'HIGH', {
        field: 'compliance-pass',
        rule:  '47 CFR §73.207',
        reviewer_question: 'Spacing shows PASS but no §73.207 per-station analysis record is present. Which stations were checked and what were the spacing margins?',
        why_it_matters:    'A bare PASS verdict with no per-station records is unverifiable. An opposing engineer can challenge any unexplained spacing clearance.',
        current_evidence:  'regulatory_compliance.pass = true',
        gap:               'No section_73_207 sub-record with per-station check results and spacing margins',
        recommended_fix:   'Include regulatory_compliance.section_73_207 with all checked stations, their distances, and the required separation for each'
      }));
    }

    if (rc.pass === false) {
      const violations = rc.violations || [];
      const missingCite = violations.filter(v => !v.cite && !v.rule);
      if (missingCite.length > 0) {
        points.push(issue('unsupported_fail', 'HIGH', {
          field: 'compliance-pass',
          rule:  '47 CFR §73.215',
          reviewer_question: `${missingCite.length} violation(s) have no rule citation. Which specific rule does each violation invoke?`,
          why_it_matters:    'Each violation must cite the rule it invokes (§73.207 vs §73.215 vs §73.213). Without a citation the applicant cannot know what remedy is required.',
          current_evidence:  `${violations.length} violations, ${missingCite.length} missing cite field`,
          gap:               'Some violation records are missing the cite/rule field',
          recommended_fix:   'Add cite field to every violation entry (e.g. "47 CFR §73.215")'
        }));
      }
    }

    // §73.215 short-spacing — is the showing documented?
    const s73207 = rc.section_73_207;
    if (s73207?.short_spacing === true && rc.pass === true) {
      points.push(issue('spacing_support', 'MEDIUM', {
        field: 'compliance-rule-path',
        rule:  '47 CFR §73.215',
        reviewer_question: 'This filing relies on a §73.215 short-spacing showing. What is the basis for the showing? Has an interference protection agreement been executed?',
        why_it_matters:    '§73.215 showings are subject to third-party objections. The showing must include specific contour overlap analysis and, if required, a signed IPA.',
        current_evidence:  'short_spacing=true, compliance.pass=true via §73.215',
        gap:               'No §73.215 showing documentation or IPA reference found in exhibit',
        recommended_fix:   'Attach §73.215 showing with contour overlap analysis; include IPA if an agreement with the affected station was required'
      }));
    }
  }

  // ── 5. community_coverage ─────────────────────────────────────────────────

  const commFromInputs = si.community || si.city;
  const commFromRaw    = raw.city || raw.community;

  if (!commFromInputs && !commFromRaw) {
    points.push(issue('community_coverage', 'CRITICAL', {
      field: 'community-of-license',
      rule:  'FCC Form 301 Section I (community of license)',
      reviewer_question: 'What is the community of license? It is absent from this exhibit.',
      why_it_matters:    'FCC Form 301 Section I requires the community of license. Missing community makes the filing incomplete on its face and causes LMS rejection.',
      current_evidence:  null,
      gap:               'Community of license not found in station_inputs or facility_metadata.raw.city',
      recommended_fix:   'Add community of license to station_inputs.community, or ensure facility_metadata.raw.city is populated from the FMQ/LMS record'
    }));
  }

  // ── 6. tower_registration ─────────────────────────────────────────────────

  const towerH = si.overall_height_m ?? ev?.asr?.overall_height_m ?? null;

  if (towerH != null) {
    if (towerH <= 0) {
      points.push(issue('tower_registration', 'CRITICAL', {
        field: 'tower-overall-height-agl-m',
        rule:  '47 CFR Part 17',
        reviewer_question: `Tower overall height is ${towerH} m AGL — this is physically impossible. What is the actual structure height?`,
        why_it_matters:    'A zero or negative tower height is a data error that will cause LMS rejection. It also suggests the ASR lookup or engineering data pipeline is broken.',
        current_evidence:  `overall_height_m = ${towerH}`,
        gap:               'Tower height is physically impossible (≤0)',
        recommended_fix:   'Correct overall_height_m to the actual value; source from the ASR record if available'
      }));
    } else if (towerH > 60.96) {
      const hasAsr = raw.asr || ev?.asr?.asr_number || si.asr_number;
      if (!hasAsr) {
        points.push(issue('tower_registration', 'HIGH', {
          field: 'asr-number',
          rule:  '47 CFR §17.7 / Part 17',
          reviewer_question: `Tower is ${towerH.toFixed(1)} m AGL — above the 60.96 m (200 ft) FAA/ASR threshold. Is this structure registered with the FCC ASR database?`,
          why_it_matters:    'Structures >60.96 m AGL require FAA notice and likely require FCC ASR registration. Filing without ASR for a tall structure may cause LMS rejection and delays.',
          current_evidence:  `Tower height: ${towerH.toFixed(1)} m AGL — no ASR number found`,
          gap:               'No ASR registration number for a structure that exceeds the 60.96 m threshold',
          recommended_fix:   'Obtain the ASR registration number; attach FAA OE/No Hazard determination if applicable'
        }));
      }
    }
  } else if (!isLPFM && !isFX) {
    points.push(issue('tower_registration', 'MEDIUM', {
      field: 'tower-overall-height-agl-m',
      rule:  '47 CFR Part 17',
      reviewer_question: 'What is the tower overall height AGL? Has it been compared against the 60.96 m (200 ft) ASR threshold?',
      why_it_matters:    'Tower height must be disclosed on Form 301 to determine ASR registration and FAA notification requirements. Missing height is a filing deficiency.',
      current_evidence:  null,
      gap:               'No tower overall height AGL value in exhibit',
      recommended_fix:   'Add station_inputs.overall_height_m from the ASR record or engineering survey'
    }));
  }

  // ── 7. environmental_rf (OET-65) ──────────────────────────────────────────

  const erpKw = si.erp_kw ?? si.power_kw ?? null;
  if (erpKw != null && erpKw > 0) {
    const hasOet = ev.oet65 || ev.rf_exposure || exhibit.oet65;
    if (!hasOet) {
      const sevOet = erpKw >= 5 ? 'HIGH' : 'MEDIUM';
      points.push(issue('environmental_rf', sevOet, {
        field: null,
        rule:  'OET Bulletin 65',
        reviewer_question: `With ${erpKw} kW ERP, has an OET Bulletin 65 maximum permissible exposure evaluation been conducted?`,
        why_it_matters:    'The FCC requires an RF exposure evaluation (OET Bulletin 65 / §1.1307) for all broadcast stations. Omitting this triggers a deficiency letter that delays the grant.',
        current_evidence:  `ERP: ${erpKw} kW — no OET-65 evaluation record in exhibit`,
        gap:               'No RF exposure (OET-65) evaluation present in exhibit',
        recommended_fix:   'Complete OET Bulletin 65 evaluation; include as Form 301 Exhibit 3 (RF Exposure Compliance)'
      }));
    }
  }

  // ── 8. directional_status ─────────────────────────────────────────────────

  const patternMode = si.pattern_mode || si.pattern_type;
  if ((patternMode === 'DA' || patternMode === 'D') && !ev.pattern_data && !ev.da_pattern) {
    points.push(issue('directional_status', 'HIGH', {
      field: 'antenna-pattern',
      rule:  '47 CFR §73.316 (FM) / §73.150 (AM)',
      reviewer_question: 'This station uses a directional antenna. Where is the horizontal radiation pattern table required by §73.316 (FM) / §73.150 (AM)?',
      why_it_matters:    'DA stations must file a pattern table with Form 301. Without it, contour calculations for any azimuth are unverifiable and LMS will reject the filing.',
      current_evidence:  `pattern_mode = ${patternMode} — no pattern table in evidence`,
      gap:               'No DA pattern table found in evidence.pattern_data',
      recommended_fix:   'Add the FCC-accepted horizontal radiation pattern table to evidence.pattern_data'
    }));
  }

  // ── 9. am_reasoning ───────────────────────────────────────────────────────

  if (isAM) {
    const amConcs = (reasoning.conclusions || []).filter(c => c.id !== 'coordinate-validation');
    if (amConcs.length === 0) {
      points.push(issue('am_reasoning', 'HIGH', {
        field: null,
        rule:  '47 CFR §73.182 / §73.183 / §73.184',
        reviewer_question: 'For this AM station, what §73.182 nighttime skywave interference analysis was performed? What are the NIF contour results?',
        why_it_matters:    'AM CP applications require §73.182 nighttime skywave analysis and §73.183 groundwave contour analysis. These are absent from the engineering reasoning report, leaving the AM-specific filing basis unexplained.',
        current_evidence:  `${reasoning.conclusions?.length ?? 0} reasoning conclusion(s) — AM rules not evaluated`,
        gap:               'No AM-specific reasoning conclusions (§73.182 NIF, §73.183 groundwave, §73.184 power limits)',
        recommended_fix:   'Document AM groundwave contour (§73.183) and nighttime skywave interference analysis (§73.182) results explicitly in the exhibit; note this is a current engine limitation'
      }));
    }

    if (!si.power_kw && !si.erp_kw) {
      points.push(issue('am_reasoning', 'CRITICAL', {
        field: 'am-power-kw',
        rule:  '47 CFR §73.184',
        reviewer_question: 'What is the authorized power for this AM station? Power is absent from the exhibit.',
        why_it_matters:    'AM power determines groundwave service area, nighttime skywave interference potential, and class authorization. It is a required Form 301-AM field.',
        current_evidence:  null,
        gap:               'No power_kw in station_inputs',
        recommended_fix:   'Add station_inputs.power_kw from the FCC license record or application'
      }));
    }
  }

  // ── 10. confidence_basis ──────────────────────────────────────────────────

  const filledFields    = (lineage.fields || []).filter(f => f.status === 'filled' || f.status === 'FILLED');
  const unknownConfFields = filledFields.filter(f => f.confidence === 'unknown' || f.source_system === 'unknown');

  if (unknownConfFields.length > 0) {
    points.push(issue('confidence_basis', 'MEDIUM', {
      field: unknownConfFields.slice(0, 4).map(f => f.id).join(', '),
      rule:  null,
      reviewer_question: `${unknownConfFields.length} filled field(s) have unknown confidence or source system. How can these values be trusted?`,
      why_it_matters:    'Field values with unknown provenance cannot be verified or reproduced. A reviewer may ask for independent confirmation of any unexplained value.',
      current_evidence:  `${unknownConfFields.length} fields: ${unknownConfFields.slice(0, 3).map(f => f.id).join(', ')}`,
      gap:               'Filled fields lack traceable source system or confidence rating',
      recommended_fix:   'Trace each field to its source (FMQ, LMS, ASR, operator input) and update source_system and confidence in the exhibit'
    }));
  }

  // ── 11. missing_lineage (blocking gaps) ───────────────────────────────────

  const BLOCKING_STATUSES = new Set(['NEEDS_INPUT', 'gap', 'EVIDENCE_MISSING', 'unknown', 'invalid', 'INVALID']);
  const blockingGaps = (lineage.fields || []).filter(f => f.blocking === true && BLOCKING_STATUSES.has(f.status));

  if (blockingGaps.length > 0) {
    points.push(issue('missing_lineage', 'HIGH', {
      field: blockingGaps.slice(0, 5).map(f => f.id).join(', '),
      rule:  null,
      reviewer_question: `${blockingGaps.length} required field(s) have no value. How can this filing be considered complete for submission?`,
      why_it_matters:    'Blocking gaps are required fields that must be completed before filing. Each represents a required disclosure on Form 301 that LMS will flag as deficient.',
      current_evidence:  `${blockingGaps.length} blocking fields missing values`,
      gap:               `Blocking fields without values: ${blockingGaps.slice(0, 3).map(f => f.lms_label || f.id).join(', ')}${blockingGaps.length > 3 ? ' …' : ''}`,
      recommended_fix:   'Complete all blocking required fields before submission. See the Field Lineage report for the full list.'
    }));
  }

  // ── 12. conflicting_values ────────────────────────────────────────────────

  for (const conflict of conflicts) {
    const sev = conflict.field === 'haat' ? 'CRITICAL' : 'HIGH';
    const valStr = (conflict.values || []).map(v => `${v.source_system}=${JSON.stringify(v.value)}`).join(' vs ');
    points.push(issue('conflicting_values', sev, {
      field: conflict.field,
      rule:  null,
      reviewer_question: `The ${conflict.label || conflict.field} has conflicting values from different sources. Which source is authoritative and why?`,
      why_it_matters:    'Data conflicts between sources signal an integrity problem. An FCC reviewer may reject a filing where engineering values cannot be reconciled across sources.',
      current_evidence:  valStr || 'conflicting values from multiple sources',
      gap:               conflict.conflict_reason || 'Values diverge across sources without resolution',
      recommended_fix:   `Accept ${conflict.winning_source} as the authoritative source. Document why the other source is superseded (e.g. "FMQ record supersedes operator entry as of facility_updated_at").`
    }));
  }

  // ── 13. filing_readiness (final gate) ────────────────────────────────────

  if (readiness.determination === 'NOT_READY') {
    const compBlockers = (readiness.blockers || []).filter(b => b.code === 'COMPLIANCE_FAILURE');
    if (compBlockers.length > 0) {
      const msgs = compBlockers.map(b => b.message).join('; ');
      points.push(issue('filing_readiness', 'CRITICAL', {
        field: 'compliance-pass',
        rule:  compBlockers[0]?.rule || '47 CFR §73.215',
        reviewer_question: `This exhibit has ${compBlockers.length} active compliance failure(s). What remediation is proposed?`,
        why_it_matters:    'Compliance failures are fatal to a CP application. The FCC will not grant a construction permit to a station with unresolved §73.207/§73.215 violations.',
        current_evidence:  msgs,
        gap:               'Active compliance failures block the filing',
        recommended_fix:   'Resolve all violations before submission: negotiate an interference protection agreement, modify the proposed parameters, or find a non-conflicting facility.'
      }));
    }
  }

  // ── Sort and build output ─────────────────────────────────────────────────

  points.sort((a, b) => (SEVERITY_RANK[b.severity] || 0) - (SEVERITY_RANK[a.severity] || 0));

  const overallRisk =
    points.some(p => p.severity === 'CRITICAL') ? 'HIGH'
    : points.some(p => p.severity === 'HIGH')   ? 'MEDIUM'
    : points.length > 0                          ? 'LOW'
    : 'MINIMAL';

  const station = {
    call:      si.call      || '(unknown)',
    service:   si.service   || '(unknown)',
    frequency: si.frequency ?? si.power_kw ?? null,
    fcc_class: si.fcc_class || null
  };

  return {
    station,
    overall_risk: overallRisk,
    challenge_points:           points,
    defensibility_gaps:         points.filter(p => p.severity === 'CRITICAL' || p.severity === 'HIGH'),
    evidence_gaps:              points.filter(p => ['haat_support', 'contour_support', 'missing_lineage', 'environmental_rf', 'am_reasoning'].includes(p.category)),
    questions_reviewer_may_ask: [...new Set(points.map(p => p.reviewer_question).filter(Boolean))],
    recommended_engineer_actions: [...new Set(points.map(p => p.recommended_fix).filter(Boolean))]
  };
}

/**
 * generateReviewerQuestions(exhibit)
 *
 * Convenience wrapper — returns just the adversarial questions list.
 */
export function generateReviewerQuestions(exhibit) {
  return buildAdversarialReview(exhibit).questions_reviewer_may_ask;
}

// ── Private helpers ────────────────────────────────────────────────────────────

function _empty(call, service) {
  return {
    station:                    { call, service, frequency: null, fcc_class: null },
    overall_risk:               'UNKNOWN',
    challenge_points:           [],
    defensibility_gaps:         [],
    evidence_gaps:              [],
    questions_reviewer_may_ask: [],
    recommended_engineer_actions: []
  };
}
