// Explainability Engine — for every engineering conclusion, produce structured reasoning.
// No conclusion without evidence. No PASS without rule. No FAIL without rule.
//
// buildEngineeringReasoning(exhibit) → {
//   schema:       'genoa.engineering_reasoning.v1',
//   generated_at: ISO-8601,
//   conclusions:  Conclusion[]
// }
//
// Each Conclusion:
//   id          stable kebab key
//   title       one-line title
//   conclusion  one-sentence conclusion statement
//   evidence    [{ label, value, path }]
//   rule        '47 CFR §73.xxx' | null
//   required    what the rule requires | null
//   result      'PASS' | 'FAIL' | 'ADVISORY' | 'UNKNOWN' | 'NOT_APPLICABLE'
//   source      dot-path to driving exhibit data
//   confidence  'HIGH' | 'MEDIUM' | 'LOW' | 'ADVISORY'

export const REASONING_SCHEMA_VERSION = 'genoa.engineering_reasoning.v1';

function meanOf(arr) {
  if (!arr || arr.length === 0) return null;
  const vals = arr.filter(v => v != null && typeof v === 'number');
  if (vals.length === 0) return null;
  return vals.reduce((s, v) => s + v, 0) / vals.length;
}

// ─── Individual conclusion generators ────────────────────────────────────────
// Each returns a conclusion object or null (when data is absent).

function gen_section_73_215_compliance(exhibit) {
  const rc = exhibit.regulatory_compliance;
  if (!rc) return null;
  if (rc.pass === undefined && rc.pass === null) return null;
  if (typeof rc.pass === 'undefined') return null;
  if (!rc.section_73_207) return null;  // spec: require section_73_207 present too

  return (() => {
    const violations = rc.violations ?? [];

    const evidenceItems = violations.map((v, i) => ({
      label: 'Violation',
      value: v.message ?? v,
      path:  `regulatory_compliance.violations[${i}]`,
    }));
    evidenceItems.push({
      label: 'Compliance result',
      value: rc.pass ? 'PASS' : 'FAIL',
      path:  'regulatory_compliance.pass',
    });

    const violationNames = violations
      .map(v => v.station ?? v.call_sign ?? null)
      .filter(Boolean);
    const namesStr = violationNames.length > 0
      ? violationNames.join(' and ')
      : 'one or more protected stations';

    const callSign = exhibit.station_inputs?.call_sign ?? exhibit.station_inputs?.callsign ?? 'Station';

    const conclusion = rc.pass
      ? `${callSign} satisfies §73.215 short-spacing protection requirements`
      : `${callSign} fails §73.215 short-spacing protection against ${namesStr}`;

    return {
      id:         'section-73-215-compliance',
      title:      'Section §73.215 Short-Spacing Compliance',
      conclusion,
      evidence:   evidenceItems,
      rule:       '47 CFR §73.215',
      required:   'Contour protection ratios must not overlap co-channel or adjacent-channel stations without §73.215 waiver',
      result:     rc.pass === true ? 'PASS' : 'FAIL',
      source:     'regulatory_compliance',
      confidence: 'HIGH',
    };
  })();
}

function gen_section_73_207_spacing(exhibit) {
  const rc = exhibit.regulatory_compliance;
  if (!rc?.section_73_207) return null;

  return (() => {
    const s207 = rc.section_73_207;
    const violations = s207.violations ?? [];

    const evidenceItems = violations.map((v, i) => ({
      label: 'Violation',
      value: v.message ?? v,
      path:  `regulatory_compliance.section_73_207.violations[${i}]`,
    }));
    evidenceItems.push({
      label: '§73.207 pass',
      value: s207.pass ? 'PASS' : 'FAIL',
      path:  'regulatory_compliance.section_73_207.pass',
    });

    const conclusion = s207.pass === true
      ? '§73.207 minimum distance separation is satisfied'
      : '§73.207 minimum distance separation is not satisfied';

    return {
      id:         'section-73-207-spacing',
      title:      'Section §73.207 Minimum Spacing',
      conclusion,
      evidence:   evidenceItems,
      rule:       '47 CFR §73.207',
      required:   'Minimum station spacing per Table 1 of §73.207',
      result:     s207.pass === true ? 'PASS' : 'FAIL',
      source:     'regulatory_compliance.section_73_207',
      confidence: 'HIGH',
    };
  })();
}

