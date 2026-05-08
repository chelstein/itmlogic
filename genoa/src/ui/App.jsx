import React, { useEffect, useMemo, useRef, useState } from 'react';
import { stripDomAndReact } from './lib/stripDomAndReact.js';
import { readJsonOrThrow }  from './lib/readJson.js';
import AppShell      from '@components/ui/AppShell.jsx';
import RackPanel     from '@components/ui/RackPanel.jsx';
import FacilityRack  from '@components/ui/FacilityRack.jsx';
import ChartScope    from '@components/ui/ChartScope.jsx';
import TelemetryRack from '@components/ui/TelemetryRack.jsx';
import TabStrip      from '@components/ui/TabStrip.jsx';
import HardwareButton from '@components/ui/HardwareButton.jsx';
import SweepPanel    from '@components/ui/SweepPanel.jsx';
import Login         from '@components/ui/Login.jsx';
import PeCertifyDialog from '@components/ui/PeCertifyDialog.jsx';
import PeSealCard     from '@components/ui/PeSealCard.jsx';
import AmDaDesigner   from '@components/ui/AmDaDesigner.jsx';

const PRESET_SYNTHETIC = {
  call:'WBOB-FM (synthetic)', facility_id:'', service:'FM', fcc_class:'A',
  frequency:98.7, erp_kw:6.0, haat_m:100,
  lat:37.0902, lon:-95.7129,
  ground_sigma_mS_m: 8,
  radial_step_deg: 10,
  pattern_mode: 'ND',
  _synthetic: true
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
  { id: 'sweep',      label: 'Find best config' },
  { id: 'am_da',      label: 'AM DA designer' },
  { id: 'provenance', label: 'Provenance' },
  { id: 'narrative',  label: 'AI narrative' },
  { id: 'exports',    label: 'Exports' },
  { id: 'history',    label: 'History' }
];

const CONTOUR_COLORS = ['#ffb347', '#d6a36a', '#6fd3ff'];

export default function App(){
  const [authed, setAuthed] = useState(null);
  useEffect(() => {
    fetch('/api/auth/me', { credentials: 'same-origin' })
      .then(r => setAuthed(r.ok))
      .catch(() => setAuthed(false));
  }, []);
  async function logout(){
    try { await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }); }
    catch {}
    setAuthed(false);
  }
  if (authed === null){
    return (
      <div className="min-h-screen flex items-center justify-center bg-black font-mono text-textDim text-[12px] tracking-rack uppercase">
        Checking session…
      </div>
    );
  }
  if (authed === false){
    return <Login onSuccess={() => setAuthed(true)} />;
  }
  return <MainApp onLogout={logout} />;
}

