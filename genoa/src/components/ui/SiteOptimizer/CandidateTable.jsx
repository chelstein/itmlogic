import React, { useMemo, useState } from 'react';
import RackPanel from '../RackPanel.jsx';
import StatusChip from './StatusChip.jsx';
import { primaryStatus, rankColor } from './statusUtil.js';

// CandidateTable — sortable ranked-candidates ledger.  Click a column
// header to sort; click a row to open the detail drawer.  Renders a
// muted "no candidates yet" message before the first search.
//
// Adds (Genoa AM Co-Location Engine):
//   • Source column — GRID / INFRA chip (so the operator knows whether
//     this row comes from greenfield grid scanning or an existing site).
//   • Host column — host_kind + truncated host_owner from
//     colocation_analysis.
//   • Status column — uses StatusChip with the enum status_category if
//     present, otherwise falls back to legacy free-text labels.

const COLUMNS = [
  { key: 'rank',                       label: '#',         align: 'right' },
  { key: 'score',                      label: 'Score',     align: 'right' },
  { key: 'score_delta_vs_baseline',    label: 'Δ Base',    align: 'right' },
  { key: '_source',                    label: 'Source',    align: 'left',  unsortable: true },
  { key: '_host',                      label: 'Host',      align: 'left',  unsortable: true },
  { key: 'distance_from_current_km',   label: 'Dist',      align: 'right' },
  { key: 'bearing_deg',                label: 'Brg',       align: 'right' },
  { key: 'col_coverage_pct',           label: 'COL %',     align: 'right' },
  { key: 'col_coverage_gap_pct',       label: 'COL gap',   align: 'right' },
  { key: 'blanket_population_pct',     label: 'Blkt pop',  align: 'right' },
  { key: 'daytime_reach_km',           label: 'Reach',     align: 'right' },
  { key: 'population_delta_vs_baseline', label: 'Pop Δ',   align: 'right' },
  { key: 'ground_sigma_mS_m',          label: 'σ mS/m',    align: 'right' },
  { key: '_status',                    label: 'Status',    align: 'left',  unsortable: true }
];

function cellValue(c, key){
  if (key === '_status') return c.status_category || primaryStatus(c.status_labels);
  if (key === 'col_coverage_pct') return Number(c.col_coverage_pct) || 0;
  return c[key];
}

function fmt(key, v){
  if (v == null) return '—';
  if (key === 'rank')                 return String(v);
  if (key === 'score')                return Number(v).toFixed(1);
  if (key === 'score_delta_vs_baseline'){
    const n = Number(v);
    if (!Number.isFinite(n)) return '—';
    return (n >= 0 ? `+${n.toFixed(1)}` : n.toFixed(1));
  }
  if (key === 'distance_from_current_km') return `${Number(v).toFixed(1)} km`;
  if (key === 'bearing_deg')             return `${Math.round(Number(v))}°`;
  if (key === 'col_coverage_pct')     return `${(Number(v) * 100).toFixed(0)}%`;
  if (key === 'col_coverage_gap_pct'){
    const n = Number(v);
    return n > 0 ? `+${(n * 100).toFixed(0)}%` : '—';
  }
  if (key === 'blanket_population_pct') return `${Number(v).toFixed(2)}%`;
  if (key === 'daytime_reach_km')     return `${Number(v).toFixed(1)} km`;
  if (key === 'population_delta_vs_baseline'){
    const n = Number(v);
    if (!Number.isFinite(n)) return '—';
    if (Math.abs(n) >= 1e6) return (n >= 0 ? '+' : '') + (n / 1e6).toFixed(2) + 'M';
    if (Math.abs(n) >= 1e3) return (n >= 0 ? '+' : '') + Math.round(n / 1e3) + 'K';
    return (n >= 0 ? '+' : '') + String(Math.round(n));
  }
  if (key === 'ground_sigma_mS_m')    return Number.isFinite(Number(v)) ? Number(v).toFixed(0) : '—';
  return String(v);
}

function sigmaColor(v){
  const n = Number(v);
  if (!Number.isFinite(n)) return '#6b6b5e';
  if (n >= 8)  return '#63d471';   // EXCELLENT
  if (n >= 4)  return '#a8d46a';   // GOOD
  if (n >= 2)  return '#ffb347';   // FAIR
  return '#ff7a7a';                // POOR
}

