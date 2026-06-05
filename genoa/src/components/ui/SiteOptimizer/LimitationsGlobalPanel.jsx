import React, { useState } from 'react';

// LimitationsGlobalPanel — accordion below the candidate table that lists
// the engine's limitations_global array.  Always collapsed by default
// so it doesn't dominate the layout, but the engineer must be able to
// see what's NOT being checked.

export default function LimitationsGlobalPanel({ limitations }){
  const [open, setOpen] = useState(false);
  if (!Array.isArray(limitations) || limitations.length === 0) return null;

  return (
    <div className="border border-rule rounded-sm bg-panelDeep font-mono text-[10px]">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-amber/5 transition-colors"
        aria-expanded={open}
      >
        <span className="uppercase tracking-rack text-amberDim">
          Screening limitations ({limitations.length})
        </span>
        <span className="text-textDim ml-2">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <ul className="border-t border-rule px-3 py-2 space-y-1">
          {limitations.map((l, i) => (
            <li key={i} className="flex items-start gap-1.5 text-textDim leading-snug">
              <span className="text-amber mt-0.5 shrink-0">!</span>
              <span>{l}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
