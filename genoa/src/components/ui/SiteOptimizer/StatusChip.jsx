import React from 'react';
import { tonesFor } from './statusUtil.js';

// StatusChip — compact uppercase label used on rows, markers, tooltips
// and inside the detail drawer.  Borrows tones from statusUtil so every
// surface tells the same story for the same label.

export default function StatusChip({ label, dense = false }){
  const t = tonesFor(label);
  const pad = dense ? 'px-1.5 py-0.5 text-[9px]' : 'px-2 py-0.5 text-[10px]';
  return (
    <span
      className={`inline-block font-mono tracking-rack uppercase border rounded-sm ${pad}`}
      style={{ color: t.fg, background: t.bg, borderColor: t.border }}
    >
      {label}
    </span>
  );
}
