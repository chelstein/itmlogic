// Provenance conflict engine.
//
// Detects cross-source authority conflicts for the source attestation
// framework.  Unlike the filing-readiness conflict engine
// (exports/readiness/conflicts.js), this module focuses on WHICH
// source is authoritative and whether the filed value agrees with it,
// not on which value to use for the exhibit.
//
// Conflict thresholds per the FCC engineering standards:
//   coordinates:  > 10 m ground distance (≈ 0.0001° at mid-latitudes)
//   tower height: > 3 m delta vs ASR (§17.4 tolerance)
//   ERP:          > 5 % vs FCC-licensed value
//   frequency:    any mismatch vs FCC record (exact match required)
//   FCC class:    any mismatch vs FCC record (exact match required)
//   HAAT:         > 50 % relative delta vs terrain-derived value (§73.313)
//   RCAMSL:       > 20 m delta when DEM value is available

function pctDiff(a, b){
  const denom = Math.max(Math.abs(b), Math.abs(a));
  return denom === 0 ? 0 : (Math.abs(a - b) / denom) * 100;
}

// Ground distance approximation (m) from decimal degree deltas at mid-latitudes.
function approxDistM(dlat, dlon, lat = 40.0){
  const mlat = 111_320;
  const mlon = 111_320 * Math.cos(lat * Math.PI / 180);
  return Math.sqrt((dlat * mlat) ** 2 + (dlon * mlon) ** 2);
}

