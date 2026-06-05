import React from 'react';

// ScoreBreakdownChart — tiny horizontal bar chart of per-goal points
// contributing to a candidate's composite score.  Pure SVG, no deps.
// Used inside the candidate detail drawer to make the ranking
// explainable at a glance.

const GOAL_COLORS = {
  col_coverage:  '#ffb347',
  population:    '#f3c86d',
  blanket:       '#6fd3ff',
  conductivity:  '#63d471',
  wildfire:      '#e89972',
  treaty_zone:   '#c98aff'
};

const GOAL_LABELS = {
  col_coverage: 'COL coverage',
  population:   'Population',
  blanket:      'Blanket pop.',
  conductivity: 'Conductivity',
  wildfire:     'Wildfire risk',
  treaty_zone:  'Treaty zone'
};

export default function ScoreBreakdownChart({ breakdown, totalScore, baselineBreakdown, baselineTotalScore }){
  const entries = Object.entries(breakdown || {});
  if (entries.length === 0){
    return (
      <div className="font-mono text-[11px] text-textDim italic">
        No per-goal breakdown returned by engine.
      </div>
    );
  }

  const showBaseline = baselineBreakdown && Object.keys(baselineBreakdown).length > 0;

  // Separate contributing (> 0) from non-contributing (= 0) rows.
  const active   = entries.filter(([, v]) => (Number(v) || 0) > 0);
  const inactive = entries.filter(([, v]) => (Number(v) || 0) <= 0);
  // Scale bars against the max across candidate + baseline so comparisons are fair.
  const allVals = [
    ...active.map(([, v]) => Number(v) || 0),
    ...(showBaseline ? active.map(([k]) => Number(baselineBreakdown[k]) || 0) : []),
    1
  ];
  const max = Math.max(...allVals);

  const renderRow = (k, v, dimmed) => {
    const val   = Number(v) || 0;
    const bVal  = showBaseline ? (Number(baselineBreakdown[k]) || 0) : null;
    const pct   = Math.max(0, Math.min(100, (val / max) * 100));
    const bPct  = bVal != null ? Math.max(0, Math.min(100, (bVal / max) * 100)) : null;
    const color = dimmed ? '#3a3a3a' : (GOAL_COLORS[k] || '#a89c84');
    const textColor = dimmed ? '#4a4a4a' : (GOAL_COLORS[k] || '#a89c84');
    const delta = bVal != null ? val - bVal : null;

    return (
      <div key={k} className="space-y-0.5">
        <div className="grid grid-cols-[110px_1fr_54px] items-center gap-2">
          <span className={`font-mono text-[10px] uppercase tracking-rack ${dimmed ? 'text-[#303030]' : 'text-textDim'}`}>
            {GOAL_LABELS[k] || k}
          </span>
          <div className="relative h-2.5">
            {/* baseline bar — shown as a subtle underlay */}
            {bPct != null && !dimmed && (
              <span
                className="absolute top-0 left-0 block h-full rounded-sm opacity-25"
                style={{ width: `${bPct}%`, background: color }}
              />
            )}
            {/* candidate bar */}
            <span className="block h-2 mt-0.5 rounded-sm bg-[#06141a] border border-rule overflow-hidden relative z-10">
              <span
                className="block h-full"
                style={{ width: `${pct}%`, background: color }}
              />
            </span>
          </div>
          <div className="flex items-baseline justify-end gap-1">
            <span className="font-mono text-[11px] text-right" style={{ color: textColor }}>
              {dimmed ? <span className="text-[10px] italic opacity-40">—</span> : val.toFixed(1)}
            </span>
            {delta != null && !dimmed && (
              <span
                className="font-mono text-[9px]"
                style={{ color: delta > 0 ? '#63d471' : delta < 0 ? '#ff7a7a' : '#666' }}
              >
                {delta > 0 ? `+${delta.toFixed(1)}` : delta.toFixed(1)}
              </span>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between mb-1">
        <span className="rack-eyebrow">Score breakdown</span>
        <div className="flex items-baseline gap-2">
          {showBaseline && baselineTotalScore != null && (
            <span className="font-mono text-[10px] text-textDim">
              baseline <span className="text-textDim opacity-60">{(Number(baselineTotalScore) || 0).toFixed(1)}</span>
            </span>
          )}
          <span className="font-mono text-[11px] text-textDim">
            total <span className="text-cream">{(Number(totalScore) || 0).toFixed(1)}</span>
          </span>
        </div>
      </div>
      {showBaseline && (
        <div className="flex items-center gap-2 mb-1.5">
          <span className="flex items-center gap-1">
            <span className="inline-block w-3 h-1.5 rounded-sm opacity-25 bg-textDim" />
            <span className="font-mono text-[9px] text-textDim">baseline (dim)</span>
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-3 h-1.5 rounded-sm bg-textMain" />
            <span className="font-mono text-[9px] text-textDim">candidate</span>
          </span>
        </div>
      )}
      {active.map(([k, v]) => renderRow(k, v, false))}
      {inactive.length > 0 && (
        <div className="border-t border-rule/30 mt-1.5 pt-1.5 space-y-1.5">
          {inactive.map(([k, v]) => renderRow(k, v, true))}
        </div>
      )}
    </div>
  );
}
