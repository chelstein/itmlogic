// Filing Readiness Gate Engine — answers: "Is this exhibit ready to file with the FCC?"
// Distinct from computeReadinessScore (engine computation quality).

import { buildLineageReport } from '../../exports/lmsFiling/lineage.js';

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
      blockers.push({
        code: 'FIELD_MISSING',
        message: `${f.lms_label} is required but not filled`,
        field: f.id,
        remedy: f.expected_source || 'Provide value via workbench',
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
    });
  }

  // ── ADVISORIES ──────────────────────────────────────────────────────────────

  if (!exhibit.evidence?.sdr_captures) {
    advisories.push({
      code: 'SDR_MISSING',
      message: 'No SDR drive-test captures attached',
    });
  }

  if (!exhibit.oet65) {
    advisories.push({
      code: 'OET65_MISSING',
      message: 'OET Bulletin 65 RF exposure analysis not run',
    });
  }

  if (service === 'AM' && !exhibit.evidence?.am_physics) {
    advisories.push({
      code: 'AM_PHYSICS_MISSING',
      message: 'SOMNEC2D AM physics advisory analysis not run',
    });
  }

  // ── EVIDENCE ────────────────────────────────────────────────────────────────

  evidence.push({
    type: 'compliance',
    label: 'Regulatory compliance',
    value: compliance.pass ?? null,
    source: 'regulatory_compliance',
  });

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
  score -= blockers.length * 20;
  score -= warnings.length * 8;
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
