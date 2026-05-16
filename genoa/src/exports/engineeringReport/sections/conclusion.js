// Engineering conclusion — final compliance disposition.
//
// Status logic (per spec):
//   NON-COMPLIANT                  — blockers exist OR interference_study.filing_qualifies === false
//   COMPLIANT VIA ALTERNATE RULE   — §73.207 fail + §73.215 pass (alt-rule path)
//   ENGINEERING REVIEW REQUIRED    — warnings only (no technical failure)
//   COMPLIANT                      — no warnings, no blockers

export function buildConclusionSection(exhibit){
  const ann      = Array.isArray(exhibit.annotations) ? exhibit.annotations : [];
  const blockers = ann.filter(a => a?.severity === 'blocker' || a?.level === 'blocker');
  const warnings = ann.filter(a => a?.severity === 'warning' || a?.level === 'warning');

  const isr      = exhibit.interference_study || null;
  const sec207   = exhibit.regulatory_compliance?.section_73_207 || null;
  const rc       = exhibit.regulatory_compliance || null;
  const sec215Pass = rc && rc.cite === '47 CFR §73.215' && rc.pass === true;
  const sec207Fail = sec207 && sec207.pass === false;

  // AM nighttime allocation (§73.182 NIF) is a filing-controlling rule
  // that the engineering conclusion MUST honor.  If NIF ran AND any
  // azimuth fails the §73.183 D/U threshold OR the worst binding margin
  // is negative, the facility cannot file at the proposed nighttime
  // operating mode/power.  Berry-screening source flips to ENGINEERING
  // REVIEW REQUIRED because the user is warned in-line to re-run with
  // FCCAM/Wang before filing; FCCAM-sourced NIF failure is binding
  // NON-COMPLIANT.
  const nif = exhibit.evidence?.am_night_nif || null;
  const svc = String(exhibit?.station_inputs?.service || '').toUpperCase();
  const nifFailing = svc === 'AM' && nif && nif.available && (
    (Number(nif.summary?.n_failing_azimuths) || 0) > 0 ||
    (Number.isFinite(Number(nif.summary?.worst_margin_db)) && Number(nif.summary?.worst_margin_db) < 0)
  );
  const nifSourceIsScreening = nif && /berry/i.test(
    String(nif.provenance?.upstream_skywave || nif.source || '')
  );

  let status, narrative;
  if (blockers.length > 0){
    status = 'NON-COMPLIANT';
    narrative =
      'The exhibit carries one or more blocker-level findings that prevent a clean compliance disposition.  ' +
      'Facility redesign, waiver analysis, or further engineering review is required prior to filing.';
  } else if (nifFailing && !nifSourceIsScreening){
    status = 'NON-COMPLIANT';
    const s = nif.summary || {};
    narrative =
      'The 47 CFR §73.182 AM nighttime allocation study indicates the facility does not qualify at its ' +
      'proposed nighttime operating mode/power.  ' +
      `${s.n_failing_azimuths ?? '?'}/${s.azimuths_evaluated ?? '?'} evaluated azimuths fail the §73.183 D/U protection ratio; ` +
      `worst binding margin ${Number.isFinite(Number(s.worst_margin_db)) ? Number(s.worst_margin_db).toFixed(2) + ' dB' : 'n/a'}.  ` +
      'Facility redesign (DA pattern, reduced ERP, daytime-only mode, or PSRA/PSSA reduced-power authority) ' +
      'is required prior to filing.';
  } else if (nifFailing && nifSourceIsScreening){
    status = 'ENGINEERING REVIEW REQUIRED';
    const s = nif.summary || {};
    narrative =
      'The 47 CFR §73.182 AM nighttime allocation study was run on the SCREENING-grade Berry 1968 analytical ' +
      'engine and reports ' + (s.n_failing_azimuths ?? '?') + ' failing azimuth(s) ' +
      `(worst margin ${Number.isFinite(Number(s.worst_margin_db)) ? Number(s.worst_margin_db).toFixed(2) + ' dB' : 'n/a'}).  ` +
      'Re-run with FCCAM (Wang 1985) before filing to obtain a defensible §73.190(c) result; ' +
      'a Berry-only failure is advisory and may not bind under §73.187/§73.190(c).';
  } else if (isr && isr.filing_qualifies === false){
    status = 'NON-COMPLIANT';
    // Derive which rules actually failed from per-station failed_rules so
    // the narrative can't claim §73.207 failed when only §73.215 did
    // (or vice versa).  A station may have failed under multiple rules
    // (e.g. §73.207+§73.215) — union them across all failing stations.
    const failedRules = new Set();
    for (const s of (isr.stations || [])){
      if (s.pass_overall === false){
        for (const cite of (s.failed_rules || [])) failedRules.add(cite);
      }
    }
    const ruleDescriptors = {
      '§73.207(b)': '§73.207 minimum distance separation',
      '§73.215':    '§73.215 contour protection',
      '§74.1204':   '§74.1204 translator-interference protection',
      '§73.187':    '§73.187 AM nighttime skywave protection'
    };
    const failedList = [...failedRules]
      .map(c => ruleDescriptors[c] || c)
      .filter(Boolean);
    const failedPhrase = failedList.length === 0
      ? 'the applicable interference rules'
      : failedList.length === 1
        ? failedList[0]
        : failedList.slice(0, -1).join(', ') + ' and ' + failedList[failedList.length - 1];
    narrative =
      'The interference study indicates the subject facility does not qualify under the applicable rule sets.  ' +
      `The facility does not qualify under ${failedPhrase} ` +
      'for all required protected facilities.  Facility redesign, waiver analysis, or further engineering review is required prior to filing.';
  } else if (sec207Fail && sec215Pass){
    status = 'COMPLIANT VIA ALTERNATE RULE';
    narrative =
      'The subject facility does not meet the minimum distance separation requirements of 47 CFR §73.207 with respect to ' +
      'one or more nearby facilities, but qualifies under the contour-protection alternative of 47 CFR §73.215.  ' +
      'Filing is acceptable under the §73.215 alternative.';
  } else if (warnings.length > 0){
    status = 'ENGINEERING REVIEW REQUIRED';
    narrative =
      'The technical analyses do not flag a rule failure, but one or more advisory findings warrant review by the ' +
      'qualified broadcast engineer of record before filing.';
  } else {
    status = 'COMPLIANT';
    narrative =
      'The subject facility meets all applicable technical requirements evaluated in this exhibit.  ' +
      'No blocker- or warning-level findings were raised by the engine.';
  }

  // Surface the headline annotations so the conclusion is auditable.
  const findings = [
    ...blockers.map(b => ({ severity: 'BLOCKER', code: b.code || b.id || '—', message: b.message || b.detail || '' })),
    ...warnings.map(w => ({ severity: 'WARNING', code: w.code || w.id || '—', message: w.message || w.detail || '' }))
  ];

  return {
    id:      'conclusion',
    type:    'conclusion',
    heading: 'ENGINEERING CONCLUSION',
    status,
    narrative,
    findings
  };
}
