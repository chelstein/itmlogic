import React, { useState } from 'react';

// MinimumSpacingPanel — §73.37 minimum mileage separation reference table.
// Shows co-channel and adjacent-channel minimum distances (km) for the
// proposed station class vs. each existing station class (A/B/C/D).

const CLASS_COLORS = { A: '#ff9b5a', B: '#ffb347', C: '#7ec8e3', D: '#9b9b9b' };

export default function MinimumSpacingPanel({ data }){
  const [activeTable, setActiveTable] = useState('co_channel');
  if (!data) return null;

  const tables = {
    co_channel:    { label: 'Co-channel (0 kHz)',      key: 'co_channel' },
    adjacent_10khz: { label: '1st adjacent (±10 kHz)', key: 'adjacent_10khz' },
    adjacent_20khz: { label: '2nd adjacent (±20 kHz)', key: 'adjacent_20khz' }
  };

  const rows = data[activeTable] || [];

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <span className="rack-eyebrow">§73.37 minimum separation</span>
        <span className="font-mono text-[9px] text-textDim">Class {data.proposed_class} proposed · {data.channel_class}</span>
      </div>

      {/* Table selector */}
      <div className="flex gap-1">
        {Object.entries(tables).map(([k, { label }]) => (
          <button
            key={k}
            onClick={() => setActiveTable(k)}
            className="font-mono text-[9px] px-1.5 py-0.5 rounded-sm border transition-colors"
            style={{
              borderColor: activeTable === k ? '#b8d0cc55' : '#333',
              background:  activeTable === k ? '#12282e' : 'transparent',
              color:       activeTable === k ? '#b8d0cc' : '#666'
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Separation table */}
      <table className="w-full font-mono text-[10px] border-collapse">
        <thead>
          <tr className="text-textDim text-left">
            <th className="pb-0.5 pr-4 font-normal">Existing class</th>
            <th className="pb-0.5 font-normal text-right">Min. separation</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr key={row.existing_class} className="border-t border-white/5">
              <td className="py-0.5 pr-4">
                <span
                  className="inline-block w-5 text-center font-semibold text-[10px] rounded-sm"
                  style={{ color: CLASS_COLORS[row.existing_class] || '#a89c84' }}
                >
                  {row.existing_class}
                </span>
                <span className="text-textDim ml-1 text-[9px]">
                  Class {row.existing_class}
                </span>
              </td>
              <td className="py-0.5 text-right">
                {row.min_separation_km != null
                  ? <span className="text-cream">{row.min_separation_km.toLocaleString()} km</span>
                  : <span className="text-[#444]">—</span>
                }
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {data.caveat && (
        <p className="font-mono text-[9px] text-textDim leading-relaxed border-t border-rule/30 pt-1.5 mt-1">
          {data.caveat}
        </p>
      )}
    </div>
  );
}
