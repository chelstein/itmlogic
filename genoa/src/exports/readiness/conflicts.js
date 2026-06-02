// Conflict engine — detects when two authoritative sources give different values
// for the same field. Never silently picks one.

function dotGet(obj, path) {
  if (!obj || !path) return undefined;
  return path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
}

function meanOf(arr) {
  if (!arr || arr.length === 0) return null;
  const sum = arr.reduce((s, v) => s + v, 0);
  return sum / arr.length;
}

function pctDiff(a, b) {
  const denom = Math.abs(b) || Math.abs(a);
  if (denom === 0) return 0;
  return (Math.abs(a - b) / denom) * 100;
}

export function detectFieldConflicts(exhibit) {
  const conflicts = [];
  const si = exhibit.station_inputs ?? {};
  const ev = exhibit.evidence ?? {};
  const fm = exhibit.facility_metadata?.raw ?? {};

  // ── 1. HAAT ────────────────────────────────────────────────────────────────

  const operatorHaatPath = si.haat_m_input != null ? 'station_inputs.haat_m_input' : 'station_inputs.haat_m';
  const operatorHaat = si.haat_m_input ?? si.haat_m ?? null;
  const radials = ev.terrain_haat_per_radial ?? [];
  const terrainHaat = meanOf(radials.map(r => r.haat_computed_m).filter(v => v != null));

  if (operatorHaat != null && terrainHaat != null) {
    const pct = pctDiff(operatorHaat, terrainHaat);
    if (pct > 20) {
      conflicts.push({
        field: 'haat-m',
        label: 'HAAT above average terrain',
        values: [
          {
            path: operatorHaatPath,
            value: operatorHaat,
            source_system: 'operator-input',
          },
          {
            path: 'evidence.terrain_haat_per_radial[].mean',
            value: terrainHaat,
            source_system: 'terrain-sidecar',
          },
        ],
        winning_source: operatorHaatPath,
        winning_reason: 'Operator-supplied filing HAAT takes precedence for FCC filing; terrain-derived is advisory',
        confidence: 'HIGH',
        conflict_reason: `Filed HAAT (${operatorHaat}m) differs from terrain-derived advisory HAAT (${terrainHaat.toFixed(1)}m) by ${pct.toFixed(0)}%`,
      });
    }
  }

  // ── 2. Tower height ────────────────────────────────────────────────────────

  const stationHeight = si.overall_height_m ?? null;
  const asrHeight = ev.asr?.overall_height_m ?? null;

  if (stationHeight != null && asrHeight != null) {
    const pct = pctDiff(stationHeight, asrHeight);
    if (pct > 5) {
      conflicts.push({
        field: 'tower-overall-height-agl-m',
        label: 'Tower overall height AGL',
        values: [
          {
            path: 'station_inputs.overall_height_m',
            value: stationHeight,
            source_system: 'operator-input',
          },
          {
            path: 'evidence.asr.overall_height_m',
            value: asrHeight,
            source_system: 'FCC-ASR',
          },
        ],
        winning_source: 'evidence.asr.overall_height_m',
        winning_reason: 'FCC ASR is authoritative for registered tower height',
        confidence: 'HIGH',
        conflict_reason: `Station inputs height (${stationHeight}m) differs from ASR height (${asrHeight}m) by ${pct.toFixed(1)}%`,
      });
    }
  }

  // ── 3. Coordinates ─────────────────────────────────────────────────────────

  const siLat = si.lat ?? null;
  const siLon = si.lon ?? null;
  const fmLat = fm.latitude ?? fm.lat ?? null;
  const fmLon = fm.longitude ?? fm.lon ?? null;

  if (siLat != null && siLon != null && fmLat != null && fmLon != null) {
    const latDiff = Math.abs(siLat - fmLat);
    const lonDiff = Math.abs(siLon - fmLon);
    if (latDiff > 0.001 || lonDiff > 0.001) {
      conflicts.push({
        field: 'coordinates-nad83',
        label: 'Station coordinates (NAD83)',
        values: [
          {
            path: 'station_inputs.{lat,lon}',
            value: { lat: siLat, lon: siLon },
            source_system: 'operator-input',
          },
          {
            path: 'facility_metadata.raw.{lat,lon}',
            value: { lat: fmLat, lon: fmLon },
            source_system: 'FCC-LMS',
          },
        ],
        winning_source: 'station_inputs.{lat,lon}',
        winning_reason: 'Operator-input coordinates are used for the filing; facility metadata is reference only',
        confidence: 'MEDIUM',
        conflict_reason: `Coordinates differ: station_inputs (${siLat}, ${siLon}) vs facility_metadata (${fmLat}, ${fmLon}) — lat Δ${latDiff.toFixed(4)}°, lon Δ${lonDiff.toFixed(4)}°`,
      });
    }
  }

  // ── 4. ERP ─────────────────────────────────────────────────────────────────

  const erpSources = [];
  if (si.erp_kw != null) {
    erpSources.push({ path: 'station_inputs.erp_kw', value: si.erp_kw, source_system: 'operator-input' });
  }
  if (fm.erp_kw != null) {
    erpSources.push({ path: 'facility_metadata.raw.erp_kw', value: fm.erp_kw, source_system: 'FCC-LMS' });
  }
  if (ev.fcc_lms?.erp_kw != null) {
    erpSources.push({ path: 'evidence.fcc_lms.erp_kw', value: ev.fcc_lms.erp_kw, source_system: 'FCC-LMS' });
  }

  if (erpSources.length >= 2) {
    let erpConflict = false;
    for (let i = 0; i < erpSources.length; i++) {
      for (let j = i + 1; j < erpSources.length; j++) {
        if (pctDiff(erpSources[i].value, erpSources[j].value) > 5) {
          erpConflict = true;
        }
      }
    }
    if (erpConflict) {
      const vals = erpSources.map(s => `${s.source_system}=${s.value}kW`).join(', ');
      conflicts.push({
        field: 'erp-kw-horizontal',
        label: 'ERP horizontal (kW)',
        values: erpSources,
        winning_source: 'station_inputs.erp_kw',
        winning_reason: 'Operator-supplied ERP is the authoritative filed value',
        confidence: 'HIGH',
        conflict_reason: `ERP values disagree across sources: ${vals}`,
      });
    }
  }

  // ── 5. Frequency ───────────────────────────────────────────────────────────

  const siFreq = si.frequency ?? null;
  const fmFreq = fm.frequency ?? null;

  if (siFreq != null && fmFreq != null) {
    if (Math.abs(siFreq - fmFreq) > 0.1) {
      conflicts.push({
        field: 'frequency-mhz',
        label: 'Frequency (MHz)',
        values: [
          {
            path: 'station_inputs.frequency',
            value: siFreq,
            source_system: 'operator-input',
          },
          {
            path: 'facility_metadata.raw.frequency',
            value: fmFreq,
            source_system: 'FCC-LMS',
          },
        ],
        winning_source: 'station_inputs.frequency',
        winning_reason: 'Operator-supplied frequency is the authoritative filed value',
        confidence: 'HIGH',
        conflict_reason: `Frequency mismatch: station_inputs ${siFreq} MHz vs facility_metadata ${fmFreq} MHz (Δ${Math.abs(siFreq - fmFreq).toFixed(2)} MHz)`,
      });
    }
  }

  return conflicts;
}
