import React, { useState } from 'react';

// LimitationsGlobalPanel — accordion below the candidate table that shows
// (a) engine run-time warnings (code-tagged, may be empty) and
// (b) the limitations_global array from the engine.
// Always collapsed by default so it doesn't dominate the layout, but the
// engineer must be able to see what's NOT being checked.

const WARNING_COLORS = {
  TPO_EXCEEDS_CLASS_MAX:       { color: '#ff7a7a', label: 'Power limit exceeded' },
  TPO_BELOW_CLASS_MIN:         { color: '#ff7a7a', label: 'Power below class min' },
  DA_MODE_REQUIRED:            { color: '#ffb347', label: 'DA mode' },
  ADJACENT_TO_CLEAR_CHANNEL:   { color: '#ffb347', label: 'Adjacent clear channel' },
  COL_CURVE_FAILED:            { color: '#ff7a7a', label: 'Curve failure' },
  GRID_SPACING_LARGE:          { color: '#ffb347', label: 'Grid spacing' },
  COL_CENTROID_INVALID:        { color: '#ffb347', label: 'COL centroid invalid' },
};

export default function LimitationsGlobalPanel({ limitations, warnings }){
  const [open, setOpen] = useState(false);
  const hasWarnings = Array.isArray(warnings) && warnings.length > 0;
  const hasLimits   = Array.isArray(limitations) && limitations.length > 0;
  if (!hasWarnings && !hasLimits) return null;

  const totalCount = (hasWarnings ? warnings.length : 0) + (hasLimits ? limitations.length : 0);
  const hasUrgent  = hasWarnings && warnings.some(w => {
    const code = w?.code || '';
    return code.includes('EXCEEDS') || code.includes('FAILED');
  });

  return (
    <div className="border border-rule rounded-sm bg-panelDeep font-mono text-[10px]">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-amber/5 transition-colors"
        aria-expanded={open}
      >
        <span className="flex items-center gap-2">
          <span className={`uppercase tracking-rack ${hasUrgent ? 'text-red' : 'text-amberDim'}`}>
            {hasUrgent ? 'Warnings & limitations' : 'Screening limitations'} ({totalCount})
          </span>
          {hasWarnings && (
            <span
              className="inline-flex items-center border rounded-sm px-1.5 py-0.5 text-[9px] uppercase tracking-rack"
              style={hasUrgent
                ? { color: '#ff7a7a', background: 'rgba(255,90,90,0.10)', borderColor: 'rgba(255,90,90,0.45)' }
                : { color: '#ffb347', background: 'rgba(255,179,71,0.10)', borderColor: 'rgba(255,179,71,0.45)' }}
            >
              {warnings.length} warning{warnings.length === 1 ? '' : 's'}
            </span>
          )}
        </span>
        <span className="text-textDim ml-2">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="border-t border-rule">
          {hasWarnings && (
            <ul className="px-3 py-2 space-y-1.5">
              {warnings.map((w, i) => {
                const cfg = WARNING_COLORS[w?.code] ?? null;
                const color = cfg?.color ?? '#ffb347';
                const label = cfg?.label ?? (w?.code ?? 'Warning');
                return (
                  <li key={i} className="space-y-0.5">
                    <div className="flex items-center gap-1.5">
                      <span style={{ color }} className="shrink-0">▲</span>
                      <span
                        className="border rounded-sm px-1 py-0"
                        style={{ color, borderColor: `${color}55`, background: `${color}11` }}
                      >
                        {label}
                      </span>
                    </div>
                    <p className="text-textDim leading-snug pl-4">{w?.message ?? String(w)}</p>
                  </li>
                );
              })}
            </ul>
          )}
          {hasLimits && (
            <ul className={`px-3 py-2 space-y-1 ${hasWarnings ? 'border-t border-rule' : ''}`}>
              {limitations.map((l, i) => (
                <li key={i} className="flex items-start gap-1.5 text-textDim leading-snug">
                  <span className="text-amber mt-0.5 shrink-0">!</span>
                  <span>{l}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
