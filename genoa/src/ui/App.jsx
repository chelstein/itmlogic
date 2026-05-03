import React, { useEffect, useMemo, useRef, useState } from 'react';
import AppShell      from '@components/ui/AppShell.jsx';
import RackPanel     from '@components/ui/RackPanel.jsx';
import FacilityRack  from '@components/ui/FacilityRack.jsx';
import ChartScope    from '@components/ui/ChartScope.jsx';
import TelemetryRack from '@components/ui/TelemetryRack.jsx';
import TabStrip      from '@components/ui/TabStrip.jsx';
import HardwareButton from '@components/ui/HardwareButton.jsx';

/* =========================================================================
   App.jsx — orchestrates inputs, /api/exhibits/compute, /api/facilities/*,
   exports, history, and Leaflet rendering.  Engine is server-side; this
   component never does FCC math.
   ========================================================================= */

const PRESET_SYNTHETIC = {
  call:'WBOB-FM', facility_id:'12345', service:'FM', fcc_class:'A',
  frequency:98.7, erp_kw:6.0, haat_m:100,
  lat:37.0902, lon:-95.7129,
  ground_sigma_mS_m: 8,
  radial_step_deg: 10,
  pattern_mode: 'ND'
};

const PRESET_KSLX = {
  call:'KSLX-FM', facility_id:'11282', service:'FM', fcc_class:'C',
  frequency:100.7, erp_kw:100, haat_m:561,
  lat:'', lon:'',
  ground_sigma_mS_m: 8,
  radial_step_deg: 10,
  pattern_mode: 'ND',
  _resolveFacility: true
};

const TABS = [
  { id: 'fcc',        label: 'FCC method' },
  { id: 'radials',    label: 'Radials' },
  { id: 'evidence',   label: 'Evidence' },
  { id: 'validation', label: 'Validation' },
  { id: 'provenance', label: 'Provenance' },
  { id: 'narrative',  label: 'AI narrative' },
  { id: 'exports',    label: 'Exports' },
  { id: 'history',    label: 'History' }
];

const CONTOUR_COLORS = ['#ffb347', '#d6a36a', '#6fd3ff'];