function gen_haat_filing_value(exhibit) {
  const si = exhibit.station_inputs ?? {};
  const value = si.haat_m_input ?? si.haat_m ?? null;
  if (value == null) return null;

  return (() => {
    return {
      id:    'haat-filing-value',
      title: 'Height Above Average Terrain (HAAT) — Filing Value',
      conclusion: `HAAT filed with FCC is ${value}m (operator-supplied or FCC-accepted)`,
      evidence: [
        {
          label: 'Filed HAAT',
          value,
          path:  'station_inputs.haat_m_input',
        },
      ],
      rule:       '47 CFR §73.313',
      required:   'HAAT must be computed per §73.313 arc-average method over 8 radials at 3–16 km',
      result:     'ADVISORY',
      source:     'station_inputs.haat_m_input',
      confidence: 'MEDIUM',
    };
  })();
}

function gen_haat_terrain_advisory(exhibit) {
  const radials = exhibit.evidence?.terrain_haat_per_radial;
  if (!radials || !Array.isArray(radials)) return null;
  const withComputed = radials.filter(r => r.haat_computed_m != null);
  if (withComputed.length === 0) return null;

  return (() => {
    const capped = withComputed.slice(0, 8);
    const mean   = meanOf(withComputed.map(r => r.haat_computed_m));
    const n      = withComputed.length;

    const evidenceItems = capped.map((r, i) => ({
      label: `Radial ${r.azimuth_deg ?? r.azimuth ?? i * 45}°`,
      value: r.haat_computed_m,
      path:  `evidence.terrain_haat_per_radial[${i}]`,
    }));
    evidenceItems.push({
      label: 'Mean HAAT',
      value: mean != null ? parseFloat(mean.toFixed(2)) : null,
      path:  'computed:mean(terrain_haat_per_radial[].haat_computed_m)',
    });

    return {
      id:    'haat-terrain-advisory',
      title: 'Terrain-Derived Advisory HAAT (§73.313 ITM Per-Radial)',
      conclusion: `Mean per-radial ITM terrain HAAT is ${mean != null ? parseFloat(mean.toFixed(2)) : '?'}m across ${n} radials`,
      evidence:   evidenceItems,
      rule:       '47 CFR §73.313 (advisory — ITM computation)',
      required:   'ADVISORY ONLY — terrain-derived HAAT is informational; filing HAAT comes from operator/FCC-accepted value',
      result:     'ADVISORY',
      source:     'evidence.terrain_haat_per_radial',
      confidence: 'HIGH',
    };
  })();
}

function gen_haat_conflict(exhibit, filingConclusion, terrainConclusion) {
  if (!filingConclusion || !terrainConclusion) return null;

  return (() => {
    const si     = exhibit.station_inputs ?? {};
    const filed  = si.haat_m_input ?? si.haat_m ?? null;

    const radials    = exhibit.evidence?.terrain_haat_per_radial ?? [];
    const withVals   = radials.filter(r => r.haat_computed_m != null);
    const advisory   = meanOf(withVals.map(r => r.haat_computed_m));

    if (filed == null || advisory == null || advisory === 0) return null;

    const pct = Math.abs((filed - advisory) / advisory) * 100;
    if (pct <= 20) return null;

    const pctStr = pct.toFixed(1);

    return {
      id:    'haat-conflict',
      title: 'HAAT Discrepancy: Filed vs Terrain-Derived',
      conclusion: `Filed HAAT (${filed}m) differs from terrain-derived advisory HAAT (${parseFloat(advisory.toFixed(2))}m) by ${pctStr}%`,
      evidence: [
        {
          label: 'Filed HAAT',
          value: filed,
          path:  'station_inputs.haat_m_input',
        },
        {
          label: 'Terrain advisory HAAT',
          value: parseFloat(advisory.toFixed(2)),
          path:  'computed:mean(terrain_haat_per_radial)',
        },
        {
          label: 'Divergence',
          value: `${pctStr}%`,
          path:  'computed',
        },
      ],
      rule:       '47 CFR §73.313',
      required:   'Filed HAAT should be consistent with terrain-derived computation',
      result:     'FAIL',
      source:     'station_inputs.haat_m_input vs evidence.terrain_haat_per_radial',
      confidence: 'HIGH',
    };
  })();
}