function SourceChip({ source }){
  const isInfra = source === 'INFRASTRUCTURE';
  const fg     = isInfra ? '#6fd3ff' : '#d6a36a';
  const bg     = isInfra ? 'rgba(111,211,255,0.10)' : 'rgba(214,163,106,0.10)';
  const border = isInfra ? 'rgba(111,211,255,0.45)' : 'rgba(214,163,106,0.45)';
  const text   = isInfra ? 'INFRA' : (source ? 'GRID' : '—');
  return (
    <span
      className="inline-flex items-center font-mono tracking-rack uppercase border rounded-sm px-1.5 py-0.5 text-[9px]"
      style={{ color: fg, background: bg, borderColor: border }}
      title={source || 'GRID'}
    >
      {text}
    </span>
  );
}

function HostCell({ candidate }){
  const a = candidate?.colocation_analysis;
  if (!a) return <span className="text-textDim">—</span>;
  const kind = (a.host_kind || '').replace(/_/g, ' ');
  const owner = (a.host_owner || '').toString();
  const ownerShort = owner.length > 22 ? owner.slice(0, 21) + '…' : owner;
  return (
    <span className="text-cream" title={`${a.host_kind || '—'} · ${owner || '—'}`}>
      <span className="text-textDim">{kind || '—'}</span>
      {ownerShort && <span className="ml-1">· {ownerShort}</span>}
    </span>
  );
}

const STATUS_FILTERS = [
  { value: '', label: 'All' },
  { value: 'PROMISING', label: 'Promising' },
  { value: 'REVIEW_REQUIRED', label: 'Review req.' },
  { value: 'RECOVERABLE_WITH_DA', label: 'Rec. DA' },
  { value: 'RECOVERABLE_WITH_POWER_INCREASE', label: 'Rec. power↑' },
  { value: 'RECOVERABLE_WITH_REDUCED_POWER', label: 'Rec. power↓' },
  { value: 'RECOVERABLE_WITH_COL_CHANGE', label: 'Rec. COL' },
  { value: 'TREATY_REVIEW', label: 'Treaty' },
  { value: 'NON_COMPLIANT', label: 'Non-compliant' }
];

