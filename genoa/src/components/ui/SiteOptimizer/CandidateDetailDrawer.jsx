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