function gen_tower_height(exhibit) {
  const si    = exhibit.station_inputs ?? {};
  const asr   = exhibit.evidence?.asr   ?? {};

  const asrHeight      = asr.overall_height_m ?? null;
  const operatorHeight = si.overall_height_m  ?? null;

  if (asrHeight == null && operatorHeight == null) return null;

  return (() => {
    const fromAsr      = asrHeight != null;
    const height       = fromAsr ? asrHeight : operatorHeight;
    const sourcePath   = fromAsr ? 'evidence.asr.overall_height_m' : 'station_inputs.overall_height_m';
    const sourceLabel  = fromAsr ? 'ASR' : 'operator input';

    const evidenceItems = [];
    if (asrHeight != null) {
      evidenceItems.push({ label: 'ASR tower height (m)', value: asrHeight, path: 'evidence.asr.overall_height_m' });
    }
    if (operatorHeight != null) {
      evidenceItems.push({ label: 'Operator tower height (m)', value: operatorHeight, path: 'station_inputs.overall_height_m' });
    }

    let result;
    let conclusion;

    if (height === 0) {
      result     = 'FAIL';
      conclusion = 'Tower height is 0 — physically impossible; source data must be corrected before filing';
    } else if (height > 60.96) {
      result     = 'ADVISORY';
      conclusion = `Tower overall height AGL is ${height}m (from ${sourceLabel})`;
    } else if (height > 0) {
      result     = 'PASS';
      conclusion = `Tower overall height AGL is ${height}m (from ${sourceLabel})`;
    } else {
      result     = 'FAIL';
      conclusion = `Tower height is ${height}m — invalid value; source data must be corrected before filing`;
    }

    return {
      id:    'tower-height',
      title: 'Tower Overall Height AGL',
      conclusion,
      evidence:   evidenceItems,
      rule:       '47 CFR §17.7 / FAA 14 CFR §77',
      required:   'Must be positive; structures >200 ft AGL require FAA Notice',
      result,
      source:     sourcePath,
      confidence: fromAsr ? 'HIGH' : 'MEDIUM',
    };
  })();
}

function gen_erp_class_limit(exhibit) {
  const si = exhibit.station_inputs ?? {};
  if (si.erp_kw == null || !si.fcc_class || si.service !== 'FM') return null;

  return (() => {
    const FM_CLASS_ERP_LIMITS = {
      A:   6,
      B1:  25,
      B:   50,
      C0:  100,
      C1:  100,
      C2:  50,
      C3:  25,
      C:   100,
    };

    const cls   = String(si.fcc_class).toUpperCase();
    const erp   = si.erp_kw;
    const limit = FM_CLASS_ERP_LIMITS[cls] ?? null;
    const callSign = si.call_sign ?? si.callsign ?? 'Station';

    if (limit == null) {
      return {
        id:    'erp-class-limit',
        title: 'ERP vs. FCC Class Maximum',
        conclusion: `${callSign} ERP ${erp}kW — FCC class '${cls}' is not a recognized FM class; cannot validate ERP limit`,
        evidence: [
          { label: 'ERP', value: erp, path: 'station_inputs.erp_kw' },
          { label: 'Class', value: cls, path: 'station_inputs.fcc_class' },
        ],
        rule:       '47 CFR §73.211',
        required:   `Class ${cls} FM stations may not exceed an unrecognized ERP limit`,
        result:     'UNKNOWN',
        source:     'station_inputs.erp_kw',
        confidence: 'LOW',
      };
    }

    const passes = erp <= limit;
    const conclusion = passes
      ? `${callSign} ERP ${erp}kW is within Class ${cls} limit of ${limit}kW`
      : `${callSign} ERP ${erp}kW exceeds Class ${cls} limit of ${limit}kW`;

    return {
      id:    'erp-class-limit',
      title: 'ERP vs. FCC Class Maximum',
      conclusion,
      evidence: [
        { label: 'ERP',           value: erp,   path: 'station_inputs.erp_kw' },
        { label: 'Class',         value: cls,   path: 'station_inputs.fcc_class' },
        { label: 'Class max ERP', value: limit, path: 'computed:FM_CLASS_ERP_LIMITS' },
      ],
      rule:       '47 CFR §73.211',
      required:   `Class ${cls} FM stations may not exceed ${limit} kW ERP`,
      result:     passes ? 'PASS' : 'FAIL',
      source:     'station_inputs.erp_kw',
      confidence: 'HIGH',
    };
  })();
}

