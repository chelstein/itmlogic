import React from 'react';

// BaselinePanel — small "current site" stat strip pinned to the top of
// the candidate detail panel.  Always visible (regardless of selection)
// so engineers can read "current KAZM vs candidate N" without scrolling.

function Stat({ label, value, unit, tone }){
  const color = tone === 'amber' ? '#ffb347'
              : tone === 'cyan'  ? '#6fd3ff'
              : tone === 'green' ? '#63d471'
              : tone === 'red'   ? '#ff5a5a'
              : '#efe6d6';
  return (
    <div className="flex flex-col">
      <span className="rack-eyebrow">{label}</span>
      <span className="font-mono text-[13px]" style={{ color }}>
        {value}{unit && <span className="text-textDim ml-1">{unit}</span>}
      </span>
    </div>
  );
}

function fmtPct(v){
  if (v == null || !Number.isFinite(Number(v))) return '—';
  // col_coverage_pct is 0..1; multiply to get percent.
  return `${(Number(v) * 100).toFixed(1)}%`;
}
// blanket_population_pct is already a percent value (e.g. 0.6 = 0.6%).
function fmtBlanketPct(v){
  if (v == null || !Number.isFinite(Number(v))) return '—';
  return `${Number(v).toFixed(2)}%`;
}
function fmtNum(v, digits = 1){
  if (v == null || !Number.isFinite(Number(v))) return '—';
  return Number(v).toFixed(digits);
}

export default function BaselinePanel({ callsign, baseline, comparedTo }){
  if (!baseline){
    return (
      <div className="border border-rule rounded-sm p-3 bg-panelDeep">
        <div className="rack-eyebrow mb-1">Current site baseline</div>
        <div className="font-mono text-[11px] text-textDim italic">
          Awaiting search — run a regional sweep to compute the baseline score.
        </div>
      </div>
    );
  }
  return (
    <div className="border border-rule rounded-sm p-3 bg-panelDeep">
      <div className="flex items-baseline justify-between mb-2">
        <div className="rack-eyebrow">Current site baseline</div>
        {comparedTo && (
          <div className="font-mono text-[10px] tracking-rack uppercase text-textDim">
            <span className="text-cream">{callsign || 'CURRENT'}</span>
            <span className="text-textDim mx-1">vs</span>
            <span className="text-amber">candidate #{comparedTo}</span>
          </div>
        )}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        <Stat label="Score"        value={fmtNum(baseline.score)}                        tone="amber" />
        <Stat label="COL coverage" value={fmtPct(baseline.col_coverage_pct)}             tone="cyan"  />
        <Stat label="Daytime reach" value={fmtNum(baseline.daytime_reach_km)} unit="km"  tone="cyan"  />
        <Stat label="Blanket pop"  value={fmtBlanketPct(baseline.blanket_population_pct)} tone="red"  />
        <div className="flex flex-col">
          <Stat label="Ground σ" value={fmtNum(baseline.ground_sigma_mS_m, 0)} unit="mS/m" tone="green" />
          {baseline.ground_sigma_source && (
            <span className="font-mono text-[9px] text-textDim leading-tight mt-0.5">
              {baseline.ground_sigma_source}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