export default function App() {
  const [inputs, setInputs] = useState(PRESET_SYNTHETIC);
  const [exhibit, setExhibit] = useState(null);
  const [computing, setComputing] = useState(false);
  const [busy, setBusy]           = useState(false);
  const [statusMsg, setStatusMsg] = useState('Ready · click Compute exhibit');
  const [facilitySource, setFacilitySource] = useState('');
  const [activeTab, setActiveTab] = useState('fcc');
  const [history, setHistory]     = useState([]);

  const onChange = (k, v) => setInputs(s => ({ ...s, [k]: v }));

  /* ---------------- FACILITY LOOKUP ---------------- */

  async function lookupFacility(id){
    if (!id){ setFacilitySource('Enter a Facility ID first.'); return null; }
    setFacilitySource('Looking up…');
    try {
      const r = await fetch(`/api/facilities/${encodeURIComponent(id)}`);
      if (r.status === 503){
        const j = await r.json().catch(() => ({}));
        setFacilitySource(`FACILITY_LOOKUP_UNAVAILABLE — ${j.warning?.detail || 'no upstream configured'}`);
        return null;
      }
      if (r.status === 404){
        setFacilitySource(`Facility ${id} not found in upstream.`);
        return null;
      }
      if (!r.ok){
        const j = await r.json().catch(() => ({}));
        setFacilitySource(`Lookup failed (${r.status}): ${j.message || j.error || ''}`);
        return null;
      }
      const j = await r.json();
      // Apply only to missing fields — never overwrite caller input.
      const f = j.facility || {};
      setInputs(prev => {
        const fill = (k, v) => (prev[k] === undefined || prev[k] === '' || prev[k] === null) ? v : prev[k];
        return {
          ...prev,
          call:        fill('call',        f.call),
          facility_id: fill('facility_id', f.facility_id),
          service:     fill('service',     f.service),
          fcc_class:   fill('fcc_class',   f.fcc_class),
          frequency:   fill('frequency',   f.frequency),
          erp_kw:      fill('erp_kw',      f.erp_kw),
          haat_m:      fill('haat_m',      f.haat_m),
          lat:         fill('lat',         f.lat),
          lon:         fill('lon',         f.lon)
        };
      });
      const cacheTag = j.cached ? ' (cached)' : '';
      setFacilitySource(`Resolved via ${j.source}${cacheTag}`);
      return f;
    } catch (e){
      setFacilitySource(`Lookup failed: ${e.message}`);
      return null;
    }
  }

  /* ---------------- COMPUTE ---------------- */

  async function compute(){
    setComputing(true);
    setStatusMsg(inputs.use_terrain
      ? 'Computing… (DEM fetch may take ~30s on cold cache)'
      : 'Computing…');
    try {
      const payload = {
        inputs: {
          ...inputs,
          // Re-cast string inputs to numbers where the engine expects them.
          frequency:         num(inputs.frequency),
          erp_kw:            num(inputs.erp_kw),
          haat_m:            num(inputs.haat_m),
          lat:               num(inputs.lat),
          lon:               num(inputs.lon),
          ground_sigma_mS_m: num(inputs.ground_sigma_mS_m),
          radial_step_deg:   num(inputs.radial_step_deg) || 10,
          // Pass DA pattern only when the user toggled it on.
          pattern_table: inputs.pattern_mode === 'DA' ? inputs.pattern_table : null
        },
        options: {
          use_terrain: !!inputs.use_terrain
        }
      };
      const r = await fetch('/api/exhibits/compute', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body:    JSON.stringify(payload)
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || j.message || `HTTP ${r.status}`);
      setExhibit(j);
      const fr = j.filing_readiness || {};
      setStatusMsg(j.degraded_mode
        ? `Computed in degraded mode · ${fr.score}/100 (${fr.status}) · ${j.warnings.length} warning(s), ${j.blockers.length} blocker(s).`
        : `Computed cleanly · ${fr.score}/100 (${fr.status}).`);
    } catch (e){
      setStatusMsg(`Compute failed: ${e.message}`);
    } finally { setComputing(false); }
  }

  /* ---------------- PRESETS ---------------- */

  async function loadKslx(){
    setInputs(PRESET_KSLX);
    if (PRESET_KSLX._resolveFacility){
      await lookupFacility(PRESET_KSLX.facility_id);
    }
    setTimeout(compute, 0);
  }
  function loadSynthetic(){
    setInputs(PRESET_SYNTHETIC);
    setFacilitySource('');
    setTimeout(compute, 0);
  }
  function reset(){
    setInputs(PRESET_SYNTHETIC);
    setExhibit(null);
    setFacilitySource('');
    setStatusMsg('Reset.');
  }

  /* ---------------- SAVE / EXPORT ---------------- */

  async function save(){
    if (!exhibit){ setStatusMsg('Run a compute first.'); return; }
    setBusy(true);
    try {
      const r = await fetch('/api/exhibits', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body:    JSON.stringify(exhibit)
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      setExhibit(prev => ({ ...prev, id: j.id }));
      setStatusMsg(`Saved exhibit #${j.id}`);
    } catch (e){
      setStatusMsg(`Save failed: ${e.message}`);
    } finally { setBusy(false); }
  }

  function downloadExport(format){
    if (!exhibit){ setStatusMsg('Run a compute first.'); return; }
    if (!exhibit.id){
      // stateless: synthesize from in-memory exhibit
      const map = {
        json:    () => [JSON.stringify(exhibit, null, 2),         'application/json',     'exhibit.json'],
        geojson: () => [JSON.stringify(exhibit.geojson, null, 2), 'application/geo+json', 'contours.geojson']
      };
      const fn = map[format];
      if (!fn){ setStatusMsg('TXT export requires a saved exhibit; click Save first.'); return; }
      const [body, type, suffix] = fn();
      const blob = new Blob([body], { type });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${(exhibit.station_inputs?.call || 'exhibit').replace(/[^A-Z0-9]/gi,'_')}_${suffix}`;
      a.click();
      return;
    }
    window.location = `/api/exhibits/${exhibit.id}/export/${format}`;
  }

  /* ---------------- HISTORY ---------------- */

  async function loadHistory(){
    try {
      const r = await fetch('/api/exhibits');
      if (!r.ok){ setHistory([]); return; }
      const rows = await r.json();
      setHistory(Array.isArray(rows) ? rows : []);
    } catch { setHistory([]); }
  }
  useEffect(() => {
    if (activeTab === 'history') loadHistory();
  }, [activeTab]);

  /* ---------------- LEAFLET MAP ---------------- */
  const mapEl   = useRef(null);
  const mapRef  = useRef({ map: null, layers: [], txMarker: null });
  useEffect(() => { return () => { try { mapRef.current.map?.remove(); } catch {} }; }, []);
  useEffect(() => {
    if (!exhibit) return;
    if (typeof window.L === 'undefined') return;
    const s = exhibit.station_inputs || {};
    const lat = Number(s.lat);
    const lon = Number(s.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;

    const L = window.L;
    if (!mapRef.current.map){
      mapRef.current.map = L.map(mapEl.current, { zoomControl: true, attributionControl: true })
        .setView([lat, lon], 8);
      L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        maxZoom: 19,
        attribution: '© OpenStreetMap · © CARTO · DEM via SPLAT/itmlogic'
      }).addTo(mapRef.current.map);
    }
    const map = mapRef.current.map;

    // clear previous polygons + tx marker
    for (const l of mapRef.current.layers) map.removeLayer(l);
    mapRef.current.layers = [];
    if (mapRef.current.txMarker) map.removeLayer(mapRef.current.txMarker);

    mapRef.current.txMarker = L.circleMarker([lat, lon], {
      radius: 6, color: '#ffb347', weight: 2, fillColor: '#ff7a2f', fillOpacity: 0.95
    }).bindPopup(`<b>${escapeHtml(s.call || '—')}</b><br/>${escapeHtml(s.service || '')} · ${s.frequency ?? '—'} ${escapeHtml(s.frequency_unit || '')}<br/>ERP ${s.erp_kw ?? '—'} kW · HAAT ${s.haat_m_input ?? '—'} m`).addTo(map);

    const polys = (exhibit.polygons || []).filter(p => p.closed && p.ring_latlng?.length);
    polys.forEach((p, i) => {
      const color = CONTOUR_COLORS[i] || '#9fdcb1';
      const layer = L.polygon(p.ring_latlng, {
        color, weight: i === 0 ? 2.5 : 1.5, opacity: 0.92,
        fillColor: color, fillOpacity: i === 0 ? 0.14 : 0.06,
        dashArray: i > 0 ? '4,5' : null
      }).bindPopup(`<b>${escapeHtml(p.label || '')}</b><br/>${p.field_strength?.value ?? '—'} ${escapeHtml(p.field_strength?.unit || '')}<br/>mean radial ${(p.mean_radial_km || 0).toFixed(1)} km`);
      layer.addTo(map);
      mapRef.current.layers.push(layer);
    });
    const allPts = polys.flatMap(p => p.ring_latlng || []);
    if (allPts.length) map.fitBounds(L.latLngBounds(allPts).pad(0.15));
    map.invalidateSize();
  }, [exhibit]);

  /* ---------------- RENDER ---------------- */

  const fr        = exhibit?.filing_readiness;
  const sysStatus = !exhibit ? 'offline'
                  : (exhibit.blockers?.length ? 'blocked'
                  : (exhibit.degraded_mode    ? 'degraded' : 'nominal'));

  const legend = (exhibit?.polygons || []).map((p, i) => ({
    color: CONTOUR_COLORS[i] || '#9fdcb1',
    label: p.label
  }));

  const mapCaption = (() => {
    const s = exhibit?.station_inputs;
    if (!s) return 'Compute an exhibit to project contours.';
    if (s.lat == null || s.lon == null){
      return 'Map unavailable — facility coordinates missing. Radial table is still computed; see the Radials tab.';
    }
    return 'Deterministic FCC contour map. Contour fills warm → cool from city grade to protected.';
  })();

  return (
    <AppShell
      systemStatus={sysStatus}
      mode={exhibit?.calculation_method?.name || '47 CFR §73.333 F(50,50)'}
      engineVersion={`genoa-engine v${exhibit?.engine_signature?.version || '2.0.0'}`}
      readinessScore={fr?.score ?? null}
      readinessStatus={fr?.status || null}
      commitSha={exhibit?.engine_signature?.hash || 'uncommitted'}
      left={(
        <FacilityRack
          inputs={inputs}
          onChange={onChange}
          onCompute={compute}
          onReset={reset}
          onSave={save}
          onExport={downloadExport}
          onLookupFid={() => lookupFacility(inputs.facility_id)}
          onLoadKslx={loadKslx}
          onLoadSynthetic={loadSynthetic}
          facilitySource={facilitySource}
          computing={computing}
          busy={busy}
        />
      )}
      center={(
        <>
          <ChartScope
            mode={exhibit?.calculation_method?.name || '47 CFR §73.333 F(50,50)'}
            status={statusMsg}
            caption={mapCaption}
            legend={legend}
          >
            <div ref={mapEl} className="absolute inset-0 rounded-md" />
          </ChartScope>

          <RackPanel eyebrow="Workbench" title="Exhibit detail" italicAccent="The numbers come from the engine.">
            <TabStrip tabs={TABS} activeId={activeTab} onChange={setActiveTab} />
            <div className="pt-4">
              <TabBody id={activeTab} exhibit={exhibit} history={history} onPickHistory={pickHistory} />
            </div>
          </RackPanel>
        </>
      )}
      right={<TelemetryRack exhibit={exhibit} />}
    />
  );

  async function pickHistory(id){
    try {
      const r = await fetch(`/api/exhibits/${id}`);
      const x = await r.json();
      if (!r.ok) throw new Error(x.error || 'load failed');
      setExhibit(x.payload);
      const s = x.payload.station_inputs || {};
      setInputs(prev => ({ ...prev, ...s, pattern_mode: Array.isArray(s.pattern) ? 'DA' : 'ND' }));
      setStatusMsg(`Loaded exhibit #${id}`);
    } catch (e){ setStatusMsg(`Load failed: ${e.message}`); }
  }
}

/* ---------------- Tab body content ---------------- */

function TabBody({ id, exhibit, history, onPickHistory }){
  if (id === 'fcc'){
    return <PaneFcc exhibit={exhibit} />;
  }
  if (id === 'radials'){
    return <PaneRadials exhibit={exhibit} />;
  }
  if (id === 'evidence'){
    return <PaneEvidence exhibit={exhibit} />;
  }
  if (id === 'validation'){
    return <PaneValidation exhibit={exhibit} />;
  }
  if (id === 'narrative'){
    return <PaneNarrative exhibit={exhibit} />;
  }
  if (id === 'provenance'){
    return <PaneProvenance exhibit={exhibit} />;
  }
  if (id === 'exports'){
    return <PaneExports exhibit={exhibit} />;
  }
  if (id === 'history'){
    return <PaneHistory rows={history} onPick={onPickHistory} />;
  }
  return null;
}

function PaneFcc({ exhibit }){
  if (!exhibit) return <Empty/>;
  const s   = exhibit.station_inputs || {};
  const m   = exhibit.calculation_method || {};
  const ip  = exhibit.interpolation || {};
  const tr  = exhibit.calculation_trace || {};
  const trS = tr[Object.keys(tr)[0]] || {};
  const rows = [
    ['Method',          m.name],
    ['Regulations',     (m.regulations || []).join(', ')],
    ['Engine module',   m.engine_module],
    ['Engine version',  m.engine_version],
    ['Interp · field',  ip.along_field],
    ['Interp · HAAT',   ip.along_haat],
    ['Curve dataset',   trS.dataset],
    ['Curve meta',      (trS.dataset_meta_sha256 || '').slice(0,12) + '…'],
    ['Pattern factor',  trS.pattern_factor_applied ? 'applied' : 'non-directional'],
    ['Formula',         trS.formula_summary]
  ];
  return (
    <table className="telemetry">
      <tbody>
        {rows.map(([k, v]) => (
          <tr key={k}>
            <th className="w-[35%]">{k}</th>
            <td className="text-right text-cream">{v || <span className="text-textDim">—</span>}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function PaneRadials({ exhibit }){
  const rt   = exhibit?.radial_table || [];
  const cdef = exhibit?.contour_definitions || [];
  if (!rt.length) return <Empty/>;
  const t = exhibit?.evidence?.terrain;
  const haatBadge = t?.available
    ? <span className="text-green">per-radial · {t.method} · {t.dem?.source} {t.dem?.dataset}</span>
    : <span className="text-amber">flat HAAT (CONSTANT_HAAT_ASSUMED) — toggle "Request per-radial §73.313 HAAT" to use ZTR terrain</span>;
  return (
    <>
      <div className="font-mono text-[11px] mb-2">{haatBadge}</div>
      <div className="overflow-auto max-h-[520px] rounded-md border border-rule">
        <table className="telemetry">
          <thead>
            <tr>
              <th>Az (°)</th><th>F·rel</th><th>HAAT (m)</th><th>Source</th>
              {cdef.map(c => <th key={c.id}>{c.label || c.id}</th>)}
            </tr>
          </thead>
          <tbody>
            {rt.map((r, i) => (
              <tr key={i}>
                <td className="text-cream">{Number(r.azimuth_deg).toFixed(1)}</td>
                <td>{Number(r.relative_field).toFixed(3)}</td>
                <td>{r.haat_computed_m ?? r.haat_input_m ?? '—'}</td>
                <td className="text-textDim">{r.haat_source || '—'}</td>
                {cdef.map(c => (
                  <td key={c.id} className="text-right">
                    {r.contour_distances_km?.[c.id] != null
                      ? Number(r.contour_distances_km[c.id]).toFixed(2)
                      : '—'}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function PaneEvidence({ exhibit }){
  if (!exhibit) return <Empty/>;
  const ev = exhibit.evidence || {};
  return (
    <div className="space-y-3">
      <SubHead title="Terrain" />
      <SubKv kv={ev.terrain?.available
        ? [
            ['Source',     ev.terrain.source],
            ['Endpoint',   ev.terrain.endpoint || '—'],
            ['Method',     ev.terrain.method],
            ['DEM',        `${ev.terrain.dem?.source || '—'} ${ev.terrain.dem?.dataset || ''}`.trim()],
            ['Profiles',   (ev.terrain.profiles || []).length + ' radials'],
            ['Fetched at', ev.terrain.fetched_at || '—']
          ]
        : [['Status', 'No terrain evidence attached. Engine ran with flat HAAT (or n/a for AM).']]} />
      <SubHead title="Measurements (SDR captures via ZTR)" />
      <SubKv kv={ev.measurements?.available
        ? [
            ['Source',     ev.measurements.source || '—'],
            ['Endpoint',   ev.measurements.endpoint || '—'],
            ['Records',    ev.measurements.n_records ?? (ev.measurements.records || []).length],
            ['Calibrated', ev.measurements.calibrated
              ? 'yes'
              : 'no — raw indications only (SDR_MEASUREMENTS_NOT_CALIBRATED)'],
            ['Fetched at', ev.measurements.fetched_at || '—']
          ]
        : [['Status', 'No SDR / measurement records attached. Either no captures exist for this station in ZTR, or the rich-station endpoint was unreachable.']]} />
      <SubHead title="Identity (RDS / RadioDNS / EAS / audio)" />
      <SubKv kv={ev.identity?.available
        ? [['Available', 'yes'], ['Confirmations', (ev.identity.confirmations || []).length], ['Sources', (ev.identity.sources || []).map(s => s.kind + ':' + s.status).join(', ')]]
        : [['Status', 'Identity sidecar not attached or no confirmations returned.']]} />
    </div>
  );
}

function PaneProvenance({ exhibit }){
  if (!exhibit) return <Empty/>;
  const fm  = exhibit.facility_metadata || {};
  const ev  = exhibit.evidence || {};
  const sig = exhibit.engine_signature || {};
  const v   = exhibit.validation || {};
  const last = v.runs?.slice(-1)[0] || null;
  return (
    <div className="space-y-3">
      <SubHead title="Engine signature" />
      <SubKv kv={[
        ['Module',  sig.module || '—'],
        ['Version', sig.version || '—'],
        ['Build',   sig.hash || '—'],
        ['Node',    sig.node || '—']
      ]} />
      <SubHead title="Facility source" />
      <SubKv kv={[
        ['Upstream',   fm.facility_lookup_source || '—'],
        ['Endpoint',   fm.facility_endpoint || '—'],
        ['Updated at', fm.facility_updated_at || '—']
      ]} />
      <SubHead title="Terrain source" />
      <SubKv kv={ev.terrain?.available ? [
        ['Upstream', ev.terrain.source || '—'],
        ['Endpoint', ev.terrain.endpoint || '—'],
        ['Method',   ev.terrain.method   || '—'],
        ['DEM',      `${ev.terrain.dem?.source || '—'} ${ev.terrain.dem?.dataset || ''}`.trim()],
        ['Fetched at', ev.terrain.fetched_at || '—']
      ] : [['Status', 'no terrain source attached']]} />
      <SubHead title="Curve validation source" />
      <SubKv kv={last ? [
        ['Method',   last.method   || '—'],
        ['Source',   last.source   || '—'],
        ['Endpoint', last.endpoint || '—'],
        ['Upstream API', last.upstream_api || '—'],
        ['Result',   last.authoritative_pass ? 'PASS — clears CURVE_VALIDATION_MISSING' : 'NOT PASSING'],
        ['Tolerance', last.tolerance_km != null ? last.tolerance_km + ' km' : '—'],
        ['Max error', last.max_error_km != null ? last.max_error_km.toFixed(2) + ' km' : '—']
      ] : [['Status', 'no validation run attached']]} />
      <SubHead title="Measurement source" />
      <SubKv kv={ev.measurements?.available ? [
        ['Upstream', ev.measurements.source || '—'],
        ['Endpoint', ev.measurements.endpoint || '—'],
        ['Records',  ev.measurements.n_records ?? (ev.measurements.records || []).length],
        ['Calibrated', ev.measurements.calibrated ? 'yes' : 'no'],
        ['Fetched at', ev.measurements.fetched_at || '—']
      ] : [['Status', 'no SDR evidence attached']]} />
      <SubHead title="Population source" />
      <SubKv kv={[['Status', exhibit.population_estimate?.method === 'placeholder'
        ? 'placeholder — no Census/ACS adapter wired (POPULATION_EVIDENCE_URL unset)'
        : (exhibit.population_estimate?.method || '—')]]} />
    </div>
  );
}

function PaneValidation({ exhibit }){
  const v = exhibit?.validation || {};
  const last = v.runs?.[v.runs.length - 1] || null;
  if (!last) return <Empty/>;
  const kv = [
    ['Curve dataset',          last.curve_version],
    ['Authoritative cases',    `${last.n_run} run / ${last.n_pass} pass`],
    ['Authoritative pass',     last.authoritative_pass ? 'yes' : 'no — CURVE_VALIDATION_MISSING blocker stays'],
    ['Regression cases',       `${last.n_regression_run} run / ${last.n_regression_pass} pass`],
    ['Mean error (km)',        last.mean_error_km ?? '—'],
    ['Max error (km)',         last.max_error_km  ?? '—'],
    ['Reference cases present', last.reference_cases_present ? 'yes' : 'no']
  ];
  return (
    <>
      <SubKv kv={kv} />
      <SubHead title="Cases" />
      <div className="overflow-auto max-h-[340px] rounded-md border border-rule">
        <table className="telemetry">
          <thead><tr><th>Case</th><th>Role</th><th>Auth?</th><th>Status</th></tr></thead>
          <tbody>
            {(last.results || []).map((r, i) => (
              <tr key={i}>
                <td className="text-cream">{r.case || '—'}</td>
                <td>{r.role || '—'}</td>
                <td>{r.authoritative === true ? 'yes' : (r.authoritative === false ? 'no' : '—')}</td>
                <td className={r.status === 'pass' ? 'text-green' : (r.status === 'fail' ? 'text-red' : 'text-amber')}>{r.status || '—'}</td>
              </tr>
            ))}
            {!(last.results || []).length && <tr><td colSpan={4} className="text-textDim italic">no cases run.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}

function PaneNarrative({ exhibit }){
  if (!exhibit) return <Empty/>;
  return (
    <pre className="font-mono text-[12px] text-text whitespace-pre-wrap break-words bg-black/40 border border-rule rounded-md p-4 max-h-[540px] overflow-auto">
      {exhibit.narrative?.text || '— no narrative attached —'}
    </pre>
  );
}

function PaneExports({ exhibit }){
  if (!exhibit) return <Empty/>;
  const ex = exhibit.exports || {};
  const kv = [
    ['JSON',          ex.json    || 'pending'],
    ['TXT',           ex.txt     || 'pending'],
    ['GeoJSON',       ex.geojson || 'pending'],
    ['PDF',           ex.pdf     || 'not_implemented'],
    ['Generated at',  ex.generated_at || '—']
  ];
  return (
    <>
      <SubKv kv={kv} />
      <SubHead title="Reproducibility package (JSON)" />
      <pre className="font-mono text-[11px] text-text whitespace-pre-wrap break-words bg-black/40 border border-rule rounded-md p-4 max-h-[540px] overflow-auto">
        {JSON.stringify(exhibit, null, 2)}
      </pre>
    </>
  );
}

function PaneHistory({ rows, onPick }){
  if (!rows || !rows.length){
    return <div className="font-mono text-[12px] text-textDim italic">No saved exhibits — connect Postgres and click Save.</div>;
  }
  return (
    <div className="overflow-auto max-h-[420px] rounded-md border border-rule">
      <table className="telemetry">
        <thead><tr><th>ID</th><th>Call</th><th>Service</th><th>Freq</th><th>Score</th><th>Status</th><th>Created</th></tr></thead>
        <tbody>
          {rows.map(x => (
            <tr key={x.id} style={{ cursor: 'pointer' }} onClick={() => onPick(x.id)}>
              <td>#{x.id}</td>
              <td className="text-cream">{x.call_sign || '—'}</td>
              <td>{x.service || '—'}</td>
              <td>{x.frequency ?? '—'}</td>
              <td>{x.filing_score ?? '—'}</td>
              <td>{x.filing_status || '—'}</td>
              <td>{new Date(x.created_at).toISOString().slice(0,16).replace('T',' ')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ---------------- helpers ---------------- */

function Empty(){
  return <div className="font-mono text-[12px] text-textDim italic">— compute an exhibit —</div>;
}
function SubHead({ title }){
  return <div className="rack-eyebrow mt-3 mb-1">{title}</div>;
}
function SubKv({ kv }){
  return (
    <div className="grid grid-cols-[160px_1fr] gap-y-1 gap-x-3 font-mono text-[12px]">
      {kv.map(([k, v]) => (
        <React.Fragment key={k}>
          <div className="text-textDim text-[10px] tracking-rack uppercase">{k}</div>
          <div className="text-cream">{v ?? <span className="text-textDim">—</span>}</div>
        </React.Fragment>
      ))}
    </div>
  );
}
function num(s){
  if (s === null || s === undefined || s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
function escapeHtml(s){
  return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
