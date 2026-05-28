// Live Map page — "Enhanced Maps" module.  Pick one saved report and the
// map flies to it and shows its overlays (stations, §73.333 contours, and
// future vector layers).  Renders MapLibre with the shared TopNav.

import React, { useEffect, useMemo, useState } from 'react';
import TopNav from './TopNav.jsx';
import MapView from '@components/map/MapView.jsx';

// Overlays planned for the module — wired in as their data lands.
const COMING = ['Terrain / hillshade', 'Tree canopy', 'Water', 'Brush', 'Fire risk', 'Soil / conductivity'];

export default function MapPage({ authed, onNavigate, onLogout }){
  const [exhibits, setExhibits]     = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [overlays, setOverlays]     = useState({ stations: true, contours: true });
  const [status, setStatus]         = useState(null);
  const [err, setErr]               = useState(null);

  useEffect(() => {
    fetch('/api/map/exhibits', { credentials: 'same-origin' })
      .then(r => (r.ok ? r.json() : []))
      .then(rows => {
        const list = Array.isArray(rows) ? rows : [];
        setExhibits(list);
        setSelectedId(prev => prev ?? (list[0]?.id ?? null));
      })
      .catch(() => {});
  }, []);

  const selected = useMemo(
    () => exhibits.find(e => e.id === selectedId) || null,
    [exhibits, selectedId]
  );
  const label = e => `${e.call || e.facility_id || 'exhibit'}${e.facility_id ? ' · ' + e.facility_id : ''}`;
  const toggle = key => setOverlays(o => ({ ...o, [key]: !o[key] }));

  return (
    <div className="relative bg-black text-cream" style={{ height: '100vh', width: '100%', overflow: 'hidden' }}>
      <TopNav current="map" authed={!!authed} onNavigate={onNavigate} onLogout={onLogout} />
      <MapView
        onStatus={(s) => { if (s?.kind === 'error') setErr(s.text); else setStatus(s); }}
        selected={selected}
        overlays={overlays}
      />

      {/* Enhanced Maps control panel */}
      <div className="absolute top-3 left-4 z-30 w-64 rounded border border-rule bg-black/75 backdrop-blur-sm px-3 py-2.5 font-mono text-[11px]">
        <div className="text-cream tracking-rack uppercase text-[10px]">Genoa · Live Map</div>

        <div className="mt-2 text-textDim text-[9px] uppercase tracking-rack">Report</div>
        <select
          value={selectedId ?? ''}
          onChange={e => setSelectedId(Number(e.target.value))}
          className="mt-1 w-full bg-black/60 border border-rule rounded px-2 py-1 text-cream text-[11px]"
        >
          {exhibits.length === 0 && <option value="">— no saved reports —</option>}
          {exhibits.map(e => <option key={e.id} value={e.id}>{label(e)}</option>)}
        </select>

        <div className="mt-3 text-textDim text-[9px] uppercase tracking-rack">Overlays</div>
        <label className="flex items-center gap-2 mt-1 cursor-pointer text-cream">
          <input type="checkbox" checked={overlays.stations} onChange={() => toggle('stations')} /> Stations
        </label>
        <label className="flex items-center gap-2 mt-0.5 cursor-pointer text-cream">
          <input type="checkbox" checked={overlays.contours} onChange={() => toggle('contours')} /> §73.333 contours
        </label>
        {COMING.map(name => (
          <label key={name} className="flex items-center gap-2 mt-0.5 text-textDim/50">
            <input type="checkbox" disabled /> {name}
            <span className="ml-auto text-[8px] uppercase tracking-rack opacity-70">soon</span>
          </label>
        ))}

        {status && <div className="mt-2 text-textDim/80 text-[9px] break-words">{status.text}</div>}
        {err && <div className="mt-1 text-red-400 text-[9px] break-words">error: {err}</div>}
      </div>
    </div>
  );
}
