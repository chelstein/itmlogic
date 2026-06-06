import React, { useState } from 'react';
import RackPanel from '../RackPanel.jsx';

// Priority colour/label config
const PRIORITY_CONFIG = {
  URGENT: {
    color:  '#ff7a7a',
    bg:     'rgba(255,90,90,0.10)',
    border: 'rgba(255,90,90,0.45)',
    dot:    '#ff4444',
  },
  HIGH: {
    color:  '#ffb347',
    bg:     'rgba(255,179,71,0.10)',
    border: 'rgba(255,179,71,0.45)',
    dot:    '#ffb347',
  },
  MEDIUM: {
    color:  '#7ec8e3',
    bg:     'rgba(126,200,227,0.08)',
    border: 'rgba(126,200,227,0.35)',
    dot:    '#7ec8e3',
  },
  INFORMATIONAL: {
    color:  '#9b9b9b',
    bg:     'rgba(155,155,155,0.07)',
    border: 'rgba(155,155,155,0.30)',
    dot:    '#9b9b9b',
  },
};

function PriorityChip({ priority }){
  const cfg = PRIORITY_CONFIG[priority] ?? PRIORITY_CONFIG.INFORMATIONAL;
  return (
    <span
      className="font-mono text-[9px] uppercase tracking-rack border rounded-sm px-1.5 py-0.5 shrink-0"
      style={{ color: cfg.color, background: cfg.bg, borderColor: cfg.border }}
    >
      {priority}
    </span>
  );
}

function ActionRow({ item, index }){
  const [open, setOpen] = useState(false);
  const cfg = PRIORITY_CONFIG[item.priority] ?? PRIORITY_CONFIG.INFORMATIONAL;

  return (
    <li className="border-b border-rule last:border-0">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-start gap-2 py-2 text-left group"
      >
        {/* index dot */}
        <span
          className="font-mono text-[9px] mt-0.5 shrink-0 w-4 text-right"
          style={{ color: cfg.dot }}
        >
          {index + 1}.
        </span>
        {/* chip */}
        <PriorityChip priority={item.priority} />
        {/* action text */}
        <span className="font-mono text-[10px] text-textMain leading-snug flex-1 pr-2">
          {item.action}
        </span>
        {/* expand arrow */}
        <span
          className="font-mono text-[9px] text-textDim shrink-0 mt-0.5 transition-transform"
          style={{ transform: open ? 'rotate(180deg)' : 'none' }}
        >
          ▾
        </span>
      </button>
      {open && (
        <div className="pb-2 pl-6 pr-2">
          <p className="font-mono text-[9px] text-amberDim leading-snug italic">
            {item.rationale}
          </p>
        </div>
      )}
    </li>
  );
}

export default function RecommendedActionsPanel({ recommended_actions }){
  if (!recommended_actions || recommended_actions.length === 0) return null;

  const urgentCount = recommended_actions.filter(a => a.priority === 'URGENT').length;
  const tone = urgentCount > 0 ? 'danger' : 'default';

  return (
    <RackPanel
      eyebrow="Next steps"
      title="Recommended actions"
      italicAccent="Engine-synthesized; always verify with a licensed broadcast engineer."
      tone={tone}
      dense
    >
      <ul className="divide-y divide-rule">
        {recommended_actions.map((item, i) => (
          <ActionRow key={i} item={item} index={i} />
        ))}
      </ul>
      <p className="font-mono text-[9px] text-textDim leading-tight mt-2">
        Actions are ordered by priority: URGENT → HIGH → MEDIUM → INFORMATIONAL.
        Expand each row to read the regulatory rationale.
      </p>
    </RackPanel>
  );
}
