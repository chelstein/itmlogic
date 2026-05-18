// Executive Summary — plain-English overview at the very front of the
// exhibit, written for the GM / station owner / city planning department
// who isn't an RF engineer.  Real-world reference: Hatfield & Dawson
// Bellevue Mercer Slough Report (November 2002) page 1 — 4-paragraph
// summary covering the facility, what's at risk, cost / scope context,
// and the bottom-line recommendation, all readable cover-to-cover by
// a non-engineer.
//
// This is DIFFERENT from the Engineering Conclusion (which is the
// technical disposition at the back) and from the Purpose of Study
// (which is a one-liner stating WHY the exhibit was prepared).  The
// Executive Summary is the broader narrative bridge between the cover
// page and the technical body.
//
// Structure (matches Hatfield & Dawson):
//   ¶1  What the facility is (call, freq, class, community, mode)
//   ¶2  What this exhibit evaluates (the regulatory question + headline)
//   ¶3  What was found (verdict in plain English) + filing readiness
//   ¶4  Next steps / recommendations / where to look for detail
//
// Always renders.  Pulls from station_inputs, validation, regulatory_
// compliance, am_*_compliance, and filing_readiness — no schema change.

import { classifyAmDaMode } from '../../../engine/am/daModalClassification.js';

export function buildExecutiveSummarySection(exhibit){
  const s   = exhibit?.station_inputs        || {};
  const fm  = exhibit?.facility_metadata     || {};
  const v   = exhibit?.validation            || {};
  const rc  = exhibit?.regulatory_compliance || {};
  const cc  = exhibit?.engineering_conclusion || {};

  const svc       = String(s.service || '').toUpperCase();
  const isAm      = svc === 'AM' || svc === 'AX';
  const call      = s.call || '— (call sign not stated)';
  const facId     = s.facility_id || '— (facility ID not stated)';
  const community = s.community_of_license || fm.community_of_license || '— (community-of-license not stated)';
  const freq      = Number.isFinite(Number(s.frequency)) ? Number(s.frequency) : null;
  const freqUnit  = s.frequency_unit || (isAm ? 'kHz' : 'MHz');
  const fccClass  = s.fcc_class || '—';
  const tpoOrErp  = Number.isFinite(Number(s.erp_kw)) ? Number(s.erp_kw) : null;
  const tpoLabel  = isAm ? 'TPO' : 'ERP';
  const intent    = s.study_intent || '—';
  const intentText = intent === 'existing_facility_review' ? 'a review of the existing licensed facility'
                  : intent === 'major_change'              ? 'a major-change application'
                  : intent === 'new_station'               ? 'a new-station construction permit'
                  : intent === 'minor_change'              ? 'a minor-change application'
                  : 'an FCC engineering analysis';

  // Modal notation (DA-D / DA-N / DA-2 / DA-3 / NDA-U) for AM.
  let modal = '';
  if (isAm){
    const m = classifyAmDaMode({ inputs: s });
    modal = m?.full_notation ? ` (${m.full_notation})` : '';
  }

  // ¶1 — facility identity
  const para1 = `${call} (Facility ID ${facId}) operates on ${freq != null ? `${freq} ${freqUnit}` : 'an unstated frequency'} from ${community}, ${isAm ? 'as a' : 'as an'} ${svc || 'broadcast'} ${fccClass !== '—' ? `Class ${fccClass} ` : ''}facility${isAm ? ' under 47 CFR Part 73 Subpart A' : ''}${tpoOrErp != null ? `, ${tpoOrErp} kW ${tpoLabel}` : ''}${modal}.  This engineering exhibit was prepared by Genoa FCC Propagation Studio to support ${intentText} for this facility.`;

  // ¶2 — what was evaluated
  const checks = [];
  if (isAm){
    checks.push('the §73.184 groundwave service contours (city / primary / secondary / night-intf)');
    checks.push('§73.187 nighttime skywave protection of every Class A / B / D station within 1500 km');
    if (exhibit?.am_blanket_compliance?.applicable)      checks.push('§73.24(g) blanketing-interference compliance');
    if (exhibit?.am_city_coverage_compliance?.applicable) checks.push('§73.24(j) principal-community coverage');
    if (exhibit?.am_da_pattern_compliance?.applicable)   checks.push('§73.150 directional-antenna pattern shape');
    if (exhibit?.international_border?.inside_treaty_zone) checks.push('US/Mexico and / or US/Canada AM treaty obligations');
  } else {
    checks.push('§73.333 F(50,50) and F(50,10) service / interferer contours');
    checks.push('§73.207 minimum-distance spacing and §73.215 contour-protection alternates');
    checks.push('§73.313 HAAT and §73.316 directional-antenna pattern application');
  }
  const para2 = `The exhibit evaluates ${checks.join('; ')}.  Methodology, curve dataset SHA-256, projection (WGS-84 Karney 2013), and per-radial spherical-vs-Karney validation are documented in the appendix evidence so the exhibit is replay-deterministic — the same inputs always produce the same numbers, with the same SHA-256 hashes.`;

  // ¶3 — verdict in plain English
  const compStatus    = v?.status              || '—';
  const filingStatus  = v?.categories?.filing?.status         || '—';
  const compCategory  = v?.categories?.computational?.status  || '—';
  const extCategory   = v?.categories?.external?.status       || '—';
  const conclusion    = (cc?.status || cc?.conclusion || '—').toString().toUpperCase();
  const niceVerdict   = filingStatus === 'READY'        ? 'meets the technical and regulatory bar to file'
                    :  filingStatus === 'REVIEW'        ? 'is computationally verified but requires engineer-of-record review before filing'
                    :  filingStatus === 'DO NOT FILE'   ? 'should NOT be filed in its current form — see Engineering Conclusion for the blocker(s)'
                    :  'is in review (see Validation Verdict)';
  const para3 = `Genoa's computational validation came back ${compCategory}; the external-parity cross-check came back ${extCategory}.  Overall the proposed exhibit ${niceVerdict}.  The Engineering Conclusion further reports the regulatory disposition as ${conclusion}.  This Executive Summary is INFORMATIONAL — the actual filing decision rests with the qualified broadcast engineer of record reviewing the technical body.`;

  // ¶4 — recommendations / where to look
  const recs = [];
  if (filingStatus === 'REVIEW' || extCategory === 'TIER-3'){
    recs.push('Re-run the exhibit with the live geo.fcc.gov parity check before filing if a definitive external cross-verification is required (the current run used tier-3 code-identity verification).');
  }
  if (exhibit?.am_blanket_compliance?.overall_pass === false){
    recs.push('The §73.24(g) blanketing-interference population check FAILED — a §73.318(b) remediation plan and receiver-treatment commitment must accompany the application.');
  }
  if (exhibit?.am_city_coverage_compliance?.overall_pass === false){
    const pct = Number.isFinite(exhibit.am_city_coverage_compliance.coverage_pct)
      ? (exhibit.am_city_coverage_compliance.coverage_pct * 100).toFixed(1) + '%'
      : '—';
    recs.push(`§73.24(j) principal-community coverage is ${pct} of the city-of-license boundary — a substantial-compliance waiver showing or facility redesign is required before filing.`);
  }
  if (exhibit?.international_border?.inside_treaty_zone){
    const ts = exhibit.international_border.treaties?.map((t) => t.treaty).join(' + ');
    recs.push(`Site is inside the ${ts} treaty zone — verify co-channel / first-adjacent international stations are protected per the bilateral agreement.`);
  }
  if (recs.length === 0){
    recs.push('No further engineering work is required for this exhibit.  Engineer of record may review the body and Certification page, sign, and file.');
  }
  recs.push('Detail for every claim above lives in the body (Methodology, Validation Verdict, Engineering Conclusion) and in the appendices (Radial Data, Validation Evidence, Provenance, Replay Determinism, plus per-rule appendices for AM nighttime allocation, PSRA/PSSA, and the 8 km site survey).');
  const para4 = recs.join('  ');

  return {
    id:      'executive-summary',
    type:    'paragraphs',
    heading: 'EXECUTIVE SUMMARY',
    paragraphs: [para1, para2, para3, para4]
  };
}
