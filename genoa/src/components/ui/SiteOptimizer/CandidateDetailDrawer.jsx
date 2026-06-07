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
function fmtPopulation(n){
  if (n == null || !Number.isFinite(n)) return '—';
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${Math.round(n / 1e3)}K`;
  return String(Math.round(n));
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
        {analysis.co_siting_complexity != null && (
          <div className="col-span-2 flex items-baseline gap-2">
            <span className="text-textDim shrink-0">Co-siting complexity</span>{' '}
            <span
              className="font-mono text-[11px] font-semibold"
              style={{
                color: analysis.co_siting_complexity.score <= 2
                  ? '#63d471'
                  : analysis.co_siting_complexity.score <= 5
                  ? '#ffb347'
                  : '#ff7a7a'
              }}
            >
              {analysis.co_siting_complexity.score}/10
            </span>
            <span className="font-mono text-[10px] text-textDim">{analysis.co_siting_complexity.label}</span>
          </div>
        )}
      </div>

      {analysis.lease_synergy_advisory && (
        <div className="mt-2">
          <div className="rack-eyebrow mb-0.5">Lease synergy</div>
          <p className="font-mono text-[10px] text-text leading-relaxed">{analysis.lease_synergy_advisory}</p>
        </div>
      )}

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

export default function CandidateDetailDrawer({ candidate, baseline, onClose, onPromoteToStudio, callsign, frequency_khz, tpo_kw }){
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
            {candidate.rank_percentile != null && (
              <span className="font-mono text-[10px] text-textDim border border-rule rounded-sm px-1.5 py-0.5">
                {candidate.rank_percentile.toFixed(0)}th pct
              </span>
            )}
            {candidate.score_confidence && (() => {
              const c = candidate.score_confidence;
              const col = c === 'HIGH' ? '#63d471' : c === 'MEDIUM' ? '#ffb347' : '#a89c84';
              const bg  = c === 'HIGH' ? 'rgba(99,212,113,0.10)' : c === 'MEDIUM' ? 'rgba(255,179,71,0.10)' : 'transparent';
              const bc  = c === 'HIGH' ? 'rgba(99,212,113,0.40)' : c === 'MEDIUM' ? 'rgba(255,179,71,0.40)' : 'rgba(168,156,132,0.35)';
              return (
                <span className="font-mono text-[9px] uppercase tracking-rack border rounded-sm px-1.5 py-0.5"
                  style={{ color: col, background: bg, borderColor: bc }}
                  title={`Score confidence: ${c}. ${c === 'HIGH' ? 'Filing-grade σ raster and COL polygon provided.' : c === 'MEDIUM' ? 'One of: σ raster or COL polygon provided.' : 'Zone-table σ and disc-proxy COL — screening grade only.'}`}
                >
                  {c} confidence
                </span>
              );
            })()}
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
        <div className="flex flex-col gap-1.5 shrink-0">
          {onPromoteToStudio && candidate.status_category !== 'NON_COMPLIANT' && (
            <button
              onClick={() => onPromoteToStudio({
                lat: candidate.lat, lon: candidate.lon,
                callsign, frequency_khz, tpo_kw,
                rank: candidate.rank,
                status_category: candidate.status_category
              })}
              className="font-mono text-[11px] uppercase tracking-rack border rounded-sm px-2 py-1 transition-colors"
              style={{ color: '#63d471', borderColor: 'rgba(99,212,113,0.45)', background: 'rgba(99,212,113,0.08)' }}
              title="Load this candidate into the Contour Studio for full-physics analysis"
            >
              Promote →
            </button>
          )}
          <button
            onClick={onClose}
            className="font-mono text-[11px] uppercase tracking-rack text-textDim hover:text-cream border border-rule rounded-sm px-2 py-1"
            aria-label="Close detail"
          >
            Close
          </button>
        </div>
      </header>

      <section className="px-4 py-4 space-y-5">
        {/* Go / No-Go viability banner */}
        {candidate.site_viability_summary && (() => {
          const svs = candidate.site_viability_summary;
          const gng = svs.go_no_go;
          const bannerColor = gng === 'GO' ? '#63d471'
            : gng === 'CONDITIONAL' ? '#ffb347'
            : gng === 'NO_GO' ? '#e05252'
            : '#a89c84';
          const bannerBg = gng === 'GO' ? 'rgba(99,212,113,0.08)'
            : gng === 'CONDITIONAL' ? 'rgba(255,179,71,0.08)'
            : gng === 'NO_GO' ? 'rgba(224,82,82,0.08)'
            : 'rgba(168,156,132,0.06)';
          const label = gng === 'GO' ? 'GO'
            : gng === 'CONDITIONAL' ? 'CONDITIONAL'
            : gng === 'NO_GO' ? 'NO GO'
            : 'INSUFFICIENT DATA';
          return (
            <div className="rounded-sm border px-3 py-2.5 flex items-start gap-3"
              style={{ borderColor: bannerColor + '55', background: bannerBg }}>
              <span className="font-mono text-[11px] uppercase tracking-rack shrink-0 mt-0.5"
                style={{ color: bannerColor }}>
                {label}
              </span>
              <div className="flex-1 min-w-0">
                <div className="font-mono text-[10px] text-cream leading-snug">{svs.one_line}</div>
                {svs.confidence && (
                  <div className="font-mono text-[9px] text-textDim/60 mt-0.5 uppercase tracking-rack">
                    {svs.confidence.replace(/_/g, ' ')} · {svs.evaluated_at_tpo_kw} kW TPO
                  </div>
                )}
              </div>
            </div>
          );
        })()}

        {/* Score breakdown */}
        <div>
          <ScoreBreakdownChart
            breakdown={e.score_breakdown}
            totalScore={candidate.score}
            baselineBreakdown={baseline?.score_breakdown ?? null}
            baselineTotalScore={baseline?.score ?? null}
            rawComponents={e.score_components_raw ?? null}
          />
        </div>

        {/* Score confidence band */}
        {candidate.score_confidence_band && (() => {
          const band = candidate.score_confidence_band;
          const range = band.score_high - band.score_low;
          const rangeColor = range <= 5 ? '#63d471' : range <= 15 ? '#ffb347' : '#e05252';
          const score = candidate.score ?? 0;
          const low   = band.score_low ?? 0;
          const high  = band.score_high ?? 100;
          return (
            <div className="border border-rule rounded bg-surface/40 p-3">
              <div className="rack-eyebrow mb-2">Score uncertainty band</div>
              {/* Visual range bar */}
              <div className="relative h-[6px] bg-rule/40 rounded-full mb-2">
                <div className="absolute top-0 h-full rounded-full opacity-30"
                  style={{ left: `${low}%`, width: `${high - low}%`, background: rangeColor }} />
                <div className="absolute top-[-3px] h-[12px] w-[2px] rounded"
                  style={{ left: `${score}%`, background: rangeColor }} />
              </div>
              <div className="flex justify-between font-mono text-[10px] text-textDim mb-2">
                <span>0</span>
                <span className="font-semibold" style={{ color: rangeColor }}>
                  {low.toFixed(1)} – {score.toFixed(1)} – {high.toFixed(1)}
                </span>
                <span>100</span>
              </div>
              <div className="font-mono text-[10px] text-textDim">
                ±{band.uncertainty_pts} pt uncertainty
                {band.uncertainty_factors.length > 0 && (
                  <ul className="mt-1 space-y-0.5 list-none pl-0">
                    {band.uncertainty_factors.map((f, i) => (
                      <li key={i} className="text-textDim/80">· {f}</li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          );
        })()}

        {/* Risk triage ribbon — top 3 filing barriers at a glance */}
        {candidate.regulatory_risk_score?.risk_factors?.length > 0 && (() => {
          const rrs = candidate.regulatory_risk_score;
          const top3 = [...rrs.risk_factors].sort((a, b) => b.points - a.points).slice(0, 3);
          const catColor = rrs.risk_category === 'VERY_HIGH' ? '#ff4d4d'
            : rrs.risk_category === 'HIGH' ? '#ff9b5a'
            : rrs.risk_category === 'MODERATE' ? '#f6c90e'
            : '#4ec9b0';
          const FACTOR_LABEL = {
            TREATY_ZONE: 'Treaty',
            ASR_REQUIRED: 'ASR/FAA',
            POOR_CONDUCTIVITY: 'Poor σ',
            FAIR_CONDUCTIVITY: 'Fair σ',
            MODERATE_CONDUCTIVITY: 'Mod σ',
            BLANKET_POP_EXCEEDS_LIMIT: 'Blanket >1%',
            BLANKET_POP_HIGH: 'Blanket high',
            BLANKET_POP_ELEVATED: 'Blanket elev.',
            COL_COVERAGE_FAILS: 'COL gap',
            NIF_STUDY_REQUIRED: 'NIF study',
            DA_PATTERN_REQUIRED: 'DA pattern'
          };
          return (
            <div className="border rounded p-2.5"
              style={{ borderColor: catColor + '44', background: catColor + '0a' }}>
              <div className="flex items-center justify-between mb-2">
                <span className="rack-eyebrow" style={{ color: catColor }}>
                  risk triage — {rrs.risk_category?.replace(/_/g, ' ')}
                </span>
                <span className="font-mono text-[10px]" style={{ color: catColor }}>
                  {rrs.risk_score}/100
                </span>
              </div>
              <div className="flex gap-2 flex-wrap">
                {top3.map(f => (
                  <div key={f.factor} className="flex items-center gap-1.5 font-mono text-[9px] rounded px-1.5 py-0.5"
                    style={{ background: catColor + '18', border: `1px solid ${catColor}33` }}>
                    <span style={{ color: catColor }}>{FACTOR_LABEL[f.factor] ?? f.factor.replace(/_/g, ' ')}</span>
                    <span className="text-textDim">+{f.points}</span>
                  </div>
                ))}
                {rrs.risk_factors.length > 3 && (
                  <span className="font-mono text-[9px] text-textDim self-center">
                    +{rrs.risk_factors.length - 3} more
                  </span>
                )}
              </div>
            </div>
          );
        })()}

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
            <div>
              <span className="text-textDim">Bearing (true)</span>{' '}
              <span className="text-cream">
                {candidate.bearing_deg != null ? `${candidate.bearing_deg}°` : '—'}
                {candidate.cardinal_direction && (
                  <span className="text-textDim text-[9px] ml-1">({candidate.cardinal_direction})</span>
                )}
              </span>
            </div>
            <div><span className="text-textDim">5 mV/m radius</span>          <span className="text-cream">{fmtNum(candidate.principal_community_5mvm_km)} km</span></div>
            <div>
              <span className="text-textDim">0.5 mV/m reach</span>{' '}
              <span className="text-cream">{fmtNum(candidate.daytime_reach_km)} km</span>
              {candidate.estimated_daytime_population_served != null && (
                <span className="text-textDim text-[9px] ml-1.5">
                  (~{fmtPopulation(candidate.estimated_daytime_population_served)} served)
                </span>
              )}
            </div>
            <div className="col-span-2">
              <span className="text-textDim">Field at COL centroid</span>{' '}
              {candidate.distance_from_current_km < 0.5 ? (
                <span className="text-cream">co-located</span>
              ) : candidate.field_at_col_centroid_mvm != null ? (() => {
                const f = candidate.field_at_col_centroid_mvm;
                const col = f >= 5 ? '#63d471' : f >= 0.5 ? '#ffb347' : '#ff7a7a';
                const label = f >= 5 ? '≥§73.24(j) 5 mV/m floor ✓'
                            : f >= 0.5 ? 'below 5 mV/m — COL risk'
                            : 'below 0.5 mV/m — inadequate';
                return (
                  <span>
                    <span className="text-cream" style={{ color: col }}>{f.toFixed(2)} mV/m</span>
                    <span className="text-[9px] ml-1.5" style={{ color: col }}>{label}</span>
                  </span>
                );
              })() : <span className="text-textDim">—</span>}
            </div>
            <div>
              <span className="text-textDim">COL coverage</span>{' '}
              <span
                className="text-cream"
                style={candidate.col_coverage_gap_pct > 0 ? { color: '#ff7a7a' } : undefined}
              >
                {fmtPct(candidate.col_coverage_pct)}
              </span>
              {candidate.col_coverage_gap_pct > 0 && (
                <span className="text-[9px] ml-1.5" style={{ color: '#ff7a7a' }}>
                  (gap: +{(candidate.col_coverage_gap_pct * 100).toFixed(0)}% needed for §73.24(j))
                </span>
              )}
            </div>
            <div className="col-span-2">
              <span className="text-textDim">Blanket pop</span>{' '}
              {(() => {
                const risk = candidate.blanket_pop_risk;
                const col = risk === 'EXCEEDS_LIMIT' ? '#ff5a5a'
                          : risk === 'HIGH'          ? '#ff9b5a'
                          : risk === 'ELEVATED'      ? '#ffb347'
                          : '#b8d0cc';
                const tag = risk === 'EXCEEDS_LIMIT' ? ' ✕ >1% LIMIT'
                          : risk === 'HIGH'          ? ' ⚠ near limit'
                          : risk === 'ELEVATED'      ? ' △ elevated'
                          : '';
                return (
                  <span>
                    <span style={{ color: col }}>{fmtBlanketPct(candidate.blanket_population_pct)}</span>
                    {tag && <span className="font-mono text-[9px] ml-1" style={{ color: col }}>{tag}</span>}
                  </span>
                );
              })()}
              {candidate.blanket_1000mvm_km != null && (
                <span className="text-textDim text-[9px] ml-1.5">(r={fmtNum(candidate.blanket_1000mvm_km)} km at 1000 mV/m)</span>
              )}
              {candidate.minimum_tpo_for_compliance_kw != null && (
                <div className="font-mono text-[9px] text-amber mt-0.5 leading-tight">
                  §73.24(g): reduce TPO to ≤ {candidate.minimum_tpo_for_compliance_kw} kW to stay under 1% limit
                </div>
              )}
            </div>
            {candidate.minimum_tpo_for_col_coverage_kw != null && (
              <div className="col-span-2">
                <div className="font-mono text-[9px] leading-tight mt-0.5" style={{ color: '#ffb347' }}>
                  §73.24(j) COL coverage: increase TPO to ≥ {candidate.minimum_tpo_for_col_coverage_kw} kW to reach 5 mV/m at COL centroid
                </div>
              </div>
            )}
            <div className="col-span-2">
              <span className="text-textDim">Ground σ</span>{' '}
              <span className="text-cream">{fmtNum(candidate.ground_sigma_mS_m, 0)} mS/m</span>
              {candidate.ground_sigma_quality && (() => {
                const q = candidate.ground_sigma_quality;
                const style = q === 'EXCELLENT' ? { color: '#63d471', background: 'rgba(99,212,113,0.10)', borderColor: 'rgba(99,212,113,0.45)' }
                            : q === 'GOOD'      ? { color: '#63d471', background: 'rgba(99,212,113,0.08)', borderColor: 'rgba(99,212,113,0.35)' }
                            : q === 'FAIR'      ? { color: '#ffb347', background: 'rgba(255,179,71,0.10)', borderColor: 'rgba(255,179,71,0.45)' }
                            : q === 'POOR'      ? { color: '#ff5a5a', background: 'rgba(255,90,90,0.10)',  borderColor: 'rgba(255,90,90,0.45)' }
                            :                    { color: '#a89c84', background: 'transparent',           borderColor: 'rgba(168,156,132,0.35)' };
                return (
                  <span className="inline-flex items-center font-mono tracking-rack uppercase border rounded-sm px-1 py-0 text-[8px] ml-1.5 align-middle" style={style}>
                    {q}
                  </span>
                );
              })()}
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
              {candidate.ground_radial_advisory && (() => {
                const gra = candidate.ground_radial_advisory;
                const levelColor = gra.advisory_level === 'REQUIRED' ? '#ff9b5a'
                  : gra.advisory_level === 'ADVISORY' ? '#f6c90e'
                  : '#4ec9b0';
                return (
                  <div className="font-mono text-[9px] mt-1.5 leading-snug border-t border-rule/30 pt-1.5">
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <span className="uppercase text-[8px] tracking-rack px-1 py-0.5 rounded-sm"
                        style={{ background: levelColor + '22', color: levelColor }}>
                        ground system — {gra.advisory_level}
                      </span>
                    </div>
                    <div className="text-textDim leading-snug">{gra.note}</div>
                    <div className="grid grid-cols-2 gap-x-2 mt-1 text-textDim/70">
                      <span>Radials: <span className="text-cream">{gra.recommended_radial_count}</span></span>
                      <span>Length: <span className="text-cream">{gra.recommended_radial_length_m != null ? `${gra.recommended_radial_length_m} m` : '—'}</span></span>
                      {gra.estimated_copper_kg != null && (
                        <span className="col-span-2">Copper: ~<span className="text-cream">{gra.estimated_copper_kg} kg</span></span>
                      )}
                    </div>
                  </div>
                );
              })()}
              {candidate.sigma_sensitivity_analysis?.upgrade_possible && (() => {
                const ssa = candidate.sigma_sensitivity_analysis;
                const recColor = ssa.survey_recommendation?.startsWith('HIGH') ? '#63d471'
                  : ssa.survey_recommendation?.startsWith('MODERATE') ? '#ffb347'
                  : '#9b9b9b';
                return (
                  <div className="font-mono text-[9px] text-textDim mt-1 leading-tight border-t border-rule/30 pt-1">
                    <div className="font-semibold mb-0.5" style={{ color: recColor }}>
                      σ survey impact
                    </div>
                    <div>
                      {ssa.current_sigma_msm} → {ssa.projected_sigma_msm} mS/m (
                      {ssa.current_sigma_quality} → {ssa.projected_sigma_quality})
                    </div>
                    {ssa.daytime_reach_delta_km != null && (
                      <div>reach: {ssa.daytime_reach_delta_km > 0 ? '+' : ''}{ssa.daytime_reach_delta_km} km</div>
                    )}
                    {ssa.col_5mvm_delta_km != null && (
                      <div>5 mV/m: {ssa.col_5mvm_delta_km > 0 ? '+' : ''}{ssa.col_5mvm_delta_km} km</div>
                    )}
                    <div className="opacity-70 mt-0.5">{ssa.survey_recommendation}</div>
                  </div>
                );
              })()}
              {candidate.antenna_system_summary && (
                <div className="font-mono text-[9px] text-textDim mt-1 leading-tight space-y-0.5">
                  <div>
                    <span className="opacity-60">Efficiency: </span>
                    <span className="text-cream">
                      {candidate.antenna_system_summary.efficiency_range_db.min_db > 0 ? '+' : ''}
                      {candidate.antenna_system_summary.efficiency_range_db.min_db} to {candidate.antenna_system_summary.efficiency_range_db.max_db > 0 ? '+' : ''}{candidate.antenna_system_summary.efficiency_range_db.max_db} dB
                    </span>
                    {' '}<span className="opacity-60">— {candidate.antenna_system_summary.efficiency_range_db.label}</span>
                  </div>
                  {candidate.antenna_system_summary.estimated_erp_kw != null && (
                    <div>
                      <span className="opacity-60">Est. ERP: </span>
                      <span className="text-cream">{candidate.antenna_system_summary.estimated_erp_kw} kW</span>
                      {candidate.antenna_system_summary.erp_vs_tpo_ratio != null && (
                        <span className="opacity-50"> ({(candidate.antenna_system_summary.erp_vs_tpo_ratio * 100).toFixed(0)}% of TPO)</span>
                      )}
                    </div>
                  )}
                  {candidate.antenna_system_summary.tpo_headroom_to_class_max_kw != null && (
                    <div>
                      <span className="opacity-60">TPO headroom: </span>
                      <span className="text-cream">+{candidate.antenna_system_summary.tpo_headroom_to_class_max_kw} kW to class max</span>
                    </div>
                  )}
                  {candidate.antenna_system_summary.effective_service_area_km2 != null && (
                    <div>
                      <span className="opacity-60">Service area (0.5 mV/m): </span>
                      <span className="text-cream">{candidate.antenna_system_summary.effective_service_area_km2.toLocaleString()} km²</span>
                    </div>
                  )}
                </div>
              )}
            </div>
            {/* Antenna height profile */}
            {candidate.antenna_height_profile && (() => {
              const ahp = candidate.antenna_height_profile;
              const asrColor = ahp.quarter_wave_asr_required ? '#ffb347' : '#63d471';
              return (
                <div className="col-span-2 border border-rule/40 rounded p-2 font-mono text-[10px] space-y-0.5">
                  <div className="text-textDim text-[9px] uppercase tracking-rack mb-1">Antenna height (λ/4)</div>
                  <div className="flex gap-3 flex-wrap">
                    <span><span className="text-textDim">λ =</span> <span className="text-cream">{ahp.wavelength_m} m</span></span>
                    <span><span className="text-textDim">λ/4 =</span> <span className="text-cream">{ahp.quarter_wave_m} m</span></span>
                    <span><span className="text-textDim">5λ/8 =</span> <span className="text-cream">{ahp.five_eighths_wave_m} m</span></span>
                  </div>
                  <div style={{ color: asrColor }}>
                    ASR §17.7: {ahp.quarter_wave_asr_required ? `REQUIRED (λ/4=${ahp.quarter_wave_m} m > 60.96 m)` : `Not required (λ/4=${ahp.quarter_wave_m} m ≤ 60.96 m)`}
                  </div>
                  {ahp.if_asr_constrained && (
                    <div className="text-textDim/80 leading-tight mt-0.5">
                      ASR limit at 60.96 m → {ahp.if_asr_constrained.electrical_height_deg}° electrical height
                      {' '}({ahp.if_asr_constrained.efficiency_loss_db} dB efficiency loss)
                    </div>
                  )}
                </div>
              );
            })()}
            <div className="col-span-2">
              <span className="text-textDim">NIF status</span>{' '}
              {(() => {
                const ns = candidate.nif_status || '';
                const color = /HIGH skywave/i.test(ns) ? '#ff9b5a'
                            : /MODERATE skywave/i.test(ns) ? '#ffb347'
                            : /TREATY/i.test(ns) ? '#c79bff'
                            : '#b8d0cc';
                return <span className="font-mono text-[10px] leading-snug" style={{ color }}>{ns || '—'}</span>;
              })()}
            </div>
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
              <DeltaRow
                label="COL field"
                candidateVal={candidate.field_at_col_centroid_mvm}
                baselineVal={baseline.field_at_col_centroid_mvm}
                higherIsBetter
                fmt={v => `${fmtNum(v, 2)} mV/m`}
              />
              <DeltaRow
                label="Est. served"
                candidateVal={candidate.estimated_daytime_population_served}
                baselineVal={baseline.estimated_daytime_population_served}
                higherIsBetter
                fmt={v => fmtPopulation(v)}
              />
            </div>
            {/* Score delta by sub-component */}
            {candidate.score_delta_explanation?.components && Object.keys(candidate.score_delta_explanation.components).length > 0 && (
              <div className="mt-2">
                <div className="text-textDim font-mono text-[9px] mb-0.5">score Δ by component</div>
                <div className="font-mono text-[9px] space-y-0.5">
                  {Object.entries(candidate.score_delta_explanation.components)
                    .sort(([, a], [, b]) => Math.abs(b) - Math.abs(a))
                    .map(([k, v]) => (
                      <div key={k} className="flex justify-between gap-4">
                        <span className="text-textDim">{k}</span>
                        <span style={{ color: v > 0 ? '#63d471' : '#ff7a7a' }}>{v > 0 ? '+' : ''}{v.toFixed(1)}</span>
                      </div>
                    ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Regulatory compliance summary — structured FCC check table */}
        {candidate.regulatory_compliance_summary && (() => {
          const rcs = candidate.regulatory_compliance_summary;
          const rowColor = s => s === 'PASS' ? '#63d471' : s === 'FAIL' ? '#ff5a5a' : s === 'ADVISORY' ? '#ffb347' : '#a89c84';
          const rows = [
            { label: 'COL coverage', entry: rcs.col_coverage,
              display: rcs.col_coverage.value != null ? `${(rcs.col_coverage.value * 100).toFixed(0)}% (floor ${(rcs.col_coverage.threshold * 100).toFixed(0)}%)` : '—' },
            { label: 'Blanket pop', entry: rcs.blanket_pop,
              display: rcs.blanket_pop.value != null ? `${(rcs.blanket_pop.value * 100).toFixed(1)}% (limit ${(rcs.blanket_pop.threshold * 100).toFixed(0)}%)` : '—' },
            { label: 'Class power', entry: rcs.class_power,
              display: rcs.class_power.value != null ? `${rcs.class_power.value} kW${rcs.class_power.ceiling != null ? ` (ceil ${rcs.class_power.ceiling} kW)` : ''}` : '—' },
            { label: 'Treaty zone', entry: rcs.treaty_zone,
              display: rcs.treaty_zone.value ?? 'none' }
          ];
          return (
            <div>
              <div className="rack-eyebrow mb-1">FCC Compliance</div>
              <table className="w-full font-mono text-[10px] border-collapse">
                <thead>
                  <tr className="text-textDim text-left">
                    <th className="pb-0.5 pr-2 font-normal">Check</th>
                    <th className="pb-0.5 pr-2 font-normal">Status</th>
                    <th className="pb-0.5 pr-2 font-normal">Value</th>
                    <th className="pb-0.5 font-normal">Rule</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ label, entry, display }) => (
                    <tr key={label} className="border-t border-white/5">
                      <td className="py-0.5 pr-2 text-textDim">{label}</td>
                      <td className="py-0.5 pr-2" style={{ color: rowColor(entry.status) }}>{entry.status}</td>
                      <td className="py-0.5 pr-2 text-cream">{display}</td>
                      <td className="py-0.5 text-textDim text-[9px]">{entry.rule}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {candidate.mpe_evaluation_required && (
                <div className="font-mono text-[9px] text-textDim mt-1 leading-tight">
                  ⓘ RF exposure (MPE) evaluation required — 47 CFR §1.1307 / OET Bulletin 65
                </div>
              )}
            </div>
          );
        })()}

        {/* Coverage feasibility assessment */}
        {candidate.coverage_feasibility_assessment && (() => {
          const fa = candidate.coverage_feasibility_assessment;
          const verdictColor = {
            MEETS_ALL_FLOORS:             '#63d471',
            COL_OK_BLANKET_FAILS:         '#ffb347',
            FEASIBLE_WITH_POWER_INCREASE: '#7ec8e3',
            POTENTIALLY_DA_RESCUABLE:     '#c3b1e1',
            INFEASIBLE_AT_CLASS_CEILING:  '#ff5a5a',
            REQUIRES_ENGINEERING_REVIEW:  '#a89c84',
            NOT_EVALUATED:                '#444'
          }[fa.verdict] || '#a89c84';
          const verdictLabel = {
            MEETS_ALL_FLOORS:             'Meets all floors',
            COL_OK_BLANKET_FAILS:         'COL OK — blanket pop exceeds limit',
            FEASIBLE_WITH_POWER_INCREASE: 'Feasible with power increase',
            POTENTIALLY_DA_RESCUABLE:     'DA pattern may resolve',
            INFEASIBLE_AT_CLASS_CEILING:  'Infeasible at class ceiling',
            REQUIRES_ENGINEERING_REVIEW:  'Requires engineering review',
            NOT_EVALUATED:                'Not evaluated'
          }[fa.verdict] || fa.verdict;
          return (
            <div>
              <div className="rack-eyebrow mb-1">Coverage feasibility (§73.24(j))</div>
              <div className="flex items-center gap-2 mb-1.5">
                <span
                  className="font-mono text-[10px] font-semibold px-1.5 py-0.5 rounded-sm"
                  style={{ color: verdictColor, background: verdictColor + '22', border: `1px solid ${verdictColor}55` }}
                >
                  {verdictLabel}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 font-mono text-[10px]">
                {fa.col_coverage_pct != null && (
                  <div>
                    <span className="text-textDim">COL coverage</span>{' '}
                    <span style={{ color: fa.col_coverage_meets_floor ? '#63d471' : '#ff5a5a' }}>
                      {(fa.col_coverage_pct * 100).toFixed(0)}%
                    </span>
                    <span className="text-textDim opacity-50"> (floor 80%)</span>
                  </div>
                )}
                {fa.class_power_ceiling_kw != null && (
                  <div>
                    <span className="text-textDim">Class ceiling</span>{' '}
                    <span className="text-cream">{fa.class_power_ceiling_kw} kW</span>
                  </div>
                )}
                {fa.tpo_needed_for_col_floor_kw != null && (
                  <div>
                    <span className="text-textDim">TPO for 80% floor</span>{' '}
                    <span style={{ color: fa.tpo_needed_within_class_ceiling ? '#63d471' : '#ff5a5a' }}>
                      {fa.tpo_needed_for_col_floor_kw} kW
                    </span>
                    {fa.tpo_needed_within_class_ceiling != null && (
                      <span className="text-[9px] ml-1" style={{ color: fa.tpo_needed_within_class_ceiling ? '#63d471' : '#ff5a5a' }}>
                        {fa.tpo_needed_within_class_ceiling ? '✓' : '✕ exceeds §73.21'}
                      </span>
                    )}
                  </div>
                )}
                {fa.blanket_pop_pct != null && (
                  <div>
                    <span className="text-textDim">Blanket pop</span>{' '}
                    <span style={{ color: fa.blanket_pop_meets_limit ? '#63d471' : '#ff5a5a' }}>
                      {fa.blanket_pop_pct.toFixed(2)}%
                    </span>
                    <span className="text-textDim opacity-50"> (limit 1%)</span>
                  </div>
                )}
              </div>
              {fa.summary && (
                <p className="font-mono text-[9px] text-textDim mt-1 leading-relaxed">{fa.summary}</p>
              )}
            </div>
          );
        })()}

        {/* Power upgrade analysis */}
        {candidate.power_upgrade_analysis?.applicable && (() => {
          const pua = candidate.power_upgrade_analysis;
          const verdictColor = pua.verdict === 'UPGRADE_RESOLVES_COL' ? '#63d471'
            : pua.verdict === 'UPGRADE_CAUSES_BLANKET_VIOLATION' ? '#ffb347'
            : '#e05252';
          return (
            <div>
              <div className="rack-eyebrow mb-1">Max class power upgrade analysis</div>
              <div className="font-mono text-[10px] space-y-1.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="uppercase text-[9px] tracking-rack px-1.5 py-0.5 rounded-sm"
                    style={{ background: verdictColor + '22', color: verdictColor }}>
                    {pua.verdict?.replace(/_/g, ' ')}
                  </span>
                  <span className="text-textDim text-[9px]">
                    +{pua.headroom_kw} kW headroom → {pua.max_class_power_kw} kW max
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-x-3 text-[9px]">
                  {pua.col_coverage_estimate_at_max_pct != null && (
                    <div>
                      <span className="text-textDim">COL at max: </span>
                      <span style={{ color: pua.col_would_comply_at_max ? '#63d471' : '#ff7a7a' }}>
                        {pua.col_coverage_estimate_at_max_pct}%
                      </span>
                    </div>
                  )}
                  {pua.reach_at_max_class_power_km != null && (
                    <div>
                      <span className="text-textDim">5 mV/m reach: </span>
                      <span className="text-cream">{pua.reach_at_max_class_power_km} km</span>
                    </div>
                  )}
                  {pua.blanket_concern_at_max && (
                    <div>
                      <span className="text-textDim">Blanket at max: </span>
                      <span style={{ color: pua.blanket_concern_at_max.would_exceed_limit ? '#ff7a7a' : '#63d471' }}>
                        {pua.blanket_concern_at_max.estimated_blanket_pop_pct}%
                        {pua.blanket_concern_at_max.would_exceed_limit ? ' ✕ EXCEEDS §73.24(g)' : ' ✓'}
                      </span>
                    </div>
                  )}
                </div>
                {pua.note && <div className="text-textDim/40 text-[9px] leading-tight">{pua.note}</div>}
              </div>
            </div>
          );
        })()}

        {/* TPO-to-coverage table */}
        {candidate.tpo_to_coverage_table?.length > 0 && (
          <div>
            <div className="rack-eyebrow mb-1">TPO for §73.24(j) 5 mV/m at distance</div>
            <table className="w-full font-mono text-[10px] border-collapse">
              <thead>
                <tr className="text-textDim text-left">
                  <th className="pb-0.5 pr-3 font-normal">COL dist.</th>
                  <th className="pb-0.5 pr-3 font-normal">Min TPO</th>
                  <th className="pb-0.5 font-normal">Within class</th>
                </tr>
              </thead>
              <tbody>
                {candidate.tpo_to_coverage_table.map(row => {
                  const withinCeiling = row.within_class_ceiling;
                  const col = withinCeiling ? '#63d471' : '#ff7a7a';
                  return (
                    <tr key={row.col_distance_km} className="border-t border-white/5">
                      <td className="py-0.5 pr-3 text-textDim">{row.col_distance_km} km</td>
                      <td className="py-0.5 pr-3" style={{ color: row.tpo_needed_kw != null ? col : '#444' }}>
                        {row.tpo_needed_kw != null ? `${row.tpo_needed_kw} kW` : '—'}
                      </td>
                      <td className="py-0.5 text-[9px]" style={{ color: withinCeiling ? '#63d471' : '#ff7a7a' }}>
                        {withinCeiling == null ? '—' : withinCeiling ? '✓ yes' : '✕ exceeds §73.21'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* TPO power sweep */}
        {candidate.tpo_power_sweep?.length > 0 && (
          <div>
            <div className="rack-eyebrow mb-1">Power sweep — coverage vs TPO</div>
            <table className="w-full font-mono text-[10px] border-collapse">
              <thead>
                <tr className="text-textDim text-left">
                  <th className="pb-0.5 pr-2 font-normal">TPO</th>
                  <th className="pb-0.5 pr-2 font-normal">0.5 mV/m reach</th>
                  <th className="pb-0.5 pr-2 font-normal">5 mV/m (COL)</th>
                  <th className="pb-0.5 pr-2 font-normal">Blanket</th>
                  <th className="pb-0.5 font-normal">§73.24</th>
                </tr>
              </thead>
              <tbody>
                {candidate.tpo_power_sweep.map(row => {
                  const compliant = row.compliant;
                  const isCurrent = row.is_current_tpo;
                  const rowStyle = isCurrent ? { background: 'rgba(255,255,255,0.04)' } : {};
                  const statusCol = compliant ? '#63d471' : compliant === false ? '#ff7a7a' : '#888';
                  return (
                    <tr key={row.tpo_kw} className="border-t border-white/5" style={rowStyle}>
                      <td className="py-0.5 pr-2" style={{ color: isCurrent ? '#b8d0cc' : '#888', fontWeight: isCurrent ? 600 : 400 }}>
                        {row.tpo_kw} kW{isCurrent ? ' ←' : ''}
                      </td>
                      <td className="py-0.5 pr-2 text-textDim">
                        {row.daytime_reach_km != null ? `${row.daytime_reach_km} km` : '—'}
                      </td>
                      <td className="py-0.5 pr-2" style={{ color: row.col_5mvm_km != null ? '#b8d0cc' : '#444' }}>
                        {row.col_5mvm_km != null ? `${row.col_5mvm_km} km` : '—'}
                        {row.col_coverage_pct_est != null && (
                          <span style={{ color: row.col_meets_floor ? '#63d471' : '#ff7a7a' }}>
                            {' '}{(row.col_coverage_pct_est * 100).toFixed(0)}%
                          </span>
                        )}
                      </td>
                      <td className="py-0.5 pr-2" style={{ color: row.blanket_1000mvm_km != null ? '#b8d0cc' : '#444' }}>
                        {row.blanket_1000mvm_km != null ? `${row.blanket_1000mvm_km} km` : '—'}
                        {row.blanket_pop_pct_est != null && (
                          <span style={{ color: row.blanket_pop_ok ? '#63d471' : '#ff7a7a' }}>
                            {' '}{row.blanket_pop_pct_est.toFixed(2)}%
                          </span>
                        )}
                      </td>
                      <td className="py-0.5 text-[9px]" style={{ color: statusCol }}>
                        {compliant == null ? '—' : compliant ? '✓' : '✕'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="font-mono text-[9px] text-textDim/60 mt-1">
              COL coverage % uses 10 km disc proxy. ← marks current TPO. §73.24(j) floor = 80%, §73.24(g) blanket limit = 1%.
            </div>
          </div>
        )}

        {/* Population reach bands */}
        {candidate.population_reach_bands?.bands?.length > 0 && (() => {
          const bands = candidate.population_reach_bands.bands;
          const maxDist = Math.max(...bands.map(b => b.distance_km ?? 0));
          return (
            <div>
              <div className="rack-eyebrow mb-1">Multi-contour reach <span className="normal-case text-textDim/60">(screening-grade population proxy)</span></div>
              <div className="space-y-1">
                {bands.map(band => {
                  const pct = maxDist > 0 ? (band.distance_km ?? 0) / maxDist : 0;
                  const isFive = band.target_mvm === 5.0;
                  const isHalf = band.target_mvm === 0.5;
                  const barColor = isFive ? '#63d471' : isHalf ? '#7ec8e3' : '#a89c84';
                  return (
                    <div key={band.target_mvm} className="font-mono text-[9px]">
                      <div className="flex justify-between items-center mb-0.5">
                        <span className="text-textDim w-24 shrink-0">{band.target_mvm} mV/m</span>
                        <span className="text-cream w-16 text-right shrink-0">
                          {band.distance_km != null ? `${band.distance_km} km` : '—'}
                        </span>
                        <span className="text-textDim/60 w-24 text-right shrink-0">
                          {band.estimated_population != null ? `~${(band.estimated_population / 1000).toFixed(0)}k pop` : ''}
                        </span>
                      </div>
                      <div className="h-1 bg-rule/20 rounded-sm overflow-hidden">
                        <div className="h-full rounded-sm transition-all"
                          style={{ width: `${Math.round(pct * 100)}%`, background: barColor + 'aa' }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}

        {/* Groundwave contour table */}
        {candidate.groundwave_contour_table?.length > 0 && (
          <div>
            <div className="rack-eyebrow mb-1">Groundwave contours</div>
            <table className="w-full font-mono text-[10px] border-collapse">
              <thead>
                <tr className="text-textDim text-left">
                  <th className="pb-0.5 pr-3 font-normal">Contour</th>
                  <th className="pb-0.5 pr-3 font-normal">Distance</th>
                  <th className="pb-0.5 font-normal">Note</th>
                </tr>
              </thead>
              <tbody>
                {candidate.groundwave_contour_table.map(row => (
                  <tr key={row.mvm} className="border-t border-white/5">
                    <td className="py-0.5 pr-3 text-cream">{row.label}</td>
                    <td className="py-0.5 pr-3" style={{ color: row.distance_km != null ? '#b8d0cc' : '#666' }}>
                      {row.distance_km != null ? `${row.distance_km.toFixed(1)} km` : '—'}
                    </td>
                    <td className="py-0.5 text-textDim text-[9px]">{row.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="font-mono text-[9px] text-textDim mt-1">
              Screening-grade — based on M3 zone conductivity, not field-measured values.
            </div>
          </div>
        )}

        {/* Field strength profile */}
        {candidate.field_strength_profile?.length > 0 && (
          <div>
            <div className="rack-eyebrow mb-1">Field strength profile</div>
            <table className="w-full font-mono text-[10px] border-collapse">
              <thead>
                <tr className="text-textDim text-left">
                  <th className="pb-0.5 pr-3 font-normal">Distance</th>
                  <th className="pb-0.5 pr-3 font-normal">Field</th>
                  <th className="pb-0.5 font-normal">Service tier</th>
                </tr>
              </thead>
              <tbody>
                {candidate.field_strength_profile.map(row => {
                  const col = row.field_mvm == null ? '#444'
                    : row.field_mvm >= 5 ? '#63d471'
                    : row.field_mvm >= 2 ? '#a8d46a'
                    : row.field_mvm >= 0.5 ? '#ffb347'
                    : row.field_mvm >= 0.1 ? '#9b9b9b'
                    : '#555';
                  return (
                    <tr key={row.distance_km} className="border-t border-white/5">
                      <td className="py-0.5 pr-3 text-textDim">{row.distance_km} km</td>
                      <td className="py-0.5 pr-3" style={{ color: col }}>
                        {row.field_mvm != null ? row.field_mvm >= 100
                          ? `${row.field_mvm.toFixed(0)} mV/m`
                          : `${row.field_mvm.toFixed(2)} mV/m` : '—'}
                      </td>
                      <td className="py-0.5 text-textDim text-[9px]">{row.tier ?? '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="font-mono text-[9px] text-textDim mt-1">
              Screening-grade — M3 zone conductivity, omnidirectional.
            </div>
          </div>
        )}

        {/* Co-Location Analysis — only when source === INFRASTRUCTURE */}
        {isInfra && <ColocationAnalysisSection analysis={candidate.colocation_analysis} infra={candidate.infrastructure_ref} />}

        {/* Nighttime classification */}
        {candidate.nighttime_classification && (() => {
          const nc = candidate.nighttime_classification;
          const eligColor = nc.eligibility === 'YES' ? '#4ec9b0'
            : nc.eligibility === 'LIMITED' ? '#f6c90e'
            : nc.eligibility === 'RESTRICTED' ? '#ff9b5a'
            : '#ff4d4d';
          const nifColor = nc.nif_complexity === 'LOW' ? '#4ec9b0'
            : nc.nif_complexity === 'MODERATE' ? '#f6c90e'
            : nc.nif_complexity === 'HIGH' ? '#ff9b5a'
            : '#ff4d4d';
          return (
            <div>
              <div className="rack-eyebrow mb-1">Nighttime service classification</div>
              <div className="font-mono text-[10px] space-y-1.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="uppercase text-[9px] tracking-rack px-1.5 py-0.5 rounded-sm"
                    style={{ background: eligColor + '22', color: eligColor }}>
                    {nc.eligibility}
                  </span>
                  <span className="text-textDim">NIF complexity:</span>
                  <span className="uppercase text-[9px] tracking-rack px-1.5 py-0.5 rounded-sm"
                    style={{ background: nifColor + '22', color: nifColor }}>
                    {nc.nif_complexity}
                  </span>
                </div>
                <div className="text-textDim/80 leading-snug">{nc.key_constraint}</div>
                <div className="text-textDim/60 text-[9px]">
                  NIF study required: {nc.nif_study_required ? 'YES' : 'NO'} · {nc.rule}
                </div>
              </div>
            </div>
          );
        })()}

        {/* Signal environment advisory */}
        {candidate.signal_environment_advisory && (() => {
          const sea = candidate.signal_environment_advisory;
          const tierColor = sea.proximity_tier === 'NEAR' ? '#ffb347'
            : sea.proximity_tier === 'MID' ? '#7ec8e3'
            : '#4ec9b0';
          return (
            <div>
              <div className="rack-eyebrow mb-1">Signal environment</div>
              <div className="font-mono text-[10px] space-y-1.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="uppercase text-[9px] tracking-rack px-1.5 py-0.5 rounded-sm"
                    style={{ background: tierColor + '22', color: tierColor }}>
                    {sea.proximity_tier}
                  </span>
                  {sea.quadrant && (
                    <span className="text-textDim text-[9px]">{sea.quadrant.replace(/_/g, ' ')}</span>
                  )}
                  {sea.distance_km != null && (
                    <span className="text-textDim/60 text-[9px]">{sea.distance_km} km</span>
                  )}
                </div>
                {sea.notes?.length > 0 && (
                  <div className="space-y-0.5">
                    {sea.notes.map((note, i) => (
                      <div key={i} className="text-textDim/75 leading-snug text-[9px] border-l border-rule/30 pl-1.5">
                        {note}
                      </div>
                    ))}
                  </div>
                )}
                {sea.caution && (
                  <div className="text-textDim/40 text-[9px] leading-tight mt-0.5">{sea.caution}</div>
                )}
              </div>
            </div>
          );
        })()}

        {/* Coverage overlap analysis */}
        {candidate.coverage_overlap_analysis && (() => {
          const oa = candidate.coverage_overlap_analysis;
          const contColor = oa.coverage_continuity === 'HIGH' ? '#63d471'
            : oa.coverage_continuity === 'MODERATE' ? '#a8d46a'
            : oa.coverage_continuity === 'LOW' ? '#ffb347'
            : '#ff7a7a';
          const pct = oa.overlap_fraction != null ? `${Math.round(oa.overlap_fraction * 100)}%` : '—';
          return (
            <div>
              <div className="rack-eyebrow mb-1">§73.24 Coverage continuity (2-circle model)</div>
              <div className="font-mono text-[10px] space-y-1.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="uppercase text-[9px] tracking-rack px-1.5 py-0.5 rounded-sm"
                    style={{ background: contColor + '22', color: contColor }}>
                    {oa.coverage_continuity}
                  </span>
                  <span className="text-cream text-[9px] font-bold">{pct} overlap</span>
                  {oa.overlap_area_km2 != null && (
                    <span className="text-textDim text-[9px]">{oa.overlap_area_km2.toLocaleString()} km²</span>
                  )}
                </div>
                <div className="grid grid-cols-3 gap-x-3 gap-y-0.5 text-[9px]">
                  <div><span className="text-textDim">Tower sep.</span> <span className="text-cream">{oa.tower_separation_km ?? '—'} km</span></div>
                  <div><span className="text-textDim">Cand. reach</span> <span className="text-cream">{oa.candidate_reach_km ?? '—'} km</span></div>
                  <div><span className="text-textDim">Current reach</span> <span className="text-cream">{oa.current_site_reach_km_proxy ?? '—'} km</span></div>
                </div>
                {oa.note && (
                  <div className="text-textDim/40 text-[9px] leading-tight">{oa.note}</div>
                )}
              </div>
            </div>
          );
        })()}

        {/* Co-channel spacing estimate */}
        {candidate.co_channel_spacing_estimate && (() => {
          const ccs = candidate.co_channel_spacing_estimate;
          const verdictColor = ccs.screening_verdict === 'CO_CHANNEL_ELIGIBLE' ? '#63d471'
            : ccs.screening_verdict === 'FIRST_ADJACENT_ELIGIBLE' ? '#a8d46a'
            : ccs.screening_verdict === 'SECOND_ADJACENT_ELIGIBLE' ? '#ffb347'
            : '#ff5a5a';
          const rows = [
            { label: 'Co-channel', data: ccs.co_channel },
            { label: '±10 kHz adj', data: ccs.adjacent_10khz },
            { label: '±20 kHz adj', data: ccs.adjacent_20khz }
          ];
          return (
            <div>
              <div className="rack-eyebrow mb-1">§73.37 Co-channel spacing screen</div>
              <div className="font-mono text-[10px] space-y-1.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="uppercase text-[9px] tracking-rack px-1.5 py-0.5 rounded-sm"
                    style={{ background: verdictColor + '22', color: verdictColor }}>
                    {ccs.screening_verdict?.replace(/_/g, ' ')}
                  </span>
                  <span className="text-textDim text-[9px]">
                    {ccs.candidate_distance_km != null ? `${ccs.candidate_distance_km} km from current site` : ''}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-x-2 text-[9px]">
                  {rows.map(({ label, data }) => data && (
                    <div key={label} className="space-y-0.5">
                      <div className="text-textDim">{label}</div>
                      <div style={{ color: data.meets_separation ? '#63d471' : '#ff7a7a' }}>
                        {data.meets_separation ? '✓' : '✕'} {data.min_separation_km} km min
                      </div>
                    </div>
                  ))}
                </div>
                <div className="text-textDim/60 text-[9px] leading-tight">{ccs.caveat}</div>
              </div>
            </div>
          );
        })()}

        {/* MPE RF exposure summary */}
        {candidate.mpe_rf_exposure_summary && (() => {
          const mpe = candidate.mpe_rf_exposure_summary;
          return (
            <div>
              <div className="rack-eyebrow mb-1">RF exposure / MPE</div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 font-mono text-[10px]">
                <div>
                  <span className="text-textDim">Near-field boundary</span>{' '}
                  <span className="text-cream">{mpe.near_field_boundary_m != null ? `${mpe.near_field_boundary_m} m` : '—'}</span>
                </div>
                <div>
                  <span className="text-textDim">Far-field exclusion</span>{' '}
                  <span className="text-cream">{mpe.far_field_exclusion_m != null ? `${mpe.far_field_exclusion_m} m` : '—'}</span>
                </div>
                <div>
                  <span className="text-textDim">MPE limit</span>{' '}
                  <span className="text-cream">{mpe.mpe_limit_mw_cm2 != null ? `${mpe.mpe_limit_mw_cm2} mW/cm²` : '—'}</span>
                </div>
                <div>
                  <span className="text-textDim">Fence distance</span>{' '}
                  <span className="text-amber font-semibold">{mpe.recommended_fence_distance_m != null ? `${mpe.recommended_fence_distance_m} m` : '—'}</span>
                </div>
                <div className="col-span-2 text-textDim/60 text-[9px] leading-tight mt-0.5">
                  {mpe.rule}
                </div>
              </div>
            </div>
          );
        })()}

        {/* DA gain potential */}
        {candidate.da_gain_potential?.applicable && (() => {
          const dg = candidate.da_gain_potential;
          const recColor = dg.would_recover_col_compliance ? '#63d471' : '#ffb347';
          return (
            <div>
              <div className="rack-eyebrow mb-1">DA gain potential</div>
              <div className="font-mono text-[10px] space-y-1.5">
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="text-textDim">NDA coverage:</span>
                  <span className="text-cream">{dg.nda_col_coverage_pct != null ? `${dg.nda_col_coverage_pct.toFixed(0)}%` : '—'}</span>
                  <span className="text-textDim">→ DA est:</span>
                  <span style={{ color: recColor }}>
                    {dg.da_col_coverage_estimate_pct != null ? `~${dg.da_col_coverage_estimate_pct.toFixed(0)}%` : '?'}
                  </span>
                  {dg.would_recover_col_compliance != null && (
                    <span className="uppercase text-[9px] tracking-rack px-1.5 py-0.5 rounded-sm"
                      style={{ background: recColor + '22', color: recColor }}>
                      {dg.would_recover_col_compliance ? 'RECOVERABLE' : 'PARTIAL'}
                    </span>
                  )}
                </div>
                <div className="text-textDim/80 leading-snug">{dg.recommendation}</div>
                <div className="text-textDim/60 text-[9px]">{dg.da_erp_boost_modeled} · {dg.rule}</div>
              </div>
            </div>
          );
        })()}

        {/* Directional antenna study guide */}
        {candidate.directional_antenna_study_guide && (() => {
          const g = candidate.directional_antenna_study_guide;
          if (g.primary_reason === 'NOT_APPLICABLE') return null;
          const recColor = g.recommended ? '#ffb347' : '#888';
          const typeLabel = {
            FULL_DA_STUDY_DAY_NIGHT: 'Full DA (Day + Night)',
            DA_N_NIGHTTIME_ONLY:     'DA-N (Night only)',
            DA_D_DAYTIME_ONLY:       'DA-D (Day only)'
          }[g.study_type] ?? g.study_type ?? '—';
          return (
            <div>
              <div className="rack-eyebrow mb-1">§73.150 DA study guide</div>
              <div className="font-mono text-[10px] space-y-1.5">
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="uppercase text-[9px] tracking-rack px-1.5 py-0.5 rounded-sm"
                    style={{ background: recColor + '22', color: recColor }}>
                    {g.recommended ? 'RECOMMENDED' : 'NOT REQUIRED'}
                  </span>
                  {g.study_type && (
                    <span className="text-cream">{typeLabel}</span>
                  )}
                  {g.additional_engineering_weeks_min != null && (
                    <span className="text-textDim">+{g.additional_engineering_weeks_min}–{g.additional_engineering_weeks_max} wks</span>
                  )}
                </div>
                {g.triggers?.length > 0 && (
                  <div className="space-y-1">
                    {g.triggers.map((t, i) => (
                      <div key={i} className="text-textDim/80 leading-snug">
                        <span className="text-textDim/50 text-[9px] uppercase mr-1">{t.trigger.replace(/_/g, ' ')}:</span>
                        {t.detail}
                      </div>
                    ))}
                  </div>
                )}
                {g.key_constraints?.length > 0 && (
                  <ul className="text-textDim/60 text-[9px] list-disc list-inside space-y-0.5">
                    {g.key_constraints.slice(0, 3).map((c, i) => <li key={i}>{c}</li>)}
                  </ul>
                )}
                {g.pattern_radials_required != null && (
                  <div className="text-textDim/50 text-[9px]">Pattern: {g.pattern_radials_required} radials (5° increments) · {g.rule}</div>
                )}
                {!g.recommended && g.note && (
                  <div className="text-textDim/60 leading-snug">{g.note}</div>
                )}
              </div>
            </div>
          );
        })()}

        {/* Skywave protection advisory */}
        {candidate.skywave_protection_advisory && (() => {
          const s = candidate.skywave_protection_advisory;
          const levelColor = s.advisory_level === 'CRITICAL' ? '#ff4444'
            : s.advisory_level === 'HIGH'    ? '#ffb347'
            : s.advisory_level === 'MODERATE' ? '#ffe066'
            : s.advisory_level === 'LOW'      ? '#63d471'
            : '#888';
          return (
            <div>
              <div className="rack-eyebrow mb-1">§73.182 skywave protection</div>
              <div className="font-mono text-[10px] space-y-1.5">
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="uppercase text-[9px] tracking-rack px-1.5 py-0.5 rounded-sm"
                    style={{ background: levelColor + '22', color: levelColor }}>
                    {s.advisory_level}
                  </span>
                  <span className="text-textDim">NIF required:</span>
                  <span className="text-cream">{s.nif_required ? 'YES' : 'NO'}</span>
                  {s.protected_contour_25uvm_est_km != null && (
                    <>
                      <span className="text-textDim">25 µV/m est:</span>
                      <span className="text-cream">{s.protected_contour_25uvm_est_km.toFixed(0)} km</span>
                    </>
                  )}
                </div>
                {s.advisory_items?.length > 0 && (
                  <div className="space-y-1">
                    {s.advisory_items.slice(0, 2).map((item, i) => (
                      <div key={i} className="text-textDim/80 leading-snug">{item}</div>
                    ))}
                  </div>
                )}
                {s.nif_study_type && (
                  <div className="text-textDim/50 text-[9px]">{s.nif_study_type}</div>
                )}
                {s.key_risk && (
                  <div className="text-textDim/60 text-[9px] leading-snug">Risk: {s.key_risk}</div>
                )}
              </div>
            </div>
          );
        })()}

        {/* Power efficiency metrics */}
        {candidate.power_efficiency_metrics && (() => {
          const pem = candidate.power_efficiency_metrics;
          const tierColor = pem.efficiency_tier === 'HIGH' ? '#63d471'
            : pem.efficiency_tier === 'MODERATE' ? '#ffb347'
            : '#ff9b5a';
          return (
            <div>
              <div className="rack-eyebrow mb-1">Power efficiency</div>
              <div className="grid grid-cols-3 gap-x-3 font-mono text-[10px]">
                <div>
                  <div className="text-textDim text-[9px]">People / kW</div>
                  <div className="text-cream">{pem.people_per_kw != null ? pem.people_per_kw.toLocaleString() : '—'}</div>
                </div>
                <div>
                  <div className="text-textDim text-[9px]">km² / kW</div>
                  <div className="text-cream">{pem.km2_per_kw != null ? pem.km2_per_kw.toLocaleString() : '—'}</div>
                </div>
                <div>
                  <div className="text-textDim text-[9px]">Tier</div>
                  <div className="uppercase text-[9px] tracking-rack" style={{ color: tierColor }}>
                    {pem.efficiency_tier}
                  </div>
                </div>
              </div>
              <div className="text-textDim/60 text-[9px] mt-0.5 leading-tight">
                National avg density proxy · {pem.tpo_kw} kW TPO
              </div>
            </div>
          );
        })()}

        {/* Per-candidate engineering checklist */}
        {Array.isArray(candidate.per_candidate_engineering_checklist) && candidate.per_candidate_engineering_checklist.length > 0 && (() => {
          const priorityColor = { REQUIRED: '#ff9b5a', HIGH: '#ffb347', MEDIUM: '#7ec8e3', ADVISORY: '#9b9b9b' };
          return (
            <div>
              <div className="rack-eyebrow mb-1">Site engineering checklist</div>
              <div className="space-y-1">
                {candidate.per_candidate_engineering_checklist.map((item) => (
                  <details key={item.id} className="group">
                    <summary className="flex items-center gap-2 cursor-pointer list-none font-mono text-[10px] hover:text-textMain">
                      <span
                        className="shrink-0 px-1 py-0.5 rounded-sm text-[9px] font-semibold"
                        style={{ color: priorityColor[item.priority] || '#9b9b9b', background: (priorityColor[item.priority] || '#9b9b9b') + '22' }}
                      >
                        {item.priority}
                      </span>
                      <span className="text-text">{item.label}</span>
                    </summary>
                    <p className="font-mono text-[9px] text-textDim leading-relaxed mt-1 ml-16 pr-2">{item.note}</p>
                  </details>
                ))}
              </div>
            </div>
          );
        })()}

        {/* Compliance pathway */}
        {candidate.compliance_pathway?.steps?.length > 0 && (
          <div>
            <div className="rack-eyebrow mb-1">
              Compliance pathway
              {candidate.compliance_pathway.timeline_label != null ? (
                <span className="normal-case text-textDim ml-2">
                  {candidate.compliance_pathway.timeline_label} to filing · {candidate.compliance_pathway.blocking_steps ?? '?'} blocking steps
                </span>
              ) : candidate.compliance_pathway.estimated_weeks_to_filing != null && (
                <span className="normal-case text-textDim ml-2">
                  ~{candidate.compliance_pathway.estimated_weeks_to_filing} wk to filing (worst-case)
                </span>
              )}
            </div>
            <div className="space-y-1">
              {candidate.compliance_pathway.steps.map((step) => {
                const blockColor = step.blocking ? '#ff9b5a' : '#7ec8e3';
                const phaseShort = step.phase.replace(/_/g, ' ').toLowerCase();
                return (
                  <div key={step.step} className="flex gap-2 font-mono text-[10px]">
                    <span className="shrink-0 text-textDim w-4 text-right">{step.step}.</span>
                    <div className="flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="uppercase text-[9px] tracking-rack"
                          style={{ color: blockColor }}>{phaseShort}</span>
                        <span className="text-[9px] text-textDim/60">{step.timeline_weeks} wk</span>
                        {step.blocking && (
                          <span className="text-[9px] text-orange-400/80">blocking</span>
                        )}
                      </div>
                      <div className="text-textDim/80 leading-snug mt-0.5">{step.action}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Regulatory risk score */}
        {candidate.regulatory_risk_score && (() => {
          const rrs = candidate.regulatory_risk_score;
          const riskColor = rrs.risk_category === 'VERY_HIGH' ? '#ff4d4d'
            : rrs.risk_category === 'HIGH' ? '#ff9b5a'
            : rrs.risk_category === 'MODERATE' ? '#f6c90e'
            : '#4ec9b0';
          const barWidth = Math.min(100, rrs.risk_score);
          return (
            <div>
              <div className="rack-eyebrow mb-1">
                Regulatory risk
                <span className="normal-case text-textDim ml-2">
                  (filing complexity index — lower = easier path)
                </span>
              </div>
              {/* Risk score bar */}
              <div className="mb-2">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="font-mono text-[11px]" style={{ color: riskColor }}>
                    {rrs.risk_score}/100
                  </span>
                  <span className="font-mono text-[9px] uppercase tracking-rack px-1.5 py-0.5 rounded-sm"
                    style={{ background: riskColor + '22', color: riskColor }}>
                    {rrs.risk_category.replace(/_/g, ' ')}
                  </span>
                </div>
                <div className="w-full h-1.5 rounded-full" style={{ background: '#1a2e35' }}>
                  <div className="h-1.5 rounded-full transition-all"
                    style={{ width: `${barWidth}%`, background: riskColor }} />
                </div>
                <div className="font-mono text-[9px] text-textDim mt-1 leading-snug">
                  {rrs.interpretation}
                </div>
              </div>
              {/* Risk factors */}
              {rrs.risk_factors.length > 0 && (
                <div className="space-y-1">
                  {rrs.risk_factors.map((f, i) => (
                    <div key={i} className="flex gap-2 font-mono text-[10px]">
                      <span className="shrink-0 font-bold" style={{ color: riskColor }}>
                        +{f.points}
                      </span>
                      <div>
                        <span className="uppercase text-[9px] tracking-rack text-textDim/70">
                          {f.factor.replace(/_/g, ' ')}
                        </span>
                        <div className="text-textDim/80 leading-snug mt-0.5">{f.note}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })()}

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

        {/* Tower cost estimate */}
        {candidate.tower_cost_estimate && (() => {
          const tce = candidate.tower_cost_estimate;
          const tierColor = tce.cost_tier === 'LOW' ? '#63d471'
            : tce.cost_tier === 'MODERATE' ? '#a8d46a'
            : tce.cost_tier === 'HIGH' ? '#ffb347'
            : '#e05252';
          const bk = tce.breakdown ?? {};
          const rows = [
            { label: 'Tower steel', data: bk.tower_steel },
            { label: 'Ground system', data: bk.ground_system },
            { label: 'FAA lighting', data: bk.faa_lighting },
            { label: 'Civil work', data: bk.civil_work }
          ];
          return (
            <div>
              <div className="rack-eyebrow mb-1">Construction cost estimate <span className="normal-case text-textDim/60">(screening only)</span></div>
              <div className="font-mono text-[10px] space-y-1.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="uppercase text-[9px] tracking-rack px-1.5 py-0.5 rounded-sm"
                    style={{ background: tierColor + '22', color: tierColor }}>
                    {tce.cost_tier}
                  </span>
                  <span className="text-cream text-[11px] font-bold">{tce.range_label}</span>
                </div>
                <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[9px]">
                  {rows.map(({ label, data }) => data && (
                    <div key={label}>
                      <span className="text-textDim">{label}: </span>
                      <span className="text-cream">${Math.round(data.low / 1000)}k–${Math.round(data.high / 1000)}k</span>
                    </div>
                  ))}
                </div>
                <div className="text-textDim/40 text-[9px] leading-tight">{tce.disclaimer}</div>
              </div>
            </div>
          );
        })()}

        {/* Antenna height options */}
        {candidate.antenna_height_options && (() => {
          const aho = candidate.antenna_height_options;
          return (
            <div>
              <div className="rack-eyebrow mb-1">Antenna height options <span className="normal-case text-textDim/60">(FCC R-4 efficiency table)</span></div>
              <div className="font-mono text-[10px] space-y-1.5">
                <div className="grid gap-1">
                  {aho.options.map(opt => (
                    <div key={opt.id} className="border border-rule/40 rounded-sm px-2 py-1.5">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <span className="text-cream text-[10px] font-bold">{opt.label}</span>
                        <div className="flex gap-2 items-center text-[9px]">
                          <span className="text-textDim">{opt.height_m} m / {opt.height_ft} ft</span>
                          <span style={{ color: opt.gain_vs_qw_db >= 0 ? '#63d471' : '#ffb347' }}>
                            {opt.gain_vs_qw_db >= 0 ? '+' : ''}{opt.gain_vs_qw_db} dB vs λ/4
                          </span>
                          <span className="text-cream">{opt.estimated_erp_kw} kW ERP</span>
                          {opt.asr_required && (
                            <span className="text-[8px] px-1 py-0.5 rounded-sm" style={{ background: 'rgba(224,82,82,0.15)', color: '#e05252' }}>ASR</span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                {aho.note && (
                  <div className="text-textDim/40 text-[9px] leading-tight">{aho.note}</div>
                )}
              </div>
            </div>
          );
        })()}

        {/* Seasonal conductivity note */}
        {candidate.seasonal_conductivity_note && (() => {
          const scn = candidate.seasonal_conductivity_note;
          const riskColor = scn.risk_level === 'MINIMAL' ? '#63d471'
            : scn.risk_level === 'LOW' ? '#a8d46a'
            : scn.risk_level === 'ELEVATED' ? '#ffb347'
            : '#e05252';
          return (
            <div>
              <div className="rack-eyebrow mb-1">Seasonal conductivity risk</div>
              <div className="font-mono text-[10px] space-y-1.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="uppercase text-[9px] tracking-rack px-1.5 py-0.5 rounded-sm"
                    style={{ background: riskColor + '22', color: riskColor }}>
                    {scn.risk_level}
                  </span>
                  <span className="text-textDim text-[9px]">{scn.seasonal_variability?.replace(/_/g, ' ')} variability · σ={scn.sigma_msm} mS/m</span>
                </div>
                <div className="space-y-0.5">
                  {scn.notes?.slice(0, 2).map((note, i) => (
                    <div key={i} className="text-textDim/75 leading-snug text-[9px] border-l border-rule/30 pl-1.5">
                      {note}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          );
        })()}

        {/* Transmission line analysis */}
        {candidate.transmission_line_analysis && (() => {
          const tl = candidate.transmission_line_analysis;
          const recId = tl.recommended_feedline_id;
          return (
            <div>
              <div className="rack-eyebrow mb-1">Feedline loss budget ({tl.assumed_feedline_run_m} m run)</div>
              <div className="font-mono text-[10px] space-y-1.5">
                <div className="text-textDim/60 text-[9px]">
                  At {tl.frequency_khz} kHz · TPO {tl.reference_tpo_kw} kW → ERP at antenna base
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-[9px]">
                    <thead>
                      <tr className="text-textDim/50 uppercase text-[8px] tracking-rack border-b border-rule/20">
                        <th className="text-left pb-1 pr-3">Feedline</th>
                        <th className="text-right pb-1 pr-3">dB/100m</th>
                        <th className="text-right pb-1 pr-3">Loss</th>
                        <th className="text-right pb-1">ERP kW</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tl.feedline_options.map((fl) => (
                        <tr key={fl.id}
                          className={fl.id === recId ? 'text-cream' : 'text-textDim/70'}
                          style={fl.id === recId ? { background: '#63d47111' } : {}}>
                          <td className="py-0.5 pr-3">
                            {fl.id === recId && <span className="text-[8px] text-green-400 mr-1">▶</span>}
                            {fl.label}
                          </td>
                          <td className="text-right pr-3">{fl.attenuation_db_per_100m?.toFixed(3)}</td>
                          <td className="text-right pr-3">{fl.total_loss_db_at_60m?.toFixed(2)} dB</td>
                          <td className="text-right">{fl.erp_at_antenna_kw?.toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {tl.recommended_summary && (
                  <div className="text-textDim/60 leading-snug text-[9px]">{tl.recommended_summary}</div>
                )}
              </div>
            </div>
          );
        })()}

        {/* Permit and engineering cost estimate */}
        {candidate.permit_and_engineering_cost_estimate && (() => {
          const pe = candidate.permit_and_engineering_cost_estimate;
          const tierColor = pe.cost_tier === 'VERY_HIGH' ? '#ff4444'
            : pe.cost_tier === 'HIGH'     ? '#ffb347'
            : pe.cost_tier === 'MODERATE' ? '#ffe066'
            : '#63d471';
          return (
            <div>
              <div className="rack-eyebrow mb-1">Soft-cost budget (filing + engineering)</div>
              <div className="font-mono text-[10px] space-y-1.5">
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="uppercase text-[9px] tracking-rack px-1.5 py-0.5 rounded-sm"
                    style={{ background: tierColor + '22', color: tierColor }}>
                    {pe.cost_tier}
                  </span>
                  <span className="text-cream text-[11px] font-bold">{pe.range_label}</span>
                </div>
                <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
                  {pe.line_items?.map((item) => (
                    <div key={item.id} className="text-[9px]">
                      <span className="text-textDim/60">{item.label}:</span>{' '}
                      <span className="text-cream">${item.low_usd === item.high_usd
                        ? item.low_usd.toLocaleString()
                        : `${(item.low_usd / 1000).toFixed(0)}k–${(item.high_usd / 1000).toFixed(0)}k`}</span>
                    </div>
                  ))}
                </div>
                <div className="text-textDim/50 text-[8px] leading-snug">{pe.note}</div>
              </div>
            </div>
          );
        })()}

        {/* Antenna base impedance */}
        {candidate.antenna_base_impedance && (() => {
          const ab = candidate.antenna_base_impedance;
          const qw = ab.quarter_wave;
          const effColor = qw?.efficiency_standard_pct >= 90 ? '#63d471'
            : qw?.efficiency_standard_pct >= 80 ? '#ffe066'
            : '#ffb347';
          return (
            <div>
              <div className="rack-eyebrow mb-1">Antenna base impedance (λ/4 reference)</div>
              <div className="font-mono text-[10px] space-y-1.5">
                {qw && (
                  <div className="grid grid-cols-4 gap-x-3">
                    <div>
                      <div className="text-textDim text-[9px]">R_r (Ω)</div>
                      <div className="text-cream">{qw.radiation_resistance_ohm}</div>
                    </div>
                    <div>
                      <div className="text-textDim text-[9px]">R_g std (Ω)</div>
                      <div className="text-cream">{qw.ground_loss_standard_ohm}</div>
                    </div>
                    <div>
                      <div className="text-textDim text-[9px]">R_total (Ω)</div>
                      <div className="text-cream">{qw.total_base_resistance_ohm}</div>
                    </div>
                    <div>
                      <div className="text-textDim text-[9px]">Efficiency</div>
                      <div style={{ color: effColor }}>{qw.efficiency_standard_pct?.toFixed(0)}%</div>
                    </div>
                  </div>
                )}
                <div className="text-textDim/70 text-[9px] leading-snug">{ab.matching_network_complexity}</div>
                <div className="text-textDim/50 text-[9px] leading-snug">{ab.design_note}</div>
              </div>
            </div>
          );
        })()}

        {/* Signal Propagation Profile */}
        {candidate.signal_propagation_profile && (() => {
          const sp = candidate.signal_propagation_profile;
          const contourColors = {
            DAYTIME_5MVM:    'text-emerald-400',
            DAYTIME_2MVM:    'text-green-400',
            DAYTIME_05MVM:   'text-yellow-400',
            DAYTIME_01MVM:   'text-amber-400',
            BLANKET_1000MVM: 'text-red-400',
          };
          return (
            <div>
              <div className="rack-eyebrow mb-1">Signal Propagation Profile</div>
              <div className="bg-surface/30 rounded p-2 space-y-2">
                <div className="grid grid-cols-4 gap-1 text-[9px] font-mono text-textDim/60 uppercase tracking-wide border-b border-white/10 pb-1">
                  <span className="col-span-2">Contour</span>
                  <span className="text-right">Distance (km)</span>
                  <span className="text-right">Area (km²)</span>
                </div>
                {Array.isArray(sp.contours) && sp.contours.map(c => (
                  <div key={c.id} className="grid grid-cols-4 gap-1 items-start">
                    <span className={`col-span-2 font-mono text-[9px] leading-snug ${contourColors[c.id] ?? 'text-textDim'}`}>{c.label}</span>
                    <span className="text-right font-mono text-[10px] text-textPrimary">
                      {c.distance_km != null ? c.distance_km.toFixed(1) : '—'}
                    </span>
                    <span className="text-right font-mono text-[10px] text-textDim">
                      {c.area_km2 != null ? c.area_km2.toLocaleString(undefined, { maximumFractionDigits: 0 }) : '—'}
                    </span>
                  </div>
                ))}
                {sp.skywave_25uvm_est_km != null && (
                  <div className="border-t border-white/10 pt-1 grid grid-cols-4 gap-1 items-start">
                    <span className="col-span-2 font-mono text-[9px] text-purple-300 leading-snug">Skywave 25 µV/m est. (OET-72)</span>
                    <span className="text-right font-mono text-[10px] text-purple-300">{sp.skywave_25uvm_est_km.toFixed(0)}</span>
                    <span className="text-right font-mono text-[10px] text-textDim/40">—</span>
                  </div>
                )}
                <p className="text-[8px] text-textDim/40 leading-snug pt-1">{sp.note}</p>
              </div>
            </div>
          );
        })()}

        {/* Regulatory Gate Summary */}
        {candidate.regulatory_gate_summary && (() => {
          const rg = candidate.regulatory_gate_summary;
          const verdictColor = rg.overall_verdict === 'VIABLE' ? '#63d471'
            : rg.overall_verdict === 'CONDITIONAL' ? '#f6c90e'
            : '#ff9b5a';
          const statusColor = s => s === 'PASS' ? '#63d471' : s === 'FAIL' ? '#ff9b5a' : s === 'WARN' ? '#f6c90e' : '#a89c8488';
          return (
            <div>
              <div className="rack-eyebrow mb-1">Regulatory Gate Summary</div>
              <div className="bg-surface/30 rounded p-2 space-y-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-[9px] uppercase tracking-rack px-1.5 py-0.5 rounded-sm"
                    style={{ background: verdictColor + '22', color: verdictColor }}>
                    {rg.overall_verdict?.replace(/_/g, ' ')}
                  </span>
                  <span className="font-mono text-[9px] text-textDim/60">
                    {rg.fail_count} fail · {rg.warn_count} warn
                  </span>
                </div>
                {rg.overall_note && (
                  <p className="font-mono text-[9px] text-textDim/70 leading-snug">{rg.overall_note}</p>
                )}
                <div className="space-y-1">
                  {Array.isArray(rg.gates) && rg.gates.map(g => (
                    <div key={g.id} className="flex items-start gap-2">
                      <span className="font-mono text-[8px] uppercase tracking-rack shrink-0 w-10 mt-0.5 text-right"
                        style={{ color: statusColor(g.status) }}>
                        {g.status}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="font-mono text-[9px] text-textDim leading-snug">{g.label}</div>
                        <div className="font-mono text-[8px] text-textDim/50 leading-snug">{g.value}</div>
                        {g.note && (
                          <div className="font-mono text-[8px] text-amber/60 leading-snug">{g.note}</div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          );
        })()}

        {/* Ground System Design Specification */}
        {candidate.ground_system_design_specification && (() => {
          const gs = candidate.ground_system_design_specification;
          const std = gs.standard_design;
          const ext = gs.extended_design;
          const effColor = eff => eff >= 90 ? '#63d471' : eff >= 80 ? '#a8e063' : eff >= 70 ? '#f6c90e' : '#ff9b5a';
          return (
            <div>
              <div className="rack-eyebrow mb-1">Ground System Design</div>
              <div className="bg-surface/30 rounded p-2 space-y-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-[9px] text-textDim">σ={gs.sigma_msm} mS/m · ρ={gs.soil_resistivity_ohm_m} Ω·m · λ/4={gs.quarter_wave_m} m</span>
                  <span className="font-mono text-[8px] uppercase tracking-rack px-1 py-0.5 rounded-sm"
                    style={{ background: effColor(std?.efficiency_pct ?? 0) + '22', color: effColor(std?.efficiency_pct ?? 0) }}>
                    {std?.efficiency_tier}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-1 text-[9px] font-mono text-textDim/60 uppercase tracking-wide border-b border-white/10 pb-1">
                  <span>Design</span>
                  <span className="text-right">Radials × Length</span>
                  <span className="text-right">R_g / η</span>
                </div>
                {[
                  { label: 'Standard', d: std, highlight: gs.recommended_design === 'standard' },
                  { label: 'Extended', d: ext, highlight: gs.recommended_design === 'extended' },
                  { label: 'Minimum', d: gs.minimum_design, highlight: false }
                ].map(({ label, d, highlight }) => d && (
                  <div key={label} className="grid grid-cols-3 gap-1 items-center"
                    style={{ opacity: highlight ? 1 : 0.65 }}>
                    <span className="font-mono text-[9px]"
                      style={{ color: highlight ? '#f6c90e' : undefined }}>
                      {highlight ? '▶ ' : ''}{label}
                    </span>
                    <span className="text-right font-mono text-[9px] text-textPrimary">
                      {d.n_radials} × {d.radial_length_m} m
                    </span>
                    <span className="text-right font-mono text-[9px]"
                      style={{ color: d.R_g_estimated_ohm != null ? effColor(d.efficiency_pct ?? 0) : '#a89c84' }}>
                      {d.R_g_estimated_ohm != null ? `${d.R_g_estimated_ohm} Ω / ${d.efficiency_pct}%` : '—'}
                    </span>
                  </div>
                ))}
                {std?.wire_gauge && (
                  <div className="text-[9px] text-textDim/60 font-mono">Wire: {std.wire_gauge} · Burial: {std.burial_depth_mm} mm</div>
                )}
                {std?.area_required_ha != null && (
                  <div className="text-[9px] text-textDim/50 font-mono">Site area needed: {std.area_required_ha} ha for full λ/4 radial field</div>
                )}
                <p className="text-[8px] text-textDim/40 leading-snug">{gs.note}</p>
              </div>
            </div>
          );
        })()}

        {/* Noise Floor Estimate */}
        {candidate.noise_floor_estimate && (() => {
          const nf = candidate.noise_floor_estimate;
          const tierColor = nf.noise_tier === 'LOW_NOISE' ? '#63d471' : nf.noise_tier === 'MODERATE_NOISE' ? '#f6c90e' : '#ff9b5a';
          return (
            <div>
              <div className="rack-eyebrow mb-1">Noise Floor Estimate (ITU-R P.372)</div>
              <div className="bg-surface/30 rounded p-2 space-y-1.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-[9px] uppercase tracking-rack px-1.5 py-0.5 rounded-sm"
                    style={{ background: tierColor + '22', color: tierColor }}>
                    {nf.noise_tier?.replace(/_/g, ' ')}
                  </span>
                  <span className="font-mono text-[9px] text-textDim">Fa(atm)={nf.atmospheric_noise_fa_db} dB · dominant: {nf.dominant_source}</span>
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 font-mono text-[9px]">
                  <div className="text-textDim/60">Atmospheric noise Fa</div>
                  <div className="text-textPrimary text-right">{nf.atmospheric_noise_fa_db} dB</div>
                  <div className="text-textDim/60">Man-made: rural / res. / urban</div>
                  <div className="text-textPrimary text-right">
                    {nf.man_made_noise_fa_db?.rural} / {nf.man_made_noise_fa_db?.residential} / {nf.man_made_noise_fa_db?.urban} dB
                  </div>
                  <div className="text-textDim/60">Galactic noise Fa</div>
                  <div className="text-textPrimary text-right">{nf.galactic_noise_fa_db} dB</div>
                  <div className="text-textDim/60">Required field (30 dB S/N)</div>
                  <div className="text-amber text-right">{nf.required_field_for_30db_snr_mvm} mV/m</div>
                </div>
                {nf.reference && <p className="text-[8px] text-textDim/40 leading-snug">{nf.reference}</p>}
                {nf.note && <p className="text-[8px] text-textDim/40 leading-snug italic">{nf.note}</p>}
              </div>
            </div>
          );
        })()}

        {/* Seasonal Propagation Summary */}
        {/* Class Power Ceiling Analysis */}
        {candidate.fcc_class_power_ceiling_analysis && (() => {
          const pa = candidate.fcc_class_power_ceiling_analysis;
          const utilColor = u => u === 'AT_CEILING' ? 'text-red-400' : u === 'HIGH_UTILIZATION' ? 'text-amber-400' : 'text-emerald-400';
          const feasColor = f => f === 'NONE' ? 'text-red-400' : f === 'LIMITED' ? 'text-amber-400' : 'text-emerald-400';
          return (
            <div>
              <div className="rack-eyebrow mb-1">Class Power Ceiling (§73.21)</div>
              <div className="grid grid-cols-3 gap-1 mb-2">
                <div className="bg-surface border border-rule rounded px-2 py-1 text-center">
                  <div className="font-mono text-[9px] text-textDim uppercase">Current TPO</div>
                  <div className="font-mono text-[13px] text-text font-bold">{pa.current_tpo_kw} kW</div>
                </div>
                <div className="bg-surface border border-rule rounded px-2 py-1 text-center">
                  <div className="font-mono text-[9px] text-textDim uppercase">Class {pa.fcc_class} Ceiling</div>
                  <div className="font-mono text-[13px] text-text font-bold">{pa.class_power_ceiling_kw} kW</div>
                </div>
                <div className="bg-surface border border-rule rounded px-2 py-1 text-center">
                  <div className="font-mono text-[9px] text-textDim uppercase">Headroom</div>
                  <div className={`font-mono text-[13px] font-bold ${pa.headroom_kw > 0 ? 'text-emerald-400' : 'text-red-400'}`}>{pa.headroom_kw} kW</div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 font-mono text-[11px] mb-1.5">
                <span className="text-textDim">Utilization</span>
                <span className={utilColor(pa.utilization_tier)}>{pa.power_utilization_pct}% — {pa.utilization_tier.replace(/_/g, ' ')}</span>
                <span className="text-textDim">Upgrade feasibility</span>
                <span className={feasColor(pa.upgrade_feasibility)}>{pa.upgrade_feasibility.replace(/_/g, ' ')}</span>
                {pa.reach_at_ceiling_km != null && <>
                  <span className="text-textDim">Reach at ceiling</span>
                  <span className="text-text">{pa.reach_at_ceiling_km} km (0.5 mV/m)</span>
                </>}
                {pa.blanket_risk_at_ceiling && <>
                  <span className="text-textDim">Blanket risk at ceiling</span>
                  <span className={pa.blanket_risk_at_ceiling === 'ELEVATED' ? 'text-red-400' : pa.blanket_risk_at_ceiling === 'MODERATE' ? 'text-amber-400' : 'text-emerald-400'}>{pa.blanket_risk_at_ceiling}</span>
                </>}
              </div>
              {Array.isArray(pa.upgrade_path) && pa.upgrade_path.length > 0 && (
                <div>
                  <div className="font-mono text-[9px] text-textDim uppercase mb-0.5">Power upgrade path</div>
                  <ul className="font-mono text-[10px] text-textDim list-disc list-inside space-y-0.5">
                    {pa.upgrade_path.map((s, i) => <li key={i}>{s}</li>)}
                  </ul>
                </div>
              )}
            </div>
          );
        })()}

        {/* Technical Proof Guide */}
        {candidate.technical_proof_guide && (() => {
          const pg = candidate.technical_proof_guide;
          return (
            <div>
              <div className="rack-eyebrow mb-1">§73.154 Proof of Performance Guide</div>
              <div className="flex items-center gap-2 mb-1.5 font-mono text-[10px]">
                <span className="border border-rule rounded px-1.5 py-0.5 text-text">{pg.antenna_mode} antenna</span>
                <span className="border border-rule rounded px-1.5 py-0.5 text-text">{pg.n_proof_radials} radials</span>
                <span className="border border-rule rounded px-1.5 py-0.5 text-text">{pg.estimated_field_days?.[0]}–{pg.estimated_field_days?.[1]} field days</span>
              </div>
              <div className="space-y-1.5">
                {pg.measurements.map(m => (
                  <div key={m.id} className="border border-rule rounded px-2 py-1.5 bg-surface">
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-mono text-[11px] text-text font-medium">{m.label}</span>
                      <span className="font-mono text-[9px] text-textDim shrink-0">{m.rule}</span>
                    </div>
                    <div className="font-mono text-[10px] text-amberDim mt-0.5 leading-snug">{m.instrument}</div>
                    <div className="font-mono text-[10px] text-textDim mt-0.5 leading-snug">{m.notes}</div>
                  </div>
                ))}
              </div>
              {pg.nda_radial_plan && (
                <div className="mt-1.5">
                  <div className="font-mono text-[9px] text-textDim uppercase mb-0.5">Radial plan</div>
                  <div className="flex flex-wrap gap-1">
                    {pg.nda_radial_plan.map(r => (
                      <span key={r.azimuth_deg} className="font-mono text-[9px] border border-rule rounded px-1 py-0.5 text-textDim">{r.azimuth_deg}°</span>
                    ))}
                  </div>
                </div>
              )}
              <div className="font-mono text-[9px] text-textDim mt-1 leading-snug">{pg.filing_trigger}</div>
            </div>
          );
        })()}

        {/* Seasonal Propagation Summary */}
        {candidate.seasonal_propagation_summary && (() => {
          const ss = candidate.seasonal_propagation_summary;
          const riskColor = r => r === 'HIGH' ? 'text-red-400' : r === 'MODERATE' ? 'text-amber-400' : 'text-emerald-400';
          const riskBg    = r => r === 'HIGH' ? 'bg-red-400/10 border-red-400/30' : r === 'MODERATE' ? 'bg-amber-400/10 border-amber-400/30' : 'bg-emerald-400/10 border-emerald-400/30';
          return (
            <div>
              <div className="rack-eyebrow mb-1">Seasonal Propagation</div>
              <div className={`border rounded px-2 py-1 mb-2 ${riskBg(ss.col_compliance_risk_tier)}`}>
                <span className={`font-mono text-[10px] font-bold uppercase ${riskColor(ss.col_compliance_risk_tier)}`}>COL Compliance Risk: {ss.col_compliance_risk_tier}</span>
                <div className="font-mono text-[10px] text-textDim mt-0.5 leading-snug">{ss.col_risk_note}</div>
              </div>
              <table className="w-full font-mono text-[10px] border-collapse">
                <thead>
                  <tr className="border-b border-rule">
                    <th className="text-left text-textDim py-0.5 pr-2">Season</th>
                    <th className="text-right text-textDim py-0.5 pr-2">σ (mS/m)</th>
                    <th className="text-right text-textDim py-0.5 pr-2">0.5 mV/m reach</th>
                    <th className="text-right text-textDim py-0.5">5 mV/m (COL)</th>
                  </tr>
                </thead>
                <tbody>
                  {ss.contours.map(c => (
                    <tr key={c.season} className={`border-b border-rule ${c.season === 'ANNUAL_AVG' ? 'text-text font-bold' : 'text-textDim'}`}>
                      <td className="py-0.5 pr-2">{c.label}</td>
                      <td className="text-right py-0.5 pr-2">{c.sigma_msm}</td>
                      <td className="text-right py-0.5 pr-2">{c.daytime_reach_05mvm_km != null ? `${c.daytime_reach_05mvm_km} km` : '—'}</td>
                      <td className="text-right py-0.5">{c.col_5mvm_dist_km != null ? `${c.col_5mvm_dist_km} km` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {ss.daytime_reach_variation_km != null && (
                <div className="font-mono text-[10px] text-textDim mt-1">
                  Seasonal reach variation: ±{ss.daytime_reach_variation_km} km ({ss.daytime_reach_variation_pct}% of annual average)
                </div>
              )}
              <div className="font-mono text-[9px] text-textDim mt-1 leading-snug">{ss.note}</div>
            </div>
          );
        })()}

        {/* Operational Monitoring Requirements */}
        {candidate.operational_monitoring_requirements && (() => {
          const om = candidate.operational_monitoring_requirements;
          const critColor = c => c ? 'text-amber-400' : 'text-textDim';
          return (
            <div>
              <div className="rack-eyebrow mb-1">Post-Licensing Operational Monitoring</div>
              {/* Monitoring items grid */}
              <div className="font-mono text-[9px] text-textDim mb-1">Required Monitoring Obligations</div>
              <div className="space-y-0.5 mb-2">
                {om.monitoring_items?.map(it => (
                  <div key={it.id} className={`flex items-center justify-between border rounded px-1.5 py-1 ${it.critical ? 'border-amber-400/20 bg-amber-400/5' : 'border-rule bg-surface/40'}`}>
                    <div>
                      <span className={`font-mono text-[8px] font-semibold ${critColor(it.critical)}`}>{it.label}</span>
                      <span className="font-mono text-[7px] text-textDim ml-1">({it.rule})</span>
                    </div>
                    <span className="font-mono text-[7px] text-textDim whitespace-nowrap ml-2">{it.frequency}</span>
                  </div>
                ))}
              </div>
              {/* Nighttime power */}
              {om.nighttime_power?.required && (
                <div className="flex items-start gap-1.5 px-1.5 py-1 rounded border mb-2 border-amber-400/30 bg-amber-400/5">
                  <span className="font-mono text-[8px] text-amber-400 font-bold">NIGHTTIME POWER RESTRICTION</span>
                  <span className="font-mono text-[8px] text-textDim ml-1">
                    {om.nighttime_power.nighttime_tpo_limit_kw != null
                      ? `≤ ${om.nighttime_power.nighttime_tpo_limit_kw} kW`
                      : 'see license conditions'}
                  </span>
                </div>
              )}
              {/* Power tolerance */}
              <div className="font-mono text-[9px] text-textDim mb-1">Power Tolerance (§73.1560)</div>
              <div className="font-mono text-[8px] text-textDim leading-snug mb-2">{om.power_tolerance?.tolerance} — {om.power_tolerance?.note}</div>
              {/* License renewal */}
              <div className="font-mono text-[9px] text-textDim mb-1">License Renewal (§73.3539)</div>
              <div className="font-mono text-[8px] text-textDim leading-snug mb-2">
                {om.license_renewal?.cycle} · File {om.license_renewal?.filing_window}
              </div>
              <div className="font-mono text-[8px] text-textDim leading-snug">{om.note}</div>
            </div>
          );
        })()}

        {/* Proof of Performance Requirements */}
        {candidate.proof_of_performance_requirements && (() => {
          const pp = candidate.proof_of_performance_requirements;
          const isDA = pp.traversal_spec?.radial_count === 72;
          return (
            <div>
              <div className="rack-eyebrow mb-1">§73.154 Proof of Performance (Form 302-AM)</div>
              {/* Key chips */}
              <div className="flex flex-wrap gap-1.5 mb-2">
                <span className={`font-mono text-[9px] px-1.5 py-0.5 rounded border font-bold ${isDA ? 'bg-amber-400/15 border-amber-400/40 text-amber-400' : 'bg-blue-300/15 border-blue-300/40 text-blue-300'}`}>
                  {isDA ? 'DA PROOF (72 radials)' : 'NDA PROOF (8 radials)'}
                </span>
                <span className="font-mono text-[9px] text-textDim px-1 py-0.5">
                  {pp.proof_timeline_weeks_low}–{pp.proof_timeline_weeks_high} weeks field work
                </span>
                <span className={`font-mono text-[9px] px-1 py-0.5 ${pp.mpe_requirements?.required ? 'text-amber-400' : 'text-textDim'}`}>
                  MPE: {pp.mpe_requirements?.required ? 'REQUIRED' : 'SIMPLIFIED'}
                </span>
              </div>
              {/* Traversal spec */}
              <div className="font-mono text-[9px] text-textDim mb-1">Traversal Specification</div>
              <div className="grid grid-cols-3 gap-1 mb-2">
                {[
                  { label: 'Radials',   value: pp.traversal_spec?.radial_count },
                  { label: 'Spacing',   value: pp.traversal_spec?.radial_spacing_deg != null ? `${pp.traversal_spec.radial_spacing_deg}°` : '—' },
                  { label: 'Max reach', value: pp.traversal_spec?.min_radial_length_km != null ? `${pp.traversal_spec.min_radial_length_km} km` : '—' }
                ].map(m => (
                  <div key={m.label} className="bg-surface rounded p-1 text-center border border-rule">
                    <div className="font-mono text-[10px] text-textBright font-bold">{m.value}</div>
                    <div className="font-mono text-[8px] text-textDim mt-0.5">{m.label}</div>
                  </div>
                ))}
              </div>
              <div className="font-mono text-[8px] text-textDim leading-snug mb-2">{pp.traversal_spec?.note}</div>
              {/* Required exhibits */}
              <div className="font-mono text-[9px] text-textDim mb-1">Form 302-AM Required Exhibits</div>
              <div className="space-y-0.5 mb-2">
                {pp.antenna_proof_exhibits?.map((e, i) => (
                  <div key={i} className="font-mono text-[8px] text-textDim leading-snug">• {e}</div>
                ))}
              </div>
              {/* Instrumentation */}
              <div className="font-mono text-[9px] text-textDim mb-1">Required Instrumentation</div>
              <div className="space-y-0.5 mb-2">
                {pp.required_instrumentation?.slice(0, 3).map((inst, i) => (
                  <div key={i} className="font-mono text-[8px] text-textDim leading-snug">• {inst}</div>
                ))}
              </div>
              <div className="font-mono text-[8px] text-textDim leading-snug">{pp.note}</div>
            </div>
          );
        })()}

        {/* AM Environmental Impact Assessment Guide */}
        {candidate.am_environmental_impact_assessment_guide && (() => {
          const g = candidate.am_environmental_impact_assessment_guide;
          const fmt = (n) => n != null ? `$${Number(n).toLocaleString()}` : '—';
          const typeLabel = {
            categorical_exclusion:    'Categorical Exclusion (CE)',
            environmental_assessment: 'Environmental Assessment (EA)',
          }[g.assessment_type] ?? g.assessment_type ?? '—';
          return (
            <div key="env-guide" style={{ marginBottom: 16, padding: 12, background: '#f7fee7', borderRadius: 8, border: '2px solid #65a30d' }}>
              <div style={{ fontWeight: 700, color: '#365314', marginBottom: 6, fontSize: 13 }}>Environmental &amp; NEPA Review</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 12px', fontSize: 12, color: '#3f6212' }}>
                <span>Assessment:</span><span>{typeLabel}</span>
                <span>Env review:</span><span>{fmt(g.env_review_low_usd)} – {fmt(g.env_review_high_usd)}</span>
                <span>Section 106:</span><span>{fmt(g.section_106_low_usd)} – {fmt(g.section_106_high_usd)}</span>
                <span>Bio survey:</span><span>{fmt(g.bio_survey_low_usd)} – {fmt(g.bio_survey_high_usd)}</span>
                <span style={{ fontWeight: 600 }}>Total:</span>
                <span style={{ fontWeight: 600 }}>{fmt(g.total_low_usd)} – {fmt(g.total_high_usd)}</span>
              </div>
              {g.note && <div style={{ marginTop: 6, fontSize: 11, color: '#4d7c0f', fontStyle: 'italic' }}>{g.note}</div>}
            </div>
          );
        })()}

        {/* AM Antenna Array and Phasor Guide */}
        {candidate.am_antenna_array_and_phasor_guide && (() => {
          const g = candidate.am_antenna_array_and_phasor_guide;
          const fmt = (n) => n != null ? `$${Number(n).toLocaleString()}` : '—';
          const arrayLabel = {
            single_tower_nda: 'Single Tower (NDA)',
            two_tower_da:     '2-Tower Directional',
            three_tower_da:   '3-Tower Directional',
          }[g.array_type] ?? g.array_type ?? '—';
          return (
            <div key="ant-guide" style={{ marginBottom: 16, padding: 12, background: '#fff1f2', borderRadius: 8, border: '2px solid #e11d48' }}>
              <div style={{ fontWeight: 700, color: '#881337', marginBottom: 6, fontSize: 13 }}>Antenna Array &amp; Phasor System</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 12px', fontSize: 12, color: '#9f1239' }}>
                <span>Array type:</span><span>{arrayLabel}</span>
                <span>Towers:</span><span>{g.tower_count ?? '—'}</span>
                <span>Phasor needed:</span><span>{g.phasor_needed ? 'Yes' : 'No'}</span>
                {g.phasor_needed && <>
                  <span>Phasor cabinet:</span><span>{fmt(g.phasor_cost_low_usd)} – {fmt(g.phasor_cost_high_usd)}</span>
                  <span>Extra foundations:</span><span>{fmt(g.tower_foundation_low_usd)} – {fmt(g.tower_foundation_high_usd)}</span>
                </>}
                <span>ATU:</span><span>{fmt(g.atu_low_usd)} – {fmt(g.atu_high_usd)}</span>
                <span style={{ fontWeight: 600 }}>Total:</span>
                <span style={{ fontWeight: 600 }}>{fmt(g.total_low_usd)} – {fmt(g.total_high_usd)}</span>
              </div>
              {g.note && <div style={{ marginTop: 6, fontSize: 11, color: '#be123c', fontStyle: 'italic' }}>{g.note}</div>}
            </div>
          );
        })()}

        {/* AM RF Radiation Safety and Compliance Guide */}
        {candidate.am_rf_radiation_safety_and_compliance_guide && (() => {
          const g = candidate.am_rf_radiation_safety_and_compliance_guide;
          const fmt = (n) => n != null ? `$${Number(n).toLocaleString()}` : '—';
          const evalLabel = {
            desktop_calculation_required:       'Desktop Calculation',
            computational_evaluation_required:  'Computational Evaluation',
            field_measurement_required:         'Field Measurement',
          }[g.evaluation_type] ?? g.evaluation_type ?? '—';
          return (
            <div key="rfr-guide" style={{ marginBottom: 16, padding: 12, background: '#fff7ed', borderRadius: 8, border: '2px solid #ea580c' }}>
              <div style={{ fontWeight: 700, color: '#7c2d12', marginBottom: 6, fontSize: 13 }}>RF Radiation Safety &amp; MPE Compliance</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 12px', fontSize: 12, color: '#9a3412' }}>
                <span>Power:</span><span>{g.tpo_kw != null ? `${g.tpo_kw} kW` : '—'}</span>
                <span>E-field limit:</span><span>{g.e_limit_vm != null ? `${g.e_limit_vm} V/m` : '—'} (uncontrolled)</span>
                <span>MPE limit:</span><span>{g.mpe_limit_mw_cm2 != null ? `${g.mpe_limit_mw_cm2} mW/cm²` : '—'}</span>
                <span>Exclusion zone:</span><span>{g.exclusion_zone_m != null ? `≈ ${g.exclusion_zone_m} m` : '—'}</span>
                <span>Evaluation:</span><span>{evalLabel}</span>
                <span>Evaluation cost:</span><span>{fmt(g.evaluation_cost_low_usd)} – {fmt(g.evaluation_cost_high_usd)}</span>
                <span>Signage:</span><span>{fmt(g.signage_low_usd)} – {fmt(g.signage_high_usd)}</span>
                <span style={{ fontWeight: 600 }}>Total:</span>
                <span style={{ fontWeight: 600 }}>{fmt(g.total_compliance_low_usd)} – {fmt(g.total_compliance_high_usd)}</span>
              </div>
              {g.note && <div style={{ marginTop: 6, fontSize: 11, color: '#c2410c', fontStyle: 'italic' }}>{g.note}</div>}
            </div>
          );
        })()}

        {/* AM Ground System Installation and Maintenance Guide */}
        {candidate.am_ground_system_installation_and_maintenance_guide && (() => {
          const g = candidate.am_ground_system_installation_and_maintenance_guide;
          const fmt = (n) => n != null ? `$${Number(n).toLocaleString()}` : '—';
          return (
            <div key="gnd-guide" style={{ marginBottom: 16, padding: 12, background: '#f0fdf4', borderRadius: 8, border: '2px solid #16a34a' }}>
              <div style={{ fontWeight: 700, color: '#14532d', marginBottom: 6, fontSize: 13 }}>Ground System (Radials)</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 12px', fontSize: 12, color: '#166534' }}>
                <span>Frequency:</span><span>{g.frequency_khz != null ? `${g.frequency_khz} kHz` : '—'}</span>
                <span>λ/4 radial:</span><span>{g.radial_length_ft != null ? `${g.radial_length_ft.toFixed(0)} ft (${g.radial_length_m != null ? g.radial_length_m.toFixed(1) : '—'} m)` : '—'}</span>
                <span>Radials:</span><span>{g.recommended_radials ?? '—'} {g.is_da ? '(DA enhanced)' : '(standard)'}</span>
                <span>Total wire:</span><span>{g.total_ft_standard != null ? `${Math.round(g.total_ft_standard).toLocaleString()} ft` : '—'}</span>
                <span>Wire:</span><span>{fmt(g.wire_low_usd)} – {fmt(g.wire_high_usd)}</span>
                <span>Labor:</span><span>{fmt(g.labor_low_usd)} – {fmt(g.labor_high_usd)}</span>
                <span>Hardware:</span><span>{fmt(g.hardware_low_usd)} – {fmt(g.hardware_high_usd)}</span>
                <span style={{ fontWeight: 600 }}>Total:</span>
                <span style={{ fontWeight: 600 }}>{fmt(g.total_low_usd)} – {fmt(g.total_high_usd)}</span>
              </div>
              {g.note && <div style={{ marginTop: 6, fontSize: 11, color: '#4ade80', fontStyle: 'italic' }}>{g.note}</div>}
            </div>
          );
        })()}

        {/* AM Transmitter Procurement and Upgrade Guide */}
        {candidate.am_transmitter_procurement_and_upgrade_guide && (() => {
          const g = candidate.am_transmitter_procurement_and_upgrade_guide;
          const fmt = (n) => n != null ? `$${Number(n).toLocaleString()}` : '—';
          const txLabel = {
            solid_state_low_power:    'Solid-State Low Power',
            solid_state_medium_power: 'Solid-State Medium Power',
            solid_state_high_power:   'Solid-State High Power',
          }[g.tx_type] ?? g.tx_type ?? '—';
          return (
            <div key="txp-guide" style={{ marginBottom: 16, padding: 12, background: '#f1f5f9', borderRadius: 8, border: '2px solid #475569' }}>
              <div style={{ fontWeight: 700, color: '#1e293b', marginBottom: 6, fontSize: 13 }}>Transmitter Procurement &amp; Upgrade</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 12px', fontSize: 12, color: '#334155' }}>
                <span>Type:</span><span>{txLabel}</span>
                <span>Power:</span><span>{g.tpo_kw != null ? `${g.tpo_kw} kW` : '—'} Class {g.fcc_class ?? '—'}</span>
                <span>Transmitter:</span><span>{fmt(g.tx_cost_low_usd)} – {fmt(g.tx_cost_high_usd)}</span>
                <span>Exciter:</span><span>{fmt(g.exciter_low_usd)} – {fmt(g.exciter_high_usd)}</span>
                <span>Install:</span><span>{fmt(g.install_low_usd)} – {fmt(g.install_high_usd)}</span>
                <span>Shipping:</span><span>{fmt(g.shipping_low_usd)} – {fmt(g.shipping_high_usd)}</span>
                <span style={{ fontWeight: 600 }}>Total:</span>
                <span style={{ fontWeight: 600 }}>{fmt(g.total_tx_low_usd)} – {fmt(g.total_tx_high_usd)}</span>
              </div>
              {g.note && <div style={{ marginTop: 6, fontSize: 11, color: '#64748b', fontStyle: 'italic' }}>{g.note}</div>}
            </div>
          );
        })()}

        {/* AM Site Grading and Drainage Guide */}
        {candidate.am_site_grading_and_drainage_guide && (() => {
          const g = candidate.am_site_grading_and_drainage_guide;
          const fmt = (n) => n != null ? `$${Number(n).toLocaleString()}` : '—';
          return (
            <div key="grd-guide" style={{ marginBottom: 16, padding: 12, background: '#ecfdf5', borderRadius: 8, border: '2px solid #059669' }}>
              <div style={{ fontWeight: 700, color: '#064e3b', marginBottom: 6, fontSize: 13 }}>Site Grading &amp; Drainage</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 12px', fontSize: 12, color: '#065f46' }}>
                <span style={{ color: '#059669' }}>Terrain Class:</span><span style={{ fontWeight: 600 }}>{g.terrain_class} @ {g.dist_km} km</span>
                <span style={{ color: '#059669' }}>Grading:</span><span>{fmt(g.grading_low_usd)} – {fmt(g.grading_high_usd)}</span>
                <span style={{ color: '#059669' }}>Clearing &amp; Grubbing:</span><span>{fmt(g.clearing_low_usd)} – {fmt(g.clearing_high_usd)}</span>
                <span style={{ color: '#059669' }}>Storm Drainage:</span><span>{fmt(g.drainage_low_usd)} – {fmt(g.drainage_high_usd)}</span>
                <span style={{ color: '#059669' }}>Erosion Control:</span><span>{fmt(g.erosion_control_low_usd)} – {fmt(g.erosion_control_high_usd)}</span>
                <span style={{ color: '#059669' }}>Total Site Prep:</span><span style={{ fontWeight: 600 }}>{fmt(g.total_site_prep_low_usd)} – {fmt(g.total_site_prep_high_usd)}</span>
              </div>
              <div className="font-mono text-[8px] leading-snug" style={{ marginTop: 6, color: '#047857' }}>{g.note}</div>
            </div>
          );
        })()}

        {/* AM Insurance and Bonding Guide */}
        {candidate.am_insurance_and_bonding_guide && (() => {
          const g = candidate.am_insurance_and_bonding_guide;
          const fmt = (n) => n != null ? `$${Number(n).toLocaleString()}` : '—';
          return (
            <div key="ins-guide" style={{ marginBottom: 16, padding: 12, background: '#fefce8', borderRadius: 8, border: '2px solid #b45309' }}>
              <div style={{ fontWeight: 700, color: '#451a03', marginBottom: 6, fontSize: 13 }}>Insurance &amp; Bonding</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 12px', fontSize: 12, color: '#92400e' }}>
                <span style={{ color: '#b45309' }}>Tower Ins. (annual):</span><span>{fmt(g.annual_tower_ins_low_usd)} – {fmt(g.annual_tower_ins_high_usd)}/yr</span>
                <span style={{ color: '#b45309' }}>E&amp;O Ins. (annual):</span><span>{fmt(g.annual_eo_ins_low_usd)} – {fmt(g.annual_eo_ins_high_usd)}/yr</span>
                <span style={{ color: '#b45309' }}>Total Annual Ins.:</span><span style={{ fontWeight: 600 }}>{fmt(g.annual_total_ins_low_usd)} – {fmt(g.annual_total_ins_high_usd)}/yr</span>
                <span style={{ color: '#b45309' }}>Surety Bond ({(g.surety_bond_pct * 100).toFixed(0)}%):</span><span>{fmt(g.surety_bond_low_usd)} – {fmt(g.surety_bond_high_usd)}</span>
                <span style={{ color: '#b45309' }}>Workers' Comp (construction):</span><span>{fmt(g.wc_during_construction_low_usd)} – {fmt(g.wc_during_construction_high_usd)}</span>
                <span style={{ color: '#b45309' }}>Tower Height:</span><span>{g.tower_height_ft} ft Class {g.fcc_class}</span>
              </div>
              <div className="font-mono text-[8px] leading-snug" style={{ marginTop: 6, color: '#78350f' }}>{g.note}</div>
            </div>
          );
        })()}

        {/* AM Studio-Transmitter Link Guide */}
        {candidate.am_studio_transmitter_link_guide && (() => {
          const g = candidate.am_studio_transmitter_link_guide;
          const fmt = (n) => n != null ? `$${Number(n).toLocaleString()}` : '—';
          return (
            <div key="stl-guide" style={{ marginBottom: 16, padding: 12, background: '#f0f4ff', borderRadius: 8, border: '2px solid #4f46e5' }}>
              <div style={{ fontWeight: 700, color: '#1e1b4b', marginBottom: 6, fontSize: 13 }}>Studio-Transmitter Link (STL) (47 CFR Part 74)</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 12px', fontSize: 12, color: '#3730a3' }}>
                <span style={{ color: '#4f46e5' }}>STL Type:</span><span style={{ fontWeight: 600 }}>{g.stl_type} @ {g.dist_km} km{g.stl_fcc_license_required ? ' (FCC license req.)' : ''}</span>
                <span style={{ color: '#4f46e5' }}>IP Codec (×2):</span><span>{fmt(g.ip_codec_total_low_usd)} – {fmt(g.ip_codec_total_high_usd)}</span>
                {g.stl_type === 'microwave_950mhz' && <><span style={{ color: '#4f46e5' }}>Microwave HW:</span><span>{fmt(g.microwave_hw_low_usd)} – {fmt(g.microwave_hw_high_usd)}</span></>}
                <span style={{ color: '#4f46e5' }}>Internet/Cell:</span><span>{fmt(g.monthly_internet_low_usd)}–{fmt(g.monthly_internet_high_usd)}/mo ({fmt(g.annual_internet_low_usd)}–{fmt(g.annual_internet_high_usd)}/yr)</span>
                <span style={{ color: '#4f46e5' }}>Audio Processing:</span><span>{fmt(g.audio_proc_low_usd)} – {fmt(g.audio_proc_high_usd)}</span>
                <span style={{ color: '#4f46e5' }}>Total Setup:</span><span style={{ fontWeight: 600 }}>{fmt(g.total_stl_setup_low_usd)} – {fmt(g.total_stl_setup_high_usd)}</span>
              </div>
              <div className="font-mono text-[8px] leading-snug" style={{ marginTop: 6, color: '#312e81' }}>{g.note}</div>
            </div>
          );
        })()}

        {/* AM Construction Project Schedule and Management Guide */}
        {candidate.am_construction_project_schedule_and_management_guide && (() => {
          const g = candidate.am_construction_project_schedule_and_management_guide;
          const fmt = (n) => n != null ? `$${Number(n).toLocaleString()}` : '—';
          return (
            <div key="sch-guide" style={{ marginBottom: 16, padding: 12, background: '#faf5ff', borderRadius: 8, border: '2px solid #9333ea' }}>
              <div style={{ fontWeight: 700, color: '#3b0764', marginBottom: 6, fontSize: 13 }}>Construction Project Schedule &amp; Management</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 12px', fontSize: 12, color: '#7e22ce' }}>
                <span style={{ color: '#9333ea' }}>Channel / Mode:</span><span style={{ fontWeight: 600 }}>{g.is_clear ? 'Clear channel' : 'Non-clear'} {g.is_da ? 'DA' : 'NDA'} Class {g.fcc_class}</span>
                <span style={{ color: '#9333ea' }}>Pre-FCC (search+ESA+app):</span><span>{g.pre_fcc_months_low}–{g.pre_fcc_months_high} months</span>
                <span style={{ color: '#9333ea' }}>FCC Processing:</span><span>{g.fcc_processing_months_low}–{g.fcc_processing_months_high} months{g.is_clear ? ' (clear channel)' : ''}</span>
                <span style={{ color: '#9333ea' }}>Construction:</span><span>{g.post_fcc_months_low}–{g.post_fcc_months_high} months ({g.construction_weeks_low}–{g.construction_weeks_high} wks)</span>
                <span style={{ color: '#9333ea' }}>Total Timeline:</span><span style={{ fontWeight: 600 }}>{g.total_months_low}–{g.total_months_high} months</span>
                <span style={{ color: '#9333ea' }}>PM Overhead ({(g.pm_pct * 100).toFixed(0)}%):</span><span>{fmt(g.pm_cost_low_usd)} – {fmt(g.pm_cost_high_usd)}</span>
              </div>
              <div className="font-mono text-[8px] leading-snug" style={{ marginTop: 6, color: '#6b21a8' }}>{g.note}</div>
            </div>
          );
        })()}

        {/* AM Utility Power Service and Metering Guide */}
        {candidate.am_utility_power_service_and_metering_guide && (() => {
          const g = candidate.am_utility_power_service_and_metering_guide;
          const fmt = (n) => n != null ? `$${Number(n).toLocaleString()}` : '—';
          return (
            <div key="pwr-guide" style={{ marginBottom: 16, padding: 12, background: '#fdf2f8', borderRadius: 8, border: '2px solid #be185d' }}>
              <div style={{ fontWeight: 700, color: '#831843', marginBottom: 6, fontSize: 13 }}>Utility Power Service &amp; Metering (NEC Art. 230)</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 12px', fontSize: 12, color: '#9d174d' }}>
                <span style={{ color: '#be185d' }}>Load / Service:</span><span style={{ fontWeight: 600 }}>{g.total_load_kw} kW — {g.service_type} ({g.service_size_amps}A)</span>
                <span style={{ color: '#be185d' }}>Service Entrance:</span><span>{fmt(g.service_entrance_low_usd)} – {fmt(g.service_entrance_high_usd)}</span>
                <span style={{ color: '#be185d' }}>Line Extension:</span><span>{g.line_ext_miles} mi — {fmt(g.line_ext_low_usd)} – {fmt(g.line_ext_high_usd)}</span>
                <span style={{ color: '#be185d' }}>Total Setup:</span><span style={{ fontWeight: 600 }}>{fmt(g.total_utility_setup_low_usd)} – {fmt(g.total_utility_setup_high_usd)}</span>
                <span style={{ color: '#be185d' }}>Monthly Power:</span><span>{fmt(g.monthly_power_cost_usd)}/mo at ${g.power_rate_per_kwh}/kWh</span>
                <span style={{ color: '#be185d' }}>Annual Power:</span><span>{fmt(g.annual_power_cost_usd)}/yr</span>
              </div>
              <div className="font-mono text-[8px] leading-snug" style={{ marginTop: 6, color: '#881337' }}>{g.note}</div>
            </div>
          );
        })()}

        {/* AM Transmission Line and Antenna Tuning Unit Guide */}
        {candidate.am_transmission_line_and_antenna_tuning_unit_guide && (() => {
          const g = candidate.am_transmission_line_and_antenna_tuning_unit_guide;
          const fmt = (n) => n != null ? `$${Number(n).toLocaleString()}` : '—';
          return (
            <div key="atu-guide" style={{ marginBottom: 16, padding: 12, background: '#fef9c3', borderRadius: 8, border: '2px solid #ca8a04' }}>
              <div style={{ fontWeight: 700, color: '#713f12', marginBottom: 6, fontSize: 13 }}>Transmission Line &amp; Antenna Tuning Unit (§73.51 / §73.54)</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 12px', fontSize: 12, color: '#92400e' }}>
                <span style={{ color: '#ca8a04' }}>Configuration:</span><span style={{ fontWeight: 600 }}>{g.is_da ? 'DA' : 'NDA'} — {g.n_towers} tower{g.n_towers > 1 ? 's' : ''}</span>
                <span style={{ color: '#ca8a04' }}>Est. Rbase:</span><span>{g.r_base_est_ohm} Ω (Rrad={g.r_radiation_est_ohm} Ω + Rg={g.r_ground_est_ohm} Ω)</span>
                <span style={{ color: '#ca8a04' }}>ATU:</span><span>{fmt(g.atu_cost_low_usd)} – {fmt(g.atu_cost_high_usd)}</span>
                {g.is_da && <><span style={{ color: '#ca8a04' }}>Phasor:</span><span>{fmt(g.phasor_low_usd)} – {fmt(g.phasor_high_usd)}</span></>}
                <span style={{ color: '#ca8a04' }}>Base Current Meter:</span><span>{fmt(g.base_current_meter_low_usd)} – {fmt(g.base_current_meter_high_usd)}</span>
                <span style={{ color: '#ca8a04' }}>Tx Line:</span><span>{fmt(g.tx_line_low_usd)} – {fmt(g.tx_line_high_usd)}</span>
                <span style={{ color: '#ca8a04' }}>Total ATU System:</span><span style={{ fontWeight: 600 }}>{fmt(g.total_atu_system_low_usd)} – {fmt(g.total_atu_system_high_usd)}</span>
              </div>
              <div className="font-mono text-[8px] leading-snug" style={{ marginTop: 6, color: '#78350f' }}>{g.note}</div>
            </div>
          );
        })()}

        {/* AM Tower Base Insulator and RF Isolation Guide */}
        {candidate.am_tower_base_insulator_and_rf_isolation_guide && (() => {
          const g = candidate.am_tower_base_insulator_and_rf_isolation_guide;
          const fmt = (n) => n != null ? `$${Number(n).toLocaleString()}` : '—';
          return (
            <div key="rfi-guide" style={{ marginBottom: 16, padding: 12, background: '#fdf6ec', borderRadius: 8, border: '2px solid #c2410c' }}>
              <div style={{ fontWeight: 700, color: '#7c2d12', marginBottom: 6, fontSize: 13 }}>Tower Base Insulator &amp; RF Isolation (§73.49 / §73.1213)</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 12px', fontSize: 12, color: '#9a3412' }}>
                <span style={{ color: '#c2410c' }}>Tower / Wavelength:</span><span>{g.tower_height_ft} ft (λ={g.wavelength_m} m at {g.frequency_khz} kHz)</span>
                <span style={{ color: '#c2410c' }}>Base Insulator:</span><span style={{ fontWeight: 600 }}>{g.base_insulator_type} — {fmt(g.base_insulator_low_usd)} – {fmt(g.base_insulator_high_usd)}</span>
                <span style={{ color: '#c2410c' }}>Lightning Gap:</span><span>{fmt(g.lightning_gap_low_usd)} – {fmt(g.lightning_gap_high_usd)}</span>
                <span style={{ color: '#c2410c' }}>Guy RF Chokes ({g.n_guy_levels} levels):</span><span>{fmt(g.rf_choke_total_low_usd)} – {fmt(g.rf_choke_total_high_usd)}</span>
                <span style={{ color: '#c2410c' }}>Lighting Isolation:</span><span>{fmt(g.lighting_isolation_low_usd)} – {fmt(g.lighting_isolation_high_usd)}</span>
                <span style={{ color: '#c2410c' }}>Total RF Isolation:</span><span style={{ fontWeight: 600 }}>{fmt(g.total_rf_isolation_low_usd)} – {fmt(g.total_rf_isolation_high_usd)}</span>
              </div>
              <div className="font-mono text-[8px] leading-snug" style={{ marginTop: 6, color: '#7c2d12' }}>{g.note}</div>
            </div>
          );
        })()}

        {/* AM Emergency Alert System Equipment Guide */}
        {candidate.am_emergency_alert_system_equipment_guide && (() => {
          const g = candidate.am_emergency_alert_system_equipment_guide;
          const fmt = (n) => n != null ? `$${Number(n).toLocaleString()}` : '—';
          return (
            <div key="eas-guide" style={{ marginBottom: 16, padding: 12, background: '#fef2f2', borderRadius: 8, border: '2px solid #dc2626' }}>
              <div style={{ fontWeight: 700, color: '#7f1d1d', marginBottom: 6, fontSize: 13 }}>Emergency Alert System (EAS) Equipment (47 CFR Part 11)</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 12px', fontSize: 12, color: '#b91c1c' }}>
                <span style={{ color: '#dc2626' }}>CAP Compatible:</span><span style={{ fontWeight: 600, color: g.cap_compatible ? '#16a34a' : '#dc2626' }}>{g.cap_compatible ? 'Yes (required)' : 'No — upgrade needed'}</span>
                <span style={{ color: '#dc2626' }}>Encoder/Decoder:</span><span>{fmt(g.eas_encoder_decoder_low_usd)} – {fmt(g.eas_encoder_decoder_high_usd)}</span>
                <span style={{ color: '#dc2626' }}>Audio Routing:</span><span>{fmt(g.audio_routing_low_usd)} – {fmt(g.audio_routing_high_usd)}</span>
                <span style={{ color: '#dc2626' }}>Installation:</span><span>{fmt(g.installation_low_usd)} – {fmt(g.installation_high_usd)}</span>
                <span style={{ color: '#dc2626' }}>Annual Monitoring:</span><span>{fmt(g.annual_monitoring_low_usd)} – {fmt(g.annual_monitoring_high_usd)}/yr (IPAWS/CAP)</span>
                <span style={{ color: '#dc2626' }}>Total Equipment:</span><span style={{ fontWeight: 600 }}>{fmt(g.total_eas_equipment_low_usd)} – {fmt(g.total_eas_equipment_high_usd)}</span>
                <span style={{ color: '#dc2626' }}>Required Sources:</span><span>{g.n_required_sources} (LP-1 + LP-2); logs retained {g.log_retention_years} years</span>
              </div>
              <div className="font-mono text-[8px] leading-snug" style={{ marginTop: 6, color: '#991b1b' }}>{g.note}</div>
            </div>
          );
        })()}

        {/* AM Auxiliary Transmitter and Backup Power Guide */}
        {candidate.am_auxiliary_transmitter_and_backup_power_guide && (() => {
          const g = candidate.am_auxiliary_transmitter_and_backup_power_guide;
          const fmt = (n) => n != null ? `$${Number(n).toLocaleString()}` : '—';
          return (
            <div key="bkp-guide" style={{ marginBottom: 16, padding: 12, background: '#ecfeff', borderRadius: 8, border: '2px solid #0891b2' }}>
              <div style={{ fontWeight: 700, color: '#164e63', marginBottom: 6, fontSize: 13 }}>Auxiliary Transmitter &amp; Backup Power (§73.1660)</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 12px', fontSize: 12, color: '#0e7490' }}>
                <span style={{ color: '#0891b2' }}>Power Budget:</span><span>{g.tx_dc_kw} kW tx + {g.building_load_kw} kW bldg = {g.total_load_kw} kW total</span>
                <span style={{ color: '#0891b2' }}>Generator:</span><span style={{ fontWeight: 600 }}>{g.generator_kw} kW — {fmt(g.generator_cost_low_usd)} – {fmt(g.generator_cost_high_usd)}</span>
                <span style={{ color: '#0891b2' }}>Auto Transfer Switch:</span><span>{fmt(g.ats_low_usd)} – {fmt(g.ats_high_usd)}</span>
                <span style={{ color: '#0891b2' }}>UPS (10-min bridge):</span><span>{fmt(g.ups_low_usd)} – {fmt(g.ups_high_usd)}</span>
                <span style={{ color: '#0891b2' }}>Annual Maintenance:</span><span>{fmt(g.annual_maint_low_usd)} – {fmt(g.annual_maint_high_usd)}/yr</span>
                <span style={{ color: '#0891b2' }}>Total Backup System:</span><span style={{ fontWeight: 600 }}>{fmt(g.total_backup_low_usd)} – {fmt(g.total_backup_high_usd)}</span>
              </div>
              <div className="font-mono text-[8px] leading-snug" style={{ marginTop: 6, color: '#155e75' }}>{g.note}</div>
            </div>
          );
        })()}

        {/* AM Modulation Monitor and Station Logging Guide */}
        {candidate.am_modulation_monitor_and_station_logging_guide && (() => {
          const g = candidate.am_modulation_monitor_and_station_logging_guide;
          const fmt = (n) => n != null ? `$${Number(n).toLocaleString()}` : '—';
          return (
            <div key="mon-guide" style={{ marginBottom: 16, padding: 12, background: '#f0f9ff', borderRadius: 8, border: '2px solid #0284c7' }}>
              <div style={{ fontWeight: 700, color: '#0c4a6e', marginBottom: 6, fontSize: 13 }}>Modulation Monitor &amp; Station Logging (§73.1215 / §73.1820)</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 12px', fontSize: 12, color: '#0369a1' }}>
                <span style={{ color: '#0284c7' }}>Monitor Type:</span><span style={{ fontWeight: 600 }}>{g.monitor_type} (Class {g.fcc_class})</span>
                <span style={{ color: '#0284c7' }}>Monitor Cost:</span><span>{fmt(g.monitor_cost_low_usd)} – {fmt(g.monitor_cost_high_usd)}</span>
                <span style={{ color: '#0284c7' }}>Remote Control:</span><span>{fmt(g.remote_control_low_usd)} – {fmt(g.remote_control_high_usd)}</span>
                <span style={{ color: '#0284c7' }}>Internet Monitoring:</span><span>{fmt(g.internet_monitoring_low_usd)} – {fmt(g.internet_monitoring_high_usd)}</span>
                <span style={{ color: '#0284c7' }}>Annual Calibration:</span><span>{fmt(g.annual_calibration_low_usd)} – {fmt(g.annual_calibration_high_usd)}/yr</span>
                <span style={{ color: '#0284c7' }}>Total Monitoring:</span><span style={{ fontWeight: 600 }}>{fmt(g.total_monitoring_low_usd)} – {fmt(g.total_monitoring_high_usd)}</span>
                <span style={{ color: '#0284c7' }}>Log Schedule:</span><span>every {g.log_interval_min} min ({g.readings_per_day} readings/day)</span>
              </div>
              <div className="font-mono text-[8px] leading-snug" style={{ marginTop: 6, color: '#075985' }}>{g.note}</div>
            </div>
          );
        })()}

        {/* AM Transmitter Building and Equipment Shelter Guide */}
        {candidate.am_transmitter_building_and_equipment_shelter_guide && (() => {
          const g = candidate.am_transmitter_building_and_equipment_shelter_guide;
          const fmt = (n) => n != null ? `$${Number(n).toLocaleString()}` : '—';
          return (
            <div key="shlt-guide" style={{ marginBottom: 16, padding: 12, background: '#f5f3ff', borderRadius: 8, border: '2px solid #7c3aed' }}>
              <div style={{ fontWeight: 700, color: '#3b0764', marginBottom: 6, fontSize: 13 }}>Transmitter Building &amp; Equipment Shelter</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 12px', fontSize: 12, color: '#6d28d9' }}>
                <span style={{ color: '#7c3aed' }}>Building Type:</span><span style={{ fontWeight: 600 }}>{g.bldg_type} — {g.bldg_sqft} sq-ft</span>
                <span style={{ color: '#7c3aed' }}>Construction:</span><span>{fmt(g.bldg_construction_low_usd)} – {fmt(g.bldg_construction_high_usd)} ({fmt(g.bldg_cost_per_sqft_low)}–{fmt(g.bldg_cost_per_sqft_high)}/sq-ft)</span>
                <span style={{ color: '#7c3aed' }}>HVAC ({g.hvac_tons}-ton):</span><span>{fmt(g.hvac_low_usd)} – {fmt(g.hvac_high_usd)}</span>
                <span style={{ color: '#7c3aed' }}>Electrical Service:</span><span>{fmt(g.electrical_service_low_usd)} – {fmt(g.electrical_service_high_usd)}</span>
                <span style={{ color: '#7c3aed' }}>Generator Pad:</span><span>{fmt(g.generator_pad_low_usd)} – {fmt(g.generator_pad_high_usd)}</span>
                <span style={{ color: '#7c3aed' }}>Total Shelter:</span><span style={{ fontWeight: 600 }}>{fmt(g.total_shelter_low_usd)} – {fmt(g.total_shelter_high_usd)}</span>
              </div>
              <div className="font-mono text-[8px] leading-snug" style={{ marginTop: 6, color: '#4c1d95' }}>{g.note}</div>
            </div>
          );
        })()}

        {/* AM Site Lease and Land Acquisition Guide */}
        {candidate.am_site_lease_and_land_acquisition_guide && (() => {
          const g = candidate.am_site_lease_and_land_acquisition_guide;
          const fmt = (n) => n != null ? `$${Number(n).toLocaleString()}` : '—';
          return (
            <div key="lnd-guide" style={{ marginBottom: 16, padding: 12, background: '#f0fdfa', borderRadius: 8, border: '2px solid #0d9488' }}>
              <div style={{ fontWeight: 700, color: '#134e4a', marginBottom: 6, fontSize: 13 }}>Site Lease &amp; Land Acquisition (§73.1125)</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 12px', fontSize: 12, color: '#0f766e' }}>
                <span style={{ color: '#0d9488' }}>Land Class:</span><span style={{ fontWeight: 600 }}>{g.land_class} — {g.site_acres} acres @ {g.dist_km} km</span>
                <span style={{ color: '#0d9488' }}>Purchase (total):</span><span>{fmt(g.purchase_total_low_usd)} – {fmt(g.purchase_total_high_usd)}</span>
                <span style={{ color: '#0d9488' }}>Annual Lease:</span><span>{fmt(g.annual_lease_total_low_usd)} – {fmt(g.annual_lease_total_high_usd)}/yr</span>
                <span style={{ color: '#0d9488' }}>20-yr Lease Total:</span><span>{fmt(g.lease_20yr_low_usd)} – {fmt(g.lease_20yr_high_usd)}</span>
                <span style={{ color: '#0d9488' }}>Due Diligence:</span><span>{fmt(g.total_due_diligence_low_usd)} – {fmt(g.total_due_diligence_high_usd)} (survey, title, zoning)</span>
                <span style={{ color: '#0d9488' }}>Preferred Option:</span><span style={{ fontWeight: 600, color: g.preferred_option === 'lease' ? '#0d9488' : '#92400e' }}>{g.preferred_option}</span>
              </div>
              <div className="font-mono text-[8px] leading-snug" style={{ marginTop: 6, color: '#134e4a' }}>{g.note}</div>
            </div>
          );
        })()}

        {/* AM Carrier Frequency Accuracy and Reference Guide */}
        {candidate.am_carrier_frequency_accuracy_and_reference_guide && (() => {
          const g = candidate.am_carrier_frequency_accuracy_and_reference_guide;
          const fmt = (n) => n != null ? `$${Number(n).toLocaleString()}` : '—';
          const fmtHz = (n) => n != null ? (n < 1 ? `${n} Hz` : `${n} Hz`) : '—';
          return (
            <div key="cfa-guide" style={{ marginBottom: 16, padding: 12, background: '#eff6ff', borderRadius: 8, border: '2px solid #2563eb' }}>
              <div style={{ fontWeight: 700, color: '#1e3a8a', marginBottom: 6, fontSize: 13 }}>Carrier Frequency Accuracy &amp; Reference (§73.1545)</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 12px', fontSize: 12, color: '#1d4ed8' }}>
                <span style={{ color: '#2563eb' }}>Frequency:</span><span>{g.frequency_khz} kHz (±{g.required_accuracy_hz} Hz / {g.required_accuracy_ppm} ppm max)</span>
                <span style={{ color: '#2563eb' }}>Recommended Ref:</span><span style={{ fontWeight: 600 }}>{g.recommended_reference}</span>
                <span style={{ color: '#2563eb' }}>GPSDO Error:</span><span>{fmtHz(g.gpsdo_error_hz)} ({g.gpsdo_accuracy_ppb} ppb) — {fmt(g.gpsdo_cost_low_usd)}–{fmt(g.gpsdo_cost_high_usd)}</span>
                <span style={{ color: '#2563eb' }}>Rubidium Error:</span><span>{fmtHz(g.rubidium_error_hz)} ({g.rubidium_accuracy_ppb} ppb) — {fmt(g.rubidium_cost_low_usd)}–{fmt(g.rubidium_cost_high_usd)}</span>
                <span style={{ color: '#2563eb' }}>OCXO Error:</span><span>{fmtHz(g.ocxo_error_hz)} ({g.ocxo_accuracy_ppb.toLocaleString()} ppb) — {fmt(g.ocxo_cost_low_usd)}–{fmt(g.ocxo_cost_high_usd)}</span>
                <span style={{ color: '#2563eb' }}>Annual Calibration:</span><span>{fmt(g.annual_calibration_low_usd)} – {fmt(g.annual_calibration_high_usd)}</span>
              </div>
              <div className="font-mono text-[8px] leading-snug" style={{ marginTop: 6, color: '#1e40af' }}>{g.note}</div>
            </div>
          );
        })()}

        {/* AM Tower Decommissioning and Site Remediation Guide */}
        {candidate.am_tower_decommissioning_and_site_remediation_guide && (() => {
          const g = candidate.am_tower_decommissioning_and_site_remediation_guide;
          const fmt = (n) => n != null ? `$${Number(n).toLocaleString()}` : '—';
          return (
            <div key="demo-guide" style={{ marginBottom: 16, padding: 12, background: '#f4f4f5', borderRadius: 8, border: '2px solid #52525b' }}>
              <div style={{ fontWeight: 700, color: '#18181b', marginBottom: 6, fontSize: 13 }}>Site Decommissioning &amp; Remediation (Current Tower)</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 12px', fontSize: 12, color: '#3f3f46' }}>
                <span style={{ color: '#71717a' }}>Tower Height:</span><span>{g.tower_demo_ft} ft ≈ {g.tower_steel_tons_est} tons steel</span>
                <span style={{ color: '#71717a' }}>Tower Demolition:</span><span>{fmt(g.tower_demo_cost_low_usd)} – {fmt(g.tower_demo_cost_high_usd)}</span>
                <span style={{ color: '#71717a' }}>Steel Salvage:</span><span>{fmt(g.salvage_low_usd)} – {fmt(g.salvage_high_usd)} (credit)</span>
                <span style={{ color: '#71717a' }}>Building Demo:</span><span>{fmt(g.building_demo_low_usd)} – {fmt(g.building_demo_high_usd)}</span>
                <span style={{ color: '#71717a' }}>Site Restoration:</span><span>{fmt(g.site_restoration_low_usd)} – {fmt(g.site_restoration_high_usd)}</span>
                <span style={{ color: '#71717a' }}>Total (gross):</span><span>{fmt(g.total_demo_cost_low_usd)} – {fmt(g.total_demo_cost_high_usd)}</span>
                <span style={{ color: '#71717a' }}>Net (after salvage):</span><span>{fmt(g.net_demo_cost_low_usd)} – {fmt(g.net_demo_cost_high_usd)}</span>
              </div>
              <div className="font-mono text-[8px] leading-snug" style={{ marginTop: 6, color: '#52525b' }}>{g.note}</div>
            </div>
          );
        })()}

        {/* AM Ground System Resistance and Maintenance Guide */}
        {candidate.am_ground_system_resistance_and_maintenance_guide && (() => {
          const g = candidate.am_ground_system_resistance_and_maintenance_guide;
          const fmt = (n) => n != null ? `$${Number(n).toLocaleString()}` : '—';
          return (
            <div key="grm-guide" style={{ marginBottom: 16, padding: 12, background: '#f7fee7', borderRadius: 8, border: '2px solid #65a30d' }}>
              <div style={{ fontWeight: 700, color: '#365314', marginBottom: 6, fontSize: 13 }}>Ground System Resistance &amp; Maintenance (§73.190)</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 12px', fontSize: 12, color: '#3f6212' }}>
                <span style={{ color: '#65a30d' }}>Soil Conductivity:</span><span>{g.sigma_msm} mS/m → Rg≈{g.rg_est_ohm} Ω</span>
                <span style={{ color: '#65a30d' }}>Resistance Status:</span><span style={{ fontWeight: 600, color: g.rg_acceptable ? '#16a34a' : '#dc2626' }}>{g.rg_acceptable ? `Acceptable (< ${g.rg_target_ohm} Ω)` : `Exceeds ${g.rg_target_ohm} Ω target`}</span>
                <span style={{ color: '#65a30d' }}>Annual Check:</span><span>{fmt(g.annual_resistance_check_low_usd)} – {fmt(g.annual_resistance_check_high_usd)}</span>
                <span style={{ color: '#65a30d' }}>Radial Repair:</span><span>{g.n_radials_annual_replace_low}–{g.n_radials_annual_replace_high} /yr × {fmt(g.radial_repair_cost_per_radial_usd)}</span>
                <span style={{ color: '#65a30d' }}>5-yr Inspection:</span><span>{fmt(g.comprehensive_inspection_low_usd)} – {fmt(g.comprehensive_inspection_high_usd)} ({fmt(g.comprehensive_amortized_annual_usd)}/yr amortized)</span>
                <span style={{ color: '#65a30d' }}>Annual Reserve:</span><span>{fmt(g.total_annual_ground_maint_low_usd)} – {fmt(g.total_annual_ground_maint_high_usd)}</span>
              </div>
              <div className="font-mono text-[8px] leading-snug" style={{ marginTop: 6, color: '#365314' }}>{g.note}</div>
            </div>
          );
        })()}

        {/* AM Commissioning and Acceptance Testing Guide */}
        {candidate.am_commissioning_and_acceptance_testing_guide && (() => {
          const g = candidate.am_commissioning_and_acceptance_testing_guide;
          const fmt = (n) => n != null ? `$${Number(n).toLocaleString()}` : '—';
          return (
            <div key="com-guide" style={{ marginBottom: 16, padding: 12, background: '#fdf4ff', borderRadius: 8, border: '2px solid #a21caf' }}>
              <div style={{ fontWeight: 700, color: '#701a75', marginBottom: 6, fontSize: 13 }}>Commissioning &amp; Acceptance Testing (§73.44 / §73.61 / OET-65)</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 12px', fontSize: 12, color: '#7e22ce' }}>
                <span style={{ color: '#a21caf' }}>Station:</span><span>{g.tpo_kw} kW {g.is_da ? 'DA' : 'NDA'} Class {g.fcc_class} at {g.pattern_mode}</span>
                <span style={{ color: '#a21caf' }}>FAT (factory):</span><span>{fmt(g.fat_cost_low_usd)} – {fmt(g.fat_cost_high_usd)}</span>
                <span style={{ color: '#a21caf' }}>SAT (site):</span><span>{fmt(g.sat_cost_low_usd)} – {fmt(g.sat_cost_high_usd)}</span>
                <span style={{ color: '#a21caf' }}>Harmonic Test:</span><span>{fmt(g.harmonic_test_low_usd)} – {fmt(g.harmonic_test_high_usd)}</span>
                <span style={{ color: '#a21caf' }}>MPE Survey:</span><span>{fmt(g.mpe_survey_low_usd)} – {fmt(g.mpe_survey_high_usd)} {g.mpe_evaluation_required ? '(required)' : '(optional)'}</span>
                <span style={{ color: '#a21caf' }}>Total:</span><span>{fmt(g.total_commissioning_low_usd)} – {fmt(g.total_commissioning_high_usd)}</span>
                <span style={{ color: '#a21caf' }}>Timeline:</span><span>{g.commissioning_weeks_low}–{g.commissioning_weeks_high} weeks</span>
              </div>
              <div className="font-mono text-[8px] leading-snug" style={{ marginTop: 6, color: '#701a75' }}>{g.note}</div>
            </div>
          );
        })()}

        {/* AM Broadcast Tower Structural Inspection Guide */}
        {candidate.am_broadcast_tower_structural_inspection_guide && (() => {
          const g = candidate.am_broadcast_tower_structural_inspection_guide;
          const fmt = (n) => n != null ? `$${Number(n).toLocaleString()}` : '—';
          return (
            <div key="insp-guide" style={{ marginBottom: 16, padding: 12, background: '#fff1f2', borderRadius: 8, border: '2px solid #e11d48' }}>
              <div style={{ fontWeight: 700, color: '#881337', marginBottom: 6, fontSize: 13 }}>Tower Structural Inspection (TIA-222-H §8)</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 12px', fontSize: 12, color: '#9f1239' }}>
                <span style={{ color: '#e11d48' }}>Tower Height:</span><span>{g.tower_insp_ft} ft — {g.n_guy_levels} guy levels</span>
                <span style={{ color: '#e11d48' }}>Annual Visual:</span><span>{fmt(g.annual_inspection_low_usd)} – {fmt(g.annual_inspection_high_usd)}</span>
                <span style={{ color: '#e11d48' }}>3-yr Detailed:</span><span>{fmt(g.detailed_inspection_low_usd)} – {fmt(g.detailed_inspection_high_usd)} ({fmt(g.detailed_amortized_annual_usd)}/yr)</span>
                <span style={{ color: '#e11d48' }}>Guy Tension Check:</span><span>{fmt(g.guy_tension_check_low_usd)} – {fmt(g.guy_tension_check_high_usd)}</span>
                <span style={{ color: '#e11d48' }}>Annual Reserve:</span><span>{fmt(g.total_annual_inspection_low_usd)} – {fmt(g.total_annual_inspection_high_usd)}</span>
                <span style={{ color: '#e11d48' }}>Design Life:</span><span>{g.design_life_years} years</span>
              </div>
              <div className="font-mono text-[8px] leading-snug" style={{ marginTop: 6, color: '#881337' }}>{g.note}</div>
            </div>
          );
        })()}

        {/* AM Annual Regulatory Compliance and Fee Guide */}
        {candidate.am_annual_regulatory_compliance_and_fee_guide && (() => {
          const g = candidate.am_annual_regulatory_compliance_and_fee_guide;
          const fmt = (n) => n != null ? `$${Number(n).toLocaleString()}` : '—';
          return (
            <div key="reg-guide" style={{ marginBottom: 16, padding: 12, background: '#eef2ff', borderRadius: 8, border: '2px solid #4338ca' }}>
              <div style={{ fontWeight: 700, color: '#312e81', marginBottom: 6, fontSize: 13 }}>Annual Regulatory Compliance &amp; FCC Fees</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 12px', fontSize: 12, color: '#3730a3' }}>
                <span style={{ color: '#4338ca' }}>Annual FCC Fee:</span><span>{fmt(g.annual_fcc_fee_usd)} (Class {g.fcc_class})</span>
                <span style={{ color: '#4338ca' }}>License Renewal:</span><span>{fmt(g.renewal_fee_usd)} / {g.license_renewal_cycle_years} yr ({fmt(g.renewal_amortized_annual_usd)}/yr amortized)</span>
                <span style={{ color: '#4338ca' }}>EAS Testing:</span><span>{fmt(g.eas_testing_annual_low_usd)} – {fmt(g.eas_testing_annual_high_usd)}/yr</span>
                <span style={{ color: '#4338ca' }}>Compliance Counsel:</span><span>{fmt(g.compliance_consultant_annual_low_usd)} – {fmt(g.compliance_consultant_annual_high_usd)}/yr</span>
                <span style={{ color: '#4338ca' }}>Total Annual:</span><span>{fmt(g.total_annual_compliance_low_usd)} – {fmt(g.total_annual_compliance_high_usd)}</span>
                <span style={{ color: '#4338ca' }}>10-yr PV (3%):</span><span>{fmt(g.pv_10yr_low_usd)} – {fmt(g.pv_10yr_high_usd)}</span>
              </div>
              <div className="font-mono text-[8px] leading-snug" style={{ marginTop: 6, color: '#312e81' }}>{g.note}</div>
            </div>
          );
        })()}

        {/* AM Concrete Foundation and Anchor Design Guide */}
        {candidate.am_concrete_foundation_and_anchor_design_guide && (() => {
          const g = candidate.am_concrete_foundation_and_anchor_design_guide;
          const fmt = (n) => n != null ? `$${Number(n).toLocaleString()}` : '—';
          return (
            <div key="fnd-guide" style={{ marginBottom: 16, padding: 12, background: '#fafaf9', borderRadius: 8, border: '2px solid #78716c' }}>
              <div style={{ fontWeight: 700, color: '#292524', marginBottom: 6, fontSize: 13 }}>Concrete Foundation &amp; Anchor Design (TIA-222-H / ACI 318)</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 12px', fontSize: 12, color: '#44403c' }}>
                <span style={{ color: '#78716c' }}>Tower Height:</span><span>{g.tower_fnd_ft} ft ({g.tower_fnd_m} m)</span>
                <span style={{ color: '#78716c' }}>Base Pier:</span><span>{g.base_pier_diameter_ft} ft dia × {g.base_pier_depth_ft} ft deep ({g.base_pier_cy} CY)</span>
                <span style={{ color: '#78716c' }}>Guy Anchors:</span><span>{g.n_anchors} × {g.anchor_dim_ft} ft × {g.anchor_dim_ft} ft × {g.anchor_depth_ft} ft ({g.anchor_cy_each} CY each)</span>
                <span style={{ color: '#78716c' }}>Total Concrete:</span><span>{g.total_concrete_cy} CY</span>
                <span style={{ color: '#78716c' }}>Foundation Cost:</span><span>{fmt(g.foundation_cost_low_usd)} – {fmt(g.foundation_cost_high_usd)}</span>
                <span style={{ color: '#78716c' }}>Total System:</span><span>{fmt(g.total_foundation_low_usd)} – {fmt(g.total_foundation_high_usd)}</span>
              </div>
              <div className="font-mono text-[8px] leading-snug" style={{ marginTop: 6, color: '#57534e' }}>{g.note}</div>
            </div>
          );
        })()}

        {/* AM Tower Painting and Aviation Marking Guide */}
        {candidate.am_tower_painting_and_aviation_marking_guide && (() => {
          const g = candidate.am_tower_painting_and_aviation_marking_guide;
          const fmt = (n) => n != null ? `$${Number(n).toLocaleString()}` : '—';
          return (
            <div key="pnt-guide" style={{ marginBottom: 16, padding: 12, background: '#fff7ed', borderRadius: 8, border: '2px solid #ea580c' }}>
              <div style={{ fontWeight: 700, color: '#9a3412', marginBottom: 6, fontSize: 13 }}>Tower Painting &amp; Aviation Marking (47 CFR §17.50)</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 12px', fontSize: 12, color: '#7c2d12' }}>
                <span style={{ color: '#c2410c' }}>Tower Height:</span><span>{g.tower_pnt_ft} ft ({g.tower_pnt_m} m)</span>
                <span style={{ color: '#c2410c' }}>Aviation Marking:</span><span style={{ fontWeight: 600, color: g.requires_aviation_marking ? '#dc2626' : '#16a34a' }}>{g.requires_aviation_marking ? 'Required (>200 ft)' : 'Not Required'}</span>
                <span style={{ color: '#c2410c' }}>Initial Paint Cost:</span><span>{fmt(g.initial_paint_cost_low_usd)} – {fmt(g.initial_paint_cost_high_usd)}</span>
                <span style={{ color: '#c2410c' }}>Paint Cycle:</span><span>{g.paint_cycle_years_low}–{g.paint_cycle_years_high} years</span>
                <span style={{ color: '#c2410c' }}>Annual Reserve:</span><span>{fmt(g.annual_paint_reserve_usd)}/yr</span>
                <span style={{ color: '#c2410c' }}>20-yr Lifecycle:</span><span>{fmt(g.life_20yr_paint_low_usd)} – {fmt(g.life_20yr_paint_high_usd)}</span>
                {g.requires_aviation_marking && <><span style={{ color: '#c2410c' }}>Lighting Alt:</span><span>{fmt(g.lighting_only_initial_low_usd)} – {fmt(g.lighting_only_initial_high_usd)} (strobe/beacon)</span></>}
              </div>
              <div className="font-mono text-[8px] leading-snug" style={{ marginTop: 6, color: '#9a3412' }}>{g.note}</div>
            </div>
          );
        })()}

        {/* AM Noise Floor and RF Environment Analysis Guide */}
        {candidate.am_noise_floor_and_rf_environment_analysis_guide && (() => {
          const g = candidate.am_noise_floor_and_rf_environment_analysis_guide;
          const riskColor = g.interference_risk === 'low' ? '#16a34a' : g.interference_risk === 'medium' ? '#d97706' : '#dc2626';
          return (
            <div key="nf-guide" style={{ marginBottom: 16, padding: 12, background: '#f8fafc', borderRadius: 8, border: '2px solid #334155' }}>
              <div style={{ fontWeight: 700, color: '#1e293b', marginBottom: 6, fontSize: 13 }}>Noise Floor &amp; RF Environment (ITU-R P.372)</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 12px', fontSize: 12, color: '#334155' }}>
                <span style={{ color: '#64748b' }}>Atmospheric Fa:</span><span>{g.fa_atmospheric_db} dB ({g.frequency_khz} kHz)</span>
                <span style={{ color: '#64748b' }}>Man-Made Fa:</span><span>{g.fa_man_made_db} dB ({g.land_use_noise_class})</span>
                <span style={{ color: '#64748b' }}>Noise Floor:</span><span>≈{g.noise_floor_db_uvm} dBμV/m ({g.bw_khz} kHz BW)</span>
                <span style={{ color: '#64748b' }}>Interference Risk:</span><span style={{ fontWeight: 600, color: riskColor }}>{g.interference_risk.toUpperCase()}</span>
                <span style={{ color: '#64748b' }}>Noise Score:</span><span>{g.noise_score}/100 (higher = quieter)</span>
                <span style={{ color: '#64748b' }}>Reduction vs Urban:</span><span>−{g.noise_reduction_vs_urban_db} dB man-made noise</span>
              </div>
              <div className="font-mono text-[8px] leading-snug" style={{ marginTop: 6, color: '#475569' }}>{g.note}</div>
            </div>
          );
        })()}

        {/* AM Phase I Environmental Site Assessment Guide */}
        {candidate.am_phase_i_environmental_site_assessment_guide && (() => {
          const g = candidate.am_phase_i_environmental_site_assessment_guide;
          const fmt = (n) => n != null ? `$${Number(n).toLocaleString()}` : '—';
          return (
            <div key="esa-guide" style={{ marginBottom: 16, padding: 12, background: '#f0fdf4', borderRadius: 8, border: '2px solid #16a34a' }}>
              <div style={{ fontWeight: 700, color: '#14532d', marginBottom: 6, fontSize: 13 }}>Phase I Environmental Site Assessment (ASTM E1527-21)</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 12px', fontSize: 12, color: '#166534' }}>
                <span style={{ color: '#16a34a' }}>Site Area:</span><span>{g.site_acres} acres (Class {g.fcc_class})</span>
                <span style={{ color: '#16a34a' }}>Phase I Cost:</span><span>{fmt(g.phase1_cost_low_usd)} – {fmt(g.phase1_cost_high_usd)}</span>
                <span style={{ color: '#16a34a' }}>Phase I Timeline:</span><span>{g.phase1_weeks} weeks</span>
                <span style={{ color: '#16a34a' }}>REC Probability:</span><span>{g.rec_probability_pct}% (rural AM site)</span>
                <span style={{ color: '#16a34a' }}>Phase II (if RECs):</span><span>{fmt(g.phase2_cost_low_usd)} – {fmt(g.phase2_cost_high_usd)}</span>
                <span style={{ color: '#16a34a' }}>Total High:</span><span>{fmt(g.total_esa_high_usd)} (incl. vapor intrusion)</span>
                <span style={{ color: '#16a34a' }}>Phase II Timeline:</span><span>+{g.phase2_weeks_low}–{g.phase2_weeks_high} weeks if triggered</span>
              </div>
              <div className="font-mono text-[8px] leading-snug" style={{ marginTop: 6, color: '#14532d' }}>{g.note}</div>
            </div>
          );
        })()}

        {/* AM FCC Application Engineering Report Guide */}
        {candidate.am_fcc_application_engineering_report_guide && (() => {
          const g = candidate.am_fcc_application_engineering_report_guide;
          const fmt = (n) => n != null ? `$${Number(n).toLocaleString()}` : '—';
          return (
            <div key="fca-guide" style={{ marginBottom: 16, padding: 12, background: '#fefce8', borderRadius: 8, border: '2px solid #d97706' }}>
              <div style={{ fontWeight: 700, color: '#92400e', marginBottom: 6, fontSize: 13 }}>FCC Form 301-AM Application &amp; Engineering</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 12px', fontSize: 12, color: '#78350f' }}>
                <span style={{ color: '#b45309' }}>Channel Type:</span><span>{g.is_clear_channel ? 'Clear Channel' : 'Regional/Local'} — {g.frequency_khz} kHz</span>
                <span style={{ color: '#b45309' }}>Antenna Pattern:</span><span>{g.is_da ? 'Directional (DA)' : 'Non-Directional (NDA)'}</span>
                <span style={{ color: '#b45309' }}>FCC Filing Fee:</span><span>{fmt(g.fcc_filing_fee_usd)} (Form 301-AM)</span>
                <span style={{ color: '#b45309' }}>Stations to Study:</span><span>~{g.n_stations_to_study} within {g.study_radius_km} km</span>
                <span style={{ color: '#b45309' }}>Engineering Cost:</span><span>{fmt(g.eng_cost_low_usd)} – {fmt(g.eng_cost_high_usd)}</span>
                <span style={{ color: '#b45309' }}>Total App Cost:</span><span>{fmt(g.total_application_low_usd)} – {fmt(g.total_application_high_usd)}</span>
                <span style={{ color: '#b45309' }}>Processing Time:</span><span>{g.processing_months_low}–{g.processing_months_high} months</span>
              </div>
              <div className="font-mono text-[8px] leading-snug" style={{ marginTop: 6, color: '#92400e' }}>{g.note}</div>
            </div>
          );
        })()}

        {/* AM Site Access Road and Security Guide */}
        {candidate.am_site_access_road_and_security_guide && (() => {
          const g = candidate.am_site_access_road_and_security_guide;
          const fmt = (n) => n != null ? `$${Number(n).toLocaleString()}` : '—';
          return (
            <div key="sec-guide" style={{ marginBottom: 16, padding: 12, background: '#f9fafb', borderRadius: 8, border: '1px solid #6b7280' }}>
              <div style={{ fontWeight: 700, color: '#1f2937', marginBottom: 6, fontSize: 13 }}>Site Access Road &amp; Security</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 12px', fontSize: 12, color: '#374151' }}>
                <span style={{ color: '#6b7280' }}>Perimeter Fence:</span><span>{g.fence_perim_ft} ft — {fmt(g.fence_cost_low_usd)} – {fmt(g.fence_cost_high_usd)}</span>
                <span style={{ color: '#6b7280' }}>Entry Gate:</span><span>{fmt(g.gate_cost_low_usd)} – {fmt(g.gate_cost_high_usd)}</span>
                <span style={{ color: '#6b7280' }}>Access Road:</span><span>{g.road_length_ft} ft — {fmt(g.road_cost_low_usd)} – {fmt(g.road_cost_high_usd)}</span>
                <span style={{ color: '#6b7280' }}>Security Cameras ({g.camera_count}x):</span><span>{fmt(g.camera_cost_low_usd)} – {fmt(g.camera_cost_high_usd)}</span>
                <span style={{ color: '#6b7280' }}>Alarm System:</span><span>{fmt(g.alarm_cost_low_usd)} – {fmt(g.alarm_cost_high_usd)}</span>
                <span style={{ color: '#6b7280' }}>RF Signs ({g.n_rf_signs}x) + Clearing:</span><span>{fmt(g.rf_signs_cost_usd + g.vegetation_clearing_low_usd)} – {fmt(g.rf_signs_cost_usd + g.vegetation_clearing_high_usd)}</span>
                <span style={{ color: '#6b7280' }}>Total Capital:</span><span style={{ fontWeight: 600 }}>{fmt(g.total_security_low_usd)} – {fmt(g.total_security_high_usd)}</span>
                <span style={{ color: '#6b7280' }}>Annual Monitoring:</span><span>{fmt(g.annual_security_maint_usd)}/yr</span>
              </div>
              {g.note && <div style={{ marginTop: 6, fontSize: 11, color: '#374151', fontStyle: 'italic' }}>{g.note}</div>}
            </div>
          );
        })()}

        {/* AM Geotechnical and Soil Investigation Guide */}
        {candidate.am_geotechnical_and_soil_investigation_guide && (() => {
          const g = candidate.am_geotechnical_and_soil_investigation_guide;
          const fmt = (n) => n != null ? `$${Number(n).toLocaleString()}` : '—';
          return (
            <div key="gt-guide" style={{ marginBottom: 16, padding: 12, background: '#fdf8f0', borderRadius: 8, border: '1px solid #b45309' }}>
              <div style={{ fontWeight: 700, color: '#78350f', marginBottom: 6, fontSize: 13 }}>Geotechnical &amp; Soil Investigation</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 12px', fontSize: 12, color: '#374151' }}>
                <span style={{ color: '#6b7280' }}>USCS Soil Class:</span><span style={{ fontWeight: 600 }}>{g.uscs_class}</span>
                <span style={{ color: '#6b7280' }}>Bearing Capacity:</span><span>{g.bearing_capacity_psf_low.toLocaleString()}–{g.bearing_capacity_psf_high.toLocaleString()} psf</span>
                <span style={{ color: '#6b7280' }}>Frost Depth:</span><span>{g.frost_depth_in} in.</span>
                <span style={{ color: '#6b7280' }}>Foundation Type:</span><span>{g.foundation_type}</span>
                <span style={{ color: '#6b7280' }}>Foundation Depth:</span><span>{g.foundation_depth_ft_low}–{g.foundation_depth_ft_high} ft</span>
                <span style={{ color: '#6b7280' }}>Boring Program:</span><span>{g.n_borings} borings × {g.boring_depth_ft} ft (SPT)</span>
                <span style={{ color: '#6b7280' }}>Borings Cost:</span><span>{fmt(g.borings_cost_low_usd)} – {fmt(g.borings_cost_high_usd)}</span>
                <span style={{ color: '#6b7280' }}>Lab + Report:</span><span>{fmt(g.lab_analysis_cost_usd + g.geotech_report_cost_usd)}</span>
                <span style={{ color: '#6b7280' }}>Total Geotech:</span><span style={{ fontWeight: 600 }}>{fmt(g.total_geotech_low_usd)} – {fmt(g.total_geotech_high_usd)}</span>
              </div>
              <div style={{ marginTop: 4, fontSize: 11, color: '#92400e' }}>{g.soil_description}</div>
              {g.note && <div style={{ marginTop: 4, fontSize: 11, color: '#78350f', fontStyle: 'italic' }}>{g.note}</div>}
            </div>
          );
        })()}

        {/* AM RF System Monitoring and Telemetry Guide */}
        {candidate.am_rf_system_monitoring_and_telemetry_guide && (() => {
          const g = candidate.am_rf_system_monitoring_and_telemetry_guide;
          const fmt = (n) => n != null ? `$${Number(n).toLocaleString()}` : '—';
          return (
            <div key="tel-guide" style={{ marginBottom: 16, padding: 12, background: '#f0f4ff', borderRadius: 8, border: '1px solid #1d4ed8' }}>
              <div style={{ fontWeight: 700, color: '#1e3a5f', marginBottom: 6, fontSize: 13 }}>RF System Monitoring &amp; Telemetry</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 12px', fontSize: 12, color: '#374151' }}>
                <span style={{ color: '#6b7280' }}>Tower Elements:</span><span>{g.n_elements} ({g.n_base_meters} base current meter{g.n_base_meters > 1 ? 's' : ''})</span>
                <span style={{ color: '#6b7280' }}>Remote Control:</span><span>{g.fcc_remote_control_allowed ? '✓ Permitted (§73.1400)' : 'Not permitted'}</span>
                <span style={{ color: '#6b7280' }}>Base Current Meters:</span><span>{fmt(g.base_meters_total_low_usd)} – {fmt(g.base_meters_total_high_usd)}</span>
                <span style={{ color: '#6b7280' }}>Remote Controller:</span><span>{fmt(g.remote_ctrl_cost_low_usd)} – {fmt(g.remote_ctrl_cost_high_usd)}</span>
                <span style={{ color: '#6b7280' }}>Connectivity Install:</span><span>{fmt(g.connectivity_install_low_usd)} – {fmt(g.connectivity_install_high_usd)}</span>
                {g.scada_low_usd > 0 && <><span style={{ color: '#6b7280' }}>SCADA System:</span><span>{fmt(g.scada_low_usd)} – {fmt(g.scada_high_usd)}</span></>}
                <span style={{ color: '#6b7280' }}>Total Capital:</span><span style={{ fontWeight: 600 }}>{fmt(g.total_telemetry_low_usd)} – {fmt(g.total_telemetry_high_usd)}</span>
                <span style={{ color: '#6b7280' }}>Annual Connectivity:</span><span>{fmt(g.annual_connectivity_usd)}/yr</span>
                <span style={{ color: '#6b7280' }}>FCC Log Interval:</span><span>{g.log_interval_min} min ({g.annual_log_entries.toLocaleString()} entries/yr)</span>
              </div>
              {g.note && <div style={{ marginTop: 6, fontSize: 11, color: '#1e3a5f', fontStyle: 'italic' }}>{g.note}</div>}
            </div>
          );
        })()}

        {/* AM Coverage Improvement vs Current Site Guide */}
        {candidate.am_coverage_improvement_vs_current_site_guide && (() => {
          const g = candidate.am_coverage_improvement_vs_current_site_guide;
          const verdictColor = g.verdict.includes('GAIN') ? '#15803d' : g.verdict.includes('LOSS') ? '#dc2626' : '#374151';
          return (
            <div key="ci-guide" style={{ marginBottom: 16, padding: 12, background: '#f8fafc', borderRadius: 8, border: '2px solid #0ea5e9' }}>
              <div style={{ fontWeight: 700, color: '#0c4a6e', marginBottom: 6, fontSize: 13 }}>Coverage Improvement vs Current Site</div>
              <div style={{ marginBottom: 6, padding: '4px 8px', background: '#e0f2fe', borderRadius: 4, fontSize: 13, fontWeight: 700, color: verdictColor }}>{g.verdict.replace(/_/g, ' ')}</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 12px', fontSize: 12, color: '#374151' }}>
                <span style={{ color: '#6b7280' }}>Current Site Radius:</span><span>{g.d_current_km} km (σ={g.sigma_current} mS/m)</span>
                <span style={{ color: '#6b7280' }}>Candidate Radius:</span><span style={{ fontWeight: 600, color: verdictColor }}>{g.d_candidate_km} km (σ={g.sigma_candidate} mS/m)</span>
                <span style={{ color: '#6b7280' }}>Coverage Change:</span><span style={{ color: verdictColor, fontWeight: 600 }}>{g.coverage_radius_delta_pct >= 0 ? '+' : ''}{g.coverage_radius_delta_pct}% ({g.coverage_delta_km2 >= 0 ? '+' : ''}{g.coverage_delta_km2} km²)</span>
                <span style={{ color: '#6b7280' }}>Displacement:</span><span>{g.displacement_km} km at {g.bearing_deg_ci}°</span>
                <span style={{ color: '#6b7280' }}>COL Coverage:</span><span>{g.col_field_improvement}</span>
                <span style={{ color: '#6b7280' }}>COL in Current:</span><span>{g.col_in_current_contour ? '✓ Yes' : '✗ No'}</span>
                <span style={{ color: '#6b7280' }}>COL in Candidate:</span><span>{g.col_in_candidate_contour ? '✓ Yes' : '✗ No'}</span>
              </div>
              {g.note && <div style={{ marginTop: 6, fontSize: 11, color: '#0c4a6e', fontStyle: 'italic' }}>{g.note}</div>}
            </div>
          );
        })()}

        {/* AM Lightning Protection and Surge Suppression Guide */}
        {candidate.am_lightning_protection_and_surge_suppression_guide && (() => {
          const g = candidate.am_lightning_protection_and_surge_suppression_guide;
          const fmt = (n) => n != null ? `$${Number(n).toLocaleString()}` : '—';
          return (
            <div key="lp-guide" style={{ marginBottom: 16, padding: 12, background: '#fef6ee', borderRadius: 8, border: '1px solid #f97316' }}>
              <div style={{ fontWeight: 700, color: '#7c2d12', marginBottom: 6, fontSize: 13 }}>Lightning Protection &amp; Surge Suppression</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 12px', fontSize: 12, color: '#374151' }}>
                <span style={{ color: '#6b7280' }}>Flash Density (N_g):</span><span>{g.N_g} flashes/km²/yr{g.is_monsoon ? ' (SW monsoon × 1.5 → ' + g.N_g_adj + ')' : ''}</span>
                <span style={{ color: '#6b7280' }}>Tower Height:</span><span>{g.tower_h_ft_lp} ft → A_e = {g.A_e_km2} km²</span>
                <span style={{ color: '#6b7280' }}>Expected Strikes:</span><span style={{ fontWeight: 600, color: g.N_s > 1 ? '#dc2626' : '#374151' }}>{g.N_s}/yr — LPS {g.lps_required ? '✓ Required' : 'Optional'}</span>
                <span style={{ color: '#6b7280' }}>Base Arrestor:</span><span>{fmt(g.base_arrestor_cost_low_usd)} – {fmt(g.base_arrestor_cost_high_usd)}</span>
                <span style={{ color: '#6b7280' }}>AC SPD:</span><span>{fmt(g.ac_spd_cost_low_usd)} – {fmt(g.ac_spd_cost_high_usd)}</span>
                <span style={{ color: '#6b7280' }}>RF/Control SPDs:</span><span>{fmt(g.rf_spd_cost_low_usd)} – {fmt(g.rf_spd_cost_high_usd)}</span>
                <span style={{ color: '#6b7280' }}>Structural LPS:</span><span>{fmt(g.structural_lps_cost_low_usd)} – {fmt(g.structural_lps_cost_high_usd)}</span>
                <span style={{ color: '#6b7280' }}>Total Capital:</span><span style={{ fontWeight: 600 }}>{fmt(g.total_lp_cost_low_usd)} – {fmt(g.total_lp_cost_high_usd)}</span>
                <span style={{ color: '#6b7280' }}>Annual PM:</span><span>{fmt(g.annual_lp_maint_usd)}</span>
              </div>
              {g.note && <div style={{ marginTop: 6, fontSize: 11, color: '#7c2d12', fontStyle: 'italic' }}>{g.note}</div>}
            </div>
          );
        })()}

        {/* AM Soil Conductivity and Groundwave Coverage Guide */}
        {candidate.am_soil_conductivity_and_groundwave_coverage_guide && (() => {
          const g = candidate.am_soil_conductivity_and_groundwave_coverage_guide;
          return (
            <div key="sc-guide" style={{ marginBottom: 16, padding: 12, background: '#f1f5f9', borderRadius: 8, border: '1px solid #475569' }}>
              <div style={{ fontWeight: 700, color: '#1e293b', marginBottom: 6, fontSize: 13 }}>Soil Conductivity &amp; Groundwave Coverage</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 12px', fontSize: 12, color: '#374151' }}>
                <span style={{ color: '#6b7280' }}>FCC M3 Zone:</span><span style={{ fontWeight: 600 }}>Zone {g.m3_zone} — σ = {g.sigma_ms} mS/m</span>
                <span style={{ color: '#6b7280' }}>Conductivity:</span><span>{g.conductivity_label}</span>
                <span style={{ color: '#6b7280' }}>Frequency Scale:</span><span>{g.freq_scale}× (√1000/{Math.round(1000/g.freq_scale/g.freq_scale)} kHz)</span>
                <span style={{ color: '#6b7280' }}>0.5 mV/m Radius:</span><span style={{ fontWeight: 600 }}>{g.d_05_mvm_km} km</span>
                <span style={{ color: '#6b7280' }}>Coverage Area:</span><span>{g.coverage_area_km2.toLocaleString()} km²</span>
                <span style={{ color: '#6b7280' }}>vs US Avg (σ=5):</span><span style={{ color: g.coverage_delta_pct >= 0 ? '#15803d' : '#dc2626', fontWeight: 600 }}>{g.coverage_delta_pct >= 0 ? '+' : ''}{g.coverage_delta_pct}% ({g.d_ref_avg_km} km avg)</span>
                <span style={{ color: '#6b7280', gridColumn: '1/-1' }}>{g.ground_advisory}</span>
              </div>
              {g.note && <div style={{ marginTop: 6, fontSize: 11, color: '#334155', fontStyle: 'italic' }}>{g.note}</div>}
            </div>
          );
        })()}

        {/* AM Electrical Service and Power Infrastructure Guide */}
        {candidate.am_electrical_service_and_power_infrastructure_guide && (() => {
          const g = candidate.am_electrical_service_and_power_infrastructure_guide;
          const fmt = (n) => n != null ? `$${Number(n).toLocaleString()}` : '—';
          return (
            <div key="es-guide" style={{ marginBottom: 16, padding: 12, background: '#ecfeff', borderRadius: 8, border: '1px solid #06b6d4' }}>
              <div style={{ fontWeight: 700, color: '#0e4f5f', marginBottom: 6, fontSize: 13 }}>Electrical Service &amp; Power Infrastructure</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 12px', fontSize: 12, color: '#374151' }}>
                <span style={{ color: '#6b7280' }}>Facility Load:</span><span>{g.total_load_kw_es} kW ({g.tx_draw_kw_es} kW TX)</span>
                <span style={{ color: '#6b7280' }}>NEC 125% Demand:</span><span>{g.demand_kw} kW</span>
                <span style={{ color: '#6b7280' }}>Service:</span><span style={{ fontWeight: 600 }}>{g.service_phase}, {g.service_amps}A</span>
                <span style={{ color: '#6b7280' }}>Transformer:</span><span>{g.transformer_kva} kVA ({fmt(g.transformer_cost_low_usd)} – {fmt(g.transformer_cost_high_usd)})</span>
                <span style={{ color: '#6b7280' }}>Service Entrance:</span><span>{fmt(g.service_entrance_low_usd)} – {fmt(g.service_entrance_high_usd)}</span>
                <span style={{ color: '#6b7280' }}>Voltage Regulator:</span><span>{fmt(g.voltage_regulator_low_usd)} – {fmt(g.voltage_regulator_high_usd)}</span>
                <span style={{ color: '#6b7280' }}>Line Extension (~{g.est_line_ext_ft} ft):</span><span>{fmt(g.line_ext_cost_low_usd)} – {fmt(g.line_ext_cost_high_usd)}</span>
                <span style={{ color: '#6b7280' }}>Total Utility Cost:</span><span style={{ fontWeight: 600 }}>{fmt(g.total_utility_low_usd)} – {fmt(g.total_utility_high_usd)}</span>
              </div>
              {g.note && <div style={{ marginTop: 6, fontSize: 11, color: '#0e4f5f', fontStyle: 'italic' }}>{g.note}</div>}
            </div>
          );
        })()}

        {/* AM NEPA and Environmental Permitting Guide */}
        {candidate.am_nepa_and_environmental_permitting_guide && (() => {
          const g = candidate.am_nepa_and_environmental_permitting_guide;
          const fmt = (n) => n != null ? `$${Number(n).toLocaleString()}` : '—';
          return (
            <div key="env-guide" style={{ marginBottom: 16, padding: 12, background: '#ecfdf5', borderRadius: 8, border: '1px solid #059669' }}>
              <div style={{ fontWeight: 700, color: '#064e3b', marginBottom: 6, fontSize: 13 }}>NEPA &amp; Environmental Permitting</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 12px', fontSize: 12, color: '#374151' }}>
                <span style={{ color: '#6b7280' }}>Tower Height:</span><span>{g.tower_height_ft_env} ft</span>
                <span style={{ color: '#6b7280' }}>NEPA Level:</span><span style={{ fontWeight: 600 }}>{g.nepa_level}</span>
                <span style={{ color: '#6b7280' }}>Section 106 (NHPA):</span><span>{g.triggers_section_106 ? '✓ Required (>200 ft ASR)' : 'Not required'}</span>
                <span style={{ color: '#6b7280' }}>Full EA Required:</span><span>{g.triggers_ea ? '✓ Yes (>450 ft)' : 'No'}</span>
                <span style={{ color: '#6b7280' }}>SHPO Review:</span><span>{g.shpo_review_weeks_low}–{g.shpo_review_weeks_high} weeks</span>
                <span style={{ color: '#6b7280' }}>Tribal Consultation:</span><span>{g.tribal_consult_weeks_low}–{g.tribal_consult_weeks_high} weeks</span>
                <span style={{ color: '#6b7280' }}>Phase I ESA:</span><span>{fmt(g.phase1_esa_cost_low_usd)} – {fmt(g.phase1_esa_cost_high_usd)}</span>
                <span style={{ color: '#6b7280' }}>Wetland Delineation:</span><span>{fmt(g.wetland_delineation_cost_low_usd)} – {fmt(g.wetland_delineation_cost_high_usd)}</span>
                <span style={{ color: '#6b7280' }}>Section 106 Survey:</span><span>{fmt(g.section_106_survey_low_usd)} – {fmt(g.section_106_survey_high_usd)}</span>
                <span style={{ color: '#6b7280' }}>ESA §7 Consultation:</span><span>{fmt(g.esa_consult_cost_low_usd)} – {fmt(g.esa_consult_cost_high_usd)}</span>
                <span style={{ color: '#6b7280' }}>Total Env. Cost:</span><span style={{ fontWeight: 600 }}>{fmt(g.total_env_cost_low_usd)} – {fmt(g.total_env_cost_high_usd)}</span>
                <span style={{ color: '#6b7280' }}>Total Timeline:</span><span>{g.env_review_weeks_low}–{g.env_review_weeks_high} weeks</span>
              </div>
              {g.note && <div style={{ marginTop: 6, fontSize: 11, color: '#064e3b', fontStyle: 'italic' }}>{g.note}</div>}
            </div>
          );
        })()}

        {/* AM Tower Structural and Wind Loading Guide */}
        {candidate.am_tower_structural_and_wind_loading_guide && (() => {
          const g = candidate.am_tower_structural_and_wind_loading_guide;
          const fmt = (n) => n != null ? `$${Number(n).toLocaleString()}` : '—';
          return (
            <div key="tw-guide" style={{ marginBottom: 16, padding: 12, background: '#f5f3ff', borderRadius: 8, border: '1px solid #7c3aed' }}>
              <div style={{ fontWeight: 700, color: '#5b21b6', marginBottom: 6, fontSize: 13 }}>Tower Structural &amp; Wind Loading</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 12px', fontSize: 12, color: '#374151' }}>
                <span style={{ color: '#6b7280' }}>Wavelength:</span><span>λ = {g.lambda_m} m &nbsp;|&nbsp; λ/4 = {g.quarter_wave_ft} ft</span>
                <span style={{ color: '#6b7280' }}>Tower Height:</span><span style={{ fontWeight: 600 }}>{g.tower_height_ft} ft ({Math.round(g.height_fraction * 100)}% λ, Class D optimized)</span>
                <span style={{ color: '#6b7280' }}>TIA-222-H Class:</span><span>{g.tia_class} / Exposure {g.exposure_cat}</span>
                <span style={{ color: '#6b7280' }}>Wind Zone:</span><span>{g.wind_zone} ({g.design_wind_speed_mph} mph)</span>
                <span style={{ color: '#6b7280' }}>Ice Zone:</span><span>{g.ice_zone}</span>
                <span style={{ color: '#6b7280' }}>Preferred Type:</span><span>{g.preferred_type}</span>
                <span style={{ color: '#6b7280' }}>Guyed Tower:</span><span>{fmt(g.guyed_low_usd)} – {fmt(g.guyed_high_usd)} (steel + erection)</span>
                <span style={{ color: '#6b7280' }}>Foundation:</span><span>{fmt(g.foundation_low_usd)} – {fmt(g.foundation_high_usd)}</span>
                <span style={{ color: '#6b7280' }}>Guy Anchors ({g.guy_anchor_count} tiers):</span><span>{fmt(g.guy_anchor_low_usd)} – {fmt(g.guy_anchor_high_usd)}</span>
                <span style={{ color: '#6b7280' }}>Total Guyed:</span><span style={{ fontWeight: 600 }}>{fmt(g.total_guyed_low_usd)} – {fmt(g.total_guyed_high_usd)}</span>
                <span style={{ color: '#6b7280' }}>Self-Supporting:</span><span>{fmt(g.selfsupport_low_usd)} – {fmt(g.selfsupport_high_usd)}</span>
                <span style={{ color: '#6b7280' }}>FAA Marking:</span><span>{g.faa_marking_required ? '✓ Required (>200 ft AGL)' : 'Not required'}</span>
              </div>
              {g.note && <div style={{ marginTop: 6, fontSize: 11, color: '#5b21b6', fontStyle: 'italic' }}>{g.note}</div>}
            </div>
          );
        })()}

        {/* AM Emergency Power and Backup Systems Guide */}
        {candidate.am_emergency_power_and_backup_systems_guide && (() => {
          const g = candidate.am_emergency_power_and_backup_systems_guide;
          const fmt = (n) => n != null ? `$${Number(n).toLocaleString()}` : '—';
          return (
            <div key="ep-guide" style={{ marginBottom: 16, padding: 12, background: '#f0fdfa', borderRadius: 8, border: '1px solid #2dd4bf' }}>
              <div style={{ fontWeight: 700, color: '#0f766e', marginBottom: 6, fontSize: 13 }}>Emergency Power &amp; Backup Systems</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 12px', fontSize: 12, color: '#374151' }}>
                <span style={{ color: '#6b7280' }}>Facility Load:</span><span>{g.total_load_kw} kW total ({g.tx_draw_kw_ep} kW TX + {g.hvac_draw_kw_ep} kW HVAC)</span>
                <span style={{ color: '#6b7280' }}>Generator Size:</span><span style={{ fontWeight: 600 }}>{g.generator_size_kw} kW diesel (25% margin)</span>
                <span style={{ color: '#6b7280' }}>Transfer Switch:</span><span>{g.ats_type}</span>
                <span style={{ color: '#6b7280' }}>Fuel Burn:</span><span>{g.fuel_burn_gph} gal/hr</span>
                <span style={{ color: '#6b7280' }}>72-hr Fuel:</span><span>{g.fuel_for_72h_gal} gal — NFPA 110 {g.nfpa_level}</span>
                <span style={{ color: '#6b7280' }}>30-day Reserve:</span><span>{g.fuel_for_30d_gal.toLocaleString()} gal</span>
                <span style={{ color: '#6b7280' }}>Generator Install:</span><span>{fmt(g.gen_install_low_usd)} – {fmt(g.gen_install_high_usd)}</span>
                <span style={{ color: '#6b7280' }}>Fuel Tank:</span><span>{fmt(g.fuel_tank_low_usd)} – {fmt(g.fuel_tank_high_usd)}</span>
                <span style={{ color: '#6b7280' }}>ATS Cost:</span><span>{fmt(g.ats_cost_low_usd)} – {fmt(g.ats_cost_high_usd)}</span>
                <span style={{ color: '#6b7280' }}>Total Capital:</span><span style={{ fontWeight: 600 }}>{fmt(g.total_backup_low_usd)} – {fmt(g.total_backup_high_usd)}</span>
                <span style={{ color: '#6b7280' }}>Annual PM:</span><span>{fmt(g.annual_maint_low_usd)} – {fmt(g.annual_maint_high_usd)}</span>
                <span style={{ color: '#6b7280' }}>EAS Continuity:</span><span>{g.eas_continuity_required ? '✓ Required (47 CFR §11.35)' : 'Not required'}</span>
              </div>
              {g.note && <div style={{ marginTop: 6, fontSize: 11, color: '#0f766e', fontStyle: 'italic' }}>{g.note}</div>}
            </div>
          );
        })()}

        {/* AM Annual Operating Cost Analysis Guide */}
        {candidate.am_annual_operating_cost_analysis_guide && (() => {
          const g = candidate.am_annual_operating_cost_analysis_guide;
          const fmt = (n) => n != null ? `$${Number(n).toLocaleString()}` : '—';
          return (
            <div style={{ background: '#f0fdf4', border: '1px solid #22c55e', borderRadius: 8, padding: '14px 16px', marginBottom: 12 }}>
              <div style={{ fontWeight: 700, color: '#14532d', marginBottom: 8, fontSize: 13 }}>
                Annual Operating Cost Analysis (OPEX)
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 16px', fontSize: 12, color: '#166534' }}>
                <span>Tx draw</span>
                <span style={{ fontWeight: 600 }}>{g.tx_draw_kw} kW ({g.daily_hrs_day}h day / {g.daily_hrs_night}h night @ {g.night_draw_kw} kW)</span>
                <span>Annual electricity</span>
                <span style={{ fontWeight: 600 }}>{g.annual_kwh_total.toLocaleString()} kWh → {fmt(g.elec_cost_low_usd)} – {fmt(g.elec_cost_high_usd)}</span>
                <span>Equipment maintenance</span>
                <span style={{ fontWeight: 600 }}>{fmt(g.equip_maint_low_usd)} – {fmt(g.equip_maint_high_usd)}/yr</span>
                <span>FCC regulatory fee</span>
                <span style={{ fontWeight: 600 }}>{fmt(g.fcc_annual_fee_usd)}/yr</span>
                <span>Insurance premium</span>
                <span style={{ fontWeight: 600 }}>{fmt(g.insurance_low_usd)} – {fmt(g.insurance_high_usd)}/yr</span>
                <span>STL operating cost</span>
                <span style={{ fontWeight: 600 }}>{fmt(g.stl_annual_low_usd)} – {fmt(g.stl_annual_high_usd)}/yr</span>
                <span>Tower/ground inspection</span>
                <span style={{ fontWeight: 600 }}>{fmt(g.tower_inspection_usd_low)} – {fmt(g.tower_inspection_usd_high)}/yr</span>
                <span>Tower lighting maint.</span>
                <span style={{ fontWeight: 600 }}>{fmt(g.lighting_maint_low_usd)} – {fmt(g.lighting_maint_high_usd)}/yr</span>
                <span>Property tax/lease</span>
                <span style={{ fontWeight: 600 }}>{fmt(g.property_cost_low_usd)} – {fmt(g.property_cost_high_usd)}/yr</span>
                <span style={{ fontWeight: 700, color: '#14532d' }}>Total annual OPEX</span>
                <span style={{ fontWeight: 700, color: '#14532d' }}>{fmt(g.total_annual_low_usd)} – {fmt(g.total_annual_high_usd)}/yr</span>
                <span>10-yr NPV (5%)</span>
                <span style={{ fontWeight: 600 }}>{fmt(g.opex_10yr_pv_low_usd)} – {fmt(g.opex_10yr_pv_high_usd)}</span>
              </div>
              {g.note && (
                <div style={{ marginTop: 8, fontSize: 11, color: '#14532d', borderTop: '1px solid #bbf7d0', paddingTop: 6 }}>
                  {g.note}
                </div>
              )}
            </div>
          );
        })()}

        {/* AM Antenna Electrical Design & Efficiency Guide */}
        {candidate.am_antenna_electrical_design_and_efficiency_guide && (() => {
          const g = candidate.am_antenna_electrical_design_and_efficiency_guide;
          const effColor = (pct) => pct >= 95 ? '#166534' : pct >= 88 ? '#92400e' : '#991b1b';
          return (
            <div style={{ background: '#fff7ed', border: '1px solid #fb923c', borderRadius: 8, padding: '14px 16px', marginBottom: 12 }}>
              <div style={{ fontWeight: 700, color: '#7c2d12', marginBottom: 8, fontSize: 13 }}>
                Antenna Electrical Design &amp; Efficiency
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 16px', fontSize: 12, color: '#9a3412' }}>
                <span>Wavelength</span>
                <span style={{ fontWeight: 600 }}>{g.lambda_m}m @ {Math.round(300000/g.lambda_m)} kHz</span>
                <span>Physical height</span>
                <span style={{ fontWeight: 600 }}>{g.physical_height_m}m ({Math.round(g.physical_height_m * 3.281)}ft)</span>
                <span>Electrical height</span>
                <span style={{ fontWeight: 600 }}>{g.electrical_height_deg}° (λ/4 resonant)</span>
                <span>Tower elements</span>
                <span style={{ fontWeight: 600 }}>{g.n_tower_elements}{g.n_tower_elements > 1 ? ' (DA)' : ' (NDA)'}</span>
                <span>Radial count</span>
                <span style={{ fontWeight: 600 }}>{g.n_radials} buried (λ/4 each)</span>
                <span>Radiation resistance</span>
                <span style={{ fontWeight: 600 }}>{g.radiation_resistance_ohm}Ω</span>
                <span>Ground loss (R_g)</span>
                <span style={{ fontWeight: 600 }}>{g.ground_loss_ohm_low}–{g.ground_loss_ohm_high}Ω</span>
                <span>Antenna efficiency</span>
                <span style={{ fontWeight: 700, color: effColor(g.efficiency_pct_low) }}>{g.efficiency_pct_low}–{g.efficiency_pct_high}%</span>
                <span>ATU insertion loss</span>
                <span style={{ fontWeight: 600 }}>{g.atu_loss_pct_low}–{g.atu_loss_pct_high}%</span>
                <span>System efficiency</span>
                <span style={{ fontWeight: 700, color: effColor(g.total_efficiency_pct_low) }}>{g.total_efficiency_pct_low}–{g.total_efficiency_pct_high}%</span>
                <span>Effective ERP</span>
                <span style={{ fontWeight: 700, color: '#7c2d12' }}>{g.effective_erp_kw_low}–{g.effective_erp_kw_high} kW (from {g.effective_erp_kw_high > 0 ? Math.round(g.effective_erp_kw_high / g.total_efficiency_pct_high * 100) : '?'} kW TPO)</span>
                <span>VSWR 2:1 bandwidth</span>
                <span style={{ fontWeight: 600 }}>{g.vswr_bw_khz_low}–{g.vswr_bw_khz_high} kHz</span>
              </div>
              {g.note && (
                <div style={{ marginTop: 8, fontSize: 11, color: '#7c2d12', borderTop: '1px solid #fed7aa', paddingTop: 6 }}>
                  {g.note}
                </div>
              )}
            </div>
          );
        })()}

        {/* AM Studio-to-Transmitter Link Guide */}
        {candidate.am_studio_to_transmitter_link_guide && (() => {
          const g = candidate.am_studio_to_transmitter_link_guide;
          const fmt = (n) => n != null ? `$${Number(n).toLocaleString()}` : '—';
          const techLabel = { IP_INTERNET: 'IP / Internet', LICENSED_950MHZ: '950 MHz Licensed STL', DIGITAL_MICROWAVE: 'Digital Microwave' };
          const techColor = { IP_INTERNET: '#166534', LICENSED_950MHZ: '#92400e', DIGITAL_MICROWAVE: '#1e40af' };
          return (
            <div style={{ background: '#fdf4ff', border: '1px solid #a855f7', borderRadius: 8, padding: '14px 16px', marginBottom: 12 }}>
              <div style={{ fontWeight: 700, color: '#581c87', marginBottom: 8, fontSize: 13 }}>
                Studio-to-Transmitter Link (FCC Part 74 / §74.550)
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 16px', fontSize: 12, color: '#6b21a8' }}>
                <span>STL distance</span>
                <span style={{ fontWeight: 600 }}>{g.stl_distance_km}km ({g.stl_distance_mi}mi)</span>
                <span>Technology</span>
                <span style={{ fontWeight: 700, color: techColor[g.stl_technology] ?? '#6b21a8' }}>{techLabel[g.stl_technology] ?? g.stl_technology}</span>
                <span>FCC Part 74 license</span>
                <span style={{ fontWeight: 600, color: g.fcc_part_74_license_required ? '#b45309' : '#166534' }}>
                  {g.fcc_part_74_license_required ? `Required — ${fmt(g.fcc_license_fee_usd)}` : 'Not required'}
                </span>
                <span>Audio latency</span>
                <span style={{ fontWeight: 600 }}>{g.stl_latency_ms}ms</span>
                <span>Backup technology</span>
                <span style={{ fontWeight: 600 }}>{g.backup_technology ? techLabel[g.backup_technology] ?? g.backup_technology : 'Dual-path IP recommended'}</span>
              </div>
              <div style={{ marginTop: 8, borderTop: '1px solid #e9d5ff', paddingTop: 8, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 16px', fontSize: 12, color: '#6b21a8' }}>
                <span>STL equipment</span>
                <span style={{ fontWeight: 600 }}>{fmt(g.stl_equip_low_usd)} – {fmt(g.stl_equip_high_usd)}</span>
                <span>Backup STL equipment</span>
                <span style={{ fontWeight: 600 }}>{g.backup_equip_low_usd > 0 ? `${fmt(g.backup_equip_low_usd)} – ${fmt(g.backup_equip_high_usd)}` : 'N/A'}</span>
                <span style={{ fontWeight: 700, color: '#581c87' }}>Total STL (one-time)</span>
                <span style={{ fontWeight: 700, color: '#581c87' }}>{fmt(g.total_stl_cost_low_usd)} – {fmt(g.total_stl_cost_high_usd)}</span>
                <span>Annual operating cost</span>
                <span style={{ fontWeight: 600 }}>{fmt(g.stl_annual_low_usd)} – {fmt(g.stl_annual_high_usd)}/yr</span>
              </div>
              {g.note && (
                <div style={{ marginTop: 8, fontSize: 11, color: '#581c87', borderTop: '1px solid #e9d5ff', paddingTop: 6 }}>
                  {g.note}
                </div>
              )}
            </div>
          );
        })()}

        {/* AM Daytime Interference & Protection Guide */}
        {candidate.am_daytime_interference_and_protection_guide && (() => {
          const g = candidate.am_daytime_interference_and_protection_guide;
          const riskColor = { LOW: '#166534', MEDIUM: '#92400e', HIGH: '#991b1b' };
          const ctColor = { CLEAR_CHANNEL: '#1e40af', REGIONAL_CHANNEL: '#6d28d9', LOCAL_CHANNEL: '#0e7490' };
          return (
            <div style={{ background: '#eff6ff', border: '1px solid #60a5fa', borderRadius: 8, padding: '14px 16px', marginBottom: 12 }}>
              <div style={{ fontWeight: 700, color: '#1e3a8a', marginBottom: 8, fontSize: 13 }}>
                Daytime Interference &amp; Protection (§73.182)
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 16px', fontSize: 12, color: '#1e40af' }}>
                <span>Channel type</span>
                <span style={{ fontWeight: 700, color: ctColor[g.channel_type] ?? '#1e40af' }}>{g.channel_type.replace(/_/g, ' ')}</span>
                <span>Station status</span>
                <span style={{ fontWeight: 600, color: g.is_secondary ? '#991b1b' : '#166534' }}>
                  {g.is_secondary ? 'SECONDARY (§73.21)' : 'PRIMARY'}
                </span>
                {g.night_power_limit_kw != null && <>
                  <span>Night power limit</span>
                  <span style={{ fontWeight: 600, color: '#991b1b' }}>{g.night_power_limit_kw} kW (§73.21)</span>
                </>}
                <span>Co-channel risk</span>
                <span style={{ fontWeight: 700, color: riskColor[g.co_channel_risk] ?? '#1e40af' }}>{g.co_channel_risk}</span>
                <span>Co-channel D/U (daytime)</span>
                <span style={{ fontWeight: 600 }}>{g.co_channel_D_U_daytime_db} dB</span>
                <span>1st adjacent D/U</span>
                <span style={{ fontWeight: 600 }}>{g.first_adjacent_protection_db} dB (±10 kHz)</span>
                <span>2nd adjacent D/U</span>
                <span style={{ fontWeight: 600 }}>{g.second_adjacent_protection_db} dB (±20 kHz)</span>
              </div>
              <div style={{ marginTop: 8, borderTop: '1px solid #bfdbfe', paddingTop: 8, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 16px', fontSize: 12, color: '#1e40af' }}>
                <span>0.5 mV/m service radius</span>
                <span style={{ fontWeight: 600 }}>{g.service_radius_05_mvpm_km} km (primary)</span>
                <span>0.15 mV/m service radius</span>
                <span style={{ fontWeight: 600 }}>{g.service_radius_015_mvpm_km} km (secondary)</span>
              </div>
              {g.note && (
                <div style={{ marginTop: 8, fontSize: 11, color: '#1e3a8a', borderTop: '1px solid #bfdbfe', paddingTop: 6 }}>
                  {g.note}
                </div>
              )}
            </div>
          );
        })()}

        {/* AM Local Zoning & Land Use Compatibility Guide */}
        {candidate.am_local_zoning_and_land_use_compatibility_guide && (() => {
          const g = candidate.am_local_zoning_and_land_use_compatibility_guide;
          const fmt = (n) => n != null ? `$${Number(n).toLocaleString()}` : '—';
          const riskColor = { LOW: '#166534', MEDIUM: '#92400e', HIGH: '#991b1b' };
          const znColor = { URBAN_COMMERCIAL: '#991b1b', SUBURBAN_RESIDENTIAL: '#92400e', MIXED_INDUSTRIAL: '#1e40af', AGRICULTURAL_RURAL: '#166534' };
          return (
            <div style={{ background: '#f0fdf4', border: '1px solid #4ade80', borderRadius: 8, padding: '14px 16px', marginBottom: 12 }}>
              <div style={{ fontWeight: 700, color: '#14532d', marginBottom: 8, fontSize: 13 }}>
                Local Zoning &amp; Land Use Compatibility
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 16px', fontSize: 12, color: '#166534' }}>
                <span>Zoning class</span>
                <span style={{ fontWeight: 700, color: znColor[g.zoning_class] ?? '#166534' }}>{g.zoning_class.replace(/_/g, ' ')} ({g.dist_from_col_km}km from COL)</span>
                <span>Tower height</span>
                <span style={{ fontWeight: 600 }}>{g.tower_height_ft}ft ({g.tower_height_m}m)</span>
                <span>Zoning height limit</span>
                <span style={{ fontWeight: 600 }}>{g.zoning_height_limit_ft}ft</span>
                <span>Height variance</span>
                <span style={{ fontWeight: 600, color: g.height_variance_required ? '#991b1b' : '#166534' }}>
                  {g.height_variance_required ? 'Required' : 'Not required'}
                </span>
                <span>CUP probability</span>
                <span style={{ fontWeight: 600 }}>{Math.round(g.cup_probability * 100)}%</span>
                <span>Setback from residential</span>
                <span style={{ fontWeight: 600 }}>{g.setback_required_ft}ft min</span>
                <span>Min. lot width</span>
                <span style={{ fontWeight: 600 }}>{g.min_lot_width_ft}ft</span>
                <span>SHPO review</span>
                <span style={{ fontWeight: 600, color: g.shpo_review_required ? '#b45309' : '#166534' }}>
                  {g.shpo_review_required ? `Required (${g.shpo_review_weeks_low}–${g.shpo_review_weeks_high} weeks)` : 'Not triggered'}
                </span>
                <span>Opposition risk</span>
                <span style={{ fontWeight: 700, color: riskColor[g.opposition_risk] ?? '#166534' }}>{g.opposition_risk}</span>
              </div>
              <div style={{ marginTop: 8, borderTop: '1px solid #bbf7d0', paddingTop: 8, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 16px', fontSize: 12, color: '#166534' }}>
                <span>CUP application</span>
                <span style={{ fontWeight: 600 }}>{fmt(g.cup_cost_low_usd)} – {fmt(g.cup_cost_high_usd)}</span>
                <span>Height variance</span>
                <span style={{ fontWeight: 600 }}>{g.variance_cost_low_usd > 0 ? `${fmt(g.variance_cost_low_usd)} – ${fmt(g.variance_cost_high_usd)}` : 'N/A'}</span>
                <span>Legal fees (opposition)</span>
                <span style={{ fontWeight: 600 }}>{fmt(g.legal_fees_low_usd)} – {fmt(g.legal_fees_high_usd)}</span>
                <span style={{ fontWeight: 700, color: '#14532d' }}>Total zoning costs</span>
                <span style={{ fontWeight: 700, color: '#14532d' }}>{fmt(g.total_zoning_cost_low_usd)} – {fmt(g.total_zoning_cost_high_usd)}</span>
              </div>
              {g.note && (
                <div style={{ marginTop: 8, fontSize: 11, color: '#14532d', borderTop: '1px solid #bbf7d0', paddingTop: 6 }}>
                  {g.note}
                </div>
              )}
            </div>
          );
        })()}

        {/* AM Transmitter Building & Utilities Guide */}
        {candidate.am_transmitter_building_and_utilities_guide && (() => {
          const g = candidate.am_transmitter_building_and_utilities_guide;
          const fmt = (n) => n != null ? `$${Number(n).toLocaleString()}` : '—';
          return (
            <div style={{ background: '#fdf6e3', border: '1px solid #d97706', borderRadius: 8, padding: '14px 16px', marginBottom: 12 }}>
              <div style={{ fontWeight: 700, color: '#78350f', marginBottom: 8, fontSize: 13 }}>
                Transmitter Building &amp; Utilities
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 16px', fontSize: 12, color: '#92400e' }}>
                <span>Building footprint</span>
                <span style={{ fontWeight: 600 }}>{g.bld_sqft_low}–{g.bld_sqft_high} sq ft</span>
                <span>Building construction</span>
                <span style={{ fontWeight: 600 }}>{fmt(g.building_cost_low_usd)} – {fmt(g.building_cost_high_usd)}</span>
                <span>Electrical service</span>
                <span style={{ fontWeight: 600 }}>{g.electrical_service_amps}A / {g.electrical_service_volts}V</span>
                <span>Utility extension</span>
                <span style={{ fontWeight: 600 }}>{fmt(g.utility_extension_cost_low_usd)} – {fmt(g.utility_extension_cost_high_usd)}</span>
                <span>HVAC</span>
                <span style={{ fontWeight: 600 }}>{g.hvac_tons}-ton ({fmt(g.hvac_cost_low_usd)} – {fmt(g.hvac_cost_high_usd)}; service {fmt(g.hvac_annual_service_usd)}/yr)</span>
                <span>Emergency generator</span>
                <span style={{ fontWeight: 600 }}>{g.generator_kw} kW ({fmt(g.generator_cost_low_usd)} – {fmt(g.generator_cost_high_usd)})</span>
                <span>Fuel storage</span>
                <span style={{ fontWeight: 600 }}>{g.fuel_tank_gal} gal ({fmt(g.fuel_tank_cost_usd)})</span>
                <span>Building permit</span>
                <span style={{ fontWeight: 600 }}>{fmt(g.building_permit_cost_low_usd)} – {fmt(g.building_permit_cost_high_usd)}</span>
                <span>Site prep/grading</span>
                <span style={{ fontWeight: 600 }}>{fmt(g.site_prep_cost_low_usd)} – {fmt(g.site_prep_cost_high_usd)}</span>
                <span style={{ fontWeight: 700, color: '#78350f' }}>Total infrastructure</span>
                <span style={{ fontWeight: 700, color: '#78350f' }}>{fmt(g.total_infrastructure_low_usd)} – {fmt(g.total_infrastructure_high_usd)}</span>
              </div>
              {g.note && (
                <div style={{ marginTop: 8, fontSize: 11, color: '#78350f', borderTop: '1px solid #fde68a', paddingTop: 6 }}>
                  {g.note}
                </div>
              )}
            </div>
          );
        })()}

        {/* AM Transmitter & Equipment Selection Guide */}
        {candidate.am_transmitter_and_equipment_selection_guide && (() => {
          const g = candidate.am_transmitter_and_equipment_selection_guide;
          const fmt = (n) => n != null ? `$${Number(n).toLocaleString()}` : '—';
          const pcLabel = { LOW: 'Low (≤1 kW)', MEDIUM: 'Medium (1–10 kW)', HIGH: 'High (10–50 kW)', VERY_HIGH: 'Very High (>50 kW)' };
          return (
            <div style={{ background: '#fff5f5', border: '1px solid #fc8181', borderRadius: 8, padding: '14px 16px', marginBottom: 12 }}>
              <div style={{ fontWeight: 700, color: '#7f1d1d', marginBottom: 8, fontSize: 13 }}>
                Transmitter &amp; Equipment Selection (§73.61 / §73.1400)
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 16px', fontSize: 12, color: '#991b1b' }}>
                <span>Power class</span>
                <span style={{ fontWeight: 600 }}>{pcLabel[g.power_class_tx] ?? g.power_class_tx}</span>
                <span>Nominal transmitter</span>
                <span style={{ fontWeight: 600 }}>{g.nominal_tx_kw} kW AM (TPO: {g.total_equipment_low_usd > 0 ? `${g.nominal_tx_kw}` : '—'} kW)</span>
                <span>Backup transmitter</span>
                <span style={{ fontWeight: 600 }}>{g.backup_tx_kw} kW (recommended)</span>
                <span>Base current meters</span>
                <span style={{ fontWeight: 600 }}>{g.n_base_current_meters} (§73.61)</span>
                <span>DA phasing cabinet</span>
                <span style={{ fontWeight: 600 }}>{g.phasing_cabinet_cost_low_usd > 0 ? `${fmt(g.phasing_cabinet_cost_low_usd)} – ${fmt(g.phasing_cabinet_cost_high_usd)}` : 'Not required (NDA)'}</span>
              </div>
              <div style={{ marginTop: 8, borderTop: '1px solid #fecaca', paddingTop: 8, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 16px', fontSize: 12, color: '#991b1b' }}>
                <span>Main transmitter</span>
                <span style={{ fontWeight: 600 }}>{fmt(g.main_tx_cost_low_usd)} – {fmt(g.main_tx_cost_high_usd)}</span>
                <span>Backup transmitter</span>
                <span style={{ fontWeight: 600 }}>{fmt(g.backup_tx_cost_low_usd)} – {fmt(g.backup_tx_cost_high_usd)}</span>
                <span>Remote control</span>
                <span style={{ fontWeight: 600 }}>{fmt(g.remote_control_cost_low_usd)} – {fmt(g.remote_control_cost_high_usd)} (§73.1400)</span>
                <span>Current meters</span>
                <span style={{ fontWeight: 600 }}>{fmt(g.meter_cost_low_usd)} – {fmt(g.meter_cost_high_usd)}</span>
                <span>Dummy load</span>
                <span style={{ fontWeight: 600 }}>{fmt(g.dummy_load_cost_low_usd)} – {fmt(g.dummy_load_cost_high_usd)}</span>
                <span>RF feedline</span>
                <span style={{ fontWeight: 600 }}>{fmt(g.feedline_cost_low_usd)} – {fmt(g.feedline_cost_high_usd)}</span>
                <span style={{ fontWeight: 700, color: '#7f1d1d' }}>Total equipment</span>
                <span style={{ fontWeight: 700, color: '#7f1d1d' }}>{fmt(g.total_equipment_low_usd)} – {fmt(g.total_equipment_high_usd)}</span>
                <span>Annual maintenance</span>
                <span style={{ fontWeight: 600 }}>{fmt(g.annual_maint_low_usd)} – {fmt(g.annual_maint_high_usd)}/yr</span>
              </div>
              {g.note && (
                <div style={{ marginTop: 8, fontSize: 11, color: '#7f1d1d', borderTop: '1px solid #fecaca', paddingTop: 6 }}>
                  {g.note}
                </div>
              )}
            </div>
          );
        })()}

        {/* AM Construction Permit & Buildout Timeline Guide */}
        {candidate.am_construction_permit_and_buildout_timeline_guide && (() => {
          const g = candidate.am_construction_permit_and_buildout_timeline_guide;
          const fmt = (n) => n != null ? `$${Number(n).toLocaleString()}` : '—';
          const riskColor = { LOW: '#166534', MEDIUM: '#92400e', HIGH: '#991b1b' };
          return (
            <div style={{ background: '#eef2ff', border: '1px solid #818cf8', borderRadius: 8, padding: '14px 16px', marginBottom: 12 }}>
              <div style={{ fontWeight: 700, color: '#312e81', marginBottom: 8, fontSize: 13 }}>
                Construction Permit &amp; Buildout Timeline (§73.67)
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 16px', fontSize: 12, color: '#3730a3' }}>
                <span>Filing type</span>
                <span style={{ fontWeight: 600 }}>{g.filing_type} — {g.fcc_form}</span>
                <span>CP processing</span>
                <span style={{ fontWeight: 600 }}>{g.cp_processing_months_low}–{g.cp_processing_months_high} months</span>
                <span>CP validity</span>
                <span style={{ fontWeight: 600 }}>{g.cp_validity_years} years from grant (§73.67)</span>
                <span>CP expiration risk</span>
                <span style={{ fontWeight: 700, color: riskColor[g.cp_expiration_risk] ?? '#3730a3' }}>{g.cp_expiration_risk}</span>
                <span>FCC filing fee</span>
                <span style={{ fontWeight: 600 }}>{fmt(g.fcc_filing_fee_usd)}</span>
                <span>Engineering cost</span>
                <span style={{ fontWeight: 600 }}>{fmt(g.engineering_cost_low_usd)} – {fmt(g.engineering_cost_high_usd)}</span>
              </div>
              <div style={{ marginTop: 8, borderTop: '1px solid #c7d2fe', paddingTop: 8, fontSize: 12, color: '#3730a3' }}>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>Post-grant milestones:</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '2px 12px' }}>
                  <span>Tower construction</span><span style={{ fontWeight: 600 }}>{g.tower_const_months_low}–{g.tower_const_months_high} mo</span>
                  <span>Ground system install</span><span style={{ fontWeight: 600 }}>{g.ground_install_months_low}–{g.ground_install_months_high} mo</span>
                  <span>Equipment commissioning</span><span style={{ fontWeight: 600 }}>{g.equip_months_low}–{g.equip_months_high} mo</span>
                  <span>Proof of performance</span><span style={{ fontWeight: 600 }}>{g.proof_months_low}–{g.proof_months_high} mo</span>
                  <span>License to cover (Form 302-AM)</span><span style={{ fontWeight: 600 }}>{g.license_months_low}–{g.license_months_high} mo</span>
                </div>
              </div>
              <div style={{ marginTop: 8, borderTop: '1px solid #c7d2fe', paddingTop: 8, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 16px', fontSize: 12, color: '#3730a3' }}>
                <span>Post-CP construction total</span>
                <span style={{ fontWeight: 600 }}>{g.post_cp_months_low}–{g.post_cp_months_high} months</span>
                <span>Construction margin in CP window</span>
                <span style={{ fontWeight: 600 }}>{g.construction_margin_months_low}–{g.construction_margin_months_high} months</span>
                <span style={{ fontWeight: 700, color: '#312e81' }}>Total decision-to-on-air</span>
                <span style={{ fontWeight: 700, color: '#312e81' }}>{g.total_months_low}–{g.total_months_high} months</span>
              </div>
              {g.note && (
                <div style={{ marginTop: 8, fontSize: 11, color: '#312e81', borderTop: '1px solid #c7d2fe', paddingTop: 6 }}>
                  {g.note}
                </div>
              )}
            </div>
          );
        })()}

        {/* AM Site Acquisition & Real Property Guide */}
        {candidate.am_site_acquisition_and_real_property_guide && (() => {
          const g = candidate.am_site_acquisition_and_real_property_guide;
          const fmt = (n) => n != null ? `$${Number(n).toLocaleString()}` : '—';
          const classColor = { RURAL: '#166534', SUBURBAN: '#92400e', URBAN: '#991b1b' };
          return (
            <div style={{ background: '#f7fee7', border: '1px solid #a3e635', borderRadius: 8, padding: '14px 16px', marginBottom: 12 }}>
              <div style={{ fontWeight: 700, color: '#365314', marginBottom: 8, fontSize: 13 }}>
                Site Acquisition &amp; Real Property
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 16px', fontSize: 12, color: '#3f6212' }}>
                <span>Site class</span>
                <span style={{ fontWeight: 700, color: classColor[g.site_class] ?? '#3f6212' }}>{g.site_class} ({g.dist_from_col_km}km from COL)</span>
                <span>Tower elements</span>
                <span style={{ fontWeight: 600 }}>{g.n_tower_elements}{g.n_tower_elements > 1 ? ' (DA array)' : ' (NDA)'}</span>
                <span>Min. site area</span>
                <span style={{ fontWeight: 600 }}>{g.min_site_acres_low}–{g.min_site_acres_high} acres</span>
                <span>Land purchase</span>
                <span style={{ fontWeight: 600 }}>{fmt(g.purchase_cost_low_usd)} – {fmt(g.purchase_cost_high_usd)}</span>
                <span>Transaction costs</span>
                <span style={{ fontWeight: 600 }}>{fmt(g.transaction_costs_low_usd)} – {fmt(g.transaction_costs_high_usd)}</span>
                <span>Title &amp; closing</span>
                <span style={{ fontWeight: 600 }}>{fmt(g.title_and_closing_low_usd)} – {fmt(g.title_and_closing_high_usd)}</span>
                <span style={{ fontWeight: 700, color: '#365314' }}>Total purchase</span>
                <span style={{ fontWeight: 700, color: '#365314' }}>{fmt(g.total_purchase_low_usd)} – {fmt(g.total_purchase_high_usd)}</span>
              </div>
              <div style={{ marginTop: 8, borderTop: '1px solid #d9f99d', paddingTop: 8, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 16px', fontSize: 12, color: '#3f6212' }}>
                <span>Annual lease</span>
                <span style={{ fontWeight: 600 }}>{fmt(g.annual_lease_low_usd)} – {fmt(g.annual_lease_high_usd)}/yr</span>
                <span>20-yr lease PV (5%)</span>
                <span style={{ fontWeight: 600 }}>{fmt(g.lease_20yr_pv_low_usd)} – {fmt(g.lease_20yr_pv_high_usd)}</span>
                <span>Phase I ESA</span>
                <span style={{ fontWeight: 600 }}>{fmt(g.env_assessment_cost_low_usd)} – {fmt(g.env_assessment_cost_high_usd)}</span>
                <span>Zoning / CUP</span>
                <span style={{ fontWeight: 600 }}>{fmt(g.zoning_permit_cost_low_usd)} – {fmt(g.zoning_permit_cost_high_usd)}</span>
                <span>Survey</span>
                <span style={{ fontWeight: 600 }}>{fmt(g.survey_cost_low_usd)} – {fmt(g.survey_cost_high_usd)}</span>
                <span>Access road</span>
                <span style={{ fontWeight: 600 }}>{fmt(g.access_road_cost_low_usd)} – {fmt(g.access_road_cost_high_usd)}</span>
              </div>
              {g.note && (
                <div style={{ marginTop: 8, fontSize: 11, color: '#365314', borderTop: '1px solid #d9f99d', paddingTop: 6 }}>
                  {g.note}
                </div>
              )}
            </div>
          );
        })()}

        {/* AM Antenna Tower Lighting & FAA Guide */}
        {candidate.am_antenna_tower_lighting_and_faa_guide && (() => {
          const g = candidate.am_antenna_tower_lighting_and_faa_guide;
          const fmt = (n) => n != null ? `$${Number(n).toLocaleString()}` : '—';
          const ltgLabel = { NONE: 'None', LOW_INTENSITY_RED: 'Low intensity red', MEDIUM_INTENSITY_RED_WHITE: 'Medium intensity red/white', HIGH_INTENSITY_WHITE_STROBE: 'High intensity white strobe' };
          return (
            <div style={{ background: '#f0f9ff', border: '1px solid #38bdf8', borderRadius: 8, padding: '14px 16px', marginBottom: 12 }}>
              <div style={{ fontWeight: 700, color: '#0c4a6e', marginBottom: 8, fontSize: 13 }}>
                Tower Lighting &amp; FAA Registration (14 CFR Part 77 / §17.7)
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 16px', fontSize: 12, color: '#075985' }}>
                <span>Est. tower height</span>
                <span style={{ fontWeight: 600 }}>{g.std_tower_height_ft}ft ({g.std_tower_height_m}m) at {Math.round(1000 * g.lambda_m / 300)}kHz</span>
                <span>FAA Form 7460-1</span>
                <span style={{ fontWeight: 600, color: g.faa_notification_required ? '#b45309' : '#166534' }}>
                  {g.faa_notification_required ? 'Required' : 'Not required'}
                </span>
                <span>FCC ASR registration</span>
                <span style={{ fontWeight: 600, color: g.asr_required ? '#b45309' : '#166534' }}>
                  {g.asr_required ? 'Required (§17.7)' : 'Not required'}
                </span>
                <span>NOTAM coordination</span>
                <span style={{ fontWeight: 600 }}>{g.notam_required ? 'Required during construction' : 'Not required'}</span>
                <span>Tower elements</span>
                <span style={{ fontWeight: 600 }}>{g.n_tower_elements}{g.n_tower_elements > 1 ? ' (DA array)' : ' (NDA)'}</span>
                <span>Lighting type</span>
                <span style={{ fontWeight: 600 }}>{ltgLabel[g.lighting_type] ?? g.lighting_type}</span>
                <span>Light levels</span>
                <span style={{ fontWeight: 600 }}>{g.n_light_levels > 0 ? g.n_light_levels : 'None'}</span>
              </div>
              <div style={{ marginTop: 8, borderTop: '1px solid #bae6fd', paddingTop: 8, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 16px', fontSize: 12, color: '#075985' }}>
                <span>FAA filing cost</span>
                <span style={{ fontWeight: 600 }}>{fmt(g.faa_filing_cost_low_usd)} – {fmt(g.faa_filing_cost_high_usd)}</span>
                <span>ASR filing cost</span>
                <span style={{ fontWeight: 600 }}>{fmt(g.asr_filing_cost_low_usd)} – {fmt(g.asr_filing_cost_high_usd)}</span>
                <span>Lighting install</span>
                <span style={{ fontWeight: 600 }}>{fmt(g.lighting_install_cost_low_usd)} – {fmt(g.lighting_install_cost_high_usd)}</span>
                <span>Annual maintenance</span>
                <span style={{ fontWeight: 600 }}>{fmt(g.annual_maintenance_cost_low_usd)} – {fmt(g.annual_maintenance_cost_high_usd)}/yr</span>
                <span style={{ fontWeight: 700, color: '#0c4a6e' }}>Total initial cost</span>
                <span style={{ fontWeight: 700, color: '#0c4a6e' }}>{fmt(g.total_initial_cost_low_usd)} – {fmt(g.total_initial_cost_high_usd)}</span>
              </div>
              {g.note && (
                <div style={{ marginTop: 8, fontSize: 11, color: '#0c4a6e', borderTop: '1px solid #bae6fd', paddingTop: 6 }}>
                  {g.note}
                </div>
              )}
            </div>
          );
        })()}

        {/* AM Grounding System & RF Safety Guide */}
        {candidate.am_grounding_system_and_rf_safety_guide && (() => {
          const g = candidate.am_grounding_system_and_rf_safety_guide;
          const fmt = (n) => n != null ? `$${Number(n).toLocaleString()}` : '—';
          return (
            <div style={{ background: '#fffbeb', border: '1px solid #fbbf24', borderRadius: 8, padding: '14px 16px', marginBottom: 12 }}>
              <div style={{ fontWeight: 700, color: '#92400e', marginBottom: 8, fontSize: 13 }}>
                Ground System &amp; RF Safety (§73.54 / OET-65)
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 16px', fontSize: 12, color: '#78350f' }}>
                <span>Radials</span>
                <span style={{ fontWeight: 600 }}>{g.n_radials} × {g.radial_length_m}m (λ/4 = {g.radial_length_m}m)</span>
                <span>Tower elements</span>
                <span style={{ fontWeight: 600 }}>{g.n_tower_elements}{g.n_tower_elements > 1 ? ' (DA array)' : ' (NDA)'}</span>
                <span>Wire gauge</span>
                <span style={{ fontWeight: 600 }}>#{g.wire_gauge_awg} AWG bare copper</span>
                <span>Total copper</span>
                <span style={{ fontWeight: 600 }}>{g.total_radial_length_m.toLocaleString()}m buried</span>
                <span>Radial install cost</span>
                <span style={{ fontWeight: 600 }}>{fmt(g.radial_install_cost_low_usd)} – {fmt(g.radial_install_cost_high_usd)}</span>
                <span>ATU / bonding</span>
                <span style={{ fontWeight: 600 }}>{fmt(g.atu_cost_low_usd)} – {fmt(g.atu_cost_high_usd)}</span>
                <span>Ground system total</span>
                <span style={{ fontWeight: 600 }}>{fmt(g.ground_system_total_low_usd)} – {fmt(g.ground_system_total_high_usd)}</span>
              </div>
              <div style={{ marginTop: 8, borderTop: '1px solid #fde68a', paddingTop: 8, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 16px', fontSize: 12, color: '#78350f' }}>
                <span>MPE eval required</span>
                <span style={{ fontWeight: 600 }}>{g.mpe_evaluation_required ? 'Yes (§1.1307)' : 'No'}</span>
                <span>Uncontrolled MPE</span>
                <span style={{ fontWeight: 600 }}>{g.mpe_uncontrolled_mw_cm2} mW/cm²</span>
                <span>Exclusion zone</span>
                <span style={{ fontWeight: 600 }}>{g.exclusion_zone_m}m (uncontrolled) / {g.controlled_zone_m}m (controlled)</span>
                <span>RF fence</span>
                <span style={{ fontWeight: 600, color: g.rf_fence_required ? '#b45309' : '#166534' }}>
                  {g.rf_fence_required ? `Required — ${Math.round(g.fence_perimeter_ft)} linear ft` : 'Not required'}
                </span>
                {g.rf_fence_required && <>
                  <span>Fence cost</span>
                  <span style={{ fontWeight: 600 }}>{fmt(g.fence_cost_low_usd)} – {fmt(g.fence_cost_high_usd)}</span>
                </>}
                <span style={{ fontWeight: 700, color: '#92400e' }}>Total (ground + fence)</span>
                <span style={{ fontWeight: 700, color: '#92400e' }}>{fmt(g.total_cost_low_usd)} – {fmt(g.total_cost_high_usd)}</span>
              </div>
              {g.note && (
                <div style={{ marginTop: 8, fontSize: 11, color: '#92400e', borderTop: '1px solid #fde68a', paddingTop: 6 }}>
                  {g.note}
                </div>
              )}
            </div>
          );
        })()}

        {/* AM Station Insurance & Bonding Guide */}
        {candidate.am_station_insurance_and_bonding_guide && (() => {
          const g = candidate.am_station_insurance_and_bonding_guide;
          return (
            <div style={{ marginBottom: 18, padding: '14px 16px', background: '#fff1f2', borderRadius: 8, border: '1px solid #fda4af' }}>
              <div style={{ fontWeight: 700, fontSize: 13, color: '#9f1239', marginBottom: 8 }}>
                Station Insurance & Surety Bonding
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 16px', fontSize: 12, marginBottom: 10 }}>
                <div><span style={{ color: '#64748b' }}>Annual Insurance Premium:</span> <strong>${g.annual_premium_low_usd?.toLocaleString()}–${g.annual_premium_high_usd?.toLocaleString()}/yr</strong></div>
                <div><span style={{ color: '#64748b' }}>Tower Replacement Value:</span> <strong>${g.tower_replacement_value_low_usd?.toLocaleString()}–${g.tower_replacement_value_high_usd?.toLocaleString()}</strong></div>
                <div><span style={{ color: '#64748b' }}>Required Coverage Categories:</span> <strong>{g.n_required_categories}</strong></div>
                <div><span style={{ color: '#64748b' }}>BI Coverage Max:</span> <strong>{g.bi_max_coverage_months} months</strong></div>
                <div><span style={{ color: '#64748b' }}>BI Waiting Period:</span> <strong>{g.bi_waiting_period_hours}h</strong></div>
                <div><span style={{ color: '#64748b' }}>BI Monthly Coverage:</span> <strong>${g.bi_monthly_coverage_usd?.toLocaleString()}/mo</strong></div>
                <div><span style={{ color: '#64748b' }}>Performance Bond:</span> <strong>${g.performance_bond_amount_usd?.toLocaleString()} ({g.performance_bond_pct}%)</strong></div>
                <div><span style={{ color: '#64748b' }}>Bond Annual Premium:</span> <strong>${g.bond_annual_premium_usd?.toLocaleString()}/yr</strong></div>
              </div>
              {g.insurance_categories?.length > 0 && (
                <div style={{ marginBottom: 8 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: '#9f1239', marginBottom: 4 }}>Coverage Requirements</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                    {g.insurance_categories.filter(c => c.required).map((c, i) => (
                      <span key={i} style={{ background: '#fecdd3', color: '#881337', borderRadius: 3, padding: '1px 6px', fontSize: 10 }}>
                        {c.type}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {g.reference && (
                <div style={{ fontSize: 10, color: '#64748b' }}>{g.reference}</div>
              )}
            </div>
          );
        })()}

        {/* FCC Proof of Performance Measurement Guide */}
        {candidate.fcc_proof_of_performance_measurement_guide && (() => {
          const g = candidate.fcc_proof_of_performance_measurement_guide;
          const proofColor = {
            FULL_PROOF: '#7c3aed', SHORT_PROOF: '#0c4a6e', ABBREVIATED: '#15803d', NONE: '#374151'
          }[g.proof_type] ?? '#374151';
          return (
            <div style={{ marginBottom: 18, padding: '14px 16px', background: '#f5f3ff', borderRadius: 8, border: '1px solid #a78bfa' }}>
              <div style={{ fontWeight: 700, fontSize: 13, color: '#5b21b6', marginBottom: 8 }}>
                FCC Proof of Performance — Field Measurement Guide
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 16px', fontSize: 12, marginBottom: 10 }}>
                <div><span style={{ color: '#64748b' }}>Proof Type:</span> <strong style={{ color: proofColor }}>{g.proof_type?.replace(/_/g, ' ')}</strong></div>
                <div><span style={{ color: '#64748b' }}>Radials Required:</span> <strong>{g.n_radials_required}</strong></div>
                <div><span style={{ color: '#64748b' }}>Pts Per Radial:</span> <strong>{g.n_measurement_points_per_radial}</strong></div>
                <div><span style={{ color: '#64748b' }}>Total Measurement Pts:</span> <strong>{g.total_measurement_points}</strong></div>
                <div><span style={{ color: '#64748b' }}>Measurement Days:</span> <strong>{g.n_measurement_days}</strong></div>
                <div><span style={{ color: '#64748b' }}>Timeline:</span> <strong>{g.proof_weeks_low}–{g.proof_weeks_high} weeks</strong></div>
                <div><span style={{ color: '#64748b' }}>Total Proof Cost:</span> <strong>${g.total_proof_cost_low_usd?.toLocaleString()}–${g.total_proof_cost_high_usd?.toLocaleString()}</strong></div>
                <div><span style={{ color: '#64748b' }}>DA Monitor Required:</span> <strong style={{ color: g.da_monitor_required ? '#b91c1c' : '#15803d' }}>{g.da_monitor_required ? `YES ($${g.da_monitor_cost_low_usd?.toLocaleString()}–$${g.da_monitor_cost_high_usd?.toLocaleString()})` : 'No'}</strong></div>
                <div><span style={{ color: '#64748b' }}>Critical Hours:</span> <strong style={{ color: g.critical_hours_required ? '#92400e' : '#15803d' }}>{g.critical_hours_required ? 'Required' : 'Not required'}</strong></div>
                <div><span style={{ color: '#64748b' }}>FCC Review Time:</span> <strong>{g.fcc_review_days_low}–{g.fcc_review_days_high} days</strong></div>
              </div>
              {g.reference && (
                <div style={{ fontSize: 10, color: '#64748b' }}>{g.reference}</div>
              )}
            </div>
          );
        })()}

        {/* AM Translator & Booster Strategy Guide */}
        {candidate.am_translator_and_booster_strategy_guide && (() => {
          const g = candidate.am_translator_and_booster_strategy_guide;
          return (
            <div style={{ marginBottom: 18, padding: '14px 16px', background: '#ecfdf5', borderRadius: 8, border: '1px solid #6ee7b7' }}>
              <div style={{ fontWeight: 700, fontSize: 13, color: '#065f46', marginBottom: 8 }}>
                FM Translator & AM Booster Strategy
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 16px', fontSize: 12, marginBottom: 10 }}>
                <div><span style={{ color: '#64748b' }}>FM Translator Eligible:</span> <strong style={{ color: '#065f46' }}>{g.fm_translator_eligible ? 'YES' : 'No'}</strong></div>
                <div><span style={{ color: '#64748b' }}>AM Revitalization:</span> <strong style={{ color: '#065f46' }}>{g.am_revitalization_eligible ? 'Eligible' : 'N/A'}</strong></div>
                <div><span style={{ color: '#64748b' }}>Recommended ERP:</span> <strong>{g.recommended_translator_erp_w}W ({g.recommended_translator_coverage_km} km)</strong></div>
                <div><span style={{ color: '#64748b' }}>Total Translator Cost:</span> <strong>${g.translator_total_cost_low_usd?.toLocaleString()}–${g.translator_total_cost_high_usd?.toLocaleString()}</strong></div>
                <div><span style={{ color: '#64748b' }}>Annual OpEx:</span> <strong>${g.translator_annual_opex_usd?.toLocaleString()}/yr</strong></div>
                <div><span style={{ color: '#64748b' }}>Max Distance from AM:</span> <strong>{g.translator_max_distance_from_am_km} km</strong></div>
                <div><span style={{ color: '#64748b' }}>Operable During Silence:</span> <strong style={{ color: '#065f46' }}>{g.translator_operable_during_silence ? 'YES' : 'No'}</strong></div>
                <div><span style={{ color: '#64748b' }}>Audience Multiplier:</span> <strong>×{g.translator_audience_multiplier}</strong></div>
                <div><span style={{ color: '#64748b' }}>AM Booster (new):</span> <strong style={{ color: '#b91c1c' }}>{g.am_booster_new_license_available ? 'Available' : 'NOT AVAILABLE'}</strong></div>
                <div><span style={{ color: '#64748b' }}>AM Booster (grandfathered):</span> <strong>{g.am_booster_existing_grandfathered ? 'Yes' : 'No'}</strong></div>
              </div>
              {g.translator_power_tiers?.length > 0 && (
                <div style={{ marginBottom: 8 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: '#065f46', marginBottom: 4 }}>Translator Power Tiers</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {g.translator_power_tiers.map((t, i) => (
                      <span key={i} style={{ background: '#a7f3d0', color: '#064e3b', borderRadius: 4, padding: '2px 7px', fontSize: 11 }}>
                        {t.power_w}W ERP · {t.coverage_radius_km} km
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {g.reference && (
                <div style={{ fontSize: 10, color: '#64748b' }}>{g.reference}</div>
              )}
            </div>
          );
        })()}

        {/* AM Digital HD Radio Upgrade Pathway Guide */}
        {candidate.am_digital_hd_radio_upgrade_pathway_guide && (() => {
          const g = candidate.am_digital_hd_radio_upgrade_pathway_guide;
          const riskColor = { HIGH: '#b91c1c', MODERATE: '#92400e', LOW: '#15803d' }[g.adjacent_ch_interference_risk] ?? '#374151';
          const applicableModes = g.applicable_hd_modes?.filter(m => m.applicable) ?? [];
          return (
            <div style={{ marginBottom: 18, padding: '14px 16px', background: '#fdf2f8', borderRadius: 8, border: '1px solid #f0abfc' }}>
              <div style={{ fontWeight: 700, fontSize: 13, color: '#86198f', marginBottom: 8 }}>
                AM Digital — HD Radio® Upgrade Pathway
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 16px', fontSize: 12, marginBottom: 10 }}>
                <div><span style={{ color: '#64748b' }}>Applicable Modes:</span> <strong>{applicableModes.map(m => m.mode).join(', ') || 'MA1'}</strong></div>
                <div><span style={{ color: '#64748b' }}>Sideband Level:</span> <strong>{g.hd_sideband_dbhd_increased} dBc</strong></div>
                <div><span style={{ color: '#64748b' }}>Total Upgrade Cost:</span> <strong>${g.total_hd_upgrade_cost_low_usd?.toLocaleString()}–${g.total_hd_upgrade_cost_high_usd?.toLocaleString()}</strong></div>
                <div><span style={{ color: '#64748b' }}>HD Coverage:</span> <strong>{Math.round((g.hd_coverage_fraction ?? 0.6) * 100)}% of analog</strong></div>
                <div><span style={{ color: '#64748b' }}>Multicast Channels:</span> <strong>HD2–HD{g.hd_multicast_channels + 1}</strong></div>
                <div><span style={{ color: '#64748b' }}>Authorization Time:</span> <strong>{g.hd_authorization_timeline_months_low}–{g.hd_authorization_timeline_months_high} months</strong></div>
                <div><span style={{ color: '#64748b' }}>Adj. Ch. Interf. Risk:</span> <strong style={{ color: riskColor }}>{g.adjacent_ch_interference_risk}</strong></div>
                <div><span style={{ color: '#64748b' }}>National AM HD Adoption:</span> <strong>{g.national_hd_am_adoption_pct}%</strong></div>
              </div>
              {applicableModes.length > 0 && (
                <div style={{ marginBottom: 8 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: '#86198f', marginBottom: 4 }}>HD Modes</div>
                  {applicableModes.map((m, i) => (
                    <div key={i} style={{ fontSize: 11, background: '#fae8ff', borderRadius: 3, padding: '3px 7px', marginBottom: 2 }}>
                      <strong>{m.mode} — {m.name}</strong>: {m.description} · Coverage {Math.round(m.coverage_fraction_analog * 100)}% of analog
                    </div>
                  ))}
                </div>
              )}
              {g.reference && (
                <div style={{ fontSize: 10, color: '#64748b' }}>{g.reference}</div>
              )}
            </div>
          );
        })()}

        {/* AM Automation & Emergency Alert System Guide */}
        {candidate.am_automation_and_emergency_alert_system_guide && (() => {
          const g = candidate.am_automation_and_emergency_alert_system_guide;
          const autoColor = {
            FULL: '#15803d', SEMI: '#0c4a6e', MANUAL: '#92400e'
          }[g.recommended_automation] ?? '#374151';
          const tierBadgeColor = {
            'Enterprise': '#7c3aed', 'Professional': '#0c4a6e', 'Entry-level': '#15803d'
          }[g.recommended_eas_tier] ?? '#374151';
          return (
            <div style={{ marginBottom: 18, padding: '14px 16px', background: '#f0f9ff', borderRadius: 8, border: '1px solid #7dd3fc' }}>
              <div style={{ fontWeight: 700, fontSize: 13, color: '#0369a1', marginBottom: 8 }}>
                Automation & Emergency Alert System (EAS)
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 16px', fontSize: 12, marginBottom: 10 }}>
                <div><span style={{ color: '#64748b' }}>EAS Tier:</span> <strong style={{ color: tierBadgeColor }}>{g.recommended_eas_tier}</strong></div>
                <div><span style={{ color: '#64748b' }}>Automation:</span> <strong style={{ color: autoColor }}>{g.recommended_automation}</strong></div>
                <div><span style={{ color: '#64748b' }}>EAS Setup Cost:</span> <strong>${g.eas_setup_cost_low_usd?.toLocaleString()}–${g.eas_setup_cost_high_usd?.toLocaleString()}</strong></div>
                <div><span style={{ color: '#64748b' }}>Monthly Op Cost:</span> <strong>${g.monthly_operating_cost_usd}/mo</strong></div>
                <div><span style={{ color: '#64748b' }}>IPAWS Required:</span> <strong style={{ color: '#0369a1' }}>{g.ipaws_monitoring_required ? 'Yes' : 'No'} (${g.ipaws_monthly_cost_usd}/mo)</strong></div>
                <div><span style={{ color: '#64748b' }}>Part 11 Items:</span> <strong>{g.n_part11_required_items} required</strong></div>
                <div><span style={{ color: '#64748b' }}>STL Backup Paths:</span> <strong>{g.n_stl_backup_paths}</strong></div>
                <div><span style={{ color: '#64748b' }}>EAS Test Types:</span> <strong>{g.n_eas_tests}</strong></div>
              </div>
              {g.eas_tests?.length > 0 && (
                <div style={{ marginBottom: 8 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: '#0369a1', marginBottom: 4 }}>EAS Tests</div>
                  {g.eas_tests.map((t, i) => (
                    <div key={i} style={{ fontSize: 11, background: '#e0f2fe', borderRadius: 3, padding: '3px 7px', marginBottom: 2 }}>
                      <strong>{t.type}</strong>: {t.frequency}{t.penalty_per_miss_usd > 0 ? ` · Max fine $${t.penalty_per_miss_usd.toLocaleString()}` : ''}
                    </div>
                  ))}
                </div>
              )}
              {g.reference && (
                <div style={{ fontSize: 10, color: '#64748b' }}>{g.reference}</div>
              )}
            </div>
          );
        })()}

        {/* Broadcast Market Competitive Landscape Guide */}
        {candidate.broadcast_market_competitive_landscape_guide && (() => {
          const g = candidate.broadcast_market_competitive_landscape_guide;
          const tierColor = {
            MAJOR: '#0c4a6e', MEDIUM: '#1e40af', SMALL: '#374151', RURAL: '#15803d'
          }[g.market_tier] ?? '#374151';
          const tierBg = {
            MAJOR: '#e0f2fe', MEDIUM: '#dbeafe', SMALL: '#f3f4f6', RURAL: '#dcfce7'
          }[g.market_tier] ?? '#f3f4f6';
          const dispRiskColor = { HIGH: '#b91c1c', MODERATE: '#92400e', LOW: '#15803d' }[g.market_displacement_risk] ?? '#374151';
          return (
            <div style={{ marginBottom: 18, padding: '14px 16px', background: '#fff7ed', borderRadius: 8, border: '1px solid #fed7aa' }}>
              <div style={{ fontWeight: 700, fontSize: 13, color: '#c2410c', marginBottom: 8 }}>
                Broadcast Market — Competitive Landscape
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 16px', fontSize: 12, marginBottom: 10 }}>
                <div><span style={{ color: '#64748b' }}>Market Tier:</span> <strong style={{ color: tierColor }}>{g.market_tier}</strong></div>
                <div><span style={{ color: '#64748b' }}>Reach Scale:</span> <strong>{g.reach_scale_km?.toFixed(0)} km</strong></div>
                <div><span style={{ color: '#64748b' }}>AM Stations in Market:</span> <strong>{g.estimated_am_stations_in_market}</strong></div>
                <div><span style={{ color: '#64748b' }}>FM Stations in Market:</span> <strong>{g.estimated_fm_stations_in_market}</strong></div>
                <div><span style={{ color: '#64748b' }}>FM Translators:</span> <strong>{g.estimated_translators_in_market}</strong></div>
                <div><span style={{ color: '#64748b' }}>AM National Share:</span> <strong>{g.am_market_share_pct}%</strong></div>
                <div><span style={{ color: '#64748b' }}>Audience Δ vs Current:</span> <strong style={{ color: g.audience_potential_change_pct >= 0 ? '#15803d' : '#b91c1c' }}>{g.audience_potential_change_pct >= 0 ? '+' : ''}{g.audience_potential_change_pct}%</strong></div>
                <div><span style={{ color: '#64748b' }}>Displacement Risk:</span> <strong style={{ color: dispRiskColor }}>{g.market_displacement_risk}</strong></div>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                <span style={{ background: tierBg, color: tierColor, borderRadius: 4, padding: '2px 8px', fontSize: 11, fontWeight: 600 }}>
                  {g.market_tier} MARKET
                </span>
                <span style={{ background: '#fef9c3', color: '#92400e', borderRadius: 4, padding: '2px 8px', fontSize: 11, fontWeight: 600 }}>
                  FM Translator Advantage: {g.fm_translator_advantage}
                </span>
              </div>
              {g.format_segments?.length > 0 && (
                <div style={{ marginBottom: 8 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: '#c2410c', marginBottom: 4 }}>AM Format Segments</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                    {g.format_segments.map((f, i) => (
                      <span key={i} style={{ background: '#fed7aa', color: '#7c2d12', borderRadius: 3, padding: '1px 6px', fontSize: 10 }}>
                        {f.format} {f.am_station_pct}% · {f.growth_trend?.replace(/_/g, ' ')}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {g.reference && (
                <div style={{ fontSize: 10, color: '#64748b' }}>{g.reference}</div>
              )}
            </div>
          );
        })()}

        {/* Tower Structural Wind & Ice Load Design Guide */}
        {candidate.tower_structural_wind_and_ice_load_design_guide && (() => {
          const g = candidate.tower_structural_wind_and_ice_load_design_guide;
          const iceColor = {
            HEAVY_ICE: '#b91c1c', MODERATE_ICE: '#92400e', LIGHT_ICE: '#15803d'
          }[g.ice_zone] ?? '#374151';
          const windRisk = g.design_wind_speed_mph >= 130 ? 'HIGH' : g.design_wind_speed_mph >= 105 ? 'MODERATE' : 'LOW';
          const windColor = windRisk === 'HIGH' ? '#b91c1c' : windRisk === 'MODERATE' ? '#92400e' : '#15803d';
          return (
            <div style={{ marginBottom: 18, padding: '14px 16px', background: '#f8fafc', borderRadius: 8, border: '1px solid #94a3b8' }}>
              <div style={{ fontWeight: 700, fontSize: 13, color: '#1e293b', marginBottom: 8 }}>
                Tower Structural — Wind & Ice Load Design
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 16px', fontSize: 12, marginBottom: 10 }}>
                <div><span style={{ color: '#64748b' }}>Tower Height:</span> <strong>{g.tower_height_m}m / {g.tower_height_ft}ft</strong></div>
                <div><span style={{ color: '#64748b' }}>Wind Zone:</span> <strong style={{ color: windColor }}>{g.wind_zone?.replace(/_/g, ' ')}</strong></div>
                <div><span style={{ color: '#64748b' }}>Design Wind Speed:</span> <strong style={{ color: windColor }}>{g.design_wind_speed_mph} mph ({g.design_wind_speed_ms} m/s)</strong></div>
                <div><span style={{ color: '#64748b' }}>Wind Pressure:</span> <strong>{g.wind_pressure_psf} psf ({g.wind_pressure_pa} Pa)</strong></div>
                <div><span style={{ color: '#64748b' }}>Ice Load Zone:</span> <strong style={{ color: iceColor }}>{g.ice_zone?.replace(/_/g, ' ')} ({g.ice_radial_in}")</strong></div>
                <div><span style={{ color: '#64748b' }}>TIA Risk Category:</span> <strong>{g.tia_risk_category}</strong></div>
                <div><span style={{ color: '#64748b' }}>Tower Weight:</span> <strong>{g.tower_weight_lb_low?.toLocaleString()}–{g.tower_weight_lb_high?.toLocaleString()} lb</strong></div>
                <div><span style={{ color: '#64748b' }}>Guy Levels:</span> <strong>{g.n_guy_levels}</strong></div>
                <div><span style={{ color: '#64748b' }}>Guy Anchor Radius:</span> <strong>{g.guy_anchor_radius_m_low}–{g.guy_anchor_radius_m_high}m</strong></div>
                <div><span style={{ color: '#64748b' }}>Foundation Depth:</span> <strong>{g.foundation_depth_m}m dia {g.foundation_diameter_m}m</strong></div>
                <div><span style={{ color: '#64748b' }}>Base Insulator:</span> <strong>{g.base_insulator_kv} kV</strong></div>
                <div><span style={{ color: '#64748b' }}>Design Standard:</span> <strong style={{ fontSize: 10 }}>{g.design_standard}</strong></div>
              </div>
              {g.reference && (
                <div style={{ fontSize: 10, color: '#64748b' }}>{g.reference}</div>
              )}
            </div>
          );
        })()}

        {/* AM Night Skywave Coverage & Interference Risk Guide */}
        {candidate.am_night_skywave_coverage_and_interference_risk_guide && (() => {
          const g = candidate.am_night_skywave_coverage_and_interference_risk_guide;
          const riskColor = { HIGH: '#b91c1c', MODERATE: '#92400e', LOW: '#15803d' }[g.dominant_class_a_risk] ?? '#374151';
          const opColor = {
            FULL_POWER_24H: '#15803d', DA_N_REQUIRED: '#0c4a6e', REDUCED_POWER_OR_SILENT: '#92400e'
          }[g.night_operation_type] ?? '#374151';
          return (
            <div style={{ marginBottom: 18, padding: '14px 16px', background: '#1e1b4b', borderRadius: 8, border: '1px solid #4338ca' }}>
              <div style={{ fontWeight: 700, fontSize: 13, color: '#a5b4fc', marginBottom: 8 }}>
                Night Skywave — Coverage & Interference Risk
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 16px', fontSize: 12, marginBottom: 10, color: '#e0e7ff' }}>
                <div><span style={{ color: '#94a3b8' }}>Latitude Zone:</span> <strong>{g.lat_zone?.replace(/_/g, ' ')}</strong></div>
                <div><span style={{ color: '#94a3b8' }}>E-Layer Height:</span> <strong>{g.e_layer_height_km} km</strong></div>
                <div><span style={{ color: '#94a3b8' }}>Skip Distance:</span> <strong>{g.skip_distance_km} km</strong></div>
                <div><span style={{ color: '#94a3b8' }}>Skip Zone:</span> <strong>{g.skip_zone_low_km}–{g.skip_zone_high_km} km</strong></div>
                <div><span style={{ color: '#94a3b8' }}>Night Operation:</span> <strong style={{ color: opColor === '#15803d' ? '#4ade80' : opColor === '#92400e' ? '#fb923c' : '#93c5fd' }}>{g.night_operation_type?.replace(/_/g, ' ')}</strong></div>
                <div><span style={{ color: '#94a3b8' }}>DA-N Required:</span> <strong style={{ color: g.da_n_required ? '#f87171' : '#4ade80' }}>{g.da_n_required ? 'YES' : 'No'}</strong></div>
                <div><span style={{ color: '#94a3b8' }}>Night Reduce Power:</span> <strong style={{ color: g.requires_night_power_reduction ? '#fb923c' : '#4ade80' }}>{g.requires_night_power_reduction ? 'Required' : 'No'}</strong></div>
                <div><span style={{ color: '#94a3b8' }}>Night Noise Penalty:</span> <strong>{g.night_noise_penalty_db} dB</strong></div>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                <span style={{ background: '#312e81', color: '#a5b4fc', borderRadius: 4, padding: '2px 8px', fontSize: 11, fontWeight: 600 }}>
                  {g.night_protection_class?.replace(/_/g, ' ')}
                </span>
                <span style={{ background: g.dominant_class_a_risk === 'HIGH' ? '#7f1d1d' : g.dominant_class_a_risk === 'MODERATE' ? '#78350f' : '#14532d', color: '#fecaca', borderRadius: 4, padding: '2px 8px', fontSize: 11, fontWeight: 600 }}>
                  Class A Risk: {g.dominant_class_a_risk}
                </span>
              </div>
              {g.reference && (
                <div style={{ fontSize: 10, color: '#64748b' }}>{g.reference}</div>
              )}
            </div>
          );
        })()}

        {/* RF Propagation Terrain Roughness Guide */}
        {candidate.rf_propagation_terrain_roughness_guide && (() => {
          const g = candidate.rf_propagation_terrain_roughness_guide;
          const classColor = {
            VERY_SMOOTH: '#15803d', SMOOTH: '#166534', MODERATE: '#0c4a6e',
            ROUGH: '#92400e', VERY_ROUGH: '#7c2d12'
          }[g.terrain_class] ?? '#374151';
          const classBg = {
            VERY_SMOOTH: '#dcfce7', SMOOTH: '#d1fae5', MODERATE: '#e0f2fe',
            ROUGH: '#fef3c7', VERY_ROUGH: '#fee2e2'
          }[g.terrain_class] ?? '#f3f4f6';
          return (
            <div style={{ marginBottom: 18, padding: '14px 16px', background: '#fdf4ff', borderRadius: 8, border: '1px solid #e879f9' }}>
              <div style={{ fontWeight: 700, fontSize: 13, color: '#7e22ce', marginBottom: 8 }}>
                RF Propagation — Terrain Roughness Analysis
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 16px', fontSize: 12, marginBottom: 10 }}>
                <div><span style={{ color: '#64748b' }}>Wavelength:</span> <strong>{g.lambda_m}m</strong></div>
                <div><span style={{ color: '#64748b' }}>σ Terrain:</span> <strong>{g.sigma_msm_val}m</strong></div>
                <div><span style={{ color: '#64748b' }}>Δh Interdecile:</span> <strong>{g.delta_h_m}m (ref {g.delta_h_ref_m}m)</strong></div>
                <div><span style={{ color: '#64748b' }}>Terrain Factor:</span> <strong>{g.terrain_correction_factor}</strong></div>
                <div><span style={{ color: '#64748b' }}>Base Range:</span> <strong>{g.base_groundwave_range_km} km</strong></div>
                <div><span style={{ color: '#64748b' }}>Est. R(50,50) Range:</span> <strong>{g.estimated_range_km} km</strong></div>
                <div><span style={{ color: '#64748b' }}>Effective COL Range:</span> <strong>{g.effective_range_col_km} km</strong></div>
                <div><span style={{ color: '#64748b' }}>COL Bearing:</span> <strong>{g.bearing_to_col_deg !== null ? `${g.bearing_to_col_deg}°` : 'N/A'}</strong></div>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                <span style={{ background: classBg, color: classColor, borderRadius: 4, padding: '2px 8px', fontSize: 11, fontWeight: 600 }}>
                  {g.terrain_class?.replace(/_/g, ' ')}
                </span>
                {g.da_favored_bearing !== null && (
                  <span style={{ background: g.da_favored_bearing ? '#dcfce7' : '#fee2e2', color: g.da_favored_bearing ? '#15803d' : '#b91c1c', borderRadius: 4, padding: '2px 8px', fontSize: 11, fontWeight: 600 }}>
                    DA COL BEARING: {g.da_favored_bearing ? 'FAVORED' : 'UNFAVORED'}
                  </span>
                )}
              </div>
              {g.reference && (
                <div style={{ fontSize: 10, color: '#64748b' }}>{g.reference}</div>
              )}
            </div>
          );
        })()}

        {/* FCC License History & Compliance Record Guide */}
        {candidate.fcc_license_history_and_compliance_record_guide && (() => {
          const g = candidate.fcc_license_history_and_compliance_record_guide;
          const priorityColor = {
            EXPEDITED_ELIGIBLE: '#14532d', PRIORITY_RURAL: '#1e40af', NORMAL: '#374151'
          }[g.processing_priority] ?? '#374151';
          const priorityBg = {
            EXPEDITED_ELIGIBLE: '#dcfce7', PRIORITY_RURAL: '#dbeafe', NORMAL: '#f3f4f6'
          }[g.processing_priority] ?? '#f3f4f6';
          const compRiskColor = { HIGH: '#b91c1c', MODERATE: '#92400e', LOW: '#14532d' }[g.comparative_proceeding_risk] ?? '#374151';
          return (
            <div style={{ marginBottom: 18, padding: '14px 16px', background: '#fefce8', borderRadius: 8, border: '1px solid #fde047' }}>
              <div style={{ fontWeight: 700, fontSize: 13, color: '#854d0e', marginBottom: 8 }}>
                FCC License History & Compliance Profile
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 16px', fontSize: 12, marginBottom: 10 }}>
                <div><span style={{ color: '#64748b' }}>Processing Priority:</span> <strong style={{ color: priorityColor }}>{g.processing_priority?.replace(/_/g, ' ')}</strong></div>
                <div><span style={{ color: '#64748b' }}>Processing Time:</span> <strong>{g.processing_months_low}–{g.processing_months_high} months</strong></div>
                <div><span style={{ color: '#64748b' }}>Comparative Risk:</span> <strong style={{ color: compRiskColor }}>{g.comparative_proceeding_risk}</strong></div>
                <div><span style={{ color: '#64748b' }}>STA Eligible:</span> <strong style={{ color: g.sta_eligible ? '#15803d' : '#b91c1c' }}>{g.sta_eligible ? `Yes (${g.sta_duration_days} days)` : 'No'}</strong></div>
                <div><span style={{ color: '#64748b' }}>CP Expiry Term:</span> <strong>{g.cp_years_to_expiry} years</strong></div>
                <div><span style={{ color: '#64748b' }}>Foreign Ownership Limit:</span> <strong>20–25%</strong></div>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                <span style={{ background: priorityBg, color: priorityColor, borderRadius: 4, padding: '2px 8px', fontSize: 11, fontWeight: 600 }}>
                  {g.processing_priority?.replace(/_/g, ' ')}
                </span>
                <span style={{ background: '#fef9c3', color: compRiskColor, borderRadius: 4, padding: '2px 8px', fontSize: 11, fontWeight: 600 }}>
                  Comparative: {g.comparative_proceeding_risk}
                </span>
              </div>
              {g.key_filing_deadlines?.length > 0 && (
                <div style={{ marginBottom: 8 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: '#854d0e', marginBottom: 4 }}>Key Filing Deadlines</div>
                  {g.key_filing_deadlines.map((d, i) => (
                    <div key={i} style={{ fontSize: 11, background: '#fef9c3', borderRadius: 4, padding: '3px 8px', marginBottom: 2 }}>
                      <strong>{d.item}</strong> ({d.form}): {d.deadline}
                    </div>
                  ))}
                </div>
              )}
              {g.reference && (
                <div style={{ fontSize: 10, color: '#64748b' }}>{g.reference}</div>
              )}
            </div>
          );
        })()}

        {/* Environmental Permitting & NEPA Compliance Guide */}
        {candidate.environmental_permitting_and_nepa_compliance_guide && (() => {
          const g = candidate.environmental_permitting_and_nepa_compliance_guide;
          const tierColor = {
            CATEGORICAL_EXCLUSION: '#14532d', ENVIRONMENTAL_ASSESSMENT: '#92400e',
            ENVIRONMENTAL_IMPACT_STATEMENT: '#7f1d1d'
          }[g.nepa_tier] ?? '#374151';
          const tierBg = {
            CATEGORICAL_EXCLUSION: '#dcfce7', ENVIRONMENTAL_ASSESSMENT: '#fef3c7',
            ENVIRONMENTAL_IMPACT_STATEMENT: '#fee2e2'
          }[g.nepa_tier] ?? '#f3f4f6';
          return (
            <div style={{ marginBottom: 18, padding: '14px 16px', background: '#f0fdf4', borderRadius: 8, border: '1px solid #86efac' }}>
              <div style={{ fontWeight: 700, fontSize: 13, color: '#15803d', marginBottom: 8 }}>
                Environmental Permitting & NEPA Compliance
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 16px', fontSize: 12, marginBottom: 10 }}>
                <div><span style={{ color: '#64748b' }}>Tower Height:</span> <strong>{g.tower_height_m}m / {g.tower_height_ft}ft</strong></div>
                <div><span style={{ color: '#64748b' }}>Array Towers:</span> <strong>{g.n_towers_in_array}</strong></div>
                <div><span style={{ color: '#64748b' }}>Exceeds 61m AGL:</span> <strong style={{ color: g.exceeds_61m_agl ? '#b91c1c' : '#15803d' }}>{g.exceeds_61m_agl ? 'YES' : 'No'}</strong></div>
                <div><span style={{ color: '#64748b' }}>§1.1307 Triggers:</span> <strong>{g.n_section_1307_triggers}</strong></div>
                <div><span style={{ color: '#64748b' }}>Section 106 Required:</span> <strong style={{ color: g.section_106_nhpa_required ? '#b91c1c' : '#15803d' }}>{g.section_106_nhpa_required ? 'YES' : 'No'}</strong></div>
                <div><span style={{ color: '#64748b' }}>RF MPE Assessment:</span> <strong>{g.rf_mpe_assessment_required ? 'Required' : 'CE applies'}</strong></div>
                <div><span style={{ color: '#64748b' }}>Permitting Timeline:</span> <strong>{g.total_permitting_timeline_days_low}–{g.total_permitting_timeline_days_high} days</strong></div>
                <div><span style={{ color: '#64748b' }}>Army Corps NWP-57:</span> <strong>{g.army_corps_nwp57_applicable ? 'Applicable' : 'N/A'}</strong></div>
              </div>
              <div style={{ marginBottom: 8 }}>
                <span style={{ background: tierBg, color: tierColor, borderRadius: 4, padding: '2px 10px', fontSize: 11, fontWeight: 600 }}>
                  {g.nepa_tier_label ?? g.nepa_tier?.replace(/_/g, ' ')}
                </span>
              </div>
              {g.section_1307_triggers?.length > 0 && (
                <div style={{ marginBottom: 8 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: '#15803d', marginBottom: 4 }}>§1.1307 Triggers</div>
                  {g.section_1307_triggers.map((t, i) => (
                    <div key={i} style={{ fontSize: 11, background: '#dcfce7', borderRadius: 4, padding: '4px 8px', marginBottom: 3 }}>
                      <strong>{t.code}</strong>: {t.issue} — <em>{t.action}</em>
                    </div>
                  ))}
                </div>
              )}
              {g.reference && (
                <div style={{ fontSize: 10, color: '#64748b' }}>{g.reference}</div>
              )}
            </div>
          );
        })()}

        {/* Community of License Population Change Trend Guide */}
        {candidate.community_of_license_population_change_trend_guide && (() => {
          const g = candidate.community_of_license_population_change_trend_guide;
          const tierColor = {
            RAPID_GROWTH: '#14532d', GROWING: '#166534', STABLE: '#0c4a6e',
            DECLINING: '#7c2d12', RAPID_DECLINE: '#450a0a'
          }[g.growth_tier] ?? '#374151';
          const tierBg = {
            RAPID_GROWTH: '#dcfce7', GROWING: '#d1fae5', STABLE: '#e0f2fe',
            DECLINING: '#fee2e2', RAPID_DECLINE: '#fecaca'
          }[g.growth_tier] ?? '#f3f4f6';
          const riskColor = { HIGH: '#991b1b', MODERATE: '#92400e', LOW: '#14532d' }[g.sect_307b_preference_risk] ?? '#374151';
          return (
            <div style={{ marginBottom: 18, padding: '14px 16px', background: '#ecfeff', borderRadius: 8, border: '1px solid #67e8f9' }}>
              <div style={{ fontWeight: 700, fontSize: 13, color: '#0e7490', marginBottom: 8 }}>
                COL Population Change & §307(b) Risk
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 16px', fontSize: 12, marginBottom: 10 }}>
                <div><span style={{ color: '#64748b' }}>Coverage Radius:</span> <strong>{g.coverage_radius_km} km</strong></div>
                <div><span style={{ color: '#64748b' }}>Dist to COL Centroid:</span> <strong>{g.col_dist_from_candidate_km} km</strong></div>
                <div><span style={{ color: '#64748b' }}>Pop Served Fraction:</span> <strong>{(g.pop_served_fraction * 100).toFixed(0)}%</strong></div>
                <div><span style={{ color: '#64748b' }}>Est. COL Pop (now):</span> <strong>{g.col_pop_estimate_now?.toLocaleString()}</strong></div>
                <div><span style={{ color: '#64748b' }}>Est. COL Pop (10yr):</span> <strong>{g.col_pop_estimate_10yr?.toLocaleString()}</strong></div>
                <div><span style={{ color: '#64748b' }}>10yr Change:</span> <strong>{g.col_pop_change_10yr >= 0 ? '+' : ''}{g.col_pop_change_10yr?.toLocaleString()}</strong></div>
                <div><span style={{ color: '#64748b' }}>Growth Rate:</span> <strong>{g.estimated_col_growth_pct_per_yr}%/yr</strong></div>
                <div><span style={{ color: '#64748b' }}>National Baseline:</span> <strong>{g.national_baseline_growth_pct_per_yr}%/yr</strong></div>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                <span style={{ background: tierBg, color: tierColor, borderRadius: 4, padding: '2px 8px', fontSize: 11, fontWeight: 600 }}>
                  {g.growth_tier?.replace(/_/g, ' ')}
                </span>
                <span style={{ background: '#fef3c7', color: riskColor, borderRadius: 4, padding: '2px 8px', fontSize: 11, fontWeight: 600 }}>
                  §307(b): {g.sect_307b_preference_risk} RISK
                </span>
                {g.tuck_rule_protected && (
                  <span style={{ background: '#dbeafe', color: '#1e3a8a', borderRadius: 4, padding: '2px 8px', fontSize: 11, fontWeight: 600 }}>
                    TUCK RULE PROTECTED (IHB)
                  </span>
                )}
              </div>
              {g.reference && (
                <div style={{ fontSize: 10, color: '#64748b' }}>{g.reference}</div>
              )}
            </div>
          );
        })()}

        {/* Silent Period Revenue Impact & Audience Retention Guide */}
        {candidate.silent_period_revenue_impact_and_audience_retention_guide && (() => {
          const g = candidate.silent_period_revenue_impact_and_audience_retention_guide;
          const typicalScenario = g.silence_scenarios?.find(s => s.months === 6);
          return (
            <div style={{ marginBottom: 18, padding: '14px 16px', background: '#f0fdfa', borderRadius: 8, border: '1px solid #5eead4' }}>
              <div style={{ fontWeight: 700, fontSize: 13, color: '#0f766e', marginBottom: 8 }}>
                Silent Period — Revenue & Audience Impact
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 16px', fontSize: 12, marginBottom: 10 }}>
                <div><span style={{ color: '#64748b' }}>Monthly Gross:</span> <strong>${g.monthly_gross_revenue_low_usd?.toLocaleString()}–${g.monthly_gross_revenue_high_usd?.toLocaleString()}</strong></div>
                <div><span style={{ color: '#64748b' }}>Monthly Net:</span> <strong>${g.monthly_net_revenue_low_usd?.toLocaleString()}–${g.monthly_net_revenue_high_usd?.toLocaleString()}</strong></div>
                <div><span style={{ color: '#64748b' }}>Agency/Rep Commission:</span> <strong>{g.agency_rep_commission_pct}%</strong></div>
                <div><span style={{ color: '#64748b' }}>Monthly Audience Attrition:</span> <strong>{g.monthly_audience_attrition_pct}%/mo</strong></div>
                <div><span style={{ color: '#64748b' }}>FCC Silence Limit:</span> <strong>{g.fcc_silence_limit_months} months</strong></div>
                <div><span style={{ color: '#64748b' }}>1-Month Acceleration Value:</span> <strong>${g.acceleration_1mo_value_usd?.toLocaleString()}</strong></div>
              </div>
              {typicalScenario && (
                <div style={{ background: '#ccfbf1', borderRadius: 6, padding: '8px 10px', fontSize: 12, marginBottom: 10 }}>
                  <strong>Typical 6-Month Scenario:</strong> Revenue loss ${g.typical_6mo_revenue_loss_low_usd?.toLocaleString()}–${g.typical_6mo_revenue_loss_high_usd?.toLocaleString()} net · Audience retained {g.typical_6mo_audience_retained_pct}% · Recovery ~{g.typical_6mo_recovery_months} months
                </div>
              )}
              {g.silence_scenarios?.length > 0 && (
                <div style={{ marginBottom: 8 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: '#0f766e', marginBottom: 4 }}>Silence Scenarios</div>
                  <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ background: '#99f6e4', color: '#134e4a' }}>
                        <th style={{ padding: '3px 6px', textAlign: 'left' }}>Scenario</th>
                        <th style={{ padding: '3px 6px', textAlign: 'right' }}>Prob</th>
                        <th style={{ padding: '3px 6px', textAlign: 'right' }}>Audience Ret.</th>
                        <th style={{ padding: '3px 6px', textAlign: 'right' }}>Net Rev Loss</th>
                        <th style={{ padding: '3px 6px', textAlign: 'right' }}>Recovery</th>
                      </tr>
                    </thead>
                    <tbody>
                      {g.silence_scenarios.map((s, i) => (
                        <tr key={i} style={{ background: i % 2 === 0 ? '#f0fdfa' : '#ccfbf1' }}>
                          <td style={{ padding: '3px 6px' }}>{s.label}</td>
                          <td style={{ padding: '3px 6px', textAlign: 'right' }}>{Math.round(s.probability * 100)}%</td>
                          <td style={{ padding: '3px 6px', textAlign: 'right' }}>{s.audience_retained_pct}%</td>
                          <td style={{ padding: '3px 6px', textAlign: 'right' }}>${s.revenue_loss_net_low_usd?.toLocaleString()}–${s.revenue_loss_net_high_usd?.toLocaleString()}</td>
                          <td style={{ padding: '3px 6px', textAlign: 'right' }}>{s.recovery_months_est} mo</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {g.non_broadcast_streams?.length > 0 && (
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: '#0f766e', marginBottom: 4 }}>Non-Broadcast Revenue During Silence</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {g.non_broadcast_streams.map((s, i) => (
                      <span key={i} style={{ background: '#99f6e4', color: '#134e4a', borderRadius: 4, padding: '2px 7px', fontSize: 11 }}>
                        {s.source}: ${s.monthly_low?.toLocaleString()}–${s.monthly_high?.toLocaleString()}/mo
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {g.reference && (
                <div style={{ fontSize: 10, color: '#64748b', marginTop: 8 }}>{g.reference}</div>
              )}
            </div>
          );
        })()}

        {/* FCC Form 301 Exhibit Checklist Guide */}
        {candidate.fcc_form_301_exhibit_checklist_guide && (() => {
          const g = candidate.fcc_form_301_exhibit_checklist_guide;
          const topDeficiency = g.deficiency_triggers?.[0];
          return (
            <div style={{ marginBottom: 18, padding: '14px 16px', background: '#f5f3ff', borderRadius: 8, border: '1px solid #c4b5fd' }}>
              <div style={{ fontWeight: 700, fontSize: 13, color: '#4c1d95', marginBottom: 8 }}>
                FCC Form 301-AM Exhibit Checklist — Construction Permit Application
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 24px', fontSize: 12, marginBottom: 10 }}>
                <div><span style={{ color: '#6b7280' }}>Pattern mode:</span> <strong>{g.pattern_mode} ({g.is_directional ? 'Directional' : 'Non-Directional'})</strong></div>
                <div><span style={{ color: '#6b7280' }}>Total exhibits:</span> <strong>{g.n_exhibits_total}</strong></div>
                <div><span style={{ color: '#6b7280' }}>Required exhibits:</span> <strong style={{ color: '#7c3aed' }}>{g.n_exhibits_required}</strong></div>
                <div><span style={{ color: '#6b7280' }}>DA-specific exhibits:</span> <strong>{g.n_exhibits_da_specific} {g.is_directional ? '(required)' : '(not needed — NDA)'}</strong></div>
                <div><span style={{ color: '#6b7280' }}>ASR required:</span> <strong style={{ color: g.asr_required ? '#dc2626' : '#16a34a' }}>{g.asr_required ? `Yes — tower ${g.tower_height_ft} ft (§17.7)` : 'No'}</strong></div>
                <div><span style={{ color: '#6b7280' }}>Filing fee:</span> <strong>${g.filing_fee_usd?.toLocaleString()} (Form 301)</strong></div>
                <div><span style={{ color: '#6b7280' }}>Filing system:</span> <strong>{g.filing_system}</strong></div>
                <div><span style={{ color: '#6b7280' }}>Deficiency risks:</span> <strong>{g.n_deficiency_risks} identified</strong></div>
              </div>
              {topDeficiency && (
                <div style={{ marginBottom: 8, padding: '8px 10px', background: '#ede9fe', borderRadius: 6, border: '1px solid #c4b5fd' }}>
                  <div style={{ fontWeight: 600, fontSize: 11, color: '#4c1d95', marginBottom: 3 }}>Top Deficiency Risk #{topDeficiency.rank}: {topDeficiency.issue}</div>
                  <div style={{ fontSize: 11, color: '#6b7280' }}>{topDeficiency.cfr} — {topDeficiency.how_to_avoid}</div>
                </div>
              )}
              {g.required_exhibits && (
                <div>
                  <div style={{ fontWeight: 600, fontSize: 11, color: '#4c1d95', marginBottom: 4 }}>Required Exhibits ({g.n_exhibits_required})</div>
                  <table style={{ width: '100%', fontSize: 10, borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ background: '#ddd6fe' }}>
                        <th style={{ textAlign: 'left', padding: '3px 6px' }}>ID</th>
                        <th style={{ textAlign: 'left', padding: '3px 6px' }}>Exhibit</th>
                        <th style={{ textAlign: 'left', padding: '3px 6px' }}>CFR</th>
                      </tr>
                    </thead>
                    <tbody>
                      {g.required_exhibits.map((e, i) => (
                        <tr key={i} style={{ borderTop: '1px solid #c4b5fd' }}>
                          <td style={{ padding: '2px 6px', fontWeight: 700, color: '#4c1d95', whiteSpace: 'nowrap' }}>{e.id}</td>
                          <td style={{ padding: '2px 6px' }}>{e.title}</td>
                          <td style={{ padding: '2px 6px', color: '#6b7280', whiteSpace: 'nowrap' }}>{e.cfr}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div style={{ marginTop: 8, fontSize: 10, color: '#4c1d95' }}>{g.note}</div>
            </div>
          );
        })()}

        {/* Electrical Power Consumption Guide */}
        {candidate.electrical_power_consumption_guide && (() => {
          const g = candidate.electrical_power_consumption_guide;
          const ss   = g.transmitter_models?.find(m => m.type === 'SOLID_STATE');
          const tube = g.transmitter_models?.find(m => m.type === 'TUBE');
          return (
            <div style={{ marginBottom: 18, padding: '14px 16px', background: '#fff1f2', borderRadius: 8, border: '1px solid #fda4af' }}>
              <div style={{ fontWeight: 700, fontSize: 13, color: '#9f1239', marginBottom: 8 }}>
                Electrical Power Consumption — Transmitter Efficiency &amp; Electricity Cost
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 24px', fontSize: 12, marginBottom: 10 }}>
                <div><span style={{ color: '#6b7280' }}>TPO / frequency:</span> <strong>{g.tpo_kw} kW @ {g.frequency_khz} kHz</strong></div>
                <div><span style={{ color: '#6b7280' }}>Electricity rate:</span> <strong>${g.electricity_rate_low_usd_per_kwh}–${g.electricity_rate_high_usd_per_kwh}/kWh</strong></div>
                <div><span style={{ color: '#6b7280' }}>SS annual cost:</span> <strong style={{ color: '#15803d' }}>${ss?.annual_cost_low_usd?.toLocaleString()}–${ss?.annual_cost_high_usd?.toLocaleString()}/yr</strong></div>
                <div><span style={{ color: '#6b7280' }}>Tube annual cost:</span> <strong style={{ color: '#b45309' }}>${tube?.annual_cost_low_usd?.toLocaleString()}–${tube?.annual_cost_high_usd?.toLocaleString()}/yr</strong></div>
                <div><span style={{ color: '#6b7280' }}>Annual savings (SS vs tube):</span> <strong style={{ color: '#15803d' }}>${g.annual_savings_vs_tube_usd?.toLocaleString()}/yr</strong></div>
                <div><span style={{ color: '#6b7280' }}>Upgrade payback:</span> <strong>{g.upgrade_payback_years} yr on ${g.solid_state_tx_upgrade_cost_usd?.toLocaleString()} tx</strong></div>
              </div>
              {g.transmitter_models && (
                <div>
                  <div style={{ fontWeight: 600, fontSize: 11, color: '#9f1239', marginBottom: 4 }}>Transmitter Technology Comparison</div>
                  <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ background: '#fecdd3' }}>
                        <th style={{ textAlign: 'left', padding: '3px 6px' }}>Type</th>
                        <th style={{ textAlign: 'right', padding: '3px 6px' }}>Eff %</th>
                        <th style={{ textAlign: 'right', padding: '3px 6px' }}>Input kW</th>
                        <th style={{ textAlign: 'right', padding: '3px 6px' }}>Annual Cost</th>
                      </tr>
                    </thead>
                    <tbody>
                      {g.transmitter_models.map((m, i) => (
                        <tr key={i} style={{ borderTop: '1px solid #fda4af', background: m.type === 'SOLID_STATE' ? '#fff1f2' : 'transparent' }}>
                          <td style={{ padding: '3px 6px', fontWeight: m.type === 'SOLID_STATE' ? 700 : 400 }}>{m.label}</td>
                          <td style={{ textAlign: 'right', padding: '3px 6px' }}>{m.efficiency_low_pct}–{m.efficiency_high_pct}%</td>
                          <td style={{ textAlign: 'right', padding: '3px 6px' }}>{m.input_power_low_kw}–{m.input_power_high_kw}</td>
                          <td style={{ textAlign: 'right', padding: '3px 6px' }}>${m.annual_cost_low_usd?.toLocaleString()}–${m.annual_cost_high_usd?.toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div style={{ marginTop: 8, fontSize: 10, color: '#9f1239' }}>{g.note}</div>
            </div>
          );
        })()}

        {/* Antenna Base Impedance & ATU Design Guide */}
        {candidate.antenna_base_impedance_and_atu_design_guide && (() => {
          const g = candidate.antenna_base_impedance_and_atu_design_guide;
          return (
            <div style={{ marginBottom: 18, padding: '14px 16px', background: '#fafaf0', borderRadius: 8, border: '1px solid #d4c84a' }}>
              <div style={{ fontWeight: 700, fontSize: 13, color: '#5c4a00', marginBottom: 8 }}>
                Antenna Base Impedance &amp; ATU Design — §73.190 / §73.62
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 24px', fontSize: 12, marginBottom: 10 }}>
                <div><span style={{ color: '#6b7280' }}>Frequency:</span> <strong>{g.frequency_khz} kHz (λ = {g.lambda_m} m)</strong></div>
                <div><span style={{ color: '#6b7280' }}>Tower height (λ/4):</span> <strong>{g.lambda_quarter_m} m</strong></div>
                <div><span style={{ color: '#6b7280' }}>Rr (radiation Ω):</span> <strong>{g.rr_ohm} Ω</strong></div>
                <div><span style={{ color: '#6b7280' }}>Rg (ground loss):</span> <strong>{g.rg_low_ohm}–{g.rg_high_ohm} Ω</strong></div>
                <div><span style={{ color: '#6b7280' }}>R_base (total):</span> <strong>{g.r_base_low_ohm}–{g.r_base_high_ohm} Ω (typ {g.r_base_typ_ohm} Ω)</strong></div>
                <div><span style={{ color: '#6b7280' }}>Feedline:</span> <strong>{g.feedline_impedance_ohm} Ω coax</strong></div>
                <div><span style={{ color: '#6b7280' }}>ATU type:</span> <strong>{g.atu_network_type}</strong></div>
                <div><span style={{ color: '#6b7280' }}>Networks:</span> <strong>{g.n_atu_networks}</strong></div>
                <div><span style={{ color: '#6b7280' }}>L (shunt):</span> <strong>{g.l_shunt_uh} μH (X = {g.xl_shunt_ohm} Ω)</strong></div>
                <div><span style={{ color: '#6b7280' }}>C (series):</span> <strong>{g.c_series_pf?.toLocaleString()} pF (X = {g.xc_series_ohm} Ω)</strong></div>
                <div><span style={{ color: '#6b7280' }}>Network Q:</span> <strong>{g.q_network}</strong></div>
                <div><span style={{ color: '#6b7280' }}>-3 dB BW:</span> <strong style={{ color: g.bw_adequate ? '#15803d' : '#dc2626' }}>{g.bw_3db_khz} kHz {g.bw_adequate ? '✓' : '⚠'}</strong></div>
                <div><span style={{ color: '#6b7280' }}>Antenna efficiency:</span> <strong>{g.antenna_efficiency_low_pct}–{g.antenna_efficiency_high_pct}% (typ {g.antenna_efficiency_typ_pct}%)</strong></div>
                <div><span style={{ color: '#6b7280' }}>Base current ({g.tpo_kw} kW):</span> <strong>{g.base_current_low_a}–{g.base_current_high_a} A (typ {g.base_current_typ_a} A)</strong></div>
                <div><span style={{ color: '#6b7280' }}>Detuning zone:</span> <strong>≤ {g.detuning_radius_m} m from tower (§73.190)</strong></div>
                <div><span style={{ color: '#6b7280' }}>Guy wire detuning:</span> <strong style={{ color: g.guy_wire_detuning_required ? '#b45309' : '#6b7280' }}>{g.guy_wire_detuning_required ? 'Required' : 'Not required'}</strong></div>
              </div>
              <div style={{ marginTop: 8, fontSize: 10, color: '#5c4a00' }}>{g.note}</div>
            </div>
          );
        })()}

        {/* Station Total Project Cost Pro Forma Guide */}
        {candidate.station_total_project_cost_pro_forma_guide && (() => {
          const g = candidate.station_total_project_cost_pro_forma_guide;
          return (
            <div style={{ marginBottom: 18, padding: '14px 16px', background: '#f0f9ff', borderRadius: 8, border: '1px solid #7dd3fc' }}>
              <div style={{ fontWeight: 700, fontSize: 13, color: '#0c4a6e', marginBottom: 8 }}>
                Station Relocation Pro Forma — Total Project Cost
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 24px', fontSize: 12, marginBottom: 10 }}>
                <div><span style={{ color: '#6b7280' }}>Total (low):</span> <strong>${g.total_project_low_usd?.toLocaleString()}</strong></div>
                <div><span style={{ color: '#6b7280' }}>Total (high):</span> <strong>${g.total_project_high_usd?.toLocaleString()}</strong></div>
                <div><span style={{ color: '#6b7280' }}>Typical estimate:</span> <strong style={{ color: '#0369a1' }}>${g.total_project_typ_usd?.toLocaleString()}</strong></div>
                <div><span style={{ color: '#6b7280' }}>Contingency:</span> <strong>{g.contingency_pct}%</strong></div>
                <div><span style={{ color: '#6b7280' }}>Timeline:</span> <strong>{g.total_timeline_months_low}–{g.total_timeline_months_high} months</strong></div>
                <div><span style={{ color: '#6b7280' }}>Tower height (λ/4):</span> <strong>{g.tower_height_m} m / {g.tower_height_ft} ft</strong></div>
                <div><span style={{ color: '#6b7280' }}>Radial system:</span> <strong>{g.n_radials} × {g.radial_length_m} m</strong></div>
                <div><span style={{ color: '#6b7280' }}>Cost categories:</span> <strong>{g.n_cost_categories}</strong></div>
              </div>
              {g.cost_categories && (
                <div>
                  <div style={{ fontWeight: 600, fontSize: 11, color: '#0c4a6e', marginBottom: 4 }}>Cost Breakdown by Category</div>
                  <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ background: '#bae6fd' }}>
                        <th style={{ textAlign: 'left', padding: '3px 6px' }}>Category</th>
                        <th style={{ textAlign: 'right', padding: '3px 6px' }}>Low</th>
                        <th style={{ textAlign: 'right', padding: '3px 6px' }}>High</th>
                      </tr>
                    </thead>
                    <tbody>
                      {g.cost_categories.map((cat, i) => (
                        <tr key={i} style={{ borderTop: '1px solid #7dd3fc' }}>
                          <td style={{ padding: '3px 6px' }}>{cat.category}</td>
                          <td style={{ textAlign: 'right', padding: '3px 6px' }}>${cat.low_usd?.toLocaleString()}</td>
                          <td style={{ textAlign: 'right', padding: '3px 6px' }}>${cat.high_usd?.toLocaleString()}</td>
                        </tr>
                      ))}
                      <tr style={{ borderTop: '2px solid #0369a1', fontWeight: 700, background: '#e0f2fe' }}>
                        <td style={{ padding: '3px 6px' }}>Subtotal (pre-contingency)</td>
                        <td style={{ textAlign: 'right', padding: '3px 6px' }}>${g.subtotal_low_usd?.toLocaleString()}</td>
                        <td style={{ textAlign: 'right', padding: '3px 6px' }}>${g.subtotal_high_usd?.toLocaleString()}</td>
                      </tr>
                      <tr style={{ borderTop: '1px solid #0369a1', fontWeight: 700, color: '#0c4a6e', background: '#bae6fd' }}>
                        <td style={{ padding: '3px 6px' }}>Total ({g.contingency_pct}% contingency)</td>
                        <td style={{ textAlign: 'right', padding: '3px 6px' }}>${g.total_project_low_usd?.toLocaleString()}</td>
                        <td style={{ textAlign: 'right', padding: '3px 6px' }}>${g.total_project_high_usd?.toLocaleString()}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}
              <div style={{ marginTop: 8, fontSize: 10, color: '#0c4a6e' }}>{g.note}</div>
            </div>
          );
        })()}

        {/* Transmitter Power Upgrade Pathway Guide */}
        {candidate.transmitter_power_upgrade_pathway_guide && (() => {
          const g = candidate.transmitter_power_upgrade_pathway_guide;
          return (
            <div style={{ marginBottom: 18, padding: '14px 16px', background: '#fff7ed', borderRadius: 8, border: '1px solid #fdba74' }}>
              <div style={{ fontWeight: 700, fontSize: 13, color: '#9a3412', marginBottom: 8 }}>
                Transmitter Power Upgrade Pathway — §73.21 / Form 301
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 24px', fontSize: 12, marginBottom: 10 }}>
                <div><span style={{ color: '#6b7280' }}>Current TPO:</span> <strong>{g.current_tpo_kw} kW ({g.pattern_mode})</strong></div>
                <div><span style={{ color: '#6b7280' }}>Day ceiling (§73.21):</span> <strong>{g.day_max_tpo_kw} kW</strong></div>
                <div><span style={{ color: '#6b7280' }}>Day headroom:</span> <strong style={{ color: g.day_headroom_kw > 0 ? '#15803d' : '#6b7280' }}>{g.day_headroom_kw} kW</strong></div>
                <div><span style={{ color: '#6b7280' }}>Night ceiling:</span> <strong>{g.night_max_tpo_kw} kW{g.night_upgrade_requires_da_n ? ' (DA-N req.)' : ''}</strong></div>
                <div><span style={{ color: '#6b7280' }}>Upgraded TPO:</span> <strong>{g.upgraded_tpo_kw} kW</strong></div>
                <div><span style={{ color: '#6b7280' }}>Coverage gain:</span> <strong style={{ color: '#15803d' }}>+{g.coverage_gain_pct}% radius (√ERP)</strong></div>
                <div><span style={{ color: '#6b7280' }}>CP filing fee:</span> <strong>${g.form301_fee_usd?.toLocaleString()} (Form 301)</strong></div>
                <div><span style={{ color: '#6b7280' }}>FCC processing:</span> <strong>{g.cp_processing_months_low}–{g.cp_processing_months_high} months</strong></div>
                <div><span style={{ color: '#6b7280' }}>Project cost range:</span> <strong>${g.total_project_low_usd?.toLocaleString()}–${g.total_project_high_usd?.toLocaleString()}</strong></div>
                <div><span style={{ color: '#6b7280' }}>Can upgrade day:</span> <strong style={{ color: g.can_upgrade_day_power ? '#15803d' : '#dc2626' }}>{g.can_upgrade_day_power ? 'Yes' : 'No — at ceiling'}</strong></div>
              </div>
              {g.upgrade_steps && (
                <div>
                  <div style={{ fontWeight: 600, fontSize: 11, color: '#9a3412', marginBottom: 4 }}>Power Upgrade Steps</div>
                  <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ background: '#fed7aa' }}>
                        <th style={{ textAlign: 'left', padding: '3px 6px' }}>#</th>
                        <th style={{ textAlign: 'left', padding: '3px 6px' }}>Action</th>
                        <th style={{ textAlign: 'right', padding: '3px 6px' }}>Cost</th>
                        <th style={{ textAlign: 'right', padding: '3px 6px' }}>Timeline</th>
                      </tr>
                    </thead>
                    <tbody>
                      {g.upgrade_steps.map((s, i) => (
                        <tr key={i} style={{ borderTop: '1px solid #fdba74' }}>
                          <td style={{ padding: '3px 6px', color: '#9a3412', fontWeight: 700 }}>{s.step}</td>
                          <td style={{ padding: '3px 6px' }}>{s.action}</td>
                          <td style={{ textAlign: 'right', padding: '3px 6px', whiteSpace: 'nowrap' }}>{s.cost_range_usd}</td>
                          <td style={{ textAlign: 'right', padding: '3px 6px', whiteSpace: 'nowrap' }}>{s.timeline}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div style={{ marginTop: 8, fontSize: 10, color: '#9a3412' }}>{g.note}</div>
            </div>
          );
        })()}

        {/* AM Coverage Optimization by Tower Height Guide */}
        {candidate.am_coverage_optimization_by_tower_height_guide && (() => {
          const g = candidate.am_coverage_optimization_by_tower_height_guide;
          const qtrMilestone = g.height_milestones?.find(m => m.elec_deg === 90);
          const optMilestone = g.height_milestones?.find(m => m.elec_deg === 225);
          return (
            <div style={{ marginBottom: 18, padding: '14px 16px', background: '#f0fdf4', borderRadius: 8, border: '1px solid #86efac' }}>
              <div style={{ fontWeight: 700, fontSize: 13, color: '#166534', marginBottom: 8 }}>
                AM Coverage vs Tower Height — §73.160 / ITU-R BS.346
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 24px', fontSize: 12, marginBottom: 10 }}>
                <div><span style={{ color: '#6b7280' }}>Wavelength (λ):</span> <strong>{g.wavelength_m} m @ {g.frequency_khz} kHz</strong></div>
                <div><span style={{ color: '#6b7280' }}>Current height (λ/4):</span> <strong>{g.current_height_m} m / {g.current_height_ft} ft</strong></div>
                <div><span style={{ color: '#6b7280' }}>Optimal height (5λ/8):</span> <strong>{g.optimal_height_m} m / {g.optimal_height_ft} ft</strong></div>
                <div><span style={{ color: '#6b7280' }}>Max field gain:</span> <strong>+{g.max_coverage_gain_pct}% vs λ/4</strong></div>
                <div><span style={{ color: '#6b7280' }}>Height increase needed:</span> <strong>{g.height_increase_m} m ({Math.round(g.height_increase_m * 3.28084)} ft)</strong></div>
                <div><span style={{ color: '#6b7280' }}>ASR required:</span> <strong style={{ color: g.asr_required ? '#dc2626' : '#16a34a' }}>{g.asr_required ? 'Yes (§17.7)' : 'No'}</strong></div>
              </div>
              {g.height_milestones && (
                <div>
                  <div style={{ fontWeight: 600, fontSize: 11, color: '#166534', marginBottom: 4 }}>Height Milestones vs Field Gain</div>
                  <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ background: '#bbf7d0' }}>
                        <th style={{ textAlign: 'left', padding: '3px 6px' }}>Height</th>
                        <th style={{ textAlign: 'right', padding: '3px 6px' }}>m / ft</th>
                        <th style={{ textAlign: 'right', padding: '3px 6px' }}>Rr (Ω)</th>
                        <th style={{ textAlign: 'right', padding: '3px 6px' }}>Field Gain</th>
                        <th style={{ textAlign: 'right', padding: '3px 6px' }}>Coverage +%</th>
                      </tr>
                    </thead>
                    <tbody>
                      {g.height_milestones.map((m, i) => (
                        <tr key={i} style={{ borderTop: '1px solid #86efac', background: m.elec_deg === 90 ? '#dcfce7' : m.elec_deg === 225 ? '#f0fdf4' : 'transparent' }}>
                          <td style={{ padding: '3px 6px', fontWeight: m.elec_deg === 90 ? 700 : 400 }}>{m.label}</td>
                          <td style={{ textAlign: 'right', padding: '3px 6px' }}>{m.height_m} / {m.height_ft}</td>
                          <td style={{ textAlign: 'right', padding: '3px 6px' }}>{m.rr_ohm}</td>
                          <td style={{ textAlign: 'right', padding: '3px 6px' }}>×{m.field_gain_rel.toFixed(2)}</td>
                          <td style={{ textAlign: 'right', padding: '3px 6px' }}>{m.elec_deg === 90 ? '—' : `+${Math.round((m.field_gain_rel - 1) * 100)}%`}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div style={{ marginTop: 8, fontSize: 10, color: '#166534' }}>{g.note}</div>
            </div>
          );
        })()}

        {/* Spectrum Monitoring and Frequency Drift Guide */}
        {candidate.spectrum_monitoring_and_frequency_drift_guide && (() => {
          const g = candidate.spectrum_monitoring_and_frequency_drift_guide;
          const modern = g.transmitter_types?.find(t => t.type === 'MODERN_PLL');
          return (
            <div style={{ marginBottom: 18, padding: '14px 16px', background: '#f0f4ff', borderRadius: 8, border: '1px solid #c7d2fe' }}>
              <div style={{ fontWeight: 700, fontSize: 13, color: '#3730a3', marginBottom: 8 }}>
                Spectrum Monitoring &amp; Frequency Drift — §73.1215
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 24px', fontSize: 12, marginBottom: 10 }}>
                <div><span style={{ color: '#6b7280' }}>Assigned frequency:</span> <strong>{g.freq_hz?.toLocaleString()} Hz ({g.frequency_khz} kHz)</strong></div>
                <div><span style={{ color: '#6b7280' }}>Tolerance (§73.1215):</span> <strong>±{g.tolerance_hz} Hz ({g.tolerance_ppm} ppm)</strong></div>
                <div><span style={{ color: '#6b7280' }}>Lower limit:</span> <strong>{g.lower_limit_hz?.toLocaleString()} Hz</strong></div>
                <div><span style={{ color: '#6b7280' }}>Upper limit:</span> <strong>{g.upper_limit_hz?.toLocaleString()} Hz</strong></div>
                <div><span style={{ color: '#6b7280' }}>Required methods:</span> <strong>{g.n_required_methods} of {g.n_monitoring_methods}</strong></div>
                <div><span style={{ color: '#6b7280' }}>Correction steps:</span> <strong>{g.n_correction_steps}</strong></div>
                {modern && <div><span style={{ color: '#6b7280' }}>Modern PLL drift typ:</span> <strong>±{modern.drift_typ_hz} Hz</strong></div>}
                <div><span style={{ color: '#6b7280' }}>Post-relocation check:</span> <strong>Every {g.monitor_check_interval_days} days</strong></div>
              </div>
              {g.monitoring_options && (
                <div style={{ marginBottom: 8 }}>
                  <div style={{ fontWeight: 600, fontSize: 11, color: '#4338ca', marginBottom: 4 }}>Monitoring Options</div>
                  <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ background: '#e0e7ff' }}>
                        <th style={{ textAlign: 'left', padding: '3px 6px' }}>Method</th>
                        <th style={{ textAlign: 'center', padding: '3px 6px' }}>Accuracy</th>
                        <th style={{ textAlign: 'right', padding: '3px 6px' }}>Cost</th>
                        <th style={{ textAlign: 'center', padding: '3px 6px' }}>Required</th>
                      </tr>
                    </thead>
                    <tbody>
                      {g.monitoring_options.map((m, i) => (
                        <tr key={i} style={{ borderTop: '1px solid #c7d2fe', background: m.required ? '#eef2ff' : 'transparent' }}>
                          <td style={{ padding: '3px 6px' }}>{m.label}</td>
                          <td style={{ textAlign: 'center', padding: '3px 6px' }}>±{m.accuracy_hz} Hz</td>
                          <td style={{ textAlign: 'right', padding: '3px 6px' }}>${m.cost_usd?.toLocaleString()}</td>
                          <td style={{ textAlign: 'center', padding: '3px 6px' }}>{m.required ? '✓' : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {g.transmitter_types && (
                <div>
                  <div style={{ fontWeight: 600, fontSize: 11, color: '#4338ca', marginBottom: 4 }}>Transmitter Frequency Stability by Type</div>
                  {g.transmitter_types.map((t, i) => (
                    <div key={i} style={{ fontSize: 11, padding: '2px 0', borderTop: i > 0 ? '1px solid #c7d2fe' : 'none' }}>
                      <span style={{ fontWeight: 600 }}>{t.label}:</span> ±{t.drift_typ_hz} Hz typ / ±{t.drift_max_hz} Hz max ({t.margin_pct}% margin)
                    </div>
                  ))}
                </div>
              )}
              <div style={{ marginTop: 8, fontSize: 10, color: '#6366f1' }}>{g.note}</div>
            </div>
          );
        })()}

        {/* Broadcast Attorney and Consulting Guide */}
        {candidate.broadcast_attorney_and_consulting_guide && (() => {
          const g = candidate.broadcast_attorney_and_consulting_guide;
          const typCost = g.combined_total_usd?.typical;
          const lowCost = g.combined_total_usd?.low;
          const highCost = g.combined_total_usd?.high;
          const attorneys = (g.professional_services || []).filter(s => s.type === 'ATTORNEY');
          const engineers = (g.professional_services || []).filter(s => s.type === 'ENGINEER');
          return (
            <div style={{ background: '#1e293b', borderRadius: 8, padding: 16, marginBottom: 16 }}>
              <div style={{ fontWeight: 600, color: '#f1f5f9', marginBottom: 8, fontSize: 14 }}>
                ⚖️ Professional Fees: FCC Attorney + Engineering
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
                <div style={{ background: '#0f172a', borderRadius: 6, padding: 10 }}>
                  <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 2 }}>Attorney Fees</div>
                  <div style={{ fontWeight: 700, color: '#f1f5f9', fontSize: 15 }}>${(g.attorney_total_typ_usd || 0).toLocaleString()}</div>
                  <div style={{ fontSize: 10, color: '#64748b' }}>CP + LTC + NHPA</div>
                </div>
                <div style={{ background: '#0f172a', borderRadius: 6, padding: 10 }}>
                  <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 2 }}>Engineering Fees</div>
                  <div style={{ fontWeight: 700, color: '#f1f5f9', fontSize: 15 }}>${(g.engineering_total_typ_usd || 0).toLocaleString()}</div>
                  <div style={{ fontSize: 10, color: '#64748b' }}>{g.is_da ? 'DA proof included' : 'NDA proof included'}</div>
                </div>
                <div style={{ background: '#0f172a', borderRadius: 6, padding: 10 }}>
                  <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 2 }}>Combined Total</div>
                  <div style={{ fontWeight: 700, color: '#f97316', fontSize: 15 }}>${(typCost || 0).toLocaleString()}</div>
                  <div style={{ fontSize: 10, color: '#64748b' }}>${(lowCost || 0).toLocaleString()}–${(highCost || 0).toLocaleString()}</div>
                </div>
                <div style={{ background: '#0f172a', borderRadius: 6, padding: 10 }}>
                  <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 2 }}>Services</div>
                  <div style={{ fontWeight: 700, color: '#f1f5f9', fontSize: 15 }}>{g.n_required_services} req'd</div>
                  <div style={{ fontSize: 10, color: '#64748b' }}>{g.n_professional_services} total</div>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
                <div>
                  <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4, fontWeight: 600 }}>Attorney Services</div>
                  {attorneys.map((s, i) => (
                    <div key={i} style={{ background: '#0f172a', borderRadius: 4, padding: 6, marginBottom: 3 }}>
                      <div style={{ fontSize: 10, color: s.required ? '#f1f5f9' : '#64748b' }}>{s.label}</div>
                      <div style={{ fontSize: 10, color: '#60a5fa' }}>${s.typical_cost_usd.toLocaleString()}</div>
                    </div>
                  ))}
                </div>
                <div>
                  <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4, fontWeight: 600 }}>Engineering Services</div>
                  {engineers.map((s, i) => (
                    <div key={i} style={{ background: '#0f172a', borderRadius: 4, padding: 6, marginBottom: 3 }}>
                      <div style={{ fontSize: 10, color: s.required ? '#f1f5f9' : '#64748b' }}>{s.label}</div>
                      <div style={{ fontSize: 10, color: '#60a5fa' }}>${s.typical_cost_usd.toLocaleString()}</div>
                    </div>
                  ))}
                </div>
              </div>
              <div style={{ fontSize: 10, color: '#64748b', marginTop: 8 }}>{g.note}</div>
            </div>
          );
        })()}

        {/* Zoning and Land Use Compliance Guide */}
        {candidate.zoning_and_land_use_compliance_guide && (() => {
          const g = candidate.zoning_and_land_use_compliance_guide;
          return (
            <div style={{ background: '#1e293b', borderRadius: 8, padding: 16, marginBottom: 16 }}>
              <div style={{ fontWeight: 600, color: '#f1f5f9', marginBottom: 8, fontSize: 14 }}>
                🏛️ Zoning & Land Use Compliance (§1.1307 / NHPA §106)
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
                <div style={{ background: '#0f172a', borderRadius: 6, padding: 10 }}>
                  <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 2 }}>Required Setback</div>
                  <div style={{ fontWeight: 700, color: '#f97316', fontSize: 15 }}>{g.setback_ft_required} ft</div>
                  <div style={{ fontSize: 10, color: '#64748b' }}>{g.setback_m_required}m (1:1 fall zone)</div>
                </div>
                <div style={{ background: '#0f172a', borderRadius: 6, padding: 10 }}>
                  <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 2 }}>Permit Timeline (Rural)</div>
                  <div style={{ fontWeight: 700, color: '#f1f5f9', fontSize: 15 }}>{g.permit_weeks_low_rural}–{g.permit_weeks_high_rural} wks</div>
                  <div style={{ fontSize: 10, color: '#ef4444' }}>Residential: {g.permit_weeks_low_residential}–{g.permit_weeks_high_residential} wks</div>
                </div>
                <div style={{ background: '#0f172a', borderRadius: 6, padding: 10 }}>
                  <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 2 }}>TCA §332 Preemption</div>
                  <div style={{ fontWeight: 700, color: '#ef4444', fontSize: 13 }}>{g.tca_preemption_applies ? 'APPLIES' : 'DOES NOT APPLY'}</div>
                  <div style={{ fontSize: 10, color: '#64748b' }}>AM towers not covered</div>
                </div>
                <div style={{ background: '#0f172a', borderRadius: 6, padding: 10 }}>
                  <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 2 }}>NHPA §106 / Tribal</div>
                  <div style={{ fontWeight: 700, color: '#ef4444', fontSize: 13 }}>REQUIRED</div>
                  <div style={{ fontSize: 10, color: '#64748b' }}>30-day TCNS comment</div>
                </div>
              </div>
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 6, fontWeight: 600 }}>Federal Environmental Review Triggers ({g.n_environmental_triggers})</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  {(g.environmental_review_triggers || []).map((t, i) => (
                    <div key={i} style={{ background: '#0f172a', borderRadius: 4, padding: 7 }}>
                      <div style={{ fontSize: 11, color: '#f1f5f9', fontWeight: 600 }}>{t.label}</div>
                      <div style={{ fontSize: 10, color: '#64748b' }}>{t.cfr}</div>
                    </div>
                  ))}
                </div>
              </div>
              <div style={{ background: '#1c1917', borderRadius: 6, padding: 10, marginBottom: 8, borderLeft: '3px solid #f97316' }}>
                <div style={{ fontSize: 11, color: '#f97316', fontWeight: 600, marginBottom: 4 }}>Preferred Site: {g.preferred_zoning_type} Zone</div>
                <div style={{ fontSize: 10, color: '#94a3b8' }}>Agricultural and industrial zones have lowest zoning burden. Residential zones require variance and carry highest opposition risk. {g.n_required_local_permits} local permits required (building permit + use permit).</div>
              </div>
              <div style={{ fontSize: 10, color: '#64748b', marginTop: 8 }}>{g.note}</div>
            </div>
          );
        })()}

        {/* FAA Obstruction Marking Guide */}
        {candidate.faa_obstruction_marking_guide && (() => {
          const g = candidate.faa_obstruction_marking_guide;
          const tierColor = g.faa_lighting_tier === 'NONE' ? '#22c55e' : g.faa_lighting_tier === 'L-810_RED_STEADY' ? '#eab308' : g.faa_lighting_tier === 'L-864_MED_RED_FLASH' ? '#f97316' : '#ef4444';
          return (
            <div style={{ background: '#1e293b', borderRadius: 8, padding: 16, marginBottom: 16 }}>
              <div style={{ fontWeight: 600, color: '#f1f5f9', marginBottom: 8, fontSize: 14 }}>
                🔴 FAA Obstruction Marking (§17.23 / §17.47 / AC 70/7460-1M)
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
                <div style={{ background: '#0f172a', borderRadius: 6, padding: 10 }}>
                  <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 2 }}>Tower Height</div>
                  <div style={{ fontWeight: 700, color: '#f1f5f9', fontSize: 15 }}>{g.tower_height_ft} ft</div>
                  <div style={{ fontSize: 10, color: '#64748b' }}>{g.tower_height_m}m (λ/4)</div>
                </div>
                <div style={{ background: '#0f172a', borderRadius: 6, padding: 10 }}>
                  <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 2 }}>FAA Lighting Tier</div>
                  <div style={{ fontWeight: 700, color: tierColor, fontSize: 13 }}>{g.faa_lighting_tier}</div>
                  <div style={{ fontSize: 10, color: '#64748b' }}>AC 70/7460-1M</div>
                </div>
                <div style={{ background: '#0f172a', borderRadius: 6, padding: 10 }}>
                  <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 2 }}>ASR Required</div>
                  <div style={{ fontWeight: 700, color: g.asr_required_by_height ? '#ef4444' : '#22c55e', fontSize: 15 }}>{g.asr_required_by_height ? 'YES (§17.7)' : 'Not by height'}</div>
                  <div style={{ fontSize: 10, color: '#64748b' }}>Threshold: {g.asr_height_threshold_ft}ft</div>
                </div>
                <div style={{ background: '#0f172a', borderRadius: 6, padding: 10 }}>
                  <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 2 }}>Total Marking Cost</div>
                  <div style={{ fontWeight: 700, color: '#f97316', fontSize: 15 }}>${(g.total_marking_cost_usd || 0).toLocaleString()}</div>
                  <div style={{ fontSize: 10, color: '#64748b' }}>paint + lighting</div>
                </div>
              </div>
              {g.painting_required && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 8 }}>
                  <div style={{ background: '#0f172a', borderRadius: 4, padding: 8 }}>
                    <div style={{ fontSize: 10, color: '#94a3b8' }}>Paint Bands (§17.23)</div>
                    <div style={{ fontWeight: 600, color: '#f1f5f9' }}>{g.n_paint_bands} bands — orange + white</div>
                    <div style={{ fontSize: 10, color: '#64748b' }}>${(g.painting_cost_usd || 0).toLocaleString()}</div>
                  </div>
                  <div style={{ background: '#0f172a', borderRadius: 4, padding: 8 }}>
                    <div style={{ fontSize: 10, color: '#94a3b8' }}>Lighting (§17.47)</div>
                    <div style={{ fontWeight: 600, color: '#f1f5f9' }}>{g.monitoring_required ? 'Auto-monitor required' : 'Not required'}</div>
                    <div style={{ fontSize: 10, color: '#64748b' }}>${(g.lighting_cost_usd || 0).toLocaleString()}</div>
                  </div>
                </div>
              )}
              {g.rf_decoupling_required && (
                <div style={{ background: '#1c1917', borderRadius: 6, padding: 10, marginBottom: 8, borderLeft: '3px solid #f97316' }}>
                  <div style={{ fontSize: 11, color: '#f97316', fontWeight: 600, marginBottom: 4 }}>RF Decoupling Required</div>
                  <div style={{ fontSize: 10, color: '#94a3b8' }}>Lighting cables must be RF-decoupled (choke coil) to prevent lighting conductor current from affecting antenna base impedance and ground system.</div>
                </div>
              )}
              <div style={{ fontSize: 10, color: '#64748b', marginTop: 8 }}>{g.note}</div>
            </div>
          );
        })()}

        {/* Antenna Tuning Unit Commissioning Guide */}
        {candidate.antenna_tuning_unit_commissioning_guide && (() => {
          const g = candidate.antenna_tuning_unit_commissioning_guide;
          const typCost = g.total_atu_cost_usd?.typical;
          const lowCost = g.total_atu_cost_usd?.low;
          const highCost = g.total_atu_cost_usd?.high;
          return (
            <div style={{ background: '#1e293b', borderRadius: 8, padding: 16, marginBottom: 16 }}>
              <div style={{ fontWeight: 600, color: '#f1f5f9', marginBottom: 8, fontSize: 14 }}>
                ⚡ ATU Commissioning Guide (§73.155 / §73.61)
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
                <div style={{ background: '#0f172a', borderRadius: 6, padding: 10 }}>
                  <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 2 }}>Base Impedance</div>
                  <div style={{ fontWeight: 700, color: '#f1f5f9', fontSize: 15 }}>{g.base_resistance_ohm_typical}Ω + j0</div>
                  <div style={{ fontSize: 10, color: '#64748b' }}>λ/4={g.lambda_quarter_m}m vertical</div>
                </div>
                <div style={{ background: '#0f172a', borderRadius: 6, padding: 10 }}>
                  <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 2 }}>Base Current</div>
                  <div style={{ fontWeight: 700, color: '#f97316', fontSize: 15 }}>{g.base_current_rms_a}A rms</div>
                  <div style={{ fontSize: 10, color: '#64748b' }}>at {g.tpo_kw} kW TPO</div>
                </div>
                <div style={{ background: '#0f172a', borderRadius: 6, padding: 10 }}>
                  <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 2 }}>Antenna Efficiency</div>
                  <div style={{ fontWeight: 700, color: g.antenna_efficiency_pct >= 90 ? '#22c55e' : '#eab308', fontSize: 15 }}>{g.antenna_efficiency_pct}%</div>
                  <div style={{ fontSize: 10, color: '#64748b' }}>120-radial ground system</div>
                </div>
                <div style={{ background: '#0f172a', borderRadius: 6, padding: 10 }}>
                  <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 2 }}>ATU Cost</div>
                  <div style={{ fontWeight: 700, color: '#f1f5f9', fontSize: 15 }}>${(typCost || 0).toLocaleString()}</div>
                  <div style={{ fontSize: 10, color: '#64748b' }}>${(lowCost || 0).toLocaleString()}–${(highCost || 0).toLocaleString()}</div>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6, marginBottom: 8 }}>
                <div style={{ background: '#0f172a', borderRadius: 4, padding: 8, textAlign: 'center' }}>
                  <div style={{ fontSize: 10, color: '#94a3b8' }}>Current Tolerance</div>
                  <div style={{ fontWeight: 600, color: '#f1f5f9' }}>±{g.current_tolerance_pct}%</div>
                  <div style={{ fontSize: 9, color: '#64748b' }}>§73.155(a)</div>
                </div>
                <div style={{ background: '#0f172a', borderRadius: 4, padding: 8, textAlign: 'center' }}>
                  <div style={{ fontSize: 10, color: '#94a3b8' }}>Phase Tolerance</div>
                  <div style={{ fontWeight: 600, color: '#f1f5f9' }}>{g.phase_tolerance_deg != null ? `±${g.phase_tolerance_deg}°` : 'N/A (NDA)'}</div>
                  <div style={{ fontSize: 9, color: '#64748b' }}>§73.155(d)</div>
                </div>
                <div style={{ background: '#0f172a', borderRadius: 4, padding: 8, textAlign: 'center' }}>
                  <div style={{ fontSize: 10, color: '#94a3b8' }}>Commission Days</div>
                  <div style={{ fontWeight: 600, color: '#f1f5f9' }}>{g.commissioning_days_low}–{g.commissioning_days_high}</div>
                  <div style={{ fontSize: 9, color: '#64748b' }}>{g.n_commissioning_steps} steps</div>
                </div>
              </div>
              {g.is_da && (
                <div style={{ background: '#1c1917', borderRadius: 6, padding: 10, marginBottom: 8, borderLeft: '3px solid #f97316' }}>
                  <div style={{ fontSize: 11, color: '#f97316', fontWeight: 600, marginBottom: 4 }}>DA Array: Phasor System Required</div>
                  <div style={{ fontSize: 10, color: '#94a3b8' }}>Phasor cost: ${(g.phasor_cost_usd || 0).toLocaleString()} · Ratio ±{g.ratio_tolerance_pct}% · Phase ±{g.phase_tolerance_deg}° (§73.155(d))</div>
                </div>
              )}
              <div style={{ fontSize: 10, color: '#64748b', marginTop: 8 }}>{g.note}</div>
            </div>
          );
        })()}

        {/* Tower Construction Contract Guide */}
        {candidate.tower_construction_contract_guide && (() => {
          const g = candidate.tower_construction_contract_guide;
          const typCost = g.total_estimated_cost_usd?.typical;
          const lowCost = g.total_estimated_cost_usd?.low;
          const highCost = g.total_estimated_cost_usd?.high;
          return (
            <div style={{ background: '#1e293b', borderRadius: 8, padding: 16, marginBottom: 16 }}>
              <div style={{ fontWeight: 600, color: '#f1f5f9', marginBottom: 8, fontSize: 14 }}>
                🏗️ Tower Construction Contract Guide
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
                <div style={{ background: '#0f172a', borderRadius: 6, padding: 10 }}>
                  <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 2 }}>Tower Height</div>
                  <div style={{ fontWeight: 700, color: '#f1f5f9', fontSize: 15 }}>{g.tower_height_ft} ft</div>
                  <div style={{ fontSize: 10, color: '#64748b' }}>{g.tower_height_m}m (λ/4)</div>
                </div>
                <div style={{ background: '#0f172a', borderRadius: 6, padding: 10 }}>
                  <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 2 }}>Est. Construction Cost</div>
                  <div style={{ fontWeight: 700, color: '#f97316', fontSize: 15 }}>${(typCost || 0).toLocaleString()}</div>
                  <div style={{ fontSize: 10, color: '#64748b' }}>${(lowCost || 0).toLocaleString()}–${(highCost || 0).toLocaleString()}</div>
                </div>
                <div style={{ background: '#0f172a', borderRadius: 6, padding: 10 }}>
                  <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 2 }}>Construction Timeline</div>
                  <div style={{ fontWeight: 700, color: '#f1f5f9', fontSize: 15 }}>{g.timeline_weeks_low}–{g.timeline_weeks_high} wks</div>
                  <div style={{ fontSize: 10, color: '#64748b' }}>typ. {g.timeline_weeks_typ} weeks</div>
                </div>
                <div style={{ background: '#0f172a', borderRadius: 6, padding: 10 }}>
                  <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 2 }}>Contract Clauses</div>
                  <div style={{ fontWeight: 700, color: '#f1f5f9', fontSize: 15 }}>{g.n_required_clauses} required</div>
                  <div style={{ fontSize: 10, color: '#64748b' }}>{g.n_key_contract_clauses} total clauses</div>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6, marginBottom: 8 }}>
                <div style={{ background: '#0f172a', borderRadius: 4, padding: 8, textAlign: 'center' }}>
                  <div style={{ fontSize: 10, color: '#94a3b8' }}>Foundation</div>
                  <div style={{ fontWeight: 600, color: '#f1f5f9' }}>${(g.per_tower_foundation_cost_usd || 0).toLocaleString()}</div>
                </div>
                <div style={{ background: '#0f172a', borderRadius: 4, padding: 8, textAlign: 'center' }}>
                  <div style={{ fontSize: 10, color: '#94a3b8' }}>Erection</div>
                  <div style={{ fontWeight: 600, color: '#f1f5f9' }}>${(g.per_tower_erection_cost_usd || 0).toLocaleString()}</div>
                </div>
                <div style={{ background: '#0f172a', borderRadius: 4, padding: 8, textAlign: 'center' }}>
                  <div style={{ fontSize: 10, color: '#94a3b8' }}>ATU Building</div>
                  <div style={{ fontWeight: 600, color: '#f1f5f9' }}>${(g.per_tower_atu_building_cost_usd || 0).toLocaleString()}</div>
                </div>
              </div>
              <div style={{ fontSize: 10, color: '#f97316', marginBottom: 6 }}>* Excludes ground radial system and proof-of-performance engineering</div>
              <div style={{ fontSize: 10, color: '#64748b' }}>{g.note}</div>
            </div>
          );
        })()}

        {/* Ground Radial Installation Cost Guide */}
        {candidate.ground_radial_installation_cost_guide && (() => {
          const g = candidate.ground_radial_installation_cost_guide;
          const typCost = g.total_estimated_cost_usd?.typical;
          const lowCost = g.total_estimated_cost_usd?.low;
          const highCost = g.total_estimated_cost_usd?.high;
          return (
            <div style={{ background: '#1e293b', borderRadius: 8, padding: 16, marginBottom: 16 }}>
              <div style={{ fontWeight: 600, color: '#f1f5f9', marginBottom: 8, fontSize: 14 }}>
                🔌 Ground Radial Installation Cost (§73.190)
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
                <div style={{ background: '#0f172a', borderRadius: 6, padding: 10 }}>
                  <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 2 }}>Radial System</div>
                  <div style={{ fontWeight: 700, color: '#f1f5f9', fontSize: 15 }}>{g.n_radials} × {g.radial_length_m}m</div>
                  <div style={{ fontSize: 10, color: '#64748b' }}>{(g.total_wire_length_m || 0).toLocaleString()}m total wire</div>
                </div>
                <div style={{ background: '#0f172a', borderRadius: 6, padding: 10 }}>
                  <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 2 }}>Estimated Total Cost</div>
                  <div style={{ fontWeight: 700, color: '#f97316', fontSize: 15 }}>${(typCost || 0).toLocaleString()}</div>
                  <div style={{ fontSize: 10, color: '#64748b' }}>${(lowCost || 0).toLocaleString()}–${(highCost || 0).toLocaleString()}</div>
                </div>
                <div style={{ background: '#0f172a', borderRadius: 6, padding: 10 }}>
                  <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 2 }}>λ/4 Radial Length</div>
                  <div style={{ fontWeight: 700, color: '#f1f5f9', fontSize: 15 }}>{g.lambda_quarter_m}m</div>
                  <div style={{ fontSize: 10, color: '#64748b' }}>λ/2 = {g.lambda_half_m}m</div>
                </div>
                <div style={{ background: '#0f172a', borderRadius: 6, padding: 10 }}>
                  <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 2 }}>Half-Wave Upgrade</div>
                  <div style={{ fontWeight: 700, color: '#64748b', fontSize: 15 }}>+${(g.half_wave_upgrade_cost_usd || 0).toLocaleString()}</div>
                  <div style={{ fontSize: 10, color: '#64748b' }}>extends to λ/2 radials</div>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6, marginBottom: 8 }}>
                <div style={{ background: '#0f172a', borderRadius: 4, padding: 8, textAlign: 'center' }}>
                  <div style={{ fontSize: 10, color: '#94a3b8' }}>Copper Wire</div>
                  <div style={{ fontWeight: 600, color: '#f1f5f9' }}>${(g.per_tower_wire_cost_usd || 0).toLocaleString()}</div>
                </div>
                <div style={{ background: '#0f172a', borderRadius: 4, padding: 8, textAlign: 'center' }}>
                  <div style={{ fontSize: 10, color: '#94a3b8' }}>Trenching</div>
                  <div style={{ fontWeight: 600, color: '#f1f5f9' }}>${(g.per_tower_trench_cost_usd || 0).toLocaleString()}</div>
                </div>
                <div style={{ background: '#0f172a', borderRadius: 4, padding: 8, textAlign: 'center' }}>
                  <div style={{ fontSize: 10, color: '#94a3b8' }}>Fixed Costs</div>
                  <div style={{ fontWeight: 600, color: '#f1f5f9' }}>${(g.per_tower_fixed_cost_usd || 0).toLocaleString()}</div>
                </div>
              </div>
              <div style={{ fontSize: 10, color: '#64748b', marginTop: 8 }}>{g.note}</div>
            </div>
          );
        })()}

        {/* Frequency Coordination With Adjacent Stations Guide */}
        {candidate.frequency_coordination_with_adjacent_stations_guide && (() => {
          const g = candidate.frequency_coordination_with_adjacent_stations_guide;
          const chanColor = g.channel_type === 'CLEAR' ? '#ef4444' : g.channel_type === 'REGIONAL' ? '#f97316' : '#eab308';
          return (
            <div style={{ background: '#1e293b', borderRadius: 8, padding: 16, marginBottom: 16 }}>
              <div style={{ fontWeight: 600, color: '#f1f5f9', marginBottom: 8, fontSize: 14 }}>
                📻 Frequency Coordination — Adjacent Stations (§73.182 / §73.207)
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
                <div style={{ background: '#0f172a', borderRadius: 6, padding: 10 }}>
                  <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 2 }}>Channel Type</div>
                  <div style={{ fontWeight: 700, color: chanColor, fontSize: 15 }}>{g.channel_type}</div>
                  <div style={{ fontSize: 10, color: '#64748b' }}>{g.frequency_khz} kHz</div>
                </div>
                <div style={{ background: '#0f172a', borderRadius: 6, padding: 10 }}>
                  <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 2 }}>Secondary Status</div>
                  <div style={{ fontWeight: 700, color: g.is_secondary_on_clear ? '#f97316' : '#22c55e', fontSize: 15 }}>{g.is_secondary_on_clear ? 'SECONDARY on Clear' : 'Not Secondary'}</div>
                  <div style={{ fontSize: 10, color: '#64748b' }}>Class {g.fcc_class}</div>
                </div>
                <div style={{ background: '#0f172a', borderRadius: 6, padding: 10 }}>
                  <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 2 }}>Co-Channel D/U</div>
                  <div style={{ fontWeight: 700, color: '#f1f5f9', fontSize: 15 }}>≥{g.co_channel_du_ratio_db} dB</div>
                  <div style={{ fontSize: 10, color: '#64748b' }}>§73.182</div>
                </div>
                <div style={{ background: '#0f172a', borderRadius: 6, padding: 10 }}>
                  <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 2 }}>1st Adjacent D/U</div>
                  <div style={{ fontWeight: 700, color: '#f1f5f9', fontSize: 15 }}>≥{g.first_adj_du_ratio_db} dB</div>
                  <div style={{ fontSize: 10, color: '#64748b' }}>§73.207</div>
                </div>
              </div>
              {g.du_protection_ratios && (
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 6, fontWeight: 600 }}>D/U Protection Ratios</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
                    {g.du_protection_ratios.map((r, i) => (
                      <div key={i} style={{ background: '#0f172a', borderRadius: 4, padding: 8 }}>
                        <div style={{ fontSize: 11, color: '#f1f5f9' }}>{r.label}</div>
                        <div style={{ fontWeight: 700, color: '#60a5fa' }}>≥{r.du_ratio_db} dB ({r.field_ratio}:1)</div>
                        <div style={{ fontSize: 10, color: '#64748b' }}>±{r.offset_khz} kHz · {r.cfr}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {g.is_secondary_on_clear && (
                <div style={{ background: '#1c1917', borderRadius: 6, padding: 10, marginBottom: 8, borderLeft: '3px solid #ef4444' }}>
                  <div style={{ fontSize: 11, color: '#ef4444', fontWeight: 600, marginBottom: 4 }}>Secondary Status — Clear Channel Constraints</div>
                  <div style={{ fontSize: 10, color: '#94a3b8' }}>Class D on {g.frequency_khz} kHz (clear channel) — must not increase nighttime interference to Class A dominant station. Skywave analysis required for any CP filing.</div>
                </div>
              )}
              <div style={{ fontSize: 10, color: '#64748b', marginTop: 8 }}>{g.note}</div>
            </div>
          );
        })()}

        {/* Remote Control Authority Guide */}
        {candidate.remote_control_authority_guide && (() => {
          const g = candidate.remote_control_authority_guide;
          return (
            <div style={{ background: '#1e293b', borderRadius: 8, padding: 16, marginBottom: 16 }}>
              <div style={{ fontWeight: 600, color: '#f1f5f9', marginBottom: 8, fontSize: 14 }}>
                🎛️ Remote Control Authority (§73.1350 / §73.1400)
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
                <div style={{ background: '#0f172a', borderRadius: 6, padding: 10 }}>
                  <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 2 }}>Remote Control</div>
                  <div style={{ fontWeight: 700, color: '#22c55e', fontSize: 15 }}>{g.remote_control_authorized ? 'AUTHORIZED' : 'N/A'}</div>
                  <div style={{ fontSize: 10, color: '#64748b' }}>§73.1350</div>
                </div>
                <div style={{ background: '#0f172a', borderRadius: 6, padding: 10 }}>
                  <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 2 }}>Unattended (ATS)</div>
                  <div style={{ fontWeight: 700, color: '#22c55e', fontSize: 15 }}>{g.ats_authorized ? 'AUTHORIZED' : 'N/A'}</div>
                  <div style={{ fontSize: 10, color: '#64748b' }}>§73.1400</div>
                </div>
                <div style={{ background: '#0f172a', borderRadius: 6, padding: 10 }}>
                  <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 2 }}>Required Components</div>
                  <div style={{ fontWeight: 700, color: '#f1f5f9', fontSize: 15 }}>{g.n_required_components} of {g.n_rc_components}</div>
                  <div style={{ fontSize: 10, color: '#64748b' }}>${(g.required_equipment_cost_usd || 0).toLocaleString()} est.</div>
                </div>
                <div style={{ background: '#0f172a', borderRadius: 6, padding: 10 }}>
                  <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 2 }}>Freq. Tolerance</div>
                  <div style={{ fontWeight: 700, color: '#f1f5f9', fontSize: 15 }}>±{g.frequency_tolerance_hz} Hz</div>
                  <div style={{ fontSize: 10, color: '#64748b' }}>§73.1215</div>
                </div>
              </div>
              {g.rc_components && (
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 6, fontWeight: 600 }}>RC System Components</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                    {g.rc_components.map((comp, i) => (
                      <div key={i} style={{ background: '#0f172a', borderRadius: 4, padding: 7, display: 'flex', gap: 8, alignItems: 'center' }}>
                        <span style={{ color: comp.required ? '#ef4444' : '#94a3b8', fontSize: 10, minWidth: 52 }}>{comp.required ? 'REQUIRED' : 'Optional'}</span>
                        <div>
                          <div style={{ fontSize: 11, color: '#f1f5f9' }}>{comp.label}</div>
                          <div style={{ fontSize: 10, color: '#64748b' }}>${(comp.typical_cost_usd || 0).toLocaleString()} · {comp.cfr}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {g.da_phasor_monitoring && (
                <div style={{ background: '#1c1917', borderRadius: 6, padding: 10, marginBottom: 8, borderLeft: '3px solid #f97316' }}>
                  <div style={{ fontSize: 11, color: '#f97316', fontWeight: 600, marginBottom: 4 }}>DA Phasor Monitoring Required</div>
                  <div style={{ fontSize: 10, color: '#94a3b8' }}>{g.da_phasor_monitoring.note}</div>
                </div>
              )}
              <div style={{ fontSize: 10, color: '#64748b', marginTop: 8 }}>{g.note}</div>
            </div>
          );
        })()}

        {/* FCC Silent Station Authorization Guide */}
        {candidate.fcc_silent_station_authorization_guide && (() => {
          const g = candidate.fcc_silent_station_authorization_guide;
          return (
            <div style={{ background: '#1e293b', borderRadius: 8, padding: 16, marginBottom: 16 }}>
              <div style={{ fontWeight: 600, color: '#f1f5f9', marginBottom: 8, fontSize: 14 }}>
                🔇 Silent Station Authorization (§73.1740 / §73.1635)
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
                <div style={{ background: '#0f172a', borderRadius: 6, padding: 10 }}>
                  <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 2 }}>Est. Silence Duration</div>
                  <div style={{ fontWeight: 700, color: '#f97316', fontSize: 15 }}>{g.silence_estimate_days_min}–{g.silence_estimate_days_max} days</div>
                  <div style={{ fontSize: 10, color: '#64748b' }}>typ. {g.silence_estimate_days_typ} days</div>
                </div>
                <div style={{ background: '#0f172a', borderRadius: 6, padding: 10 }}>
                  <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 2 }}>STA Required</div>
                  <div style={{ fontWeight: 700, color: g.sta_required ? '#ef4444' : '#22c55e', fontSize: 15 }}>{g.sta_required ? 'YES (§73.1635)' : 'Not Required'}</div>
                  <div style={{ fontSize: 10, color: '#64748b' }}>Auto-allowed: {g.silent_days_auto_allowed} days</div>
                </div>
                <div style={{ background: '#0f172a', borderRadius: 6, padding: 10 }}>
                  <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 2 }}>Forfeiture Risk</div>
                  <div style={{ fontWeight: 700, color: g.forfeiture_risk ? '#ef4444' : '#22c55e', fontSize: 15 }}>{g.forfeiture_risk ? 'RISK EXISTS' : 'Low Risk'}</div>
                  <div style={{ fontSize: 10, color: '#64748b' }}>Trigger: {g.silent_months_forfeiture} months (§73.1740)</div>
                </div>
                <div style={{ background: '#0f172a', borderRadius: 6, padding: 10 }}>
                  <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 2 }}>Translator Continuity</div>
                  <div style={{ fontWeight: 700, color: g.translator_continuity_available ? '#22c55e' : '#94a3b8', fontSize: 15 }}>{g.translator_continuity_available ? 'Available' : 'N/A'}</div>
                  <div style={{ fontSize: 10, color: '#64748b' }}>MB Docket 13-249</div>
                </div>
              </div>
              {g.silence_minimization_strategies && (
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 6, fontWeight: 600 }}>Silence Minimization Strategies</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {g.silence_minimization_strategies.map((s, i) => (
                      <div key={i} style={{ background: '#0f172a', borderRadius: 4, padding: 8 }}>
                        <div style={{ fontSize: 12, color: '#f1f5f9', fontWeight: 600 }}>{s.label}</div>
                        <div style={{ fontSize: 10, color: '#22c55e' }}>{s.risk_reduction}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div style={{ fontSize: 10, color: '#64748b', marginTop: 8 }}>{g.note}</div>
            </div>
          );
        })()}

        {/* Antenna RFI From Nearby Equipment Guide */}
        {candidate.antenna_rfi_from_nearby_equipment_guide && (() => {
          const g = candidate.antenna_rfi_from_nearby_equipment_guide;
          const sensitivityColor = g.frequency_sensitivity === 'VERY_HIGH' ? '#ef4444' : g.frequency_sensitivity === 'HIGH' ? '#f97316' : g.frequency_sensitivity === 'MEDIUM' ? '#eab308' : '#22c55e';
          const severityColor = (s) => s === 'HIGH' ? '#ef4444' : s === 'MEDIUM' ? '#eab308' : '#22c55e';
          return (
            <div style={{ background: '#1e293b', borderRadius: 8, padding: 16, marginBottom: 16 }}>
              <div style={{ fontWeight: 600, color: '#f1f5f9', marginBottom: 8, fontSize: 14 }}>
                📡 RFI From Nearby Equipment (Part 15 / Power Lines)
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
                <div style={{ background: '#0f172a', borderRadius: 6, padding: 10 }}>
                  <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 2 }}>RFI Sensitivity</div>
                  <div style={{ fontWeight: 700, color: sensitivityColor, fontSize: 15 }}>{g.frequency_sensitivity}</div>
                  <div style={{ fontSize: 10, color: '#64748b' }}>{g.frequency_khz} kHz</div>
                </div>
                <div style={{ background: '#0f172a', borderRadius: 6, padding: 10 }}>
                  <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 2 }}>Part 15 Limit (AM)</div>
                  <div style={{ fontWeight: 700, color: '#f1f5f9', fontSize: 15 }}>{g.part15_limit_uv_m} µV/m</div>
                  <div style={{ fontSize: 10, color: '#64748b' }}>at {g.part15_test_distance_m}m (§15.209)</div>
                </div>
                <div style={{ background: '#0f172a', borderRadius: 6, padding: 10 }}>
                  <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 2 }}>RFI Source Categories</div>
                  <div style={{ fontWeight: 700, color: '#f1f5f9', fontSize: 15 }}>{g.n_rfi_source_categories} categories</div>
                  <div style={{ fontSize: 10, color: '#ef4444' }}>{g.n_high_severity_sources} HIGH severity</div>
                </div>
                <div style={{ background: '#0f172a', borderRadius: 6, padding: 10 }}>
                  <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 2 }}>Pre-Construction Survey</div>
                  <div style={{ fontWeight: 700, color: g.pre_construction_survey_required ? '#ef4444' : '#22c55e', fontSize: 15 }}>{g.pre_construction_survey_required ? 'REQUIRED' : 'Optional'}</div>
                  <div style={{ fontSize: 10, color: '#64748b' }}>{g.n_survey_steps} survey steps</div>
                </div>
              </div>
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 6, fontWeight: 600 }}>Clearance Requirements</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
                  <div style={{ background: '#0f172a', borderRadius: 4, padding: 8, textAlign: 'center' }}>
                    <div style={{ fontSize: 10, color: '#94a3b8' }}>HV Power Lines</div>
                    <div style={{ fontWeight: 700, color: '#ef4444' }}>≥{g.power_line_clearance_m}m</div>
                  </div>
                  <div style={{ background: '#0f172a', borderRadius: 4, padding: 8, textAlign: 'center' }}>
                    <div style={{ fontSize: 10, color: '#94a3b8' }}>Solar Inverters</div>
                    <div style={{ fontWeight: 700, color: '#f97316' }}>≥{g.solar_inverter_clearance_m}m</div>
                  </div>
                  <div style={{ background: '#0f172a', borderRadius: 4, padding: 8, textAlign: 'center' }}>
                    <div style={{ fontSize: 10, color: '#94a3b8' }}>Data Centers</div>
                    <div style={{ fontWeight: 700, color: '#f97316' }}>≥{g.data_center_clearance_m}m</div>
                  </div>
                </div>
              </div>
              {g.rfi_source_categories && (
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 6, fontWeight: 600 }}>RFI Source Categories</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {g.rfi_source_categories.map((src, i) => (
                      <div key={i} style={{ background: '#0f172a', borderRadius: 4, padding: 8, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                        <span style={{ color: severityColor(src.severity), fontWeight: 700, fontSize: 10, minWidth: 40, paddingTop: 1 }}>{src.severity}</span>
                        <div>
                          <div style={{ fontSize: 12, color: '#f1f5f9', fontWeight: 600 }}>{src.label}</div>
                          <div style={{ fontSize: 10, color: '#64748b' }}>≥{src.recommended_clearance_m}m · {src.cfr}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div style={{ fontSize: 10, color: '#64748b', marginTop: 8 }}>{g.note}</div>
            </div>
          );
        })()}

        {/* Neighboring Landowner Notification Guide */}
        {candidate.neighboring_landowner_notification_guide && (() => {
          const g = candidate.neighboring_landowner_notification_guide;
          return (
            <div style={{ background: '#1e293b', borderRadius: 8, padding: 16, marginBottom: 16 }}>
              <div style={{ fontWeight: 600, color: '#f1f5f9', marginBottom: 8, fontSize: 14 }}>
                Neighbor Notification Plan <span style={{ color: '#94a3b8', fontWeight: 400, fontSize: 12 }}>§73.3580 / Local Zoning</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 10 }}>
                <div style={{ background: '#0f172a', borderRadius: 6, padding: 8 }}>
                  <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 2 }}>FCC Public Notice</div>
                  <div style={{ color: g.fcc_public_notice_required ? '#fbbf24' : '#34d399', fontSize: 12, fontWeight: 600 }}>
                    {g.fcc_public_notice_required ? `Required — ${g.fcc_public_notice_weeks} weeks (${g.fcc_public_notice_cfr})` : 'Not required'}
                  </div>
                </div>
                <div style={{ background: '#0f172a', borderRadius: 6, padding: 8 }}>
                  <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 2 }}>Zoning Notice Radius</div>
                  <div style={{ color: '#f1f5f9', fontSize: 12 }}>{g.zoning_notice_radius_ft} ft ({g.zoning_notice_radius_m}m)</div>
                </div>
                <div style={{ background: '#0f172a', borderRadius: 6, padding: 8 }}>
                  <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 2 }}>Notification Methods</div>
                  <div style={{ color: '#f1f5f9', fontSize: 12 }}>{g.n_notification_methods} ({g.n_required_methods} required)</div>
                </div>
                <div style={{ background: '#0f172a', borderRadius: 6, padding: 8 }}>
                  <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 2 }}>Proactive Outreach Radius</div>
                  <div style={{ color: '#f1f5f9', fontSize: 12 }}>{g.recommended_notice_radius_km} km</div>
                </div>
              </div>
              {g.opposition_mitigation && (
                <div style={{ marginBottom: 8 }}>
                  <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 4 }}>Opposition Concerns & Mitigation</div>
                  {g.opposition_mitigation.slice(0, 3).map((o, i) => (
                    <div key={i} style={{ marginBottom: 4, background: '#0f172a', borderRadius: 5, padding: 7 }}>
                      <div style={{ color: '#fbbf24', fontSize: 11, fontWeight: 600 }}>{o.concern}</div>
                      <div style={{ color: '#94a3b8', fontSize: 10 }}>{o.mitigation}</div>
                    </div>
                  ))}
                </div>
              )}
              <div style={{ color: '#64748b', fontSize: 10 }}>{g.reference}</div>
            </div>
          );
        })()}

        {/* Transmitter Insurance Guide */}
        {candidate.transmitter_insurance_guide && (() => {
          const g = candidate.transmitter_insurance_guide;
          return (
            <div style={{ background: '#1e293b', borderRadius: 8, padding: 16, marginBottom: 16 }}>
              <div style={{ fontWeight: 600, color: '#f1f5f9', marginBottom: 8, fontSize: 14 }}>
                Broadcast Equipment Insurance <span style={{ color: '#94a3b8', fontWeight: 400, fontSize: 12 }}>§73.49 / §73.1740</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 10 }}>
                <div style={{ background: '#0f172a', borderRadius: 6, padding: 8 }}>
                  <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 2 }}>Total Insured Value</div>
                  <div style={{ color: '#f1f5f9', fontSize: 13, fontWeight: 600 }}>${g.estimated_equipment_value_usd?.toLocaleString()}</div>
                </div>
                <div style={{ background: '#0f172a', borderRadius: 6, padding: 8 }}>
                  <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 2 }}>Est. Annual Premium</div>
                  <div style={{ color: '#fbbf24', fontSize: 13, fontWeight: 600 }}>${g.estimated_annual_premium_usd?.typical?.toLocaleString()}/yr</div>
                  <div style={{ color: '#64748b', fontSize: 10 }}>${g.estimated_annual_premium_usd?.low?.toLocaleString()}–${g.estimated_annual_premium_usd?.high?.toLocaleString()}</div>
                </div>
                <div style={{ background: '#0f172a', borderRadius: 6, padding: 8 }}>
                  <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 2 }}>Transmitter Value</div>
                  <div style={{ color: '#f1f5f9', fontSize: 12 }}>${g.transmitter_value_usd?.toLocaleString()}</div>
                </div>
                <div style={{ background: '#0f172a', borderRadius: 6, padding: 8 }}>
                  <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 2 }}>Tower Value</div>
                  <div style={{ color: '#f1f5f9', fontSize: 12 }}>${g.tower_value_usd?.toLocaleString()}</div>
                </div>
              </div>
              {g.coverage_types && (
                <div style={{ marginBottom: 10 }}>
                  <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 4 }}>Coverage Types ({g.n_coverage_types})</div>
                  {g.coverage_types.map((t, i) => (
                    <div key={i} style={{ marginBottom: 3, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                      <span style={{ background: '#334155', color: '#e2e8f0', borderRadius: 4, padding: '1px 5px', fontSize: 9, minWidth: 36, textAlign: 'center', marginTop: 1 }}>{t.id}</span>
                      <div>
                        <div style={{ color: '#f1f5f9', fontSize: 11 }}>{t.label}{t.value_usd ? ` — $${t.value_usd.toLocaleString()}` : ''}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <div style={{ background: '#0f172a', borderRadius: 6, padding: 7 }}>
                <div style={{ color: '#94a3b8', fontSize: 10 }}>Silent station rule: notify FCC after {g.silent_station_rule_days} days off-air (§73.1740). Business interruption coverage should exceed {g.silent_station_rule_days} days.</div>
              </div>
            </div>
          );
        })()}

        {/* Signal Booster Prohibited Guide */}
        {candidate.signal_booster_prohibited_guide && (() => {
          const g = candidate.signal_booster_prohibited_guide;
          return (
            <div style={{ background: '#1e293b', borderRadius: 8, padding: 16, marginBottom: 16 }}>
              <div style={{ fontWeight: 600, color: '#f1f5f9', marginBottom: 8, fontSize: 14 }}>
                AM Signal Booster / Coverage Extension <span style={{ color: '#94a3b8', fontWeight: 400, fontSize: 12 }}>§73.1660</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 10 }}>
                <div style={{ background: '#0f172a', borderRadius: 6, padding: 8 }}>
                  <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 2 }}>AM Booster</div>
                  <div style={{ color: '#f87171', fontSize: 12, fontWeight: 600 }}>PROHIBITED (§73.1660)</div>
                </div>
                <div style={{ background: '#0f172a', borderRadius: 6, padding: 8 }}>
                  <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 2 }}>AM-to-FM Translator</div>
                  <div style={{ color: '#34d399', fontSize: 12, fontWeight: 600 }}>Authorized (§74.1201)</div>
                </div>
                <div style={{ background: '#0f172a', borderRadius: 6, padding: 8 }}>
                  <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 2 }}>Legal Alternatives</div>
                  <div style={{ color: '#f1f5f9', fontSize: 13, fontWeight: 600 }}>{g.n_legal_alternatives} options</div>
                </div>
                <div style={{ background: '#0f172a', borderRadius: 6, padding: 8 }}>
                  <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 2 }}>Unauth. Booster Forfeiture</div>
                  <div style={{ color: '#f87171', fontSize: 12 }}>${g.forfeiture_risk_usd?.unauthorized_transmitter?.low?.toLocaleString()}–${g.forfeiture_risk_usd?.unauthorized_transmitter?.high?.toLocaleString()}</div>
                </div>
              </div>
              {g.legal_alternatives && (
                <div style={{ marginBottom: 10 }}>
                  <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 4 }}>Authorized Coverage Extension Options</div>
                  {g.legal_alternatives.map((a, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 4 }}>
                      <span style={{ background: '#1d4ed8', color: '#f1f5f9', borderRadius: 4, padding: '1px 5px', fontSize: 9, fontWeight: 700, textAlign: 'center', marginTop: 1, whiteSpace: 'nowrap' }}>AUTH</span>
                      <div>
                        <div style={{ color: '#f1f5f9', fontSize: 12 }}>{a.label}</div>
                        <div style={{ color: '#64748b', fontSize: 10 }}>{a.cfr}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <div style={{ color: '#64748b', fontSize: 10 }}>Part 15 AM limit: {g.part15_limit_uv_m} µV/m at 30m (§15.209)</div>
            </div>
          );
        })()}

        {/* Community of License Change Guide */}
        {candidate.community_of_license_change_guide && (() => {
          const g = candidate.community_of_license_change_guide;
          const riskColors = { LOW: '#34d399', MEDIUM: '#fbbf24', HIGH: '#f97316', VERY_HIGH: '#f87171', 'NOT-EVALUATED': '#94a3b8' };
          const sevColors = { CRITICAL: '#f87171', HIGH: '#f97316', MEDIUM: '#fbbf24' };
          return (
            <div style={{ background: '#1e293b', borderRadius: 8, padding: 16, marginBottom: 16 }}>
              <div style={{ fontWeight: 600, color: '#f1f5f9', marginBottom: 8, fontSize: 14 }}>
                Community of License (COL) Change <span style={{ color: '#94a3b8', fontWeight: 400, fontSize: 12 }}>§73.3573 / §73.24(h)</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 10 }}>
                <div style={{ background: '#0f172a', borderRadius: 6, padding: 8 }}>
                  <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 2 }}>COL Change Risk</div>
                  <div style={{ color: riskColors[g.col_change_risk] || '#94a3b8', fontSize: 13, fontWeight: 600 }}>{g.col_change_risk}</div>
                </div>
                <div style={{ background: '#0f172a', borderRadius: 6, padding: 8 }}>
                  <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 2 }}>Distance from COL</div>
                  <div style={{ color: '#f1f5f9', fontSize: 12 }}>{g.distance_from_col_km != null ? `${g.distance_from_col_km} km` : 'Unknown'}</div>
                </div>
                <div style={{ background: '#0f172a', borderRadius: 6, padding: 8 }}>
                  <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 2 }}>COL Change Triggered</div>
                  <div style={{ color: g.triggers_col_change ? '#f87171' : '#34d399', fontSize: 12, fontWeight: 600 }}>
                    {g.triggers_col_change == null ? 'Unknown' : g.triggers_col_change ? 'YES — formal application required' : 'No — COL service likely preserved'}
                  </div>
                </div>
                <div style={{ background: '#0f172a', borderRadius: 6, padding: 8 }}>
                  <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 2 }}>Auction Exposure</div>
                  <div style={{ color: g.auction_required === 'POSSIBLE' ? '#f87171' : '#34d399', fontSize: 12 }}>{g.auction_required}</div>
                </div>
              </div>
              {g.col_change_risks && (
                <div style={{ marginBottom: 10 }}>
                  <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 4 }}>COL Change Risks</div>
                  {g.col_change_risks.map((r, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 4 }}>
                      <span style={{ background: sevColors[r.severity] || '#475569', color: '#0f172a', borderRadius: 4, padding: '1px 5px', fontSize: 9, fontWeight: 700, minWidth: 48, textAlign: 'center', marginTop: 1 }}>{r.severity}</span>
                      <div>
                        <div style={{ color: '#f1f5f9', fontSize: 12 }}>{r.risk}</div>
                        <div style={{ color: '#64748b', fontSize: 10 }}>{r.cfr}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <div style={{ color: '#64748b', fontSize: 10 }}>COL contour: {g.col_contour_threshold_mv_m} mV/m daytime ({g.col_service_cfr})</div>
            </div>
          );
        })()}

        {/* FCC License Modification Guide */}
        {candidate.fcc_license_modification_guide && (() => {
          const g = candidate.fcc_license_modification_guide;
          return (
            <div style={{ background: '#1e293b', borderRadius: 8, padding: 16, marginBottom: 16 }}>
              <div style={{ fontWeight: 600, color: '#f1f5f9', marginBottom: 8, fontSize: 14 }}>
                FCC License Modification <span style={{ color: '#94a3b8', fontWeight: 400, fontSize: 12 }}>§73.3533 / Form 301-AM</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 10 }}>
                <div style={{ background: '#0f172a', borderRadius: 6, padding: 8 }}>
                  <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 2 }}>FCC Form</div>
                  <div style={{ color: '#f1f5f9', fontSize: 13, fontWeight: 600 }}>{g.fcc_form} via LMS</div>
                  <div style={{ color: '#64748b', fontSize: 10 }}>{g.fcc_system}</div>
                </div>
                <div style={{ background: '#0f172a', borderRadius: 6, padding: 8 }}>
                  <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 2 }}>Filing Fee</div>
                  <div style={{ color: '#fbbf24', fontSize: 13, fontWeight: 600 }}>${g.filing_fee_usd}</div>
                </div>
                <div style={{ background: '#0f172a', borderRadius: 6, padding: 8 }}>
                  <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 2 }}>Required Exhibits</div>
                  <div style={{ color: '#f1f5f9', fontSize: 13, fontWeight: 600 }}>{g.n_required_exhibits}</div>
                  <div style={{ color: '#64748b', fontSize: 10 }}>{g.is_directional ? 'includes DA pattern' : 'NDA station'}</div>
                </div>
                <div style={{ background: '#0f172a', borderRadius: 6, padding: 8 }}>
                  <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 2 }}>CP Term</div>
                  <div style={{ color: '#f1f5f9', fontSize: 12 }}>{g.cp_term_years} years</div>
                  <div style={{ color: '#64748b', fontSize: 10 }}>{g.extension_months}-month extension available</div>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 10 }}>
                <div style={{ background: '#0f172a', borderRadius: 6, padding: 8 }}>
                  <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 2 }}>Processing (optimistic)</div>
                  <div style={{ color: '#34d399', fontSize: 12 }}>{g.is_directional ? g.processing_time_estimate?.da_optimistic_months : g.processing_time_estimate?.nda_optimistic_months} months</div>
                </div>
                <div style={{ background: '#0f172a', borderRadius: 6, padding: 8 }}>
                  <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 2 }}>Processing (conservative)</div>
                  <div style={{ color: '#f87171', fontSize: 12 }}>{g.is_directional ? g.processing_time_estimate?.da_conservative_months : g.processing_time_estimate?.nda_conservative_months} months</div>
                </div>
              </div>
              {g.fcc_processing_steps && (
                <div style={{ marginBottom: 8 }}>
                  <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 4 }}>Processing Steps</div>
                  {g.fcc_processing_steps.slice(0, 3).map((s, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 4 }}>
                      <span style={{ background: '#334155', color: '#f1f5f9', borderRadius: 4, padding: '1px 6px', fontSize: 10, minWidth: 20, textAlign: 'center', marginTop: 1 }}>{s.step}</span>
                      <div>
                        <div style={{ color: '#f1f5f9', fontSize: 12 }}>{s.action}</div>
                        <div style={{ color: '#64748b', fontSize: 10 }}>{s.timeline}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <div style={{ color: '#64748b', fontSize: 10 }}>{g.reference}</div>
            </div>
          );
        })()}

        {/* Transmitter Building Design Guide */}
        {candidate.transmitter_building_design_guide && (() => {
          const g = candidate.transmitter_building_design_guide;
          return (
            <div style={{ background: '#1e293b', borderRadius: 8, padding: 16, marginBottom: 16 }}>
              <div style={{ fontWeight: 600, color: '#f1f5f9', marginBottom: 8, fontSize: 14 }}>
                Transmitter Building Design <span style={{ color: '#94a3b8', fontWeight: 400, fontSize: 12 }}>§73.49 / NEC §250</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 10 }}>
                <div style={{ background: '#0f172a', borderRadius: 6, padding: 8 }}>
                  <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 2 }}>Recommended Area</div>
                  <div style={{ color: '#f1f5f9', fontSize: 13, fontWeight: 600 }}>{g.recommended_floor_area_sqft} sq ft</div>
                  <div style={{ color: '#64748b', fontSize: 10 }}>Min: {g.min_floor_area_sqft} sq ft</div>
                </div>
                <div style={{ background: '#0f172a', borderRadius: 6, padding: 8 }}>
                  <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 2 }}>HVAC Required</div>
                  <div style={{ color: '#fbbf24', fontSize: 13, fontWeight: 600 }}>{g.hvac_tons_required} tons</div>
                  <div style={{ color: '#64748b', fontSize: 10 }}>{g.heat_dissipation_kw} kW Tx heat + solar gain</div>
                </div>
                <div style={{ background: '#0f172a', borderRadius: 6, padding: 8 }}>
                  <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 2 }}>Build Cost (prefab)</div>
                  <div style={{ color: '#f1f5f9', fontSize: 12, fontWeight: 600 }}>${g.estimated_building_cost_usd?.typical?.toLocaleString()}</div>
                </div>
                <div style={{ background: '#0f172a', borderRadius: 6, padding: 8 }}>
                  <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 2 }}>Build Cost (block)</div>
                  <div style={{ color: '#f1f5f9', fontSize: 12 }}>${g.estimated_building_cost_usd?.high?.toLocaleString()}</div>
                </div>
              </div>
              {g.equipment_list && (
                <div style={{ marginBottom: 8 }}>
                  <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 4 }}>Equipment ({g.n_equipment_items} items)</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {g.equipment_list.map((e, i) => (
                      <span key={i} style={{ background: '#334155', color: '#e2e8f0', borderRadius: 4, padding: '2px 6px', fontSize: 10 }}>{e.label}</span>
                    ))}
                  </div>
                </div>
              )}
              <div style={{ background: '#0f172a', borderRadius: 6, padding: 7, marginTop: 6 }}>
                <div style={{ color: '#64748b', fontSize: 10 }}>{g.atu_location_note}</div>
              </div>
            </div>
          );
        })()}

        {/* AM Monitoring Point Guide */}
        {candidate.am_monitoring_point_guide && (() => {
          const g = candidate.am_monitoring_point_guide;
          return (
            <div style={{ background: '#1e293b', borderRadius: 8, padding: 16, marginBottom: 16 }}>
              <div style={{ fontWeight: 600, color: '#f1f5f9', marginBottom: 8, fontSize: 14 }}>
                AM Monitoring Points <span style={{ color: '#94a3b8', fontWeight: 400, fontSize: 12 }}>§73.1213</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 10 }}>
                <div style={{ background: '#0f172a', borderRadius: 6, padding: 8 }}>
                  <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 2 }}>Station Type</div>
                  <div style={{ color: '#f1f5f9', fontSize: 12, fontWeight: 600 }}>
                    {g.is_directional ? `Directional (${g.pattern_mode})` : `Non-Directional (${g.pattern_mode})`}
                  </div>
                </div>
                <div style={{ background: '#0f172a', borderRadius: 6, padding: 8 }}>
                  <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 2 }}>Monitoring Points</div>
                  <div style={{ color: '#fbbf24', fontSize: 13, fontWeight: 600 }}>{g.n_monitoring_points} ({g.n_patterns} pattern{g.n_patterns > 1 ? 's' : ''} × {g.n_points_per_pattern} pts)</div>
                </div>
                <div style={{ background: '#0f172a', borderRadius: 6, padding: 8 }}>
                  <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 2 }}>Distance Range</div>
                  <div style={{ color: '#f1f5f9', fontSize: 12 }}>{g.min_distance_m}–{g.max_useful_distance_m}m from tower</div>
                </div>
                <div style={{ background: '#0f172a', borderRadius: 6, padding: 8 }}>
                  <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 2 }}>Annual Monitoring Cost</div>
                  <div style={{ color: '#fbbf24', fontSize: 12 }}>${g.estimated_annual_monitoring_cost_usd?.toLocaleString()}/yr</div>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 10 }}>
                <div style={{ background: '#0f172a', borderRadius: 6, padding: 8 }}>
                  <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 2 }}>FCC Field Tolerance</div>
                  <div style={{ color: '#f1f5f9', fontSize: 12 }}>±{g.fcc_tolerance_pct}% of authorized value</div>
                </div>
                <div style={{ background: '#0f172a', borderRadius: 6, padding: 8 }}>
                  <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 2 }}>Carrier Tolerance</div>
                  <div style={{ color: '#f1f5f9', fontSize: 12 }}>±{g.carrier_tolerance_hz} Hz (§73.1215)</div>
                </div>
              </div>
              {g.relocation_steps && (
                <div style={{ marginBottom: 8 }}>
                  <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 4 }}>Relocation Monitoring Steps</div>
                  {g.relocation_steps.slice(0, 3).map((s, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 4 }}>
                      <span style={{ background: '#334155', color: '#f1f5f9', borderRadius: 4, padding: '1px 6px', fontSize: 10, minWidth: 20, textAlign: 'center', marginTop: 1 }}>{s.priority}</span>
                      <div>
                        <div style={{ color: '#f1f5f9', fontSize: 12 }}>{s.action}</div>
                        <div style={{ color: '#64748b', fontSize: 10 }}>{s.cfr}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <div style={{ color: '#64748b', fontSize: 10 }}>{g.reference}</div>
            </div>
          );
        })()}

        {/* Utility Power Service Guide */}
        {candidate.utility_power_service_guide && (() => {
          const g = candidate.utility_power_service_guide;
          return (
            <div style={{ background: '#1e293b', borderRadius: 8, padding: 16, marginBottom: 16 }}>
              <div style={{ fontWeight: 600, color: '#f1f5f9', marginBottom: 8, fontSize: 14 }}>
                Utility Power Service <span style={{ color: '#94a3b8', fontWeight: 400, fontSize: 12 }}>§11.35 / NFPA 110</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 10 }}>
                <div style={{ background: '#0f172a', borderRadius: 6, padding: 8 }}>
                  <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 2 }}>Total Site Load</div>
                  <div style={{ color: '#f1f5f9', fontSize: 13, fontWeight: 600 }}>{g.total_site_load_kw} kW</div>
                  <div style={{ color: '#64748b', fontSize: 10 }}>Tx {g.transmitter_draw_kw}kW + HVAC {g.hvac_kw}kW + other {g.ancillary_kw}kW</div>
                </div>
                <div style={{ background: '#0f172a', borderRadius: 6, padding: 8 }}>
                  <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 2 }}>Utility Service Required</div>
                  <div style={{ color: '#fbbf24', fontSize: 13, fontWeight: 600 }}>{g.required_service_amps}A / {g.required_utility_service_kw} kW</div>
                </div>
                <div style={{ background: '#0f172a', borderRadius: 6, padding: 8 }}>
                  <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 2 }}>Backup Generator</div>
                  <div style={{ color: g.generator_recommended ? '#f87171' : '#34d399', fontSize: 12, fontWeight: 600 }}>
                    {g.generator_recommended ? `${g.generator_kw_recommended} kW recommended` : 'Optional'}
                  </div>
                </div>
                <div style={{ background: '#0f172a', borderRadius: 6, padding: 8 }}>
                  <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 2 }}>Utility Extension (rural)</div>
                  <div style={{ color: '#fbbf24', fontSize: 12 }}>${g.estimated_utility_extension_cost_usd?.typical?.toLocaleString()} typical</div>
                </div>
              </div>
              {g.generator_costs && (
                <div style={{ background: '#0f172a', borderRadius: 6, padding: 8, marginBottom: 8 }}>
                  <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 4 }}>Generator Cost Estimate</div>
                  <div style={{ display: 'flex', gap: 12 }}>
                    <div>
                      <div style={{ color: '#64748b', fontSize: 10 }}>Generator purchase</div>
                      <div style={{ color: '#f1f5f9', fontSize: 12 }}>${g.generator_costs.generator_purchase_usd?.low?.toLocaleString()}–${g.generator_costs.generator_purchase_usd?.high?.toLocaleString()}</div>
                    </div>
                    <div>
                      <div style={{ color: '#64748b', fontSize: 10 }}>ATS install</div>
                      <div style={{ color: '#f1f5f9', fontSize: 12 }}>${g.generator_costs.ats_installation_usd?.low?.toLocaleString()}–${g.generator_costs.ats_installation_usd?.high?.toLocaleString()}</div>
                    </div>
                    <div>
                      <div style={{ color: '#64748b', fontSize: 10 }}>Annual fuel/maint</div>
                      <div style={{ color: '#f1f5f9', fontSize: 12 }}>${g.generator_costs.annual_fuel_maintenance_usd?.typical?.toLocaleString()}/yr</div>
                    </div>
                  </div>
                </div>
              )}
              <div style={{ color: '#64748b', fontSize: 10 }}>{g.backup_power_cfr}</div>
            </div>
          );
        })()}

        {/* Antenna Deicing Guide */}
        {candidate.antenna_deicing_guide && (() => {
          const g = candidate.antenna_deicing_guide;
          const zoneColor = { 'Zone I': '#34d399', 'Zone II': '#fbbf24', 'Zone III': '#f97316', 'Zone IV': '#f87171' };
          return (
            <div style={{ background: '#1e293b', borderRadius: 8, padding: 16, marginBottom: 16 }}>
              <div style={{ fontWeight: 600, color: '#f1f5f9', marginBottom: 8, fontSize: 14 }}>
                Antenna / Tower Deicing <span style={{ color: '#94a3b8', fontWeight: 400, fontSize: 12 }}>TIA-222-H / §73.1215</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 10 }}>
                <div style={{ background: '#0f172a', borderRadius: 6, padding: 8 }}>
                  <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 2 }}>Ice Zone</div>
                  <div style={{ color: zoneColor[g.ice_zone] || '#f1f5f9', fontSize: 13, fontWeight: 600 }}>{g.ice_zone} ({g.ice_mm}mm design)</div>
                </div>
                <div style={{ background: '#0f172a', borderRadius: 6, padding: 8 }}>
                  <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 2 }}>Active Deicing</div>
                  <div style={{ color: g.deicing_recommended ? '#f87171' : '#34d399', fontSize: 12, fontWeight: 600 }}>
                    {g.deicing_recommended ? 'Recommended' : 'Not required (monitor)'}
                  </div>
                </div>
                <div style={{ background: '#0f172a', borderRadius: 6, padding: 8 }}>
                  <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 2 }}>Est. Annual Deicing Cost</div>
                  <div style={{ color: '#fbbf24', fontSize: 12 }}>
                    {g.estimated_annual_deicing_cost_usd.typical === 0 ? 'None required' : `$${g.estimated_annual_deicing_cost_usd.typical.toLocaleString()}/yr`}
                  </div>
                </div>
                <div style={{ background: '#0f172a', borderRadius: 6, padding: 8 }}>
                  <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 2 }}>Applicable Systems</div>
                  <div style={{ color: '#f1f5f9', fontSize: 12 }}>{g.n_applicable_systems} of {g.all_deicing_systems?.length} options apply</div>
                </div>
              </div>
              {g.electrical_risks && g.electrical_risks.length > 0 && (
                <div style={{ marginBottom: 10 }}>
                  <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 4 }}>Electrical / RF Risks from Ice</div>
                  {g.electrical_risks.map((r, i) => (
                    <div key={i} style={{ marginBottom: 4, background: '#0f172a', borderRadius: 5, padding: 7 }}>
                      <div style={{ color: '#f1f5f9', fontSize: 12 }}>{r.risk} <span style={{ color: '#64748b', fontSize: 10 }}>{r.cfr}</span></div>
                      <div style={{ color: '#94a3b8', fontSize: 10 }}>{r.mitigation}</div>
                    </div>
                  ))}
                </div>
              )}
              <div style={{ color: '#64748b', fontSize: 10 }}>{g.reference}</div>
            </div>
          );
        })()}

        {/* Ground Lease Negotiation Guide */}
        {candidate.ground_lease_negotiation_guide && (() => {
          const g = candidate.ground_lease_negotiation_guide;
          const prioColors = { CRITICAL: '#f87171', HIGH: '#fbbf24', MEDIUM: '#34d399' };
          return (
            <div style={{ background: '#1e293b', borderRadius: 8, padding: 16, marginBottom: 16 }}>
              <div style={{ fontWeight: 600, color: '#f1f5f9', marginBottom: 8, fontSize: 14 }}>
                Ground Lease Negotiation <span style={{ color: '#94a3b8', fontWeight: 400, fontSize: 12 }}>§73.49 / §73.3533</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 10 }}>
                <div style={{ background: '#0f172a', borderRadius: 6, padding: 8 }}>
                  <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 2 }}>Recommended Term</div>
                  <div style={{ color: '#f1f5f9', fontSize: 13, fontWeight: 600 }}>{g.recommended_lease_term_years} yrs + {g.lease_term?.renewal_options}×{g.lease_term?.renewal_option_years}-yr options</div>
                </div>
                <div style={{ background: '#0f172a', borderRadius: 6, padding: 8 }}>
                  <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 2 }}>Min. Site Area</div>
                  <div style={{ color: '#f1f5f9', fontSize: 13, fontWeight: 600 }}>{g.min_site_area_acres} acres ({g.min_site_radius_m}m radius)</div>
                </div>
                <div style={{ background: '#0f172a', borderRadius: 6, padding: 8 }}>
                  <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 2 }}>Rural Annual Rent</div>
                  <div style={{ color: '#fbbf24', fontSize: 12 }}>${g.rent_estimates?.rural_agricultural?.low_usd?.toLocaleString()}–${g.rent_estimates?.rural_agricultural?.high_usd?.toLocaleString()}/yr</div>
                </div>
                <div style={{ background: '#0f172a', borderRadius: 6, padding: 8 }}>
                  <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 2 }}>Ground Radial Radius</div>
                  <div style={{ color: '#f1f5f9', fontSize: 12 }}>{g.ground_radial_radius_m}m (λ/4 at {g.frequency_khz} kHz)</div>
                </div>
              </div>
              {g.key_provisions && (
                <div style={{ marginBottom: 10 }}>
                  <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 4 }}>Key Lease Provisions ({g.n_critical_provisions} CRITICAL)</div>
                  {g.key_provisions.slice(0, 4).map((p, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 4 }}>
                      <span style={{ background: prioColors[p.priority] || '#475569', color: '#0f172a', borderRadius: 4, padding: '1px 5px', fontSize: 9, fontWeight: 700, minWidth: 52, textAlign: 'center', marginTop: 1 }}>{p.priority}</span>
                      <div>
                        <div style={{ color: '#f1f5f9', fontSize: 12 }}>{p.label}</div>
                        <div style={{ color: '#64748b', fontSize: 10 }}>{p.cfr}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <div style={{ background: '#0f172a', borderRadius: 6, padding: 8, marginBottom: 8 }}>
                <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 2 }}>Option to Purchase</div>
                <div style={{ color: g.option_to_purchase_recommended ? '#34d399' : '#94a3b8', fontSize: 12 }}>
                  {g.option_to_purchase_recommended ? 'Recommended — negotiate right of first refusal or purchase option' : 'Not recommended'}
                </div>
              </div>
              <div style={{ color: '#64748b', fontSize: 10 }}>{g.reference}</div>
            </div>
          );
        })()}

        {/* Emergency Alert System Equipment Guide */}
        {candidate.emergency_alert_system_equipment_guide && (() => {
          const g = candidate.emergency_alert_system_equipment_guide;
          return (
            <div style={{ background: '#1e293b', borderRadius: 8, padding: 16, marginBottom: 16 }}>
              <div style={{ fontWeight: 600, color: '#f1f5f9', marginBottom: 8, fontSize: 14 }}>
                Emergency Alert System (EAS) <span style={{ color: '#94a3b8', fontWeight: 400, fontSize: 12 }}>47 CFR Part 11</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 10 }}>
                <div style={{ background: '#0f172a', borderRadius: 6, padding: 8 }}>
                  <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 2 }}>EAS Equipment</div>
                  <div style={{ color: g.eas_equipment_required ? '#f87171' : '#34d399', fontSize: 12, fontWeight: 600 }}>
                    {g.eas_equipment_required ? 'Required (§11.35)' : 'Not required'}
                  </div>
                </div>
                <div style={{ background: '#0f172a', borderRadius: 6, padding: 8 }}>
                  <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 2 }}>CAP Sources Required</div>
                  <div style={{ color: '#f1f5f9', fontSize: 13, fontWeight: 600 }}>{g.n_required_cap_sources} (IPAWS + 2 analog)</div>
                </div>
                <div style={{ background: '#0f172a', borderRadius: 6, padding: 8 }}>
                  <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 2 }}>Weekly RWT</div>
                  <div style={{ color: g.weekly_test_required ? '#fbbf24' : '#94a3b8', fontSize: 12 }}>
                    {g.weekly_test_required ? 'Required — any day 8:30 AM–sunset' : 'Not required'}
                  </div>
                </div>
                <div style={{ background: '#0f172a', borderRadius: 6, padding: 8 }}>
                  <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 2 }}>Monthly RMT Relay</div>
                  <div style={{ color: '#f1f5f9', fontSize: 12 }}>Within {g.monthly_relay_window_minutes} min of LP-1</div>
                </div>
              </div>
              {g.relocation_checklist && (
                <div style={{ marginBottom: 10 }}>
                  <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 4 }}>Relocation EAS Checklist</div>
                  {g.relocation_checklist.slice(0, 3).map((r, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 4 }}>
                      <span style={{ background: '#334155', color: '#f1f5f9', borderRadius: 4, padding: '1px 6px', fontSize: 10, minWidth: 20, textAlign: 'center', marginTop: 1 }}>{r.priority}</span>
                      <div>
                        <div style={{ color: '#f1f5f9', fontSize: 12 }}>{r.action}</div>
                        <div style={{ color: '#64748b', fontSize: 10 }}>{r.cfr}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <div style={{ color: '#64748b', fontSize: 10 }}>{g.reference}</div>
            </div>
          );
        })()}

        {/* Public Inspection File Guide */}
        {candidate.public_inspection_file_guide && (() => {
          const g = candidate.public_inspection_file_guide;
          return (
            <div style={{ background: '#1e293b', borderRadius: 8, padding: 16, marginBottom: 16 }}>
              <div style={{ fontWeight: 600, color: '#f1f5f9', marginBottom: 8, fontSize: 14 }}>
                Public Inspection File (OPIF) <span style={{ color: '#94a3b8', fontWeight: 400, fontSize: 12 }}>§73.3526</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 10 }}>
                <div style={{ background: '#0f172a', borderRadius: 6, padding: 8 }}>
                  <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 2 }}>OPIF System</div>
                  <div style={{ color: '#f1f5f9', fontSize: 12 }}>{g.opif_system}</div>
                </div>
                <div style={{ background: '#0f172a', borderRadius: 6, padding: 8 }}>
                  <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 2 }}>Required Documents</div>
                  <div style={{ color: '#f1f5f9', fontSize: 13, fontWeight: 600 }}>{g.n_required_documents} categories</div>
                </div>
                <div style={{ background: '#0f172a', borderRadius: 6, padding: 8 }}>
                  <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 2 }}>Issues/Programs List</div>
                  <div style={{ color: g.issues_programs_list_required ? '#f87171' : '#34d399', fontSize: 12, fontWeight: 600 }}>
                    {g.issues_programs_list_required ? 'Required' : 'Exempt (commercial AM, since 2018)'}
                  </div>
                </div>
                <div style={{ background: '#0f172a', borderRadius: 6, padding: 8 }}>
                  <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 2 }}>Post-Relocation Updates</div>
                  <div style={{ color: '#fbbf24', fontSize: 13, fontWeight: 600 }}>{g.n_relocation_updates} required</div>
                </div>
              </div>
              {g.relocation_updates && (
                <div style={{ marginBottom: 10 }}>
                  <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 4 }}>Relocation OPIF Updates</div>
                  {g.relocation_updates.slice(0, 3).map((u, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 4 }}>
                      <span style={{ background: '#334155', color: '#f1f5f9', borderRadius: 4, padding: '1px 6px', fontSize: 10, minWidth: 20, textAlign: 'center', marginTop: 1 }}>{u.priority}</span>
                      <div>
                        <div style={{ color: '#f1f5f9', fontSize: 12 }}>{u.action}</div>
                        <div style={{ color: '#64748b', fontSize: 10 }}>{u.timeline} · {u.cfr}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {g.forfeiture_risk && (
                <div style={{ background: '#0f172a', borderRadius: 6, padding: 8, marginBottom: 8 }}>
                  <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 4 }}>OPIF Violation Forfeiture Risk</div>
                  <div style={{ display: 'flex', gap: 12 }}>
                    <div>
                      <div style={{ color: '#64748b', fontSize: 10 }}>Missing docs</div>
                      <div style={{ color: '#f87171', fontSize: 12 }}>${g.forfeiture_risk.missing_documents_usd.low.toLocaleString()}–${g.forfeiture_risk.missing_documents_usd.high.toLocaleString()}</div>
                    </div>
                    <div>
                      <div style={{ color: '#64748b', fontSize: 10 }}>Political file</div>
                      <div style={{ color: '#f87171', fontSize: 12 }}>${g.forfeiture_risk.political_file_violations_usd.low.toLocaleString()}–${g.forfeiture_risk.political_file_violations_usd.high.toLocaleString()}</div>
                    </div>
                    <div>
                      <div style={{ color: '#64748b', fontSize: 10 }}>Total/inspection</div>
                      <div style={{ color: '#f87171', fontSize: 12, fontWeight: 600 }}>${g.forfeiture_risk.total_risk_per_inspection_usd.low.toLocaleString()}–${g.forfeiture_risk.total_risk_per_inspection_usd.high.toLocaleString()}</div>
                    </div>
                  </div>
                </div>
              )}
              <div style={{ color: '#64748b', fontSize: 10 }}>{g.reference}</div>
            </div>
          );
        })()}

        {/* Broadcast Content Compliance Guide */}
        {candidate.broadcast_content_compliance_guide && (() => {
          const g = candidate.broadcast_content_compliance_guide;
          const prioColors = { HIGH: '#f87171', MEDIUM: '#fbbf24', LOW: '#34d399' };
          return (
            <div style={{ background: '#1e293b', borderRadius: 8, padding: 16, marginBottom: 16 }}>
              <h4 style={{ color: '#f1f5f9', margin: '0 0 12px', fontSize: 14, fontWeight: 600 }}>
                Broadcast Content Compliance <span style={{ color: '#94a3b8', fontWeight: 400, fontSize: 12 }}>§73.3999</span>
              </h4>
              <div style={{ display: 'flex', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
                <div style={{ background: '#0f172a', borderRadius: 6, padding: '8px 14px', flex: '1 1 130px' }}>
                  <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 4 }}>Safe Harbor</div>
                  <div style={{ color: '#f1f5f9', fontSize: 13, fontWeight: 600 }}>{g.indecency_rules?.safe_harbor_start ?? '—'}–{g.indecency_rules?.safe_harbor_end ?? '—'}</div>
                </div>
                <div style={{ background: '#0f172a', borderRadius: 6, padding: '8px 14px', flex: '1 1 130px' }}>
                  <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 4 }}>Max Forfeiture</div>
                  <div style={{ color: '#f87171', fontSize: 13, fontWeight: 600 }}>${g.indecency_rules?.max_forfeiture_per_incident_usd?.toLocaleString() ?? '—'}</div>
                </div>
                <div style={{ background: '#0f172a', borderRadius: 6, padding: '8px 14px', flex: '1 1 130px' }}>
                  <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 4 }}>HIGH Priority</div>
                  <div style={{ color: '#fbbf24', fontSize: 14, fontWeight: 700 }}>{g.high_priority_elements ?? 0} items</div>
                </div>
              </div>
              {g.compliance_elements && g.compliance_elements.length > 0 && (
                <div style={{ background: '#0f172a', borderRadius: 6, padding: 12 }}>
                  <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Compliance Elements</div>
                  {g.compliance_elements.map((el, i) => (
                    <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 4, alignItems: 'center' }}>
                      <span style={{ color: prioColors[el.priority] ?? '#94a3b8', fontSize: 11, fontWeight: 700, width: 55, flexShrink: 0 }}>{el.priority}</span>
                      <span style={{ color: '#f1f5f9', fontSize: 12 }}>{el.label}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })()}

        {/* Political Programming Compliance Guide */}
        {candidate.political_programming_compliance_guide && (() => {
          const g = candidate.political_programming_compliance_guide;
          return (
            <div style={{ background: '#1e293b', borderRadius: 8, padding: 16, marginBottom: 16 }}>
              <h4 style={{ color: '#f1f5f9', margin: '0 0 12px', fontSize: 14, fontWeight: 600 }}>
                Political Programming Compliance <span style={{ color: '#94a3b8', fontWeight: 400, fontSize: 12 }}>§73.1940</span>
              </h4>
              <div style={{ display: 'flex', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
                <div style={{ background: '#0f172a', borderRadius: 6, padding: '8px 14px', flex: '1 1 120px' }}>
                  <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 4 }}>Obligations</div>
                  <div style={{ color: '#f1f5f9', fontSize: 15, fontWeight: 700 }}>{g.n_obligations ?? '—'}</div>
                </div>
                <div style={{ background: '#0f172a', borderRadius: 6, padding: '8px 14px', flex: '1 1 120px' }}>
                  <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 4 }}>LUC Primary</div>
                  <div style={{ color: '#f1f5f9', fontSize: 14, fontWeight: 600 }}>{g.election_windows?.luc_pre_primary_days ?? '—'} days</div>
                </div>
                <div style={{ background: '#0f172a', borderRadius: 6, padding: '8px 14px', flex: '1 1 120px' }}>
                  <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 4 }}>LUC General</div>
                  <div style={{ color: '#f1f5f9', fontSize: 14, fontWeight: 600 }}>{g.election_windows?.luc_pre_general_days ?? '—'} days</div>
                </div>
                <div style={{ background: '#0f172a', borderRadius: 6, padding: '8px 14px', flex: '1 1 120px' }}>
                  <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 4 }}>Required Actions</div>
                  <div style={{ color: (g.n_required_impacts ?? 0) > 0 ? '#fbbf24' : '#34d399', fontSize: 14, fontWeight: 700 }}>{g.n_required_impacts ?? 0}</div>
                </div>
              </div>
              {g.political_obligations && g.political_obligations.length > 0 && (
                <div style={{ background: '#0f172a', borderRadius: 6, padding: 12, marginBottom: 10 }}>
                  <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Key Obligations</div>
                  {g.political_obligations.map((o, i) => (
                    <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 4, alignItems: 'flex-start' }}>
                      <span style={{ color: '#818cf8', fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap', marginTop: 1 }}>{o.cfr.split(';')[0]}</span>
                      <span style={{ color: '#f1f5f9', fontSize: 12 }}>{o.label}</span>
                    </div>
                  ))}
                </div>
              )}
              {g.relocation_impacts && (
                <div style={{ background: '#0f172a', borderRadius: 6, padding: 12 }}>
                  <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Relocation Impact</div>
                  {g.relocation_impacts.filter(i => i.impact === 'REQUIRED').map((imp, i) => (
                    <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 4, alignItems: 'flex-start' }}>
                      <span style={{ color: '#f87171', fontSize: 11, fontWeight: 600, flexShrink: 0, marginTop: 1 }}>REQ</span>
                      <span style={{ color: '#f1f5f9', fontSize: 12 }}>{imp.detail}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })()}

        {/* Transmitter Redundancy Guide */}
        {candidate.transmitter_redundancy_guide && (() => {
          const g = candidate.transmitter_redundancy_guide;
          return (
            <div style={{ background: '#1e293b', borderRadius: 8, padding: 16, marginBottom: 16 }}>
              <h4 style={{ color: '#f1f5f9', margin: '0 0 12px', fontSize: 14, fontWeight: 600 }}>
                Transmitter Redundancy Guide <span style={{ color: '#94a3b8', fontWeight: 400, fontSize: 12 }}>§73.1680</span>
              </h4>
              <div style={{ display: 'flex', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
                <div style={{ background: '#0f172a', borderRadius: 6, padding: '8px 14px', flex: '1 1 130px' }}>
                  <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 4 }}>FCC Mandate</div>
                  <div style={{ color: g.backup_required_by_fcc ? '#f87171' : '#34d399', fontSize: 13, fontWeight: 700 }}>{g.backup_required_by_fcc ? 'REQUIRED' : 'NOT REQUIRED'}</div>
                </div>
                <div style={{ background: '#0f172a', borderRadius: 6, padding: '8px 14px', flex: '1 1 130px' }}>
                  <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 4 }}>Input Power</div>
                  <div style={{ color: '#f1f5f9', fontSize: 14, fontWeight: 600 }}>~{g.input_power_kva_estimate ?? '—'} kVA</div>
                </div>
                <div style={{ background: '#0f172a', borderRadius: 6, padding: '8px 14px', flex: '1 1 130px' }}>
                  <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 4 }}>Generator</div>
                  <div style={{ color: '#f1f5f9', fontSize: 14, fontWeight: 600 }}>{g.generator_guidance?.recommended_kva ?? '—'} kVA</div>
                </div>
              </div>
              {g.backup_sizing_options && g.backup_sizing_options.length > 0 && (
                <div style={{ background: '#0f172a', borderRadius: 6, padding: 12, marginBottom: 10 }}>
                  <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Backup Sizing Options</div>
                  {g.backup_sizing_options.map((o, i) => (
                    <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 4, alignItems: 'flex-start' }}>
                      <span style={{ color: '#818cf8', fontSize: 11, fontWeight: 600, width: 100, flexShrink: 0, marginTop: 1 }}>{o.option.replace('_', ' ')}</span>
                      <span style={{ color: '#f1f5f9', fontSize: 12 }}>{o.power_kw} kW — ${o.cost_est_usd?.low?.toLocaleString()}–${o.cost_est_usd?.high?.toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              )}
              {g.emergency_operation && (
                <div style={{ background: '#0f172a', borderRadius: 6, padding: 12 }}>
                  <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Emergency Operation</div>
                  <div style={{ color: '#f1f5f9', fontSize: 12 }}>
                    Reduced power OK ≤{g.emergency_operation.max_days_no_notification} days without FCC notification ({g.emergency_operation.cfr})
                  </div>
                  <div style={{ color: '#94a3b8', fontSize: 11, marginTop: 4 }}>
                    STA required after {g.emergency_operation.sta_required_after_days} days
                  </div>
                </div>
              )}
            </div>
          );
        })()}

        {/* Frequency Monitoring Plan Guide */}
        {candidate.frequency_monitoring_plan_guide && (() => {
          const g = candidate.frequency_monitoring_plan_guide;
          return (
            <div style={{ background: '#1e293b', borderRadius: 8, padding: 16, marginBottom: 16 }}>
              <h4 style={{ color: '#f1f5f9', margin: '0 0 12px', fontSize: 14, fontWeight: 600 }}>
                Frequency Monitoring Plan <span style={{ color: '#94a3b8', fontWeight: 400, fontSize: 12 }}>§73.1215</span>
              </h4>
              <div style={{ display: 'flex', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
                <div style={{ background: '#0f172a', borderRadius: 6, padding: '8px 14px', flex: '1 1 120px' }}>
                  <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 4 }}>Carrier Tolerance</div>
                  <div style={{ color: '#f1f5f9', fontSize: 14, fontWeight: 700 }}>±{g.carrier_frequency_monitoring?.max_deviation_hz ?? '—'} Hz</div>
                </div>
                <div style={{ background: '#0f172a', borderRadius: 6, padding: '8px 14px', flex: '1 1 120px' }}>
                  <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 4 }}>Max Modulation</div>
                  <div style={{ color: '#f1f5f9', fontSize: 14, fontWeight: 700 }}>{g.modulation_monitoring?.max_negative_mod_pct ?? '—'}%/+{g.modulation_monitoring?.max_positive_mod_pct ?? '—'}%</div>
                </div>
                <div style={{ background: '#0f172a', borderRadius: 6, padding: '8px 14px', flex: '1 1 120px' }}>
                  <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 4 }}>DA Base Current</div>
                  <div style={{ color: g.da_base_current_monitoring?.required ? '#fbbf24' : '#34d399', fontSize: 13, fontWeight: 600 }}>
                    {g.da_base_current_monitoring?.required ? 'REQUIRED' : 'NOT REQUIRED'}
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ background: '#0f172a', borderRadius: 6, padding: 12, flex: '1 1 200px' }}>
                  <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Spurious Limit</div>
                  <div style={{ color: '#f1f5f9', fontSize: 12 }}>
                    {g.spurious_monitoring?.spurious_limit_dbc_below_2nd_harmonic ?? '—'} dBc (&lt;2nd harmonic)
                  </div>
                  <div style={{ color: '#94a3b8', fontSize: 11, marginTop: 2 }}>
                    {g.spurious_monitoring?.spurious_limit_dbc_above_10mhz ?? '—'} dBc (&gt;10 MHz)
                  </div>
                </div>
                <div style={{ background: '#0f172a', borderRadius: 6, padding: 12, flex: '1 1 200px' }}>
                  <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Remote Control</div>
                  <div style={{ color: g.remote_monitoring?.permitted ? '#34d399' : '#f87171', fontSize: 12, fontWeight: 600 }}>
                    {g.remote_monitoring?.permitted ? 'Permitted §73.1350(c)' : 'Not permitted'}
                  </div>
                </div>
              </div>
            </div>
          );
        })()}

        {/* ASR Registration Update Guide */}
        {candidate.asr_registration_update_guide && (() => {
          const g = candidate.asr_registration_update_guide;
          return (
            <div style={{ background: '#1e293b', borderRadius: 8, padding: 16, marginBottom: 16 }}>
              <h4 style={{ color: '#f1f5f9', margin: '0 0 12px', fontSize: 14, fontWeight: 600 }}>
                ASR Registration Update <span style={{ color: '#94a3b8', fontWeight: 400, fontSize: 12 }}>§17.7</span>
              </h4>
              <div style={{ display: 'flex', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
                <div style={{ background: '#0f172a', borderRadius: 6, padding: '8px 14px', flex: '1 1 130px' }}>
                  <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 4 }}>ASR Required</div>
                  <div style={{ color: g.asr_required_by_height ? '#f87171' : '#34d399', fontSize: 14, fontWeight: 700 }}>{g.asr_required_by_height ? 'YES' : 'EVALUATE'}</div>
                </div>
                <div style={{ background: '#0f172a', borderRadius: 6, padding: '8px 14px', flex: '1 1 130px' }}>
                  <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 4 }}>Tower Height</div>
                  <div style={{ color: '#f1f5f9', fontSize: 15, fontWeight: 600 }}>{g.estimated_tower_height_m ?? '—'} m</div>
                </div>
                <div style={{ background: '#0f172a', borderRadius: 6, padding: '8px 14px', flex: '1 1 130px' }}>
                  <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 4 }}>FAA 7460-1</div>
                  <div style={{ color: g.faa_notification_likely ? '#fbbf24' : '#34d399', fontSize: 14, fontWeight: 600 }}>{g.faa_notification_likely ? 'LIKELY' : 'EVALUATE'}</div>
                </div>
              </div>
              {g.timeline && (
                <div style={{ background: '#0f172a', borderRadius: 6, padding: 12, marginBottom: 10 }}>
                  <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>ASR Filing Timeline</div>
                  <div style={{ color: '#f1f5f9', fontSize: 12 }}>
                    FAA 7460-1: {g.timeline.faa_form_7460_days?.min}–{g.timeline.faa_form_7460_days?.max} days →
                    FCC Form 854: {g.timeline.fcc_form_854_days?.min}–{g.timeline.fcc_form_854_days?.max} days
                  </div>
                  <div style={{ color: '#94a3b8', fontSize: 11, marginTop: 4 }}>
                    Total: {g.timeline.total_asr_days?.min}–{g.timeline.total_asr_days?.max} days
                  </div>
                </div>
              )}
              {g.cost_estimate && (
                <div style={{ background: '#0f172a', borderRadius: 6, padding: 12 }}>
                  <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Cost Estimate</div>
                  <div style={{ color: '#f1f5f9', fontSize: 12 }}>
                    ${g.cost_estimate.total_estimated_usd?.low?.toLocaleString()} – ${g.cost_estimate.total_estimated_usd?.high?.toLocaleString()} (engineering + lighting)
                  </div>
                  <div style={{ color: '#34d399', fontSize: 11, marginTop: 4 }}>Filing fees: Free (FAA Form 7460-1 and FCC Form 854)</div>
                </div>
              )}
            </div>
          );
        })()}

        {/* Tower Climbing Safety Plan Guide */}
        {candidate.tower_climbing_safety_plan_guide && (() => {
          const g = candidate.tower_climbing_safety_plan_guide;
          return (
            <div style={{ background: '#1e293b', borderRadius: 8, padding: 16, marginBottom: 16 }}>
              <h4 style={{ color: '#f1f5f9', margin: '0 0 12px', fontSize: 14, fontWeight: 600 }}>
                Tower Climbing Safety Plan <span style={{ color: '#94a3b8', fontWeight: 400, fontSize: 12 }}>OSHA §1910.268</span>
              </h4>
              <div style={{ display: 'flex', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
                <div style={{ background: '#0f172a', borderRadius: 6, padding: '8px 14px', flex: '1 1 120px' }}>
                  <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 4 }}>Tower Height</div>
                  <div style={{ color: '#f1f5f9', fontSize: 15, fontWeight: 700 }}>{g.estimated_tower_height_m ?? '—'} m</div>
                </div>
                <div style={{ background: '#0f172a', borderRadius: 6, padding: '8px 14px', flex: '1 1 120px' }}>
                  <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 4 }}>RF PPE Required</div>
                  <div style={{ color: g.rf_ppe_required ? '#f87171' : '#34d399', fontSize: 14, fontWeight: 700 }}>{g.rf_ppe_required ? 'YES' : 'NO'}</div>
                </div>
                <div style={{ background: '#0f172a', borderRadius: 6, padding: '8px 14px', flex: '1 1 120px' }}>
                  <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 4 }}>Safety Documents</div>
                  <div style={{ color: '#fbbf24', fontSize: 15, fontWeight: 700 }}>{g.n_safety_documents ?? '—'}</div>
                </div>
              </div>
              {g.rf_safety_requirements && g.rf_safety_requirements.filter(r => r.required).length > 0 && (
                <div style={{ background: '#0f172a', borderRadius: 6, padding: 12, marginBottom: 10 }}>
                  <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>RF Safety Requirements (Active)</div>
                  {g.rf_safety_requirements.filter(r => r.required).map((r, i) => (
                    <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 4, alignItems: 'flex-start' }}>
                      <span style={{ color: '#f87171', fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap', marginTop: 1 }}>REQ</span>
                      <span style={{ color: '#f1f5f9', fontSize: 12 }}>{r.label}</span>
                    </div>
                  ))}
                </div>
              )}
              {g.fall_protection_zones && (
                <div style={{ background: '#0f172a', borderRadius: 6, padding: 12 }}>
                  <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Fall Protection Zones</div>
                  {g.fall_protection_zones.map((z, i) => (
                    <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 4, alignItems: 'flex-start' }}>
                      <span style={{ color: '#818cf8', fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap', marginTop: 1, width: 90, flexShrink: 0 }}>{z.zone.split(' (')[0]}</span>
                      <span style={{ color: '#94a3b8', fontSize: 11 }}>{z.requirement}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })()}

        {/* Remote Pickup Unit Guide */}
        {candidate.remote_pickup_unit_guide && (() => {
          const g = candidate.remote_pickup_unit_guide;
          return (
            <div style={{ background: '#1e293b', borderRadius: 8, padding: 16, marginBottom: 16 }}>
              <h4 style={{ color: '#f1f5f9', margin: '0 0 12px', fontSize: 14, fontWeight: 600 }}>
                Remote Pickup Unit Guide <span style={{ color: '#94a3b8', fontWeight: 400, fontSize: 12 }}>§74.401</span>
              </h4>
              <div style={{ display: 'flex', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
                <div style={{ background: '#0f172a', borderRadius: 6, padding: '8px 14px', flex: '1 1 120px' }}>
                  <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 4 }}>Studio→TX Distance</div>
                  <div style={{ color: '#f1f5f9', fontSize: 15, fontWeight: 700 }}>{g.approximate_studio_to_tx_km ?? '—'} km</div>
                </div>
                <div style={{ background: '#0f172a', borderRadius: 6, padding: '8px 14px', flex: '1 1 120px' }}>
                  <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 4 }}>VHF Path</div>
                  <div style={{ color: g.vhf_path_feasible ? '#34d399' : '#f87171', fontSize: 14, fontWeight: 600 }}>{g.vhf_path_feasible ? 'FEASIBLE' : 'AT LIMIT'}</div>
                </div>
                <div style={{ background: '#0f172a', borderRadius: 6, padding: '8px 14px', flex: '1 1 120px' }}>
                  <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 4 }}>UHF Path</div>
                  <div style={{ color: g.uhf_path_feasible ? '#34d399' : '#f87171', fontSize: 14, fontWeight: 600 }}>{g.uhf_path_feasible ? 'FEASIBLE' : 'AT LIMIT'}</div>
                </div>
                <div style={{ background: '#0f172a', borderRadius: 6, padding: '8px 14px', flex: '1 1 120px' }}>
                  <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 4 }}>Required Actions</div>
                  <div style={{ color: (g.significant_impacts ?? 0) > 0 ? '#fbbf24' : '#34d399', fontSize: 14, fontWeight: 600 }}>{g.significant_impacts ?? 0}</div>
                </div>
              </div>
              {g.relocation_impacts && g.relocation_impacts.length > 0 && (
                <div style={{ background: '#0f172a', borderRadius: 6, padding: 12, marginBottom: 10 }}>
                  <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Relocation Impacts</div>
                  {g.relocation_impacts.map((imp, i) => {
                    const impColor = imp.impact === 'REQUIRED' ? '#f87171' : imp.impact === 'SIGNIFICANT' ? '#fbbf24' : '#94a3b8';
                    return (
                      <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 4, alignItems: 'flex-start' }}>
                        <span style={{ color: impColor, fontSize: 11, fontWeight: 600, width: 80, flexShrink: 0, marginTop: 1 }}>{imp.impact}</span>
                        <span style={{ color: '#f1f5f9', fontSize: 12 }}>{imp.detail}</span>
                      </div>
                    );
                  })}
                </div>
              )}
              {g.cost_estimate && (
                <div style={{ background: '#0f172a', borderRadius: 6, padding: 12 }}>
                  <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Update Cost Estimate</div>
                  <div style={{ color: '#f1f5f9', fontSize: 12 }}>
                    ${g.cost_estimate.total_estimated_usd?.low?.toLocaleString()} – ${g.cost_estimate.total_estimated_usd?.high?.toLocaleString()}
                  </div>
                </div>
              )}
            </div>
          );
        })()}

        {/* Spectrum Repack Readiness Guide */}
        {candidate.spectrum_repack_readiness_guide && (() => {
          const g = candidate.spectrum_repack_readiness_guide;
          const vulnColors = { VERY_LOW: '#34d399', LOW: '#34d399', MODERATE: '#fbbf24', HIGH: '#f87171' };
          return (
            <div style={{ background: '#1e293b', borderRadius: 8, padding: 16, marginBottom: 16 }}>
              <h4 style={{ color: '#f1f5f9', margin: '0 0 12px', fontSize: 14, fontWeight: 600 }}>
                Spectrum Repack Readiness <span style={{ color: '#94a3b8', fontWeight: 400, fontSize: 12 }}>MB 13-249</span>
              </h4>
              <div style={{ display: 'flex', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
                <div style={{ background: '#0f172a', borderRadius: 6, padding: '8px 14px', flex: '1 1 130px' }}>
                  <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 4 }}>Repack Vulnerability</div>
                  <div style={{ color: vulnColors[g.repack_vulnerability] ?? '#94a3b8', fontSize: 14, fontWeight: 700 }}>{g.repack_vulnerability?.replace('_', ' ') ?? '—'}</div>
                </div>
                <div style={{ background: '#0f172a', borderRadius: 6, padding: '8px 14px', flex: '1 1 130px' }}>
                  <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 4 }}>Channel Type</div>
                  <div style={{ color: '#f1f5f9', fontSize: 13, fontWeight: 600 }}>{g.channel_type?.replace(/_/g, ' ') ?? '—'}</div>
                </div>
                <div style={{ background: '#0f172a', borderRadius: 6, padding: '8px 14px', flex: '1 1 130px' }}>
                  <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 4 }}>Repack Mandate</div>
                  <div style={{ color: g.repack_mandate_current ? '#f87171' : '#34d399', fontSize: 13, fontWeight: 600 }}>{g.repack_mandate_current ? 'ACTIVE' : 'NONE'}</div>
                </div>
              </div>
              {g.readiness_actions && g.readiness_actions.length > 0 && (
                <div style={{ background: '#0f172a', borderRadius: 6, padding: 12, marginBottom: 10 }}>
                  <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Readiness Actions</div>
                  {g.readiness_actions.map((a, i) => (
                    <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 4, alignItems: 'flex-start' }}>
                      <span style={{ color: '#818cf8', fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap', marginTop: 1 }}>{a.priority}.</span>
                      <span style={{ color: '#f1f5f9', fontSize: 12 }}>{a.action}</span>
                    </div>
                  ))}
                </div>
              )}
              {g.relocation_repack_interaction && (
                <div style={{ background: '#0f172a', borderRadius: 6, padding: 12 }}>
                  <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Relocation Impact</div>
                  <div style={{ color: g.relocation_repack_interaction.voluntary_move_favorable ? '#34d399' : '#f87171', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
                    {g.relocation_repack_interaction.voluntary_move_favorable ? 'Relocation is FAVORABLE for repack readiness' : 'Relocation has uncertain repack impact'}
                  </div>
                </div>
              )}
            </div>
          );
        })()}

        {/* Interference Complaint Resolution Guide */}
        {candidate.interference_complaint_resolution_guide && (() => {
          const g = candidate.interference_complaint_resolution_guide;
          const riskColors = { LOW: '#34d399', MODERATE: '#fbbf24', HIGH: '#f87171' };
          return (
            <div style={{ background: '#1e293b', borderRadius: 8, padding: 16, marginBottom: 16 }}>
              <h4 style={{ color: '#f1f5f9', margin: '0 0 12px', fontSize: 14, fontWeight: 600 }}>
                Interference Complaint Resolution <span style={{ color: '#94a3b8', fontWeight: 400, fontSize: 12 }}>§73.182</span>
              </h4>
              <div style={{ display: 'flex', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
                <div style={{ background: '#0f172a', borderRadius: 6, padding: '8px 14px', flex: '1 1 120px' }}>
                  <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 4 }}>High Risk Types</div>
                  <div style={{ color: g.high_risk_types > 0 ? '#f87171' : '#34d399', fontSize: 15, fontWeight: 700 }}>{g.high_risk_types ?? '—'}</div>
                </div>
                <div style={{ background: '#0f172a', borderRadius: 6, padding: '8px 14px', flex: '1 1 120px' }}>
                  <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 4 }}>Moderate Risk</div>
                  <div style={{ color: g.moderate_risk_types > 0 ? '#fbbf24' : '#34d399', fontSize: 15, fontWeight: 700 }}>{g.moderate_risk_types ?? '—'}</div>
                </div>
                <div style={{ background: '#0f172a', borderRadius: 6, padding: '8px 14px', flex: '1 1 120px' }}>
                  <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 4 }}>Day Contour</div>
                  <div style={{ color: '#f1f5f9', fontSize: 15, fontWeight: 600 }}>{g.protected_contours_mvm?.day ?? '—'} mV/m</div>
                </div>
              </div>
              {g.complaint_types && g.complaint_types.length > 0 && (
                <div style={{ background: '#0f172a', borderRadius: 6, padding: 12, marginBottom: 10 }}>
                  <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Complaint Types</div>
                  {g.complaint_types.map((t, i) => (
                    <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 4, alignItems: 'center' }}>
                      <span style={{ color: riskColors[t.probability] ?? '#94a3b8', fontSize: 11, fontWeight: 700, width: 70, flexShrink: 0 }}>{t.probability}</span>
                      <span style={{ color: '#f1f5f9', fontSize: 12 }}>{t.label}</span>
                    </div>
                  ))}
                </div>
              )}
              {g.defense_cost_estimate && (
                <div style={{ background: '#0f172a', borderRadius: 6, padding: 12 }}>
                  <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Defense Cost Estimate</div>
                  <div style={{ color: '#f1f5f9', fontSize: 12 }}>
                    ${g.defense_cost_estimate.total_estimated_usd?.low?.toLocaleString()} – ${g.defense_cost_estimate.total_estimated_usd?.high?.toLocaleString()}
                  </div>
                </div>
              )}
            </div>
          );
        })()}

        {/* AM Broadcast Translator Path Guide */}
        {candidate.am_broadcast_translator_path_guide && (() => {
          const g = candidate.am_broadcast_translator_path_guide;
          const fm = g.fm_translator;
          return (
            <div style={{ background: '#1e293b', borderRadius: 8, padding: 16, marginBottom: 16 }}>
              <h4 style={{ color: '#f1f5f9', margin: '0 0 12px', fontSize: 14, fontWeight: 600 }}>
                AM-to-FM Translator Path <span style={{ color: '#94a3b8', fontWeight: 400, fontSize: 12 }}>§74.1201</span>
              </h4>
              <div style={{ display: 'flex', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
                <div style={{ background: '#0f172a', borderRadius: 6, padding: '8px 14px', flex: '1 1 130px' }}>
                  <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 4 }}>Max FM ERP</div>
                  <div style={{ color: '#34d399', fontSize: 15, fontWeight: 700 }}>{fm?.max_erp_w ?? '—'}W</div>
                </div>
                <div style={{ background: '#0f172a', borderRadius: 6, padding: '8px 14px', flex: '1 1 130px' }}>
                  <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 4 }}>FM 60 dBu Radius</div>
                  <div style={{ color: '#f1f5f9', fontSize: 15, fontWeight: 600 }}>{fm?.estimated_60dbu_radius_km ?? '—'} km</div>
                </div>
                <div style={{ background: '#0f172a', borderRadius: 6, padding: '8px 14px', flex: '1 1 130px' }}>
                  <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 4 }}>AM 2 mV/m Radius</div>
                  <div style={{ color: '#f1f5f9', fontSize: 15, fontWeight: 600 }}>{g.am_2mvm_coverage_radius_km ?? '—'} km</div>
                </div>
              </div>
              {g.restrictions && g.restrictions.length > 0 && (
                <div style={{ background: '#0f172a', borderRadius: 6, padding: 12, marginBottom: 10 }}>
                  <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Key Restrictions</div>
                  {g.restrictions.filter(r => r.severity === 'HARD').map((r, i) => (
                    <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 4, alignItems: 'flex-start' }}>
                      <span style={{ color: '#f87171', fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap', marginTop: 1 }}>{r.cfr}</span>
                      <span style={{ color: '#f1f5f9', fontSize: 12 }}>{r.label}</span>
                    </div>
                  ))}
                </div>
              )}
              {g.filing_steps && g.filing_steps.length > 0 && (
                <div style={{ background: '#0f172a', borderRadius: 6, padding: 12 }}>
                  <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Filing Steps ({g.n_filing_steps})</div>
                  {g.filing_steps.map((s, i) => (
                    <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 4, alignItems: 'flex-start' }}>
                      <span style={{ color: '#818cf8', fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap', marginTop: 1 }}>Step {s.step}</span>
                      <span style={{ color: '#f1f5f9', fontSize: 12 }}>{s.action}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })()}

        {/* Daytime Only Operation Guide */}
        {candidate.daytime_only_operation_guide && (() => {
          const d = candidate.daytime_only_operation_guide;
          const statusColor = d.is_daytime_only ? '#fbbf24' : '#34d399';
          return (
            <div style={{ background: '#1e293b', borderRadius: 8, padding: 16, marginBottom: 16 }}>
              <h4 style={{ color: '#f1f5f9', margin: '0 0 12px', fontSize: 14, fontWeight: 600 }}>
                Daytime-Only Operation Guide <span style={{ color: '#94a3b8', fontWeight: 400, fontSize: 12 }}>§73.99</span>
              </h4>
              <div style={{ display: 'flex', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
                <div style={{ background: '#0f172a', borderRadius: 6, padding: '8px 14px', flex: '1 1 140px' }}>
                  <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 4 }}>Operating Status</div>
                  <div style={{ color: statusColor, fontSize: 15, fontWeight: 700 }}>
                    {d.is_daytime_only ? 'DAYTIME ONLY' : 'FULL TIME'}
                  </div>
                </div>
                <div style={{ background: '#0f172a', borderRadius: 6, padding: '8px 14px', flex: '1 1 120px' }}>
                  <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 4 }}>Est. Hrs/Day</div>
                  <div style={{ color: '#f1f5f9', fontSize: 15, fontWeight: 600 }}>{d.operating_hours?.estimated_hours_per_day ?? '—'}</div>
                </div>
                <div style={{ background: '#0f172a', borderRadius: 6, padding: '8px 14px', flex: '1 1 120px' }}>
                  <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 4 }}>Summer Hrs</div>
                  <div style={{ color: '#f1f5f9', fontSize: 15, fontWeight: 600 }}>{d.operating_hours?.estimated_hours_summer ?? '—'}</div>
                </div>
                <div style={{ background: '#0f172a', borderRadius: 6, padding: '8px 14px', flex: '1 1 120px' }}>
                  <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 4 }}>Winter Hrs</div>
                  <div style={{ color: '#f1f5f9', fontSize: 15, fontWeight: 600 }}>{d.operating_hours?.estimated_hours_winter ?? '—'}</div>
                </div>
              </div>
              {d.psa_pra && (
                <div style={{ background: '#0f172a', borderRadius: 6, padding: 12, marginBottom: 10 }}>
                  <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Post-Sunset / Pre-Sunrise Authority</div>
                  <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                    <div>
                      <span style={{ color: '#818cf8', fontSize: 12, fontWeight: 600 }}>PSA </span>
                      <span style={{ color: '#f1f5f9', fontSize: 12 }}>
                        {d.psa_pra.psa_available ? `${d.psa_pra.psa_duration_min} min post-sunset, max ${d.psa_pra.psa_max_power_w}W` : 'Not available'} ({d.psa_pra.psa_cfr})
                      </span>
                    </div>
                    <div>
                      <span style={{ color: '#818cf8', fontSize: 12, fontWeight: 600 }}>PRA </span>
                      <span style={{ color: '#f1f5f9', fontSize: 12 }}>
                        {d.psa_pra.pra_available ? `Up to ${d.psa_pra.pra_max_hours_before_sunrise} hr pre-sunrise` : 'Not available'} ({d.psa_pra.pra_cfr})
                      </span>
                    </div>
                  </div>
                </div>
              )}
              {d.fulltime_upgrade && (
                <div style={{ background: '#0f172a', borderRadius: 6, padding: 12, marginBottom: 10 }}>
                  <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Full-Time Upgrade Path</div>
                  <div style={{ color: d.fulltime_upgrade.eligible ? '#34d399' : '#f87171', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
                    {d.fulltime_upgrade.eligible ? 'Eligible to Apply' : 'Not Eligible'}
                  </div>
                  {d.fulltime_upgrade.eligible && (
                    <div style={{ color: '#94a3b8', fontSize: 11 }}>
                      Timeline: {d.fulltime_upgrade.processing_weeks?.min}–{d.fulltime_upgrade.processing_weeks?.max} weeks typical
                    </div>
                  )}
                </div>
              )}
              {d.operating_constraints && d.operating_constraints.length > 0 && (
                <div style={{ background: '#0f172a', borderRadius: 6, padding: 12 }}>
                  <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Operating Constraints</div>
                  {d.operating_constraints.map((oc, i) => (
                    <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 4, alignItems: 'flex-start' }}>
                      <span style={{ color: '#fbbf24', fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap', marginTop: 1 }}>{oc.cfr}</span>
                      <span style={{ color: '#f1f5f9', fontSize: 12 }}>{oc.label}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })()}

        {/* Ownership Multiple Rules Guide */}
        {candidate.ownership_multiple_rules_guide && (() => {
          const o = candidate.ownership_multiple_rules_guide;
          const riskColors = { LOW: '#34d399', MODERATE: '#fbbf24', HIGH: '#f87171' };
          const attrib = (o.attributable_interests || []).filter(i => i.attributable);
          return (
            <div>
              <h4 style={{ color: '#38bdf8', marginBottom: 6, fontSize: 13, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' }}>
                Ownership / Multiple Rules (§73.3555)
              </h4>
              <div style={{ background: '#020c18', borderRadius: 6, padding: '10px 12px', marginBottom: 8, fontSize: 12 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 12px' }}>
                  <span style={{ color: '#94a3b8' }}>Local AM Limit</span>
                  <span style={{ color: '#e2e8f0', fontWeight: 700 }}>{o.local_am_limit} stations (large market)</span>
                  <span style={{ color: '#94a3b8' }}>AM+FM Combo Limit</span>
                  <span style={{ color: '#e2e8f0', fontWeight: 700 }}>{o.local_radio_combo_limit} total (large market)</span>
                  <span style={{ color: '#94a3b8' }}>Attribution Risk</span>
                  <span style={{ color: riskColors[o.attribution_risk_level] || '#e2e8f0', fontWeight: 700 }}>{o.attribution_risk_level}</span>
                  <span style={{ color: '#94a3b8' }}>Attributable Types</span>
                  <span style={{ color: '#e2e8f0', fontWeight: 600 }}>{o.n_attributable_types}</span>
                </div>
                {o.relocation_impact_note && (
                  <div style={{ color: '#94a3b8', fontSize: 11, marginTop: 6, fontStyle: 'italic' }}>{o.relocation_impact_note}</div>
                )}
              </div>
              {/* Market size tiers */}
              <div style={{ marginBottom: 8 }}>
                <div style={{ color: '#94a3b8', fontSize: 11, fontWeight: 600, letterSpacing: 0.5, marginBottom: 4 }}>MARKET SIZE LIMITS (§73.3555(a))</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4 }}>
                  {(o.market_size_tiers || []).map(t => (
                    <div key={t.market_size} style={{ background: '#020c18', borderRadius: 4, padding: '5px 6px', fontSize: 11 }}>
                      <div style={{ color: '#94a3b8', fontSize: 10, marginBottom: 2 }}>{t.market_size.split(' ')[0]}</div>
                      <div style={{ color: '#e2e8f0' }}>AM: <span style={{ color: '#fbbf24', fontWeight: 700 }}>{t.max_am}</span></div>
                      <div style={{ color: '#e2e8f0' }}>Total: <span style={{ color: '#34d399', fontWeight: 700 }}>{t.max_total}</span></div>
                    </div>
                  ))}
                </div>
              </div>
              {/* Attributable interests */}
              <div style={{ marginBottom: 8 }}>
                <div style={{ color: '#94a3b8', fontSize: 11, fontWeight: 600, letterSpacing: 0.5, marginBottom: 4 }}>ATTRIBUTABLE INTERESTS</div>
                {attrib.map(i => (
                  <div key={i.id} style={{ background: '#020c18', borderRadius: 4, padding: '5px 10px', marginBottom: 3, fontSize: 12, display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: '#e2e8f0' }}>{i.label}</span>
                    <span style={{ color: '#38bdf8', fontSize: 11 }}>{i.cfr}</span>
                  </div>
                ))}
              </div>
              {/* Practical steps */}
              {(o.practical_steps || []).length > 0 && (
                <div style={{ background: '#020c18', borderRadius: 6, padding: '8px 10px', marginBottom: 8 }}>
                  <div style={{ color: '#94a3b8', fontSize: 11, fontWeight: 600, marginBottom: 4 }}>ACTION STEPS</div>
                  {(o.practical_steps || []).map((step, i) => (
                    <div key={i} style={{ color: '#e2e8f0', fontSize: 11, marginBottom: 3, paddingLeft: 8 }}>• {step}</div>
                  ))}
                </div>
              )}
              <div style={{ color: '#475569', fontSize: 10, marginTop: 4 }}>{o.reference}</div>
            </div>
          );
        })()}

        {/* Adjacent Channel Protection Guide */}
        {candidate.adjacent_channel_protection_guide && (() => {
          const g = candidate.adjacent_channel_protection_guide;
          const a10 = g.adjacent_10khz || {};
          const a20 = g.adjacent_20khz || {};
          return (
            <div>
              <h4 style={{ color: '#38bdf8', marginBottom: 6, fontSize: 13, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' }}>
                Adjacent Channel Protection (§73.182 Table 1)
              </h4>
              <div style={{ background: '#020c18', borderRadius: 6, padding: '10px 12px', marginBottom: 8, fontSize: 12 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '6px 8px' }}>
                  <span style={{ color: '#94a3b8' }}>Separation</span>
                  <span style={{ color: '#94a3b8' }}>Channels</span>
                  <span style={{ color: '#94a3b8' }}>D/U Required</span>
                  <span style={{ color: '#fbbf24', fontWeight: 700 }}>±10 kHz (1st adj)</span>
                  <span style={{ color: '#e2e8f0' }}>{a10.lower_channel_khz}/{a10.upper_channel_khz}</span>
                  <span style={{ color: '#f87171', fontWeight: 700 }}>{a10.required_du_db} dB</span>
                  <span style={{ color: '#fbbf24', fontWeight: 700 }}>±20 kHz (2nd adj)</span>
                  <span style={{ color: '#e2e8f0' }}>{a20.lower_channel_khz}/{a20.upper_channel_khz}</span>
                  <span style={{ color: '#34d399', fontWeight: 700 }}>{a20.required_du_db} dB</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 12px', marginTop: 8 }}>
                  <span style={{ color: '#94a3b8' }}>Primary Reach</span>
                  <span style={{ color: '#e2e8f0', fontWeight: 600 }}>{g.candidate_primary_reach_km} km</span>
                  <span style={{ color: '#94a3b8' }}>Channels to Check</span>
                  <span style={{ color: '#e2e8f0', fontWeight: 600 }}>{g.n_adjacent_channels_checked}</span>
                </div>
              </div>
              {/* Sideband rolloff */}
              <div style={{ background: '#020c18', borderRadius: 6, padding: '8px 10px', marginBottom: 8, fontSize: 12 }}>
                <div style={{ color: '#94a3b8', fontWeight: 700, marginBottom: 5, fontSize: 11 }}>SIDEBAND ROLLOFF</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4 }}>
                  {(g.sideband_rolloff || []).map(sr => (
                    <div key={sr.offset_khz} style={{ background: '#0f172a', borderRadius: 4, padding: '5px 6px', textAlign: 'center' }}>
                      <div style={{ color: '#94a3b8', fontSize: 10 }}>±{sr.offset_khz} kHz</div>
                      <div style={{ color: '#f87171', fontWeight: 700, fontSize: 13 }}>−{sr.rolloff_db} dB</div>
                    </div>
                  ))}
                </div>
              </div>
              {/* Assessment notes */}
              {(g.assessment_notes || []).length > 0 && (
                <div style={{ background: '#020c18', borderRadius: 6, padding: '8px 10px', marginBottom: 8 }}>
                  <div style={{ color: '#94a3b8', fontSize: 11, fontWeight: 600, marginBottom: 5 }}>ANALYSIS GUIDANCE</div>
                  {(g.assessment_notes || []).map((note, i) => (
                    <div key={i} style={{ color: '#e2e8f0', fontSize: 11, marginBottom: 3, paddingLeft: 8 }}>• {note}</div>
                  ))}
                </div>
              )}
              <div style={{ color: '#475569', fontSize: 10, marginTop: 4 }}>{g.reference}</div>
              {g.note && <div style={{ color: '#64748b', fontSize: 10, marginTop: 3, fontStyle: 'italic' }}>{g.note}</div>}
            </div>
          );
        })()}

        {/* Main Studio Rule Guide */}
        {candidate.main_studio_rule_guide && (() => {
          const m = candidate.main_studio_rule_guide;
          const obs = m.current_obligations || [];
          return (
            <div>
              <h4 style={{ color: '#38bdf8', marginBottom: 6, fontSize: 13, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' }}>
                Main Studio Rule (§73.1125 — Repealed Nov 2017)
              </h4>
              <div style={{ background: '#020c18', borderRadius: 6, padding: '10px 12px', marginBottom: 8, fontSize: 12 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 12px' }}>
                  <span style={{ color: '#94a3b8' }}>Studio Required</span>
                  <span style={{ color: '#34d399', fontWeight: 700 }}>{m.main_studio_required ? 'YES' : 'NO (Repealed)'}</span>
                  <span style={{ color: '#94a3b8' }}>Repeal Date</span>
                  <span style={{ color: '#e2e8f0', fontWeight: 600 }}>{m.repeal_date}</span>
                  <span style={{ color: '#94a3b8' }}>Authority</span>
                  <span style={{ color: '#e2e8f0', fontWeight: 600 }}>{m.repeal_doc}</span>
                  <span style={{ color: '#94a3b8' }}>Waiver Needed</span>
                  <span style={{ color: '#34d399', fontWeight: 700 }}>{m.waiver_eligible ? 'YES' : 'NO (N/A)'}</span>
                  <span style={{ color: '#94a3b8' }}>Dist. from Current</span>
                  <span style={{ color: '#e2e8f0', fontWeight: 600 }}>{m.distance_from_col_km} km</span>
                </div>
                {m.col_proximity_note && (
                  <div style={{ color: '#94a3b8', fontSize: 11, marginTop: 6, fontStyle: 'italic' }}>{m.col_proximity_note}</div>
                )}
              </div>
              {/* Current obligations */}
              <div style={{ marginBottom: 8 }}>
                <div style={{ color: '#94a3b8', fontSize: 11, fontWeight: 600, letterSpacing: 0.5, marginBottom: 4 }}>CURRENT OBLIGATIONS (post-repeal)</div>
                {obs.map(ob => (
                  <div key={ob.id} style={{ background: '#020c18', borderRadius: 4, padding: '5px 10px', marginBottom: 4, fontSize: 12 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: '#e2e8f0', fontWeight: 600 }}>{ob.label}</span>
                      <span style={{ color: '#38bdf8', fontSize: 11 }}>{ob.cfr}</span>
                    </div>
                    <div style={{ color: '#64748b', fontSize: 11, marginTop: 2 }}>{ob.notes}</div>
                  </div>
                ))}
              </div>
              {/* Practical guidance */}
              {(m.practical_guidance || []).length > 0 && (
                <div style={{ background: '#020c18', borderRadius: 6, padding: '8px 10px', marginBottom: 8 }}>
                  <div style={{ color: '#94a3b8', fontSize: 11, fontWeight: 600, marginBottom: 5 }}>PRACTICAL GUIDANCE</div>
                  {(m.practical_guidance || []).map((tip, i) => (
                    <div key={i} style={{ color: '#e2e8f0', fontSize: 11, marginBottom: 3, paddingLeft: 8 }}>• {tip}</div>
                  ))}
                </div>
              )}
              <div style={{ color: '#475569', fontSize: 10, marginTop: 4 }}>{m.reference}</div>
              {m.note && <div style={{ color: '#64748b', fontSize: 10, marginTop: 3, fontStyle: 'italic' }}>{m.note}</div>}
            </div>
          );
        })()}

        {/* Silent Station Consideration */}
        {candidate.silent_station_consideration && (() => {
          const s = candidate.silent_station_consideration;
          const ct = s.construction_timeline || {};
          const sa = s.silent_authorization || {};
          const riskColors = { LOW: '#34d399', MODERATE: '#fbbf24', HIGH: '#f87171' };
          return (
            <div>
              <h4 style={{ color: '#38bdf8', marginBottom: 6, fontSize: 13, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' }}>
                Silent Station & Construction (§73.1740 / §73.3534)
              </h4>
              <div style={{ background: '#020c18', borderRadius: 6, padding: '10px 12px', marginBottom: 8, fontSize: 12 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 12px' }}>
                  <span style={{ color: '#94a3b8' }}>License Risk</span>
                  <span style={{ color: riskColors[s.license_risk_level] || '#e2e8f0', fontWeight: 700 }}>{s.license_risk_level}</span>
                  <span style={{ color: '#94a3b8' }}>Max Silent</span>
                  <span style={{ color: '#e2e8f0', fontWeight: 600 }}>{sa.max_silent_weeks} weeks (§73.1740)</span>
                  <span style={{ color: '#94a3b8' }}>Build: Typical</span>
                  <span style={{ color: ct.construction_weeks_typical > 52 ? '#f87171' : '#34d399', fontWeight: 700 }}>{ct.construction_weeks_typical} weeks</span>
                  <span style={{ color: '#94a3b8' }}>Build: Range</span>
                  <span style={{ color: '#e2e8f0', fontWeight: 600 }}>{ct.construction_weeks_min}–{ct.construction_weeks_max} weeks</span>
                  <span style={{ color: '#94a3b8' }}>STA Form</span>
                  <span style={{ color: '#e2e8f0', fontWeight: 600 }}>{sa.initial_sta_form}</span>
                </div>
                {s.exceeds_silent_limit && (
                  <div style={{ color: '#f87171', fontSize: 11, marginTop: 6, fontWeight: 600 }}>
                    ⚠ Typical construction may exceed 12-month silent limit — mitigation required
                  </div>
                )}
              </div>
              {/* Construction Steps */}
              <div style={{ marginBottom: 8 }}>
                <div style={{ color: '#94a3b8', fontSize: 11, fontWeight: 600, letterSpacing: 0.5, marginBottom: 4 }}>CONSTRUCTION PHASES</div>
                {(ct.steps || []).map(step => (
                  <div key={step.id} style={{ background: '#020c18', borderRadius: 4, padding: '5px 10px', marginBottom: 4, fontSize: 12 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: '#e2e8f0', fontWeight: 600 }}>{step.label}</span>
                      <span style={{ color: '#fbbf24', fontSize: 11, fontWeight: 700 }}>{step.weeks_low}–{step.weeks_high} wks</span>
                    </div>
                    <div style={{ color: '#64748b', fontSize: 10, marginTop: 2 }}>{step.notes}</div>
                  </div>
                ))}
              </div>
              {/* Mitigation Strategies */}
              <div style={{ marginBottom: 8 }}>
                <div style={{ color: '#94a3b8', fontSize: 11, fontWeight: 600, letterSpacing: 0.5, marginBottom: 4 }}>MITIGATION STRATEGIES</div>
                {(s.mitigation_strategies || []).slice(0, 3).map(m => (
                  <div key={m.id} style={{ background: '#020c18', borderRadius: 4, padding: '5px 10px', marginBottom: 4, fontSize: 12 }}>
                    <div style={{ color: '#34d399', fontWeight: 600, marginBottom: 2 }}>{m.label}</div>
                    <div style={{ color: '#64748b', fontSize: 11 }}>{m.notes}</div>
                  </div>
                ))}
              </div>
              <div style={{ color: '#475569', fontSize: 10, marginTop: 4 }}>{s.reference}</div>
              {s.note && <div style={{ color: '#64748b', fontSize: 10, marginTop: 3, fontStyle: 'italic' }}>{s.note}</div>}
            </div>
          );
        })()}

        {/* AM Propagation Variability Guide */}
        {candidate.am_propagation_variability_guide && (() => {
          const g = candidate.am_propagation_variability_guide;
          const sv = g.seasonal_variation || {};
          const sk = g.ionospheric_skip || {};
          const mit = g.mitigation_options || [];
          const channelColors = { CLEAR: '#34d399', REGIONAL: '#fbbf24', LOCAL: '#f87171' };
          return (
            <div>
              <h4 style={{ color: '#38bdf8', marginBottom: 6, fontSize: 13, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' }}>
                AM Propagation Variability (§73.182 / ITU-R P.368)
              </h4>
              <div style={{ background: '#020c18', borderRadius: 6, padding: '10px 12px', marginBottom: 8, fontSize: 12 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 12px' }}>
                  <span style={{ color: '#94a3b8' }}>Channel Type</span>
                  <span style={{ color: channelColors[g.channel_type] || '#e2e8f0', fontWeight: 700 }}>{g.channel_type}</span>
                  <span style={{ color: '#94a3b8' }}>Frequency</span>
                  <span style={{ color: '#e2e8f0', fontWeight: 600 }}>{g.frequency_khz} kHz</span>
                  <span style={{ color: '#94a3b8' }}>Soil σ (Site)</span>
                  <span style={{ color: '#e2e8f0', fontWeight: 600 }}>{g.sigma_msm} mS/m</span>
                  <span style={{ color: '#94a3b8' }}>Seasonal Swing</span>
                  <span style={{ color: '#fbbf24', fontWeight: 700 }}>{sv.worst_case_change_pct}% to +{sv.best_case_change_pct}%</span>
                  <span style={{ color: '#94a3b8' }}>Worst Season</span>
                  <span style={{ color: '#f87171', fontWeight: 600 }}>{sv.worst_case_season}</span>
                  <span style={{ color: '#94a3b8' }}>Best Season</span>
                  <span style={{ color: '#34d399', fontWeight: 600 }}>{sv.best_case_season}</span>
                </div>
              </div>
              {/* Seasonal Breakdown */}
              <div style={{ marginBottom: 8 }}>
                <div style={{ color: '#94a3b8', fontSize: 11, fontWeight: 600, letterSpacing: 0.5, marginBottom: 4 }}>SEASONAL GROUNDWAVE VARIATION</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4 }}>
                  {(sv.seasons || []).map(s => (
                    <div key={s.id} style={{ background: '#020c18', borderRadius: 4, padding: '6px 8px', fontSize: 11 }}>
                      <div style={{ color: '#e2e8f0', fontWeight: 700, marginBottom: 2 }}>{s.id}</div>
                      <div style={{ color: s.coverage_factor >= 1 ? '#34d399' : '#f87171', fontWeight: 700 }}>
                        {s.coverage_factor >= 1 ? '+' : ''}{Math.round((s.coverage_factor - 1) * 100)}%
                      </div>
                      <div style={{ color: '#64748b', fontSize: 10, marginTop: 2 }}>{s.notes?.split(';')[0]}</div>
                    </div>
                  ))}
                </div>
              </div>
              {/* Ionospheric Skip */}
              <div style={{ background: '#020c18', borderRadius: 6, padding: '10px 12px', marginBottom: 8, fontSize: 12 }}>
                <div style={{ color: '#fbbf24', fontWeight: 700, marginBottom: 6 }}>Ionospheric Skip (Skywave)</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '5px 12px' }}>
                  <span style={{ color: '#94a3b8' }}>Skip Zone</span>
                  <span style={{ color: '#e2e8f0', fontWeight: 600 }}>{sk.min_skip_distance_km}–{sk.max_skip_distance_km} km</span>
                  <span style={{ color: '#94a3b8' }}>Night Boost</span>
                  <span style={{ color: '#34d399', fontWeight: 600 }}>+{sk.typical_night_boost_db} dB</span>
                  <span style={{ color: '#94a3b8' }}>Interference Risk</span>
                  <span style={{ color: sk.interference_risk?.startsWith('LOW') ? '#34d399' : sk.interference_risk?.startsWith('MODERATE') ? '#fbbf24' : '#f87171', fontWeight: 600, fontSize: 11 }}>
                    {sk.interference_risk?.split(' — ')[0]}
                  </span>
                </div>
                {sk.interference_risk && (
                  <div style={{ color: '#94a3b8', fontSize: 10, marginTop: 5, fontStyle: 'italic' }}>{sk.interference_risk.split(' — ')[1]}</div>
                )}
              </div>
              {/* Mitigation Options */}
              {mit.length > 0 && (
                <div style={{ marginBottom: 8 }}>
                  <div style={{ color: '#94a3b8', fontSize: 11, fontWeight: 600, letterSpacing: 0.5, marginBottom: 4 }}>MITIGATION OPTIONS</div>
                  {mit.map(m => (
                    <div key={m.id} style={{ background: '#020c18', borderRadius: 4, padding: '6px 10px', marginBottom: 4, fontSize: 12, display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                      <span style={{ color: m.effectiveness === 'HIGH' ? '#34d399' : '#fbbf24', fontWeight: 700, minWidth: 70 }}>{m.effectiveness}</span>
                      <div>
                        <div style={{ color: '#e2e8f0', fontWeight: 600, marginBottom: 2 }}>{m.label}</div>
                        <div style={{ color: '#64748b', fontSize: 11 }}>{m.notes}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <div style={{ color: '#475569', fontSize: 10, marginTop: 4 }}>{g.reference}</div>
              {g.note && <div style={{ color: '#64748b', fontSize: 10, marginTop: 3, fontStyle: 'italic' }}>{g.note}</div>}
            </div>
          );
        })()}

        {/* Adjacent Market Coverage Analysis */}
        {candidate.adjacent_market_coverage_analysis && (() => {
          const a = candidate.adjacent_market_coverage_analysis;
          const primary = (a.coverage_zones || []).find(z => z.id === 'PRIMARY');
          const colMin  = (a.coverage_zones || []).find(z => z.id === 'COL_MINIMUM');
          const ifZone  = (a.coverage_zones || []).find(z => z.id === 'INTERFERENCE_FREE');
          const tr = a.translator_opportunity || {};
          return (
            <div>
              <h4 style={{ color: '#38bdf8', marginBottom: 6, fontSize: 13, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' }}>
                Adjacent Market Coverage Analysis (§73.182 / §73.187)
              </h4>
              <div style={{ background: '#020c18', borderRadius: 6, padding: '10px 12px', marginBottom: 8, fontSize: 12 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 12px' }}>
                  <span style={{ color: '#94a3b8' }}>FCC Class</span>
                  <span style={{ color: '#e2e8f0', fontWeight: 600 }}>{a.fcc_class}</span>
                  <span style={{ color: '#94a3b8' }}>Frequency</span>
                  <span style={{ color: '#e2e8f0', fontWeight: 600 }}>{a.frequency_khz} kHz</span>
                  <span style={{ color: '#94a3b8' }}>TPO</span>
                  <span style={{ color: '#e2e8f0', fontWeight: 600 }}>{a.tpo_kw} kW</span>
                  <span style={{ color: '#94a3b8' }}>Primary Reach</span>
                  <span style={{ color: '#34d399', fontWeight: 700 }}>{a.primary_service_radius_km} km ({a.primary_service_area_km2} km²)</span>
                  <span style={{ color: '#94a3b8' }}>COL Day Min</span>
                  <span style={{ color: '#e2e8f0', fontWeight: 600 }}>{a.col_field_thresholds?.day_mvm} mV/m</span>
                  <span style={{ color: '#94a3b8' }}>COL Night Min</span>
                  <span style={{ color: '#e2e8f0', fontWeight: 600 }}>{a.col_field_thresholds?.night_mvm != null ? `${a.col_field_thresholds.night_mvm} mV/m` : 'N/A (secondary)'}</span>
                </div>
              </div>
              {/* Coverage Zones */}
              <div style={{ marginBottom: 8 }}>
                <div style={{ color: '#94a3b8', fontSize: 11, fontWeight: 600, letterSpacing: 0.5, marginBottom: 4 }}>COVERAGE ZONES</div>
                {[primary, colMin, ifZone].filter(Boolean).map(z => (
                  <div key={z.id} style={{ background: '#020c18', borderRadius: 4, padding: '7px 10px', marginBottom: 5, fontSize: 12 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
                      <span style={{ color: '#f1f5f9', fontWeight: 600 }}>{z.label}</span>
                      <span style={{ color: '#38bdf8', fontSize: 11 }}>{z.cfr}</span>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '4px 8px' }}>
                      <span style={{ color: '#94a3b8' }}>Threshold</span>
                      <span style={{ color: '#94a3b8' }}>Radius</span>
                      <span style={{ color: '#94a3b8' }}>Area</span>
                      <span style={{ color: '#34d399', fontWeight: 700 }}>{z.threshold_mvm} mV/m</span>
                      <span style={{ color: '#e2e8f0', fontWeight: 600 }}>{z.radius_km} km</span>
                      <span style={{ color: '#e2e8f0', fontWeight: 600 }}>{z.area_km2} km²</span>
                    </div>
                    <div style={{ color: '#94a3b8', fontSize: 11, marginTop: 3 }}>{z.service_quality}</div>
                  </div>
                ))}
              </div>
              {/* FM Translator Opportunity */}
              <div style={{ background: '#020c18', borderRadius: 6, padding: '10px 12px', marginBottom: 8 }}>
                <div style={{ color: '#fbbf24', fontSize: 12, fontWeight: 700, marginBottom: 6 }}>
                  FM Translator Opportunity — {tr.authorized ? '✓ Authorized' : 'Not Available'}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '5px 12px', fontSize: 12 }}>
                  <span style={{ color: '#94a3b8' }}>Max ERP</span>
                  <span style={{ color: '#e2e8f0', fontWeight: 600 }}>{tr.max_erp_w} W</span>
                  <span style={{ color: '#94a3b8' }}>FM Band</span>
                  <span style={{ color: '#e2e8f0', fontWeight: 600 }}>{tr.fm_band}</span>
                  <span style={{ color: '#94a3b8' }}>Form</span>
                  <span style={{ color: '#e2e8f0', fontWeight: 600 }}>{tr.application_form}</span>
                  <span style={{ color: '#94a3b8' }}>Filing Fee</span>
                  <span style={{ color: '#e2e8f0', fontWeight: 600 }}>${tr.filing_fee_usd?.toLocaleString()}</span>
                </div>
                {tr.coverage_note && (
                  <div style={{ color: '#94a3b8', fontSize: 11, marginTop: 6, fontStyle: 'italic' }}>{tr.coverage_note}</div>
                )}
              </div>
              <div style={{ color: '#475569', fontSize: 10, marginTop: 4 }}>{a.reference}</div>
              {a.note && <div style={{ color: '#64748b', fontSize: 10, marginTop: 3, fontStyle: 'italic' }}>{a.note}</div>}
            </div>
          );
        })()}

        {/* License Renewal Compliance Guide */}
        {candidate.license_renewal_compliance_guide && (() => {
          const l = candidate.license_renewal_compliance_guide;
          const reqOpif = (l.opif_requirements || []).filter(o => o.required);
          return (
            <div>
              <h4 style={{ color: '#38bdf8', marginBottom: 6, fontSize: 13, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' }}>
                License Renewal Compliance (§73.3539)
              </h4>
              <div style={{ background: '#020c18', borderRadius: 6, padding: '10px 12px', marginBottom: 8, fontSize: 12 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 12px' }}>
                  <div><span style={{ color: '#9ca3af' }}>FCC class:</span> <strong style={{ color: '#38bdf8' }}>{l.fcc_class || '—'}</strong></div>
                  <div><span style={{ color: '#9ca3af' }}>License term:</span> <strong>{l.license_term_years != null ? `${l.license_term_years} years` : '—'}</strong></div>
                  <div><span style={{ color: '#9ca3af' }}>Renewal form:</span> <strong>{l.renewal_form || 'FCC Form 303-S'}</strong></div>
                  <div><span style={{ color: '#9ca3af' }}>Renewal fee:</span> <strong style={{ color: '#f59e0b' }}>{l.renewal_filing_fee_usd != null ? `$${l.renewal_filing_fee_usd}` : '—'}</strong></div>
                  <div><span style={{ color: '#9ca3af' }}>OPIF required items:</span> <strong>{l.n_opif_required ?? '—'}</strong></div>
                  <div><span style={{ color: '#9ca3af' }}>Publication req'd:</span> <strong style={{ color: l.renewal_cycle?.publication_required ? '#22c55e' : '#9ca3af' }}>{l.renewal_cycle?.publication_required ? 'Yes (§73.3580)' : 'No'}</strong></div>
                  <div><span style={{ color: '#9ca3af' }}>EEO outreach/yr:</span> <strong>{l.eeo_obligations?.outreach_initiatives_per_year ?? '—'} initiatives</strong></div>
                  <div><span style={{ color: '#9ca3af' }}>Form 323 freq.:</span> <strong>Biennial (even years)</strong></div>
                </div>
              </div>
              <div style={{ marginBottom: 6 }}>
                <div style={{ color: '#9ca3af', fontSize: 11, marginBottom: 4 }}>Required OPIF Items (§73.3526)</div>
                {reqOpif.slice(0, 5).map((o, i) => (
                  <div key={i} style={{ display: 'flex', gap: 6, fontSize: 10, marginBottom: 2 }}>
                    <span style={{ color: '#38bdf8', minWidth: 8 }}>●</span>
                    <div>
                      <span style={{ color: '#d1d5db', fontWeight: 600 }}>{o.label}</span>
                      <span style={{ color: '#6b7280' }}> — {o.update_freq}</span>
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ color: '#4b5563', fontSize: 10 }}>{l.reference}</div>
            </div>
          );
        })()}

        {/* Nighttime Pattern Switching Guide */}
        {candidate.nighttime_pattern_switching_guide && (() => {
          const n = candidate.nighttime_pattern_switching_guide;
          const asid = n.asid_requirements;
          return (
            <div>
              <h4 style={{ color: '#c4b5fd', marginBottom: 6, fontSize: 13, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' }}>
                Nighttime Pattern Switching (§73.99)
              </h4>
              <div style={{ background: '#0d0a1a', borderRadius: 6, padding: '10px 12px', marginBottom: 8, fontSize: 12 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 12px' }}>
                  <div><span style={{ color: '#9ca3af' }}>FCC class:</span> <strong style={{ color: '#c4b5fd' }}>{n.fcc_class || '—'}</strong></div>
                  <div><span style={{ color: '#9ca3af' }}>Clear channel:</span> <strong style={{ color: n.is_clear_channel ? '#fbbf24' : '#22c55e' }}>{n.is_clear_channel ? 'Yes' : 'No'}</strong></div>
                  <div><span style={{ color: '#9ca3af' }}>DA pattern:</span> <strong>{n.is_da_pattern ? 'Yes' : 'No'}</strong></div>
                  <div><span style={{ color: '#9ca3af' }}>Night power reduction:</span> <strong style={{ color: n.power_reduction_required ? '#ef4444' : '#22c55e' }}>{n.power_reduction_required ? 'Required' : 'Not required'}</strong></div>
                  <div><span style={{ color: '#9ca3af' }}>Pattern switch req'd:</span> <strong style={{ color: n.pattern_switch_required ? '#ef4444' : '#22c55e' }}>{n.pattern_switch_required ? 'Yes (DA-N)' : 'No'}</strong></div>
                  <div><span style={{ color: '#9ca3af' }}>ASID required:</span> <strong style={{ color: asid?.required ? '#ef4444' : '#22c55e' }}>{asid?.required ? 'Yes' : 'No'}</strong></div>
                  <div style={{ gridColumn: '1 / -1' }}><span style={{ color: '#9ca3af' }}>Night operation:</span> <span style={{ color: '#d1d5db', fontSize: 10 }}>{n.nighttime_obligation?.night_operation}</span></div>
                </div>
              </div>
              {asid?.required && (
                <div style={{ background: '#080614', borderRadius: 4, padding: '6px 8px', fontSize: 11, marginBottom: 6 }}>
                  <span style={{ color: '#c4b5fd', fontWeight: 700 }}>ASID (§73.1745): </span>
                  <span style={{ color: '#d1d5db' }}>Auto Station ID Device required — triggers pattern switch at correct SR/SS, logs transitions, and alarms on current deviation. Est. ${asid.cost_est_usd?.toLocaleString()}.</span>
                </div>
              )}
              <div style={{ color: '#9ca3af', fontSize: 11, marginBottom: 3 }}>Operating Schedule</div>
              {(n.operating_schedule || []).slice(0, 3).map((item, i) => (
                <div key={i} style={{ display: 'flex', gap: 6, fontSize: 10, marginBottom: 2 }}>
                  <span style={{ color: '#c4b5fd', minWidth: 8 }}>●</span>
                  <div><span style={{ color: '#d1d5db', fontWeight: 600 }}>{item.label}</span> <span style={{ color: '#6b7280' }}>({item.cfr})</span></div>
                </div>
              ))}
              <div style={{ color: '#4b5563', fontSize: 10, marginTop: 4 }}>{n.reference}</div>
            </div>
          );
        })()}

        {/* Property Acquisition Guide */}
        {candidate.property_acquisition_guide && (() => {
          const p = candidate.property_acquisition_guide;
          const purchase  = (p.site_options || []).find(o => o.id === 'PURCHASE');
          const ltLease   = (p.site_options || []).find(o => o.id === 'LONG_TERM_LEASE');
          const reqDD     = (p.due_diligence || []).filter(d => d.required);
          return (
            <div>
              <h4 style={{ color: '#86efac', marginBottom: 6, fontSize: 13, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' }}>
                Property Acquisition Guide (§1.65)
              </h4>
              <div style={{ background: '#031a0a', borderRadius: 6, padding: '10px 12px', marginBottom: 8, fontSize: 12 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 12px' }}>
                  <div><span style={{ color: '#9ca3af' }}>Tower height est.:</span> <strong>{p.tower_height_m != null ? `${p.tower_height_m} m` : '—'}</strong></div>
                  <div><span style={{ color: '#9ca3af' }}>Guy wire radius:</span> <strong>{p.guy_radius_m != null ? `${p.guy_radius_m} m` : '—'}</strong></div>
                  <div><span style={{ color: '#9ca3af' }}>Min site radius:</span> <strong>{p.min_site_radius_m != null ? `${p.min_site_radius_m} m` : '—'}</strong></div>
                  <div><span style={{ color: '#9ca3af' }}>Min site area:</span> <strong style={{ color: '#86efac' }}>{p.min_site_area_acres != null ? `${p.min_site_area_acres} acres` : '—'}</strong></div>
                  <div><span style={{ color: '#9ca3af' }}>Purchase est.:</span> <strong>{purchase?.cost_usd != null ? `$${purchase.cost_usd.toLocaleString()}` : '—'}</strong></div>
                  <div><span style={{ color: '#9ca3af' }}>Annual lease est.:</span> <strong>{ltLease?.annual_cost_usd != null ? `$${ltLease.annual_cost_usd.toLocaleString()}/yr` : '—'}</strong></div>
                  <div><span style={{ color: '#9ca3af' }}>Recommended:</span> <strong style={{ color: '#22c55e' }}>{p.recommended_option?.replace(/_/g, ' ') || '—'}</strong></div>
                  <div><span style={{ color: '#9ca3af' }}>DD cost est.:</span> <strong style={{ color: '#f59e0b' }}>{p.due_diligence_cost_usd != null ? `$${p.due_diligence_cost_usd.toLocaleString()}` : '—'}</strong></div>
                </div>
              </div>
              <div style={{ marginBottom: 6 }}>
                <div style={{ color: '#9ca3af', fontSize: 11, marginBottom: 4 }}>Required Due Diligence</div>
                {reqDD.map((d, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 6, fontSize: 10, marginBottom: 2 }}>
                    <span style={{ color: '#86efac', minWidth: 8, marginTop: 1 }}>●</span>
                    <div>
                      <span style={{ color: '#d1d5db', fontWeight: 600 }}>{d.label}</span>
                      <span style={{ color: '#6b7280' }}> — est. ${d.cost_est_usd?.toLocaleString()}</span>
                      <div style={{ color: '#9ca3af' }}>{d.notes?.substring(0, 110)}</div>
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ color: '#4b5563', fontSize: 10 }}>{p.reference}</div>
            </div>
          );
        })()}

        {/* RF Exposure Compliance Guide */}
        {candidate.rf_exposure_compliance_guide && (() => {
          const r = candidate.rf_exposure_compliance_guide;
          const gpZone   = (r.exposure_zones || []).find(z => z.id === 'UNCONTROLLED');
          const occZone  = (r.exposure_zones || []).find(z => z.id === 'CONTROLLED');
          return (
            <div>
              <h4 style={{ color: '#f87171', marginBottom: 6, fontSize: 13, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' }}>
                RF Exposure Compliance (OET-65 / §1.1310)
              </h4>
              <div style={{ background: '#1a0505', borderRadius: 6, padding: '10px 12px', marginBottom: 8, fontSize: 12 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 12px' }}>
                  <div><span style={{ color: '#9ca3af' }}>Frequency:</span> <strong>{r.frequency_mhz != null ? `${r.frequency_mhz} MHz` : '—'}</strong></div>
                  <div><span style={{ color: '#9ca3af' }}>TPO:</span> <strong>{r.tpo_kw != null ? `${r.tpo_kw} kW` : '—'}</strong></div>
                  <div><span style={{ color: '#9ca3af' }}>MPE eval required:</span> <strong style={{ color: r.mpe_evaluation_required ? '#ef4444' : '#22c55e' }}>{r.mpe_evaluation_required ? `Yes (≥${r.mpe_threshold_kw} kW)` : 'No'}</strong></div>
                  <div><span style={{ color: '#9ca3af' }}>GP MPE limit:</span> <strong>{r.mpe_limit_gp_mwcm2 != null ? `${r.mpe_limit_gp_mwcm2} mW/cm²` : '—'}</strong></div>
                  <div><span style={{ color: '#9ca3af' }}>GP exclusion zone:</span> <strong style={{ color: '#f87171' }}>{r.exclusion_radius_gp_m != null ? `${r.exclusion_radius_gp_m} m` : '—'}</strong></div>
                  <div><span style={{ color: '#9ca3af' }}>Occupational zone:</span> <strong style={{ color: '#fca5a5' }}>{r.exclusion_radius_occ_m != null ? `${r.exclusion_radius_occ_m} m` : '—'}</strong></div>
                  <div><span style={{ color: '#9ca3af' }}>Occ. MPE limit:</span> <strong>{r.mpe_limit_occ_mwcm2 != null ? `${r.mpe_limit_occ_mwcm2} mW/cm²` : '—'}</strong></div>
                  <div><span style={{ color: '#9ca3af' }}>Compliance steps:</span> <strong>{r.n_compliance_steps ?? '—'} ({r.total_compliance_days != null ? `~${r.total_compliance_days} days` : '—'})</strong></div>
                </div>
              </div>
              {gpZone && (
                <div style={{ background: '#140303', borderRadius: 4, padding: '6px 8px', fontSize: 11, marginBottom: 4 }}>
                  <span style={{ color: '#f87171', fontWeight: 700 }}>General Population Zone: </span>
                  <span style={{ color: '#d1d5db' }}>≤{r.mpe_limit_gp_mwcm2} mW/cm² within {r.exclusion_radius_gp_m}m — fence, warning signs, and public access barrier required. Averaging time: {gpZone.averaging_time_min} min.</span>
                </div>
              )}
              {occZone && (
                <div style={{ background: '#140303', borderRadius: 4, padding: '6px 8px', fontSize: 11, marginBottom: 6 }}>
                  <span style={{ color: '#fca5a5', fontWeight: 700 }}>Occupational Zone: </span>
                  <span style={{ color: '#d1d5db' }}>≤{r.mpe_limit_occ_mwcm2} mW/cm² within {r.exclusion_radius_occ_m}m — trained personnel only. Averaging time: {occZone.averaging_time_min} min.</span>
                </div>
              )}
              <div style={{ color: '#4b5563', fontSize: 10 }}>{r.reference}</div>
            </div>
          );
        })()}

        {/* Tower Structural Analysis Guide */}
        {candidate.tower_structural_analysis_guide && (() => {
          const t = candidate.tower_structural_analysis_guide;
          const wc = { LIGHT: '#22c55e', MEDIUM: '#f59e0b', HEAVY: '#ef4444' };
          const reqInspections = (t.inspection_schedule || []).filter(i => i.required);
          return (
            <div>
              <h4 style={{ color: '#fde68a', marginBottom: 6, fontSize: 13, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' }}>
                Tower Structural Analysis (TIA-222-H)
              </h4>
              <div style={{ background: '#1a1500', borderRadius: 6, padding: '10px 12px', marginBottom: 8, fontSize: 12 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 12px' }}>
                  <div><span style={{ color: '#9ca3af' }}>Tower height:</span> <strong>{t.tower_height_m != null ? `${t.tower_height_m} m (${t.tower_height_ft} ft)` : '—'}</strong></div>
                  <div><span style={{ color: '#9ca3af' }}>Weight class:</span> <strong style={{ color: wc[t.tower_weight_class] || '#9ca3af' }}>{t.tower_weight_class || '—'}</strong></div>
                  <div><span style={{ color: '#9ca3af' }}>Design standard:</span> <strong style={{ fontSize: 10 }}>{t.design_standard || 'TIA-222-H'}</strong></div>
                  <div><span style={{ color: '#9ca3af' }}>ASR required:</span> <strong style={{ color: t.asr_required ? '#ef4444' : '#22c55e' }}>{t.asr_required ? 'Yes (§17.7)' : 'No'}</strong></div>
                  <div><span style={{ color: '#9ca3af' }}>Wind exposure:</span> <strong>{t.selected_exposure?.id} — {t.selected_exposure?.basic_wind_speed_mph} mph</strong></div>
                  <div><span style={{ color: '#9ca3af' }}>Ice zone:</span> <strong>{t.ice_zone || '—'} ({t.ice_load_psf != null ? `${t.ice_load_psf} psf` : '—'})</strong></div>
                  <div><span style={{ color: '#9ca3af' }}>Est. structural cost:</span> <strong style={{ color: '#f59e0b' }}>{t.total_structural_cost_usd != null ? `$${t.total_structural_cost_usd.toLocaleString()}` : '—'}</strong></div>
                  <div><span style={{ color: '#9ca3af' }}>Required inspections:</span> <strong>{t.n_required_inspections ?? '—'} types</strong></div>
                </div>
              </div>
              <div style={{ marginBottom: 6 }}>
                <div style={{ color: '#9ca3af', fontSize: 11, marginBottom: 4 }}>Inspection Schedule (TIA-222-H)</div>
                {reqInspections.map((ins, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 6, fontSize: 10, marginBottom: 2 }}>
                    <span style={{ color: '#fde68a', minWidth: 8, marginTop: 1 }}>●</span>
                    <div>
                      <span style={{ color: '#d1d5db', fontWeight: 600 }}>{ins.type} ({ins.frequency})</span>
                      <span style={{ color: '#6b7280' }}> — est. ${ins.cost_est_usd?.toLocaleString()}</span>
                      <div style={{ color: '#9ca3af' }}>{ins.notes?.substring(0, 100)}</div>
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ color: '#4b5563', fontSize: 10 }}>{t.reference}</div>
            </div>
          );
        })()}

        {/* Directional Antenna Proof Guide */}
        {candidate.directional_antenna_proof_guide && (() => {
          const d = candidate.directional_antenna_proof_guide;
          if (!d.applicable) {
            return (
              <div>
                <h4 style={{ color: '#67e8f9', marginBottom: 6, fontSize: 13, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' }}>
                  Directional Antenna Proof (§73.154)
                </h4>
                <div style={{ background: '#021a1c', borderRadius: 4, padding: '8px 12px', fontSize: 11, color: '#9ca3af' }}>
                  {d.reason || 'Non-directional pattern — §73.154 proof not required.'}
                </div>
              </div>
            );
          }
          const fullProof = (d.proof_methods || []).find(p => p.id === 'FULL_PROOF');
          const spotCheck = (d.proof_methods || []).find(p => p.id === 'SPOT_CHECK');
          return (
            <div>
              <h4 style={{ color: '#67e8f9', marginBottom: 6, fontSize: 13, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' }}>
                Directional Antenna Proof (§73.154)
              </h4>
              <div style={{ background: '#021a1c', borderRadius: 6, padding: '10px 12px', marginBottom: 8, fontSize: 12 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 12px' }}>
                  <div><span style={{ color: '#9ca3af' }}>Pattern mode:</span> <strong style={{ color: '#67e8f9' }}>{d.pattern_mode || '—'}</strong></div>
                  <div><span style={{ color: '#9ca3af' }}>Proof tolerance:</span> <strong>±{d.proof_tolerance_db ?? '—'} dB</strong></div>
                  <div><span style={{ color: '#9ca3af' }}>Full proof radials:</span> <strong>{fullProof?.radials ?? '—'} at {fullProof?.degree_interval ?? '—'}° intervals</strong></div>
                  <div><span style={{ color: '#9ca3af' }}>Full proof cost est.:</span> <strong style={{ color: '#f59e0b' }}>{fullProof?.cost_est_usd != null ? `$${fullProof.cost_est_usd.toLocaleString()}` : '—'}</strong></div>
                  <div><span style={{ color: '#9ca3af' }}>Spot check radials:</span> <strong>{spotCheck?.radials ?? '—'} at {spotCheck?.degree_interval ?? '—'}° intervals</strong></div>
                  <div><span style={{ color: '#9ca3af' }}>Est. proof days:</span> <strong>{d.estimated_proof_days != null ? `${d.estimated_proof_days} days` : '—'}</strong></div>
                  <div><span style={{ color: '#9ca3af' }}>ND check req'd:</span> <strong style={{ color: d.nd_check?.required ? '#22c55e' : '#9ca3af' }}>{d.nd_check?.required ? 'Yes (§73.154(e))' : 'No'}</strong></div>
                  <div><span style={{ color: '#9ca3af' }}>Antenna params:</span> <strong>{d.n_antenna_parameters ?? '—'} parameters (§73.62)</strong></div>
                </div>
              </div>
              {fullProof && (
                <div style={{ background: '#011618', borderRadius: 4, padding: '6px 8px', fontSize: 11, marginBottom: 6 }}>
                  <span style={{ color: '#67e8f9', fontWeight: 700 }}>Full Proof: </span>
                  <span style={{ color: '#d1d5db' }}>{fullProof.description}</span>
                </div>
              )}
              <div style={{ color: '#4b5563', fontSize: 10 }}>{d.reference}</div>
            </div>
          );
        })()}

        {/* Insurance & Liability Analysis */}
        {candidate.insurance_liability_analysis && (() => {
          const ins = candidate.insurance_liability_analysis;
          return (
            <div>
              <h4 style={{ color: '#a78bfa', marginBottom: 6, fontSize: 13, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' }}>
                Insurance &amp; Liability Analysis
              </h4>
              <div style={{ background: '#0d0a1a', borderRadius: 6, padding: '10px 12px', marginBottom: 8, fontSize: 12 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 12px' }}>
                  <div><span style={{ color: '#9ca3af' }}>Tower height est.:</span> <strong>{ins.tower_height_m != null ? `${ins.tower_height_m} m` : '—'}</strong></div>
                  <div><span style={{ color: '#9ca3af' }}>ASR required:</span> <strong style={{ color: ins.asr_required ? '#ef4444' : '#22c55e' }}>{ins.asr_required ? 'Yes (§17.7)' : 'No (< 200 ft)'}</strong></div>
                  <div><span style={{ color: '#9ca3af' }}>Total insured value:</span> <strong style={{ color: '#a78bfa' }}>{ins.total_insured_value_usd != null ? `$${ins.total_insured_value_usd.toLocaleString()}` : '—'}</strong></div>
                  <div><span style={{ color: '#9ca3af' }}>Annual premium est.:</span> <strong style={{ color: '#f59e0b' }}>{ins.total_annual_premium_usd != null ? `$${ins.total_annual_premium_usd.toLocaleString()}/yr` : '—'}</strong></div>
                  <div><span style={{ color: '#9ca3af' }}>Coverage lines:</span> <strong>{ins.n_coverage_lines ?? '—'} ({ins.n_required_lines ?? '—'} required)</strong></div>
                  <div><span style={{ color: '#9ca3af' }}>GL limit:</span> <strong>$1M per occurrence / $2M aggregate</strong></div>
                </div>
              </div>
              <div style={{ marginBottom: 6 }}>
                <div style={{ color: '#9ca3af', fontSize: 11, marginBottom: 4 }}>Coverage Lines</div>
                {(ins.coverage_lines || []).map((l, i) => (
                  <div key={i} style={{ background: '#080614', borderRadius: 3, padding: '5px 8px', marginBottom: 4, fontSize: 11, opacity: l.required ? 1 : 0.75 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 1 }}>
                      <span style={{ color: l.required ? '#a78bfa' : '#6b7280', fontWeight: 700 }}>{l.label}{!l.required && ' (optional)'}</span>
                      <span style={{ color: '#6b7280' }}>{l.annual_premium_usd != null ? `$${l.annual_premium_usd.toLocaleString()}/yr` : ''}</span>
                    </div>
                    <div style={{ color: '#9ca3af', fontSize: 10 }}>{l.notes?.substring(0, 120)}{l.notes?.length > 120 ? '…' : ''}</div>
                  </div>
                ))}
              </div>
              {ins.asr_required && ins.asr_compliance && (
                <div style={{ background: '#12080e', borderRadius: 4, padding: '6px 8px', fontSize: 11, marginBottom: 6 }}>
                  <span style={{ color: '#ef4444', fontWeight: 700 }}>ASR Non-Compliance Risks: </span>
                  <span style={{ color: '#d1d5db' }}>15–25% premium surcharge, aviation claim exclusion, FCC forfeiture up to $10k/day.</span>
                </div>
              )}
              <div style={{ color: '#4b5563', fontSize: 10 }}>{ins.reference}</div>
            </div>
          );
        })()}

        {/* Site Security Perimeter Guide */}
        {candidate.site_security_perimeter_guide && (() => {
          const s = candidate.site_security_perimeter_guide;
          const requiredComps = (s.security_components || []).filter(c => c.required);
          return (
            <div>
              <h4 style={{ color: '#fb923c', marginBottom: 6, fontSize: 13, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' }}>
                Site Security Perimeter (§73.49)
              </h4>
              <div style={{ background: '#1a0c05', borderRadius: 6, padding: '10px 12px', marginBottom: 8, fontSize: 12 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 12px' }}>
                  <div><span style={{ color: '#9ca3af' }}>Tower height est.:</span> <strong>{s.tower_height_m != null ? `${s.tower_height_m} m` : '—'}</strong></div>
                  <div><span style={{ color: '#9ca3af' }}>Fence radius:</span> <strong>{s.fence_radius_m != null ? `${s.fence_radius_m} m` : '—'}</strong></div>
                  <div><span style={{ color: '#9ca3af' }}>Perimeter:</span> <strong style={{ color: '#fb923c' }}>{s.perimeter_m != null ? `${s.perimeter_m} m` : '—'}</strong></div>
                  <div><span style={{ color: '#9ca3af' }}>MPE eval req'd:</span> <strong style={{ color: s.mpe_evaluation_required ? '#ef4444' : '#22c55e' }}>{s.mpe_evaluation_required ? `Yes (≥${s.mpe_threshold_kw} kW)` : 'No'}</strong></div>
                  <div><span style={{ color: '#9ca3af' }}>Components:</span> <strong>{s.n_components ?? '—'} ({s.n_required_components ?? '—'} required)</strong></div>
                  <div><span style={{ color: '#9ca3af' }}>Total capex:</span> <strong style={{ color: '#f59e0b' }}>{s.total_capex_usd != null ? `$${s.total_capex_usd.toLocaleString()}` : '—'}</strong></div>
                  <div><span style={{ color: '#9ca3af' }}>Annual maint.:</span> <strong>{s.annual_maintenance_usd != null ? `$${s.annual_maintenance_usd.toLocaleString()}/yr` : '—'}</strong></div>
                  <div><span style={{ color: '#9ca3af' }}>Violation risk:</span> <strong style={{ color: '#ef4444', fontSize: 10 }}>Up to $10k/day</strong></div>
                </div>
              </div>
              <div style={{ marginBottom: 6 }}>
                <div style={{ color: '#9ca3af', fontSize: 11, marginBottom: 4 }}>Required Security Components (§73.49)</div>
                {requiredComps.map((c, i) => (
                  <div key={i} style={{ background: '#120a02', borderRadius: 3, padding: '5px 8px', marginBottom: 4, fontSize: 11 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 1 }}>
                      <span style={{ color: '#fb923c', fontWeight: 700 }}>{c.label}</span>
                      <span style={{ color: '#6b7280' }}>{c.cost_usd != null ? `$${c.cost_usd.toLocaleString()}` : ''}</span>
                    </div>
                    <div style={{ color: '#9ca3af', fontSize: 10 }}>{c.spec}</div>
                  </div>
                ))}
              </div>
              <div style={{ color: '#4b5563', fontSize: 10 }}>{s.reference}</div>
            </div>
          );
        })()}

        {/* Environmental Impact Assessment */}
        {candidate.environmental_impact_assessment && (() => {
          const e = candidate.environmental_impact_assessment;
          const riskColor = { LOW: '#22c55e', MODERATE: '#f59e0b', HIGH: '#ef4444', VERY_HIGH: '#dc2626' };
          return (
            <div>
              <h4 style={{ color: '#4ade80', marginBottom: 6, fontSize: 13, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' }}>
                Environmental Impact Assessment
              </h4>
              <div style={{ background: '#030f06', borderRadius: 6, padding: '10px 12px', marginBottom: 8, fontSize: 12 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 12px' }}>
                  <div><span style={{ color: '#9ca3af' }}>Env. risk level:</span> <strong style={{ color: riskColor[e.env_risk_level] || '#9ca3af' }}>{e.env_risk_level || '—'}</strong></div>
                  <div><span style={{ color: '#9ca3af' }}>Cat. exclusion:</span> <strong style={{ color: e.categorical_exclusion?.applies ? '#22c55e' : '#ef4444' }}>{e.categorical_exclusion?.applies ? 'Applies' : 'EA required'}</strong></div>
                  <div><span style={{ color: '#9ca3af' }}>Checklist items:</span> <strong>{e.n_checklist_items ?? '—'} ({e.n_required_items ?? '—'} required)</strong></div>
                  <div><span style={{ color: '#9ca3af' }}>Est. EA days:</span> <strong style={{ color: '#f59e0b' }}>{e.estimated_ea_days != null ? `${e.estimated_ea_days} days` : '—'}</strong></div>
                  <div><span style={{ color: '#9ca3af' }}>Tower height est.:</span> <strong>{e.tower_height_est_m != null ? `${e.tower_height_est_m} m` : '—'}</strong></div>
                  <div><span style={{ color: '#9ca3af' }}>§106 total days:</span> <strong>{e.nhpa_106?.total_process_days != null ? `~${e.nhpa_106.total_process_days} days` : '—'}</strong></div>
                </div>
              </div>
              <div style={{ marginBottom: 6 }}>
                <div style={{ color: '#9ca3af', fontSize: 11, marginBottom: 4 }}>Environmental Checklist</div>
                {(e.environmental_checklist || []).map((c, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 6, fontSize: 10, marginBottom: 2 }}>
                    <span style={{ color: c.required ? '#4ade80' : '#6b7280', minWidth: 8, marginTop: 1 }}>{c.required ? '●' : '○'}</span>
                    <div>
                      <span style={{ color: c.required ? '#d1d5db' : '#9ca3af' }}>{c.item}</span>
                      <span style={{ color: '#6b7280' }}> (~{c.duration_days}d)</span>
                    </div>
                  </div>
                ))}
              </div>
              {e.nhpa_106 && (
                <div style={{ background: '#031205', borderRadius: 4, padding: '6px 8px', fontSize: 11, marginBottom: 6 }}>
                  <span style={{ color: '#4ade80', fontWeight: 700 }}>NHPA §106: </span>
                  <span style={{ color: '#d1d5db' }}>{e.nhpa_106.process_steps?.length ?? 5}-step process; SHPO has 30 days to respond. APE delineation → historic property search → effect assessment → consultation → resolution.</span>
                </div>
              )}
              <div style={{ color: '#4b5563', fontSize: 10 }}>{e.reference}</div>
            </div>
          );
        })()}

        {/* Ground Conductivity Improvement */}
        {candidate.ground_conductivity_improvement && (() => {
          const g = candidate.ground_conductivity_improvement;
          const condColor = g.is_high_conductivity ? '#22c55e' : g.is_moderate_conductivity ? '#f59e0b' : '#ef4444';
          const condLabel = g.is_high_conductivity ? 'High (preferred)' : g.is_moderate_conductivity ? 'Moderate' : 'Low — improvement recommended';
          return (
            <div>
              <h4 style={{ color: '#86efac', marginBottom: 6, fontSize: 13, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' }}>
                Ground Conductivity Improvement
              </h4>
              <div style={{ background: '#031a0a', borderRadius: 6, padding: '10px 12px', marginBottom: 8, fontSize: 12 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 12px' }}>
                  <div><span style={{ color: '#9ca3af' }}>Baseline σ:</span> <strong style={{ color: condColor }}>{g.baseline_sigma_msm != null ? `${g.baseline_sigma_msm} mS/m` : '—'}</strong></div>
                  <div><span style={{ color: '#9ca3af' }}>Conductivity:</span> <strong style={{ color: condColor }}>{condLabel}</strong></div>
                  <div><span style={{ color: '#9ca3af' }}>σ after treatment:</span> <strong style={{ color: '#86efac' }}>{g.sigma_after_improvement_msm != null ? `${g.sigma_after_improvement_msm} mS/m` : '—'}</strong></div>
                  <div><span style={{ color: '#9ca3af' }}>Coverage gain:</span> <strong style={{ color: g.coverage_gain_pct > 0 ? '#22c55e' : '#9ca3af' }}>{g.coverage_gain_pct != null ? `+${g.coverage_gain_pct}%` : '—'}</strong></div>
                  <div><span style={{ color: '#9ca3af' }}>Applicable techniques:</span> <strong>{g.n_applicable_techniques ?? '—'} / {g.n_all_techniques ?? '—'}</strong></div>
                  <div><span style={{ color: '#9ca3af' }}>Budget (low):</span> <strong>{g.improvement_budget_usd?.low != null ? `$${g.improvement_budget_usd.low.toLocaleString()}` : '—'}</strong></div>
                </div>
              </div>
              {(g.applicable_techniques || []).map((t, i) => (
                <div key={i} style={{ background: '#031205', borderRadius: 3, padding: '5px 8px', marginBottom: 4, fontSize: 11 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 1 }}>
                    <span style={{ color: '#86efac', fontWeight: 700 }}>{t.label}</span>
                    <span style={{ color: '#6b7280' }}>+{t.max_improvement_pct}% max · ${t.cost_per_km2?.toLocaleString()}/km²</span>
                  </div>
                  <div style={{ color: '#9ca3af', fontSize: 10 }}>{t.description.substring(0, 120)}{t.description.length > 120 ? '…' : ''}</div>
                </div>
              ))}
              <div style={{ color: '#4b5563', fontSize: 10, marginTop: 4 }}>{g.reference}</div>
            </div>
          );
        })()}

        {/* Frequency Spectrum Coordination */}
        {candidate.frequency_spectrum_coordination && (() => {
          const f = candidate.frequency_spectrum_coordination;
          const chanColors = { CLEAR: '#fbbf24', REGIONAL: '#60a5fa', LOCAL: '#a78bfa' };
          return (
            <div>
              <h4 style={{ color: '#f472b6', marginBottom: 6, fontSize: 13, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' }}>
                Frequency Spectrum Coordination
              </h4>
              <div style={{ background: '#1a0d18', borderRadius: 6, padding: '10px 12px', marginBottom: 8, fontSize: 12 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 12px' }}>
                  <div><span style={{ color: '#9ca3af' }}>Channel class:</span> <strong style={{ color: chanColors[f.channel_class] || '#d1d5db' }}>{f.channel_class || '—'}</strong></div>
                  <div><span style={{ color: '#9ca3af' }}>Coord. zone:</span> <strong style={{ color: '#f472b6' }}>{f.coordination_zone_km != null ? `${f.coordination_zone_km} km` : '—'}</strong></div>
                  <div><span style={{ color: '#9ca3af' }}>NIF required:</span> <strong style={{ color: f.nif_required ? '#ef4444' : '#22c55e' }}>{f.nif_required ? 'Yes (clear channel)' : 'No'}</strong></div>
                  {f.nif_required && <div><span style={{ color: '#9ca3af' }}>NIF area:</span> <strong>{f.nif_service_area_km2 != null ? `${f.nif_service_area_km2.toLocaleString()} km²` : '—'}</strong></div>}
                  <div><span style={{ color: '#9ca3af' }}>Required coord. items:</span> <strong>{f.n_required_items ?? '—'}</strong></div>
                  <div><span style={{ color: '#9ca3af' }}>Coord. timeline:</span> <strong>{f.coordination_timeline?.total_days != null ? `~${f.coordination_timeline.total_days} days` : '—'}</strong></div>
                </div>
              </div>
              <div style={{ marginBottom: 8 }}>
                <div style={{ color: '#9ca3af', fontSize: 11, marginBottom: 4 }}>Channel Relationships & Protection Thresholds</div>
                <table style={{ width: '100%', fontSize: 10, borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ color: '#6b7280', borderBottom: '1px solid #374151' }}>
                      <th style={{ textAlign: 'left', padding: '2px 4px' }}>Relationship</th>
                      <th style={{ textAlign: 'center', padding: '2px 4px' }}>D/U Day</th>
                      <th style={{ textAlign: 'center', padding: '2px 4px' }}>D/U Night</th>
                      <th style={{ textAlign: 'right', padding: '2px 4px' }}>Min km</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(f.channel_relationships || []).map((r, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid #1f2937' }}>
                        <td style={{ padding: '2px 4px', color: '#d1d5db' }}>{r.label}</td>
                        <td style={{ padding: '2px 4px', textAlign: 'center', color: r.du_daytime_db >= 0 ? '#22c55e' : '#f59e0b' }}>{r.du_daytime_db} dB</td>
                        <td style={{ padding: '2px 4px', textAlign: 'center', color: r.du_nighttime_db >= 0 ? '#22c55e' : '#ef4444' }}>{r.du_nighttime_db} dB</td>
                        <td style={{ padding: '2px 4px', textAlign: 'right', color: '#9ca3af' }}>{r.min_spacing_km}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={{ color: '#4b5563', fontSize: 10 }}>{f.reference}</div>
            </div>
          );
        })()}

        {/* STL Network Link Guide */}
        {candidate.stl_network_link_guide && (() => {
          const s = candidate.stl_network_link_guide;
          const rec = s.recommended_stl || {};
          return (
            <div>
              <h4 style={{ color: '#818cf8', marginBottom: 6, fontSize: 13, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' }}>
                STL / Network Link Guide
              </h4>
              <div style={{ background: '#0d0a1f', borderRadius: 6, padding: '10px 12px', marginBottom: 8, fontSize: 12 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 12px' }}>
                  <div><span style={{ color: '#9ca3af' }}>STL path distance:</span> <strong style={{ color: '#818cf8' }}>{s.stl_path_distance_km != null ? `${s.stl_path_distance_km} km` : '—'}</strong></div>
                  <div><span style={{ color: '#9ca3af' }}>Recommended:</span> <strong style={{ color: '#c4b5fd' }}>{rec.label || '—'}</strong></div>
                  <div><span style={{ color: '#9ca3af' }}>Equipment cost:</span> <strong>{s.equip_cost_usd != null ? `$${s.equip_cost_usd.toLocaleString()}` : '—'}</strong></div>
                  <div><span style={{ color: '#9ca3af' }}>Total STL cost:</span> <strong style={{ color: '#818cf8' }}>{s.total_stl_cost_usd != null ? `$${s.total_stl_cost_usd.toLocaleString()}` : '—'}</strong></div>
                  <div><span style={{ color: '#9ca3af' }}>LOS required:</span> <strong style={{ color: rec.los_required ? '#f59e0b' : '#22c55e' }}>{rec.los_required ? 'Yes' : 'No'}</strong></div>
                  <div><span style={{ color: '#9ca3af' }}>FCC license:</span> <strong style={{ color: rec.fcc_license_required ? '#f59e0b' : '#22c55e' }}>{rec.fcc_license_required ? 'Required' : 'Not required'}</strong></div>
                </div>
              </div>
              <div style={{ marginBottom: 6 }}>
                <div style={{ color: '#9ca3af', fontSize: 11, marginBottom: 4 }}>STL Technology Options</div>
                {(s.stl_options || []).map((opt, i) => (
                  <div key={i} style={{ background: opt.id === rec.id ? '#150d2a' : '#0a0614', borderRadius: 3, padding: '4px 8px', marginBottom: 3, fontSize: 11 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 1 }}>
                      <span style={{ color: opt.id === rec.id ? '#818cf8' : opt.suitable ? '#9ca3af' : '#4b5563', fontWeight: opt.id === rec.id ? 700 : 400 }}>
                        {opt.label}{opt.id === rec.id ? ' ★' : ''}
                      </span>
                      <span style={{ color: '#6b7280' }}>
                        {opt.latency_ms}ms · {opt.suitable ? '✓' : '✗'} · ${opt.cost_usd_est?.toLocaleString()}
                      </span>
                    </div>
                    <div style={{ color: '#22c55e', fontSize: 9 }}>{(opt.pros || []).join(' · ')}</div>
                  </div>
                ))}
              </div>
              {s.los_analysis && (
                <div style={{ background: '#0a0614', borderRadius: 4, padding: '6px 8px', fontSize: 11, marginBottom: 6 }}>
                  <span style={{ color: '#9ca3af' }}>Fresnel zone (950 MHz, midpath): </span>
                  <span style={{ color: '#d1d5db' }}>{s.los_analysis.fresnel_zone_1_m}m radius; clearance needed: {s.los_analysis.clearance_required_m}m; earth bulge: {s.los_analysis.earth_bulge_m}m</span>
                </div>
              )}
              <div style={{ color: '#4b5563', fontSize: 10 }}>{s.reference}</div>
            </div>
          );
        })()}

        {/* Regulatory Filing Checklist */}
        {candidate.regulatory_filing_checklist && (() => {
          const r = candidate.regulatory_filing_checklist;
          const phaseColors = { PRE_FILING: '#60a5fa', FCC_APPLICATION: '#f59e0b', CONSTRUCTION: '#34d399', POST_CONSTRUCTION: '#a78bfa', ONGOING: '#9ca3af' };
          return (
            <div>
              <h4 style={{ color: '#fde047', marginBottom: 6, fontSize: 13, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' }}>
                Regulatory Filing Checklist
              </h4>
              <div style={{ background: '#1a1800', borderRadius: 6, padding: '10px 12px', marginBottom: 8, fontSize: 12 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 12px' }}>
                  <div><span style={{ color: '#9ca3af' }}>Total filings:</span> <strong>{r.n_total_filings ?? '—'}</strong></div>
                  <div><span style={{ color: '#9ca3af' }}>Required:</span> <strong style={{ color: '#fde047' }}>{r.n_required_filings ?? '—'}</strong></div>
                  <div><span style={{ color: '#9ca3af' }}>Total FCC fees:</span> <strong style={{ color: '#f97316' }}>{r.total_required_fees_usd != null ? `$${r.total_required_fees_usd.toLocaleString()}` : '—'}</strong></div>
                  <div><span style={{ color: '#9ca3af' }}>ASR required:</span> <strong style={{ color: r.needs_asr ? '#ef4444' : '#22c55e' }}>{r.needs_asr ? 'Yes' : 'No'}</strong></div>
                  <div><span style={{ color: '#9ca3af' }}>DA pattern:</span> <strong style={{ color: r.is_da ? '#f59e0b' : '#9ca3af' }}>{r.is_da ? 'DA — proof required' : 'NDA'}</strong></div>
                  <div><span style={{ color: '#9ca3af' }}>Clear channel:</span> <strong style={{ color: r.is_clear_channel ? '#fbbf24' : '#9ca3af' }}>{r.is_clear_channel ? 'Yes (NIF study)' : 'No'}</strong></div>
                </div>
              </div>
              {(r.filings_by_phase || []).map((phase, pi) => (
                <div key={pi} style={{ marginBottom: 6 }}>
                  <div style={{ color: phaseColors[phase.phase] || '#9ca3af', fontSize: 11, fontWeight: 700, marginBottom: 3 }}>
                    {phase.phase?.replace(/_/g, ' ')} ({phase.required_count} required)
                  </div>
                  {phase.filings.map((f, fi) => (
                    <div key={fi} style={{ display: 'flex', alignItems: 'flex-start', gap: 6, fontSize: 10, marginBottom: 2, paddingLeft: 8 }}>
                      <span style={{ color: f.required ? '#ef4444' : '#6b7280', minWidth: 8, marginTop: 1 }}>{f.required ? '●' : '○'}</span>
                      <div>
                        <span style={{ color: f.required ? '#fde047' : '#9ca3af', fontWeight: f.required ? 700 : 400 }}>{f.form}</span>
                        {f.fee_usd > 0 && <span style={{ color: '#f97316' }}> (${f.fee_usd.toLocaleString()})</span>}
                        <span style={{ color: '#6b7280' }}> — {f.description.substring(0, 80)}{f.description.length > 80 ? '…' : ''}</span>
                      </div>
                    </div>
                  ))}
                </div>
              ))}
              <div style={{ color: '#4b5563', fontSize: 10 }}>{r.reference}</div>
            </div>
          );
        })()}

        {/* Transmitter Cooling / HVAC Guide */}
        {candidate.transmitter_cooling_hvac_guide && (() => {
          const h = candidate.transmitter_cooling_hvac_guide;
          const riskColor = { LOW: '#22c55e', MODERATE: '#f59e0b', HIGH: '#ef4444' };
          return (
            <div>
              <h4 style={{ color: '#67e8f9', marginBottom: 6, fontSize: 13, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' }}>
                Transmitter Cooling / HVAC Guide
              </h4>
              <div style={{ background: '#001a1f', borderRadius: 6, padding: '10px 12px', marginBottom: 8, fontSize: 12 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 12px' }}>
                  <div><span style={{ color: '#9ca3af' }}>TX efficiency:</span> <strong>{h.tx_efficiency_pct != null ? `${h.tx_efficiency_pct}%` : '—'}</strong></div>
                  <div><span style={{ color: '#9ca3af' }}>TX heat dissipated:</span> <strong style={{ color: '#67e8f9' }}>{h.tx_heat_kw != null ? `${h.tx_heat_kw} kW` : '—'}</strong></div>
                  <div><span style={{ color: '#9ca3af' }}>Total facility heat:</span> <strong style={{ color: '#f97316' }}>{h.total_heat_kw != null ? `${h.total_heat_kw} kW` : '—'}</strong></div>
                  <div><span style={{ color: '#9ca3af' }}>HVAC capacity:</span> <strong style={{ color: '#fbbf24' }}>{h.hvac_capacity_tons != null ? `${h.hvac_capacity_tons} tons` : '—'}</strong></div>
                  <div><span style={{ color: '#9ca3af' }}>Thermal risk:</span> <strong style={{ color: riskColor[h.thermal_risk_level] || '#9ca3af' }}>{h.thermal_risk_level || '—'}</strong></div>
                  <div><span style={{ color: '#9ca3af' }}>Annual HVAC cost:</span> <strong>{h.annual_hvac_cost_usd != null ? `$${h.annual_hvac_cost_usd.toLocaleString()}` : '—'}</strong></div>
                </div>
              </div>
              {h.design_criteria && (
                <div style={{ background: '#001215', borderRadius: 4, padding: '6px 8px', fontSize: 11, marginBottom: 6 }}>
                  <div style={{ color: '#9ca3af', marginBottom: 3 }}>ASHRAE Design Criteria (Class A1)</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 3, fontSize: 10 }}>
                    <div style={{ color: '#d1d5db' }}>Supply air: {h.design_criteria.supply_air_temp_c}°C</div>
                    <div style={{ color: '#d1d5db' }}>Return air: {h.design_criteria.return_air_temp_c}°C</div>
                    <div style={{ color: '#d1d5db' }}>Max room: {h.design_criteria.max_room_temp_c}°C</div>
                    <div style={{ color: '#d1d5db' }}>RH: {h.design_criteria.humidity_rh_low}–{h.design_criteria.humidity_rh_high}%</div>
                  </div>
                </div>
              )}
              {h.recommended_hvac && (
                <div style={{ background: '#0a1f20', borderRadius: 4, padding: '6px 8px', fontSize: 11, marginBottom: 6 }}>
                  <span style={{ color: '#67e8f9', fontWeight: 700 }}>Recommended: </span>
                  <span style={{ color: '#d1d5db' }}>{h.recommended_hvac.label} ({h.recommended_hvac.rating_kw || h.hvac_capacity_kw} kW, COP {h.recommended_hvac.cooling_cop})</span>
                </div>
              )}
              <div style={{ color: '#4b5563', fontSize: 10 }}>{h.reference}</div>
            </div>
          );
        })()}

        {/* Zoning Land Use Compatibility Guide */}
        {candidate.zoning_land_use_compatibility_guide && (() => {
          const z = candidate.zoning_land_use_compatibility_guide;
          const compColor = { EXCELLENT: '#22c55e', EXCELLENT_CONDUCTIVITY: '#84cc16', GOOD: '#84cc16', FAIR: '#f59e0b', POOR: '#ef4444' };
          const diffColor = { LOW: '#22c55e', MODERATE: '#f59e0b', HIGH: '#f97316', VERY_HIGH: '#ef4444' };
          return (
            <div>
              <h4 style={{ color: '#c084fc', marginBottom: 6, fontSize: 13, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' }}>
                Zoning Land Use Compatibility Guide
              </h4>
              <div style={{ background: '#130a1f', borderRadius: 6, padding: '10px 12px', marginBottom: 8, fontSize: 12 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 12px' }}>
                  <div><span style={{ color: '#9ca3af' }}>Est. tower height:</span> <strong style={{ color: '#c084fc' }}>{z.tower_height_est_m != null ? `${z.tower_height_est_m} m (${z.tower_height_est_ft} ft)` : '—'}</strong></div>
                  <div><span style={{ color: '#9ca3af' }}>Zoning tiers:</span> <strong>{z.n_zoning_tiers ?? '—'}</strong></div>
                  <div><span style={{ color: '#9ca3af' }}>NEPA triggers:</span> <strong>{z.n_nepa_triggers ?? '—'}</strong></div>
                  <div><span style={{ color: '#9ca3af' }}>Access reqs.:</span> <strong>{z.n_access_requirements ?? '—'}</strong></div>
                </div>
              </div>
              <div style={{ marginBottom: 8 }}>
                <div style={{ color: '#9ca3af', fontSize: 11, marginBottom: 4 }}>Zoning Compatibility by District</div>
                <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ color: '#6b7280', borderBottom: '1px solid #374151' }}>
                      <th style={{ textAlign: 'left', padding: '2px 4px' }}>Zone</th>
                      <th style={{ textAlign: 'center', padding: '2px 4px' }}>Compat.</th>
                      <th style={{ textAlign: 'center', padding: '2px 4px' }}>Difficulty</th>
                      <th style={{ textAlign: 'center', padding: '2px 4px' }}>Variance?</th>
                      <th style={{ textAlign: 'right', padding: '2px 4px' }}>Mo.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(z.zoning_tiers || []).map((tier, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid #1f2937' }}>
                        <td style={{ padding: '2px 4px', color: '#d1d5db' }}>{tier.label}</td>
                        <td style={{ padding: '2px 4px', textAlign: 'center', color: compColor[tier.compatibility] || '#9ca3af', fontWeight: 700, fontSize: 9 }}>{tier.compatibility?.replace(/_/g, ' ')}</td>
                        <td style={{ padding: '2px 4px', textAlign: 'center', color: diffColor[tier.approval_difficulty] || '#9ca3af' }}>{tier.approval_difficulty}</td>
                        <td style={{ padding: '2px 4px', textAlign: 'center', color: tier.variance_likely ? '#f97316' : '#22c55e' }}>{tier.variance_likely ? 'Yes' : 'No'}</td>
                        <td style={{ padding: '2px 4px', textAlign: 'right', color: '#9ca3af' }}>{tier.timeline_months}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {(z.access_requirements || []).length > 0 && (
                <div style={{ marginBottom: 6 }}>
                  <div style={{ color: '#9ca3af', fontSize: 11, marginBottom: 4 }}>Easement / Access Requirements</div>
                  {z.access_requirements.map((req, i) => (
                    <div key={i} style={{ fontSize: 10, marginBottom: 2, color: '#d1d5db' }}>
                      <span style={{ color: '#c084fc' }}>• {req.item}</span>
                      {req.width_m && <span style={{ color: '#6b7280' }}> ({req.width_m}m)</span>}
                    </div>
                  ))}
                </div>
              )}
              <div style={{ color: '#4b5563', fontSize: 10 }}>{z.reference}</div>
            </div>
          );
        })()}

        {/* Emergency Power Backup Guide */}
        {candidate.emergency_power_backup_guide && (() => {
          const e = candidate.emergency_power_backup_guide;
          const fmtKw = v => v != null ? `${v} kW` : '—';
          const fmtUsd = v => v != null ? `$${v.toLocaleString()}` : '—';
          return (
            <div>
              <h4 style={{ color: '#fb923c', marginBottom: 6, fontSize: 13, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' }}>
                Emergency Power Backup Guide
              </h4>
              <div style={{ background: '#1a0d00', borderRadius: 6, padding: '10px 12px', marginBottom: 8, fontSize: 12 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 12px' }}>
                  <div><span style={{ color: '#9ca3af' }}>Transmitter draw:</span> <strong>{fmtKw(e.transmitter_draw_kw)}</strong></div>
                  <div><span style={{ color: '#9ca3af' }}>Facility overhead:</span> <strong>{fmtKw(e.facility_overhead_kw)}</strong></div>
                  <div><span style={{ color: '#9ca3af' }}>Total load:</span> <strong style={{ color: '#fb923c' }}>{fmtKw(e.total_facility_load_kw)}</strong></div>
                  <div><span style={{ color: '#9ca3af' }}>Rec. generator:</span> <strong style={{ color: '#fbbf24' }}>{fmtKw(e.recommended_gen_kw)}</strong></div>
                  <div><span style={{ color: '#9ca3af' }}>UPS capacity:</span> <strong>{e.ups_capacity_wh != null ? `${e.ups_capacity_wh} Wh` : '—'}</strong></div>
                  <div><span style={{ color: '#9ca3af' }}>Est. capital cost:</span> <strong style={{ color: '#fb923c' }}>{fmtUsd(e.total_capex_est_usd)}</strong></div>
                  <div><span style={{ color: '#9ca3af' }}>72-hr diesel fuel:</span> <strong>{e.diesel_fuel_72hr_gal != null ? `${e.diesel_fuel_72hr_gal} gal` : '—'}</strong></div>
                  <div><span style={{ color: '#9ca3af' }}>Fuel storage class:</span> <strong style={{ color: '#9ca3af' }}>{e.fuel_storage_class?.replace(/_/g, ' ') || '—'}</strong></div>
                </div>
              </div>
              <div style={{ marginBottom: 8 }}>
                <div style={{ color: '#9ca3af', fontSize: 11, marginBottom: 4 }}>Generator Options</div>
                {(e.gen_options || []).map((g, i) => (
                  <div key={i} style={{ background: '#120800', borderRadius: 3, padding: '5px 8px', marginBottom: 4, fontSize: 11 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                      <span style={{ color: g.suitable ? '#fb923c' : '#6b7280', fontWeight: 700 }}>{g.label}</span>
                      <span style={{ color: '#9ca3af' }}>{g.rating_kw} kW · {g.fuel_type}</span>
                    </div>
                    <div style={{ color: '#22c55e', fontSize: 10 }}>{g.pros.join(' · ')}</div>
                    <div style={{ color: '#ef4444', fontSize: 10 }}>{g.cons.join(' · ')}</div>
                  </div>
                ))}
              </div>
              <div style={{ marginBottom: 6 }}>
                <div style={{ color: '#9ca3af', fontSize: 11, marginBottom: 4 }}>§11.35 Compliance Checklist</div>
                {(e.compliance_checklist || []).map((c, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, marginBottom: 2 }}>
                    <span style={{ color: c.status === 'REQUIRED' ? '#ef4444' : c.status === 'RECOMMENDED' ? '#f59e0b' : '#6b7280', minWidth: 80, fontWeight: 700 }}>{c.status}</span>
                    <span style={{ color: '#d1d5db' }}>{c.item}</span>
                  </div>
                ))}
              </div>
              <div style={{ color: '#4b5563', fontSize: 10 }}>{e.reference}</div>
            </div>
          );
        })()}

        {/* Market Competitive Analysis */}
        {candidate.market_competitive_analysis && (() => {
          const m = candidate.market_competitive_analysis;
          const mp = m.market_profile || {};
          const tierColor = { MAJOR_MARKET: '#ef4444', LARGE_MARKET: '#f97316', MEDIUM_MARKET: '#f59e0b', SMALL_MARKET: '#22c55e' };
          const chanColor = { CLEAR_CHANNEL: '#fbbf24', REGIONAL: '#60a5fa', LOCAL: '#a78bfa' };
          return (
            <div>
              <h4 style={{ color: '#34d399', marginBottom: 6, fontSize: 13, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' }}>
                Market Competitive Analysis
              </h4>
              <div style={{ background: '#0a1f14', borderRadius: 6, padding: '10px 12px', marginBottom: 8, fontSize: 12 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 12px' }}>
                  <div><span style={{ color: '#9ca3af' }}>Channel type:</span> <strong style={{ color: chanColor[m.channel_type] || '#d1d5db' }}>{m.channel_type?.replace(/_/g, ' ') || '—'}</strong></div>
                  <div><span style={{ color: '#9ca3af' }}>Market tier:</span> <strong style={{ color: tierColor[mp.competition_tier] || '#d1d5db' }}>{mp.competition_tier?.replace(/_/g, ' ') || '—'}</strong></div>
                  <div><span style={{ color: '#9ca3af' }}>Est. co-market AM:</span> <strong>{mp.n_am_typical != null ? `~${mp.n_am_typical} stations` : '—'}</strong></div>
                  <div><span style={{ color: '#9ca3af' }}>Co-channel radius:</span> <strong>{m.co_channel_competitor_radius_km != null ? `${m.co_channel_competitor_radius_km} km` : '—'}</strong></div>
                  <div><span style={{ color: '#9ca3af' }}>Moat factors:</span> <strong style={{ color: m.n_moat_factors >= 2 ? '#22c55e' : m.n_moat_factors === 1 ? '#f59e0b' : '#ef4444' }}>{m.n_moat_factors ?? 0}</strong></div>
                  <div><span style={{ color: '#9ca3af' }}>Revenue (median):</span> <strong>{m.revenue_benchmark_usd?.median != null ? `$${(m.revenue_benchmark_usd.median / 1000).toFixed(0)}K` : '—'}</strong></div>
                </div>
              </div>
              {(m.moat_factors || []).length > 0 && (
                <div style={{ marginBottom: 8 }}>
                  <div style={{ color: '#9ca3af', fontSize: 11, marginBottom: 4 }}>Competitive Moat Factors</div>
                  {m.moat_factors.map((f, i) => (
                    <div key={i} style={{ background: '#0f2a1a', borderRadius: 3, padding: '4px 8px', marginBottom: 3, fontSize: 11 }}>
                      <span style={{ color: '#34d399', fontWeight: 700 }}>{f.factor}: </span>
                      <span style={{ color: '#d1d5db' }}>{f.benefit}</span>
                    </div>
                  ))}
                </div>
              )}
              <div style={{ marginBottom: 6 }}>
                <div style={{ color: '#9ca3af', fontSize: 11, marginBottom: 4 }}>AM Format Market Share</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {(m.am_formats || []).map((f, i) => (
                    <div key={i} style={{ background: '#1a2a1a', borderRadius: 3, padding: '2px 6px', fontSize: 10 }}>
                      <span style={{ color: '#d1d5db' }}>{f.label} </span>
                      <span style={{ color: f.trend === 'GROWING' ? '#22c55e' : f.trend === 'DECLINING' ? '#ef4444' : '#9ca3af', fontWeight: 700 }}>{f.share_pct}%</span>
                    </div>
                  ))}
                </div>
              </div>
              {m.streaming_competition && (
                <div style={{ background: '#1a1a2e', borderRadius: 4, padding: '6px 8px', fontSize: 11, marginBottom: 6 }}>
                  <span style={{ color: '#9ca3af' }}>Streaming threat: </span>
                  <span style={{ color: m.streaming_competition.streaming_threat === 'HIGH' ? '#ef4444' : m.streaming_competition.streaming_threat === 'MODERATE' ? '#f59e0b' : '#22c55e', fontWeight: 700 }}>{m.streaming_competition.streaming_threat}</span>
                  <span style={{ color: '#6b7280' }}> · IBOC penetration: {m.streaming_competition.iboc_hd_pct}%</span>
                </div>
              )}
              <div style={{ color: '#4b5563', fontSize: 10 }}>{m.reference}</div>
            </div>
          );
        })()}

        {/* Terrain Path Loss Analysis */}
        {candidate.terrain_path_loss_analysis && (() => {
          const t = candidate.terrain_path_loss_analysis;
          const tc = t.terrain_class || {};
          const tierColors = { FLAT: '#22c55e', ROLLING: '#84cc16', HILLY: '#f59e0b', MOUNTAINOUS: '#f97316', SEVERE: '#ef4444' };
          const color = tierColors[tc.id] || '#9ca3af';
          return (
            <div>
              <h4 style={{ color: '#38bdf8', marginBottom: 6, fontSize: 13, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' }}>
                Terrain Path Loss Analysis
              </h4>
              <div style={{ background: '#0a1929', borderRadius: 6, padding: '10px 12px', marginBottom: 8, fontSize: 12 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 12px' }}>
                  <div><span style={{ color: '#9ca3af' }}>Terrain class:</span> <strong style={{ color }}>{tc.label || '—'}</strong></div>
                  <div><span style={{ color: '#9ca3af' }}>Δh roughness:</span> <strong>{tc.delta_h_m != null ? `${tc.delta_h_m} m` : '—'}</strong></div>
                  <div><span style={{ color: '#9ca3af' }}>Extra path loss:</span> <strong style={{ color: tc.path_loss_extra_db > 5 ? '#f97316' : '#d1d5db' }}>{tc.path_loss_extra_db != null ? `+${tc.path_loss_extra_db} dB` : '—'}</strong></div>
                  <div><span style={{ color: '#9ca3af' }}>Prop. study req.:</span> <strong style={{ color: t.propagation_study_required ? '#f87171' : '#22c55e' }}>{t.propagation_study_required ? 'Yes (ITM)' : 'No'}</strong></div>
                  <div><span style={{ color: '#9ca3af' }}>Eff. 2 mV/m reach:</span> <strong>{t.effective_2mvm_coverage_km != null ? `${t.effective_2mvm_coverage_km} km` : '—'}</strong></div>
                  <div><span style={{ color: '#9ca3af' }}>Cov. reduction:</span> <strong>{t.coverage_reduction_factor != null ? `${(t.coverage_reduction_factor * 100).toFixed(0)}%` : '—'}</strong></div>
                </div>
              </div>
              <div style={{ marginBottom: 8 }}>
                <div style={{ color: '#9ca3af', fontSize: 11, marginBottom: 4 }}>Path Loss Profile (smooth earth + terrain correction)</div>
                <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ color: '#6b7280', borderBottom: '1px solid #374151' }}>
                      <th style={{ textAlign: 'left', padding: '2px 4px' }}>Dist</th>
                      <th style={{ textAlign: 'right', padding: '2px 4px' }}>Smooth</th>
                      <th style={{ textAlign: 'right', padding: '2px 4px' }}>Terrain</th>
                      <th style={{ textAlign: 'right', padding: '2px 4px' }}>Total</th>
                      <th style={{ textAlign: 'right', padding: '2px 4px' }}>FS (mV/m)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(t.path_loss_profile || []).map((row, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid #1f2937' }}>
                        <td style={{ padding: '2px 4px', color: '#d1d5db' }}>{row.distance_km} km</td>
                        <td style={{ padding: '2px 4px', textAlign: 'right', color: '#9ca3af' }}>{row.smooth_loss_db} dB</td>
                        <td style={{ padding: '2px 4px', textAlign: 'right', color: '#9ca3af' }}>+{row.terrain_extra_db} dB</td>
                        <td style={{ padding: '2px 4px', textAlign: 'right', color: '#d1d5db' }}>{row.total_loss_db} dB</td>
                        <td style={{ padding: '2px 4px', textAlign: 'right', color: row.field_strength_mvm >= 2 ? '#22c55e' : row.field_strength_mvm >= 0.5 ? '#f59e0b' : '#6b7280' }}>{row.field_strength_mvm}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {t.ridge_diffraction?.applicable && (
                <div style={{ background: '#1c0a00', borderRadius: 4, padding: '6px 8px', fontSize: 11, marginBottom: 6 }}>
                  <span style={{ color: '#f97316', fontWeight: 700 }}>Ridge diffraction: </span>
                  <span style={{ color: '#d1d5db' }}>{t.ridge_diffraction.diffraction_loss_db} dB loss (ν={t.ridge_diffraction.nu}, Fresnel r={t.ridge_diffraction.fresnel_radius_m} m)</span>
                </div>
              )}
              {(t.propagation_notes || []).map((n, i) => (
                <div key={i} style={{ color: '#6b7280', fontSize: 10, marginBottom: 2 }}>• {n}</div>
              ))}
              <div style={{ color: '#4b5563', fontSize: 10, marginTop: 4 }}>{t.reference}</div>
            </div>
          );
        })()}

        {/* Antenna Height Optimization */}
        {candidate.antenna_height_optimization && (() => {
          const a = candidate.antenna_height_optimization;
          const fmtM = v => v != null ? `${v.toLocaleString()} m` : '—';
          const fmtFt = v => v != null ? `${v.toLocaleString()} ft` : '—';
          const fmtDeg = v => v != null ? `${v}°` : '—';
          return (
            <div>
              <h4 style={{ color: '#a78bfa', marginBottom: 6, fontSize: 13, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' }}>
                Antenna Height Optimization
              </h4>
              <div style={{ background: '#1a1a2e', borderRadius: 6, padding: '10px 12px', marginBottom: 8, fontSize: 12 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 12px' }}>
                  <div><span style={{ color: '#9ca3af' }}>Wavelength:</span> <strong>{fmtM(a.wavelength_m)}</strong></div>
                  <div><span style={{ color: '#9ca3af' }}>¼-wave (λ/4):</span> <strong>{fmtM(a.quarter_wave_m)}</strong></div>
                  <div><span style={{ color: '#9ca3af' }}>5/8-wave optimum:</span> <strong>{fmtM(a.five_eighths_wave_m)}</strong></div>
                  <div><span style={{ color: '#9ca3af' }}>Std height fraction:</span> <strong>{a.standard_height_fraction != null ? `${(a.standard_height_fraction * 100).toFixed(1)}%λ` : '—'}</strong></div>
                  <div><span style={{ color: '#9ca3af' }}>Std height:</span> <strong style={{ color: '#a78bfa' }}>{fmtM(a.standard_height_m)} / {fmtFt(a.standard_height_ft)}</strong></div>
                  <div><span style={{ color: '#9ca3af' }}>Electrical degrees:</span> <strong style={{ color: '#a78bfa' }}>{fmtDeg(a.standard_elec_deg)}</strong></div>
                  <div><span style={{ color: '#9ca3af' }}>Base loading needed:</span> <strong style={{ color: a.base_loading_needed ? '#f59e0b' : '#22c55e' }}>{a.base_loading_needed ? 'Yes' : 'No'}</strong></div>
                  {a.base_loading_needed && <div><span style={{ color: '#9ca3af' }}>Est. coil inductance:</span> <strong>{a.base_coil_uh_est != null ? `${a.base_coil_uh_est} µH` : '—'}</strong></div>}
                </div>
              </div>
              <div style={{ marginBottom: 8 }}>
                <div style={{ color: '#9ca3af', fontSize: 11, marginBottom: 4 }}>Height Tiers (efficiency relative to 5/8λ optimum)</div>
                <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ color: '#6b7280', borderBottom: '1px solid #374151' }}>
                      <th style={{ textAlign: 'left', padding: '2px 4px' }}>Label</th>
                      <th style={{ textAlign: 'right', padding: '2px 4px' }}>Deg</th>
                      <th style={{ textAlign: 'right', padding: '2px 4px' }}>Height</th>
                      <th style={{ textAlign: 'right', padding: '2px 4px' }}>Eff.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(a.height_tiers || []).map((tier, i) => {
                      const isRec = a.recommended_tier && tier.elec_deg === a.recommended_tier.elec_deg;
                      const isOpt = tier.eff_rel === 1.00;
                      return (
                        <tr key={i} style={{ borderBottom: '1px solid #1f2937', background: isRec ? '#1e1b4b' : 'transparent' }}>
                          <td style={{ padding: '2px 4px', color: isRec ? '#a78bfa' : isOpt ? '#fbbf24' : '#d1d5db' }}>
                            {tier.label}{isRec ? ' ★' : ''}{isOpt ? ' ◆' : ''}
                          </td>
                          <td style={{ padding: '2px 4px', textAlign: 'right', color: '#9ca3af' }}>{tier.elec_deg}°</td>
                          <td style={{ padding: '2px 4px', textAlign: 'right', color: '#9ca3af' }}>{tier.height_m != null ? `${tier.height_m} m` : '—'}</td>
                          <td style={{ padding: '2px 4px', textAlign: 'right', color: tier.eff_rel === 1.00 ? '#fbbf24' : '#9ca3af' }}>{tier.eff_rel != null ? `${(tier.eff_rel * 100).toFixed(0)}%` : '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {a.proof_of_performance && (
                <div style={{ background: '#0c1a1a', borderRadius: 4, padding: '6px 8px', fontSize: 11, marginBottom: 6 }}>
                  <span style={{ color: '#9ca3af' }}>Proof method:</span> <span style={{ color: '#d1d5db' }}>{a.proof_of_performance}</span>
                </div>
              )}
              {a.note && <div style={{ color: '#6b7280', fontSize: 10, fontStyle: 'italic', marginBottom: 4 }}>{a.note}</div>}
              <div style={{ color: '#4b5563', fontSize: 10 }}>{a.reference}</div>
            </div>
          );
        })()}

        {/* Population Demographics Overlay */}
        {candidate.population_demographics_overlay && (() => {
          const p = candidate.population_demographics_overlay;
          const fmtN = n => n != null ? n.toLocaleString() : '—';
          return (
            <div>
              <div className="rack-eyebrow mb-1">Population Demographics Overlay (§73.24j · Census ACS)</div>
              <div className="rack-panel p-3 mb-3">
                <div className="text-xs text-blue-200 mb-2">
                  Coverage population estimates at {p.frequency_khz} kHz, {p.tpo_kw} kW, σ={p.sigma_msm} mS/m.
                  <span className="text-gray-400 ml-1 italic">(Disc-area × density proxy; replace with Census API for filing accuracy.)</span>
                </div>
                <div className="space-y-1 mb-2">
                  {p.contours?.map(c => (
                    <div key={c.id} className="flex items-center gap-2 text-xs bg-gray-800 rounded px-2 py-1">
                      <span className="text-gray-300 flex-1">{c.label}</span>
                      <span className="text-blue-300 font-mono">{c.radius_km != null ? `${c.radius_km} km` : '—'}</span>
                      <span className="text-white font-mono">{fmtN(c.population_estimate)}</span>
                      <span className="text-gray-500">pop</span>
                    </div>
                  ))}
                </div>
                {p.audience_demographics && (
                  <div className="bg-gray-800 rounded p-2 text-xs mb-2">
                    <div className="text-gray-300 font-semibold mb-1">AM Audience Demographics (NAB/Nielsen 2023)</div>
                    <div className="grid grid-cols-2 gap-1">
                      <div className="text-gray-400">Median age: <span className="text-white">{p.audience_demographics.median_listener_age}</span></div>
                      <div className="text-gray-400">M/F: <span className="text-white">{p.audience_demographics.male_pct}/{p.audience_demographics.female_pct}%</span></div>
                      <div className="text-gray-400">Peak daypart: <span className="text-white">{p.audience_demographics.primary_daypart}</span></div>
                      <div className="text-gray-400">Weekly cume: <span className="text-white">{p.audience_demographics.weekly_cume_pct_of_adults_12plus}%</span></div>
                    </div>
                    <div className="mt-1 text-gray-400">Top formats: <span className="text-gray-300">{p.audience_demographics.top_formats.join(', ')}</span></div>
                  </div>
                )}
                <div className="text-xs text-gray-500">{p.reference}</div>
              </div>
            </div>
          );
        })()}

        {/* Power Line Interference Analysis */}
        {candidate.power_line_interference_analysis && (() => {
          const p = candidate.power_line_interference_analysis;
          const riskColor = r => r === 'HIGH' ? 'text-red-400' : r === 'MODERATE' ? 'text-amber-400' : r === 'LOW' ? 'text-yellow-300' : 'text-green-400';
          return (
            <div>
              <div className="rack-eyebrow mb-1">Power Line Interference Analysis (§73.184 · §15.615)</div>
              <div className="rack-panel p-3 mb-3">
                <div className="text-xs text-blue-200 mb-2">
                  Recommended minimum distance from power lines: <span className="text-white font-mono">{p.recommended_min_distance_m} m</span>.
                  BPL exclusion zone: <span className={p.bpl_exclusion_applicable ? 'text-amber-300 font-bold' : 'text-gray-400'}>{p.bpl_exclusion_applicable ? `${p.bpl_exclusion_zone_km} km (§15.615)` : 'N/A'}</span>.
                </div>
                <div className="text-xs font-semibold text-gray-300 mb-1">Distance Risk Tiers</div>
                <div className="space-y-0.5 mb-2">
                  {p.risk_tiers?.map(t => (
                    <div key={t.label} className="flex items-center gap-2 text-xs bg-gray-800 rounded px-2 py-0.5">
                      <span className={`font-bold w-16 ${riskColor(t.risk)}`}>{t.label}</span>
                      <span className="text-gray-500 font-mono w-24">{t.min_m}–{t.max_m === Infinity ? '∞' : t.max_m}m</span>
                      <span className="text-gray-400 text-xs flex-1">{t.note?.slice(0, 60)}…</span>
                    </div>
                  ))}
                </div>
                <div className="text-xs font-semibold text-gray-300 mb-1">Mitigation Options</div>
                <div className="space-y-0.5 mb-2">
                  {p.mitigation_options?.map(m => (
                    <div key={m.id} className="text-xs bg-gray-800 rounded px-2 py-0.5 flex items-center gap-2">
                      <span className="text-blue-300 flex-1">{m.strategy}</span>
                      <span className={`font-bold text-xs ${riskColor(m.effectiveness === 'HIGH' ? 'MINIMAL' : m.effectiveness === 'MODERATE' ? 'MODERATE' : 'HIGH')}`}>{m.effectiveness}</span>
                    </div>
                  ))}
                </div>
                <div className="text-xs text-gray-500">{p.reference}</div>
              </div>
            </div>
          );
        })()}

        {/* Station Relocation Cost Estimator */}
        {candidate.station_relocation_cost_estimator && (() => {
          const c = candidate.station_relocation_cost_estimator;
          const fmt = v => `$${v?.toLocaleString()}`;
          return (
            <div>
              <div className="rack-eyebrow mb-1">Station Relocation Cost Estimator</div>
              <div className="rack-panel p-3 mb-3">
                <div className="grid grid-cols-3 gap-2 text-xs text-center mb-3">
                  <div className="bg-gray-800 rounded p-2">
                    <div className="text-gray-400">Low Estimate</div>
                    <div className="text-green-300 font-mono font-bold">{fmt(c.total_low)}</div>
                  </div>
                  <div className="bg-gray-800 rounded p-2 border border-blue-700">
                    <div className="text-gray-400">Midpoint</div>
                    <div className="text-blue-300 font-mono font-bold">{fmt(c.total_midpoint)}</div>
                  </div>
                  <div className="bg-gray-800 rounded p-2">
                    <div className="text-gray-400">High Estimate</div>
                    <div className="text-amber-300 font-mono font-bold">{fmt(c.total_high)}</div>
                  </div>
                </div>
                <div className="space-y-0.5 mb-2">
                  {c.line_items?.map(li => (
                    <div key={li.id} className="flex items-center gap-2 text-xs rounded px-2 py-0.5 hover:bg-gray-800">
                      <span className="text-gray-400 flex-1">{li.category}</span>
                      <span className="text-gray-300 font-mono">{fmt(li.low)}</span>
                      <span className="text-gray-500">–</span>
                      <span className="text-gray-300 font-mono">{fmt(li.high)}</span>
                    </div>
                  ))}
                </div>
                <div className="text-xs text-gray-500 italic">{c.note}</div>
              </div>
            </div>
          );
        })()}

        {/* RF Exposure / MPE Analysis */}
        {candidate.rf_exposure_mpe_analysis && (() => {
          const r = candidate.rf_exposure_mpe_analysis;
          const statusColor = r.compliance_status === 'CATEGORICALLY_EXCLUDED' ? 'text-green-300' : 'text-amber-300';
          return (
            <div>
              <div className="rack-eyebrow mb-1">RF Exposure / MPE Analysis (§1.1310 · OET Bul 65)</div>
              <div className="rack-panel p-3 mb-3">
                <div className="flex items-center gap-3 mb-2 text-xs">
                  <span className="text-gray-400">Status:</span>
                  <span className={`font-bold ${statusColor}`}>{r.compliance_status?.replace(/_/g,' ')}</span>
                  <span className="text-gray-500">({r.tpo_kw} kW {r.evaluation_required ? '≥' : '<'} {r.evaluation_threshold_kw} kW threshold)</span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs mb-2">
                  <div className="bg-gray-800 rounded p-2">
                    <div className="text-gray-400">MPE Limit (gen. pop.)</div>
                    <div className="text-white font-mono">{r.mpe_general_population_mw_cm2} mW/cm²</div>
                    <div className="text-gray-500">{r.mpe_general_population_e_vm} V/m · {r.mpe_general_population_h_am} A/m</div>
                  </div>
                  <div className="bg-gray-800 rounded p-2">
                    <div className="text-gray-400">Exclusion Zone</div>
                    <div className="text-amber-300 font-mono">{r.exclusion_radius_m} m ({r.exclusion_radius_ft} ft)</div>
                    <div className="text-gray-500">Occupational: {r.occupational_exclusion_m} m</div>
                  </div>
                </div>
                <div className="text-xs font-semibold text-gray-300 mb-1">Filing Exhibits Required</div>
                <div className="space-y-1 mb-2">
                  {r.filing_exhibits?.map(e => (
                    <div key={e.id} className="text-xs bg-gray-800 rounded px-2 py-1 flex items-start gap-2">
                      <span className="text-gray-500 flex-shrink-0">{e.rule}</span>
                      <span className="text-gray-300">{e.exhibit}</span>
                    </div>
                  ))}
                </div>
                <div className="text-xs text-gray-400 italic mb-1">{r.monitoring_requirement}</div>
                <div className="text-xs text-gray-500">{r.reference}</div>
              </div>
            </div>
          );
        })()}

        {/* Tower Lighting & Marking Guide */}
        {candidate.tower_lighting_marking_guide && (() => {
          const t = candidate.tower_lighting_marking_guide;
          const asrColor = t.asr_required ? 'text-amber-300' : 'text-green-300';
          return (
            <div>
              <div className="rack-eyebrow mb-1">Tower Lighting & Marking Guide (§17.21 · FAA AC 70/7460-1M)</div>
              <div className="rack-panel p-3 mb-3">
                <div className="text-xs text-blue-200 mb-2">
                  Estimated tower height: <span className="text-white font-mono">{t.tower_height_estimate_m} m ({t.tower_height_estimate_ft} ft)</span> ({t.tower_height_basis}).
                  ASR: <span className={`font-bold ${asrColor}`}>{t.asr_required ? 'REQUIRED' : 'Not required'}</span>
                  (≥ {t.asr_threshold_m}m threshold).
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs mb-2">
                  <div className="bg-gray-800 rounded p-2">
                    <div className="text-gray-400">FAA Tier</div>
                    <div className="text-amber-300 font-semibold">{t.faa_lighting_tier}</div>
                  </div>
                  <div className="bg-gray-800 rounded p-2">
                    <div className="text-gray-400">Lighting</div>
                    <div className="text-white text-xs">{t.faa_lighting_required ?? 'None required'}</div>
                  </div>
                </div>
                {t.faa_marking_required && (
                  <div className="text-xs bg-gray-800 rounded px-2 py-1 mb-2">
                    <span className="text-gray-400">Marking: </span>
                    <span className="text-gray-300">{t.faa_marking_required}</span>
                  </div>
                )}
                {t.led_retrofit?.applicable && (
                  <div className="text-xs bg-blue-900 rounded px-2 py-1 mb-2">
                    <div className="text-blue-300 font-semibold mb-1">LED Retrofit Available</div>
                    <div className="text-gray-300">Energy savings: {t.led_retrofit.energy_savings_pct}% · L-810: {t.led_retrofit.led_power_l810_w}W · L-864: {t.led_retrofit.led_power_l864_w}W</div>
                    <div className="text-gray-400">{t.led_retrofit.note}</div>
                  </div>
                )}
                <div className="text-xs font-semibold text-gray-300 mb-1">Maintenance Obligations</div>
                <div className="space-y-0.5 mb-2">
                  {t.maintenance_obligations?.map(m => (
                    <div key={m.id} className="text-xs bg-gray-800 rounded px-2 py-0.5 flex items-start gap-2">
                      <span className="text-gray-500 flex-shrink-0">{m.rule}</span>
                      <span className="text-gray-300">{m.task}</span>
                    </div>
                  ))}
                </div>
                <div className="text-xs text-gray-500">{t.reference}</div>
              </div>
            </div>
          );
        })()}

        {/* EAS / ACP Compliance Guide */}
        {candidate.eas_acp_compliance_guide && (() => {
          const e = candidate.eas_acp_compliance_guide;
          const statusBadgeEas = req => req ? <span className="text-red-300 font-bold">REQ</span> : <span className="text-gray-500">OPT</span>;
          return (
            <div>
              <div className="rack-eyebrow mb-1">EAS / ACP Compliance Guide (47 CFR Part 11)</div>
              <div className="rack-panel p-3 mb-3">
                <div className="text-xs text-blue-200 mb-2">
                  EAS participation: <span className="text-amber-300 font-bold">{e.eas_participation}</span> for all AM stations.
                  Monitor <span className="text-white font-mono">{e.monitoring_sources_required}</span> LP sources.
                  IPAWS: <span className={e.ipaws_required ? 'text-red-300 font-bold' : 'text-green-300'}>{e.ipaws_required ? 'REQUIRED' : 'NOT REQUIRED'}</span>.
                </div>
                <div className="text-xs font-semibold text-gray-300 mb-1">Equipment Requirements</div>
                <div className="space-y-1 mb-2">
                  {e.equipment_requirements?.map(r => (
                    <div key={r.id} className="flex items-start gap-2 text-xs bg-gray-800 rounded px-2 py-1">
                      <span className="min-w-[32px]">{statusBadgeEas(r.required)}</span>
                      <span className="text-gray-300 font-semibold min-w-[120px]">{r.device}</span>
                      <span className="text-gray-500 text-xs">{r.note}</span>
                    </div>
                  ))}
                </div>
                <div className="text-xs font-semibold text-gray-300 mb-1">Test Schedule</div>
                <div className="space-y-1 mb-2">
                  {e.test_schedule?.map(t => (
                    <div key={t.id} className="flex items-center gap-2 text-xs bg-gray-800 rounded px-2 py-1">
                      <span className="text-blue-300 font-mono font-bold w-8">{t.id.toUpperCase()}</span>
                      <span className="text-gray-300 flex-1">{t.test}</span>
                      <span className="text-gray-500">{t.freq}</span>
                    </div>
                  ))}
                </div>
                <div className="text-xs text-gray-400 mb-1">{e.monitoring_note}</div>
                <div className="text-xs text-gray-500">{e.reference}</div>
              </div>
            </div>
          );
        })()}

        {/* Skywave Coverage Analysis */}
        {candidate.skywave_coverage_analysis && (() => {
          const s = candidate.skywave_coverage_analysis;
          const nifColor = s.nif_required ? 'text-amber-300' : 'text-green-300';
          return (
            <div>
              <div className="rack-eyebrow mb-1">Skywave Coverage Analysis (§73.182)</div>
              <div className="rack-panel p-3 mb-3">
                <div className="text-xs text-blue-200 mb-2">
                  Nighttime skywave at {s.actual_night_power_kw} kW ({s.fcc_class} class max {s.nighttime_power_max_kw} kW).
                  NIF study: <span className={`font-bold ${nifColor}`}>{s.nif_required ? s.nif_study_type : 'NOT REQUIRED'}</span>.
                </div>
                <div className="grid grid-cols-3 gap-2 text-xs text-center mb-2">
                  <div className="bg-gray-800 rounded p-2">
                    <div className="text-gray-400">50% Time</div>
                    <div className="text-blue-300 font-mono">{s.skywave_dist_50pct_km} km</div>
                  </div>
                  <div className="bg-gray-800 rounded p-2">
                    <div className="text-gray-400">10% Time</div>
                    <div className="text-indigo-300 font-mono">{s.skywave_dist_10pct_km} km</div>
                  </div>
                  <div className="bg-gray-800 rounded p-2">
                    <div className="text-gray-400">1% Time (NIF)</div>
                    <div className="text-purple-300 font-mono">{s.skywave_dist_1pct_km} km</div>
                  </div>
                </div>
                <div className="text-xs text-gray-300 mb-1 italic">{s.nighttime_da_note}</div>
                <div className="text-xs font-semibold text-gray-300 mb-1">Protection Levels</div>
                <div className="space-y-1 mb-2">
                  {s.protection_levels?.filter(p => p.applies_to_us).map(p => (
                    <div key={p.id} className="flex items-start gap-2 text-xs bg-gray-800 rounded px-2 py-1">
                      <span className="text-amber-300 font-mono w-14 flex-shrink-0">{p.field_mvm} mV/m</span>
                      <span className="text-gray-400">{p.basis}</span>
                    </div>
                  ))}
                </div>
                <div className="text-xs text-gray-500">{s.reference}</div>
              </div>
            </div>
          );
        })()}

        {/* Radial System Engineering Guide */}
        {candidate.radial_system_engineering_guide && (() => {
          const r = candidate.radial_system_engineering_guide;
          const tierColor = n => n >= 120 ? 'text-green-400' : n >= 60 ? 'text-amber-400' : 'text-red-400';
          return (
            <div>
              <div className="rack-eyebrow mb-1">Ground Radial System Engineering (§73.190 · Terman/Belrose)</div>
              <div className="rack-panel p-3 mb-3">
                <div className="text-xs text-blue-200 mb-2">
                  λ = {r.wavelength_m} m at {r.frequency_khz} kHz.
                  Optimum radial: <span className="text-white font-mono">0.4λ = {r.optimum_radial_length_m} m ({r.optimum_radial_length_ft} ft)</span>.
                  Recommended: <span className={`font-bold font-mono ${tierColor(r.recommended_n_radials)}`}>{r.recommended_n_radials} radials</span>
                  at {r.radial_spacing_deg}° spacing.
                </div>
                <div className="grid grid-cols-3 gap-2 text-xs text-center mb-2">
                  <div className="bg-gray-800 rounded p-2">
                    <div className="text-gray-400">Total Copper</div>
                    <div className="text-white font-mono">{r.total_radial_length_m?.toLocaleString()} m</div>
                  </div>
                  <div className="bg-gray-800 rounded p-2">
                    <div className="text-gray-400">Material Cost</div>
                    <div className="text-amber-300 font-mono">${r.material_cost_usd_estimate?.toLocaleString()}</div>
                  </div>
                  <div className="bg-gray-800 rounded p-2">
                    <div className="text-gray-400">Copper Mass</div>
                    <div className="text-white font-mono">{r.copper_mass_kg} kg</div>
                  </div>
                </div>
                <div className="text-xs font-semibold text-gray-300 mb-1">Radial Count Tiers (Terman/Belrose)</div>
                <div className="space-y-1 mb-2">
                  {r.radial_tiers?.map(t => (
                    <div key={t.n} className={`flex items-center gap-2 text-xs rounded px-2 py-1 ${t.n === r.recommended_n_radials ? 'bg-blue-900 border border-blue-600' : 'bg-gray-800'}`}>
                      <span className={`font-mono font-bold w-8 ${tierColor(t.n)}`}>{t.n}</span>
                      <span className="text-gray-400 flex-1">{t.label}</span>
                      <span className="text-white font-mono">{t.efficiency_pct}%</span>
                      <span className="text-gray-500 font-mono">{t.ground_loss_ohm} Ω</span>
                    </div>
                  ))}
                </div>
                <div className="text-xs text-gray-400 mb-1">
                  Wire: #{r.recommended_awg} AWG copper · Burial: ≥ {r.burial_depth_inches}" depth
                </div>
                <div className="text-xs text-gray-500">{r.reference}</div>
              </div>
            </div>
          );
        })()}

        {/* Construction Permit Timeline Optimizer */}
        {candidate.construction_permit_timeline_optimizer && (() => {
          const t = candidate.construction_permit_timeline_optimizer;
          const phaseColors = ['text-blue-400','text-indigo-400','text-purple-400','text-amber-400','text-green-400','text-emerald-400'];
          return (
            <div>
              <div className="rack-eyebrow mb-1">CP Timeline Optimizer (§73.3533 · §73.3598)</div>
              <div className="rack-panel p-3 mb-3">
                <div className="text-xs text-blue-200 mb-2">
                  {t.fcc_class} class {t.is_directional ? 'directional' : 'non-directional'} AM relocation.
                  Optimistic: <span className="text-green-300 font-mono">{t.total_optimistic_months} mo</span> ·
                  Conservative: <span className="text-amber-300 font-mono">{t.total_conservative_months} mo</span> ·
                  <span className="text-white font-mono"> {t.total_milestones} milestones</span> across {t.n_phases} phases.
                </div>
                <div className="space-y-2 mb-2">
                  {t.phases?.map((phase, idx) => (
                    <div key={phase.id} className="bg-gray-800 rounded p-2">
                      <div className={`text-xs font-bold mb-1 ${phaseColors[idx % phaseColors.length]}`}>
                        Phase {idx + 1}: {phase.label}
                        <span className="text-gray-400 font-normal ml-2">
                          {phase.weeks_optimistic}–{phase.weeks_conservative} wk
                        </span>
                      </div>
                      <div className="space-y-0.5">
                        {phase.milestones.map(m => (
                          <div key={m.id} className="flex items-start gap-1 text-xs">
                            <span className={`mt-0.5 w-2 h-2 rounded-full flex-shrink-0 ${t.critical_path_milestone_ids?.includes(m.id) ? 'bg-red-400' : 'bg-gray-600'}`} />
                            <span className="text-gray-300">{m.task}</span>
                            {m.rule && <span className="text-gray-500 flex-shrink-0">({m.rule})</span>}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="text-xs text-gray-400 mb-1">
                  <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-400 inline-block" /> Critical path milestone</span>
                  <span className="ml-3 inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-gray-600 inline-block" /> Standard milestone</span>
                </div>
                <div className="text-xs text-gray-500">{t.reference}</div>
              </div>
            </div>
          );
        })()}

        {/* Co-Channel Interference Budget */}
        {candidate.co_channel_interference_budget && (() => {
          const d = candidate.co_channel_interference_budget;
          const tierColor = du => du >= 20 ? 'text-green-400' : du >= 6 ? 'text-amber-400' : 'text-red-400';
          return (
            <div>
              <div className="rack-eyebrow mb-1">Co-Channel Interference Budget (§73.182 · §73.207)</div>
              <div className="rack-panel p-3 mb-3">
                <div className="text-xs text-blue-200 mb-2">
                  D/U ratio framework for co-channel AM interference at {d.frequency_khz} kHz.
                  Required co-channel spacing: <span className="text-white font-mono">{d.required_cc_spacing_km} km</span> (Class {d.fcc_class}).
                  NIF study: <span className={d.nif_study_required ? 'text-amber-300 font-bold' : 'text-green-300'}>{d.nif_study_required ? d.nif_study_type : 'NOT REQUIRED'}</span>.
                </div>
                <div className="grid grid-cols-2 gap-2 mb-2 text-xs">
                  <div className="bg-gray-800 rounded p-2">
                    <div className="text-gray-400">Daytime D/U Min</div>
                    <div className="text-white font-mono">{d.du_daytime_min_db} dB</div>
                  </div>
                  <div className="bg-gray-800 rounded p-2">
                    <div className="text-gray-400">Nighttime D/U Min</div>
                    <div className="text-white font-mono">{d.du_nighttime_min_db} dB</div>
                  </div>
                </div>
                <div className="text-xs font-semibold text-gray-300 mb-1">Threat Tiers</div>
                <div className="space-y-1 mb-2">
                  {d.threat_tiers?.map(t => (
                    <div key={t.tier} className="flex items-center gap-2 text-xs bg-gray-800 rounded px-2 py-1">
                      <span className="text-gray-500 w-4">{t.tier}</span>
                      <span className="text-gray-300 flex-1">{t.label}</span>
                      <span className={`font-mono font-bold ${tierColor(t.du_threshold_db)}`}>{t.du_threshold_db} dB</span>
                    </div>
                  ))}
                </div>
                <div className="text-xs font-semibold text-gray-300 mb-1">Mitigation Strategies</div>
                <div className="space-y-1 mb-2">
                  {d.mitigation_strategies?.map(m => (
                    <div key={m.id} className="text-xs bg-gray-800 rounded px-2 py-1">
                      <span className="text-blue-300 font-semibold">{m.strategy}</span>
                      <span className="text-gray-400 ml-2">· {m.impact_db}</span>
                    </div>
                  ))}
                </div>
                <div className="text-xs text-gray-500">{d.reference}</div>
              </div>
            </div>
          );
        })()}

        {/* AM IBOC / HD Radio Analysis */}
        {candidate.iboc_hd_radio_analysis && (() => {
          const h = candidate.iboc_hd_radio_analysis;
          const riskColor = r => r === 'HIGH' ? 'text-red-400' : r === 'MODERATE' ? 'text-amber-400' : 'text-green-400';
          const statusBadge = s => {
            if (s === 'MANDATORY' || s === 'REQUIRED') return <span className="text-red-300 font-bold">REQ</span>;
            if (s === 'REQUIRED_FOR_AM_IBOC') return <span className="text-amber-300 font-bold">AM-REQ</span>;
            return <span className="text-gray-400">OPT</span>;
          };
          return (
            <div>
              <div className="rack-eyebrow mb-1">AM IBOC / HD Radio Analysis (§73.404 · NRSC-5-D)</div>
              <div className="rack-panel p-3 mb-3">
                <div className="text-xs text-blue-200 mb-2">
                  AM IBOC (HD Radio) adds digital sidebands at ±10–15 kHz around the {h.frequency_khz} kHz carrier.
                  No FCC authorization required — file notification within 10 days of commencement (§73.404(d)).
                </div>
                <div className="grid grid-cols-2 gap-2 mb-2 text-xs">
                  <div className="bg-gray-800 rounded p-2">
                    <div className="text-gray-400">Analog Reach (0.5 mV/m)</div>
                    <div className="text-white font-mono">{h.analog_reach_km != null ? `${h.analog_reach_km} km` : '—'}</div>
                  </div>
                  <div className="bg-gray-800 rounded p-2">
                    <div className="text-gray-400">Digital Reach (~85%)</div>
                    <div className="text-blue-300 font-mono">{h.iboc_digital_reach_km != null ? `${h.iboc_digital_reach_km} km` : '—'}</div>
                  </div>
                  <div className="bg-gray-800 rounded p-2">
                    <div className="text-gray-400">Digital Sideband ERP</div>
                    <div className="text-white font-mono">{h.digital_sideband_erp_kw?.toFixed(4)} kW ({h.iboc_digital_erp_dbw} dBc)</div>
                  </div>
                  <div className="bg-gray-800 rounded p-2">
                    <div className="text-gray-400">Nighttime Interference Risk</div>
                    <div className={`font-bold font-mono ${riskColor(h.nighttime_interference_risk)}`}>{h.nighttime_interference_risk}</div>
                  </div>
                </div>
                <div className="text-xs text-gray-300 mb-2 italic">{h.nighttime_note}</div>
                <div className="text-xs font-semibold text-gray-300 mb-1">NRSC-5-D Requirements</div>
                <div className="space-y-1 mb-2">
                  {h.nrsc5_requirements?.map(r => (
                    <div key={r.id} className="flex items-start gap-2 text-xs bg-gray-800 rounded px-2 py-1">
                      <span className="min-w-[40px]">{statusBadge(r.status)}</span>
                      <span className="text-gray-300 font-semibold min-w-[160px]">{r.req}</span>
                      <span className="text-gray-500">{r.note}</span>
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs mb-2">
                  <div className="bg-gray-800 rounded p-2">
                    <div className="text-gray-400">Equipment Cost Est.</div>
                    <div className="text-white font-mono">${h.equipment_cost_estimate_usd?.low?.toLocaleString()} – ${h.equipment_cost_estimate_usd?.high?.toLocaleString()}</div>
                  </div>
                  <div className="bg-gray-800 rounded p-2">
                    <div className="text-gray-400">Filing Requirement</div>
                    <div className="text-green-300">{h.filing_requirement?.form}</div>
                  </div>
                </div>
                <div className="text-xs text-gray-500 mt-1">{h.reference}</div>
              </div>
            </div>
          );
        })()}

        {/* Coverage Service Area Map Spec */}
        {candidate.coverage_service_area_map_spec && (() => {
          const m = candidate.coverage_service_area_map_spec;
          const colContour     = m.contours?.find(c => c.id === 'col_min');
          const standardContour= m.contours?.find(c => c.id === 'standard');
          const primaryContour = m.contours?.find(c => c.id === 'primary');
          const blanketContour = m.contours?.find(c => c.id === 'blanket');
          const fmt = v => v != null ? `${v} km` : '—';
          const fmtKm2 = v => v != null ? `${v.toLocaleString()} km²` : '—';
          return (
            <div>
              <div className="rack-eyebrow mb-1">Coverage Service Area Map Spec (§73.24)</div>
              <div className="rack-panel p-3 mb-3">
                <div className="text-xs text-blue-200 mb-2">
                  Four regulatory contours for deck.gl/MapLibre rendering centered at candidate site
                  ({m.candidate_lat?.toFixed(4)}, {m.candidate_lon?.toFixed(4)}).
                  Radii computed via FCC groundwave curves at {m.frequency_khz} kHz, {m.tpo_kw} kW TPO,
                  σ = {m.sigma_msm} mS/m.
                </div>
                <div className="grid grid-cols-2 gap-2 mb-3">
                  {m.contours?.map(c => (
                    <div key={c.id} className="bg-gray-800 rounded p-2 border-l-2" style={{ borderColor: c.color }}>
                      <div className="text-xs font-bold" style={{ color: c.color }}>{c.label}</div>
                      <div className="text-xs text-gray-300">{c.mvm} mV/m threshold</div>
                      <div className="text-xs text-white font-mono">{fmt(c.radius_km)}</div>
                      <div className="text-xs text-gray-400">Priority {c.priority} · {c.n_sides}-sided</div>
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-3 gap-2 text-xs text-center mb-2">
                  <div className="bg-gray-800 rounded p-2">
                    <div className="text-gray-400">COL Area</div>
                    <div className="text-green-300 font-mono">{fmtKm2(m.col_service_area_km2)}</div>
                  </div>
                  <div className="bg-gray-800 rounded p-2">
                    <div className="text-gray-400">Primary Area</div>
                    <div className="text-indigo-300 font-mono">{fmtKm2(m.primary_area_km2)}</div>
                  </div>
                  <div className="bg-gray-800 rounded p-2">
                    <div className="text-gray-400">Blanket Area</div>
                    <div className="text-red-300 font-mono">{fmtKm2(m.blanket_area_km2)}</div>
                  </div>
                </div>
                {m.render_spec && (
                  <div className="bg-gray-900 rounded p-2 text-xs text-gray-400">
                    <span className="text-gray-300 font-semibold">Render: </span>
                    {m.render_spec.layer_type} · {m.render_spec.coordinate_system} ·
                    center [{m.candidate_lon?.toFixed(4)}, {m.candidate_lat?.toFixed(4)}]
                  </div>
                )}
              </div>
            </div>
          );
        })()}

        {/* Transmitter Facility Design Guide */}
        {candidate.transmitter_facility_design_guide && (() => {
          const f = candidate.transmitter_facility_design_guide;
          const fuelColor = s => s === 'AST_SECONDARY_CONTAINMENT' ? 'text-amber-400' : 'text-blue-300';
          return (
            <div>
              <div className="rack-eyebrow mb-1">§73.49 Transmitter Facility Design Guide</div>
              {/* Electrical service metrics */}
              <div className="grid grid-cols-4 gap-1 mb-2">
                {[
                  { label: 'TX efficiency', value: `${f.transmitter_efficiency_pct}%` },
                  { label: 'AC draw',        value: `${f.ac_power_draw_kw} kW` },
                  { label: 'Service size',   value: `${f.recommended_service_size_a}A` },
                  { label: 'HVAC req.',      value: `${f.hvac_required_tons} tons` }
                ].map(m => (
                  <div key={m.label} className="bg-surface rounded p-1 text-center border border-rule">
                    <div className="font-mono text-[10px] text-textBright font-bold">{m.value}</div>
                    <div className="font-mono text-[8px] text-textDim mt-0.5">{m.label}</div>
                  </div>
                ))}
              </div>
              {/* Fencing */}
              <div className="font-mono text-[9px] text-textDim mb-1">§73.49 Fencing Requirement</div>
              <div className="bg-surface rounded p-2 border border-rule mb-2">
                <div className="flex gap-2 items-center mb-1">
                  <span className={`font-mono text-[8px] font-bold ${f.fencing.required ? 'text-amber-400' : 'text-emerald-400'}`}>
                    {f.fencing.required ? 'REQUIRED' : 'NOT REQUIRED'}
                  </span>
                  {f.fencing.minimum_height_ft && (
                    <span className="font-mono text-[8px] text-textDim">Min {f.fencing.minimum_height_ft} ft · {f.fencing.material}</span>
                  )}
                </div>
                {f.fencing.warning_signs && (
                  <div className="font-mono text-[8px] text-textDim">Signs: {f.fencing.warning_signs}</div>
                )}
              </div>
              {/* Standby generator */}
              <div className="font-mono text-[9px] text-textDim mb-1">Standby Generator</div>
              <div className="grid grid-cols-2 gap-1 mb-2">
                {[
                  { label: 'Rating',         value: `${f.standby_generator?.rating_kw} kW` },
                  { label: 'Fuel',           value: f.standby_generator?.fuel_type?.toUpperCase() ?? '—' },
                  { label: 'Tank (gal)',      value: `${f.standby_generator?.fuel_tank_gallons}` },
                  { label: '72-hr runtime',  value: `${f.standby_generator?.runtime_hours_72hr_load} hr` }
                ].map(m => (
                  <div key={m.label} className="bg-surface rounded p-1 text-center border border-rule">
                    <div className="font-mono text-[10px] text-textBright font-bold">{m.value}</div>
                    <div className="font-mono text-[8px] text-textDim mt-0.5">{m.label}</div>
                  </div>
                ))}
              </div>
              {f.standby_generator?.fuel_storage_requirement && (
                <div className={`font-mono text-[8px] mb-1 ${fuelColor(f.standby_generator.fuel_storage_requirement)}`}>
                  Fuel storage: {f.standby_generator.fuel_storage_requirement.replace(/_/g, ' ')}
                </div>
              )}
              {/* Building specs */}
              <div className="font-mono text-[9px] text-textDim mb-1">Transmitter Building</div>
              <div className="grid grid-cols-2 gap-1 mb-2">
                {[
                  { label: 'Type',       value: f.building_specs?.type?.replace(/_/g, ' ') ?? '—' },
                  { label: 'Min area',   value: `${f.building_specs?.min_floor_area_sf ?? '—'} sf` },
                  { label: 'Elec panel', value: f.building_specs?.electrical_panel ?? '—' },
                  { label: 'Cost est.',  value: f.construction_cost_estimate_usd ? `$${f.construction_cost_estimate_usd.low?.toLocaleString()}–$${f.construction_cost_estimate_usd.high?.toLocaleString()}` : '—' }
                ].map(m => (
                  <div key={m.label} className="bg-surface rounded p-1 border border-rule">
                    <div className="font-mono text-[8px] text-textDim">{m.label}</div>
                    <div className="font-mono text-[8px] text-textBright font-bold leading-tight">{m.value}</div>
                  </div>
                ))}
              </div>
              <div className="font-mono text-[8px] text-textDim leading-snug">{f.note}</div>
            </div>
          );
        })()}

        {/* Soil Conductivity Improvement Guide */}
        {candidate.soil_conductivity_improvement_guide && (() => {
          const sc = candidate.soil_conductivity_improvement_guide;
          const classColor = c => c === 'EXCELLENT' ? 'text-emerald-400' : c === 'GOOD' ? 'text-blue-300' : c === 'FAIR' ? 'text-amber-400' : 'text-rose-400';
          return (
            <div>
              <div className="rack-eyebrow mb-1">Soil Conductivity Improvement Guide (§73.190)</div>
              <div className="flex flex-wrap gap-1.5 mb-2">
                <span className={`font-mono text-[9px] px-1.5 py-0.5 rounded border font-bold bg-surface/40 border-rule ${classColor(sc.soil_class_current)}`}>
                  {sc.soil_class_current} · σ = {sc.sigma_msm_current} mS/m
                </span>
                <span className="font-mono text-[9px] text-textDim px-1 py-0.5">
                  ρ = {sc.soil_resistivity_ohm_m} Ω·m
                </span>
                {sc.improvement_needed && (
                  <span className="font-mono text-[8px] text-amber-400 px-1 py-0.5 border border-amber-700/50 rounded">IMPROVEMENT RECOMMENDED</span>
                )}
              </div>
              {sc.reach_gain_km != null && (
                <div className="grid grid-cols-3 gap-1 mb-2">
                  {[
                    { label: 'Current reach (0.5 mV/m)', value: sc.reach_current_km != null ? `${sc.reach_current_km} km` : '—' },
                    { label: 'Improved reach (est.)',     value: sc.reach_improved_km != null ? `${sc.reach_improved_km} km` : '—' },
                    { label: 'Potential gain',            value: sc.reach_gain_km != null ? `+${sc.reach_gain_km} km` : '—' }
                  ].map(m => (
                    <div key={m.label} className="bg-surface rounded p-1 text-center border border-rule">
                      <div className={`font-mono text-[10px] font-bold ${m.label === 'Potential gain' ? 'text-emerald-400' : 'text-textBright'}`}>{m.value}</div>
                      <div className="font-mono text-[8px] text-textDim mt-0.5">{m.label}</div>
                    </div>
                  ))}
                </div>
              )}
              {/* Amendment techniques */}
              <div className="font-mono text-[9px] text-textDim mb-1">Applicable Soil Amendment Techniques ({sc.n_applicable_techniques})</div>
              <div className="space-y-1 mb-2">
                {sc.techniques?.map((tech, i) => (
                  <div key={i} className="bg-surface rounded p-1.5 border border-rule">
                    <div className="flex justify-between items-start mb-0.5">
                      <span className="font-mono text-[8px] text-textBright font-bold">{tech.name}</span>
                      <span className="font-mono text-[7px] text-textDim">{tech.longevity_years}yr lifespan</span>
                    </div>
                    <div className="font-mono text-[7px] text-textDim leading-snug mb-0.5">{tech.description}</div>
                    <div className="flex gap-3">
                      {tech.sigma_improvement_msm_estimate > 0 && (
                        <span className="font-mono text-[7px] text-emerald-400">σ +{tech.sigma_improvement_msm_estimate} mS/m est.</span>
                      )}
                      {tech.fcc_measurable && (
                        <span className="font-mono text-[7px] text-blue-300">§73.190 measurable</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              {/* Wenner survey */}
              <div className="font-mono text-[9px] text-textDim mb-0.5">Wenner 4-Point Survey Protocol</div>
              <div className="font-mono text-[8px] text-textDim leading-snug mb-2">
                {sc.wenner_survey_protocol?.method} — electrode spacings: {sc.wenner_survey_protocol?.electrode_spacing_m?.join(', ')} m. {sc.wenner_survey_protocol?.filing_note}
              </div>
              <div className="font-mono text-[8px] text-textDim leading-snug">{sc.note}</div>
            </div>
          );
        })()}

        {/* License Class Upgrade Analysis */}
        {candidate.license_class_upgrade_analysis && (() => {
          const u = candidate.license_class_upgrade_analysis;
          const feasColor = f => f === 'POSSIBLE' ? 'text-emerald-400' : f === 'DIFFICULT' ? 'text-amber-400' : f === 'EXTREMELY_DIFFICULT' || f === 'NOT_FEASIBLE' ? 'text-rose-400' : f === 'AT_TOP_CLASS' ? 'text-blue-300' : 'text-textDim';
          return (
            <div>
              <div className="rack-eyebrow mb-1">License Class Upgrade Analysis (§73.21/§73.37)</div>
              <div className="flex flex-wrap gap-1.5 mb-2">
                <span className="font-mono text-[9px] px-1.5 py-0.5 rounded border font-bold bg-surface/40 border-rule text-textDim">
                  Class {u.fcc_class}
                </span>
                <span className={`font-mono text-[9px] px-1.5 py-0.5 rounded border font-bold bg-surface/40 border-rule ${feasColor(u.primary_feasibility)}`}>
                  {u.primary_feasibility}
                </span>
              </div>
              {/* Upgrade paths */}
              {u.upgrade_paths?.map((path, i) => (
                <div key={i} className="bg-surface rounded p-2 border border-rule mb-2">
                  <div className="flex gap-2 items-center mb-1">
                    <span className="font-mono text-[9px] text-textBright font-bold">
                      Class {path.from_class} → {path.to_class ?? 'N/A'}
                    </span>
                    <span className={`font-mono text-[8px] font-bold ${feasColor(path.feasibility)}`}>
                      {path.feasibility}
                    </span>
                  </div>
                  <div className="font-mono text-[8px] text-textDim leading-snug mb-1">{path.key_requirement}</div>
                  {path.new_power_max_kw && (
                    <div className="font-mono text-[8px] text-blue-300">
                      New max: {path.new_power_max_kw} kW · Timeline: {path.timeline_months_optimistic}–{path.timeline_months_conservative} months
                    </div>
                  )}
                  {path.filing_fee_usd_approx && (
                    <div className="font-mono text-[8px] text-textDim">
                      Filing fee: ~${path.filing_fee_usd_approx?.toLocaleString()} · Eng: ${path.engineering_cost_usd_approx_low?.toLocaleString()}–${path.engineering_cost_usd_approx_high?.toLocaleString()}
                    </div>
                  )}
                </div>
              ))}
              {/* Filing steps */}
              {u.upgrade_filing_steps?.length > 0 && (
                <>
                  <div className="font-mono text-[9px] text-textDim mb-1">Filing Process ({u.upgrade_filing_steps.length} steps)</div>
                  <div className="space-y-0.5 mb-2">
                    {u.upgrade_filing_steps.map((step, i) => (
                      <div key={i} className="flex gap-1.5 items-start">
                        <span className="font-mono text-[8px] text-blue-400 shrink-0 font-bold">{step.step}.</span>
                        <div>
                          <span className="font-mono text-[8px] text-textBright font-bold">{step.action}: </span>
                          <span className="font-mono text-[8px] text-textDim">{step.detail}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
              <div className="font-mono text-[8px] text-textDim leading-snug">{u.note}</div>
            </div>
          );
        })()}

        {/* §73.37 Spacing Rule Compliance Guide */}
        {candidate.spacing_rule_compliance_guide && (() => {
          const s = candidate.spacing_rule_compliance_guide;
          const riskColor = r => r === 'VERY_HIGH' ? 'text-rose-400' : r === 'HIGH' ? 'text-orange-400' : r === 'MODERATE' ? 'text-amber-400' : 'text-emerald-400';
          return (
            <div>
              <div className="rack-eyebrow mb-1">§73.37 Minimum Spacing Rule Compliance</div>
              {/* Risk and channel class badges */}
              <div className="flex flex-wrap gap-1.5 mb-2">
                <span className={`font-mono text-[9px] px-1.5 py-0.5 rounded border font-bold bg-surface/40 border-rule ${riskColor(s.spacing_risk_tier)}`}>
                  {s.spacing_risk_tier} RISK
                </span>
                <span className="font-mono text-[9px] text-textDim px-1 py-0.5 uppercase">
                  {s.channel_class?.replace('_', ' ')} · Class {s.fcc_class} · {s.frequency_khz} kHz
                </span>
              </div>
              {/* Risk note */}
              <div className="font-mono text-[8px] text-textDim leading-snug mb-2">{s.spacing_risk_note}</div>
              {/* Spacing table */}
              <div className="font-mono text-[9px] text-textDim mb-1">§73.37 Table 1 — Minimum Spacings (km) From Class {s.fcc_class}</div>
              <div className="overflow-x-auto mb-2">
                <table className="w-full text-[8px] font-mono border-collapse">
                  <thead>
                    <tr className="border-b border-rule text-textDim">
                      <th className="text-left py-0.5 pr-2">Protect Class</th>
                      <th className="text-right pr-2">CC (0 kHz)</th>
                      <th className="text-right pr-2">FA (±10 kHz)</th>
                      <th className="text-right">SA (±20 kHz)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.spacing_table?.map((row, i) => (
                      <tr key={i} className="border-b border-rule/30 hover:bg-surface/30">
                        <td className="py-0.5 pr-2 text-textBright font-bold">Class {row.to_class}</td>
                        <td className="text-right pr-2 text-rose-400">{row.cc_km} km</td>
                        <td className="text-right pr-2 text-amber-400">{row.fa_km} km</td>
                        <td className="text-right text-blue-300">{row.sa_km} km</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {/* Verification checklist */}
              <div className="font-mono text-[9px] text-textDim mb-1">Required Verification Steps ({s.n_checklist_required} items)</div>
              <div className="space-y-0.5 mb-2">
                {s.verification_checklist?.filter(i => i.required).map((item, i) => (
                  <div key={i} className="flex gap-1.5 items-start">
                    <span className="text-amber-400 font-mono text-[8px] shrink-0">!</span>
                    <div>
                      <span className="font-mono text-[8px] text-textBright font-bold">{item.item}: </span>
                      <span className="font-mono text-[8px] text-textDim">{item.data_source}</span>
                    </div>
                  </div>
                ))}
              </div>
              {/* Timeline */}
              <div className="grid grid-cols-2 gap-1 mb-2">
                {[
                  { label: 'Analysis (optimistic)',    value: `${s.spacing_analysis_timeline?.total_days_optimistic ?? '—'} days` },
                  { label: 'Analysis (conservative)',  value: `${s.spacing_analysis_timeline?.total_days_conservative ?? '—'} days` }
                ].map(m => (
                  <div key={m.label} className="bg-surface rounded p-1 text-center border border-rule">
                    <div className="font-mono text-[10px] text-textBright font-bold">{m.value}</div>
                    <div className="font-mono text-[8px] text-textDim mt-0.5">{m.label}</div>
                  </div>
                ))}
              </div>
              <div className="font-mono text-[8px] text-textDim leading-snug">{s.note}</div>
            </div>
          );
        })()}

        {/* AM Revitalization FM Translator Opportunity */}
        {candidate.am_fm_translator_opportunity && (() => {
          const t = candidate.am_fm_translator_opportunity;
          const checkColor = s => s === 'PASS' ? 'text-emerald-400' : s === 'CHECK_REQUIRED' ? 'text-amber-400' : 'text-textDim';
          return (
            <div>
              <div className="rack-eyebrow mb-1">AM Revitalization FM Translator (MB 13-249)</div>
              <div className="flex flex-wrap gap-1.5 mb-2">
                <span className="font-mono text-[9px] px-1.5 py-0.5 rounded border font-bold bg-surface/40 border-rule text-emerald-400">ELIGIBLE</span>
                <span className={`font-mono text-[9px] px-1.5 py-0.5 rounded border font-bold bg-surface/40 border-rule ${checkColor(t.translator_contour_check)}`}>
                  CONTOUR: {t.translator_contour_check}
                </span>
                <span className="font-mono text-[9px] text-textDim px-1 py-0.5">
                  ≤{t.translator_max_erp_kw * 1000} W ERP · 60 dBu ≈ {t.fm_60dbu_radius_screening_km} km
                </span>
              </div>
              <div className="grid grid-cols-3 gap-1 mb-2">
                {[
                  { label: 'FM 60 dBu radius',  value: `${t.fm_60dbu_radius_screening_km} km` },
                  { label: 'AM 2 mV/m contour', value: t.am_2mvm_contour_km != null ? `${t.am_2mvm_contour_km} km` : '—' },
                  { label: '25-mi threshold',    value: `${t.miles_25_threshold_km} km` }
                ].map(m => (
                  <div key={m.label} className="bg-surface rounded p-1 text-center border border-rule">
                    <div className="font-mono text-[10px] text-textBright font-bold">{m.value}</div>
                    <div className="font-mono text-[8px] text-textDim mt-0.5">{m.label}</div>
                  </div>
                ))}
              </div>
              <div className="font-mono text-[8px] text-textDim leading-snug mb-2">{t.translator_contour_note}</div>
              <div className="font-mono text-[9px] text-textDim mb-1">AM Revitalization Filing Windows</div>
              <div className="space-y-0.5 mb-2">
                {t.filing_windows?.map((w, i) => {
                  const wColor = w.status === 'CLOSED' ? 'text-rose-400' : w.status === 'WATCH' ? 'text-amber-400' : 'text-emerald-400';
                  return (
                    <div key={i} className="flex gap-2 items-start">
                      <span className={`font-mono text-[8px] shrink-0 font-bold ${wColor}`}>[{w.status}]</span>
                      <div>
                        <span className="font-mono text-[8px] text-textBright font-bold">{w.window}: </span>
                        <span className="font-mono text-[8px] text-textDim">{w.dates}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="font-mono text-[9px] text-textDim mb-1">FM Channel Availability Checks (§73.207)</div>
              <div className="space-y-0.5 mb-2">
                {t.spectrum_search_guidance?.key_checks?.slice(0, 4).map((chk, i) => (
                  <div key={i} className="flex gap-1.5 items-start">
                    <span className="text-blue-400 font-mono text-[8px] shrink-0">•</span>
                    <span className="font-mono text-[8px] text-textDim">{chk}</span>
                  </div>
                ))}
              </div>
              <div className="font-mono text-[9px] text-textDim mb-1">Form 349 Required Exhibits</div>
              <div className="space-y-0.5 mb-2">
                {t.form_349_exhibits?.filter(e => e.required).map((ex, i) => (
                  <div key={i} className="flex gap-1.5 items-start">
                    <span className="text-emerald-400 font-mono text-[8px] shrink-0">✓</span>
                    <div>
                      <span className="font-mono text-[8px] text-textBright font-bold">{ex.exhibit}: </span>
                      <span className="font-mono text-[8px] text-textDim">{ex.description}</span>
                    </div>
                  </div>
                ))}
              </div>
              {t.audience_gain_note && (
                <div className="font-mono text-[8px] text-blue-300/80 leading-snug mb-1">{t.audience_gain_note}</div>
              )}
              <div className="font-mono text-[8px] text-textDim leading-snug">{t.note}</div>
            </div>
          );
        })()}

        {/* DA Array Design Guide */}
        {candidate.da_array_design_guide && (() => {
          const da = candidate.da_array_design_guide;
          if (!da.applicable) {
            return (
              <div>
                <div className="rack-eyebrow mb-1">§73.316 DA Array Design Guide</div>
                <div className="font-mono text-[9px] text-textDim italic">{da.reason}</div>
              </div>
            );
          }
          const modeColor = m => m === 'DA-D' ? 'text-blue-300' : m === 'DA-N' ? 'text-indigo-300' : 'text-violet-300';
          return (
            <div>
              <div className="rack-eyebrow mb-1">§73.316 DA Array Design Guide</div>
              {/* Mode badge row */}
              <div className="flex flex-wrap gap-1.5 mb-2">
                <span className={`font-mono text-[9px] px-1.5 py-0.5 rounded border font-bold bg-surface/40 border-rule ${modeColor(da.da_mode_type)}`}>
                  {da.da_mode_type}
                </span>
                <span className="font-mono text-[9px] text-textDim px-1 py-0.5">
                  λ = {da.wavelength_m} m · λ/4 = {da.quarter_wave_m} m ({da.quarter_wave_ft} ft)
                </span>
                {da.is_clear_channel && (
                  <span className="font-mono text-[8px] text-amber-400 px-1 py-0.5 border border-amber-700/50 rounded">CLEAR CHANNEL</span>
                )}
              </div>
              {/* Recommended config */}
              <div className="font-mono text-[9px] text-textDim mb-1">Recommended Configuration (min {da.recommended_min_elements} elements)</div>
              <div className="grid grid-cols-2 gap-1 mb-2">
                {[
                  { label: 'Config',        value: da.recommended_config?.config_label ?? '—' },
                  { label: 'Elements',      value: da.recommended_config?.n_elements ?? '—' },
                  { label: 'Spacing',       value: da.recommended_config ? `${da.recommended_config.spacing_m} m / ${da.recommended_config.spacing_ft} ft` : '—' },
                  { label: 'Footprint',     value: da.recommended_config ? `${da.recommended_config.property_footprint_m} m (${da.recommended_config.property_footprint_ft} ft)` : '—' }
                ].map(m => (
                  <div key={m.label} className="bg-surface rounded p-1 border border-rule">
                    <div className="font-mono text-[8px] text-textDim">{m.label}</div>
                    <div className="font-mono text-[9px] text-textBright font-bold leading-tight">{m.value}</div>
                  </div>
                ))}
              </div>
              {/* Array configurations table */}
              <div className="font-mono text-[9px] text-textDim mb-1">Array Configurations</div>
              <div className="overflow-x-auto mb-2">
                <table className="w-full text-[8px] font-mono border-collapse">
                  <thead>
                    <tr className="border-b border-rule text-textDim">
                      <th className="text-left py-0.5 pr-2">Config</th>
                      <th className="text-right pr-2">N</th>
                      <th className="text-right pr-2">Spacing</th>
                      <th className="text-right pr-2">Gain dBd</th>
                      <th className="text-right">Supp dB</th>
                    </tr>
                  </thead>
                  <tbody>
                    {da.array_configurations?.map((cfg, i) => (
                      <tr key={i} className="border-b border-rule/30 hover:bg-surface/30">
                        <td className="py-0.5 pr-2 text-textBright">{cfg.config_label}</td>
                        <td className="text-right pr-2 text-blue-300">{cfg.n_elements}</td>
                        <td className="text-right pr-2 text-textDim">{cfg.spacing_m} m</td>
                        <td className="text-right pr-2 text-emerald-400">{cfg.max_gain_dbd}</td>
                        <td className="text-right text-amber-400">{cfg.suppression_achievable_db}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {/* Base current monitoring tolerances */}
              <div className="font-mono text-[9px] text-textDim mb-1">§73.61 Base Current Monitoring Tolerances</div>
              <div className="grid grid-cols-3 gap-1 mb-2">
                {[
                  { label: 'Current ratio ±', value: `${da.base_current_monitoring?.current_ratio_tolerance_pct ?? '—'}%` },
                  { label: 'Phase ±',          value: `${da.base_current_monitoring?.phase_tolerance_deg ?? '—'}°` },
                  { label: 'Check interval',   value: da.base_current_monitoring?.check_interval_hours != null ? `${da.base_current_monitoring.check_interval_hours}h` : '—' }
                ].map(m => (
                  <div key={m.label} className="bg-surface rounded p-1 text-center border border-rule">
                    <div className="font-mono text-[10px] text-textBright font-bold">{m.value}</div>
                    <div className="font-mono text-[8px] text-textDim mt-0.5">{m.label}</div>
                  </div>
                ))}
              </div>
              {/* HRP spec */}
              <div className="font-mono text-[9px] text-textDim mb-1">
                §73.316 HRP: {da.n_hrp_radials} radials at {da.hrp_increment_deg}° increments · Suppression req: ≥{da.suppression_requirement_db} dB
              </div>
              {/* Exhibits required */}
              <div className="font-mono text-[9px] text-textDim mb-1">Form 301-AM Required Exhibits</div>
              <div className="space-y-0.5 mb-2">
                {da.form_301am_exhibits?.filter(e => e.required).map((ex, i) => (
                  <div key={i} className="flex gap-1.5 items-start">
                    <span className="text-emerald-400 font-mono text-[8px] shrink-0">✓</span>
                    <div>
                      <span className="font-mono text-[8px] text-textBright font-bold">{ex.exhibit}: </span>
                      <span className="font-mono text-[8px] text-textDim">{ex.description}</span>
                    </div>
                  </div>
                ))}
              </div>
              <div className="font-mono text-[8px] text-textDim leading-snug">{da.note}</div>
            </div>
          );
        })()}

        {/* Atmospheric Noise Analysis */}
        {candidate.atmospheric_noise_analysis && (() => {
          const an = candidate.atmospheric_noise_analysis;
          const noiseColor = c => c === 'QUIET_RURAL' ? 'text-emerald-400' : c === 'RURAL' ? 'text-blue-300' : c === 'RESIDENTIAL' ? 'text-sky-300' : c === 'BUSINESS' ? 'text-amber-400' : 'text-textDim';
          return (
            <div>
              <div className="rack-eyebrow mb-1">ITU-R P.372 Atmospheric Noise Analysis</div>
              <div className="flex flex-wrap gap-1.5 mb-2">
                <span className={`font-mono text-[9px] px-1.5 py-0.5 rounded border font-bold bg-surface/40 border-rule ${noiseColor(an.site_noise_class)}`}>
                  {an.site_noise_class}
                </span>
                <span className="font-mono text-[9px] text-textDim px-1 py-0.5">
                  Fa day = {an.effective_noise_fa_day} dB · night = {an.effective_noise_fa_night} dB
                </span>
              </div>
              {/* Noise floors */}
              <div className="grid grid-cols-2 gap-1 mb-2">
                {[
                  { label: 'Man-made Fa (site est.)', value: `${an.man_made_noise_fa?.site_estimate ?? '—'} dB` },
                  { label: 'Atmospheric Fa (day)',    value: `${an.atmospheric_noise_fa_day ?? '—'} dB` },
                  { label: 'Min field (day)',          value: an.minimum_detectable_field_day_mvm != null ? `${an.minimum_detectable_field_day_mvm} mV/m` : '—' },
                  { label: 'Min field (night)',         value: an.minimum_detectable_field_night_mvm != null ? `${an.minimum_detectable_field_night_mvm} mV/m` : '—' }
                ].map(m => (
                  <div key={m.label} className="bg-surface rounded p-1 text-center border border-rule">
                    <div className="font-mono text-[10px] text-textBright font-bold">{m.value}</div>
                    <div className="font-mono text-[8px] text-textDim mt-0.5">{m.label}</div>
                  </div>
                ))}
              </div>
              {/* Man-made noise reference table */}
              <div className="font-mono text-[9px] text-textDim mb-1">P.372-15 Man-Made Noise Reference ({an.frequency_mhz} MHz)</div>
              <div className="grid grid-cols-2 gap-0.5 mb-2">
                {[
                  { label: 'Business',    v: an.man_made_noise_fa?.business },
                  { label: 'Residential', v: an.man_made_noise_fa?.residential },
                  { label: 'Rural',       v: an.man_made_noise_fa?.rural },
                  { label: 'Quiet Rural', v: an.man_made_noise_fa?.quiet_rural }
                ].map(r => (
                  <div key={r.label} className="flex items-center justify-between px-1.5 py-0.5 rounded border border-rule bg-surface/40">
                    <span className="font-mono text-[8px] text-textDim">{r.label}</span>
                    <span className="font-mono text-[8px] text-textBright">{r.v ?? '—'} dB</span>
                  </div>
                ))}
              </div>
              <div className="font-mono text-[8px] text-textDim leading-snug mb-1">{an.noise_advisory}</div>
              <div className="font-mono text-[8px] text-textDim leading-snug">{an.note}</div>
            </div>
          );
        })()}

        {/* Community of License Profile */}
        {candidate.community_of_license_profile && (() => {
          const cp = candidate.community_of_license_profile;
          const tierColor = t => t === 'PROXIMATE' || t === 'NEAR' ? 'text-emerald-400' : t === 'MID' ? 'text-blue-300' : t === 'FAR' ? 'text-amber-400' : t === 'REMOTE' ? 'text-red-400' : 'text-textDim';
          const tierBg    = t => t === 'PROXIMATE' || t === 'NEAR' ? 'bg-emerald-400/15 border-emerald-400/40' : t === 'MID' ? 'bg-blue-300/15 border-blue-300/40' : t === 'FAR' ? 'bg-amber-400/15 border-amber-400/40' : t === 'REMOTE' ? 'bg-red-400/15 border-red-400/40' : 'bg-surface/40 border-rule';
          const srcColor  = s => s === 'POLYGON' ? 'text-emerald-400' : s === 'CENTROID_ONLY' ? 'text-blue-300' : 'text-amber-400';
          return (
            <div>
              <div className="rack-eyebrow mb-1">Community of License Profile (§73.24j)</div>
              {/* Geo tier chip */}
              <div className="flex flex-wrap gap-1.5 mb-2">
                <span className={`font-mono text-[9px] px-1.5 py-0.5 rounded border font-bold ${tierBg(cp.geographic_tier)} ${tierColor(cp.geographic_tier)}`}>
                  {cp.geographic_tier}
                </span>
                <span className={`font-mono text-[9px] px-1 py-0.5 ${srcColor(cp.col_data_source)}`}>
                  {cp.col_data_source}
                </span>
                <span className={`font-mono text-[9px] px-1 py-0.5 ${cp.col_compliant ? 'text-emerald-400' : cp.col_compliant === false ? 'text-red-400' : 'text-textDim'}`}>
                  {cp.col_compliant ? '✓ COMPLIANT' : cp.col_compliant === false ? '✗ NON-COMPLIANT' : 'N/E'}
                </span>
              </div>
              {/* Key metrics */}
              <div className="grid grid-cols-3 gap-1 mb-2">
                {[
                  { label: 'Dist to CoL',       value: cp.candidate_to_col_dist_km != null ? `${cp.candidate_to_col_dist_km} km` : '—' },
                  { label: 'CoL bearing',        value: cp.bearing_from_candidate_to_col_deg != null ? `${cp.bearing_from_candidate_to_col_deg}°` : '—' },
                  { label: 'CoL coverage',       value: cp.col_coverage_pct != null ? `${cp.col_coverage_pct}%` : '—' },
                  { label: 'Reach (0.5 mV/m)',   value: cp.daytime_reach_km != null ? `${cp.daytime_reach_km} km` : '—' },
                  { label: 'Field at CoL',       value: cp.field_at_col_centroid_mvm != null ? `${cp.field_at_col_centroid_mvm} mV/m` : '—' },
                  { label: 'Min TPO for CoL',    value: cp.minimum_tpo_for_col_kw != null ? `${cp.minimum_tpo_for_col_kw} kW` : '—' }
                ].map(m => (
                  <div key={m.label} className="bg-surface rounded p-1 text-center border border-rule">
                    <div className="font-mono text-[10px] text-textBright font-bold">{m.value}</div>
                    <div className="font-mono text-[8px] text-textDim mt-0.5">{m.label}</div>
                  </div>
                ))}
              </div>
              {/* Tier note */}
              <div className="font-mono text-[8px] text-textDim leading-snug mb-2">{cp.geographic_tier_note}</div>
              {/* Engineering recommendations */}
              {cp.engineering_recommendations && cp.engineering_recommendations.length > 0 && (
                <>
                  <div className="font-mono text-[9px] text-textDim mb-1">Engineering Recommendations</div>
                  <div className="space-y-0.5 mb-2">
                    {cp.engineering_recommendations.map((r, i) => (
                      <div key={i} className="font-mono text-[8px] text-blue-300 leading-snug">→ {r}</div>
                    ))}
                  </div>
                </>
              )}
              <div className="font-mono text-[8px] text-textDim leading-snug">{cp.note}</div>
            </div>
          );
        })()}

        {/* Tower Structural Assessment Guide */}
        {candidate.tower_structural_assessment_guide && (() => {
          const ts = candidate.tower_structural_assessment_guide;
          const zoneColor = z => z === 'ZONE_I_HIGH_WIND' ? 'text-amber-400' : z === 'ZONE_II_MODERATE' ? 'text-blue-300' : z === 'ZONE_III_HEAVY_ICE' ? 'text-sky-300' : 'text-purple-400';
          const faaColor  = t => t === 'NONE' ? 'text-emerald-400' : t === 'MEDIUM_INTENSITY' ? 'text-amber-400' : 'text-red-400';
          return (
            <div>
              <div className="rack-eyebrow mb-1">Tower Structural Assessment (TIA-222-H)</div>
              {/* Key chips */}
              <div className="flex flex-wrap gap-1.5 mb-2">
                <span className={`font-mono text-[9px] px-1.5 py-0.5 rounded border font-bold bg-surface/40 border-rule ${zoneColor(ts.wind_ice_zone)}`}>
                  {ts.wind_ice_zone_data?.label ?? ts.wind_ice_zone}
                </span>
                <span className={`font-mono text-[9px] px-1.5 py-0.5 rounded border font-bold bg-surface/40 border-rule ${faaColor(ts.faa_requirements?.type)}`}>
                  FAA: {ts.faa_requirements?.type ?? '—'}
                </span>
                <span className={`font-mono text-[9px] px-1 py-0.5 ${ts.asr_registration_required ? 'text-amber-400' : 'text-emerald-400'}`}>
                  ASR: {ts.asr_registration_required ? 'REQUIRED' : 'VERIFY'}
                </span>
              </div>
              {/* Key dims */}
              <div className="grid grid-cols-3 gap-1 mb-2">
                {[
                  { label: 'λ/4 (typical height)', value: `${ts.quarter_wave_height_m} m` },
                  { label: 'λ/2 (max height)',     value: `${ts.half_wave_height_m} m` },
                  { label: 'Wind speed (design)',  value: ts.wind_ice_zone_data ? `${ts.wind_ice_zone_data.wind_speed_mph} mph` : '—' }
                ].map(m => (
                  <div key={m.label} className="bg-surface rounded p-1 text-center border border-rule">
                    <div className="font-mono text-[10px] text-textBright font-bold">{m.value}</div>
                    <div className="font-mono text-[8px] text-textDim mt-0.5">{m.label}</div>
                  </div>
                ))}
              </div>
              {/* Zone note */}
              <div className="font-mono text-[8px] text-textDim leading-snug mb-2">{ts.wind_ice_zone_data?.note}</div>
              {/* Tower types */}
              <div className="font-mono text-[9px] text-textDim mb-1">Tower Type Options</div>
              <div className="space-y-1 mb-2">
                {ts.tower_types.map(t => (
                  <div key={t.type} className={`border rounded px-1.5 py-1 ${t.suitable ? 'border-rule bg-surface/60' : 'border-rule/40 bg-surface/20 opacity-50'}`}>
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-[8px] font-semibold text-textBright">{t.type}</span>
                      <span className="font-mono text-[8px] text-textDim">≤{t.max_recommended_tpo_kw} kW · {t.typical_height_range_m} m</span>
                    </div>
                    <div className="font-mono text-[7px] text-textDim leading-snug mt-0.5">{t.notes}</div>
                  </div>
                ))}
              </div>
              {/* FAA marking */}
              {ts.faa_requirements?.type !== 'NONE' && (
                <>
                  <div className="font-mono text-[9px] text-textDim mb-1">FAA Marking & Lighting</div>
                  <div className="font-mono text-[8px] text-textDim leading-snug mb-1">{ts.faa_requirements?.note}</div>
                </>
              )}
              {/* Foundation */}
              <div className="font-mono text-[9px] text-textDim mb-1">Foundation Screening</div>
              <div className="font-mono text-[8px] text-textDim leading-snug mb-2">{ts.foundation?.note}</div>
              <div className="font-mono text-[8px] text-textDim leading-snug">{ts.note}</div>
            </div>
          );
        })()}

        {/* Ground Radial System Design Guide */}
        {candidate.ground_system_design_guide && (() => {
          const gs = candidate.ground_system_design_guide;
          const soilColor = c => c === 'EXCELLENT' ? 'text-emerald-400' : c === 'GOOD' ? 'text-blue-300' : c === 'AVERAGE' ? 'text-sky-300' : c === 'POOR' ? 'text-amber-400' : 'text-red-400';
          const soilBg    = c => c === 'EXCELLENT' ? 'bg-emerald-400/10 border-emerald-400/30' : c === 'GOOD' ? 'bg-blue-300/10 border-blue-300/30' : c === 'AVERAGE' ? 'bg-sky-300/10 border-sky-300/30' : c === 'POOR' ? 'bg-amber-400/10 border-amber-400/30' : 'bg-red-400/10 border-red-400/30';
          return (
            <div>
              <div className="rack-eyebrow mb-1">§73.190 Ground Radial System Design</div>
              {/* Soil classification chip */}
              <div className="flex flex-wrap gap-1.5 mb-2">
                <span className={`font-mono text-[9px] px-1.5 py-0.5 rounded border font-bold ${soilBg(gs.soil_conductivity_class)} ${soilColor(gs.soil_conductivity_class)}`}>
                  {gs.soil_conductivity_class} SOIL
                </span>
                <span className="font-mono text-[9px] text-textDim px-1 py-0.5">
                  σ = {gs.sigma_msm} mS/m · ρ = {gs.soil_resistivity_ohm_m} Ω·m
                </span>
              </div>
              <div className="font-mono text-[8px] text-textDim leading-snug mb-2">{gs.soil_note}</div>
              {/* Key dimensions */}
              <div className="grid grid-cols-3 gap-1 mb-2">
                {[
                  { label: 'Optimal radial (λ/4)', value: `${gs.optimal_radial_length_m} m` },
                  { label: 'Min radial (λ/8)',      value: `${gs.minimum_radial_length_m} m` },
                  { label: 'Burial depth',           value: gs.burial_depth_recommended }
                ].map(m => (
                  <div key={m.label} className="bg-surface rounded p-1 text-center border border-rule">
                    <div className="font-mono text-[10px] text-textBright font-bold">{m.value}</div>
                    <div className="font-mono text-[8px] text-textDim mt-0.5">{m.label}</div>
                  </div>
                ))}
              </div>
              {/* Scenarios */}
              <div className="font-mono text-[9px] text-textDim mb-1">Radial System Scenarios</div>
              <div className="space-y-1 mb-2">
                {gs.scenarios.map((s, i) => (
                  <div key={s.label} className={`border rounded p-1.5 ${i === 0 ? 'border-blue-300/30 bg-blue-300/5' : 'border-rule bg-surface/50'}`}>
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="font-mono text-[8px] font-semibold text-textBright">{s.label}</span>
                      <div className="flex gap-2">
                        <span className="font-mono text-[8px] text-textDim">R_gnd={s.ground_loss_ohm} Ω</span>
                        <span className="font-mono text-[8px] text-blue-300 font-bold">{s.antenna_efficiency_pct}% eff</span>
                      </div>
                    </div>
                    <div className="font-mono text-[7px] text-textDim leading-snug">{s.suitable_for}</div>
                  </div>
                ))}
              </div>
              {/* Staging */}
              <div className="font-mono text-[9px] text-textDim mb-1">Construction Staging</div>
              <div className="font-mono text-[8px] text-textDim mb-1 leading-snug">{gs.staging_phase1.description}</div>
              <div className="font-mono text-[8px] text-textDim mb-2 leading-snug">{gs.staging_phase2.description}</div>
              {/* Wenner survey */}
              <div className="font-mono text-[9px] text-textDim mb-1">Wenner Soil Resistivity Survey</div>
              <div className="font-mono text-[8px] text-textDim mb-2 leading-snug">
                Electrode spacing: {gs.wenner_survey.electrode_spacing_m} m · {gs.wenner_survey.measurement_locations}
              </div>
              <div className="font-mono text-[8px] text-textDim leading-snug">{gs.note}</div>
            </div>
          );
        })()}

        {/* Regulatory Compliance Checklist */}
        {candidate.regulatory_compliance_checklist && (() => {
          const rc = candidate.regulatory_compliance_checklist;
          const statusColor = s => s === 'PASS' ? 'text-emerald-400' : s === 'WARN' ? 'text-amber-400' : s === 'FAIL' ? 'text-red-400' : 'text-textDim';
          const statusBg    = s => s === 'PASS' ? 'bg-emerald-400/10 border-emerald-400/30' : s === 'WARN' ? 'bg-amber-400/10 border-amber-400/30' : s === 'FAIL' ? 'bg-red-400/10 border-red-400/30' : 'bg-surface/30 border-rule/40';
          const overallBg   = s => s === 'FAIL' ? 'bg-red-400/15 border-red-400/40' : s === 'WARN' ? 'bg-amber-400/15 border-amber-400/40' : s === 'PASS' ? 'bg-emerald-400/15 border-emerald-400/40' : 'bg-surface/40 border-rule';
          return (
            <div>
              <div className="rack-eyebrow mb-1">Pre-Filing Compliance Checklist</div>
              <div className={`flex items-center justify-between px-2 py-1.5 rounded border mb-2 ${overallBg(rc.overall_status)}`}>
                <span className={`font-mono text-[10px] font-bold ${statusColor(rc.overall_status)}`}>{rc.overall_status}</span>
                <span className="font-mono text-[8px] text-textDim">
                  {rc.pass_count} PASS · {rc.warn_count} WARN · {rc.fail_count} FAIL · {rc.not_evaluated_count} N/E
                </span>
              </div>
              <div className="font-mono text-[8px] text-textDim leading-snug mb-2">{rc.filing_readiness}</div>
              <div className="space-y-1 mb-2">
                {rc.items.map(it => (
                  <div key={it.id} className={`border rounded px-1.5 py-1 ${statusBg(it.status)}`}>
                    <div className="flex items-start justify-between gap-1">
                      <span className="font-mono text-[8px] text-textBright font-semibold flex-1">{it.label}</span>
                      <span className={`font-mono text-[8px] font-bold shrink-0 ${statusColor(it.status)}`}>{it.status}</span>
                    </div>
                    <div className="font-mono text-[7px] text-textDim leading-snug mt-0.5">{it.note}</div>
                    {it.required_action && it.status !== 'PASS' && (
                      <div className="font-mono text-[7px] text-blue-300 leading-snug mt-0.5">→ {it.required_action}</div>
                    )}
                  </div>
                ))}
              </div>
              <div className="font-mono text-[8px] text-textDim leading-snug">{rc.note}</div>
            </div>
          );
        })()}

        {/* Per-candidate Scoring Audit */}
        {candidate.candidate_scoring_audit && (() => {
          const a = candidate.candidate_scoring_audit;
          const tierColor = t => t === 'HIGH' ? 'text-emerald-400' : t === 'MEDIUM' ? 'text-blue-300' : 'text-amber-400';
          const tierBg    = t => t === 'HIGH' ? 'bg-emerald-400/15 border-emerald-400/40' : t === 'MEDIUM' ? 'bg-blue-300/15 border-blue-300/40' : 'bg-amber-400/15 border-amber-400/40';
          const GOAL_LABELS = {
            maximize_col_coverage:       'COL Coverage',
            maximize_population:         'Population Reach',
            minimize_blanket_population: 'Blanket Pop.',
            prefer_high_conductivity:    'Conductivity',
            avoid_wildfire_risk:         'Wildfire Risk',
            minimize_int_treaty_zone:    'Treaty Zone'
          };
          return (
            <div>
              <div className="rack-eyebrow mb-1">Score Explainability Audit</div>
              {/* Summary chips */}
              <div className="flex flex-wrap gap-1.5 mb-2">
                <span className={`font-mono text-[9px] px-1.5 py-0.5 rounded border font-bold ${tierBg(a.confidence_tier)} ${tierColor(a.confidence_tier)}`}>
                  {a.confidence_tier} CONF ×{a.confidence_factor}
                </span>
                <span className="font-mono text-[9px] text-textDim px-1 py-0.5">
                  Pre-conf: {a.score_pre_confidence} → Final: {a.score_final}
                </span>
                {a.confidence_penalty_pts !== 0 && (
                  <span className="font-mono text-[9px] text-amber-400 px-1 py-0.5">
                    Penalty: {a.confidence_penalty_pts} pts
                  </span>
                )}
              </div>
              {/* Key metrics row */}
              <div className="grid grid-cols-3 gap-1 mb-2">
                {[
                  { label: 'Active goals', value: a.active_goals_count },
                  { label: 'Weight sum', value: a.weight_sum },
                  { label: 'Norm factor', value: a.normalization_factor != null ? `×${a.normalization_factor.toFixed(2)}` : '—' }
                ].map(m => (
                  <div key={m.label} className="bg-surface rounded p-1 text-center border border-rule">
                    <div className="font-mono text-[10px] text-textBright font-bold">{m.value}</div>
                    <div className="font-mono text-[8px] text-textDim mt-0.5">{m.label}</div>
                  </div>
                ))}
              </div>
              {/* Per-goal breakdown */}
              <div className="font-mono text-[9px] text-textDim mb-1">Goal Breakdown</div>
              <div className="space-y-0.5 mb-2">
                {a.goal_details.map(g => (
                  <div key={g.goal} className={`border rounded px-1.5 py-1 ${g.enabled ? 'border-rule bg-surface/60' : 'border-rule/40 bg-surface/20 opacity-50'}`}>
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-[8px] text-textBright font-semibold">{GOAL_LABELS[g.goal] ?? g.goal}</span>
                      <div className="flex gap-1.5 items-center">
                        {g.enabled ? (
                          <>
                            <span className="font-mono text-[8px] text-textDim">sub={g.sub_score ?? '—'}</span>
                            <span className="font-mono text-[8px] text-textDim">w={g.weight}</span>
                            <span className="font-mono text-[8px] text-blue-300 font-bold">{g.weighted_pts} pts</span>
                          </>
                        ) : (
                          <span className="font-mono text-[8px] text-textDim">disabled</span>
                        )}
                      </div>
                    </div>
                    {g.limiting_factor && (
                      <div className="font-mono text-[8px] text-amber-400 leading-snug mt-0.5">⚠ {g.limiting_factor}</div>
                    )}
                  </div>
                ))}
              </div>
              <div className="font-mono text-[8px] text-textDim leading-snug">{a.note}</div>
            </div>
          );
        })()}

        {/* Licensing Timeline Estimate */}
        {candidate.licensing_timeline_estimate && (() => {
          const lt = candidate.licensing_timeline_estimate;
          const riskColor = r => r === 'VERY_HIGH' ? 'text-red-400' : r === 'HIGH' ? 'text-amber-400' : r === 'ELEVATED' ? 'text-blue-300' : r === 'MODERATE' ? 'text-sky-300' : 'text-emerald-400';
          const riskBg    = r => r === 'VERY_HIGH' ? 'bg-red-400/15 border-red-400/40' : r === 'HIGH' ? 'bg-amber-400/15 border-amber-400/40' : r === 'ELEVATED' ? 'bg-blue-300/15 border-blue-300/40' : 'bg-emerald-400/15 border-emerald-400/40';
          return (
            <div>
              <div className="rack-eyebrow mb-1">FCC CP Licensing Timeline</div>
              <div className="flex flex-wrap gap-1.5 mb-2">
                <span className={`font-mono text-[9px] px-1.5 py-0.5 rounded border font-bold ${riskBg(lt.licensing_risk_tier)} ${riskColor(lt.licensing_risk_tier)}`}>
                  {lt.licensing_risk_tier} RISK
                </span>
                <span className="font-mono text-[9px] text-textDim px-1 py-0.5">
                  {lt.total_years_optimistic}–{lt.total_years_conservative} years
                </span>
              </div>
              <div className="font-mono text-[9px] text-textDim mb-2 leading-snug">{lt.risk_note}</div>
              {/* Phases timeline */}
              <div className="space-y-1 mb-2">
                {lt.phases.map((p, i) => (
                  <div key={p.phase} className="border border-rule rounded p-1.5 bg-surface/60">
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="font-mono text-[8px] text-textDim">{i+1}.</span>
                      <span className="font-mono text-[8px] font-semibold text-textBright flex-1 mx-1">{p.label}</span>
                      <span className="font-mono text-[8px] text-blue-300 whitespace-nowrap">{p.weeks_low}–{p.weeks_high} wks</span>
                    </div>
                    {p.key_tasks.slice(0, 2).map((t, j) => (
                      <div key={j} className="font-mono text-[8px] text-textDim leading-snug">• {t}</div>
                    ))}
                  </div>
                ))}
              </div>
              <div className="font-mono text-[8px] text-textDim leading-snug">{lt.note}</div>
            </div>
          );
        })()}

        {/* Transmission System Design Guide */}
        {candidate.transmission_system_design_guide && (() => {
          const ts = candidate.transmission_system_design_guide;
          const feedColor = s => s && ts.recommended_feedline === s ? 'border-emerald-400/40 bg-emerald-400/10 text-emerald-400' : 'border-rule bg-surface/50 text-textDim';
          return (
            <div>
              <div className="rack-eyebrow mb-1">RF Transmission System Design</div>
              {/* Key metrics */}
              <div className="grid grid-cols-3 gap-1 mb-2">
                {[
                  { label: 'Antenna efficiency', value: ts.antenna_efficiency_pct != null ? `${ts.antenna_efficiency_pct}%` : '—' },
                  { label: 'Base impedance', value: ts.estimated_base_impedance_ohm != null ? `${ts.estimated_base_impedance_ohm} Ω` : '—' },
                  { label: 'Base current (ideal)', value: ts.base_current_ideal_a != null ? `${ts.base_current_ideal_a} A` : '—' }
                ].map(m => (
                  <div key={m.label} className="bg-surface rounded p-1 text-center border border-rule">
                    <div className="font-mono text-[10px] text-textBright font-bold">{m.value}</div>
                    <div className="font-mono text-[8px] text-textDim mt-0.5">{m.label}</div>
                  </div>
                ))}
              </div>
              {/* Feedline options */}
              <div className="font-mono text-[9px] text-textDim mb-1">Feedline Options (est. {ts.estimated_line_length_m} m run)</div>
              <div className="space-y-1 mb-2">
                {ts.feedline_options.map(f => (
                  <div key={f.type} className={`border rounded p-1.5 ${feedColor(f.type)}`}>
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="font-mono text-[9px] font-semibold">{f.label}</span>
                      <span className="font-mono text-[8px]">{f.loss_db_per_100m} dB/100m · {f.approx_loss_db_this_run} dB this run</span>
                    </div>
                    <div className="font-mono text-[8px] leading-snug opacity-80">{f.note}</div>
                  </div>
                ))}
              </div>
              {/* ATU note */}
              <div className="font-mono text-[9px] text-textDim mb-1">ATU Configuration</div>
              <div className="font-mono text-[8px] text-textDim mb-2 leading-snug">{ts.atu_configuration_note}</div>
              {/* Detuning */}
              <div className={`flex items-start gap-1.5 px-1.5 py-1 rounded border mb-1.5 ${ts.detuning?.required ? 'border-amber-400/30 bg-amber-400/5' : 'border-rule bg-surface/40'}`}>
                <span className={`font-mono text-[8px] font-bold ${ts.detuning?.required ? 'text-amber-400' : 'text-textDim'}`}>
                  {ts.detuning?.required ? 'DETUNING REQUIRED' : 'DETUNING: N/A'}
                </span>
              </div>
              <div className="font-mono text-[8px] text-textDim leading-snug mb-1">{ts.detuning?.note}</div>
              <div className="font-mono text-[8px] text-textDim leading-snug">{ts.note}</div>
            </div>
          );
        })()}

        {/* Propagation Confidence Interval */}
        {candidate.propagation_confidence_interval && (() => {
          const pci = candidate.propagation_confidence_interval;
          const confColor = c => c === 'HIGH' ? 'text-emerald-400' : c === 'MEDIUM' ? 'text-blue-300' : 'text-amber-400';
          const confBg    = c => c === 'HIGH' ? 'bg-emerald-400/15 border-emerald-400/40' : c === 'MEDIUM' ? 'bg-blue-300/15 border-blue-300/40' : 'bg-amber-400/15 border-amber-400/40';
          const fmtBounds = (b) => b?.low != null ? `${b.low}–${b.high}` : '—';
          return (
            <div>
              <div className="rack-eyebrow mb-1">Propagation Confidence Interval</div>
              <div className="flex flex-wrap gap-1.5 mb-2">
                <span className={`font-mono text-[9px] px-1.5 py-0.5 rounded border font-bold ${confBg(pci.confidence_level)} ${confColor(pci.confidence_level)}`}>
                  {pci.confidence_level} CONFIDENCE
                </span>
                <span className="font-mono text-[9px] text-textDim px-1 py-0.5">
                  σ ±{pci.field_uncertainty_pct}% field / ±{pci.reach_uncertainty_pct}% reach
                </span>
              </div>
              <div className="grid grid-cols-2 gap-1 mb-2">
                {[
                  { label: 'Reach range (km)', value: fmtBounds(pci.daytime_reach_bounds_km) },
                  { label: 'COL field range (mV/m)', value: fmtBounds(pci.col_field_bounds_mvm) },
                  { label: 'Blanket 1000 mV/m (km)', value: fmtBounds(pci.blanket_1000mvm_bounds_km) },
                  { label: 'COL coverage range', value: pci.col_coverage_bounds?.low != null ? `${(pci.col_coverage_bounds.low*100).toFixed(0)}–${(pci.col_coverage_bounds.high*100).toFixed(0)}%` : '—' }
                ].map(m => (
                  <div key={m.label} className="bg-surface rounded p-1 border border-rule">
                    <div className="font-mono text-[10px] text-textBright font-bold">{m.value}</div>
                    <div className="font-mono text-[8px] text-textDim mt-0.5">{m.label}</div>
                  </div>
                ))}
              </div>
              {pci.recommended_data_upgrade && pci.recommended_data_upgrade.action !== 'NONE' && (
                <div className="border border-amber-400/30 rounded p-1.5 bg-amber-400/5 mb-1">
                  <div className="font-mono text-[9px] text-amber-400 font-semibold mb-0.5">
                    Upgrade: {pci.recommended_data_upgrade.label}
                  </div>
                  <div className="font-mono text-[8px] text-textDim leading-snug">{pci.recommended_data_upgrade.note}</div>
                </div>
              )}
              <div className="font-mono text-[8px] text-textDim leading-snug">{pci.note}</div>
            </div>
          );
        })()}

        {/* Antenna Pattern Optimization Guide */}
        {candidate.antenna_pattern_optimization_guide && (() => {
          const ap = candidate.antenna_pattern_optimization_guide;
          const recColor = r => r === 'STRONGLY_RECOMMENDED' ? 'text-red-400' : r === 'EVALUATE' ? 'text-amber-400' : r === 'CONSIDER' ? 'text-blue-300' : 'text-emerald-400';
          const recBg    = r => r === 'STRONGLY_RECOMMENDED' ? 'bg-red-400/15 border-red-400/40' : r === 'EVALUATE' ? 'bg-amber-400/15 border-amber-400/40' : r === 'CONSIDER' ? 'bg-blue-300/15 border-blue-300/40' : 'bg-emerald-400/15 border-emerald-400/40';
          return (
            <div>
              <div className="rack-eyebrow mb-1">§73.150 Antenna Pattern Guide</div>
              {/* DA recommendation badge */}
              <div className="flex flex-wrap gap-1.5 mb-2">
                <span className={`font-mono text-[9px] px-1.5 py-0.5 rounded border font-bold ${recBg(ap.da_recommended)} ${recColor(ap.da_recommended)}`}>
                  DA: {ap.da_recommended?.replace(/_/g, ' ')}
                </span>
                <span className={`font-mono text-[9px] px-1.5 py-0.5 rounded border ${ap.is_directional ? 'bg-amber-400/10 border-amber-400/40 text-amber-400' : 'bg-surface border-rule text-textDim'}`}>
                  {ap.pattern_mode}
                </span>
              </div>
              <div className="font-mono text-[9px] text-textDim mb-2 leading-snug">{ap.da_recommended_note}</div>
              {/* COL bearing metrics */}
              <div className="grid grid-cols-3 gap-1 mb-2">
                {[
                  { label: 'COL bearing', value: ap.col_bearing_deg != null ? `${ap.col_bearing_deg}°` : '—' },
                  { label: 'Dist to COL', value: ap.dist_to_col_km != null ? `${ap.dist_to_col_km} km` : '—' },
                  { label: 'NDA field at COL', value: ap.field_at_col_nda_mvm != null ? `${ap.field_at_col_nda_mvm} mV/m` : '—' }
                ].map(m => (
                  <div key={m.label} className="bg-surface rounded p-1 text-center border border-rule">
                    <div className="font-mono text-[10px] text-textBright font-bold">{m.value}</div>
                    <div className="font-mono text-[8px] text-textDim mt-0.5">{m.label}</div>
                  </div>
                ))}
              </div>
              {/* Spacing options (DA only) */}
              {ap.element_spacing_options && (
                <div className="mb-2">
                  <div className="font-mono text-[9px] text-textDim mb-1">2-Element Spacing Options</div>
                  <div className="space-y-1">
                    {ap.element_spacing_options.map(s => (
                      <div key={s.spacing_label} className="border border-rule rounded p-1.5 bg-surface/60">
                        <div className="flex items-center justify-between mb-0.5">
                          <span className="font-mono text-[9px] text-textBright font-semibold">{s.spacing_label} ({s.spacing_m} m) — {s.pattern_type?.replace(/_/g, ' ')}</span>
                          <span className="font-mono text-[9px] text-emerald-400">+{s.gain_over_nda_db} dB</span>
                        </div>
                        <div className="font-mono text-[8px] text-textDim leading-snug">{s.note}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {/* §73.316 HRP checklist */}
              <div className="font-mono text-[9px] text-textDim mb-1">§73.316 Compliance Checklist</div>
              <div className="space-y-0.5 mb-1">
                {ap.hrp_compliance_checklist.map(c => (
                  <div key={c.id} className={`flex items-start gap-1.5 px-1.5 py-0.5 rounded border ${c.required ? 'border-amber-400/30 bg-amber-400/5' : 'border-rule bg-surface/40'}`}>
                    <span className={`font-mono text-[8px] font-bold min-w-[14px] ${c.required ? 'text-amber-400' : 'text-textDim'}`}>{c.required ? '✓' : '—'}</span>
                    <span className="font-mono text-[8px] text-textBright leading-snug">{c.item}</span>
                  </div>
                ))}
              </div>
              <div className="font-mono text-[8px] text-textDim leading-snug">{ap.note}</div>
            </div>
          );
        })()}

        {/* Financial Feasibility Summary */}
        {candidate.financial_feasibility_summary && (() => {
          const fin = candidate.financial_feasibility_summary;
          const fmtUsd = v => v >= 1000000 ? `$${(v/1000000).toFixed(1)}M` : `$${Math.round(v/1000)}k`;
          const feasColor = f => f === 'VERY_FEASIBLE' ? 'text-emerald-400' : f === 'FEASIBLE' ? 'text-blue-300' : f === 'SIGNIFICANT_INVESTMENT' ? 'text-amber-400' : 'text-red-400';
          const feasBg    = f => f === 'VERY_FEASIBLE' ? 'bg-emerald-400/15 border-emerald-400/40' : f === 'FEASIBLE' ? 'bg-blue-300/15 border-blue-300/40' : f === 'SIGNIFICANT_INVESTMENT' ? 'bg-amber-400/15 border-amber-400/40' : 'bg-red-400/15 border-red-400/40';
          return (
            <div>
              <div className="rack-eyebrow mb-1">Financial Feasibility</div>
              {/* Summary chips */}
              <div className="flex flex-wrap gap-1.5 mb-2">
                <span className={`font-mono text-[9px] px-1.5 py-0.5 rounded border font-bold ${feasBg(fin.overall_feasibility)} ${feasColor(fin.overall_feasibility)}`}>
                  {fin.overall_feasibility?.replace(/_/g, ' ')}
                </span>
                <span className="font-mono text-[9px] text-textDim px-1 py-0.5">
                  Buy: {fmtUsd(fin.total_buy_low_usd)}–{fmtUsd(fin.total_buy_high_usd)}
                </span>
                {fin.payback_years_optimistic != null && (
                  <span className="font-mono text-[9px] text-blue-300 px-1 py-0.5">
                    Payback: {fin.payback_years_optimistic}–{fin.payback_years_conservative ?? '?'} yrs
                  </span>
                )}
              </div>
              {/* Key metrics grid */}
              <div className="grid grid-cols-3 gap-1 mb-2">
                {[
                  { label: 'Lease yr1 (low)', value: fmtUsd(fin.total_lease_yr1_low_usd) },
                  { label: 'Annual ops (low)', value: fmtUsd(fin.annual_operating_low_usd) },
                  { label: 'Annual power', value: `${fin.annual_power_cost_usd != null ? fmtUsd(fin.annual_power_cost_usd) : '—'}` }
                ].map(m => (
                  <div key={m.label} className="bg-surface rounded p-1 text-center border border-rule">
                    <div className="font-mono text-[10px] text-textBright font-bold">{m.value}</div>
                    <div className="font-mono text-[8px] text-textDim mt-0.5">{m.label}</div>
                  </div>
                ))}
              </div>
              {/* Line items */}
              <div className="font-mono text-[9px] text-textDim mb-1">Cost Line Items</div>
              <div className="space-y-0.5 mb-2">
                {fin.line_items.map(item => (
                  <div key={item.id} className="flex items-center justify-between px-1.5 py-0.5 rounded border border-rule bg-surface/50">
                    <span className="font-mono text-[8px] text-textBright">{item.label}</span>
                    <span className="font-mono text-[8px] text-textDim">{fmtUsd(item.low_usd)}–{fmtUsd(item.high_usd)}</span>
                  </div>
                ))}
              </div>
              <div className="font-mono text-[8px] text-textDim leading-snug">{fin.note}</div>
            </div>
          );
        })()}

        {/* Environmental Risk Matrix */}
        {candidate.environmental_risk_matrix && (() => {
          const env = candidate.environmental_risk_matrix;
          const riskColor = r => r === 'HIGH' ? 'text-red-400' : r === 'ELEVATED' ? 'text-amber-400' : r === 'MODERATE' ? 'text-blue-300' : r === 'LOW' ? 'text-emerald-400' : 'text-textDim';
          const riskBg    = r => r === 'HIGH' ? 'bg-red-400/15 border-red-400/40' : r === 'ELEVATED' ? 'bg-amber-400/15 border-amber-400/40' : r === 'MODERATE' ? 'bg-blue-300/15 border-blue-300/40' : r === 'LOW' ? 'bg-emerald-400/15 border-emerald-400/40' : 'bg-surface border-rule';
          return (
            <div>
              <div className="rack-eyebrow mb-1">NEPA §1.1306 Environmental Matrix</div>
              {/* Summary tier */}
              <div className="flex flex-wrap gap-1.5 mb-2">
                <span className={`font-mono text-[9px] px-1.5 py-0.5 rounded border font-bold ${riskBg(env.overall_nepa_risk)} ${riskColor(env.overall_nepa_risk)}`}>
                  {env.overall_nepa_risk} NEPA RISK
                </span>
                {env.high_risk_count > 0 && (
                  <span className="font-mono text-[9px] px-1.5 py-0.5 rounded border bg-red-400/10 border-red-400/40 text-red-400">
                    {env.high_risk_count} HIGH trigger{env.high_risk_count > 1 ? 's' : ''}
                  </span>
                )}
                {env.elevated_risk_count > 0 && (
                  <span className="font-mono text-[9px] px-1.5 py-0.5 rounded border bg-amber-400/10 border-amber-400/40 text-amber-400">
                    {env.elevated_risk_count} ELEVATED
                  </span>
                )}
                <span className="font-mono text-[9px] text-textDim px-1 py-0.5">
                  EA worst-case: {env.ea_timeline_weeks_worst_case} wks
                </span>
              </div>
              <div className="font-mono text-[9px] text-textDim mb-2 leading-snug">{env.ea_eligibility_note}</div>
              {/* Items grid */}
              <div className="space-y-0.5 mb-2">
                {env.items.map(item => (
                  <div key={item.id} className={`flex items-start gap-1.5 px-1.5 py-1 rounded border ${riskBg(item.risk_level)}`}>
                    <span className={`font-mono text-[8px] font-bold min-w-[52px] ${riskColor(item.risk_level)}`}>{item.risk_level}</span>
                    <div className="flex-1 min-w-0">
                      <div className="font-mono text-[9px] text-textBright font-semibold leading-snug">{item.category}</div>
                      <div className="font-mono text-[8px] text-textDim leading-snug">{item.cfr}</div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="font-mono text-[8px] text-textDim leading-snug">{env.note}</div>
            </div>
          );
        })()}

        {/* Co-location Compatibility Score */}
        {candidate.colocation_compatibility_score && (() => {
          const cc = candidate.colocation_compatibility_score;
          const tierColor = t => t === 'GOOD' ? 'text-emerald-400' : t === 'FAIR' ? 'text-amber-400' : 'text-red-400';
          const tierBg    = t => t === 'GOOD' ? 'bg-emerald-400/15 border-emerald-400/40' : t === 'FAIR' ? 'bg-amber-400/15 border-amber-400/40' : 'bg-red-400/15 border-red-400/40';
          const scoreBar  = (score) => {
            const pct = Math.min(100, Math.max(0, score));
            const col  = score >= 75 ? '#34d399' : score >= 55 ? '#fbbf24' : '#f87171';
            return <div className="h-1 rounded-full bg-rule mt-0.5"><div className="h-1 rounded-full" style={{ width: `${pct}%`, backgroundColor: col }} /></div>;
          };
          return (
            <div>
              <div className="rack-eyebrow mb-1">Co-location Compatibility</div>
              <div className="flex flex-wrap gap-1.5 mb-2">
                <span className="font-mono text-[9px] text-textDim">Best host:</span>
                <span className={`font-mono text-[9px] px-1.5 py-0.5 rounded border font-bold ${tierBg(cc.best_host_tier)} ${tierColor(cc.best_host_tier)}`}>
                  {cc.best_host_type?.replace(/_/g, ' ')} — {cc.best_host_score}/100
                </span>
                <span className="font-mono text-[9px] text-amber-400 px-1 py-0.5 bg-amber-400/10 border border-amber-400/30 rounded">
                  DIPLEXER REQUIRED
                </span>
              </div>
              <div className="space-y-1.5 mb-2">
                {cc.host_scores.map(h => (
                  <div key={h.host_type} className="border border-rule rounded p-1.5 bg-surface/60">
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="font-mono text-[9px] text-textBright font-semibold">{h.label}</span>
                      <span className={`font-mono text-[9px] font-bold ${tierColor(h.compatibility_tier)}`}>{h.score}/100 {h.compatibility_tier}</span>
                    </div>
                    {scoreBar(h.score)}
                    <div className="mt-1 space-y-0.5">
                      {h.benefits.slice(0, 1).map((b, i) => (
                        <div key={i} className="font-mono text-[8px] text-emerald-400 leading-snug">✓ {b}</div>
                      ))}
                      {h.risks.slice(0, 2).map((r, i) => (
                        <div key={i} className="font-mono text-[8px] text-amber-400/80 leading-snug">⚠ {r}</div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <div className="font-mono text-[8px] text-textDim leading-snug">{cc.note}</div>
            </div>
          );
        })()}

        {/* Site Acquisition Checklist */}
        {candidate.site_acquisition_checklist && (() => {
          const sa = candidate.site_acquisition_checklist;
          const prioColor = p => p === 'CRITICAL' ? 'text-red-400' : p === 'HIGH' ? 'text-amber-400' : p === 'MEDIUM' ? 'text-blue-300' : 'text-textDim';
          const prioBg    = p => p === 'CRITICAL' ? 'border-red-400/40 bg-red-400/10' : p === 'HIGH' ? 'border-amber-400/40 bg-amber-400/10' : 'border-rule bg-surface';
          return (
            <div>
              <div className="rack-eyebrow mb-1">Site Acquisition Checklist</div>
              <div className="font-mono text-[10px] text-textDim mb-1.5">
                Min parcel: {sa.min_parcel_area_ha} ha · {sa.critical_count} critical · {sa.high_count} high priority ({sa.total_items} total)
              </div>
              <div className="space-y-1">
                {sa.items.map(item => (
                  <div key={item.id} className={`border rounded px-2 py-1.5 ${prioBg(item.priority)}`}>
                    <div className="flex items-start justify-between gap-2">
                      <span className={`font-mono text-[10px] font-bold uppercase ${prioColor(item.priority)}`}>{item.priority}</span>
                      <span className="font-mono text-[9px] text-textDim">{item.category}</span>
                    </div>
                    <div className="font-mono text-[11px] text-text mt-0.5 leading-snug">{item.action}</div>
                    {item.notes && <div className="font-mono text-[10px] text-textDim mt-0.5 leading-snug">{item.notes}</div>}
                    {item.timeline_weeks && (
                      <div className="font-mono text-[9px] text-textDim mt-0.5">Timeline: {item.timeline_weeks[0]}–{item.timeline_weeks[1]} weeks</div>
                    )}
                  </div>
                ))}
              </div>
              <div className="font-mono text-[9px] text-textDim mt-1 leading-snug">{sa.note}</div>
            </div>
          );
        })()}

        {/* Spectrum Interference Summary */}
        {candidate.spectrum_interference_summary && (() => {
          const si = candidate.spectrum_interference_summary;
          const tierColor = t => t === 'HIGH' ? 'text-red-400' : t === 'ELEVATED' ? 'text-amber-400' : t === 'MODERATE' ? 'text-blue-300' : 'text-emerald-400';
          const tierBg    = t => t === 'HIGH' ? 'bg-red-400/15 border-red-400/40' : t === 'ELEVATED' ? 'bg-amber-400/15 border-amber-400/40' : t === 'MODERATE' ? 'bg-blue-300/15 border-blue-300/40' : 'bg-emerald-400/15 border-emerald-400/40';
          return (
            <div>
              <div className="rack-eyebrow mb-1">§73.182 Spectrum Interference Profile</div>
              {/* Risk tier + NIF flag */}
              <div className="flex flex-wrap gap-1.5 mb-2">
                <span className={`font-mono text-[9px] px-1.5 py-0.5 rounded border font-bold ${tierBg(si.interference_risk_tier)} ${tierColor(si.interference_risk_tier)}`}>
                  {si.interference_risk_tier} RISK
                </span>
                <span className={`font-mono text-[9px] px-1.5 py-0.5 rounded border ${si.nighttime_nif_required ? 'bg-amber-400/10 border-amber-400/40 text-amber-400' : 'bg-surface border-rule text-textDim'}`}>
                  {si.nighttime_nif_required ? 'NIF STUDY REQUIRED' : 'NIF: NOT REQUIRED'}
                </span>
                <span className={`font-mono text-[9px] px-1.5 py-0.5 rounded border ${si.is_clear_channel ? 'bg-red-400/10 border-red-400/40 text-red-400' : si.is_local_channel ? 'bg-emerald-400/10 border-emerald-400/40 text-emerald-400' : 'bg-blue-300/10 border-blue-300/40 text-blue-300'}`}>
                  {si.channel_class?.replace('_', ' ').toUpperCase() ?? si.channel_class}
                </span>
              </div>
              <div className="font-mono text-[9px] text-textDim mb-2 leading-snug">{si.risk_note}</div>
              {/* Protected contour + reach metrics */}
              <div className="grid grid-cols-3 gap-1 mb-2">
                {[
                  { label: 'Protected contour', value: si.protected_contour_mvm != null ? `${si.protected_contour_mvm} mV/m` : '—' },
                  { label: 'Protected radius', value: si.protected_contour_radius_km != null ? `${si.protected_contour_radius_km} km` : '—' },
                  { label: '0.5 mV/m reach', value: si.daytime_secondary_reach_km != null ? `${si.daytime_secondary_reach_km} km` : '—' }
                ].map(m => (
                  <div key={m.label} className="bg-surface rounded p-1 text-center border border-rule">
                    <div className="font-mono text-[10px] text-textBright font-bold">{m.value}</div>
                    <div className="font-mono text-[8px] text-textDim mt-0.5">{m.label}</div>
                  </div>
                ))}
              </div>
              {/* Separation rules table */}
              <div className="font-mono text-[9px] text-textDim mb-1">§73.182 Separation Rules</div>
              <div className="space-y-1 mb-2">
                {si.separation_rules.map(r => (
                  <div key={r.relationship} className="border border-rule rounded p-1.5 bg-surface/60">
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="font-mono text-[9px] text-textBright font-semibold">{r.relationship.replace(/_/g, ' ')}</span>
                      <span className="font-mono text-[9px] text-textDim">
                        protected @ {r.protected_field_mvm} mV/m
                        {r.this_station_protected_radius_km != null ? ` · ${r.this_station_protected_radius_km} km radius` : ''}
                      </span>
                    </div>
                    <div className="font-mono text-[8px] text-textDim leading-snug">{r.screening_note}</div>
                  </div>
                ))}
              </div>
              {si.adjacent_clear_channels_khz?.length > 0 && (
                <div className="font-mono text-[9px] text-amber-400 mb-1">
                  Adjacent clear channels: {si.adjacent_clear_channels_khz.join(', ')} kHz — §73.182 1st-adjacent rules apply
                </div>
              )}
              <div className="font-mono text-[8px] text-textDim leading-snug">{si.note}</div>
            </div>
          );
        })()}

        {/* FCC LMS Filing Checklist */}
        {candidate.fcc_lms_filing_checklist && (() => {
          const fl = candidate.fcc_lms_filing_checklist;
          const statusColor = s => s === 'REQUIRED' ? 'text-amber-400' : s === 'CONDITIONAL' ? 'text-blue-300' : 'text-textDim';
          const statusBg    = s => s === 'REQUIRED' ? 'bg-amber-400/10 border-amber-400/40' : s === 'CONDITIONAL' ? 'bg-blue-300/10 border-blue-300/40' : 'bg-rule border-rule';
          return (
            <div>
              <div className="rack-eyebrow mb-1">FCC LMS Filing Checklist</div>
              <div className="font-mono text-[10px] text-textDim mb-1.5">
                Form 301-AM change-of-site — {fl.required_count} required, {fl.conditional_count} conditional ({fl.total_items} total items)
              </div>
              <div className="space-y-1">
                {fl.items.map(item => (
                  <div key={item.id} className={`border rounded px-2 py-1.5 ${statusBg(item.status)}`}>
                    <div className="flex items-start justify-between gap-2">
                      <span className={`font-mono text-[10px] font-bold uppercase tracking-wide ${statusColor(item.status)}`}>{item.status}</span>
                      <span className="font-mono text-[9px] text-textDim text-right">{item.rule}</span>
                    </div>
                    <div className="font-mono text-[11px] text-text mt-0.5">{item.exhibit}</div>
                    <div className="font-mono text-[10px] text-textDim">{item.form}</div>
                    {item.note && <div className="font-mono text-[10px] text-amberDim mt-0.5 leading-snug">{item.note}</div>}
                  </div>
                ))}
              </div>
              <div className="font-mono text-[9px] text-textDim mt-1 leading-snug">{fl.note}</div>
            </div>
          );
        })()}

        {/* Limitations */}
        {Array.isArray(candidate.limitations) && candidate.limitations.length > 0 && (
          <div>
            <div className="rack-eyebrow mb-1">Limitations</div>
            <ul className="font-mono text-[11px] text-amberDim list-disc list-inside space-y-0.5">
              {candidate.limitations.map((l, i) => <li key={i}>{l}</li>)}
            </ul>
          </div>
        )}

        {/* Next actions — context-sensitive per status_category */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <div className="rack-eyebrow">Next actions</div>
            <button
              onClick={() => {
                const txt = `${candidate.lat.toFixed(6)}, ${candidate.lon.toFixed(6)}`;
                if (navigator.clipboard) navigator.clipboard.writeText(txt).catch(() => {});
              }}
              className="font-mono text-[9px] uppercase tracking-rack border border-rule rounded-sm px-1.5 py-0.5 text-textDim hover:text-cream transition-colors"
              title="Copy coordinates to clipboard"
            >
              Copy coords
            </button>
          </div>
          <ul className="font-mono text-[11px] text-text list-disc list-inside space-y-0.5">
            {candidate.status_category !== 'NON_COMPLIANT' && onPromoteToStudio && (
              <li>Use <span className="text-green">Promote →</span> above to load these coordinates into the Contour Studio.</li>
            )}
            {(candidate.status_category === 'RECOVERABLE_WITH_DA' || candidate.status_category === 'REVIEW_REQUIRED') && (
              <li>Design a directional antenna (§73.150) to improve the 5 mV/m principal-community contour.</li>
            )}
            {candidate.status_category === 'RECOVERABLE_WITH_REDUCED_POWER' && (
              <li>Reduce TPO to shrink the 1000 mV/m blanket contour below the §73.24(g) 1% limit.</li>
            )}
            {candidate.status_category === 'RECOVERABLE_WITH_COL_CHANGE' && (
              <li>Consider a community-of-license change filing (§73.3573) — current CoL is too far from this site.</li>
            )}
            {candidate.status_category === 'TREATY_REVIEW' && (
              <li>Engage FCC International Bureau for treaty consultation before any engineering commitment.</li>
            )}
            <li>Run §73.182 skywave NIF protection contour with engineered DA pattern.</li>
            <li>Verify parcel ownership + zoning; obtain lease option before site survey.</li>
            <li>Commission structural / TIA-222 loading study if reusing an existing tower.</li>
            <li>Pull SDR residual evidence once parcel is shortlisted.</li>
          </ul>
        </div>
      </section>
    </div>
  );
}
