import React from 'react';
import StatusChip from './StatusChip.jsx';
import ScoreBreakdownChart from './ScoreBreakdownChart.jsx';

// CandidateDetailDrawer — slides up from the bottom (desktop: docked
// to the right side, but rendered as a fixed overlay so it works at
// any viewport).  Engineering explanation + per-goal score chart +
// limitations + a tiny SVG "contour preview" placeholder (single
// circle approximation, NOT a real propagation contour — server-side
// propagation pipeline is intentionally NOT invoked from screening).

function fmtPct(v, digits = 1){
  if (v == null || !Number.isFinite(Number(v))) return '—';
  return `${(Number(v) * 100).toFixed(digits)}%`;
}
function fmtNum(v, digits = 1){
  if (v == null || !Number.isFinite(Number(v))) return '—';
  return Number(v).toFixed(digits);
}
// blanket_population_pct is stored as a percent value (e.g. 2.14 = 2.14%),
// NOT as a 0..1 fraction — do NOT multiply by 100.
function fmtBlanketPct(v, digits = 2){
  if (v == null || !Number.isFinite(Number(v))) return '—';
  return `${Number(v).toFixed(digits)}%`;
}
function fmtCoord(lat, lon){
  const latDir = lat >= 0 ? 'N' : 'S';
  const lonDir = lon >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(4)}° ${latDir}, ${Math.abs(lon).toFixed(4)}° ${lonDir}`;
}

function MiniContourPreview({ daytimeReachKm }){
  const r  = Number(daytimeReachKm) || 0;
  const cx = 60, cy = 60;
  const max = Math.max(r, 5);
  const scale = 50 / max;
  return (
    <svg viewBox="0 0 120 120" width="120" height="120" aria-label="Schematic contour">
      <rect x="0" y="0" width="120" height="120" fill="#06141a" />
      <defs>
        <pattern id="cdgrid" width="10" height="10" patternUnits="userSpaceOnUse">
          <path d="M 10 0 L 0 0 0 10" fill="none" stroke="#10303a" strokeWidth="0.4" />
        </pattern>
      </defs>
      <rect x="0" y="0" width="120" height="120" fill="url(#cdgrid)" />
      <line x1={cx} y1="0" x2={cx} y2="120" stroke="#15333d" strokeWidth="0.5" />
      <line x1="0"  y1={cy} x2="120" y2={cy} stroke="#15333d" strokeWidth="0.5" />
      <circle cx={cx} cy={cy} r={Math.max(0, r * scale)} fill="none" stroke="#ffb347" strokeWidth="1.5" strokeDasharray="4 3" />
      <circle cx={cx} cy={cy} r="3" fill="#ffb347" />
      <text x={cx + 6} y={cy - 6} fill="#ffb347" fontFamily="ui-monospace, monospace" fontSize="8">
        {fmtNum(r, 1)} km
      </text>
    </svg>
  );
}

// Inline chip helpers for the co-location analysis section.  Kept local
// because they only matter inside this drawer; the table uses StatusChip.
function YesNoChip({ value, yesTone = 'amber' }){
  const yes = !!value;
  const palette = yes
    ? (yesTone === 'red'
        ? { fg: '#ff5a5a', bg: 'rgba(255,90,90,0.12)',  border: 'rgba(255,90,90,0.55)' }
        : { fg: '#ffb347', bg: 'rgba(255,179,71,0.12)', border: 'rgba(255,179,71,0.55)' })
    : { fg: '#63d471', bg: 'rgba(99,212,113,0.10)', border: 'rgba(99,212,113,0.45)' };
  return (
    <span
      className="inline-flex items-center font-mono tracking-rack uppercase border rounded-sm px-1.5 py-0.5 text-[9px]"
      style={{ color: palette.fg, background: palette.bg, borderColor: palette.border }}
    >
      {yes ? 'YES' : 'NO'}
    </span>
  );
}

function RiskChip({ risk }){
  const r = (risk || 'UNKNOWN').toString().toUpperCase();
  const palette = (
    r === 'HIGH'   ? { fg: '#ff5a5a', bg: 'rgba(255,90,90,0.12)',  border: 'rgba(255,90,90,0.55)' } :
    r === 'MEDIUM' ? { fg: '#ffb347', bg: 'rgba(255,179,71,0.12)', border: 'rgba(255,179,71,0.55)' } :
    r === 'LOW'    ? { fg: '#63d471', bg: 'rgba(99,212,113,0.12)', border: 'rgba(99,212,113,0.55)' } :
                     { fg: '#a89c84', bg: 'rgba(168,156,132,0.10)', border: 'rgba(168,156,132,0.45)' }
  );
  return (
    <span
      className="inline-flex items-center font-mono tracking-rack uppercase border rounded-sm px-1.5 py-0.5 text-[9px]"
      style={{ color: palette.fg, background: palette.bg, borderColor: palette.border }}
    >
      {r}
    </span>
  );
}

function ColocationAnalysisSection({ analysis, infra }){
  if (!analysis) return null;
  const dist = analysis.distance_to_host_m;
  return (
    <div>
      <div className="rack-eyebrow mb-1">Co-Location Analysis</div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 font-mono text-[11px]">
        <div>
          <span className="text-textDim">Distance to host</span>{' '}
          <span className="text-cream">{(dist == null || Number.isNaN(Number(dist))) ? '—' : `${Number(dist).toFixed(0)} m`}</span>
        </div>
        <div>
          <span className="text-textDim">Host kind</span>{' '}
          <span className="text-cream">{(analysis.host_kind || 'UNKNOWN').toString().replace(/_/g, ' ')}</span>
        </div>
        <div>
          <span className="text-textDim">Owner</span>{' '}
          <span className="text-cream">{analysis.host_owner || infra?.owner || 'UNKNOWN'}</span>
        </div>
        <div>
          <span className="text-textDim">Tower height</span>{' '}
          <span className="text-cream">{analysis.host_height_m != null ? `${analysis.host_height_m} m` : (infra?.height_m != null ? `${infra.height_m} m` : 'UNKNOWN')}</span>
        </div>
        <div>
          <span className="text-textDim">Structure type</span>{' '}
          <span className="text-cream">{(infra?.structure_type || 'UNKNOWN').toString().replace(/_/g, ' ')}</span>
        </div>
        <div>
          <span className="text-textDim">ASR number</span>{' '}
          <span className="text-cream">{infra?.asr_number || 'UNKNOWN'}</span>
        </div>
        <div className="col-span-2">
          <span className="text-textDim">Tower loading advisory</span><br/>
          <span className="text-cream">{analysis.tower_loading_advisory || 'UNKNOWN'}</span>
        </div>
        <div>
          <span className="text-textDim">Same-band interference</span>{' '}
          <RiskChip risk={analysis.same_band_interference_risk} />
        </div>
        <div>
          <span className="text-textDim">Structural eng. req'd</span>{' '}
          <YesNoChip value={analysis.structural_engineering_required} yesTone="amber" />
        </div>
        <div>
          <span className="text-textDim">Shared-lease advantage</span>{' '}
          <YesNoChip value={analysis.shared_lease_advantage} yesTone="amber" />
        </div>
        <div>
          <span className="text-textDim">Diplexing required</span>{' '}
          <YesNoChip value={analysis.diplexing_required} yesTone="amber" />
        </div>
      </div>

      {Array.isArray(analysis.regulatory_notes) && analysis.regulatory_notes.length > 0 && (
        <div className="mt-3">
          <div className="rack-eyebrow mb-1">Regulatory notes</div>
          <ul className="font-mono text-[11px] text-text list-disc list-inside space-y-0.5">
            {analysis.regulatory_notes.map((n, i) => <li key={i}>{n}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

// DeltaRow — one metric comparison vs the baseline site.
// "higher is better" = true for col_coverage, daytime_reach, ground_sigma.
// "lower is better"  = true for blanket_population.
function DeltaRow({ label, candidateVal, baselineVal, higherIsBetter, fmt }){
  if (candidateVal == null || baselineVal == null) return null;
  const delta = Number(candidateVal) - Number(baselineVal);
  if (!Number.isFinite(delta)) return null;
  const improved = higherIsBetter ? delta > 0 : delta < 0;
  const neutral  = Math.abs(delta) < 0.0001;
  const arrow = neutral ? '—' : (improved ? '▲' : '▼');
  const color = neutral ? '#a89c84' : (improved ? '#63d471' : '#ff5a5a');
  const sign  = delta > 0 ? '+' : '';
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="text-textDim w-28 shrink-0">{label}</span>
      <span className="text-cream">{fmt(candidateVal)}</span>
      <span className="font-mono text-[10px]" style={{ color }}>
        {arrow}{!neutral && ` ${sign}${fmt(delta)}`}
      </span>
    </div>
  );
}

// Administrative labels that are shown on every candidate — suppress them
// from the chip row when status_category already carries the key signal.
const ADMIN_LABELS = new Set(['SCREENING ONLY', 'ENGINEER REVIEW REQUIRED']);

export default function CandidateDetailDrawer({ candidate, baseline, onClose }){
  if (!candidate) return null;
  const e = candidate.explanation || {};
  const isInfra = candidate.source === 'INFRASTRUCTURE';
  // When status_category is set, only show non-admin supplemental labels.
  const supplementalLabels = candidate.status_category
    ? (candidate.status_labels || []).filter(s => !ADMIN_LABELS.has(s))
    : (candidate.status_labels || []);
  return (
    <div
      role="dialog"
      aria-label="Candidate detail"
      className="fixed inset-y-0 right-0 z-30 w-full sm:w-[480px] lg:w-[540px] bg-panelDeep border-l border-rule shadow-rackDeep overflow-y-auto"
    >
      <header className="sticky top-0 bg-panelDeep border-b border-rule px-4 py-3 flex items-start justify-between gap-3 z-10">
        <div className="min-w-0">
          <div className="rack-eyebrow">Candidate detail</div>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <span className="font-display text-cream text-[18px]">Rank #{candidate.rank}</span>
            <span className="font-mono text-[11px] text-textDim">
              {fmtCoord(candidate.lat, candidate.lon)}
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5 mt-2">
            {candidate.status_category && (
              <StatusChip status={candidate.status_category} dense />
            )}
            {supplementalLabels.map(s => (
              <StatusChip key={s} label={s} dense />
            ))}
          </div>
        </div>
        <button
          onClick={onClose}
          className="font-mono text-[11px] uppercase tracking-rack text-textDim hover:text-cream border border-rule rounded-sm px-2 py-1"
          aria-label="Close detail"
        >
          Close
        </button>
      </header>

      <section className="px-4 py-4 space-y-5">
        {/* Score breakdown */}
        <div>
          <ScoreBreakdownChart
            breakdown={e.score_breakdown}
            totalScore={candidate.score}
          />
        </div>

        {/* Why it ranked */}
        <div>
          <div className="rack-eyebrow mb-1">Why it ranked here</div>
          <div className="font-mono text-[12px] text-cream leading-relaxed">
            {e.ranking_rationale || candidate.notes || 'No rationale returned by engine.'}
          </div>
          {e.recovery_reasoning && (
            <div className="font-mono text-[11px] text-cyan/80 leading-relaxed mt-1.5">
              {e.recovery_reasoning}
            </div>
          )}
        </div>

        {/* Environmental + engineering profile */}
        <div>
          <div className="rack-eyebrow mb-1">Engineering profile</div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 font-mono text-[11px]">
            <div><span className="text-textDim">Distance from current</span> <span className="text-cream">{fmtNum(candidate.distance_from_current_km)} km</span></div>
            <div><span className="text-textDim">Daytime reach</span>          <span className="text-cream">{fmtNum(candidate.daytime_reach_km)} km</span></div>
            <div><span className="text-textDim">COL coverage</span>           <span className="text-cream">{fmtPct(candidate.col_coverage_pct)}</span></div>
            <div><span className="text-textDim">Blanket pop</span>             <span className="text-cream">{fmtBlanketPct(candidate.blanket_population_pct)}</span></div>
            <div className="col-span-2">
              <span className="text-textDim">Ground σ</span>{' '}
              <span className="text-cream">{fmtNum(candidate.ground_sigma_mS_m, 0)} mS/m</span>
              {candidate.ground_sigma_filing_grade && (
                <span
                  className="inline-flex items-center font-mono tracking-rack uppercase border rounded-sm px-1 py-0 text-[8px] ml-1.5 align-middle"
                  style={candidate.ground_sigma_filing_grade === 'filing'
                    ? { color: '#63d471', background: 'rgba(99,212,113,0.10)', borderColor: 'rgba(99,212,113,0.45)' }
                    : { color: '#ffb347', background: 'rgba(255,179,71,0.10)', borderColor: 'rgba(255,179,71,0.45)' }}
                >
                  {candidate.ground_sigma_filing_grade}
                </span>
              )}
              {candidate.ground_sigma_source && (
                <div className="text-textDim text-[9px] mt-0.5 leading-tight">{candidate.ground_sigma_source}</div>
              )}
            </div>
            <div><span className="text-textDim">NIF status</span>              <span className="text-cream">{candidate.nif_status || '—'}</span></div>
            <div><span className="text-textDim">Fuel / wildfire</span>         <span className="text-cream">{candidate.fuel_risk || '—'}</span></div>
            <div><span className="text-textDim">Treaty zone</span>             <span className="text-cream">{candidate.treaty_zone ?? '—'}</span></div>
            <div><span className="text-textDim">Parcel / zoning</span>         <span className="text-cream">UNKNOWN — verify before site survey</span></div>
          </div>
        </div>

        {/* vs baseline delta — only when baseline is provided */}
        {baseline && (
          <div>
            <div className="rack-eyebrow mb-1">vs current site</div>
            <div className="space-y-1 font-mono text-[11px]">
              <DeltaRow
                label="Score"
                candidateVal={candidate.score}
                baselineVal={baseline.score}
                higherIsBetter
                fmt={v => fmtNum(v, 1)}
              />
              <DeltaRow
                label="COL coverage"
                candidateVal={candidate.col_coverage_pct}
                baselineVal={baseline.col_coverage_pct}
                higherIsBetter
                fmt={v => fmtPct(v)}
              />
              <DeltaRow
                label="Daytime reach"
                candidateVal={candidate.daytime_reach_km}
                baselineVal={baseline.daytime_reach_km}
                higherIsBetter
                fmt={v => `${fmtNum(v, 1)} km`}
              />
              <DeltaRow
                label="Blanket pop"
                candidateVal={candidate.blanket_population_pct}
                baselineVal={baseline.blanket_population_pct}
                higherIsBetter={false}
                fmt={v => fmtBlanketPct(v)}
              />
              <DeltaRow
                label="Ground σ"
                candidateVal={candidate.ground_sigma_mS_m}
                baselineVal={baseline.ground_sigma_mS_m}
                higherIsBetter
                fmt={v => `${fmtNum(v, 0)} mS/m`}
              />
            </div>
          </div>
        )}

        {/* Co-Location Analysis — only when source === INFRASTRUCTURE */}
        {isInfra && <ColocationAnalysisSection analysis={candidate.colocation_analysis} infra={candidate.infrastructure_ref} />}

        {/* Schematic contour preview */}
        <div>
          <div className="rack-eyebrow mb-1">Contour preview <span className="normal-case text-textDim">(schematic — daytime reach circle)</span></div>
          <div className="border border-rule rounded-sm bg-[#06141a] p-2 inline-block">
            <MiniContourPreview daytimeReachKm={candidate.daytime_reach_km} />
          </div>
          <div className="font-mono text-[10px] text-textDim italic mt-1">
            Not a propagation contour.  Promote this candidate to the main Contour Studio to compute §73.183 / §73.184 polygons.
          </div>
        </div>

        {/* Limitations */}
        {Array.isArray(candidate.limitations) && candidate.limitations.length > 0 && (
          <div>
            <div className="rack-eyebrow mb-1">Limitations</div>
            <ul className="font-mono text-[11px] text-amberDim list-disc list-inside space-y-0.5">
              {candidate.limitations.map((l, i) => <li key={i}>{l}</li>)}
            </ul>
          </div>
        )}

        {/* Next actions */}
        <div>
          <div className="rack-eyebrow mb-1">Next actions</div>
          <ul className="font-mono text-[11px] text-text list-disc list-inside space-y-0.5">
            <li>Promote to Contour Studio with these coordinates.</li>
            <li>Run §73.182 NIF protection with engineered DA pattern.</li>
            <li>Verify parcel ownership + zoning before site survey.</li>
            <li>Pull SDR residual evidence once parcel is selected.</li>
          </ul>
        </div>
      </section>
    </div>
  );
}
