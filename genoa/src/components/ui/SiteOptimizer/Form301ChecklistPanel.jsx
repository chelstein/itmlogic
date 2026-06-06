import React, { useState } from 'react';
import RackPanel from '../RackPanel.jsx';

const STATUS_CONFIG = {
  REQUIRED:    { color: '#ff9b5a', bg: 'rgba(255,155,90,0.10)', border: 'rgba(255,155,90,0.45)' },
  CONDITIONAL: { color: '#7ec8e3', bg: 'rgba(126,200,227,0.08)', border: 'rgba(126,200,227,0.35)' },
  ADVISORY:    { color: '#9b9b9b', bg: 'rgba(155,155,155,0.07)', border: 'rgba(155,155,155,0.30)' },
};

function StatusChip({ status }){
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.ADVISORY;
  return (
    <span
      className="font-mono text-[9px] uppercase tracking-rack border rounded-sm px-1.5 py-0.5 shrink-0"
      style={{ color: cfg.color, background: cfg.bg, borderColor: cfg.border }}
    >
      {status}
    </span>
  );
}

function ChecklistRow({ item, index }){
  const [open, setOpen] = useState(false);

  return (
    <li className="border-b border-rule last:border-0">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-start gap-2 py-2 text-left group"
      >
        <span className="font-mono text-[9px] mt-0.5 shrink-0 w-4 text-right text-textDim">
          {index + 1}.
        </span>
        <StatusChip status={item.status} />
        <span className="font-mono text-[10px] text-textMain leading-snug flex-1 pr-2">
          {item.description}
        </span>
        <span
          className="font-mono text-[9px] text-textDim shrink-0 mt-0.5 transition-transform"
          style={{ transform: open ? 'rotate(180deg)' : 'none' }}
        >
          ▾
        </span>
      </button>
      {open && (
        <div className="pb-2 pl-6 pr-2 space-y-0.5">
          <div className="font-mono text-[9px] text-textDim leading-snug">
            <span className="text-textDim opacity-60">Rule: </span>{item.rule}
          </div>
          {item.note && (
            <div className="font-mono text-[9px] text-amberDim leading-snug italic">
              {item.note}
            </div>
          )}
        </div>
      )}
    </li>
  );
}

export default function Form301ChecklistPanel({ checklist }){
  if (!checklist || checklist.length === 0) return null;

  const requiredCount = checklist.filter(i => i.status === 'REQUIRED').length;

  return (
    <RackPanel
      eyebrow="Pre-filing checklist"
      title="FCC Form 301-AM Filing Requirements"
      italicAccent={`${requiredCount} required items — verify with a licensed broadcast engineer before filing.`}
      dense
    >
      <ul className="divide-y divide-rule">
        {checklist.map((item, i) => (
          <ChecklistRow key={item.id} item={item} index={i} />
        ))}
      </ul>
      <p className="font-mono text-[9px] text-textDim leading-tight mt-2">
        REQUIRED: mandatory for filing. CONDITIONAL: required if trigger applies.
        Expand each row for the CFR rule cite and engineering note.
      </p>
    </RackPanel>
  );
}