function gen_service_contour(exhibit) {
  const polygons = exhibit.polygons;
  if (!Array.isArray(polygons) || polygons.length === 0) return null;

  return (() => {
    const idx = polygons.findIndex(p => /service|60\s*dbu/i.test(p.label ?? ''));
    if (idx === -1) return null;

    const p = polygons[idx];
    const mean_radial_km = p.mean_radial_km ?? null;

    if (mean_radial_km == null) return null;

    return {
      id:    'service-contour',
      title: 'Service Contour (60 dBu) Distance',
      conclusion: `60 dBu service contour extends ${mean_radial_km}km mean radial distance`,
      evidence: [
        { label: 'Mean radial (km)', value: mean_radial_km,  path: `polygons[${idx}].mean_radial_km` },
        { label: 'Contour label',    value: p.label ?? null, path: `polygons[${idx}].label` },
      ],
      rule:       '47 CFR §73.313',
      required:   'Service contour defines the area of interference protection',
      result:     'ADVISORY',
      source:     'polygons',
      confidence: 'HIGH',
    };
  })();
}

function gen_coordinate_validation(exhibit) {
  const si  = exhibit.station_inputs ?? {};
  const lat = si.lat ?? null;
  const lon = si.lon ?? null;

  if (lat == null || lon == null) return null;

  return (() => {
    const inUS = (lat >= 17 && lat <= 75) && (lon >= -180 && lon <= -60);
    const callSign = si.call_sign ?? si.callsign ?? 'Station';

    const conclusion = inUS
      ? `Transmitter coordinates (${lat}°N, ${lon}°W) are within US territory`
      : `Transmitter coordinates (${lat}°N, ${lon}°W) are outside expected US territory`;

    return {
      id:    'coordinate-validation',
      title: 'Transmitter Coordinates (NAD83)',
      conclusion,
      evidence: [
        { label: 'Latitude',  value: lat, path: 'station_inputs.lat' },
        { label: 'Longitude', value: lon, path: 'station_inputs.lon' },
      ],
      rule:       'FCC Form 301 technical data (NAD83 transmitter coordinates)',
      required:   'Coordinates must be within the US service territory',
      result:     inUS ? 'PASS' : 'FAIL',
      source:     'station_inputs',
      confidence: 'HIGH',
    };
  })();
}

// ─── Main export ─────────────────────────────────────────────────────────────

export function buildEngineeringReasoning(exhibit) {
  if (!exhibit || typeof exhibit !== 'object') {
    return {
      schema:       REASONING_SCHEMA_VERSION,
      generated_at: new Date().toISOString(),
      conclusions:  [],
    };
  }

  // Generate filing-value and terrain-advisory first so the conflict
  // check can reference whether both exist.
  const filingConclusion  = gen_haat_filing_value(exhibit);
  const terrainConclusion = gen_haat_terrain_advisory(exhibit);
  const conflictConclusion = gen_haat_conflict(exhibit, filingConclusion, terrainConclusion);

  const generators = [
    gen_section_73_215_compliance(exhibit),
    gen_section_73_207_spacing(exhibit),
    filingConclusion,
    terrainConclusion,
    conflictConclusion,
    gen_tower_height(exhibit),
    gen_erp_class_limit(exhibit),
    gen_service_contour(exhibit),
    gen_coordinate_validation(exhibit),
  ];

  const conclusions = generators.filter(c => c != null);

  return {
    schema:       REASONING_SCHEMA_VERSION,
    generated_at: new Date().toISOString(),
    conclusions,
  };
}
