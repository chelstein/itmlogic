// Appendices — radial data, interference study, validation evidence,
// provenance, replay bundle.
//
// Each appendix is emitted as its own section so the renderer can place
// page breaks between them and renderText.js can put each on its own page.

export function buildAppendixSections(exhibit){
  const sections = [];

  // ── Appendix A — Radial data table ─────────────────────────────────
  const rt = Array.isArray(exhibit.radial_table) ? exhibit.radial_table : [];
  if (rt.length){
    const contourIds = new Set();
    for (const r of rt){
      const cd = r.contour_distances_km || {};
      for (const id of Object.keys(cd)) contourIds.add(id);
    }
    const cidList = Array.from(contourIds);
    const columns = [
      { key: 'azimuth_deg', label: 'Az (°)',     width: 0.10, align: 'right' },
      { key: 'haat_m',      label: 'HAAT (m)',   width: 0.14, align: 'right' },
      { key: 'erp_kw',      label: 'ERP (kW)',   width: 0.14, align: 'right' }
    ];
    const widthPerContour = Math.max(0.08, (1 - 0.38) / Math.max(1, cidList.length));
    for (const id of cidList){
      columns.push({ key: `c_${id}`, label: `${id} (km)`, width: widthPerContour, align: 'right' });
    }

    // Build a per-azimuth HAAT lookup from evidence.terrain_haat_per_radial.
    // The engine emits the radial_table with azimuth_deg + contour_distances_km
    // but doesn't always echo HAAT/ERP per-radial.  We can recover both:
    //   - HAAT: from the terrain compute (per-radial DEM sampling, §73.313)
    //   - ERP: station-wide ERP for ND antennas, or ERP × (rel_field)² for DA
    //          (the antenna pattern table is keyed by azimuth degree).
    const perRadialHaat = Array.isArray(exhibit.evidence?.terrain_haat_per_radial)
      ? exhibit.evidence.terrain_haat_per_radial
      : [];
    const haatByAz = new Map();
    for (const r of perRadialHaat){
      const az = Number(r?.az ?? r?.azimuth_deg);
      const h  = Number(r?.haat_computed_m ?? r?.haat_m);
      if (Number.isFinite(az) && Number.isFinite(h)) haatByAz.set(Math.round(az), h);
    }
    const stationErp = Number(exhibit.station_inputs?.erp_kw);
    const pattern = Array.isArray(exhibit.station_inputs?.pattern)
      ? exhibit.station_inputs.pattern
      : null;
    const erpByAz = new Map();
    if (pattern && Number.isFinite(stationErp)){
      for (const [az, relField] of pattern){
        const a = Math.round(Number(az));
        const f = Number(relField);
        if (Number.isFinite(a) && Number.isFinite(f)) erpByAz.set(a, stationErp * f * f);
      }
    }

    const rows = rt.map(r => {
      const az = Number.isFinite(r.azimuth_deg) ? Number(r.azimuth_deg) : null;
      const azKey = az != null ? Math.round(az) : null;
      const haat  = Number.isFinite(r.haat_m) ? Number(r.haat_m)
                  : (azKey != null && haatByAz.has(azKey) ? haatByAz.get(azKey) : null);
      const erp   = Number.isFinite(r.erp_kw) ? Number(r.erp_kw)
                  : (azKey != null && erpByAz.has(azKey) ? erpByAz.get(azKey)
                  : (Number.isFinite(stationErp) && !pattern ? stationErp : null));
      const row = {
        azimuth_deg: az != null  ? az.toFixed(1)   : '—',
        haat_m:      haat != null ? haat.toFixed(1) : '—',
        erp_kw:      erp != null  ? erp.toFixed(3)  : '—'
      };
      const cd = r.contour_distances_km || {};
      for (const id of cidList){
        row[`c_${id}`] = Number.isFinite(cd[id]) ? Number(cd[id]).toFixed(2) : '—';
      }
      return row;
    });
    sections.push({
      id:      'appendix-a',
      type:    'table',
      heading: 'APPENDIX A — RADIAL DATA',
      preface: 'Per-radial HAAT, ERP, and contour distances.  Radial step shown in METHODOLOGY.  ' +
               (pattern ? 'ERP per radial computed from filed pattern table (ERP × (relative field)² per §73.316).'
                        : 'Non-directional antenna; ERP constant across all azimuths.'),
      table:   { columns, rows }
    });
  }

  // ── Appendix B — Interference study ─────────────────────────────────────
  const isr = exhibit.interference_study;
  if (isr && Array.isArray(isr.stations)){
    // Lookup index for nearby_primaries (orchestrator side) so we can
    // fill Class + Freq + station-meta even when the engine's
    // interference_study.stations row only carries call/facility_id.
    // Indexed by both call and facility_id; either key resolves.
    const nearby = Array.isArray(exhibit.evidence?.nearby_primaries)
      ? exhibit.evidence.nearby_primaries : [];
    const byCall = new Map();
    const byFid  = new Map();
    for (const n of nearby){
      if (n?.call)        byCall.set(String(n.call).toUpperCase(), n);
      if (n?.facility_id) byFid.set(String(n.facility_id), n);
    }
    const lookupNearby = (s) => {
      if (s?.call && byCall.has(String(s.call).toUpperCase())) return byCall.get(String(s.call).toUpperCase());
      if (s?.facility_id && byFid.has(String(s.facility_id)))  return byFid.get(String(s.facility_id));
      return null;
    };
    const rows = isr.stations.map(s => {
      const n = lookupNearby(s) || {};
      // Class — try every shape both upstreams have used.
      const fccClass = s.class || s.fcc_class || s.station_class
                    || n.class || n.fcc_class || n.station_class
                    || n.facility_class || null;
      // Frequency — prefer the engine's already-MHz value, fall back to
      // nearby_primaries' frequency / frequency_mhz (FMQ stores as MHz).
      const freq = Number.isFinite(s.frequency_mhz) ? Number(s.frequency_mhz)
                : Number.isFinite(s.frequency)      ? Number(s.frequency)
                : Number.isFinite(n.frequency_mhz)  ? Number(n.frequency_mhz)
                : Number.isFinite(n.frequency)      ? Number(n.frequency)
                : null;
      return {
        call:               s.call || n.call || s.facility_id || '—',
        facility_id:        s.facility_id || n.facility_id || '—',
        fcc_class:          fccClass || '—',
        frequency_mhz:      freq != null ? freq.toFixed(1) : '—',
        relationship:       s.relationship || '—',
        distance_km:        Number.isFinite(s.distance_km) ? Number(s.distance_km).toFixed(2) : '—',
        rule_207:           s.section_73_207?.pass === true ? 'PASS'
                              : s.section_73_207?.pass === false ? 'FAIL'
                              : (s.section_73_207?.skipped ? 'skip' : '—'),
        rule_215:           s.section_73_215?.pair_pass === true ? 'PASS'
                              : s.section_73_215?.pair_pass === false ? 'FAIL'
                              : (s.section_73_215?.skipped ? 'skip' : '—'),
        pair_pass:          s.pair_pass === true ? 'PASS' : s.pair_pass === false ? 'FAIL' : '—'
      };
    });
    sections.push({
      id:      'appendix-b',
      type:    'table-with-summary',
      heading: 'APPENDIX B — INTERFERENCE STUDY',
      preface: 'Consolidated per-pair evaluation under 47 CFR §73.207, §73.215, §74.1204, and §73.187 as applicable.',
      table: {
        columns: [
          { key: 'call',           label: 'Call',         width: 0.10 },
          { key: 'facility_id',    label: 'Facility ID',  width: 0.10 },
          { key: 'fcc_class',      label: 'Class',        width: 0.07 },
          { key: 'frequency_mhz',  label: 'Freq (MHz)',   width: 0.10, align: 'right' },
          { key: 'relationship',   label: 'Relationship', width: 0.13 },
          { key: 'distance_km',    label: 'Dist (km)',    width: 0.10, align: 'right' },
          { key: 'rule_207',       label: '§73.207',      width: 0.10 },
          { key: 'rule_215',       label: '§73.215',      width: 0.10 },
          { key: 'pair_pass',      label: 'Pair',         width: 0.10 }
        ],
        rows
      },
      summary: `Filing qualifies: ${isr.filing_qualifies === true ? 'YES'
                : isr.filing_qualifies === false ? 'NO' : 'INDETERMINATE'} ` +
               `(${isr.n_pass || 0} pass / ${isr.n_fail || 0} fail of ${isr.n_stations || rows.length} stations evaluated).`
    });
  }

  // ── Appendix C — Validation evidence ───────────────────────────────────
  const v   = exhibit.validation_context || {};
  const ev  = exhibit.evidence || {};
  const cRows = [
    ['Curve dataset',           exhibit.method_versions?.dataset           || '—'],
    ['Curve dataset SHA-256',   exhibit.method_versions?.dataset_meta_sha256 || '—'],
    ['Curve engine',            exhibit.method_versions?.curve_engine      || '—'],
    ['FCC orchestration commit', exhibit.method_versions?.fcc_orchestration?.commit || '—'],
    ['Curve validation',        v.curve_reference_validation
                                  ? `${v.curve_reference_validation.n_pass || 0}/${v.curve_reference_validation.n_run || 0} cases pass`
                                  : 'not run'],
    ['FCC contour cross-check', v.fcc_cross_check
                                  ? (v.fcc_cross_check.detail || v.fcc_cross_check.message
                                      || `${v.fcc_cross_check.n_pass || 0}/${v.fcc_cross_check.n_run || 0} radials within tolerance`)
                                  : 'not attached'],
    ['FCC parity (live)',       ev.fcc_parity_report?.available
                                  ? `${ev.fcc_parity_report.n_pass}/${ev.fcc_parity_report.n_samples} samples within tolerance`
                                  : 'opt-in (not requested)']
  ];
  sections.push({
    id:      'appendix-c',
    type:    'kv',
    heading: 'APPENDIX C — VALIDATION EVIDENCE',
    rows:    cRows
  });

  // ── Appendix D — Provenance ──────────────────────────────────────────────
  const prov = exhibit.provenance || {};
  const dRows = [
    ['Engine version',     prov.engine_version || prov.version || '—'],
    ['Engine commit',      prov.git_commit || prov.commit || '—'],
    ['Build timestamp',    prov.build_time || prov.built_at || '—'],
    ['Compute timestamp',  exhibit.computed_at || prov.computed_at || '—'],
    ['Exhibit hash',       prov.exhibit_hash || exhibit.hash || '—'],
    ['Replay bundle hash', prov.replay_bundle_hash || '—'],
    ['DEM dataset',        ev.terrain?.dem?.dataset || ev.terrain?.dem?.source || '—'],
    ['DEM commit',         ev.terrain?.dem?.commit || ev.terrain?.dem?.version || '—']
  ];
  sections.push({
    id:      'appendix-d',
    type:    'kv',
    heading: 'APPENDIX D — PROVENANCE',
    rows:    dRows
  });

  // ── Appendix E — Replay bundle ───────────────────────────────────────
  const replay = exhibit.replay_bundle || prov.replay_bundle || null;
  const eRows = [
    ['Replay bundle available', replay ? 'YES' : 'NO'],
    ['Bundle hash',             prov.replay_bundle_hash || (replay && replay.hash) || '—'],
    ['Reproduction command',    'genoa replay <bundle.json>  (deterministic; same inputs → same outputs)']
  ];
  sections.push({
    id:      'appendix-e',
    type:    'kv',
    heading: 'APPENDIX E — REPLAY BUNDLE',
    rows:    eRows
  });

  return sections;
}
