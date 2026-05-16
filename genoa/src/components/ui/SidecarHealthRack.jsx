import React, { useEffect, useMemo, useRef, useState } from 'react';
import RackPanel from './RackPanel.jsx';
import LedStatus  from './LedStatus.jsx';
import FindingBadge from './FindingBadge.jsx';

// SidecarHealthRack — a richer companion to ServiceHealthPanel.
//
// Polls /readyz every 30 s and groups the result by category
// (core / sidecar / upstream).  For every row we render:
//   • a status LED (nominal / degraded / blocked / offline)
//   • the display label
//   • a role badge ("sidecar" / "upstream" / "core")
//   • the measured latency in ms (or a one-word reason)
//
// This component is intentionally read-only — it makes no mutating
// calls and the polling is AbortControlled on unmount.

const POLL_MS    = 30_000;
const SLOW_MS    = 1_500;
const READYZ_URL = '/readyz';

const KNOWN = [
  // [key, label, role]
  ['api',         'Genoa API',                  'core'],
  ['db',          'Postgres',                   'core'],
  ['terrain',     'Terrain',                    'sidecar'],
  ['splat',       'SPLAT (ITM)',                'sidecar'],
  ['map',         'Map render',                 'sidecar'],
  ['identity',    'Identity (RadioDNS)',        'sidecar'],
  ['nec',         'NEC2++',                     'sidecar'],
  ['measurement', 'Measurement',                'sidecar'],
  ['los',         'LOS (ZTR)',                  'sidecar'],
  ['facility',    'Facility (ZTR)',             'upstream'],
  ['asr',         'ASR (FCC opendata)',         'upstream'],
  ['faaOe',       'FAA OE/AAA',                 'upstream'],
  ['population',  'Population',                 'upstream'],
  ['fccContours', 'FCC contours',               'upstream'],
  ['fccLms',      'FCC LMS',                    'upstream']
];

function ledFor(entry){
  if (!entry) return 'offline';
  if (!entry.configured) return 'offline';
  if (!entry.healthy) return 'blocked';
  if (entry.latency_ms != null && entry.latency_ms > SLOW_MS) return 'degraded';
  return 'nominal';
}

function statusToFinding(led){
  switch (led){
    case 'nominal':  return 'PASS';
    case 'degraded': return 'ADVISORY';
    case 'blocked':  return 'FAIL';
    default:         return 'NOT_RUN';
  }
}

function latencyText(entry){
  if (!entry) return '—';
  if (!entry.configured) return 'not configured';
  if (!entry.healthy) {
    return entry.latency_ms != null ? `unreachable · ${entry.latency_ms} ms` : 'unreachable';
  }
  return entry.latency_ms != null ? `${entry.latency_ms} ms` : 'reachable';
}

function CategorySection({ title, rows }){
  if (!rows || rows.length === 0) return null;
  return (
    <section className="mb-3 last:mb-0">
      <div className="font-mono text-[10px] uppercase tracking-rack text-textDim mb-1.5">
        {title} · {rows.length}
      </div>
      <ul className="divide-y divide-rule border border-rule rounded-sm bg-[#0d1b22]">
        {rows.map(({ key, label, role, entry }) => {
          const led = ledFor(entry);
          return (
            <li key={key} className="flex items-center justify-between gap-3 px-2 py-1.5">
              <div className="flex items-center gap-2 min-w-0">
                <LedStatus status={led} label="" />
                <span className="font-mono text-[11px] uppercase tracking-rack text-text truncate">
                  {label}
                </span>
                <FindingBadge status={statusToFinding(led)} />
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="font-mono text-[10px] uppercase tracking-rack text-textDim">
                  {role}
                </span>
                <span className="font-mono text-[10px] uppercase tracking-rack text-textDim">
                  {latencyText(entry)}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export default function SidecarHealthRack(){
  const [snap, setSnap]       = useState(null);
  const [error, setError]     = useState(null);
  const [updated, setUpdated] = useState(null);
  const aborter = useRef(null);

  async function probe(){
    if (aborter.current) aborter.current.abort();
    const ac = new AbortController();
    aborter.current = ac;
    try {
      const r = await fetch(READYZ_URL, { signal: ac.signal, cache: 'no-store' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      setSnap(j);
      setError(null);
      setUpdated(new Date());
    } catch (e){
      if (e?.name === 'AbortError') return;
      setError(e?.message || String(e));
    }
  }

  useEffect(() => {
    probe();
    const id = setInterval(probe, POLL_MS);
    return () => { clearInterval(id); aborter.current?.abort(); };
  }, []);

  const grouped = useMemo(() => {
    const sidecars = snap?.sidecars || {};
    const apiEntry = error
      ? { configured: true, healthy: false }
      : (snap ? { configured: true, healthy: true, latency_ms: null } : null);
    const dbEntry = !snap
      ? null
      : (snap.db_configured
          ? { configured: true,  healthy: !!snap.db_healthy }
          : { configured: false, healthy: false });

    const seen = new Set(KNOWN.map(r => r[0]));
    const tail = Object.keys(sidecars)
      .filter(k => !seen.has(k))
      .sort()
      .map(k => [k, k.replace(/_/g, ' '), 'sidecar']);

    const rows = [...KNOWN, ...tail].map(([key, label, role]) => {
      let entry = null;
      if (key === 'api') entry = apiEntry;
      else if (key === 'db') entry = dbEntry;
      else entry = sidecars[key] || null;
      return { key, label, role, entry };
    });

    return {
      core:     rows.filter(r => r.role === 'core'),
      sidecar:  rows.filter(r => r.role === 'sidecar'),
      upstream: rows.filter(r => r.role === 'upstream')
    };
  }, [snap, error]);

  const ts = updated ? updated.toLocaleTimeString(undefined, { hour12: false }) : '—';
  const totals = useMemo(() => {
    const all = [...grouped.core, ...grouped.sidecar, ...grouped.upstream];
    let nom = 0, deg = 0, blk = 0, off = 0;
    for (const r of all){
      const s = ledFor(r.entry);
      if (s === 'nominal')  nom++;
      else if (s === 'degraded') deg++;
      else if (s === 'blocked')  blk++;
      else off++;
    }
    return { nom, deg, blk, off };
  }, [grouped]);

  return (
    <RackPanel
      eyebrow="Diagnostics"
      title="Sidecar health"
      italicAccent="Polled every 30 s.  One row per dependency, grouped by role."
      tone="cyan"
      dense
      right={(
        <button
          type="button"
          onClick={probe}
          className="font-mono text-[10px] uppercase tracking-rack text-textDim hover:text-text"
          title="Refresh now"
        >Refresh</button>
      )}
    >
      <div className="flex items-center gap-2 mb-3 font-mono text-[10px] uppercase tracking-rack">
        <FindingBadge status="PASS"     label={`${totals.nom} ok`}       />
        <FindingBadge status="ADVISORY" label={`${totals.deg} slow`}     />
        <FindingBadge status="FAIL"     label={`${totals.blk} blocked`}  />
        <FindingBadge status="SKIP"     label={`${totals.off} off`}      />
      </div>
      <CategorySection title="Core"     rows={grouped.core}     />
      <CategorySection title="Sidecars" rows={grouped.sidecar}  />
      <CategorySection title="Upstream" rows={grouped.upstream} />
      <div className="pt-2 mt-2 border-t border-rule font-mono text-[10px] tracking-rack uppercase text-textDim flex items-center justify-between">
        <span>Last poll · {ts}</span>
        {error && <span className="text-red">{error}</span>}
      </div>
    </RackPanel>
  );
}
