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