export default function CandidateTable({ candidates, selectedRank, onSelect, evaluated, returned, countByStatus }){
  const [sortKey, setSortKey] = useState('rank');
  const [sortDir, setSortDir] = useState('asc');
  const [statusFilter, setStatusFilter] = useState('');

  const rows = useMemo(() => {
    const arr = [...(candidates || [])].filter(c =>
      !statusFilter || (c.status_category || '') === statusFilter
    );
    arr.sort((a, b) => {
      const av = cellValue(a, sortKey);
      const bv = cellValue(b, sortKey);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === 'number' && typeof bv === 'number'){
        return sortDir === 'asc' ? av - bv : bv - av;
      }
      const as = String(av), bs = String(bv);
      return sortDir === 'asc' ? as.localeCompare(bs) : bs.localeCompare(as);
    });
    return arr;
  }, [candidates, sortKey, sortDir]);

  function clickHeader(k, unsortable){
    if (unsortable) return;
    if (k === sortKey) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(k); setSortDir(k === 'rank' ? 'asc' : 'desc'); }
  }

  return (
    <RackPanel
      eyebrow="Ranked Candidates"
      title="Candidate ledger"
      italicAccent="Click a row to open the engineering drawer."
      tone="amber"
      dense
      right={(
        <div className="flex items-center gap-3">
          {countByStatus && (
            <div className="flex items-center gap-1.5 font-mono text-[9px]">
              {countByStatus.PROMISING > 0 && (
                <span style={{ color: '#63d471' }} title="PROMISING candidates">
                  ● {countByStatus.PROMISING} P
                </span>
              )}
              {countByStatus.REVIEW_REQUIRED > 0 && (
                <span style={{ color: '#ffb347' }} title="REVIEW REQUIRED candidates">
                  ! {countByStatus.REVIEW_REQUIRED} R
                </span>
              )}
              {(() => {
                const recCount = (countByStatus.RECOVERABLE_WITH_DA || 0)
                  + (countByStatus.RECOVERABLE_WITH_POWER_INCREASE || 0)
                  + (countByStatus.RECOVERABLE_WITH_REDUCED_POWER || 0)
                  + (countByStatus.RECOVERABLE_WITH_COL_CHANGE || 0);
                return recCount > 0 ? (
                  <span style={{ color: '#6fd3ff' }} title="RECOVERABLE candidates (DA / power / COL change)">
                    ↻ {recCount} REC
                  </span>
                ) : null;
              })()}
              {countByStatus.TREATY_REVIEW > 0 && (
                <span style={{ color: '#c79bff' }} title="TREATY REVIEW candidates">
                  § {countByStatus.TREATY_REVIEW} TR
                </span>
              )}
              {countByStatus.NON_COMPLIANT > 0 && (
                <span style={{ color: '#ff5a5a' }} title="NON-COMPLIANT candidates">
                  ✕ {countByStatus.NON_COMPLIANT} NC
                </span>
              )}
            </div>
          )}
          <div className="font-mono text-[10px] tracking-rack uppercase text-textDim">
            {statusFilter
              ? `${rows.length} shown (filtered)`
              : (returned != null ? `${returned} shown` : '')}
            {!statusFilter && evaluated != null ? ` · ${evaluated} evaluated` : ''}
          </div>
          {candidates && candidates.length > 0 && (
            <div className="flex items-center gap-1.5">
              <select
                value={statusFilter}
                onChange={e => setStatusFilter(e.target.value)}
                className="font-mono text-[9px] uppercase tracking-rack border border-rule rounded-sm px-1 py-0.5 bg-panelDeep text-textDim hover:text-cream transition-colors"
                title="Filter by status category"
              >
                {STATUS_FILTERS.map(f => (
                  <option key={f.value} value={f.value}>{f.label}</option>
                ))}
              </select>
              <button
                onClick={() => {
                  const CSV_COLS = ['rank','score','score_delta_vs_baseline','status_category','source',
                    'distance_from_current_km','bearing_deg','cardinal_direction',
                    'col_coverage_pct','col_coverage_gap_pct','blanket_population_pct','blanket_pop_risk','daytime_reach_km',
                    'principal_community_5mvm_km','blanket_1000mvm_km','ground_sigma_mS_m',
                    'ground_sigma_quality','ground_sigma_filing_grade','ground_radial_advisory',
                    'field_at_col_centroid_mvm','estimated_daytime_population_served',
                    'population_delta_vs_baseline','score_confidence',
                    'lat','lon','treaty_zone',
                    'minimum_tpo_for_compliance_kw','minimum_tpo_for_col_coverage_kw',
                    'power_class_ceiling_kw','mpe_evaluation_required'];
                  const esc = v => v == null ? '' : (String(v).includes(',') ? `"${String(v).replace(/"/g,'""')}"` : String(v));
                  const lines = [CSV_COLS.join(','),
                    ...candidates.map(c => CSV_COLS.map(k => esc(c[k])).join(','))];
                  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url; a.download = 'optimizer-candidates.csv'; a.click();
                  URL.revokeObjectURL(url);
                }}
                className="font-mono text-[9px] uppercase tracking-rack border border-rule rounded-sm px-1.5 py-0.5 text-textDim hover:text-cream transition-colors"
                title="Download candidates as CSV (Excel-compatible)"
              >
                ↓ CSV
              </button>
              <button
                onClick={() => {
                  const blob = new Blob(
                    [JSON.stringify(candidates, null, 2)],
                    { type: 'application/json' }
                  );
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url; a.download = 'optimizer-candidates.json'; a.click();
                  URL.revokeObjectURL(url);
                }}
                className="font-mono text-[9px] uppercase tracking-rack border border-rule rounded-sm px-1.5 py-0.5 text-textDim hover:text-cream transition-colors"
                title="Download all displayed candidates as JSON"
              >
                ↓ JSON
              </button>
            </div>
          )}
        </div>
      )}
    >
      {(!candidates || candidates.length === 0) ? (
        <div className="font-mono text-[11px] text-textDim italic py-6 text-center">
          No candidates yet.  Set inputs and press <span className="text-amber">Run regional sweep</span>.
        </div>
      ) : (
        <div className="overflow-auto max-h-[420px] border border-rule rounded-sm">
          <table className="w-full font-mono text-[11px]">
            <thead className="sticky top-0 bg-panelDeep border-b border-rule">
              <tr>
                {COLUMNS.map(col => {
                  const active = sortKey === col.key;
                  return (
                    <th
                      key={col.key}
                      onClick={() => clickHeader(col.key, col.unsortable)}
                      className={[
                        'px-2 py-2 uppercase tracking-rack text-[10px] text-textDim',
                        col.align === 'right' ? 'text-right' : 'text-left',
                        col.unsortable ? 'cursor-default' : 'cursor-pointer hover:text-cream',
                        active ? 'text-cream' : ''
                      ].join(' ')}
                    >
                      {col.label}
                      {active && (
                        <span className="ml-1 text-amber">{sortDir === 'asc' ? '↑' : '↓'}</span>
                      )}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {rows.map(c => {
                const isSel = c.rank === selectedRank;
                const statusCode = c.status_category;
                const statusLegacy = primaryStatus(c.status_labels);
                return (
                  <tr
                    key={c.rank}
                    onClick={() => onSelect && onSelect(c.rank)}
                    className={[
                      'cursor-pointer transition-colors border-t border-rule/60',
                      isSel ? 'bg-amber/10' : 'hover:bg-cyan/5'
                    ].join(' ')}
                  >
                    <td className="px-2 py-1.5 text-right">
                      <span className="inline-flex items-center gap-1.5">
                        <span
                          className="inline-block w-2 h-2 rounded-full"
                          style={{ background: rankColor(c.rank) }}
                          aria-hidden="true"
                        />
                        <span className="text-cream">{c.rank}</span>
                      </span>
                    </td>
                    <td className="px-2 py-1.5 text-right text-cream">{fmt('score', c.score)}</td>
                    <td
                      className="px-2 py-1.5 text-right font-mono text-[10px]"
                      style={{
                        color: c.score_delta_vs_baseline == null ? '#6b6b5e'
                             : c.score_delta_vs_baseline > 0 ? '#63d471'
                             : c.score_delta_vs_baseline < 0 ? '#ff7a7a'
                             : '#6b6b5e'
                      }}
                      title={c.score_delta_vs_baseline != null ? `Score vs current site baseline` : 'Baseline unknown'}
                    >
                      {fmt('score_delta_vs_baseline', c.score_delta_vs_baseline)}
                    </td>
                    <td className="px-2 py-1.5"><SourceChip source={c.source} /></td>
                    <td className="px-2 py-1.5"><HostCell candidate={c} /></td>
                    <td className="px-2 py-1.5 text-right text-textDim">{fmt('distance_from_current_km', c.distance_from_current_km)}</td>
                    <td
                      className="px-2 py-1.5 text-right text-textDim font-mono"
                      title={c.bearing_deg != null ? `${c.bearing_deg}° true ${c.cardinal_direction ? `(${c.cardinal_direction})` : ''}` : ''}
                    >
                      {c.bearing_deg != null ? (
                        <span>
                          {c.bearing_deg}°
                          {c.cardinal_direction && (
                            <span className="text-[9px] ml-0.5 text-textDim/70">{c.cardinal_direction}</span>
                          )}
                        </span>
                      ) : '—'}
                    </td>
                    <td
                      className="px-2 py-1.5 text-right"
                      style={{ color: c.col_coverage_pct != null && c.col_coverage_pct < 0.80 ? '#ff7a7a' : '#b8d0cc' }}
                      title={c.col_coverage_pct != null ? `${(c.col_coverage_pct * 100).toFixed(0)}% (floor 80% §73.24(j))` : ''}
                    >
                      {fmt('col_coverage_pct', c.col_coverage_pct)}
                    </td>
                    <td
                      className="px-2 py-1.5 text-right font-mono text-[10px]"
                      style={{ color: c.col_coverage_gap_pct > 0 ? '#ff7a7a' : '#444' }}
                      title={c.col_coverage_gap_pct > 0 ? `${(c.col_coverage_gap_pct * 100).toFixed(0)}% additional COL coverage needed` : ''}
                    >
                      {fmt('col_coverage_gap_pct', c.col_coverage_gap_pct)}
                    </td>
                    <td
                      className="px-2 py-1.5 text-right"
                      style={{ color: c.blanket_population_pct > 1 ? '#ff5a5a' : c.blanket_population_pct > 0.5 ? '#ffb347' : '#63d471' }}
                      title={c.blanket_population_pct != null ? `${c.blanket_population_pct.toFixed(3)}% (§73.24(g) limit: 1%)` : ''}
                    >
                      {fmt('blanket_population_pct', c.blanket_population_pct)}
                    </td>
                    <td className="px-2 py-1.5 text-right text-textDim">{fmt('daytime_reach_km', c.daytime_reach_km)}</td>
                    <td
                      className="px-2 py-1.5 text-right font-mono text-[10px]"
                      style={{
                        color: c.population_delta_vs_baseline == null ? '#444'
                             : c.population_delta_vs_baseline > 0 ? '#63d471'
                             : c.population_delta_vs_baseline < 0 ? '#ff7a7a'
                             : '#6b6b5e'
                      }}
                      title={c.population_delta_vs_baseline != null ? `Population delta vs current site baseline` : ''}
                    >
                      {fmt('population_delta_vs_baseline', c.population_delta_vs_baseline)}
                    </td>
                    <td
                      className="px-2 py-1.5 text-right font-mono"
                      style={{ color: sigmaColor(c.ground_sigma_mS_m) }}
                      title={c.ground_sigma_mS_m != null ? `${c.ground_sigma_mS_m} mS/m — ${c.ground_sigma_quality || ''} (${c.ground_sigma_source || 'M3 zone'})` : ''}
                    >
                      {fmt('ground_sigma_mS_m', c.ground_sigma_mS_m)}
                    </td>
                    <td className="px-2 py-1.5">
                      {statusCode
                        ? <StatusChip status={statusCode} dense />
                        : <StatusChip label={statusLegacy} dense />}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </RackPanel>
  );
}