export function detectProvenanceConflicts(exhibit, evidence){
  const conflicts = [];
  const si  = exhibit.station_inputs || {};
  const ev  = evidence              || exhibit.evidence || {};
  const lms = ev.fcc_lms?.license   || {};
  const asr = ev.asr                || {};
  const hl  = exhibit.haat_lineage  || {};
  const el  = exhibit.erp_lineage   || {};
  const cl  = exhibit.class_lineage || {};
  const fl  = exhibit.frequency_lineage || {};
  const rl  = exhibit.rcamsl_lineage || {};

  // ── 1. ERP ─────────────────────────────────────────────────────────────
  if (el.variance_pct != null && el.variance_pct > 5){
    conflicts.push({
      field:       'erp',
      severity:    'conflict',
      sources:     ['operator_input', 'fcc_lms'],
      values:      { operator: el.proposed_erp_kw, fcc_licensed: el.licensed_erp_kw },
      delta_pct:   el.variance_pct,
      description: `ERP ${el.proposed_erp_kw} kW proposed differs from FCC-licensed ${el.licensed_erp_kw} kW by ${el.variance_pct}%`,
      warning_code:'ERP_VARIANCE_FROM_LICENSE'
    });
  }

  // ── 2. Frequency ────────────────────────────────────────────────────────
  if (Number.isFinite(lms.frequency) && Number.isFinite(si.frequency)){
    const delta = Math.abs(si.frequency - lms.frequency);
    const tol = si.frequency_unit === 'kHz' ? 5 : 0.1;
    if (delta > tol){
      conflicts.push({
        field:       'frequency',
        severity:    'conflict',
        sources:     ['operator_input', 'fcc_lms'],
        values:      { operator: si.frequency, fcc_licensed: lms.frequency },
        delta,
        description: `Frequency ${si.frequency} ${si.frequency_unit || 'MHz'} vs FCC-licensed ${lms.frequency} ${lms.frequency_unit || 'MHz'} (Δ${delta.toFixed(3)})`,
        warning_code:'SOURCE_CONFLICT'
      });
    }
  }

  // ── 3. Coordinates ──────────────────────────────────────────────────────
  const lmsLat = lms.lat ?? null;
  const lmsLon = lms.lon ?? null;
  const asrLat = asr.lat ?? null;
  const asrLon = asr.lon ?? null;
  const siLat  = si.lat  ?? null;
  const siLon  = si.lon  ?? null;

  for (const [refName, refLat, refLon] of [
    ['fcc_lms', lmsLat, lmsLon],
    ['fcc_asr', asrLat, asrLon]
  ]){
    if (refLat != null && refLon != null && siLat != null && siLon != null){
      const dist_m = approxDistM(siLat - refLat, siLon - refLon, siLat);
      if (dist_m > 10){
        conflicts.push({
          field:       'coordinates',
          severity:    'conflict',
          sources:     ['operator_input', refName],
          values:      {
            operator:    { lat: siLat, lon: siLon },
            [refName]:   { lat: refLat, lon: refLon }
          },
          delta_m:     +dist_m.toFixed(1),
          description: `Coordinates differ from ${refName} by ${dist_m.toFixed(0)} m (lat Δ${(siLat - refLat).toFixed(5)}°, lon Δ${(siLon - refLon).toFixed(5)}°)`,
          warning_code:'SOURCE_CONFLICT'
        });
      }
    }
  }

  // ── 4. Tower height AGL ─────────────────────────────────────────────────
  const opH  = si.overall_height_m  ?? null;
  const asrH = asr.overall_height_m ?? null;
  if (opH != null && asrH != null && Math.abs(opH - asrH) > 3){
    conflicts.push({
      field:       'tower_height',
      severity:    'conflict',
      sources:     ['operator_input', 'fcc_asr'],
      values:      { operator: opH, fcc_asr: asrH },
      delta_m:     +Math.abs(opH - asrH).toFixed(1),
      description: `Tower height ${opH} m vs ASR ${asrH} m (Δ${Math.abs(opH - asrH).toFixed(1)} m, threshold 3 m)`,
      warning_code:'SOURCE_CONFLICT'
    });
  }

  // ── 5. RCAMSL ───────────────────────────────────────────────────────────
  if (rl.source === 'derived' && Number.isFinite(rl.value_m) &&
      Number.isFinite(si.overall_height_amsl_m)){
    const delta = Math.abs(si.overall_height_amsl_m - rl.value_m);
    if (delta > 20){
      conflicts.push({
        field:       'rcamsl',
        severity:    'conflict',
        sources:     ['operator_input', 'usgs_dem'],
        values:      { operator: si.overall_height_amsl_m, dem_derived: rl.value_m },
        delta_m:     +delta.toFixed(1),
        description: `RCAMSL operator ${si.overall_height_amsl_m} m vs DEM-derived ${rl.value_m} m (Δ${delta.toFixed(1)} m, threshold 20 m)`,
        warning_code:'SOURCE_CONFLICT'
      });
    }
  }

  // ── 6. FCC class ────────────────────────────────────────────────────────
  if (cl.raw && cl.licensed_class &&
      String(cl.raw).toUpperCase() !== String(cl.licensed_class).toUpperCase()){
    conflicts.push({
      field:       'fcc_class',
      severity:    'conflict',
      sources:     ['operator_input', 'fcc_lms'],
      values:      { operator: cl.raw, fcc_licensed: cl.licensed_class },
      description: `FCC class "${cl.raw}" (operator) vs "${cl.licensed_class}" (FCC LMS)`,
      warning_code:'SOURCE_CONFLICT'
    });
  }

  // ── 7. HAAT ─────────────────────────────────────────────────────────────
  // >50 % relative delta between operator and terrain-derived (§73.313)
  const opHaat      = hl.operator_entered_m ?? null;
  const terrainHaat = hl.terrain_mean_m     ?? null;
  if (opHaat != null && terrainHaat != null && terrainHaat !== 0){
    const pct = pctDiff(opHaat, terrainHaat);
    if (pct > 50){
      conflicts.push({
        field:       'haat',
        severity:    'review',
        sources:     ['operator_input', 'usgs_dem'],
        values:      { operator: opHaat, terrain_mean: terrainHaat },
        delta_pct:   +pct.toFixed(1),
        description: `HAAT operator ${opHaat} m vs terrain-derived ${terrainHaat.toFixed(1)} m (${pct.toFixed(0)}% relative delta, threshold 50%)`,
        warning_code:'SOURCE_CONFLICT'
      });
    }
  }

  return conflicts;
}
