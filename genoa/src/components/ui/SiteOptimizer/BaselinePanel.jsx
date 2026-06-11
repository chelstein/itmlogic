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
function fmtPopulation(n){
  if (n == null || !Number.isFinite(Number(n))) return '—';
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${Math.round(n / 1e3)}K`;
  return String(Math.round(n));
}
function fieldColor(mvm){
  if (mvm == null) return '#9b9b9b';
  if (mvm >= 5)    return '#63d471';
  if (mvm >= 0.5)  return '#ffb347';
  return '#ff7a7a';
}
const CONFIDENCE_COLOR = { HIGH: '#63d471', MEDIUM: '#ffb347', LOW: '#ff7a7a' };

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
          {baseline.ground_sigma_quality && (
            <span
              className="font-mono text-[8px] uppercase tracking-rack mt-0.5"
              style={{
                color: baseline.ground_sigma_quality === 'EXCELLENT' ? '#63d471'
                     : baseline.ground_sigma_quality === 'GOOD'      ? '#a8d46a'
                     : baseline.ground_sigma_quality === 'FAIR'      ? '#ffb347'
                     : '#ff7a7a'
              }}
            >
              {baseline.ground_sigma_quality}
            </span>
          )}
          {baseline.ground_sigma_source && (
            <span className="font-mono text-[9px] text-textDim leading-tight mt-0.5">
              {baseline.ground_sigma_source}
            </span>
          )}
        </div>
        {baseline.rank_percentile != null && (
          <div className="flex flex-col">
            <span className="rack-eyebrow">Site rank</span>
            <span className="font-mono text-[13px] text-textDim">
              {baseline.rank_percentile.toFixed(0)}
              <span className="text-[10px] ml-0.5">th pct</span>
            </span>
          </div>
        )}
        {baseline.field_at_col_centroid_mvm != null && (
          <div className="flex flex-col">
            <span className="rack-eyebrow">COL centroid field</span>
            <span className="font-mono text-[13px]" style={{ color: fieldColor(baseline.field_at_col_centroid_mvm) }}>
              {fmtNum(baseline.field_at_col_centroid_mvm, 2)}
              <span className="text-textDim ml-1">mV/m</span>
            </span>
          </div>
        )}
        {baseline.estimated_daytime_population_served != null && (
          <div className="flex flex-col">
            <span className="rack-eyebrow">Est. served</span>
            <span className="font-mono text-[13px] text-textDim">
              {fmtPopulation(baseline.estimated_daytime_population_served)}
              <span className="text-[10px] ml-0.5">@0.5 mV/m</span>
            </span>
          </div>
        )}
        {baseline.score_confidence && (
          <div className="flex flex-col">
            <span className="rack-eyebrow">Score confidence</span>
            <span
              className="font-mono text-[11px] uppercase tracking-rack"
              style={{ color: CONFIDENCE_COLOR[baseline.score_confidence] ?? '#9b9b9b' }}
            >
              {baseline.score_confidence}
            </span>
          </div>
        )}
        {baseline.power_class_ceiling_kw != null && (
          <div className="flex flex-col">
            <span className="rack-eyebrow">Class ceiling</span>
            <span className="font-mono text-[13px] text-textDim">
              {baseline.power_class_ceiling_kw}
              <span className="text-[10px] ml-0.5">kW §73.21</span>
            </span>
          </div>
        )}
        {baseline.col_coverage_gap_pct > 0 && (
          <div className="flex flex-col">
            <span className="rack-eyebrow">COL gap</span>
            <span className="font-mono text-[13px]" style={{ color: '#ff7a7a' }}>
              +{(baseline.col_coverage_gap_pct * 100).toFixed(0)}
              <span className="text-[10px] ml-0.5">% needed</span>
            </span>
          </div>
        )}
      </div>
      {(baseline.minimum_tpo_for_col_coverage_kw != null || baseline.minimum_tpo_for_compliance_kw != null) && (
        <div className="mt-2 space-y-1">
          {baseline.minimum_tpo_for_col_coverage_kw != null && (
            <div className="font-mono text-[9px] leading-tight" style={{ color: '#ffb347' }}>
              §73.24(i): current site needs ≥ {baseline.minimum_tpo_for_col_coverage_kw} kW to reach 5 mV/m at COL centroid
            </div>
          )}
          {baseline.minimum_tpo_for_compliance_kw != null && (
            <div className="font-mono text-[9px] leading-tight" style={{ color: '#ff7a7a' }}>
              §73.24(g): current site needs TPO ≤ {baseline.minimum_tpo_for_compliance_kw} kW to stay under 1% blanket pop
            </div>
          )}
        </div>
      )}
      {baseline.regulatory_compliance_summary && (() => {
        const rcs = baseline.regulatory_compliance_summary;
        const rowColor = s => s === 'PASS' ? '#63d471' : s === 'FAIL' ? '#ff5a5a' : s === 'ADVISORY' ? '#ffb347' : '#a89c84';
        const entries = [
          { label: '§73.24(i) COL', entry: rcs.col_coverage },
          { label: '§73.24(g) Blanket', entry: rcs.blanket_pop },
          { label: '§73.21 Class power', entry: rcs.class_power },
          { label: 'Treaty zone', entry: rcs.treaty_zone }
        ];
        return (
          <div className="mt-2 border-t border-rule pt-2">
            <div className="rack-eyebrow mb-1">Current site compliance</div>
            <div className="flex gap-4 flex-wrap font-mono text-[9px]">
              {entries.map(({ label, entry }) => (
                <div key={label} className="flex items-center gap-1">
                  <span className="text-textDim">{label}</span>
                  <span style={{ color: rowColor(entry.status) }}>{entry.status}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}
    </div>
  );
}
