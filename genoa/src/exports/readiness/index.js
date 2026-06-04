// Filing Readiness Gate Engine — answers: "Is this exhibit ready to file with the FCC?"
// Distinct from computeReadinessScore (engine computation quality).

import { buildLineageReport } from '../../exports/lmsFiling/lineage.js';
import { detectFieldConflicts } from './conflicts.js';
import { checkDaPatternReadiness } from './daPatternCheck.js';

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function meanOf(arr) {
  if (!arr || arr.length === 0) return null;
  const sum = arr.reduce((s, v) => s + v, 0);
  return sum / arr.length;
}

export function buildReadinessReport(exhibit, applicant = {}) {
  const lineage = buildLineageReport(exhibit, applicant);
  const fields = lineage.fields ?? [];

  const blockers = [];
  const warnings = [];
  const advisories = [];
  const evidence = [];

  // ── BLOCKERS ────────────────────────────────────────────────────────────────

  for (const f of fields) {
    if (f.blocking === true) {
      const src = f.source ?? 'genoa-auto';
      let code, category;
      if (src === 'genoa-auto') {
        code = 'FIELD_AUTO_MISSING';
        category = 'auto_evidence';
      } else if (src === 'manual-engineer') {
        code = 'FIELD_ENGINEER_REQUIRED';
        category = 'engineer_input';
      } else if (src === 'manual-applicant') {
        code = 'FIELD_APPLICANT_REQUIRED';
        category = 'applicant_input';
      } else {
        code = 'FIELD_AUTO_MISSING';
        category = 'auto_evidence';
      }
      blockers.push({
        code,
        message: `${f.lms_label} is required but not filled`,
        field: f.id,
        remedy: f.expected_source || 'Provide value via workbench',
        category,
      });
    }

    if (f.status === 'invalid' || f.status === 'INVALID') {
      blockers.push({
        code: 'FIELD_INVALID',
        message: `${f.lms_label}: ${f.invalid_reason ?? 'invalid value'}`,
        field: f.id,
        remedy: 'Correct source data before filing',
      });
    }
  }

  const compliance = exhibit.regulatory_compliance ?? {};
  if (compliance.pass === false) {
    const violations = compliance.violations ?? [];
    const sec207 = compliance.section_73_207;

    if (violations.length > 0) {
      for (const v of violations) {
        const is207 = sec207?.pass === false &&
          (sec207?.violations ?? []).some(sv => sv === v || sv?.message === v?.message);
        blockers.push({
          code: 'COMPLIANCE_FAILURE',
          message: v.message ?? v,
          rule: is207 ? '47 CFR §73.207' : '47 CFR §73.215',
          source: 'regulatory_compliance.violations',
        });
      }
    } else {
      blockers.push({
        code: 'COMPLIANCE_FAILURE',
        message: 'Regulatory compliance check failed',
        rule: sec207?.pass === false ? '47 CFR §73.207' : '47 CFR §73.215',
        source: 'regulatory_compliance.violations',
      });
    }
  }

  // ASR registration — FCC LMS rejects applications with towers >60.96 m (200 ft)
  // that have no registered ASR number.  Promote from advisory to blocker.
  const overallHeightM = exhibit.station_inputs?.overall_height_m
    ?? exhibit.evidence?.asr?.overall_height_m ?? null;
  const asrNumber = exhibit.station_inputs?.asr_number
    ?? exhibit.evidence?.asr?.asr_number ?? null;
  if (overallHeightM != null && overallHeightM > 60.96 && !asrNumber) {
    blockers.push({
      code: 'ASR_UNREGISTERED',
      message: `Tower height ${overallHeightM} m exceeds 60.96 m (200 ft) but no ASR registration number is on file`,
      rule: '47 CFR Part 17 / §17.7',
      field: 'asr-registration',
      remedy: 'Register tower with FCC ASR database before filing — LMS will reject without a valid ASR number',
    });
  }

  // DA pattern — §73.316 filing gate for directional-antenna FM stations.
  const daChecks = checkDaPatternReadiness(exhibit);
  blockers.push(...daChecks.blockers);
  // DA warnings are interleaved after the main warnings section to preserve ordering.
  const deferredDaWarnings = daChecks.warnings;

  // ── WARNINGS ────────────────────────────────────────────────────────────────

  const haatField = fields.find(f => f.id === 'haat-m');
  const haatAdvisoryField = fields.find(f => f.id === 'haat-terrain-advisory-m');

  const filedHaat = haatField?.value ?? exhibit.station_inputs?.haat_m_input ?? exhibit.station_inputs?.haat_m ?? null;
  const radials = exhibit.evidence?.terrain_haat_per_radial ?? [];
  const advisoryHaat = haatAdvisoryField?.value ?? meanOf(radials.map(r => r.haat_computed_m).filter(v => v != null));

  if (
    haatField != null && haatAdvisoryField != null &&
    filedHaat != null && advisoryHaat != null &&
    advisoryHaat !== 0
  ) {
    const pct = Math.abs((filedHaat - advisoryHaat) / advisoryHaat) * 100;
    if (pct > 20) {
      warnings.push({
        code: 'HAAT_DISCREPANCY',
        message: `Filed HAAT ${filedHaat}m differs from terrain-derived advisory HAAT ${advisoryHaat.toFixed(1)}m (${pct.toFixed(1)}% divergence)`,
        field: 'haat-m',
        authority: 'genoa-heuristic',
      });
    }
  }

  for (const f of fields) {
    if (
      (f.status === 'suggested' || f.status === 'SUGGESTED') &&
      f.engineer_confirmation_required === true
    ) {
      warnings.push({
        code: 'ENGINEER_CONFIRMATION_NEEDED',
        message: `Engineer confirmation required for: ${f.lms_label}`,
        field: f.id,
      });
    }
  }

  const service = exhibit.station_inputs?.service ?? '';

  // HAAT validation warnings — separate from interference compliance.
  // REVIEW status means terrain is valid but operator input is suspect.
  const haatValidation = exhibit.haat_validation ?? null;
  const haatStatus     = haatValidation?.status ?? null;
  if (haatStatus === 'REVIEW') {
    const haatIssues = (haatValidation?.issues ?? []).map(i => i.code).join(', ');
    warnings.push({
      code: 'HAAT_OPERATOR_SUSPECT',
      message: `HAAT validation status: REVIEW — terrain-derived HAAT was used for RF calculations but operator-entered value is suspect (${haatIssues || 'see haat_validation.issues'}). Engineer of record must confirm HAAT before filing.`,
      authority: 'genoa-heuristic',
    });
  }
  if (haatValidation?.agl_suspected === true) {
    const opM  = haatValidation.stats?.operator_m ?? exhibit.station_inputs?.haat_m_input ?? '?';
    const terM = haatValidation.stats?.mean_m ?? '?';
    warnings.push({
      code: 'HAAT_LIKELY_AGL',
      message: `Operator-entered HAAT (${opM} m) appears to be tower height AGL, not §73.313 HAAT (terrain mean: ${terM} m). Terrain-derived HAAT was used for RF calculations.`,
      authority: 'genoa-heuristic',
    });
  }

  if (service === 'FM' && (!exhibit.evidence?.terrain_haat_per_radial || radials.length === 0)) {
    warnings.push({
      code: 'TERRAIN_EVIDENCE_MISSING',
      message: 'Terrain analysis not run — HAAT is operator-supplied, not ITM-computed',
    });
  }

  const engineBlockers = exhibit.blockers ?? [];
  for (const b of engineBlockers) {
    warnings.push({
      code: 'ENGINE_BLOCKER',
      message: b.message ?? b,
      source: b.source ?? 'engine',
      authority: 'genoa-internal',
    });
  }

  // ── CONFLICT WARNINGS ───────────────────────────────────────────────────────

  const fieldConflicts = detectFieldConflicts(exhibit);
  for (const c of fieldConflicts) {
    // HAAT discrepancy is already covered by the HAAT_DISCREPANCY warning above
    if (c.field === 'haat-m') continue;
    warnings.push({
      code: 'FIELD_CONFLICT',
      field: c.field,
      message: c.conflict_reason,
      detail: c.winning_reason,
      authority: 'genoa-heuristic',
    });
  }

  // DA pattern warnings (collected above alongside blockers, appended here).
  warnings.push(...deferredDaWarnings);

  // OET-65 — §1.1307(b)(3)(i) Table 1 categorical exclusion for FM band (30-300 MHz):
  // threshold = 3.83×R² watts, where R = minimum accessible distance in meters.
  // At R≈36 m (fenced tower), threshold ≈ 5 kW.  5 kW is used here as a conservative
  // station-level gate; FCC routinely issues deficiency letters above this level.
  if (!exhibit.oet65) {
    const erpKw = exhibit.station_inputs?.erp_kw ?? exhibit.station_inputs?.power_day_kw ?? null;
    if (erpKw != null && erpKw >= 5) {
      warnings.push({
        code: 'OET65_REQUIRED',
        message: `OET Bulletin 65 RF exposure evaluation required for ${erpKw} kW ERP — FCC will issue a deficiency letter without it`,
        rule: 'OET Bulletin 65 / 47 CFR §§1.1307(b)(3)(i), 1.1310',
      });
    } else {
      advisories.push({
        code: 'OET65_MISSING',
        message: 'OET Bulletin 65 RF exposure analysis not run',
      });
    }
  }

  // ── ADVISORIES ──────────────────────────────────────────────────────────────

  if (!exhibit.evidence?.sdr_captures) {
    advisories.push({
      code: 'SDR_MISSING',
      message: 'No SDR drive-test captures attached',
      authority: 'genoa-internal',
    });
  }

  if (service === 'AM' && !exhibit.evidence?.am_physics) {
    advisories.push({
      code: 'AM_PHYSICS_MISSING',
      message: 'SOMNEC2D AM physics advisory analysis not run',
      authority: 'genoa-internal',
    });
  }

  // ── SOURCE ATTESTATION ──────────────────────────────────────────────────────
  // Source confidence affects the readiness report but does NOT push into
  // exhibit.blockers/warnings (see buildSourceAttestation.js).  We surface
  // the attestation blockers here so the filing gate sees them.

  const sa = exhibit.source_attestation ?? null;
  if (sa){
    const overallConf = sa.overall_confidence ?? null;
    if (overallConf != null && overallConf < 0.70){
      blockers.push({
        code:     'SOURCE_UNVERIFIED',
        message:  `Overall source confidence ${(overallConf * 100).toFixed(0)}% is below the 70% filing-grade threshold — too many engineering values lack authoritative cross-check`,
        source:   'source_attestation',
        confidence: overallConf
      });
    } else if (overallConf != null && overallConf < 0.85){
      warnings.push({
        code:     'SOURCE_CONFIDENCE_LOW',
        message:  `Overall source confidence ${(overallConf * 100).toFixed(0)}% is below 85% — engineering review required`,
        source:   'source_attestation',
        confidence: overallConf
      });
    }

    for (const w of (sa.warnings ?? [])){
      if (w.code === 'SOURCE_CONFLICT'){
        warnings.push({
          code:    'SOURCE_CONFLICT',
          message: w.message || 'Cross-source authority conflict detected',
          field:   w.field ?? null,
          source:  'source_attestation'
        });
      }
    }
  }

  // ── EVIDENCE ────────────────────────────────────────────────────────────────

  // Separate evidence items for HAAT, interference, and overall status
  // so the readiness report does not imply they must agree.
  evidence.push({
    type: 'compliance',
    label: 'Interference compliance (§73.215)',
    value: compliance.pass ?? null,
    source: 'regulatory_compliance',
  });
  if (haatStatus) {
    evidence.push({
      type:   'haat_validation',
      label:  'HAAT validation status',
      value:  haatStatus,
      source: 'haat_validation.status',
      note:   haatStatus === 'REVIEW'
        ? 'Terrain-derived HAAT used for RF calculations; operator-entered value is suspect'
        : null,
    });
  }
  if (exhibit.haat_lineage?.operative_m != null) {
    evidence.push({
      type:   'haat_operative',
      label:  'Operative HAAT (used in RF calculations)',
      value:  exhibit.haat_lineage.operative_m,
      basis:  exhibit.haat_lineage.operative_basis,
      source: exhibit.haat_lineage.operative_source,
    });
  }

  if (filedHaat != null) {
    evidence.push({
      type: 'haat_filed',
      label: 'Filed HAAT',
      value: filedHaat,
      source: 'station_inputs.haat_m_input',
      path: 'station_inputs.haat_m_input',
    });
  }

  if (advisoryHaat != null) {
    evidence.push({
      type: 'haat_advisory',
      label: 'Terrain-derived advisory HAAT (mean)',
      value: advisoryHaat,
      source: 'evidence.terrain_haat_per_radial',
    });
  }

  const total = fields.length;
  const filled = fields.filter(f => f.status === 'FILLED' || f.status === 'filled').length;
  const blocking = fields.filter(f => f.blocking === true).length;

  evidence.push({
    type: 'field_summary',
    label: 'Filing fields',
    value: `${filled}/${total} filled, ${blocking} blocking gaps`,
  });

  // ── SCORE + DETERMINATION ───────────────────────────────────────────────────

  let score = 100;

  for (const b of blockers) {
    if (b.code === 'COMPLIANCE_FAILURE' || b.code === 'FIELD_INVALID') {
      score -= 25;
    } else if (b.code === 'ASR_UNREGISTERED') {
      score -= 20;
    } else if (b.code === 'DA_PATTERN_MISSING') {
      score -= 20;
    } else if (b.code === 'DA_PATTERN_INVALID') {
      score -= 25;
    } else if (b.code === 'FIELD_AUTO_MISSING') {
      score -= 15;
    } else if (b.code === 'FIELD_ENGINEER_REQUIRED') {
      score -= 5;
    } else if (b.code === 'FIELD_APPLICANT_REQUIRED') {
      score -= 10;
    } else {
      score -= 25;
    }
  }

  for (const w of warnings) {
    if (w.code === 'ENGINE_BLOCKER') {
      score -= 15;
    } else {
      score -= 8;
    }
  }

  score = clamp(score, 0, 100);

  let determination;
  if (blockers.length > 0) {
    determination = 'NOT_READY';
  } else if (score < 80) {
    determination = 'REVIEW';
  } else {
    determination = 'READY';
  }

  return {
    determination,
    readiness_score: score,
    blockers,
    warnings,
    advisories,
    evidence,
  };
}