function MainApp({ onLogout }) {
  const [inputs, setInputs] = useState(PRESET_SYNTHETIC);
  const [exhibit, setExhibit] = useState(null);
  const [computing, setComputing] = useState(false);
  const [busy, setBusy]           = useState(false);
  const [statusMsg, setStatusMsg] = useState('Ready · click Compute exhibit');
  const [facilitySource, setFacilitySource] = useState('');
  const [activeTab, setActiveTab] = useState('fcc');
  const [history, setHistory]     = useState([]);
  const [stationQuery,    setStationQuery]    = useState('');
  const [stationResults,  setStationResults]  = useState([]);
  const [stationSearching, setStationSearching] = useState(false);
  const [stationError,    setStationError]    = useState('');
  const [stationSearched, setStationSearched] = useState(false);
  const stationDebounceRef = useRef(null);
  const [peDialogOpen, setPeDialogOpen] = useState(false);

  const onChange = (k, v) => setInputs(s => ({ ...s, [k]: v }));

  function mergeFacility(base, f){
    if (!f) return base;
    const fill = (k, v) => (base[k] === undefined || base[k] === '' || base[k] === null) ? v : base[k];
    return {
      ...base,
      call:         fill('call',         f.call),
      facility_id:  fill('facility_id',  f.facility_id),
      service:      fill('service',      f.service),
      fcc_class:    fill('fcc_class',    f.fcc_class),
      frequency:    fill('frequency',    f.frequency),
      erp_kw:       fill('erp_kw',       f.erp_kw),
      haat_m:       fill('haat_m',       f.haat_m),
      lat:          fill('lat',          f.lat),
      lon:          fill('lon',          f.lon),
      pattern_mode: f.pattern_mode ? fill('pattern_mode', f.pattern_mode) : base.pattern_mode
    };
  }

  async function lookupFacility(id, baseInputs = null){
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
      const f = j.facility || {};
      setInputs(prev => mergeFacility(baseInputs || prev, f));
      const cacheTag = j.cached ? ' (cached)' : '';
      setFacilitySource(`Resolved via ${j.source}${cacheTag}`);
      return { facility: f, source: j.source, cached: j.cached };
    } catch (e){
      setFacilitySource(`Lookup failed: ${e.message}`);
      return null;
    }
  }

  async function runJobAndWait(kind, { input, options } = {}, onProgress){
    const post = await fetch('/api/exhibit/jobs', {
      method:  'POST',
      headers: { 'content-type': 'application/json' },
      body:    JSON.stringify({ kind, input: input || {}, options: options || {} })
    });
    if (!post.ok){
      const txt = await post.text().catch(() => '');
      throw new Error(`Job submission failed: HTTP ${post.status}${txt ? ' — ' + txt.slice(0, 200) : ''}`);
    }
    const { job_id } = await post.json();
    if (!job_id) throw new Error('Job submission returned no job_id');

    while (true){
      await new Promise(r => setTimeout(r, 2000));
      const r = await fetch(`/api/exhibit/jobs/${job_id}`);
      if (!r.ok){
        throw new Error(`Job poll failed: HTTP ${r.status}`);
      }
      const view = await r.json();
      if (typeof onProgress === 'function' && view.progress_message){
        onProgress(view.progress_message);
      }
      if (view.status === 'complete') return view;
      if (view.status === 'failed'){
        const e = view.error || {};
        throw new Error(e.message || e.code || 'Job failed');
      }
    }
  }

  async function compute(overrideInputs = null){
    if (overrideInputs && typeof overrideInputs === 'object'
        && (overrideInputs.nativeEvent || overrideInputs.currentTarget || overrideInputs.target || overrideInputs._reactName)){
      overrideInputs = null;
    }
    const i = overrideInputs || inputs;
    setComputing(true);
    setStatusMsg('Computing exhibit…');
    try {
      const payload = {
        inputs: {
          ...i,
          _synthetic:       undefined,
          _resolveFacility: undefined,
          frequency:         num(i.frequency),
          erp_kw:            num(i.erp_kw),
          haat_m:            num(i.haat_m),
          lat:               num(i.lat),
          lon:               num(i.lon),
          ground_sigma_mS_m: num(i.ground_sigma_mS_m),
          radial_step_deg:   num(i.radial_step_deg) || 10,
          pattern_table: i.pattern_mode === 'DA' ? i.pattern_table : null
        },
        options: {
          use_terrain: !!i.use_terrain
        }
      };
      const cleanPayload = stripDomAndReact(payload);
      const view = await runJobAndWait(
        'exhibit',
        { input: cleanPayload.inputs, options: cleanPayload.options },
        (msg) => setStatusMsg(msg)
      );
      const j = view.result?.exhibit;
      if (!j) throw new Error('Job completed without exhibit payload');
      setExhibit(j);
      const fr = j.filing_readiness || {};
      setStatusMsg(j.degraded_mode
        ? `Computed in degraded mode · ${fr.score}/100 (${fr.status}) · ${j.warnings.length} warning(s), ${j.blockers.length} blocker(s).`
        : `Computed cleanly · ${fr.score}/100 (${fr.status}).`);
    } catch (e){
      setStatusMsg(`Compute failed: ${e.message}`);
    } finally { setComputing(false); }
  }

  async function loadKslx(){
    setInputs(PRESET_KSLX);
    setFacilitySource('Looking up KSLX-FM (facility 11282)…');
    let merged = PRESET_KSLX;
    if (PRESET_KSLX._resolveFacility){
      const r = await lookupFacility(PRESET_KSLX.facility_id, PRESET_KSLX);
      if (r?.facility){
        merged = mergeFacility(PRESET_KSLX, r.facility);
        setInputs(merged);
      }
    }
    await compute(merged);
  }

  async function searchStations(q){
    const qs = String(q || '').trim();
    if (qs.length < 2){
      setStationResults([]); setStationError(''); setStationSearched(false);
      return;
    }
    setStationSearching(true);
    setStationError('');
    setStationSearched(false);
    try {
      const r = await fetch(`/api/facilities/search?q=${encodeURIComponent(qs)}&limit=10`);
      if (r.status === 503){
        const j = await r.json().catch(() => ({}));
        setStationError(j.warning?.detail || 'facility lookup unavailable');
        setStationResults([]);
        return;
      }
      if (!r.ok){
        setStationError(`Search failed (${r.status})`);
        setStationResults([]);
        return;
      }
      const j = await r.json();
      setStationResults(j.rows || []);
      setStationSearched(true);
    } catch (e){
      setStationError(`Search failed: ${e.message}`);
      setStationResults([]);
    } finally {
      setStationSearching(false);
    }
  }

  function onStationQueryChange(q){
    setStationQuery(q);
    setStationSearched(false);
    if (stationDebounceRef.current) clearTimeout(stationDebounceRef.current);
    stationDebounceRef.current = setTimeout(() => searchStations(q), 250);
  }

  async function loadStationRow(row){
    if (!row) return;
    const base = {
      ...PRESET_SYNTHETIC,
      _synthetic: false,
      radial_step_deg: inputs.radial_step_deg || 10,
      use_terrain:     !!inputs.use_terrain,
      lat: '', lon: '',
      facility_id: '', call: '',
      service:    '', fcc_class: '',
      frequency:  '', erp_kw: '', haat_m: '',
      pattern_mode: ''
    };
    const merged = mergeFacility(base, row);
    if (!merged.pattern_mode) merged.pattern_mode = 'ND';
    setInputs(merged);
    setFacilitySource(`Loaded ${row.call || row.facility_id || 'station'} via ${row.facility_lookup_source?.upstream || 'upstream'}`);
    setStationQuery('');
    setStationResults([]);
    await compute(merged);
  }
  function loadSynthetic(){
    setInputs(PRESET_SYNTHETIC);
    setFacilitySource('');
    setTimeout(() => compute(PRESET_SYNTHETIC), 0);
  }
  function reset(){
    setInputs(PRESET_SYNTHETIC);
    setExhibit(null);
    setFacilitySource('');
    setStatusMsg('Reset.');
  }

  async function save(){
    if (!exhibit){ setStatusMsg('Run a compute first.'); return; }
    setBusy(true);
    const cleanedExhibit = stripDomAndReact(exhibit);
    const body = JSON.stringify(cleanedExhibit);
    const tryPost = async (url) => {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body
      });
      return readJsonOrThrow(r);
    };
    try {
      try {
        const j = await tryPost('/api/exhibits');
        setExhibit(prev => ({ ...prev, id: j.id }));
        setStatusMsg(`Saved exhibit #${j.id}`);
        return;
      } catch (e){ console.warn('[save] persistent save failed:', e.message); }
      try {
        const j = await tryPost('/api/exhibits/save');
        const tag = j.id ? `exhibit #${j.id}` : (j.mode === 'ephemeral' ? 'ephemeral session' : 'session');
        setStatusMsg(`Save unavailable on server — held in ${tag}.  Use JSON / TXT / GeoJSON to export locally.`);
        if (j.id) setExhibit(prev => ({ ...prev, id: j.id }));
        return;
      } catch (e){ console.warn('[save] ephemeral save failed:', e.message); }
      const blob = new Blob([JSON.stringify(cleanedExhibit, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${(cleanedExhibit.station_inputs?.call || 'exhibit').replace(/[^A-Z0-9]/gi,'_')}_genoa_exhibit.json`;
      a.click();
      setStatusMsg('Save unavailable on server — exhibit downloaded locally as JSON.');
    } catch (e){
      setStatusMsg(`Save failed: ${e.message}`);
    } finally { setBusy(false); }
  }

  function downloadExport(format){
    if (!exhibit){ setStatusMsg('Run a compute first.'); return; }
    if (format === 'engineering-txt' || format === 'engineering-pdf'){
      const ext = format === 'engineering-txt' ? 'txt' : 'pdf';
      statelessEngineeringReportDownload(exhibit, ext).catch(e =>
        setStatusMsg(`Engineering Statement export failed: ${e.message || e}`));
      return;
    }
    if (!exhibit.id){
      const map = {
        json:    () => [JSON.stringify(exhibit, null, 2),         'application/json',     'exhibit.json'],
        geojson: () => [JSON.stringify(exhibit.geojson, null, 2), 'application/geo+json', 'contours.geojson']
      };
      if (format === 'pdf'){
        statelessPdfDownload(exhibit).catch(e =>
          setStatusMsg(`PDF export failed: ${e.message || e}`));
        return;
      }
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

  async function statelessEngineeringReportDownload(ex, ext){
    const kind = ext === 'pdf' ? 'engineering_report_pdf' : 'engineering_report_txt';
    setStatusMsg(`Submitting Engineering Statement ${ext.toUpperCase()} job…`);
    const cleaned = stripDomAndReact(ex);
    const view = await runJobAndWait(
      kind,
      { input: { exhibit: cleaned } },
      (msg) => setStatusMsg(msg)
    );
    if (!view.artifact_url) throw new Error('Job completed without artifact');
    setStatusMsg(`Downloading ${ext.toUpperCase()} artifact…`);
    const ar = await fetch(view.artifact_url);
    if (!ar.ok){
      const txt = await ar.text().catch(() => '');
      throw new Error(`Artifact fetch failed: HTTP ${ar.status}${txt ? ' — ' + txt.slice(0, 120) : ''}`);
    }
    const blob = await ar.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    const call = (ex.station_inputs?.call || 'exhibit').replace(/[^A-Z0-9]/gi,'_');
    const ts   = new Date().toISOString().slice(0, 10);
    a.download = `genoa-engineering-statement-${call}-${ts}.${ext}`;
    a.click();
    setStatusMsg(`Engineering Statement ${ext.toUpperCase()} downloaded.`);
  }

  async function statelessPdfDownload(ex){
    setStatusMsg('Rendering PDF…');
    const cleaned = stripDomAndReact(ex);
    const r = await fetch('/api/exhibits/export/pdf', {
      method:  'POST',
      headers: { 'content-type': 'application/json' },
      body:    JSON.stringify({ exhibit: cleaned })
    });
    if (!r.ok){
      const txt = await r.text().catch(() => '');
      throw new Error(`HTTP ${r.status}${txt ? ' — ' + txt.slice(0, 120) : ''}`);
    }
    const blob = await r.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${(ex.station_inputs?.call || 'exhibit').replace(/[^A-Z0-9]/gi,'_')}_exhibit.pdf`;
    a.click();
    setStatusMsg('PDF downloaded.');
  }

  async function loadHistory(){
    try {
      const r = await fetch('/api/exhibits');
      if (!r.ok){ setHistory([]); return; }
      const rows = await readJsonOrThrow(r);
      setHistory(Array.isArray(rows) ? rows : []);
    } catch { setHistory([]); }
  }
  useEffect(() => {
    if (activeTab === 'history') loadHistory();
  }, [activeTab]);

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
    // ITM terrain-aware coverage as a supplementary contour (cyan dashed
    // ring).  §73.333 polygons stay the compliance reference; this layer
    // visualises §73.314 evidence for how actual coverage shapes around
    // terrain.  Hidden when no ITM evidence is attached.
    const itmPolys = (exhibit.itm_polygons || []).filter(p => p.closed && p.ring_latlng?.length);
    itmPolys.forEach((p) => {
      const layer = L.polygon(p.ring_latlng, {
        color:       '#6fd3ff',
        weight:      2.0,
        opacity:     0.85,
        fillColor:   '#6fd3ff',
        fillOpacity: 0.05,
        dashArray:   '6,4'
      }).bindPopup(
        `<b>${escapeHtml(p.label || 'ITM coverage')}</b><br/>` +
        `terrain mean radial ${p.mean_radial_km != null ? p.mean_radial_km.toFixed(1) : '—'} km<br/>` +
        `§73.333 mean ${p.fcc_mean_km != null ? p.fcc_mean_km.toFixed(1) : '—'} km<br/>` +
        `Δ ${p.delta_mean_km != null ? (p.delta_mean_km >= 0 ? '+' : '') + p.delta_mean_km.toFixed(1) : '—'} km` +
        (p.n_blocked_radials ? `<br/>${p.n_blocked_radials} blocked radial(s)` : '') +
        (p.engine ? `<br/><i>${escapeHtml(p.engine)}${p.tier ? ' · ' + escapeHtml(p.tier) : ''}</i>` : '')
      );
      layer.addTo(map);
      mapRef.current.layers.push(layer);
    });
    const allPts = [...polys, ...itmPolys].flatMap(p => p.ring_latlng || []);
    if (allPts.length) map.fitBounds(L.latLngBounds(allPts).pad(0.15));
    map.invalidateSize();
  }, [exhibit]);

  const fr        = exhibit?.filing_readiness;
  const sysStatus = !exhibit ? 'offline'
                  : (exhibit.blockers?.length ? 'blocked'
                  : (exhibit.degraded_mode    ? 'degraded' : 'nominal'));

  const legend = [
    ...(exhibit?.polygons || []).map((p, i) => ({
      color: CONTOUR_COLORS[i] || '#9fdcb1',
      label: p.label
    })),
    ...((exhibit?.itm_polygons || []).filter(p => p.closed).map(p => ({
      color: '#6fd3ff',
      label: `${p.label}${p.delta_mean_km != null ? `  (Δ ${p.delta_mean_km >= 0 ? '+' : ''}${p.delta_mean_km.toFixed(1)} km)` : ''}`,
      dashed: true
    })))
  ];

  const mapCaption = (() => {
    const s = exhibit?.station_inputs;
    if (!s) return 'Compute an exhibit to project contours.';
    if (s.lat == null || s.lon == null){
      return 'Map unavailable — facility coordinates missing. Radial table is still computed; see the Radials tab.';
    }
    return 'Deterministic FCC contour map. Contour fills warm → cool from city grade to protected.';
  })();

  return (
    <>
    <button
      onClick={onLogout}
      title="Sign out"
      className="fixed top-3 right-4 z-40 font-mono text-[10px] tracking-rack uppercase text-textDim hover:text-cream border border-rule hover:border-gold/50 rounded px-2.5 py-1 bg-black/60 backdrop-blur-sm transition-colors"
    >
      Sign&nbsp;out
    </button>
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
          onCompute={() => compute()}
          onReset={() => reset()}
          onSave={() => save()}
          onExport={(format) => downloadExport(format)}
          onLookupFid={() => lookupFacility(inputs.facility_id)}
          onLoadKslx={() => loadKslx()}
          onLoadSynthetic={() => loadSynthetic()}
          facilitySource={facilitySource}
          stationQuery={stationQuery}
          stationResults={stationResults}
          stationSearching={stationSearching}
          stationSearched={stationSearched}
          stationError={stationError}
          onStationQueryChange={onStationQueryChange}
          onStationPick={loadStationRow}
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
              <TabBody
                id={activeTab}
                exhibit={exhibit}
                history={history}
                onPickHistory={pickHistory}
                getBaseInputs={() => sanitizeBaseInputs(inputs)}
                inputs={inputs}
                onApplyCombo={(combo) => setInputs(s => ({
                  ...s,
                  erp_kw: combo.erp_kw,
                  haat_m: combo.haat_m,
                  ...(combo.pattern_table ? { pattern_mode: 'DA', pattern_table: combo.pattern_table } : {})
                }))}
                onApplyAmDaPattern={(pattern_table) => setInputs(s => ({
                  ...s,
                  pattern_mode:  'DA',
                  pattern_table
                }))}
              />
            </div>
          </RackPanel>
        </>
      )}
      right={(
        <>
          <PeSealCard
            exhibit={exhibit}
            onCertify={() => setPeDialogOpen(true)}
            onClear={() => setExhibit(prev => prev ? { ...prev, pe_certification: undefined } : prev)}
          />
          <TelemetryRack exhibit={exhibit} />
        </>
      )}
    />
    {peDialogOpen ? (
      <PeCertifyDialog
        exhibit={exhibit}
        onClose={() => setPeDialogOpen(false)}
        onSealed={(sealed) => setExhibit(sealed)}
      />
    ) : null}
    </>
  );

  async function pickHistory(id){
    try {
      const r = await fetch(`/api/exhibits/${id}`);
      const x = await readJsonOrThrow(r);
      setExhibit(x.payload);
      const s = x.payload.station_inputs || {};
      setInputs(prev => ({ ...prev, ...s, pattern_mode: Array.isArray(s.pattern) ? 'DA' : 'ND' }));
      setStatusMsg(`Loaded exhibit #${id}`);
    } catch (e){ setStatusMsg(`Load failed: ${e.message}`); }
  }
}

