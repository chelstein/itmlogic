import React, { useState } from 'react';
import RackPanel from '../RackPanel.jsx';

const NIF_COLOR = { true: '#ff9b5a', false: '#63d471' };
const CHANNEL_CLASS_LABEL = {
  local:         'Local (§73.27)',
  regional:      'Regional (§73.26)',
  clear_channel: 'Clear channel (§73.25)'
};
const PROTECTION_TYPE_COLOR = {
  DOMINANT_EXCLUSIVE: '#63d471',
  SECONDARY:          '#ffb347',
  REGIONAL_SHARING:   '#7ec8e3',
  MINIMAL:            '#9b9b9b'
};

function ProtChip({ type }){
  const color = PROTECTION_TYPE_COLOR[type] ?? '#9b9b9b';
  return (
    <span
      className="font-mono text-[8px] uppercase tracking-rack border rounded-sm px-1.5 py-0 align-middle"
      style={{ color, borderColor: color + '66', background: color + '18' }}
    >
      {type.replace(/_/g, ' ')}
    </span>
  );
}

function ConstraintRow({ item }){
  const [open, setOpen] = useState(false);
  return (
    <li className="border-b border-rule last:border-0">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-start gap-2 py-1.5 text-left"
      >
        <span className="font-mono text-[9px] text-textDim shrink-0 mt-0.5">›</span>
        <span className="font-mono text-[10px] text-textMain leading-snug flex-1">{item.constraint}</span>
        <span className="font-mono text-[9px] text-textDim shrink-0 mt-0.5" style={{ transform: open ? 'rotate(90deg)' : 'none' }}>▸</span>
      </button>
      {open && (
        <div className="pb-1.5 pl-4 pr-2 space-y-0.5">
          <div className="font-mono text-[9px] text-amberDim leading-snug">{item.threshold}</div>
          <div className="font-mono text-[9px] text-textDim leading-snug opacity-70">{item.rule}</div>
        </div>
      )}
    </li>
  );
}

export default function ProtectionRequirementsPanel({ protection_requirements }){
  if (!protection_requirements) return null;

  const pr = protection_requirements;
  const nifColor = NIF_COLOR[pr.nif_study_required] ?? '#9b9b9b';

  return (
    <RackPanel
      eyebrow="Interference protection"
      title="§73.182 Protection Requirements"
      italicAccent="Station-class analysis — verify with §73.182 / §73.37 tables before filing."
      dense
    >
      <div className="space-y-3 font-mono text-[10px]">
        {/* Header row */}
        <div className="flex gap-4 flex-wrap items-center">
          <div>
            <span className="text-textDim">Channel class: </span>
            <span className="text-cream">{CHANNEL_CLASS_LABEL[pr.channel_class] ?? pr.channel_class}</span>
          </div>
          <div>
            <span className="text-textDim">FCC class: </span>
            <span className="text-cream">{pr.station_class}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-textDim">NIF study:</span>
            <span style={{ color: nifColor }} className="uppercase tracking-rack text-[9px]">
              {pr.nif_study_required ? 'REQUIRED' : 'NOT REQUIRED'}
            </span>
          </div>
        </div>

        {/* Co-channel protection received */}
        <div>
          <div className="rack-eyebrow mb-1">Protection received (co-channel)</div>
          <div className="flex items-start gap-2">
            <ProtChip type={pr.receives_co_channel_protection.type} />
            <div className="flex-1 leading-snug text-textDim text-[9px]">
              {pr.receives_co_channel_protection.description}
              {pr.receives_co_channel_protection.protected_contour_mvm != null && (
                <span className="text-cream ml-1">({pr.receives_co_channel_protection.protected_contour_mvm} mV/m protected)</span>
              )}
              <div className="opacity-60 mt-0.5">{pr.receives_co_channel_protection.rule}</div>
            </div>
          </div>
        </div>

        {/* Constraints to satisfy */}
        <div>
          <div className="rack-eyebrow mb-1">Must demonstrate (interference constraints)</div>
          <ul className="divide-y divide-rule">
            {pr.must_protect_against_interference.map((item, i) => (
              <ConstraintRow key={i} item={item} />
            ))}
          </ul>
        </div>

        {/* NIF notes */}
        <div className="text-[9px] leading-snug" style={{ color: nifColor }}>
          {pr.nif_study_notes}
        </div>

        {/* Adjacent channel summary */}
        <div>
          <div className="rack-eyebrow mb-1">Adjacent-channel D/U requirements</div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-[9px]">
            {[
              ['−10 kHz', pr.adjacent_channel_advisory.minus_10khz],
              ['+10 kHz', pr.adjacent_channel_advisory.plus_10khz],
              ['−20 kHz', pr.adjacent_channel_advisory.minus_20khz],
              ['+20 kHz', pr.adjacent_channel_advisory.plus_20khz]
            ].map(([label, entry]) => (
              <div key={label} className="flex gap-2">
                <span className="text-textDim">{label}:</span>
                <span className="text-cream">{entry.protection_db} dB D/U</span>
              </div>
            ))}
          </div>
          <div className="text-[9px] text-textDim mt-1 leading-tight opacity-70">
            {pr.adjacent_channel_advisory.note}
          </div>
        </div>
      </div>
    </RackPanel>
  );
}
