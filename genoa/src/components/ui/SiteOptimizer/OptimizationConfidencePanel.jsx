import React from 'react';
import RackPanel from '../RackPanel.jsx';

// OptimizationConfidencePanel — right-rail panel showing the engine's
// self-reported confidence level (HIGH / MEDIUM / LOW), the data layers
// that contributed to that rating, and per-goal score distribution stats.

const LEVEL_PALETTE = {
  HIGH:   { fg: '#63d471', bg: 'rgba(99,212,113,0.10)',  border: 'rgba(99,212,113,0.45)'  },
  MEDIUM: { fg: '#ffb347', bg: 'rgba(255,179,71,0.10)',  border: 'rgba(255,179,71,0.45)'  },
  LOW:    { fg: '#ff5a5a', bg: 'rgba(255,90,90,0.12)',   border: 'rgba(255,90,90,0.55)'   }
};

const LAYER_LABELS = {
  fcc_groundwave_engine:          'FCC groundwave engine',
  m3_conductivity_raster:         'M3 conductivity raster (filing-grade σ)',
  blanket_population_proxy:       'Blanket population proxy',
  international_border_detection: 'International border detection',
  col_polygon_provided:           'COL polygon (user-supplied)',
  infrastructure_inventory:       'Infrastructure inventory (co-location)',
};

function fmtNum(v, d = 1){
  if (v == null || !Number.isFinite(Number(v))) return '—';
  return Number(v).toFixed(d);
}

export default function OptimizationConfidencePanel({ confidence, scoreStats, conductivityMode, nInfrastructureSites }){
  if (!confidence && !scoreStats) return null;

  const level = confidence?.level;
  const pal = LEVEL_PALETTE[level] || LEVEL_PALETTE.LOW;
  const layers = confidence?.contributing_layers || [];
  const notes  = confidence?.notes || [];

  return (
    <RackPanel eyebrow="Engine confidence" title="Optimization signal quality" dense>
      <div className="space-y-4">

        {/* Confidence level badge */}
        {level && (
          <div className="flex items-center gap-2">
            <span
              className="font-mono tracking-rack uppercase border rounded-sm px-2 py-1 text-[11px]"
              style={{ color: pal.fg, background: pal.bg, borderColor: pal.border }}
            >
              {level}
            </span>
            <span className="font-mono text-[11px] text-textDim">
              {level === 'HIGH'   ? 'Multiple real data layers active'   :
               level === 'MEDIUM' ? 'Partial real data; some proxies'    :
                                    'Screening proxies only — limited data'}
            </span>
          </div>
        )}

        {/* Contributing layers */}
        {layers.length > 0 && (
          <div>
            <div className="rack-eyebrow mb-1">Active data layers</div>
            <ul className="space-y-0.5">
              {layers.map(l => (
                <li key={l} className="flex items-center gap-1.5 font-mono text-[10px]">
                  <span style={{ color: '#63d471' }}>✓</span>
                  <span className="text-cream">{LAYER_LABELS[l] || l.replace(/_/g, ' ')}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Score distribution */}
        {scoreStats && (
          <div>
            <div className="rack-eyebrow mb-1">Score distribution</div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 font-mono text-[10px]">
              <div><span className="text-textDim">Mean</span>  <span className="text-cream ml-1">{fmtNum(scoreStats.mean)}</span></div>
              <div><span className="text-textDim">σ</span>     <span className="text-cream ml-1">{fmtNum(scoreStats.std_dev)}</span></div>
              <div><span className="text-textDim">Min</span>   <span className="text-cream ml-1">{fmtNum(scoreStats.min)}</span></div>
              <div><span className="text-textDim">Max</span>   <span className="text-cream ml-1">{fmtNum(scoreStats.max)}</span></div>
            </div>
          </div>
        )}

        {/* Data source strip */}
        {(conductivityMode || nInfrastructureSites != null) && (
          <div>
            <div className="rack-eyebrow mb-1">Data sources</div>
            <div className="space-y-0.5 font-mono text-[10px]">
              {conductivityMode && (
                <div className="flex items-center gap-1.5">
                  <span className={conductivityMode === 'raster' ? 'text-green' : 'text-amberDim'}>
                    {conductivityMode === 'raster' ? '●' : '○'}
                  </span>
                  <span className="text-textDim">Ground σ:</span>
                  <span className={conductivityMode === 'raster' ? 'text-green' : 'text-amber'}>
                    {conductivityMode === 'raster' ? 'M3 GeoTIFF (filing-grade)' : 'M3 zone table (screening-grade)'}
                  </span>
                </div>
              )}
              {nInfrastructureSites != null && (
                <div className="flex items-center gap-1.5">
                  <span className={nInfrastructureSites > 0 ? 'text-cyan' : 'text-textDim'}>●</span>
                  <span className="text-textDim">Infrastructure inventory:</span>
                  <span className={nInfrastructureSites > 0 ? 'text-cyan' : 'text-textDim'}>
                    {nInfrastructureSites > 0 ? `${nInfrastructureSites} site${nInfrastructureSites === 1 ? '' : 's'}` : 'none in radius'}
                  </span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Engine notes */}
        {notes.length > 0 && (
          <div>
            <div className="rack-eyebrow mb-1">Notes</div>
            <ul className="space-y-1">
              {notes.map((n, i) => (
                <li key={i} className="font-mono text-[9px] text-amberDim leading-tight">{n}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </RackPanel>
  );
}
