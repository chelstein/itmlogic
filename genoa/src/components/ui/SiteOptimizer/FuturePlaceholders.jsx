import React, { useState } from 'react';
import RackPanel from '../RackPanel.jsx';

// FuturePlaceholders — single rack panel that lists every signal /
// overlay the optimizer is *expected* to grow into.  Each entry is
// collapsed by default with a "(not wired yet)" tag so engineers can
// see the roadmap without mistaking empty UI for a broken pipeline.

const ENTRIES = [
  { id: 'sdr',          label: 'SDR residual overlays' },
  { id: 'conductivity', label: 'Conductivity raster overlay', partial: true },
  { id: 'wildfire',     label: 'Wildfire / fuel heatmaps' },
  { id: 'parcel',       label: 'Parcel / zoning layers' },
  { id: 'psra',         label: 'PSRA / PSSA optimization' },
  { id: 'da_synth',     label: 'DA pattern synthesis' },
  { id: 'infra',        label: 'Road / power / fiber overlays' }
];

export default function FuturePlaceholders({ conductivityMode }){
  const [open, setOpen] = useState({});
  return (
    <RackPanel
      eyebrow="Roadmap Slots"
      title="Future overlays"
      italicAccent="Stubs.  Wired up as the back-end pipelines come online."
      dense
    >
      <ul className="space-y-1.5">
        {ENTRIES.map(e => (
          <li key={e.id} className="border border-rule rounded-sm">
            <button
              onClick={() => setOpen(o => ({ ...o, [e.id]: !o[e.id] }))}
              className="w-full flex items-center justify-between px-2.5 py-1.5 font-mono text-[11px] uppercase tracking-rack text-text hover:text-cream"
            >
              <span className="flex items-center gap-2">
                <span className="text-textDim">{open[e.id] ? '▾' : '▸'}</span>
                <span>{e.label}</span>
              </span>
              <span className={`font-mono text-[9px] uppercase tracking-rack rounded-sm px-1.5 py-0.5 border ${
                e.partial
                  ? 'text-cyan/80 bg-cyan/10 border-cyan/30'
                  : 'text-amberDim bg-amber/10 border-amber/30'
              }`}>
                {e.partial ? 'Partial' : 'Not wired'}
              </span>
            </button>
            {open[e.id] && (
              <div className="border-t border-rule px-3 py-2 font-mono text-[10px] text-textDim">
                {e.id === 'conductivity'
                  ? (conductivityMode === 'raster'
                      ? <span style={{ color: '#63d471' }}>M3 GeoTIFF raster active (filing-grade σ). Visual overlay coming soon.</span>
                      : <span style={{ color: '#6fd3ff' }}>M3 zone-table active (screening-grade). Deploy AM_m3.tif for per-pixel filing-grade raster.</span>)
                  : <>Placeholder.  Layer will render here once the back-end pipeline emits a signal payload for <span className="text-cream">{e.label}</span>.</>
                }
              </div>
            )}
          </li>
        ))}
      </ul>
    </RackPanel>
  );
}
