// Facility parameters — inputs to the propagation study.

export function buildFacilityParametersSection(exhibit){
  const s = exhibit.station_inputs || {};
  const ev = exhibit.evidence || {};
  const fmt = (v, suffix = '', dash = '—') => {
    if (v === null || v === undefined || v === '') return dash;
    return suffix ? `${v} ${suffix}`.trim() : String(v);
  };
  const channel = s.service === 'AM'
    ? null
    : (Number.isFinite(Number(s.frequency)) ? Math.round((Number(s.frequency) - 87.9) / 0.2 + 200) : null);

  // HAAT fallback: when the operator didn't type a filed HAAT, fall
  // back to the per-radial DEM compute we just performed.  Average of
  // the per-radial HAAT array (already conformant to §73.313(d)) is
  // the correct "average HAAT" for the facility-parameters table.
  const perRadial = Array.isArray(ev.terrain_haat_per_radial) ? ev.terrain_haat_per_radial : null;
  const haatAvgFromRadials = perRadial && perRadial.length
    ? perRadial.reduce((a, r) => a + (Number(r.haat_m) || 0), 0) / perRadial.length
    : null;
  const haatDisplay = (s.haat_m != null && s.haat_m !== '')
    ? s.haat_m
    : (Number.isFinite(ev.terrain?.haat_m) ? ev.terrain.haat_m
       : Number.isFinite(haatAvgFromRadials) ? Number(haatAvgFromRadials.toFixed(1))
       : null);

  const lat_dms  = Number.isFinite(Number(s.lat)) ? toDms(Number(s.lat), 'lat') : null;
  const lon_dms  = Number.isFinite(Number(s.lon)) ? toDms(Number(s.lon), 'lon') : null;
  const coordRow = (Number.isFinite(Number(s.lat)) && Number.isFinite(Number(s.lon)))
    ? `${Number(s.lat).toFixed(6)}, ${Number(s.lon).toFixed(6)}  (${lat_dms}, ${lon_dms})`
    : '—';

  return {
    id:      'parameters',
    type:    'kv',
    heading: 'FACILITY PARAMETERS',
    rows: [
      ['Frequency',           fmt(s.frequency, s.frequency_unit || (s.service === 'AM' ? 'kHz' : 'MHz'))],
      channel != null ? ['Channel', String(channel)] : null,
      ['ERP',                 fmt(s.erp_kw, 'kW')],
      ['HAAT',                fmt(haatDisplay, 'm')],
      ['Coordinates (NAD83 / WGS-84)', coordRow],
      ['Antenna pattern',     s.pattern_mode === 'DA' ? 'Directional (per pattern_table)' : 'Non-directional'],
      ['Radial resolution',   fmt(s.radial_step_deg || 10, '° step')],
      ['Terrain source',      ev.terrain?.source || (ev.terrain_haat_per_radial?.length ? 'per-radial DEM' : 'flat HAAT (CONSTANT_HAAT_ASSUMED)')],
      ['Facility source',     exhibit.facility_metadata?.source
                              || (exhibit.station_inputs?.facility_id ? 'operator-supplied facility_id' : 'inputs only')]
    ].filter(Boolean)
  };
}

function toDms(deg, kind){
  const sign = deg < 0 ? -1 : 1;
  const abs = Math.abs(deg);
  const d = Math.floor(abs);
  const minF = (abs - d) * 60;
  const m = Math.floor(minF);
  const s = (minF - m) * 60;
  const hemi = kind === 'lat' ? (sign < 0 ? 'S' : 'N') : (sign < 0 ? 'W' : 'E');
  return `${d}° ${m}' ${s.toFixed(2)}" ${hemi}`;
}