function TabBody({ id, exhibit, history, onPickHistory, getBaseInputs, inputs, onApplyCombo, onApplyAmDaPattern }){
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
  if (id === 'sweep'){
    return <SweepPanel getBaseInputs={getBaseInputs} onApplyCombo={onApplyCombo} />;
  }
  if (id === 'am_da'){
    return <AmDaDesigner baseInputs={inputs} onApplyPattern={onApplyAmDaPattern} />;
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
    ['Engine version', m.engine_version],
    ['Interp · field',  ip.along_field],
    ['Interp · HAAT',   ip.along_haat],
    ['Curve dataset',   trS.dataset],
    ['Curve meta',      (trS.dataset_meta_sha256 || '').slice(0,12) + '…'],
    ['Pattern factor',  trS.pattern_factor_applied ? 'applied' : 'non-directional'],
    ['Formula',         trS.formula_summary]
  ];
  const isr = exhibit.interference_study;
  return (
    <div className="space-y-3">
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
      {isr ? <InterferenceStudyTable study={isr} /> : null}
    </div>
  );
}

function InterferenceStudyTable({ study }){
  const stations = study.stations || [];
  return (
    <div className="rounded-md border border-rule">
      <div className="bg-cream/5 px-3 py-2 font-mono text-[11px]">
        <div className="text-cream">
          Interference Study — {(study.rules_evaluated || []).join(' · ')}
        </div>
        <div className="text-textDim">
          {study.n_stations} station(s); {study.n_pass} pass / {study.n_fail} fail ·{' '}
          filing_qualifies =
          <span className={
            study.filing_qualifies === true  ? ' text-green'  :
            study.filing_qualifies === false ? ' text-red'    : ' text-amber'}>
            {' '}{String(study.filing_qualifies)}
          </span>
          {study.blocking_rule ? <span className="text-amber"> · blocked by {study.blocking_rule}</span> : null}
        </div>
      </div>
      {stations.length === 0
        ? <div className="px-3 py-3 font-mono text-[11px] text-textDim">No nearby stations evaluated (no nearby_primaries attached).</div>
        : (
          <div className="overflow-auto max-h-[420px]">
            <table className="telemetry">
              <thead>
                <tr>
                  <th>Call</th>
                  <th>Class</th>
                  <th>Δf kHz</th>
                  <th>Rel.</th>
                  <th className="text-right">Dist km</th>
                  <th className="text-right">§73.207 req</th>
                  <th className="text-right">§73.215 D/U</th>
                  <th>Polygon</th>
                  <th>Pass</th>
                  <th>Via</th>
                </tr>
              </thead>
              <tbody>
                {stations.map((s, i) => {
                  const r207 = s.rules.section_73_207;
                  const r215 = s.rules.section_73_215;
                  const r1204 = s.rules.section_74_1204;
                  const r187  = s.rules.section_73_187;
                  const polygon = r215
                    ? (r215.polygon_pass === true  ? 'no overlap'
                       : r215.polygon_pass === false ? 'OVERLAP' : '—')
                    : '—';
                  return (
                    <tr key={s.facility_id || s.call || i}
                        className={s.pass_overall === false ? 'bg-red/10' : undefined}>
                      <td>{s.call || s.facility_id || '—'}</td>
                      <td>{s.fcc_class || '—'}</td>
                      <td className="text-right">{s.frequency_offset_khz ?? '—'}</td>
                      <td>{s.channel_relationship || '—'}</td>
                      <td className="text-right">{s.distance_km != null ? s.distance_km.toFixed(2) : '—'}</td>
                      <td className="text-right">
                        {r207
                          ? <span className={r207.pass === true ? 'text-green' : r207.pass === false ? 'text-red' : ''}>
                              {r207.required_separation_km}/{r207.actual_separation_km}
                            </span>
                          : '—'}
                      </td>
                      <td className="text-right">
                        {r215 && r215.du_required_db != null
                          ? <span className={r215.du_pass === true ? 'text-green' : r215.du_pass === false ? 'text-red' : ''}>
                              {r215.du_required_db}/{r215.du_actual_db_forward?.toFixed?.(1) ?? '—'}
                            </span>
                          : r1204 || r187 ? '—'
                          : '—'}
                      </td>
                      <td className={polygon === 'OVERLAP' ? 'text-red' : polygon === 'no overlap' ? 'text-green' : ''}>{polygon}</td>
                      <td className={
                        s.pass_overall === true  ? 'text-green' :
                        s.pass_overall === false ? 'text-red'   : 'text-amber'
                      }>{s.pass_overall === true ? 'PASS' : s.pass_overall === false ? 'FAIL' : '—'}</td>
                      <td className="text-textDim">{(s.qualified_via || []).join(', ')}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      <div className="px-3 py-2 font-mono text-[10px] text-textDim border-t border-rule">
        Distance per §73.208 (great-circle, WGS-84 Karney). Polygon overlap via Sutherland-Hodgman + Karney WGS-84 PolygonArea.
        A station qualifies if AT LEAST ONE applicable rule passes (e.g., §73.215 contour protection clears a §73.207 short-spacing).
      </div>
    </div>
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
  const ev  = exhibit.evidence || {};
  const pop = exhibit.population_estimate || {};
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
      <SubHead title="Population (INFORMATIONAL ONLY — not used for §73.x compliance)" />
      <SubKv kv={pop.source && pop.vintage
        ? [
            ['Disclaimer', 'INFORMATIONAL ONLY. FCC §73.x compliance is determined by distance and field-strength tests, not population.'],
            ['Persons',    Number(pop.primary).toLocaleString()],
            ['Contour',    pop.contour_label || '—'],
            ['Source',     pop.source],
            ['Dataset',    pop.dataset || '—'],
            ['Vintage',    String(pop.vintage)],
            ['Method',     pop.method || '—'],
            ['Endpoint',   pop.endpoint || '—'],
            ['Fetched at', pop.fetched_at || '—']
          ]
        : [['Status', 'Placeholder — real Census data will populate once an exhibit is computed with lat/lon coordinates.']]} />
    </div>
  );
}

function PaneProvenance({ exhibit }){
  if (!exhibit) return <Empty/>;
  const fm  = exhibit.facility_metadata || {};
  const ev  = exhibit.evidence || {};
  const sig = exhibit.engine_signature || {};
  return (
    <div className="space-y-3">
      <SubHead title="Engine signature" />
      <SubKv kv={[
        ['Module',  sig.module || '—'],
        ['Version', sig.version || '—'],
        ['Build',   sig.hash || '—'],
        ['Node',    sig.node || '—']
      ]} />
      <SubHead title="Terrain source" />
      <SubKv kv={ev.terrain?.available ? [
        ['Upstream', ev.terrain.source || '—'],
        ['Endpoint', ev.terrain.endpoint || '—'],
        ['Method',   ev.terrain.method   || '—'],
        ['Fetched at', ev.terrain.fetched_at || '—']
      ] : [['Status', 'no terrain source attached']]} />
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
    ['Reference cases present', last.reference_cases_present ? 'yes' : 'no']
  ];
  return <SubKv kv={kv} />;
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
function sanitizeBaseInputs(i){
  if (!i) return {};
  return {
    ...i,
    _synthetic:       undefined,
    _resolveFacility: undefined,
    frequency:         num(i.frequency),
    erp_kw:            num(i.erp_kw),
    haat_m:            num(i.haat_m),
    lat:               num(i.lat),
    lon:               num(i.lon),
    ground_sigma_mS_m: num(i.ground_sigma_mS_m),
    radial_step_deg:   num(i.radial_step_deg) || 10,
    pattern_table:     i.pattern_mode === 'DA' ? i.pattern_table : null
  };
}
function num(s){
  if (s === null || s === undefined || s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
function escapeHtml(s){
  return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
