import React, { useMemo, useState } from 'react';
import AppShell from '../AppShell.jsx';
import RackPanel from '../RackPanel.jsx';
import TopNav from '../TopNav.jsx';
import OptimizerIntroPanel from './OptimizerIntroPanel.jsx';
import OptimizerInputsPanel from './OptimizerInputsPanel.jsx';
import OptimizerMap from './OptimizerMap.jsx';
import CandidateTable from './CandidateTable.jsx';
import CandidateDetailDrawer from './CandidateDetailDrawer.jsx';
import BaselinePanel from './BaselinePanel.jsx';
import FuturePlaceholders from './FuturePlaceholders.jsx';
import ColocationDoctrineBlock from './ColocationDoctrineBlock.jsx';
import OptimizationConfidencePanel from './OptimizationConfidencePanel.jsx';
import LimitationsGlobalPanel from './LimitationsGlobalPanel.jsx';
import TowerReferencePanel from './TowerReferencePanel.jsx';
import RecommendedActionsPanel from './RecommendedActionsPanel.jsx';
import Form301ChecklistPanel from './Form301ChecklistPanel.jsx';
import ProtectionRequirementsPanel from './ProtectionRequirementsPanel.jsx';
import MinimumSpacingPanel from './MinimumSpacingPanel.jsx';

// SiteOptimizerApp — the entire /am-relocation page.  Top-level for
// the new route; the existing Contour Studio is unaffected.
//
// Layout (desktop):
//   [ AppShell topbar ]
//   [ intro panel ]
//   [ baseline strip ]
//   [ map (center, big) ] [ inputs rail (left) ] — using AppShell's
//   three-column grid, but inputs on the LEFT and map dominant in
//   center.  Bottom: candidate table.  Drawer is a fixed overlay.
//
// Two backend endpoints are used:
//   /api/am/site-optimizer            — when search_mode === 'GRID'
//   /api/am/colocation-opportunities  — when search_mode is INFRASTRUCTURE
//                                       or HYBRID (default).  The latter
//                                       returns the same shape plus a
//                                       per-candidate `source`,
//                                       `infrastructure_ref`,
//                                       `colocation_analysis` and
//                                       `status_category` enum.

const DEFAULT_INPUTS = {
  callsign:         'KAZM',
  frequency_khz:    780,
  current_site:     { lat: 34.86, lon: -111.82 },
  search_radius_km: 50,
  grid_spacing_km:  2,
  tpo_kw:           5,
  pattern_mode:     'NDA',
  fcc_class:        'D',
  optimization_goals: {
    maximize_col_coverage:       true,
    maximize_population:         true,
    minimize_blanket_population: true,
    prefer_high_conductivity:    true,
    avoid_wildfire_risk:         false,
    minimize_int_treaty_zone:    false
  },
  search_mode:           'HYBRID',
  infrastructure_source: 'MANUAL',
  infrastructure_filters: {
    include_towers:     true,
    include_asr:        true,
    include_am_sites:   true,
    include_fm_sites:   true,
    include_tv_sites:   true,
    min_tower_height_m: 0,
    max_tower_height_m: 500,
    owner_contains:     ''
  },
  candidate_limit: 20
};

export default function SiteOptimizerApp({ onSwitchToContourStudio, onLogout, onNavigate }){
  const [inputs, setInputs]     = useState(DEFAULT_INPUTS);
  const [result, setResult]     = useState(null);     // { available, n_..., current_site_baseline, candidates }
  const [running, setRunning]   = useState(false);
  const [error, setError]       = useState('');
  const [selectedRank, setSelectedRank] = useState(null);

  function onChange(k, v){
    setInputs(s => ({ ...s, [k]: v }));
  }

  async function runSearch(){
    setError('');
    setRunning(true);
    setResult(null);
    setSelectedRank(null);
    const useColocation = inputs.search_mode !== 'GRID';
    const endpoint = useColocation
      ? '/api/am/colocation-opportunities'
      : '/api/am/site-optimizer';
    try {
      const r = await fetch(endpoint, {
        method:  'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body:    JSON.stringify(inputs)
      });
      if (r.status === 404){
        setError(`${endpoint} is not yet deployed on this server.  Showing demo data so the UI is reviewable.`);
        setResult(useColocation ? DEMO_COLOCATION_RESULT : DEMO_RESULT);
        return;
      }
      if (!r.ok){
        const j = await r.json().catch(() => ({}));
        throw new Error(j.message || j.error || `HTTP ${r.status}`);
      }
      const j = await r.json();
      setResult(j);
      if (Array.isArray(j.candidates) && j.candidates.length > 0){
        setSelectedRank(j.candidates[0].rank);
      }
    } catch (e){
      setError(e.message || 'Search failed');
    } finally {
      setRunning(false);
    }
  }

  const selected = useMemo(() => {
    if (selectedRank == null || !result?.candidates) return null;
    return result.candidates.find(c => c.rank === selectedRank) || null;
  }, [selectedRank, result]);

  const baseline    = result?.current_site_baseline || null;
  const candidates  = result?.candidates || [];
  // Show all structured warnings from the engine (object form with .code/.message).
  // Plain-string warnings (legacy) are also shown.
  const auditWarnings = (result?.warnings || []).filter(w =>
    w != null && (typeof w === 'string' ? w.length > 0 : !!w.code)
  );

  // Infrastructure-source sites drive the InfrastructureLegend layer
  // inside OptimizerMap.  GRID-source candidates remain on the regular
  // ranked-candidate layer.
  const infrastructureSites = useMemo(() => {
    return (candidates || []).filter(c => c?.source === 'INFRASTRUCTURE');
  }, [candidates]);

  const isColocationMode = inputs.search_mode !== 'GRID';

  return (
    <>
      {/* Shared top nav (Studio / Product + Sign out), matching the
          contour-studio chrome.  The Studio link replaces the old
          "← Contour Studio" button.  Falls back to onSwitchToContourStudio
          for navigation when onNavigate isn't supplied. */}
      <TopNav
        authed
        onNavigate={onNavigate || (() => onSwitchToContourStudio && onSwitchToContourStudio())}
        onLogout={onLogout}
      />
      <AppShell
        systemStatus={result ? 'nominal' : 'offline'}
        mode="AM Relocation Optimizer (beta) · screening"
        engineVersion="genoa-optimizer v0.1.0"
        readinessScore={null}
        readinessStatus={null}
        commitSha="optimizer-ui"
        left={(
          <>
            <OptimizerInputsPanel
              inputs={inputs}
              onChange={onChange}
              onRun={runSearch}
              running={running}
              error={error}
            />
            <FuturePlaceholders conductivityMode={result?.conductivity_mode} />
          </>
        )}
        center={(
          <>
            <OptimizerIntroPanel />
            <BaselinePanel
              callsign={inputs.callsign}
              baseline={baseline}
              comparedTo={selected?.rank}
            />
            <OptimizerMap
              currentSite={inputs.current_site}
              colCentroid={inputs.col_centroid ?? null}
              callsign={inputs.callsign}
              candidates={candidates}
              selectedRank={selectedRank}
              onSelectCandidate={setSelectedRank}
              searchRadiusKm={inputs.search_radius_km}
              searchMode={inputs.search_mode}
              infrastructureSites={infrastructureSites}
            />
            {auditWarnings.length > 0 && (
              <div className="space-y-1 mt-1">
                {auditWarnings.map((w, i) => {
                  const msg = typeof w === 'object' ? w.message : w;
                  return (
                    <div key={i} className="border border-amber/40 bg-amber/5 rounded-sm px-3 py-2 font-mono text-[10px] text-amberDim leading-snug">
                      <span className="text-amber font-semibold mr-1.5 uppercase tracking-rack">
                        {typeof w === 'object' ? w.code : 'WARN'}
                      </span>
                      {msg}
                    </div>
                  );
                })}
              </div>
            )}
            <CandidateTable
              candidates={candidates}
              selectedRank={selectedRank}
              onSelect={setSelectedRank}
              evaluated={result?.n_candidates_evaluated}
              returned={result?.n_candidates_returned}
              countByStatus={result?.candidate_count_by_status}
            />
            <LimitationsGlobalPanel
              limitations={result?.limitations_global}
              warnings={result?.warnings}
            />
          </>
        )}
        right={(
          <>
            <OptimizationConfidencePanel
              confidence={result?.optimization_confidence}
              scoreStats={result?.score_stats}
              scoreHistogram={result?.score_histogram}
              topCandidatesSummary={result?.top_candidates_summary}
              conductivityMode={result?.conductivity_mode}
              frequencyChannelClass={result?.frequency_channel_class}
              nInfrastructureSites={result?.n_infrastructure_sites}
              scoringTimeMs={result?.scoring_time_ms}
            />
            {result && (
              <TowerReferencePanel
                towerReference={result.tower_reference}
                frequency_khz={inputs.frequency_khz}
                skywaveRiskLevel={result.skywave_risk_level}
                protectionClassAdvisory={result.protection_class_advisory}
              />
            )}
            {result?.engineering_summary && (
              <RackPanel eyebrow="Engineering Summary" title="Executive screening synthesis" dense>
                {(() => {
                  const es = result.engineering_summary;
                  const feasColor = es.overall_feasibility === 'SITES_AVAILABLE' ? '#63d471'
                    : es.overall_feasibility === 'SITES_RECOVERABLE' ? '#f6c90e'
                    : '#ff9b5a';
                  return (
                    <div className="font-mono text-[10px] space-y-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="uppercase text-[9px] tracking-rack px-1.5 py-0.5 rounded-sm"
                          style={{ background: feasColor + '22', color: feasColor }}>
                          {es.overall_feasibility.replace(/_/g, ' ')}
                        </span>
                        <span className="text-textDim">
                          {es.n_promising} PROMISING · {es.n_review_required} REVIEW · {es.n_non_compliant} NON-COMPLIANT of {es.n_candidates_evaluated} evaluated
                        </span>
                      </div>
                      <div className="space-y-1">
                        {es.statements.map((s, i) => (
                          <div key={i} className="text-textDim/85 leading-snug border-l-2 border-rule/40 pl-2">
                            {s}
                          </div>
                        ))}
                      </div>
                      {es.caveats?.length > 0 && (
                        <div className="border-t border-rule/30 pt-1.5">
                          <div className="text-[9px] uppercase tracking-rack text-textDim/50 mb-1">Caveats</div>
                          {es.caveats.map((c, i) => (
                            <div key={i} className="text-textDim/50 text-[9px] leading-snug">{c}</div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })()}
              </RackPanel>
            )}
            {result?.candidate_shortlist?.length > 0 && (
              <RackPanel eyebrow="Shortlist" title="Top candidate picks" dense>
                <div className="space-y-2">
                  {result.candidate_shortlist.map(entry => {
                    const statusCol = entry.status_category === 'PROMISING' ? '#63d471'
                      : entry.status_category?.startsWith('RECOVERABLE') ? '#ffb347'
                      : entry.status_category === 'TREATY_REVIEW' ? '#c79bff'
                      : '#a89c84';
                    return (
                      <div key={entry.rank} className="border border-rule/40 rounded p-2 font-mono text-[10px]">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-cream font-semibold">#{entry.rank}</span>
                          <span className="font-mono text-[9px] border rounded-sm px-1 py-0.5"
                            style={{ color: statusCol, borderColor: `${statusCol}44` }}>
                            {entry.status_category?.replace(/_/g, ' ')}
                          </span>
                          <span className="text-textDim">{entry.score_with_band}</span>
                        </div>
                        <div className="text-textDim/80 leading-snug">{entry.summary}</div>
                      </div>
                    );
                  })}
                </div>
              </RackPanel>
            )}
            {result?.geographic_diversity_analysis && (
              <RackPanel eyebrow="Geographic Diversity" title="Compass quadrant coverage" dense>
                {(() => {
                  const gd = result.geographic_diversity_analysis;
                  const tierColor = gd.diversity_tier === 'EXCELLENT' ? '#63d471'
                    : gd.diversity_tier === 'GOOD' ? '#a8e063'
                    : gd.diversity_tier === 'MODERATE' ? '#f6c90e'
                    : '#ff9b5a';
                  const QUADRANTS = ['NE', 'SE', 'SW', 'NW'];
                  return (
                    <div className="font-mono text-[10px] space-y-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[9px] uppercase tracking-rack px-1.5 py-0.5 rounded-sm"
                          style={{ background: tierColor + '22', color: tierColor }}>
                          {gd.diversity_tier}
                        </span>
                        <span className="text-textDim">{gd.quadrants_covered}/4 quadrants · score {gd.diversity_score}/100</span>
                        {gd.median_distance_km != null && (
                          <span className="text-textDim/60">med dist {gd.median_distance_km} km</span>
                        )}
                      </div>
                      <div className="grid grid-cols-4 gap-1">
                        {QUADRANTS.map(q => {
                          const qs = gd.quadrant_summary?.[q];
                          const covered = qs?.covered ?? false;
                          return (
                            <div key={q} className="flex flex-col items-center rounded p-1"
                              style={{ background: covered ? '#63d47122' : '#ff9b5a11', border: `1px solid ${covered ? '#63d47144' : '#ff9b5a33'}` }}>
                              <span className="text-[8px] uppercase tracking-rack" style={{ color: covered ? '#63d471' : '#ff9b5a99' }}>{q}</span>
                              <span className="text-[8px] text-textDim/60">{qs?.candidates?.length ?? 0} cand.</span>
                            </div>
                          );
                        })}
                      </div>
                      {gd.uncovered_quadrants?.length > 0 && (
                        <div className="text-[9px] text-amber/70">
                          Uncovered: {gd.uncovered_quadrants.join(', ')} — consider expanding search radius in those directions.
                        </div>
                      )}
                      <div className="text-[9px] text-textDim/60 leading-snug">{gd.interpretation}</div>
                    </div>
                  );
                })()}
              </RackPanel>
            )}
            {result?.candidate_set_diversity && result.candidate_set_diversity.n_candidates >= 2 && (
              <RackPanel eyebrow="Diversity" title="Candidate set diversity" dense>
                <div className="font-mono text-[10px] space-y-1.5">
                  {result.candidate_set_diversity.directional_coverage_assessment && (
                    <div>
                      <span className="text-textDim">Directional coverage: </span>
                      <span className="text-cream">{result.candidate_set_diversity.directional_coverage_assessment}</span>
                    </div>
                  )}
                  {result.candidate_set_diversity.sigma_variety_assessment && (
                    <div>
                      <span className="text-textDim">Conductivity variety: </span>
                      <span className="text-cream">{result.candidate_set_diversity.sigma_variety_assessment}</span>
                    </div>
                  )}
                  {result.candidate_set_diversity.score_range != null && (
                    <div>
                      <span className="text-textDim">Score spread: </span>
                      <span className="text-cream">{result.candidate_set_diversity.score_range} pts across {result.candidate_set_diversity.n_candidates} candidates</span>
                    </div>
                  )}
                  {result.candidate_set_diversity.recommendation && (
                    <div className="text-textDim/80 italic mt-1">{result.candidate_set_diversity.recommendation}</div>
                  )}
                </div>
              </RackPanel>
            )}
            {result?.candidate_set_recommendation && (
              <RackPanel eyebrow="Site Recommendation" title="Which candidates to advance" dense>
                {(() => {
                  const csr = result.candidate_set_recommendation;
                  const priorityColor = p => p === 'ADVANCE_IMMEDIATELY' ? '#63d471'
                    : p === 'ADVANCE_AFTER_REMEDY' ? '#f6c90e'
                    : p === 'HOLD' ? '#ff9b5a'
                    : '#a89c84';
                  return (
                    <div className="font-mono text-[10px] space-y-2">
                      <div className="text-textDim/80 leading-snug">{csr.overall_guidance}</div>
                      <div className="flex gap-3 text-[9px] text-textDim/60">
                        <span className="text-emerald-400">{csr.n_advance_ready} advance-ready</span>
                        <span className="text-amber">{csr.n_need_remedy} need remedy</span>
                        <span className="text-red-400/70">{csr.n_hold} hold</span>
                      </div>
                      {csr.candidates?.slice(0, 4).map(e => (
                        <div key={e.rank} className="border border-rule/30 rounded p-1.5 space-y-0.5">
                          <div className="flex items-center gap-2">
                            <span className="text-cream font-semibold">#{e.rank}</span>
                            <span className="text-[8px] uppercase tracking-rack px-1 py-0.5 rounded-sm border"
                              style={{ color: priorityColor(e.priority), borderColor: `${priorityColor(e.priority)}44` }}>
                              {e.priority?.replace(/_/g, ' ')}
                            </span>
                            {e.gate_verdict && (
                              <span className="text-[8px] text-textDim/50">{e.gate_verdict?.replace(/_/g, ' ')}</span>
                            )}
                          </div>
                          <div className="text-[9px] text-textDim/70 leading-snug">{e.action}</div>
                        </div>
                      ))}
                      <p className="text-[8px] text-textDim/40 leading-snug">{csr.note}</p>
                    </div>
                  );
                })()}
              </RackPanel>
            )}
            {result?.tower_construction_timeline && (
              <RackPanel eyebrow="Construction Timeline" title="Site-to-on-air schedule estimate" dense>
                {(() => {
                  const tct = result.tower_construction_timeline;
                  return (
                    <div className="font-mono text-[10px] space-y-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-cream font-semibold">{tct.range_label}</span>
                        <span className="text-textDim/60 text-[9px]">total from site selection to on-air</span>
                      </div>
                      <div className="space-y-1">
                        {tct.phases?.map((p, i) => (
                          <div key={p.id} className="flex items-start gap-2">
                            <span className="text-textDim/40 text-[8px] shrink-0 w-4 text-right">{i + 1}.</span>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-textDim text-[9px] leading-snug">{p.label}</span>
                                <span className="text-amber text-[8px] shrink-0">{p.weeks_min}–{p.weeks_max} wk</span>
                              </div>
                              {p.notes && <div className="text-[8px] text-textDim/40 leading-snug">{p.notes}</div>}
                            </div>
                          </div>
                        ))}
                      </div>
                      {tct.critical_path_notes?.length > 0 && (
                        <div className="border-t border-rule/30 pt-1.5 space-y-1">
                          <div className="text-[9px] uppercase tracking-rack text-textDim/50">Critical path</div>
                          {tct.critical_path_notes.map((n, i) => (
                            <div key={i} className="text-[8px] text-amber/70 leading-snug border-l border-amber/30 pl-1.5">{n}</div>
                          ))}
                        </div>
                      )}
                      <p className="text-[8px] text-textDim/40 leading-snug">{tct.note}</p>
                    </div>
                  );
                })()}
              </RackPanel>
            )}
            {result?.engineering_confidence_matrix && (() => {
              const ecm = result.engineering_confidence_matrix;
              const confColor = c => c === 'FILING_GRADE' ? 'text-emerald-400' : c === 'HIGH' ? 'text-emerald-300' : c === 'SCREENING' ? 'text-amber-400' : 'text-textDim';
              const overallBg = c => c === 'MEDIUM_HIGH' || c === 'HIGH' ? 'bg-emerald-400/10 border-emerald-400/30' : c === 'MEDIUM' ? 'bg-amber-400/10 border-amber-400/30' : 'bg-red-400/10 border-red-400/30';
              return (
                <RackPanel eyebrow="Scoring Confidence" title="Engineering confidence matrix" dense>
                  <div className={`border rounded px-2 py-1 mb-2 ${overallBg(ecm.overall_confidence)}`}>
                    <span className="font-mono text-[10px] text-text">Overall: <strong>{ecm.overall_confidence.replace(/_/g, ' ')}</strong> · {ecm.n_filing_grade} filing-grade · {ecm.n_screening} screening · {ecm.n_not_evaluated} not evaluated</span>
                  </div>
                  <div className="space-y-0.5">
                    {ecm.dimensions.map(d => (
                      <div key={d.id} className="flex items-start justify-between gap-2 py-0.5 border-b border-rule">
                        <span className="font-mono text-[10px] text-text">{d.label}</span>
                        <div className="text-right shrink-0">
                          <span className={`font-mono text-[10px] font-bold ${confColor(d.confidence)}`}>{d.confidence.replace(/_/g, ' ')}</span>
                          {d.score_impact_pts > 0 && <span className="font-mono text-[9px] text-textDim ml-1">±{d.score_impact_pts}pt</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                  {ecm.highest_impact_upgrade && (
                    <div className="font-mono text-[10px] text-amberDim mt-1.5 leading-snug">
                      <span className="text-textDim uppercase text-[9px]">Top upgrade: </span>{ecm.highest_impact_upgrade}
                    </div>
                  )}
                </RackPanel>
              );
            })()}
            {result?.recommended_actions?.length > 0 && (
              <RecommendedActionsPanel recommended_actions={result.recommended_actions} />
            )}
            {result?.form_301_checklist?.length > 0 && (
              <Form301ChecklistPanel checklist={result.form_301_checklist} />
            )}
            {result?.protection_requirements && (
              <ProtectionRequirementsPanel protection_requirements={result.protection_requirements} />
            )}
            {result?.minimum_spacing_reference && (
              <RackPanel eyebrow="§73.37" title="Minimum station separation" dense>
                <MinimumSpacingPanel data={result.minimum_spacing_reference} />
              </RackPanel>
            )}
            {isColocationMode ? (
              <ColocationDoctrineBlock candidates={candidates} />
            ) : (
              <RackPanel
                eyebrow="Doctrine"
                title="What this page is for"
                italicAccent="Screening, not filing."
                dense
              >
                <div className="font-mono text-[11px] text-textDim leading-relaxed space-y-2">
                  <p>
                    This is a <span className="text-cream">regional planning console</span>.  Every score
                    here is an explainable screening signal: COL coverage, blanket population,
                    conductivity, nighttime survivability proxies, optional environmental signals.
                  </p>
                  <p>
                    A <span className="text-amber">PROMISING</span> candidate is a desk-study seed —
                    not a filing.  Promote to the main Contour Studio to run the deterministic
                    §73.183 / §73.184 / §73.182 pipeline and to attach evidence + PE seal.
                  </p>
                  <p className="italic text-amberDim">
                    Status labels are explicit on every row and marker tooltip.  When a goal
                    is not yet wired (wildfire, treaty zone), the checkbox is tagged
                    "Screening only" so the operator can't be fooled.
                  </p>
                </div>
              </RackPanel>
            )}
          </>
        )}
      />
      <CandidateDetailDrawer
        candidate={selected}
        baseline={baseline}
        onClose={() => setSelectedRank(null)}
        onPromoteToStudio={onNavigate ? (params) => onNavigate('contour-studio', params) : null}
        callsign={inputs.callsign}
        frequency_khz={inputs.frequency_khz}
        tpo_kw={inputs.tpo_kw}
        fcc_class={inputs.fcc_class}
        pattern_mode={inputs.pattern_mode}
      />
    </>
  );
}

// Inline demo payload — shown only when the back-end endpoint returns
// 404 so the UI can be reviewed end-to-end before the parallel agent
// finishes the route.  Shape matches the documented response.
const DEMO_RESULT = {
  available: true,
  n_candidates_evaluated: 234,
  n_candidates_returned:  4,
  conductivity_mode: 'zone-table',
  n_infrastructure_sites: 0,
  scoring_time_ms: 587,
  tower_reference: {
    wavelength_m: 384.62, quarter_wave_m: 96.15, half_wave_m: 192.31,
    asr_threshold_m: 60.96, asr_registration_required_at_quarter_wave: true,
    note: 'AM vertical antennas typically run λ/4–λ/2. At 780 kHz all heights in the typical range EXCEED the §17.7 ASR 200-ft threshold.'
  },
  candidate_count_by_status: {
    PROMISING: 58, REVIEW_REQUIRED: 142, NON_COMPLIANT: 34
  },
  top_candidates_summary: 'Rank 1 scores 91.3 (PROMISING), 6 km NE of current site, σ=8 mS/m (EXCELLENT). COL field 18.4 mV/m (≥§73.24(i) 5 mV/m floor). est. 125K served @0.5 mV/m. vs current site: score +28.9, reach +5.6 km. top 4 σ quality: 3×EXCELLENT, 1×FAIR. statuses: 3 PROMISING, 1 REVIEW_REQUIRED (out of 234 evaluated).',
  candidate_shortlist: [
    {
      rank: 1, lat: 34.91, lon: -111.79, status_category: 'PROMISING',
      score_with_band: 'score 91.3 [69.3–100]',
      summary: 'Rank 1 @ 6.2 km NE: COL coverage 97%, σ=8 mS/m (EXCELLENT), reach 34 km. Advance to full §73.182 NIF study and parcel investigation.',
      recommended_next_step: 'Advance to full §73.182 NIF study and parcel investigation.'
    },
    {
      rank: 2, lat: 34.83, lon: -111.74, status_category: 'PROMISING',
      score_with_band: 'score 84.0 [62.0–100]',
      summary: 'Rank 2 @ 7.8 km SE: COL coverage 91%, σ=6 mS/m (GOOD), reach 31 km. Advance to full §73.182 NIF study and parcel investigation.',
      recommended_next_step: 'Advance to full §73.182 NIF study and parcel investigation.'
    },
    {
      rank: 3, lat: 34.95, lon: -111.92, status_category: 'RECOVERABLE_WITH_POWER_INCREASE',
      score_with_band: 'score 71.8 [49.8–93.8]',
      summary: 'Rank 3 @ 12.5 km NW: COL coverage 78% (below 80% floor), σ=10 mS/m (EXCELLENT), reach 28 km. Increase TPO to ≥8.5 kW to achieve §73.24(i) compliance, then advance to NIF study.',
      recommended_next_step: 'Increase TPO to ≥8.5 kW to achieve §73.24(i) compliance, then advance to NIF study.'
    }
  ],
  geographic_diversity_analysis: {
    n_candidates_analyzed: 4,
    quadrants_covered: 4,
    diversity_score: 100,
    diversity_tier: 'EXCELLENT',
    interpretation: 'Top candidates span all 4 compass quadrants — maximum site-selection flexibility regardless of terrain, zoning, or land availability in any single direction.',
    quadrant_summary: {
      NE: { label: 'NE (0–90°)',   candidates: [1], covered: true },
      SE: { label: 'SE (90–180°)', candidates: [2], covered: true },
      SW: { label: 'SW (180–270°)', candidates: [4], covered: true },
      NW: { label: 'NW (270–360°)', candidates: [3], covered: true }
    },
    uncovered_quadrants: [],
    median_distance_km: 10.0,
    note: 'Quadrant analysis based on bearing from current site.'
  },
  candidate_set_recommendation: {
    overall_guidance: '3 candidates are ready to advance. Initiate NIF studies at Rank 1 and Rank 2 in parallel to minimize timeline.',
    primary_recommended_rank: 1,
    n_advance_ready: 3, n_need_remedy: 0, n_hold: 1,
    candidates: [
      { rank: 1, status: 'PROMISING', score: 91.3, col_pct: 97, gate_verdict: 'CONDITIONAL', gate_fail_count: 0, cost_tier: 'HIGH', skywave_advisory: 'HIGH', quadrant: 'NE', action: 'Advance to full §73.182 NIF study + parcel investigation. Commission soil resistivity survey. DA-N study required for nighttime operation.', priority: 'ADVANCE_IMMEDIATELY' },
      { rank: 2, status: 'PROMISING', score: 84.0, col_pct: 91, gate_verdict: 'CONDITIONAL', gate_fail_count: 0, cost_tier: 'HIGH', skywave_advisory: 'HIGH', quadrant: 'SE', action: 'Advance to full §73.182 NIF study + parcel investigation. Commission soil resistivity survey. DA-N study required for nighttime operation.', priority: 'ADVANCE_IMMEDIATELY' },
      { rank: 3, status: 'PROMISING', score: 78.2, col_pct: 78, gate_verdict: 'CONDITIONAL', gate_fail_count: 0, cost_tier: 'HIGH', skywave_advisory: 'HIGH', quadrant: 'NW', action: 'Advance to NIF study + parcel investigation.', priority: 'ADVANCE_IMMEDIATELY' },
      { rank: 4, status: 'NON_COMPLIANT', score: 58.5, col_pct: 62, gate_verdict: 'NON_VIABLE_AS_IS', gate_fail_count: 1, cost_tier: 'VERY_HIGH', skywave_advisory: 'CRITICAL', quadrant: 'SW', action: 'Hold — 1 gate failure(s) require engineering remediation before advancing. Commission DA or power-increase study.', priority: 'HOLD' }
    ],
    note: 'This recommendation is a SCREENING-GRADE advisory based on automated scoring. A licensed broadcast engineer and FCC counsel must review before any site commitment or filing.'
  },
  tower_construction_timeline: {
    frequency_khz: 780, fcc_class: 'D', channel_class: 'clear_channel', tpo_kw: 5,
    asr_required: true, da_required: true, treaty_factor: false,
    phases: [
      { id: 'PHASE_1', label: 'Site selection & parcel', weeks_min: 4,   weeks_max: 12,  notes: 'Site surveys, zoning review, lease negotiation, environmental desktop review.' },
      { id: 'PHASE_2', label: 'Engineering studies',    weeks_min: 14,  weeks_max: 28,  notes: 'NIF study (14–20 wk), DA-N pattern design (8–16 wk), soil resistivity survey, MPE evaluation.' },
      { id: 'PHASE_3', label: 'FCC Form 301-AM + CP',   weeks_min: 26,  weeks_max: 52,  notes: 'FCC processing time for AM change of site on clear channel. Docketed proceeding if petitions filed.' },
      { id: 'PHASE_4', label: 'Tower procurement & site prep', weeks_min: 8, weeks_max: 20, notes: 'Guyed monopole steel delivery, concrete foundation, access road, FAA/ASR coordination.' },
      { id: 'PHASE_5', label: 'Tower erection',         weeks_min: 4,   weeks_max: 8,   notes: 'Steel erection, guy wire anchoring, aviation marking/lighting installation.' },
      { id: 'PHASE_6', label: 'Antenna, ATU & phasor',  weeks_min: 3,   weeks_max: 6,   notes: 'DA-N phasor cabinet installation, base ATU tuning, feedline, ground system copper burial.' },
      { id: 'PHASE_7', label: 'Proof of performance + license', weeks_min: 4, weeks_max: 8, notes: 'Field-intensity proof runs per §73.154, FCC Form 302-AM license application.' }
    ],
    total_weeks_min: 63, total_weeks_max: 134,
    total_months_min: 15, total_months_max: 31,
    range_label: '15 – 31 months (clear channel, ASR, DA-N required)',
    critical_path_notes: [
      'NIF study is the longest single item at 14–20 weeks — start immediately after site selection.',
      'FCC CP processing (Phase 3) is the most uncertain duration; clear channel Class D filings may attract informal objections.',
      'ASR registration (FCC Form 854 + FAA 7460-1) must be complete before tower construction begins — start no later than end of Phase 2.',
      'DA-N phasor procurement can take 10–20 weeks; order during Phase 3 FCC processing to avoid delay.'
    ],
    note: 'Timeline is a screening-grade planning estimate. Actual schedule depends on FCC workload, parcel availability, and engineering complexity.'
  },
  engineering_confidence_matrix: {
    overall_confidence: 'LOW', conductivity_mode: 'zone-table', col_polygon_supplied: false,
    n_filing_grade: 0, n_screening: 4, n_not_evaluated: 3,
    dimensions: [
      { id: 'CONDUCTIVITY', label: 'Ground conductivity (σ)', confidence: 'SCREENING', score_impact_pts: 12, upgrade_action: 'Deploy AM_m3.tif GeoTIFF raster via S3/CDN — eliminates ±50% conductivity uncertainty. Commission site soil resistivity survey.', upgrade_value: 'Conductivity sub-score resolves from ±12 pts to ±3 pts.' },
      { id: 'COL_COVERAGE', label: 'Principal community (§73.24(i)) coverage', confidence: 'SCREENING', score_impact_pts: 10, upgrade_action: 'Supply community_of_license_polygon as GeoJSON Polygon in the request body.', upgrade_value: 'COL sub-score resolves from ±10 pts to ±2 pts.' },
      { id: 'POPULATION', label: 'Population / people served', confidence: 'SCREENING', score_impact_pts: 8, upgrade_action: 'Integrate Census TIGER block-level population raster or polygon-level data.', upgrade_value: 'Population sub-score uncertainty reduces from ±40% to ±10%.' },
      { id: 'BLANKET_POPULATION', label: 'Blanket population (§73.24(g)) fraction', confidence: 'SCREENING', score_impact_pts: 6, upgrade_action: 'Integrate Census TIGER block-level population within 1000 mV/m contour.', upgrade_value: 'Resolves blanket sub-score from ±50% to ±10% in urban areas.' },
      { id: 'NIGHTTIME_NIF', label: 'Nighttime skywave interference (§73.182)', confidence: 'NOT_EVALUATED', score_impact_pts: 0, upgrade_action: 'Integrate FCC OET-72 skywave propagation engine + LMS database lookup.', upgrade_value: 'Would add a 5th scoring dimension.' },
      { id: 'WILDFIRE_RISK', label: 'Wildfire / fuel risk', confidence: 'NOT_EVALUATED', score_impact_pts: 0, upgrade_action: 'Wire USFS FIA RiskMap API or LANDFIRE raster.', upgrade_value: 'Would add wildfire_risk scoring dimension.' },
      { id: 'PARCEL_AVAILABILITY', label: 'Parcel availability / zoning', confidence: 'NOT_EVALUATED', score_impact_pts: 0, upgrade_action: 'Integrate county parcel GIS API.', upgrade_value: 'Would eliminate non-viable candidates before scoring.' }
    ],
    highest_impact_upgrade: 'Deploy AM_m3.tif GeoTIFF raster via S3/CDN — eliminates ±50% conductivity uncertainty. Commission site soil resistivity survey (4-electrode Wenner) for §73.190 certification.',
    note: 'Confidence matrix shows the data quality behind each scoring dimension. Screening-grade dimensions have the highest uncertainty and upgrading them produces the most accurate site ranking.'
  },
  candidate_set_diversity: {
    n_candidates: 4,
    bearing_spread_deg: 283,
    directional_coverage_assessment: 'EXCELLENT (>270° compass arc covered)',
    sigma_range_msm: 8.5,
    sigma_variety_assessment: 'HIGH — wide range of conductivity environments sampled',
    score_range: 29.2,
    distance_range_km: 19.0,
    recommendation: 'ADEQUATE: candidate set shows reasonable geographic spread for screening.'
  },
  engineering_summary: {
    callsign: 'KAZM', frequency_khz: 780, fcc_class: 'D', tpo_kw: 5,
    n_candidates_evaluated: 234, n_promising: 58, n_review_required: 142, n_non_compliant: 34,
    overall_feasibility: 'SITES_AVAILABLE',
    statements: [
      "Screening of 234 grid candidates within 50 km of KAZM's current site (34.8600°N, 111.8200°W) identified 58 PROMISING candidate(s) and 142 candidates requiring engineering review.",
      "The top-ranked site (6.2 km NE) achieves 97% COL coverage, 34 km daytime reach at 5 kW TPO on 780 kHz. Regulatory risk: MODERATE.",
      "Conductivity data uses the FCC M3 zone table (15-zone fallback). Deploying the AM_m3.tif GeoTIFF raster will improve ranking precision and bring conductivity sub-scores to filing-grade accuracy.",
      "At 780 kHz, all standard antenna heights (λ/4 = 96.2 m) exceed the §17.7 200-ft (60.96 m) ASR threshold — every candidate requires FCC Form 854 registration and FAA aeronautical study before construction.",
      "As a clear_channel channel station (780 kHz Class D), a §73.182 nighttime NIF study is required at any selected site before Form 301-AM can be filed. Clear-channel NIF is complex — budget 4–12 weeks of consulting time."
    ],
    caveats: [
      'This is a SCREENING-GRADE analysis only — field measurements, §73.182 NIF study, and full engineering design are required before filing.',
      'Candidate scores use FCC M3 groundwave curves and population proxies; actual coverage contours must be computed per §73.183/§73.184.',
      'Parcel availability, lease feasibility, zoning, and environmental review are outside the scope of this analysis.'
    ]
  },
  score_stats: { mean: 76.5, std_dev: 13.2, min: 58.5, max: 91.3 },
  score_histogram: [
    { bucket: '0–9',   min: 0,  max: 9,  count: 0 },
    { bucket: '10–19', min: 10, max: 19, count: 0 },
    { bucket: '20–29', min: 20, max: 29, count: 2 },
    { bucket: '30–39', min: 30, max: 39, count: 8 },
    { bucket: '40–49', min: 40, max: 49, count: 14 },
    { bucket: '50–59', min: 50, max: 59, count: 34 },
    { bucket: '60–69', min: 60, max: 69, count: 62 },
    { bucket: '70–79', min: 70, max: 79, count: 58 },
    { bucket: '80–89', min: 80, max: 89, count: 44 },
    { bucket: '90–99', min: 90, max: 99, count: 12 }
  ],
  optimization_confidence: {
    level: 'MEDIUM',
    contributing_layers: ['fcc_groundwave_engine', 'blanket_population_proxy'],
    notes: [
      'Ground conductivity: FCC M3 zone table (15 zones, ±50% vs. raster) — deploy AM_m3.tif for filing-grade σ',
      'COL coverage uses a 10 km disc proxy; supply community_of_license_polygon for higher confidence'
    ]
  },
  frequency_channel_class: 'clear_channel',
  skywave_risk_level: 'HIGH',
  protection_class_advisory: 'Class D secondary station on clear channel 780 kHz (§73.25). The dominant Class A retains protected skywave status; your new site must NOT increase nighttime interference into the dominant\'s protected 0.5 mV/m or 25 µV/m contours (§73.182). A §73.182 NIF study demonstrating no new interference at the candidate site is required for filing.',
  recommended_actions: [
    {
      priority: 'HIGH',
      action: 'Advance Rank 1 candidate (score 91.3, 6 km NE of current site) to full §73.182 NIF study and parcel investigation.',
      rationale: 'This is the top-scoring site with no hard rule failures on the screening rubric. A full engineer-grade analysis (§73.182 nighttime NIF, ground radial system design, parcel/zoning check) is the recommended next step.'
    },
    {
      priority: 'MEDIUM',
      action: 'Evaluate TPO increase for §73.24(i) COL coverage on 2 candidate(s) (Rank 3: increase to ≥8.5 kW).',
      rationale: 'Ranks 3 and 4 fail the §73.24(i) 5 mV/m principal-community floor at current TPO. The engine has pre-computed the minimum TPO at which the 5 mV/m groundwave contour reaches the community-of-license centroid distance. Verify the increased power is within the licensed class ceiling (§73.21) and does not create new §73.24(g) blanket population problems.'
    },
    {
      priority: 'MEDIUM',
      action: 'Commission §73.182 nighttime skywave NIF study before selecting any candidate site.',
      rationale: 'The operating frequency (780 kHz) is a §73.25 clear channel with HIGH skywave risk. A complete NIF analysis is mandatory for any change of community or transmitter site; this should precede site acquisition to avoid committing to a site that fails nighttime skywave protection.'
    },
    {
      priority: 'MEDIUM',
      action: 'Supply the community-of-license GeoJSON polygon for filing-grade COL coverage scoring.',
      rationale: 'Current run uses a 10 km disc proxy for §73.24(i) coverage. Providing the actual COL boundary as a GeoJSON Polygon enables Monte-Carlo polygon overlap scoring and significantly increases confidence in the coverage sub-score.'
    },
    {
      priority: 'INFORMATIONAL',
      action: 'Begin 47 CFR §17.7 ASR pre-application process for promising candidate sites.',
      rationale: 'AM towers at the typical λ/4 height (96.15 m at 780 kHz) exceed the 200-ft (60.96 m) §17.7 threshold requiring FAA notification and ASR registration. Starting the FAA/FCC coordination early avoids delays in the tower permit timeline.'
    },
    {
      priority: 'INFORMATIONAL',
      action: 'Commission soil resistivity survey at POOR/FAIR conductivity candidate sites.',
      rationale: 'Rank 4 candidate has POOR ground conductivity (σ = 1.5 mS/m). The §73.190 ground radial system requirements and achievable antenna efficiency are highly sensitive to soil resistivity at these levels. A resistivity survey before site commitment can avoid costly ground system overruns.'
    }
  ],
  form_301_checklist: [
    { id: 'SITE_SURVEY',       status: 'REQUIRED',    description: 'Conduct professional site survey (zoning, lease availability, setbacks)', rule: 'General engineering practice; FCC Form 301 §I', note: null },
    { id: 'ANTENNA_STUDY',     status: 'REQUIRED',    description: 'Design and model AM vertical antenna system for 780 kHz', rule: '47 CFR §73.45 / §73.189', note: 'Non-directional antenna — standard §73.45 antenna system / §73.189 efficiency certification required' },
    { id: 'ASR_REGISTRATION',  status: 'REQUIRED',    description: 'Verify tower height; file FCC ASR registration if > 200 ft (60.96 m)', rule: '47 CFR §17.7', note: 'ASR REGISTRATION REQUIRED: typical λ/4 antenna height at 780 kHz (96.15 m) exceeds the 200-ft §17.7 threshold' },
    { id: 'RF_EXPOSURE_MPE',   status: 'REQUIRED',    description: 'Prepare RF exposure (MPE) evaluation per OET Bulletin 65', rule: '47 CFR §1.1307 / OET Bulletin 65', note: 'ERP = 5 kW. All AM broadcast stations must demonstrate general population MPE compliance.' },
    { id: 'COL_COVERAGE',      status: 'REQUIRED',    description: 'Document ≥ 80% community-of-license coverage by the 5 mV/m daytime contour', rule: '47 CFR §73.24(i)', note: 'No COL polygon provided — polygon-based analysis required for filing' },
    { id: 'BLANKET_POPULATION',status: 'REQUIRED',    description: 'Demonstrate blanket-area population does not exceed 1% of total service population', rule: '47 CFR §73.24(g)', note: 'Compute 1000 mV/m contour area and census population at proposed TPO.' },
    { id: 'PROTECTION_STUDIES',status: 'REQUIRED',    description: 'Submit co-channel and adjacent-channel interference protection studies', rule: '47 CFR §73.182 / §73.37', note: null },
    { id: 'SKYWAVE_NIF',       status: 'REQUIRED',    description: 'Prepare skywave interference analysis (NIF study) for nighttime operations', rule: '47 CFR §73.182', note: 'Clear channel (780 kHz) — full §73.182 NIF study required before nighttime authorization' },
    { id: 'NEPA_ENVIRONMENTAL',status: 'REQUIRED',    description: 'Complete NEPA environmental checklist (§1.1306); file EA if any triggers apply', rule: '47 CFR §1.1306 / §1.1307', note: 'Check for protected species, historic properties (NHPA §106), floodplains, wetlands, wilderness areas' },
    { id: 'FAA_AERONAUTICAL',  status: 'CONDITIONAL', description: 'File FAA Form 7460-1 (aeronautical study) for any structure > 200 ft or near airports', rule: '47 CFR §17.7; 14 CFR Part 77', note: 'Required if tower height > 200 ft AGL or if within obstacle free zone of an airport' }
  ],
  protection_requirements: {
    station_class: 'D',
    channel_class: 'clear_channel',
    frequency_khz: 780,
    receives_co_channel_protection: {
      type: 'SECONDARY',
      description: 'Class D secondary on clear channel — must not interfere with dominant Class A; 0.5 mV/m and 25 µV/m Class A contours are absolute constraints.',
      protected_contour_mvm: null,
      rule: '47 CFR §73.25 / §73.182'
    },
    must_protect_against_interference: [
      { constraint: 'Must not increase interference to dominant Class A 0.5 mV/m skywave contour', threshold: '0 additional interference persons (NIF standard)', rule: '47 CFR §73.182(k)' },
      { constraint: 'Must not increase interference to Class A 25 µV/m skywave contour', threshold: 'No new interference at this contour', rule: '47 CFR §73.182(k)' },
      { constraint: 'Must maintain §73.37 minimum distance separations from co-channel and adjacent-channel stations', threshold: '§73.25 clear-channel separations', rule: '47 CFR §73.37' },
      { constraint: 'Demonstrate no objectionable interference to other stations via §73.182 field-intensity method', threshold: 'D/U ratio per §73.182 Table 1 at receiving station 0.5 mV/m or 5 mV/m contour', rule: '47 CFR §73.182' }
    ],
    nif_study_required: true,
    nif_study_notes: 'Full §73.182 NIF study required — new site must not increase nighttime interference to Class A dominant station contours.',
    adjacent_channel_advisory: {
      minus_10khz: { protection_db: 6, note: '1st adjacent lower: 6 dB D/U (§73.182 Table 1)' },
      plus_10khz:  { protection_db: 6, note: '1st adjacent upper: 6 dB D/U' },
      minus_20khz: { protection_db: 14, note: '2nd adjacent lower: 14 dB D/U' },
      plus_20khz:  { protection_db: 14, note: '2nd adjacent upper: 14 dB D/U' },
      note: 'D/U ratios are at the undesired station\'s 0.5 mV/m skywave or 5 mV/m groundwave contour (§73.182 Table 1). Exact values depend on class and time of operation.'
    }
  },
  minimum_spacing_reference: {
    rule: '47 CFR §73.37',
    proposed_class: 'D',
    channel_class: 'clear_channel',
    caveat: 'These are screening-grade minimums from the §73.37 table. Actual required separation for a specific site pair must be computed using the FCC groundwave field-intensity method (§73.182) against all stations in the LMS database.',
    co_channel: [
      { existing_class: 'A', min_separation_km: 1037, note: 'Proposed Class D vs. existing Class A — co-channel (0 kHz)' },
      { existing_class: 'B', min_separation_km:  953, note: 'Proposed Class D vs. existing Class B — co-channel (0 kHz)' },
      { existing_class: 'C', min_separation_km:  724, note: 'Proposed Class D vs. existing Class C — co-channel (0 kHz)' },
      { existing_class: 'D', min_separation_km:  953, note: 'Proposed Class D vs. existing Class D — co-channel (0 kHz)' }
    ],
    adjacent_10khz: [
      { existing_class: 'A', min_separation_km: 805, note: 'Proposed Class D vs. existing Class A — ±10 kHz adjacent channel' },
      { existing_class: 'B', min_separation_km: 724, note: 'Proposed Class D vs. existing Class B — ±10 kHz adjacent channel' },
      { existing_class: 'C', min_separation_km: 402, note: 'Proposed Class D vs. existing Class C — ±10 kHz adjacent channel' },
      { existing_class: 'D', min_separation_km: 724, note: 'Proposed Class D vs. existing Class D — ±10 kHz adjacent channel' }
    ],
    adjacent_20khz: [
      { existing_class: 'A', min_separation_km: 402, note: 'Proposed Class D vs. existing Class A — ±20 kHz second adjacent' },
      { existing_class: 'B', min_separation_km: 354, note: 'Proposed Class D vs. existing Class B — ±20 kHz second adjacent' },
      { existing_class: 'C', min_separation_km: 177, note: 'Proposed Class D vs. existing Class C — ±20 kHz second adjacent' },
      { existing_class: 'D', min_separation_km: 354, note: 'Proposed Class D vs. existing Class D — ±20 kHz second adjacent' }
    ]
  },
  warnings: [
    {
      code: 'ADJACENT_TO_CLEAR_CHANNEL',
      message: '780 kHz is a §73.25 clear channel. Adjacent frequency separation from the dominant Class A station may require stricter NIF protection analysis. All candidate sites on this frequency must demonstrate nighttime interference compliance.'
    }
  ],
  limitations_global: [
    'Screening-grade output only; engineer-grade NIF / §73.182 / DA-N analysis is required for any filing.',
    'Population sub-score uses a population-density proxy (groundwave reach × density model), not a Census-block sum.',
    'Wildfire / fuel-risk scoring is a placeholder until USFS FIA / LANDFIRE integration lands.',
    'Parcel / zoning availability is not checked — engineer must verify each site is leasable / buildable.',
    'No skywave (§73.182) interference analysis is performed at this stage.'
  ],
  current_site_baseline: {
    score: 62.4,
    rank_percentile: 41.5,
    col_coverage_pct: 0.85,
    blanket_population_pct: 0.6,
    daytime_reach_km: 28.5,
    ground_sigma_mS_m: 8,
    ground_sigma_quality: 'EXCELLENT',
    ground_sigma_source: 'Desert SW (~2 mS/m, FCC M3 zone estimate)',
    ground_sigma_filing_grade: 'screening',
    field_at_col_centroid_mvm: 3.7,
    estimated_daytime_population_served: 87500,
    score_confidence: 'LOW',
    minimum_tpo_for_compliance_kw: null,
    minimum_tpo_for_col_coverage_kw: 7.2,
    score_breakdown: { col_coverage: 28.1, population: 20.4, blanket: 12.5, conductivity: 5.2, wildfire: 0, treaty_zone: 0 }
  },
  candidates: [
    {
      rank: 1, rank_percentile: 99.6, lat: 34.91, lon: -111.79,
      distance_from_current_km: 6.2, bearing_deg: 42, cardinal_direction: 'NE', score: 91.3,
      score_delta_vs_baseline: 28.9,
      col_coverage_pct: 0.97, nif_status: 'PROMISING — HIGH skywave risk (§73.182 NIF study required)',
      principal_community_5mvm_km: 5.8, daytime_reach_km: 34.1, blanket_population_pct: 0.4,
      blanket_1000mvm_km: 0.8, minimum_tpo_for_compliance_kw: null, minimum_tpo_for_col_coverage_kw: null,
      ground_sigma_mS_m: 8, ground_sigma_quality: 'EXCELLENT', ground_sigma_filing_grade: 'screening',
      ground_sigma_source: 'FCC M3 zone table', ground_radial_advisory: null,
      score_confidence: 'LOW', field_at_col_centroid_mvm: 18.4,
      estimated_daytime_population_served: 124800,
      score_confidence_band: {
        score_low: 69.3, score_high: 100, uncertainty_pts: 22,
        uncertainty_factors: [
          'zone-table conductivity (±12 pts): measured σ could shift conductivity sub-score — commission soil survey to resolve',
          'COL disc proxy (±10 pts): polygon-based coverage analysis could differ materially from 10 km radius disc'
        ]
      },
      treaty_zone: null, fuel_risk: 'NOT-EVALUATED',
      notes: '97% city-coverage, σ=8 mS/m, 0.4% blanket pop, 6 km from current.',
      explanation: {
        score_breakdown: { col_coverage: 40.2, population: 32.2, blanket: 16.1, conductivity: 11.5, wildfire: 0, treaty_zone: 0, confidence_penalty: -7.0 },
        ranking_rationale: 'Highest COL coverage and population in pool; conductivity 8 mS/m is M3-zone max for region.'
      },
      status_labels: ['PROMISING', 'ENGINEER REVIEW REQUIRED'],
      status_category: 'PROMISING',
      blanket_pop_risk: 'OK', col_coverage_gap_pct: null, population_delta_vs_baseline: 37700,
      power_class_ceiling_kw: 50, mpe_evaluation_required: true,
      score_delta_explanation: {
        total: 28.9,
        components: { col_coverage: 12.1, population: 11.8, blanket: 3.6, conductivity: 6.3, confidence_penalty: -4.9 }
      },
      regulatory_compliance_summary: {
        col_coverage: { status: 'PASS', value: 0.97, threshold: 0.80, rule: '47 CFR §73.24(i)' },
        blanket_pop:  { status: 'PASS', value: 0.40, threshold: 1.00, rule: '47 CFR §73.24(g)' },
        class_power:  { status: 'PASS', value: 5, ceiling: 50, rule: '47 CFR §73.21' },
        treaty_zone:  { status: 'CLEAR', value: null, rule: 'US/MX 1986 Agreement; US/CA 1991 LOU' }
      },
      source: 'GRID',
      infrastructure_ref: null,
      colocation_analysis: null,
      limitations: ['Wildfire scoring not yet wired', 'Parcel availability not checked', 'NIF status is SCREENING-grade only'],
      coverage_feasibility_assessment: {
        verdict: 'MEETS_ALL_FLOORS',
        col_coverage_pct: 0.97,
        col_coverage_meets_floor: true,
        tpo_needed_for_col_floor_kw: null,
        tpo_needed_within_class_ceiling: null,
        class_power_ceiling_kw: 50,
        blanket_pop_pct: 0.40,
        blanket_pop_meets_limit: true,
        da_pattern_may_resolve: false,
        summary: 'COL coverage 97% (floor 80%)'
      },
      per_candidate_engineering_checklist: [
        { id: 'SOIL_RESISTIVITY_SURVEY', priority: 'REQUIRED', label: 'Soil resistivity survey', note: 'Zone-table σ=8 mS/m used for screening. Commission a 4-electrode Wenner array survey.' },
        { id: 'ASR_REGISTRATION', priority: 'REQUIRED', label: 'ASR registration (47 CFR §17.7)', note: 'λ/4 ≈ 96 m at 780 kHz exceeds the §17.7 200-ft (60.96 m) threshold. File FCC Form 854.' },
        { id: 'MPE_STUDY', priority: 'REQUIRED', label: 'RF exposure (MPE) evaluation (OET-65 / §1.1307)', note: 'Near-field boundary λ/(2π) ≈ 61 m at 780 kHz.' }
      ],
      tpo_power_sweep: [
        { tpo_kw: 0.001, is_current_tpo: false, daytime_reach_km: 5.1, col_5mvm_km: 1.2, blanket_1000mvm_km: 0.04, col_coverage_pct_est: 0.11, blanket_pop_pct_est: 0.00, col_meets_floor: false, blanket_pop_ok: true, compliant: false },
        { tpo_kw: 2.5,   is_current_tpo: false, daytime_reach_km: 24.3, col_5mvm_km: 4.7, blanket_1000mvm_km: 0.38, col_coverage_pct_est: 0.87, blanket_pop_pct_est: 0.07, col_meets_floor: true,  blanket_pop_ok: true, compliant: true },
        { tpo_kw: 5,     is_current_tpo: true,  daytime_reach_km: 34.1, col_5mvm_km: 5.8, blanket_1000mvm_km: 0.52, col_coverage_pct_est: 0.97, blanket_pop_pct_est: 0.13, col_meets_floor: true,  blanket_pop_ok: true, compliant: true },
        { tpo_kw: 10,    is_current_tpo: false, daytime_reach_km: 46.8, col_5mvm_km: 7.6, blanket_1000mvm_km: 0.74, col_coverage_pct_est: 0.99, blanket_pop_pct_est: 0.27, col_meets_floor: true,  blanket_pop_ok: true, compliant: true },
        { tpo_kw: 50,    is_current_tpo: false, daytime_reach_km: 88.2, col_5mvm_km: 14.1, blanket_1000mvm_km: 1.61, col_coverage_pct_est: 1.00, blanket_pop_pct_est: 1.28, col_meets_floor: true, blanket_pop_ok: false, compliant: false }
      ],
      regulatory_risk_score: {
        risk_score: 35, risk_category: 'MODERATE',
        risk_factors: [
          { factor: 'ASR_REQUIRED', points: 15, note: 'λ/4 ≈ 96 m at 780 kHz exceeds 60.96 m §17.7 threshold: FAA 7460-1 + FCC Form 854 required before construction; adds 8–16 weeks' },
          { factor: 'MODERATE_CONDUCTIVITY', points: 5, note: 'σ=8 mS/m (GOOD): standard 120-radial system adequate but soil survey still required for §73.190 certification' },
          { factor: 'NIF_STUDY_REQUIRED', points: 10, note: '§73.182 NIF study required for all non-local-channel stations at a new transmitter site' },
          { factor: 'DA_PATTERN_REQUIRED', points: 5, note: 'NDA operation reviewed; DA may be needed if sky-wave NIF fails' }
        ],
        interpretation: 'MODERATE risk — routine but non-trivial filing requirements; plan for soil survey, ASR, or NIF as applicable.'
      },
      co_channel_spacing_estimate: {
        candidate_distance_km: 7.2,
        co_channel: { min_separation_km: 953, meets_separation: false, note: 'Class D co-channel minimum 953 km' },
        adjacent_10khz: { min_separation_km: 724, meets_separation: false, note: 'Class D ±10 kHz minimum 724 km' },
        adjacent_20khz: { min_separation_km: 354, meets_separation: false, note: 'Class D ±20 kHz minimum 354 km' },
        screening_verdict: 'BELOW_ALL_SPACING_MINIMUMS',
        rule: '47 CFR §73.37 (daytime, proposed station vs. same class)',
        caveat: 'Spacing screen uses distance from current site as proxy. Actual §73.37 separation must be measured to nearest co-channel and adjacent-channel stations.'
      },
      mpe_rf_exposure_summary: {
        evaluation_required: true,
        rule: '47 CFR §1.1307 / OET Bulletin 65 §3.B',
        frequency_mhz: 0.78,
        near_field_boundary_m: 61.12,
        mpe_limit_mw_cm2: 0.0020,
        far_field_exclusion_m: 44.7,
        recommended_fence_distance_m: 61.12,
        note: 'At 5 kW, near-field boundary (λ/2π) dominates. Fence at ≥62 m from base of antenna.'
      },
      power_efficiency_metrics: {
        tpo_kw: 5,
        people_per_kw: 23100,
        km2_per_kw: 733,
        col_coverage_pct_per_kw: 19.4,
        efficiency_tier: 'HIGH',
        note: 'At 5 kW TPO: ~23,100 people/kW, 733 km²/kW service area (national avg density proxy)'
      },
      nighttime_classification: {
        eligibility: 'RESTRICTED',
        nif_complexity: 'VERY_HIGH',
        protection_class: 'Clear channel — Class A dominant (§73.25)',
        key_constraint: '780 kHz is a §73.25 clear channel. Class D secondaries restricted at night; skywave interference to WJR (Class A) dominates NIF analysis.',
        nighttime_power_max_kw: 0.5,
        nif_study_required: true,
        rule: '47 CFR §73.182 / §73.25'
      },
      da_gain_potential: { applicable: false, reason: 'Already ≥100% NDA COL coverage — DA not needed for §73.24(i)' },
      site_viability_summary: {
        go_no_go: 'GO', confidence: 'PROMISING',
        one_line: 'Meets §73.24(i) COL floor (97%) and §73.24(g) blanket limit at current TPO.',
        evaluated_at_tpo_kw: 5
      },
      tower_cost_estimate: {
        tower_height_m: 96.15, asr_lighting_required: true, cost_tier: 'MODERATE',
        total_low_usd: 164000, total_high_usd: 404000,
        range_label: '$164k–$404k (2024 USD, screening only)',
        breakdown: {
          tower_steel:   { low: 5000,   high: 15000,  note: 'Guyed λ/4 monopole at 96 m' },
          ground_system: { low: 80000,  high: 120000, note: '120-radial copper; σ=8 mS/m soil factor' },
          faa_lighting:  { low: 20000,  high: 60000,  note: 'ASR threshold exceeded (47 CFR §17.7)' },
          civil_work:    { low: 50000,  high: 150000, note: 'Grading, access road, fence, foundation' }
        },
        disclaimer: 'SCREENING ESTIMATE ONLY.'
      },
      coverage_overlap_analysis: {
        candidate_reach_km: 34.1, current_site_reach_km_proxy: 28.5,
        tower_separation_km: 6.2, overlap_area_km2: 2256,
        overlap_fraction: 0.87, coverage_continuity: 'HIGH',
        note: 'Screening-grade 2-circle model using same TPO.',
        rule: '§73.24 service area continuity.'
      },
      seasonal_conductivity_note: {
        sigma_msm: 8, sigma_quality: 'EXCELLENT', seasonal_variability: 'LOW',
        risk_level: 'MINIMAL',
        notes: ['High-conductivity soil (σ=8 mS/m) — seasonal moisture variation is modest (±10–20%) and unlikely to affect §73.24(i) compliance.',
                'Annual-average FCC M3 value is a reliable proxy for filing-grade conductivity at this site.'],
        rule: '47 CFR §73.190', disclaimer: 'Seasonal variability is a screening-grade proxy.'
      },
      antenna_height_options: {
        frequency_khz: 780, full_wavelength_m: 384.62, reference_tpo_kw: 5,
        options: [
          { id: '5_8_LAMBDA', label: '5/8 λ (optimum)', electrical_deg: 225, height_m: 240.39, height_ft: 788, gain_vs_qw_db: 1.7, erp_vs_tpo_ratio: 1.48, estimated_erp_kw: 7.4, asr_required: true, pros: '~1.7 dB ERP gain over λ/4; maximum groundwave efficiency.', cons: 'Taller physical structure; always triggers §17.7 ASR + FAA study.' },
          { id: 'QUARTER_WAVE', label: 'λ/4 (standard)', electrical_deg: 90, height_m: 96.15, height_ft: 315, gain_vs_qw_db: 0.0, erp_vs_tpo_ratio: 1.0, estimated_erp_kw: 5.0, asr_required: true, pros: 'Industry standard; FCC groundwave curves calibrated to λ/4 reference.', cons: 'Not maximum efficiency. Exceeds ASR threshold (200 ft = 60.96 m).' },
          { id: '0_19_LAMBDA', label: '0.19 λ (compact)', electrical_deg: 68, height_m: 73.08, height_ft: 240, gain_vs_qw_db: -3.0, erp_vs_tpo_ratio: 0.5, estimated_erp_kw: 2.5, asr_required: true, pros: 'Lower steel cost. Useful for DA-in, series-capacitor base tuning.', cons: '~3 dB ERP penalty vs. λ/4; requires larger ground system.' }
        ],
        note: 'Efficiency figures are engineering approximations from FCC R-4 table.'
      },
      population_reach_bands: {
        bands: [
          { target_mvm: 5.0,  label: '5 mV/m (§73.24(i) principal community)', distance_km: 5.8,  area_km2: 105.7,  estimated_population: 179690 },
          { target_mvm: 2.0,  label: '2 mV/m (urban fringe / primary coverage)', distance_km: 11.2, area_km2: 394.1, estimated_population: 669970 },
          { target_mvm: 1.0,  label: '1 mV/m (rural primary)', distance_km: 19.4, area_km2: 1183.8, estimated_population: 2012460 },
          { target_mvm: 0.5,  label: '0.5 mV/m (§73.24 secondary daytime)', distance_km: 34.1, area_km2: 3656.5, estimated_population: 6212050 },
          { target_mvm: 0.25, label: '0.25 mV/m (fringe / distant secondary)', distance_km: 56.8, area_km2: 10137.2, estimated_population: 17233240 }
        ],
        note: 'Screening-grade circular-area population estimate.'
      },
      power_upgrade_analysis: {
        applicable: true, current_tpo_kw: 5, max_class_power_kw: 50,
        headroom_kw: 45, headroom_pct: 900,
        col_coverage_estimate_at_max_pct: 100, reach_at_max_class_power_km: 78.4,
        col_would_comply_at_max: true,
        blanket_concern_at_max: { blanket_1000mvm_km: 2.3, estimated_blanket_pop_pct: 0.8, would_exceed_limit: false },
        verdict: 'UPGRADE_RESOLVES_COL',
        note: 'Class D ceiling is 50 kW (+45 kW / +900% over current TPO).'
      },
      directional_antenna_study_guide: {
        recommended: true,
        primary_reason: 'CLEAR_CHANNEL_SECONDARY_NIGHTTIME',
        study_type: 'DA_N_NIGHTTIME_ONLY',
        triggers: [
          {
            trigger: 'CLEAR_CHANNEL_SECONDARY_NIGHTTIME',
            detail: 'Secondary Class D on clear channel 780 kHz. DA-N (nighttime directional) almost always required to protect dominant WJR Class A skywave contours at night.',
            cfr: '47 CFR §73.25 / §73.182'
          }
        ],
        key_constraints: [
          'DA-N pattern must protect Class A dominant\'s 0.5 mV/m and 25 µV/m contours.',
          '§73.150(a): horizontal pattern filed in 5° increments (72 tabulated values, 0°–355°).',
          'Typical AM DA array: 2–4 tower elements; ground system must be extended to all towers.'
        ],
        pattern_radials_required: 72,
        additional_engineering_weeks_min: 8,
        additional_engineering_weeks_max: 16,
        note: 'Commission a DA N NIGHTTIME ONLY study before filing. DA engineering adds 8–16 weeks; budget for multiple antenna modeling iterations.',
        rule: '47 CFR §73.150'
      },
      skywave_protection_advisory: {
        advisory_level: 'HIGH',
        nif_required: true,
        nif_study_type: '§73.182 full azimuthal skywave NIF (1° bearings, standard skip-zone increments, OET-72 methodology)',
        protected_contour_25uvm_est_km: 120.21,
        groundwave_05mvm_est_km: 34.1,
        advisory_items: [
          'Secondary Class D on clear channel 780 kHz: must not INCREASE nighttime interference to dominant WJR Class A station\'s 0.5 mV/m groundwave AND 25 µV/m skywave contours.',
          'The §73.182 NIF must demonstrate interference is not materially increased from the current authorized site — this is a delta comparison, not an absolute limit.',
          'Clear-channel secondary NIF requires 1° azimuthal resolution (360 bearings × standard skip-distance increments).'
        ],
        key_risk: 'Secondary on §73.25 clear channel — must not increase interference to Class A dominant\'s protected contours (0.5 mV/m groundwave / 25 µV/m skywave)',
        treaty_factor: null,
        rule: '47 CFR §73.25 / §73.182'
      },
      ground_system_design_specification: {
        frequency_khz: 780, sigma_msm: 8, soil_resistivity_ohm_m: 125, quarter_wave_m: 96.2,
        ideal_radial_length_m: 96.2, practical_radial_length_m: 96.2, min_radial_length_m: 48.1,
        standard_design: {
          n_radials: 120, radial_length_m: 96.2, wire_gauge: '#8 AWG (3.26 mm diameter, ~8.3 Ω/km)',
          burial_depth_mm: 150, R_g_estimated_ohm: 2.2, efficiency_pct: 94.3,
          efficiency_tier: 'EXCELLENT (≥90%)', area_required_ha: 29.1
        },
        extended_design: {
          n_radials: 180, radial_length_m: 144.3, wire_gauge: '#8 AWG (3.26 mm diameter, ~8.3 Ω/km)',
          burial_depth_mm: 150, R_g_estimated_ohm: 1.0, efficiency_pct: 97.3,
          note: 'Extended design recommended for σ < 5 mS/m or when §73.190 efficiency certification targets >90%'
        },
        minimum_design: {
          n_radials: 60, radial_length_m: 48.1,
          note: 'Minimum emergency design — ~10% efficiency loss vs. standard. Acceptable for temporary operation only.'
        },
        recommended_design: 'standard', soil_quality_tier: 'GOOD',
        note: 'Ground system design per NBS Technical Note 24 (Terman formula for R_g) and FCC §73.190 efficiency certification guidelines.'
      },
      noise_floor_estimate: {
        frequency_khz: 780,
        atmospheric_noise_fa_db: 71.1,
        man_made_noise_fa_db: { rural: 51.4, residential: 61.4, urban: 71.4 },
        galactic_noise_fa_db: 48.7,
        dominant_source: 'ATMOSPHERIC',
        noise_tier: 'HIGH_NOISE',
        required_field_for_30db_snr_mvm: 0.04,
        reference: 'ITU-R P.372-15 (2021) Table I / Figure 4 — median noise figure for continental mid-latitude, summer daytime. Actual noise floor varies ±15–20 dB seasonally and by local EMI environment.',
        note: 'Noise floor estimate is a screening-grade planning tool. Commission a site noise survey (spectrum analyzer, directional null antenna) to characterize actual ambient noise before final site selection.'
      },
      regulatory_gate_summary: {
        overall_verdict: 'CONDITIONAL', overall_note: '4 gate(s) require additional studies — site is viable pending engineering work.',
        fail_count: 0, warn_count: 4,
        gates: [
          { id: 'COL_COVERAGE', label: '§73.24(i) COL 5 mV/m coverage', status: 'PASS', value: '97% (need ≥80%)', rule: '47 CFR §73.24(i)', note: null },
          { id: 'BLANKET_POP', label: '§73.24(g) blanket population <1%', status: 'PASS', value: '0.5% (max 1%)', rule: '47 CFR §73.24(g)', note: null },
          { id: 'ASR_REGISTRATION', label: '§17.7 ASR tower registration', status: 'WARN', value: 'λ/4 ≈ 96 m (threshold 60.96 m)', rule: '47 CFR §17.7', note: 'FCC Form 854 + FAA aeronautical study (7460-1) required before construction.' },
          { id: 'RF_EXPOSURE_MPE', label: '§1.1307 RF exposure (MPE) evaluation', status: 'WARN', value: 'Near-field boundary λ/(2π) ≈ 61 m', rule: '47 CFR §1.1307 / OET Bulletin 65', note: 'OET-65 near-field evaluation required — fence at ≥61 m from antenna base.' },
          { id: 'TREATY_COORDINATION', label: 'International treaty zone', status: 'PASS', value: 'None detected', rule: 'US/MX AM Agreement (1986)', note: null },
          { id: 'NIGHTTIME_NIF', label: '§73.182 nighttime NIF study', status: 'WARN', value: 'Required at any new site', rule: '47 CFR §73.182', note: 'NIF study must demonstrate no increase in nighttime interference from authorized site.' },
          { id: 'DA_PATTERN', label: '§73.150 directional antenna pattern (AM)', status: 'WARN', value: 'DA-N study recommended (clear channel secondary)', rule: '47 CFR §73.150', note: 'Clear channel secondary status requires DA-N nighttime directional pattern.' }
        ]
      },
      transmission_line_analysis: {
        frequency_khz: 780, tpo_kw: 5, assumed_run_m: 60,
        feedline_options: [
          { id: 'EIA_7_8_IN', label: 'EIA 7/8" coax', atten_db_per_100m: 0.32, total_loss_db_at_60m: 0.19, erp_at_antenna_kw: 4.79 },
          { id: 'EIA_1_5_8_IN', label: 'EIA 1-5/8" coax', atten_db_per_100m: 0.18, total_loss_db_at_60m: 0.11, erp_at_antenna_kw: 4.87 },
          { id: 'EIA_3_1_8_IN', label: 'EIA 3-1/8" coax', atten_db_per_100m: 0.10, total_loss_db_at_60m: 0.06, erp_at_antenna_kw: 4.93 },
          { id: 'OPEN_WIRE', label: 'Open wire (600 Ω)', atten_db_per_100m: 0.03, total_loss_db_at_60m: 0.02, erp_at_antenna_kw: 4.98 }
        ],
        recommended_feedline_id: 'EIA_7_8_IN',
        recommendation_rationale: 'At TPO ≤ 25 kW, EIA 7/8" coax provides excellent efficiency with manageable cost and installation complexity.',
        note: 'Attenuation computed from skin-effect formula (A_cond×√f + A_diel×f) at 0.780 MHz, 60 m assumed run.'
      },
      antenna_base_impedance: {
        frequency_khz: 780, sigma_msm: 5, quarter_wave_m: 96.2, N_radials: 120,
        quarter_wave: { R_r_ohm: 36.6, R_g_standard_ohm: 7.8, R_total_ohm: 44.4, efficiency_standard_pct: 82.4, R_g_extended_ohm: 3.4, efficiency_extended_pct: 91.5 },
        five_eighths_wave: { R_r_ohm: 49.8, X_base_j: 45, note: 'Matching network required to cancel +j45 Ω reactance' },
        base_reactance_table: [
          { height_label: 'λ/4 (electrical 90°)', X_base_j: 0, notes: 'Purely resistive — simplest matching' },
          { height_label: '5/8λ (electrical 225°)', X_base_j: 45, notes: 'Inductive — series cap or shunt network required' },
          { height_label: '0.19λ (electrical 68°)', X_base_j: -150, notes: 'Capacitive — series inductor required' }
        ],
        matching_network_complexity: 'LOW — λ/4 tower presents near-unity VSWR to 50 Ω transmitter output; base ATU rarely required beyond coarse trimming.',
        design_note: 'Standard 120-radial ground system at 96 m length achieves ~82% radiation efficiency at σ=5 mS/m. Extending to 180 radials (144 m) gains ~9 pts efficiency.'
      },
      permit_and_engineering_cost_estimate: {
        cost_tier: 'HIGH',
        range_label: '$58,000 – $117,000',
        total_soft_cost_low_usd: 58000, total_soft_cost_high_usd: 117000,
        line_items: [
          { item: 'FCC_FORM_301', label: 'FCC Form 301-AM application fee', cost_low_usd: 1380, cost_high_usd: 1380 },
          { item: 'FCC_FORM_302', label: 'FCC Form 302-AM license fee', cost_low_usd: 690, cost_high_usd: 690 },
          { item: 'FCC_FORM_854_ASR', label: 'FCC Form 854 ASR registration (96 m > 60.96 m)', cost_low_usd: 630, cost_high_usd: 630 },
          { item: 'FAA_AERO_STUDY', label: 'FAA 7460-1 aeronautical study & marking/lighting', cost_low_usd: 4500, cost_high_usd: 9000 },
          { item: 'SOIL_RESISTIVITY_SURVEY', label: 'Soil resistivity survey (§73.190 certification)', cost_low_usd: 3500, cost_high_usd: 7000 },
          { item: 'NIF_STUDY', label: '§73.182 NIF skywave study (OET-72 / LMS)', cost_low_usd: 15000, cost_high_usd: 35000 },
          { item: 'DA_ENGINEERING', label: 'DA-N pattern modeling & §73.150 filing', cost_low_usd: 12000, cost_high_usd: 30000 },
          { item: 'RF_EXPOSURE_STUDY', label: 'RF MPE evaluation (OET Bulletin 65)', cost_low_usd: 2000, cost_high_usd: 4000 },
          { item: 'FCC_COUNSEL', label: 'Communications counsel (FCC filing oversight)', cost_low_usd: 8000, cost_high_usd: 20000 }
        ],
        note: 'Soft-cost estimate only (FCC fees, studies, engineering). Tower, land, construction excluded. 2024 USD.'
      },
      signal_propagation_profile: {
        frequency_khz: 780, tpo_kw: 5, sigma_msm: 5,
        contours: [
          { id: 'DAYTIME_5MVM',    label: '5 mV/m (city-grade / §73.24(i) COL floor)',         target_mvm: 5.0,    distance_km: 6.2,  area_km2: 120.8 },
          { id: 'DAYTIME_2MVM',    label: '2 mV/m (primary service contour)',                   target_mvm: 2.0,    distance_km: 14.1, area_km2: 624.8 },
          { id: 'DAYTIME_05MVM',   label: '0.5 mV/m (secondary daytime / §73.24 reach)',        target_mvm: 0.5,    distance_km: 34.1, area_km2: 3659 },
          { id: 'DAYTIME_01MVM',   label: '0.1 mV/m (daytime interference floor)',              target_mvm: 0.1,    distance_km: 68.5, area_km2: 14744 },
          { id: 'BLANKET_1000MVM', label: '1000 mV/m (§73.24(g) blanket contour)',              target_mvm: 1000.0, distance_km: 0.22, area_km2: 0.15 }
        ],
        skywave_25uvm_est_km: 120.2,
        note: 'Groundwave contours use FCC gwave curves (§73.184) at this σ and TPO. Skywave 25 µV/m estimate uses OET-72 textbook approximation — actual NIF requires FCC skywave propagation software.'
      },
      fcc_lms_filing_checklist: {
        fcc_class: 'D', channel_class: 'clear_channel', frequency_khz: 780, tpo_kw: 5,
        required_count: 9, conditional_count: 2, total_items: 11,
        items: [
          { id: 'LMS_FORM_301', form: 'FCC Form 301-AM', exhibit: 'Section I — Basic Engineering', status: 'REQUIRED', rule: '47 CFR §73.3533', responsible: 'Communications counsel + broadcast engineer', note: 'Primary change-of-site application. Include antenna system description, coordinates, ground system plan, and TPO.' },
          { id: 'LMS_GROUNDWAVE_STUDY', form: 'Form 301-AM — Exhibit B', exhibit: 'Groundwave field-intensity study (§73.184)', status: 'REQUIRED', rule: '47 CFR §73.183 / §73.184', responsible: 'Licensed broadcast engineer', note: 'FCC M3-zone conductivity σ=8 mS/m used for screening. Exhibit B requires groundwave distance/field table at compass bearings per §73.184.' },
          { id: 'LMS_COL_EXHIBIT', form: 'Form 301-AM — Exhibit C', exhibit: 'Principal community (COL) 5 mV/m coverage certification', status: 'REQUIRED', rule: '47 CFR §73.24(i)', responsible: 'Licensed broadcast engineer', note: 'Demonstrate ≥80% of principal community (97% estimated at screening) is covered by the 5 mV/m daytime groundwave contour.' },
          { id: 'LMS_BLANKET_POP', form: 'Form 301-AM — Exhibit D', exhibit: 'Blanket interference (§73.24(g)) population study', status: 'REQUIRED', rule: '47 CFR §73.24(g)', responsible: 'Licensed broadcast engineer', note: '1000 mV/m contour population must be <1% of service-area population. Current screen: 0.4%.' },
          { id: 'LMS_MPE_STUDY', form: 'Form 301-AM — Exhibit E', exhibit: 'RF exposure (MPE) evaluation (OET Bulletin 65 / §1.1307)', status: 'REQUIRED', rule: '47 CFR §1.1307', responsible: 'Licensed broadcast engineer', note: 'Near-field boundary λ/(2π) ≈ 61 m at 780 kHz. Fence distance and restricted-zone perimeter must be documented.' },
          { id: 'LMS_NEPA', form: 'Form 301-AM — NEPA Checklist', exhibit: 'NEPA environmental review (§1.1306)', status: 'REQUIRED', rule: '47 CFR §1.1306 / §1.1307', responsible: 'Environmental consultant + counsel', note: 'Complete 13-item §1.1306 checklist. File EA if any trigger applies.' },
          { id: 'LMS_ASR_FORM_854', form: 'FCC Form 854 (ASR)', exhibit: 'Antenna Structure Registration', status: 'REQUIRED', rule: '47 CFR §17.7', responsible: 'Tower owner / communications counsel', note: 'λ/4 ≈ 96.2 m exceeds 200 ft (60.96 m) §17.7 threshold. Form 854 + FAA Form 7460-1 required before construction. FAA review can take 45–90 days.' },
          { id: 'LMS_NIGHTTIME_NIF', form: 'Form 301-AM — Exhibit F / NIF Study', exhibit: '§73.182 nighttime interference field (NIF) study', status: 'REQUIRED', rule: '47 CFR §73.182', responsible: 'Licensed broadcast engineer (skywave)', note: 'Clear channel Class D — full §73.182 NIF required at 1° azimuthal resolution (OET-72). New site must not increase interference to dominant Class A protected contours.' },
          { id: 'LMS_DA_PATTERN', form: 'Form 301-AM — Exhibit G / §73.150(a) pattern table', exhibit: 'Directional antenna (DA) horizontal pattern', status: 'REQUIRED', rule: '47 CFR §73.150', responsible: 'Licensed broadcast engineer (antenna)', note: '§73.150(a): horizontal pattern in 5° increments (72 tabulated values, 0°–355°). DA pattern must be modeled with moment-method software; physical proof required after construction.' },
          { id: 'LMS_TREATY_COORD', form: 'FCC IB coordination letter', exhibit: 'International treaty coordination', status: 'INFORMATIONAL', rule: 'US/MX AM Agreement (1986); US/CA LOU (1991)', responsible: 'FCC International Bureau + counsel', note: 'No treaty zone detected at screening. Verify actual site coordinates against NAFTA coordination zone boundaries if site moves.' },
          { id: 'LMS_FORM_302', form: 'FCC Form 302-AM', exhibit: 'License application after construction', status: 'REQUIRED', rule: '47 CFR §73.3536', responsible: 'Communications counsel', note: 'File after construction and proof of performance per §73.154. License completes the site change authorization.' }
        ],
        note: 'Screening-grade LMS filing sequence. FCC form numbers, exhibits, and rule cites current as of 2024. Consult FCC communications counsel before filing; LMS item requirements may change.'
      },
      seasonal_propagation_summary: {
        frequency_khz: 780, annual_avg_sigma_msm: 8,
        contours: [
          { season: 'SUMMER_DRY',  label: 'Summer (dry)',     sigma_msm: 6.8, sigma_factor: 0.85, daytime_reach_05mvm_km: 31.4, col_5mvm_dist_km: 5.4 },
          { season: 'ANNUAL_AVG',  label: 'Annual average',   sigma_msm: 8.0, sigma_factor: 1.00, daytime_reach_05mvm_km: 34.1, col_5mvm_dist_km: 5.8 },
          { season: 'SPRING_PEAK', label: 'Spring (wet)',      sigma_msm: 8.8, sigma_factor: 1.10, daytime_reach_05mvm_km: 36.1, col_5mvm_dist_km: 6.1 },
          { season: 'WINTER_PEAK', label: 'Winter (max wet)', sigma_msm: 9.2, sigma_factor: 1.15, daytime_reach_05mvm_km: 37.5, col_5mvm_dist_km: 6.3 }
        ],
        daytime_reach_variation_km: 6.1,
        daytime_reach_variation_pct: 17.9,
        col_compliance_risk_tier: 'LOW',
        col_risk_note: 'GOOD conductivity — seasonal variation is unlikely to threaten §73.24(i) COL compliance.',
        reference: 'Seasonal conductivity variation factors are screening-grade proxies from NTIA 84-136 / FCC §73.190 guidance.',
        note: 'Seasonal propagation summary is a planning tool only. All §73.24(i) compliance determinations must use FCC-approved groundwave software with measured soil data.'
      },
      fcc_class_power_ceiling_analysis: {
        fcc_class: 'D', current_tpo_kw: 5, class_power_ceiling_kw: 50,
        headroom_kw: 45, headroom_pct: 90, power_utilization_pct: 10,
        utilization_tier: 'LOW_UTILIZATION',
        reach_at_ceiling_km: 88.2, col_dist_at_ceiling_km: 14.1,
        blanket_1000mvm_at_ceiling_km: 1.61, blanket_risk_at_ceiling: 'MODERATE',
        min_tpo_for_col_kw: null,
        upgrade_path: [
          'Engineering study (§73.183 groundwave + §73.24(g) blanket re-evaluation)',
          'Amended Form 301-AM with updated COL coverage exhibit',
          '§73.182 NIF study update (re-evaluate nighttime skywave at new power)',
          'New RF exposure (MPE) evaluation at higher ERP (OET Bulletin 65)',
          'Consider blanket interference (§73.24(g)) risk — larger 1000 mV/m contour'
        ],
        upgrade_feasibility: 'SIGNIFICANT',
        note: 'Class D ceiling is 50 kW (§73.21). Current TPO is 5 kW (10% of ceiling). 45 kW headroom available. Power increase requires amended Form 301-AM.'
      },
      technical_proof_guide: {
        frequency_khz: 780, fcc_class: 'D', antenna_mode: 'DA', is_local_channel: false,
        quarter_wave_m: 96.2, near_field_boundary_m: 61, n_proof_radials: 72,
        estimated_field_days: [3, 5],
        measurements: [
          { id: 'BASE_CURRENT', label: 'Antenna base current reading', rule: '47 CFR §73.154(a)', instrument: 'Thermocouple ammeter at antenna base', notes: 'Read base current at licensed TPO. Record as reference for monitor-point calibration.' },
          { id: 'GROUND_RESISTANCE', label: 'Antenna base resistance (§73.190)', rule: '47 CFR §73.190', instrument: 'RF bridge or vector impedance meter at antenna base', notes: 'Measure input impedance and radiation resistance at 780 kHz. Ground system must show R_ground ≤ design spec.' },
          { id: 'FI_RADIAL_NDA', label: 'Pattern proof — all authorized radials', rule: '47 CFR §73.154', instrument: 'Calibrated FCC field-intensity meter with λ/4 whip', notes: 'DA pattern: measure all azimuthal radials specified in authorized DA pattern, plus 8 orthogonal radials for verification. §73.154 requires submission of measured DA pattern vs. theoretical §73.150 authorization.' },
          { id: 'INVERSE_DISTANCE_FIELD', label: 'Inverse-distance field (IDF) at 1 km', rule: '47 CFR §73.154(b)', instrument: 'Derived from FI traverse measurements', notes: 'For each radial, plot field × distance vs. distance to extract IDF at 1 km.' },
          { id: 'MPE_NEAR_FIELD', label: 'RF exposure near-field boundary verification (OET-65)', rule: '47 CFR §1.1310 / OET Bulletin 65', instrument: 'Broadband RF field meter calibrated at MF', notes: 'Verify that the general-population MPE is not exceeded beyond the 61 m near-field boundary.' },
          { id: 'ANTENNA_EFFICIENCY', label: 'Antenna radiation efficiency calculation (§73.190)', rule: '47 CFR §73.190', instrument: 'Derived from IDF + base impedance measurements', notes: 'Efficiency η = R_r / (R_r + R_g). For 120-radial system: target η ≥ 85%.' },
          { id: 'MONITOR_POINT', label: 'DA monitor point measurement (§73.158 / §73.62)', rule: '47 CFR §73.158 / §73.62', instrument: 'Calibrated FI meter at FCC-specified monitor point location', notes: 'Clear channel Class D with DA-N pattern: the authorized DA monitor point must be measured at reference field.' }
        ],
        nda_radial_plan: null,
        filing_trigger: 'FCC Form 302-AM (license to cover) must be filed within 3 years of CP grant date (§73.3536; §73.3598). Proof measurements must be complete before 302-AM is submitted.',
        reference: '47 CFR §73.154 (proof of performance); §73.190 (antenna efficiency); §73.150(a) (DA pattern measurements); OET Bulletin 65.',
        note: 'This is a screening-grade proof guide. Actual proof methodology must be coordinated with the licensed broadcast engineer of record and FCC counsel before construction.'
      },
      site_acquisition_checklist: {
        frequency_khz: 780, fcc_class: 'D', lat: 34.91, lon: -111.79,
        quarter_wave_m: 96.2, min_parcel_radius_m: 105.8, min_parcel_area_ha: 3.52,
        asr_required: true, treaty_zone_present: false,
        critical_count: 4, high_count: 5, total_items: 11,
        items: [
          { id: 'ZONING_VERIFICATION', category: 'Zoning & Land Use', priority: 'CRITICAL', action: 'Verify county/municipal zoning classification permits telecommunications tower and broadcast facility', what_to_check: 'Contact Yavapai County planning; AM towers may require conditional use permit.', timeline_weeks: [2, 6], notes: 'AM tower at 96 m may exceed local height limits — confirm variance process.' },
          { id: 'TITLE_SEARCH', category: 'Title & Encumbrances', priority: 'CRITICAL', action: 'Commission title search and title insurance for parcel', what_to_check: 'Easements, deed restrictions, mineral rights. Buried utility easements in ground system area must be documented.', timeline_weeks: [2, 4], notes: null },
          { id: 'PARCEL_SIZE_ADEQUACY', category: 'Physical Requirements', priority: 'CRITICAL', action: 'Verify parcel ≥ 3.52 ha for 96.2-m radial system (min ~106 m radius)', what_to_check: 'Map all fence lines and structures within 106 m of proposed tower base.', timeline_weeks: [1, 2], notes: null },
          { id: 'ASR_COORD_AIRPORT', category: 'FAA & ASR', priority: 'CRITICAL', action: 'File FAA Form 7460-1 aeronautical study — λ/4 tower (96.2 m) exceeds §17.7 200-ft threshold', what_to_check: 'Identify airports within 20 km. Pre-screen at FAA OE/AAA online tool.', timeline_weeks: [6, 16], notes: 'FAA review can take 45–90 days.' },
          { id: 'NEPA_DESKTOP_REVIEW', category: 'Environmental', priority: 'HIGH', action: 'Complete NEPA §1.1306 13-item environmental desktop checklist', what_to_check: 'Floodplain, wetlands, protected species, historic properties, wilderness.', timeline_weeks: [2, 6], notes: 'Yavapai County has high potential for archaeological sites — allow extra time for SHPO review.' },
          { id: 'NHPA_SECTION_106', category: 'Environmental', priority: 'HIGH', action: 'Initiate NHPA §106 historic properties review with Arizona SHPO', what_to_check: 'APE within 192 m of proposed tower. Run SHPO consultation if historic properties within APE.', timeline_weeks: [4, 16], notes: null },
          { id: 'UTILITY_ACCESS', category: 'Utilities & Infrastructure', priority: 'HIGH', action: 'Confirm electrical service availability (3-phase preferred)', what_to_check: 'Identify nearest transformer. Estimate service extension cost.', timeline_weeks: [2, 4], notes: null },
          { id: 'LEASE_TERM', category: 'Lease & Legal', priority: 'HIGH', action: 'Negotiate minimum 20-year lease with renewal options; include FCC CP approval contingency', what_to_check: 'CP grant typically 1–3 years. Lease must survive filing delay.', timeline_weeks: [4, 12], notes: null },
          { id: 'SETBACKS_GUYWIRES', category: 'Physical Requirements', priority: 'HIGH', action: 'Verify guy wire anchors can be placed at 77–96 m from tower base', what_to_check: 'Standard guyed λ/4 monopole uses 3 guy sets. Each anchor needs 5–10 m clearance from property line.', timeline_weeks: [1, 2], notes: null },
          { id: 'ACCESS_ROAD', category: 'Utilities & Infrastructure', priority: 'MEDIUM', action: 'Verify legal access road and easement — crane truck access required', what_to_check: 'Confirm all-weather road ≥4 m wide to tower base.', timeline_weeks: [1, 3], notes: null },
          { id: 'TREATY_SETBACK', category: 'Regulatory', priority: 'INFORMATIONAL', action: 'Verify site is outside international treaty coordination zone', what_to_check: 'No treaty zone detected at screening. Verify final coordinates.', timeline_weeks: [1, 2], notes: null }
        ],
        note: 'Site acquisition checklist is a screening-grade planning guide only. Consult real estate attorney, licensed broadcast engineer, and FCC counsel before executing any land agreement.'
      },
      spectrum_interference_summary: {
        frequency_khz: 780, fcc_class: 'D', channel_class: 'clear_channel',
        is_clear_channel: true, is_local_channel: false,
        tpo_kw: 5, sigma_msm: 8,
        protected_contour_mvm: 5.0, protected_contour_radius_km: 14.3,
        daytime_secondary_reach_km: 38.7, reach_1_mvm_km: 22.1, reach_5_mvm_km: 14.3,
        interference_risk_tier: 'HIGH',
        risk_note: '780 kHz is a §73.25 clear channel. Dominant Class A protection rights create the largest interference footprint; §73.182 skywave NIF study required.',
        adjacent_clear_channels_khz: [],
        separation_rules: [
          { relationship: 'CO_CHANNEL', offset_khz: 0, description: 'Same frequency (0 kHz offset)', protected_field_mvm: 5.0, this_station_protected_radius_km: 14.3, screening_note: 'Any co-channel station whose protected contour overlaps this site must be evaluated. Typical co-channel separation: 28.6–57.2 km from Class B/D secondaries.' },
          { relationship: 'FIRST_ADJACENT', offset_khz: 10, description: 'Adjacent channel (±10 kHz offset)', protected_field_mvm: 10.0, this_station_protected_radius_km: 8.9, screening_note: '§73.182 1st-adjacent: interfering station field must not exceed 50% of the protected station protected-contour field at that boundary. Separation 30–60% of co-channel requirement.' },
          { relationship: 'SECOND_ADJACENT', offset_khz: 20, description: 'Second adjacent channel (±20 kHz offset)', protected_field_mvm: 30.0, this_station_protected_radius_km: 3.2, screening_note: '§73.182 2nd-adjacent: less restrictive; I/D field ratio limits apply. Typically 15–25 km separation from Class A/B at standard power.' }
        ],
        full_study_required: true, nighttime_nif_required: true,
        study_database: 'FCC AM Query — pull all co-channel and ±10/20 kHz stations within 2× protected contour radius from candidate coordinates',
        reference: '47 CFR §73.182; §73.25–73.27; §73.21; OET Bulletin 73',
        note: 'Screening-grade interference self-profile. No actual station database lookup performed. Full §73.182 analysis by licensed broadcast engineer required using FCC LMS/AM Query data before any CP filing.'
      },
      colocation_compatibility_score: {
        frequency_khz: 780, fcc_class: 'D', tpo_kw: 5, quarter_wave_m: 96.2, blanket_1000mvm_km: 0.31,
        best_host_type: 'AM_SITE', best_host_score: 85, best_host_tier: 'GOOD',
        diplexing_always_required: true,
        host_scores: [
          { host_type: 'AM_SITE', label: 'Existing AM Tower Farm', score: 85, compatibility_tier: 'GOOD',
            benefits: ['Existing radial ground system may be shareable (§73.190 engineering review required)', 'Experienced AM site operator; FCC ASR likely already registered'],
            risks: ['Diplexing filter required (§73.1675) — adds $15–60k to project; potential intermodulation products', 'Clear channel: nighttime skywave from host station may complicate §73.182 NIF analysis'] },
          { host_type: 'FM_TX', label: 'FM Transmitter Site', score: 70, compatibility_tier: 'FAIR',
            benefits: ['FM transmitter sites often have large parcels with ground system space', 'AM and FM bands have large separation — minimal direct RF coupling'],
            risks: ['FM antenna tower may not be suitable for AM base-fed monopole — structural review required', 'FM transmitters generate harmonics — AM front-end must be verified clean of FM IIs'] },
          { host_type: 'CELLULAR', label: 'Cellular Tower', score: 55, compatibility_tier: 'FAIR',
            benefits: ['FAA lighting and marking often already in place; ASR typically registered', 'Site lease infrastructure exists; power and access road available'],
            risks: ['Structural analysis required — AM antenna + guy wires incompatible with self-supporting lattice towers', 'Cellular band RF from BTS equipment may couple into AM ground system (shield/filter required)'] },
          { host_type: 'WATER_TOWER', label: 'Water Tower / Tank', score: 45, compatibility_tier: 'POOR',
            benefits: ['Elevated AM antenna on water tank can improve coverage without full λ/4 tower'],
            risks: ['Water tank structure not designed for AM antenna loads — detailed structural engineering required', 'Ground radial system cannot be buried under paved/concrete municipal facility areas'] },
          { host_type: 'BUILDING_ROOFTOP', label: 'Building Rooftop', score: 20, compatibility_tier: 'POOR',
            benefits: [],
            risks: ['No buried ground radial system possible — counterpoise required with efficiency penalty', 'Building RF re-radiation and structural coupling requires extensive near-field measurements'] }
        ],
        reference: '47 CFR §73.1675; §73.182; §73.190; FCC Form 854; OET Bulletin 65',
        note: 'Compatibility scores are site-parameter-driven screening estimates. No actual infrastructure inventory lookup performed. Engage a licensed broadcast engineer for structural, RF, and lease compatibility verification before co-location commitment.'
      },
      environmental_risk_matrix: {
        frequency_khz: 780, fcc_class: 'D', lat: 34.91, lon: -111.79,
        tpo_kw: 5, quarter_wave_m: 96.2, asr_required: true,
        overall_nepa_risk: 'ELEVATED', high_risk_count: 1, elevated_risk_count: 2,
        unknown_count: 7, low_risk_count: 3,
        ea_timeline_weeks_worst_case: 24,
        ea_eligibility_note: 'EA may be required. Elevated-risk categories warrant desktop verification before concluding CE eligibility.',
        items: [
          { id: 'FLOODPLAIN', category: 'Floodplain', cfr: '47 CFR §1.1311(a)(1)', risk_level: 'UNKNOWN', description: 'FEMA FIRM floodplain overlay', verification: 'Map site at FEMA MSC (msc.fema.gov).', timeline_weeks: [1,2], action_if_triggered: 'EA required if in 100-yr floodplain.', data_sources: ['FEMA MSC'] },
          { id: 'WETLANDS', category: 'Wetlands', cfr: '47 CFR §1.1311(a)(2)', risk_level: 'UNKNOWN', description: 'Jurisdictional wetlands and NWI-mapped wetlands', verification: 'Run NWI Mapper for 500-m radius.', timeline_weeks: [2,8], action_if_triggered: 'USACE §404 permit required.', data_sources: ['USFWS NWI'] },
          { id: 'ENDANGERED_SPECIES', category: 'Threatened & Endangered Species', cfr: '47 CFR §1.1311(a)(3)', risk_level: 'ELEVATED', description: 'ESA §7 consultation', verification: 'Run USFWS IPaC for project area.', timeline_weeks: [4,24], action_if_triggered: 'Biological Opinion may be required from USFWS.', data_sources: ['USFWS IPaC'] },
          { id: 'HISTORIC_PROPERTIES', category: 'Historic Properties (NHPA §106)', cfr: '47 CFR §1.1311(a)(4)', risk_level: 'HIGH', description: 'NHPA §106 — APE for above-ground and archaeological resources', verification: 'Consult Arizona SHPO. Map APE within 192 m of tower.', timeline_weeks: [4,20], action_if_triggered: 'SHPO consultation required. MOA may be needed.', data_sources: ['Arizona SHPO', 'NPS NRHP Focus'] },
          { id: 'WILDERNESS', category: 'Wilderness & Wild/Scenic Areas', cfr: '47 CFR §1.1311(a)(5)', risk_level: 'UNKNOWN', description: 'Wilderness areas and Wild & Scenic Rivers', verification: 'Check proximity to Coconino National Forest wilderness areas.', timeline_weeks: [1,3], action_if_triggered: 'No construction in designated Wilderness.', data_sources: ['wilderness.net'] },
          { id: 'COASTAL_ZONE', category: 'Coastal Zone', cfr: '47 CFR §1.1311(a)(6)', risk_level: 'LOW', description: 'CZMA consistency — state CZM program', verification: 'Site in AZ interior — coastal zone does not apply.', timeline_weeks: [1,1], action_if_triggered: 'N/A for interior AZ site.', data_sources: ['NOAA CZM'] },
          { id: 'INDIAN_RELIGIOUS_SITES', category: 'Indian Religious Sites (AIRFA)', cfr: '47 CFR §1.1311(a)(7)', risk_level: 'ELEVATED', description: 'Sacred sites and tribal consultation — Yavapai County has significant tribal history', verification: 'Consult Yavapai-Prescott Tribe and Yavapai-Apache Nation. Check proximity to tribal lands.', timeline_weeks: [4,16], action_if_triggered: 'Government-to-government consultation required.', data_sources: ['BIA Tribal Directory'] },
          { id: 'SCENIC_BYWAYS', category: 'Scenic Byways / Visual Resources', cfr: '47 CFR §1.1311(a)(8)', risk_level: 'ELEVATED', description: 'Visual impact of 96-m tower visible from AZ scenic routes', verification: 'Check SR-89A (Prescott area scenic byway) viewshed proximity.', timeline_weeks: [1,4], action_if_triggered: 'Visual impact analysis required.', data_sources: ['FHWA byways'] },
          { id: 'NOISE', category: 'Noise', cfr: '47 CFR §1.1311(a)(9)', risk_level: 'LOW', description: 'Transmitter, generator, HVAC noise', verification: 'Identify residential within 200 m.', timeline_weeks: [1,2], action_if_triggered: 'Noise analysis at property line if residential nearby.', data_sources: ['Local ordinance'] },
          { id: 'CONTAMINATION', category: 'Site Contamination / Hazardous Materials', cfr: '47 CFR §1.1311(a)(10)', risk_level: 'UNKNOWN', description: 'EPA Superfund, brownfields, USTs', verification: 'Search EPA ECHO. Phase I ESA recommended.', timeline_weeks: [4,16], action_if_triggered: 'Phase II ESA if RECs found.', data_sources: ['EPA ECHO'] },
          { id: 'RF_EXPOSURE', category: 'RF Exposure (MPE)', cfr: '47 CFR §1.1307(b); OET Bulletin 65', risk_level: 'MODERATE', description: 'MPE compliance at 5 kW TPO', verification: 'Calculate near-field boundary per OET Bulletin 65.', timeline_weeks: [2,4], action_if_triggered: 'OET 65 analysis and RF safety plan required.', data_sources: ['FCC OET Bulletin 65'] },
          { id: 'GROUNDWATER', category: 'Groundwater / Sole-Source Aquifer', cfr: '47 CFR §1.1311(a)(12)', risk_level: 'UNKNOWN', description: 'EPA Sole Source Aquifer program', verification: 'Check EPA SSA viewer for site.', timeline_weeks: [1,3], action_if_triggered: 'EPA coordination if within SSA.', data_sources: ['EPA epa.gov/uic'] },
          { id: 'CUMULATIVE_IMPACTS', category: 'Cumulative Impacts', cfr: '47 CFR §1.1311(b)', risk_level: 'LOW', description: 'Combined project effects with other area actions', verification: 'Review nearby FCC applications and construction within 5 km.', timeline_weeks: [2,4], action_if_triggered: 'Cumulative analysis required in EA.', data_sources: ['FCC LMS', 'NEPA NetCast'] }
        ],
        reference: '47 CFR §1.1307–§1.1311; NEPA §102(2)(C); NHPA §106; ESA §7; CZMA; AIRFA',
        note: 'Environmental screening matrix is a desktop-level pre-assessment only. Risk levels are site-parameter-driven estimates, NOT actual GIS database results. Each item must be verified with the listed data sources by a qualified environmental professional or FCC counsel before CP filing.'
      },
      financial_feasibility_summary: {
        frequency_khz: 780, fcc_class: 'D', tpo_kw: 5, pattern_mode: 'NDA',
        quarter_wave_m: 96.2, min_parcel_area_ha: 3.52,
        total_buy_low_usd: 435000, total_buy_high_usd: 1580000,
        total_lease_yr1_low_usd: 341000, total_lease_yr1_high_usd: 1009000,
        annual_lease_low_usd: 6000, annual_lease_high_usd: 24000,
        annual_power_kwh: 24090000, annual_power_cost_usd: 28908,
        annual_operating_low_usd: 40908, annual_operating_high_usd: 102908,
        annual_revenue_est_low_usd: 250000, annual_revenue_est_high_usd: 900000,
        payback_years_optimistic: 0.4, payback_years_conservative: 11.8,
        overall_feasibility: 'SIGNIFICANT_INVESTMENT',
        line_items: [
          { id: 'LAND_PURCHASE', label: 'Land acquisition', low_usd: 80000, high_usd: 250000, note: '3.52 ha min for 90-radial ground system (105 m radius)' },
          { id: 'TOWER_CONSTRUCTION', label: 'Tower (guyed monopole)', low_usd: 80000, high_usd: 300000, note: '96.2 m guyed monopole exceeds §17.7 200-ft threshold; FAA marking/lighting adds $15–40k.' },
          { id: 'GROUND_SYSTEM', label: 'Ground system (90 radials × 87 m)', low_usd: 35000, high_usd: 100000, note: '§73.190 buried copper radial system; includes trenching and conductivity survey' },
          { id: 'TRANSMITTER', label: 'Transmitter (5 kW)', low_usd: 25000, high_usd: 100000, note: 'Primary + backup transmitters; includes installation and initial alignment' },
          { id: 'TRANSMISSION_LINE', label: 'Transmission line + ATU', low_usd: 6000, high_usd: 25000, note: 'Heliax from transmitter building to tower base + antenna tuning unit' },
          { id: 'ENGINEERING', label: 'Broadcast + structural engineering', low_usd: 20000, high_usd: 70000, note: '§73.182 NIF study, §73.154 proof design, structural PE' },
          { id: 'FCC_FILING', label: 'FCC Form 301-AM filing + fees', low_usd: 3000, high_usd: 12000, note: 'FCC application fees + FCC counsel / legal costs' },
          { id: 'ENVIRONMENTAL', label: 'NEPA/NHPA environmental', low_usd: 5000, high_usd: 30000, note: 'NEPA desktop, §106 SHPO consultation, EA if required' },
          { id: 'SITE_PREP', label: 'Site preparation', low_usd: 30000, high_usd: 120000, note: 'Grading, access road, fence, electrical service, transmitter building' },
          { id: 'CONTINGENCY', label: 'Contingency (15%)', low_usd: 26250, high_usd: 96750, note: 'Industry standard 15% contingency on hard construction costs' }
        ],
        reference: 'BIA/NRTC AM Station Cost Benchmarks (2023); FCC Form 301-AM fee schedule; IBEW/NECA construction wage data',
        note: 'All cost estimates are 2024-dollar screening-grade figures. Regional labor, material, and real estate costs vary significantly. Engage a professional broadcast engineer, real estate attorney, and financial advisor for project-specific estimates before any capital commitment.'
      },
      antenna_pattern_optimization_guide: {
        frequency_khz: 780, fcc_class: 'D', pattern_mode: 'DA-D', tpo_kw: 5,
        is_directional: true, quarter_wave_m: 96.2, wavelength_m: 384.6,
        col_bearing_deg: 212, dist_to_col_km: 3.8,
        col_required_field_mvm: 5.0, field_at_col_nda_mvm: 4.1, col_field_deficit_mvm: 0.9,
        da_recommended: 'STRONGLY_RECOMMENDED',
        da_recommended_note: 'NDA field at COL (4.1 mV/m) is below the §73.24(i) 5 mV/m floor. A DA pattern toward 212° can add 3–5 dB gain and may achieve compliance without increasing TPO.',
        element_spacing_options: [
          { spacing_label: 'λ/4', spacing_m: 96.2, spacing_deg: 90, pattern_type: 'CARDIOID', gain_over_nda_db: 3.0, note: 'Standard 2-element cardioid; deep null opposite COL; simplest to optimize' },
          { spacing_label: '3λ/8', spacing_m: 144.2, spacing_deg: 135, pattern_type: 'MODIFIED_CARDIOID', gain_over_nda_db: 3.5, note: 'Wider front lobe; reduced null depth; useful when suppression is partial' },
          { spacing_label: 'λ/2', spacing_m: 192.3, spacing_deg: 180, pattern_type: 'FIGURE_EIGHT', gain_over_nda_db: 4.8, note: 'Figure-8 pattern; two nulls; gain toward COL; high suppression at 90°/270°' }
        ],
        hrp_compliance_checklist: [
          { id: 'HRP_TABLE', item: 'Horizontal radiation pattern table at 5° increments (0°–355°)', required: true, note: '§73.150(a): full 72-radial measured pattern at 5° increments required for all AM DA stations' },
          { id: 'HRP_CONTOUR', item: 'Effective field (mV/m at 1 km) for each radial tabulated', required: true, note: '§73.150 / §73.189: inverse-distance field (EF at 1 km) computed from base currents and §73.150 pattern' },
          { id: 'SUPPRESSION_RATIO', item: 'Suppression ratios toward protected stations computed', required: true, note: '§73.37 / §73.182: D/U at interfered-with protected contour must meet AM class-separation standards' },
          { id: 'DA_LICENSE_STATUS', item: 'DA pattern must be approved via FCC Form 302-AM (license to cover)', required: true, note: '§73.3533: proof-of-performance measurements required before DA operation authorized' },
          { id: 'MONITOR_POINT', item: 'FCC-specified monitor points during DA operation', required: true, note: '§73.61/§73.62: clear-channel DA stations require FCC-specified monitoring' },
          { id: 'COL_MIN_FIELD', item: 'COL minimum field: 5.0 mV/m at 3.8 km toward 212°', required: true, note: '§73.24(i): 5 mV/m groundwave field must reach community of license. NDA estimate: 4.1 mV/m.' },
          { id: 'NIGHTTIME_DA', item: 'DA-N (nighttime) pattern separate from DA-D (daytime)', required: true, note: '§73.150(b): separate pattern authorizations for DA-D and DA-N; skywave NIF for DA-N' }
        ],
        n_checklist_required: 7,
        reference: '47 CFR §73.150; §73.152; §73.24(i); §73.37; §73.182',
        note: 'Pattern optimization guidance is screening-grade. Actual DA element positions, current ratios, and phasing must be determined by a licensed broadcast engineer using full §73.182 analysis and field measurements per §73.154.'
      },
      propagation_confidence_interval: {
        frequency_khz: 780, fcc_class: 'D', tpo_kw: 5,
        sigma_msm: 8, sigma_source: 'FCC M3 zone table', sigma_filing_grade: 'screening',
        field_uncertainty_pct: 35, reach_uncertainty_pct: 24.5, confidence_level: 'LOW',
        daytime_reach_bounds_km: { nominal: 38.7, low: 29.2, high: 48.2 },
        blanket_1000mvm_bounds_km: { nominal: 0.31, low: 0.23, high: 0.39 },
        col_field_bounds_mvm: { nominal: 4.1, low: 2.7, high: 5.5 },
        col_coverage_bounds: { nominal: 0.88, low: 0.66, high: 1.0 },
        recommended_data_upgrade: {
          action: 'RASTER',
          label: 'Load AM_m3.tif GeoTIFF for filing-grade σ',
          note: 'Zone-table σ is the primary source of uncertainty. Installing the AM_m3.tif conductivity raster cuts uncertainty from ±35% to ±18% on field strength. This is the highest-impact single upgrade for this candidate.'
        },
        reference: 'ITU-R P.527-5; FCC M3 zone table (§73.184); §73.190; OET Tech. Note 101',
        note: 'Confidence intervals are statistical estimates based on known σ source accuracy. Actual propagation may differ due to terrain, vegetation, moisture content, and near-field coupling.'
      },
      transmission_system_design_guide: {
        frequency_khz: 780, fcc_class: 'D', tpo_kw: 5, pattern_mode: 'NDA',
        quarter_wave_m: 96.2, wavelength_m: 384.6, estimated_line_length_m: 107,
        antenna_radiation_resistance_ohm: 36.6, estimated_ground_loss_ohm: 6.88,
        estimated_base_impedance_ohm: 43.48, antenna_efficiency_pct: 84.18,
        base_current_ideal_a: 11.68,
        feedline_options: [
          { type: 'HELIAX_7_8', label: '7/8" Heliax (LDF4-50A)', suitable: true, max_tpo_kw: 25, loss_db_per_100m: 0.04, approx_loss_db_this_run: 0.04, note: 'Standard choice for ≤25 kW; flexible; readily available.' },
          { type: 'RIGID_COAX_3_1_8', label: '3-1/8" rigid coax (EIA flanged)', suitable: false, max_tpo_kw: 100, loss_db_per_100m: 0.01, approx_loss_db_this_run: 0.01, note: 'Preferred for ≥25 kW; lower loss, higher power rating.' },
          { type: 'OPEN_WIRE', label: 'Open-wire transmission line', suitable: true, max_tpo_kw: 500, loss_db_per_100m: 0.01, approx_loss_db_this_run: 0.01, note: 'Very low loss; historically used for high-power AM. Rarely used in new installations.' }
        ],
        recommended_feedline: 'HELIAX_7_8',
        atu_configuration_note: 'NDA: standard L, T, or Pi network ATU matching feedline impedance (typically 50Ω) to tower base impedance (~43Ω). Series capacitor to resonate antenna near resonance.',
        base_current_monitor_required: true,
        base_current_monitor_note: '§73.61: licensed AM stations ≥1 kW must install base current monitors on each tower. Monitor must be readable from the transmitter control point.',
        detuning: { required: false, note: 'NDA: single-tower — detuning not required. Verify no adjacent metallic structures within ~38 m (λ/10) of tower base.' },
        reference: '47 CFR §73.61; §73.150(c); §73.190; ARRL Antenna Handbook; Andrew/Commscope heliax data',
        note: 'Transmission system design guide is a screening-grade engineering reference. All impedances, efficiencies, and current values are based on ideal monopole theory and the Terman/Belrose ground loss formula.'
      },
      operational_monitoring_requirements: {
        frequency_khz: 780, fcc_class: 'D', tpo_kw: 5, pattern_mode: 'DA-D',
        power_tolerance: { rule: '47 CFR §73.1560', tolerance: '+5% / -10% of licensed power', monitoring: 'Transmitter output power must be monitored during all periods of operation.', log_required: true, note: 'Operating power must not exceed licensed TPO by more than +5% (§73.1560(a)).' },
        base_current_monitoring: { rule: '47 CFR §73.1350 / §73.61', required: true, frequency: 'Every 3 hours (DA monitor points per §73.158)', towers: 'All towers in DA array', log_format: 'Station operating log (§73.1820)', note: 'DA station: §73.158 monitor points must be checked at least once in each 3-hour period during hours of operation.' },
        eas_requirements: { rule: '47 CFR Part 11 / §11.35', equipment: 'FCC-certified EAS decoder/encoder', test_weekly: 'Required Weekly Tests (RWT)', test_monthly: 'Required Monthly Tests (RMT)', log_required: true, note: '§11.35: All EAS participants must test and log EAS equipment at least weekly. Records maintained for 2 years.' },
        environmental_compliance: { rule: '47 CFR §1.1307 / §1.1310', rf_annual: 'Annual RF exposure self-certification required. Repeat MPE evaluation if TPO or antenna configuration changes.', nepa_ongoing: 'Report any changes that might trigger previously unevaluated environmental impacts.', note: 'Any modification may trigger a new NEPA §1.1306 screening. File amendment with FCC before making changes.' },
        license_renewal: { rule: '47 CFR §73.3539', cycle: '8-year renewal cycle (FCC Form 303-S)', filing_window: '4 months before license expiration', must_certify: ['Station has operated in compliance with FCC rules', 'No character issues', 'EEO compliance certification', 'RF exposure (MPE) remains compliant', 'Directional antenna performance has not changed materially'], note: '§73.3539: AM broadcast licenses run 8 years. Applications for renewal must be filed via LMS (FCC Form 303-S) 4 months before expiration.' },
        nighttime_power: { required: false, rule: '47 CFR §73.99', nighttime_tpo_limit_kw: 5, note: 'Class D: nighttime operation may require DA pattern per license conditions or may be prohibited. Check specific license conditions.' },
        station_log: { rule: '47 CFR §73.1820', retention_years: 2, note: '§73.1820: Station operating log must be maintained and retained for 2 years.' },
        clear_channel_obligations: { applicable: false },
        monitoring_items: [
          { id: 'power', label: 'Operating power monitoring', rule: '§73.1560', frequency: 'Continuous', critical: true },
          { id: 'base_current', label: 'Base current monitoring', rule: '§73.1350/§73.61', frequency: 'Every 3 hours (DA)', critical: true },
          { id: 'eas', label: 'EAS weekly/monthly tests', rule: 'Part 11 §11.35', frequency: 'Weekly RWT + Monthly RMT', critical: true },
          { id: 'station_log', label: 'Station operating log', rule: '§73.1820', frequency: 'Each operator check', critical: true },
          { id: 'rf_exposure', label: 'RF exposure compliance', rule: '§1.1310 / OET-65', frequency: 'Annual self-cert', critical: true },
          { id: 'renewal', label: 'License renewal filing', rule: '§73.3539', frequency: 'Every 8 years (4 months early)', critical: true }
        ],
        reference: '47 CFR §73.1560; §73.1350; §73.61; Part 11; §1.1307; §73.3539; §73.99',
        note: 'Operational monitoring requirements are a post-licensing compliance reference. Actual obligations depend on the specific license conditions granted by the FCC.'
      },
      transmitter_facility_design_guide: {
        tpo_kw: 5, transmitter_efficiency_pct: 28, ac_power_draw_kw: 17.86, total_facility_load_kw: 22.86,
        service_amps_240v: 95, recommended_service_size_a: 100,
        heat_dissipated_kw: 12.86, heat_dissipated_btu_hr: 43882, hvac_required_tons: 3.66,
        fencing: { required: true, rule: '47 CFR §73.49', minimum_height_ft: 8, material: 'Chain-link or equivalent — must prevent unauthorized access', warning_signs: 'High voltage warning signs at each entrance and at intervals not exceeding 100 feet', lock_required: 'Deadbolt or padlock; key held by licensed operator', access_gate_count: 1, estimated_perimeter_ft: 80, note: '§73.49: locked enclosure required for all AM transmitting systems > 250 W.' },
        standby_generator: { recommended: true, rating_kw: 28.58, fuel_type: 'diesel', fuel_tank_gallons: 1029, runtime_hours_72hr_load: 72, fuel_storage_requirement: 'AST_SECONDARY_CONTAINMENT', note: 'Not FCC-mandated but required for EAS §11.35 compliance continuity during utility outages.' },
        building_specs: { type: 'CONCRETE_BLOCK_OR_PREFAB', min_floor_area_sf: 120, min_ceiling_height_ft: 10, hvac_required: true, hvac_tons: 3.66, electrical_panel: '100A main breaker panel', grounding: 'Single-point ground bus to tower base per IEEE 1100', rf_shielding: 'STANDARD', exterior_finish: 'Non-combustible; meet local building code fire rating', security: '§73.49 lock + exterior motion-activated lighting recommended' },
        construction_cost_estimate_usd: { low: 83580, high: 177160 },
        reference: '47 CFR §73.49; §11.35; NEC Article 250; IEEE 1100; NFPA 110',
        note: 'Facility design guide is a screening-grade estimate. Actual requirements depend on transmitter model efficiency and local utility voltage.'
      },
      soil_conductivity_improvement_guide: {
        sigma_msm_current: 2, soil_class_current: 'FAIR', soil_resistivity_ohm_m: 500,
        improvement_needed: true, sigma_target_msm: 8,
        reach_current_km: 18.4, reach_improved_km: 65.96, reach_gain_km: 47.56,
        techniques: [
          { id: 'copper_sulfate', name: 'Copper Sulfate (CuSO₄) Solution Injection', applicable: true, description: 'Inject 2% CuSO₄ solution into soil around radial field. Improves conductivity by increasing ionic concentration.', sigma_improvement_msm_estimate: 3, cost_usd_per_acre_approx: 800, longevity_years: 2, fcc_measurable: true, note: '§73.190 allows conductivity to be measured by Wenner 4-point method. Treatment effects must be field-measured before claiming improved σ in FCC filings.' },
          { id: 'bentonite_backfill', name: 'Bentonite Clay Backfill in Radial Trenches', applicable: true, description: 'Line radial trenches with sodium bentonite slurry before laying copper.', sigma_improvement_msm_estimate: 1, cost_usd_per_acre_approx: 1200, longevity_years: 20, fcc_measurable: true, note: 'Most effective in dry or rocky soils. Permanent improvement once installed.' },
          { id: 'ground_rods', name: 'Deep-Driven Ground Rods at Radial Tips', applicable: true, description: 'Drive 8–20 ft copper-bonded rods at radial tips to reach moister subsoil.', sigma_improvement_msm_estimate: 1.6, cost_usd_per_rod_approx: 150, typical_rods_for_120_radials: 120, cost_total_approx: 18000, longevity_years: 30, fcc_measurable: true, note: 'Most cost-effective where water table is within 10 ft of surface.' },
          { id: 'ufer_grounding', name: 'Ufer (Concrete-Encased Electrode) System', applicable: true, description: "Install bare copper conductor in tower foundation concrete. Provides low-impedance ground at base of tower.", sigma_improvement_msm_estimate: 0, cost_usd_approx: 2000, longevity_years: 50, fcc_measurable: false, note: 'Improves base impedance and lightning protection but does not raise bulk soil conductivity.' },
          { id: 'soil_amendment_chemical', name: 'Ground Enhancement Material (GEM)', applicable: true, description: 'Install carbon-based GEM in radial trenches. Permanently lowers resistivity.', sigma_improvement_msm_estimate: 2, cost_usd_per_lb_approx: 3, typical_lbs_per_installation: 2000, cost_total_approx: 6000, longevity_years: 30, fcc_measurable: true, note: 'Must verify FCC-measured σ improvement per §73.190 before claiming in filings.' }
        ],
        n_applicable_techniques: 5,
        wenner_survey_protocol: { method: 'Wenner 4-electrode method (ASTM G57)', purpose: 'Measure effective soil conductivity before and after amendments for FCC §73.190 documentation', electrodes: 4, electrode_spacing_m: [5, 10, 20, 30], rule: '§73.190', filing_note: 'Measured conductivity may substitute for FCC M3 zone-table value when documented per §73.190.' },
        reference: '47 CFR §73.190; IEEE Std 81-2012; NEC §250.52; ASTM G57',
        note: 'Current soil conductivity (2 mS/m, FAIR) is below the preferred minimum (8 mS/m). Implementing soil amendment techniques could extend daytime reach by up to 47.56 km.'
      },
      license_class_upgrade_analysis: {
        fcc_class: 'D', is_clear_channel: true, is_local_channel: false,
        primary_feasibility: 'DIFFICULT', n_upgrade_paths: 1,
        upgrade_paths: [
          { from_class: 'D', to_class: 'B', feasibility: 'DIFFICULT',
            key_requirement: 'Must demonstrate Class B §73.37 spacing compliance (402 km co-channel to other Class B stations). NIF study at Class B protection level required.',
            new_power_max_kw: 50, new_protected_contour_mvm: 0.5, new_nif_study_required: true,
            nif_study_type: 'FULL_CLEAR_CHANNEL_NIF', form: 'FCC Form 301-AM (Major Change)',
            timeline_months_optimistic: 18, timeline_months_conservative: 36,
            filing_fee_usd_approx: 6465, engineering_cost_usd_approx_low: 15000, engineering_cost_usd_approx_high: 50000,
            note: 'Class D→B upgrade is a major modification. Must demonstrate Class B §73.37 spacing in all directions.' }
        ],
        upgrade_filing_steps: [
          { step: 1, action: 'Engineering study', detail: 'Full §73.37 spacing analysis at the TARGET class. Spacing failure ends the process.', estimated_days: 15 },
          { step: 2, action: 'NIF study', detail: '§73.182 skywave NIF at the new class protection level.', estimated_days: 30 },
          { step: 3, action: 'Form 301-AM preparation', detail: 'Major change application: Schedule A (legal), B (antenna), C (transmitter), D (coverage), E (environmental).', estimated_days: 20 },
          { step: 4, action: 'FCC filing', detail: 'File via LMS. Pay required application fee (see FCC Schedule of Application Fees). Assigned to Audio Division.', estimated_days: 1 },
          { step: 5, action: 'FCC processing', detail: 'Typically 12–24 months. Staff may issue letter of inquiry.', estimated_days: 365 },
          { step: 6, action: 'Construction permit', detail: 'CP issued; 3-year build period. File Form 302-AM after proof of performance.', estimated_days: 90 }
        ],
        reference: '47 CFR §73.21; §73.37; §73.25; §1.401; §73.3571',
        note: 'License class upgrade analysis is a regulatory screening guide. Consult an FCC communications attorney before initiating proceedings.'
      },
      spacing_rule_compliance_guide: {
        fcc_class: 'D', frequency_khz: 780, channel_class: 'clear_channel',
        spacing_risk_tier: 'VERY_HIGH',
        spacing_risk_note: 'Secondary Class D on clear channel 780 kHz: must maintain enormous spacing from the dominant Class A and from other co-channel secondaries. Each clear-channel domestic secondary assignment is individually negotiated.',
        spacing_table: [
          { to_class: 'A', cc_km: 1610, fa_km: 402, sa_km: 178, from_class: 'D', co_channel_freq: 780 },
          { to_class: 'B', cc_km:  402, fa_km: 322, sa_km: 177, from_class: 'D', co_channel_freq: 780 },
          { to_class: 'C', cc_km:  322, fa_km: 161, sa_km:  97, from_class: 'D', co_channel_freq: 780 },
          { to_class: 'D', cc_km:  402, fa_km: 322, sa_km: 177, from_class: 'D', co_channel_freq: 780 }
        ],
        verification_checklist: [
          { id: 'cc_query', item: 'Co-channel (780 kHz) station database query', action: 'Query FCC LMS for all AM stations authorized on this frequency. Apply §73.37 Table 1 spacings to each.', data_source: 'FCC LMS AM Query or BIA/Kelsey AM database', required: true },
          { id: 'fa_query', item: 'First-adjacent (770/790 kHz) station query', action: 'Query LMS for stations on ±10 kHz. Apply FA spacing column from §73.37 Table 1.', data_source: 'FCC LMS AM Query', required: true },
          { id: 'sa_query', item: 'Second-adjacent (760/800 kHz) station query', action: 'Query LMS for stations on ±20 kHz. Apply SA spacing column.', data_source: 'FCC LMS AM Query', required: true },
          { id: 'nif_check', item: '§73.182 skywave NIF consistency check', action: 'After §73.37 spacing compliance verified, confirm NIF study covers same station database snapshot.', data_source: 'LMS + §73.182 NIF study', required: true },
          { id: 'treaty_check', item: 'International co-channel check', action: 'Verify spacing to Canadian and Mexican AM stations on same frequency per bilateral agreements.', data_source: 'CRTC AM database (Canada); IFT (Mexico)', required: false },
          { id: 'blanket_check', item: '§73.24(g) blanket interference (1000 mV/m contour)', action: 'Verify 1000 mV/m groundwave contour does not encompass inhabited communities.', data_source: 'FCC groundwave curve computation', required: true }
        ],
        n_checklist_required: 5,
        spacing_analysis_timeline: { database_query_days: 1, spacing_calculation_days: 5, report_preparation_days: 3, total_days_optimistic: 9, total_days_conservative: 18, note: 'Clear-channel Class A and secondary analyses take longer due to larger station populations affected.' },
        candidate_lat: 34.86, candidate_lon: -111.82,
        note: 'Screening-grade §73.37 framework — no actual station database query performed. A licensed broadcast engineer must query FCC LMS before any filing.',
        reference: '47 CFR §73.37; §73.182; §73.24(g); FCC LMS database'
      },
      am_fm_translator_opportunity: {
        am_revitalization_eligible: true, translator_max_erp_kw: 0.25,
        translator_haat_m_assumed: 30, fm_60dbu_radius_screening_km: 12.5,
        am_2mvm_contour_km: 21.67, miles_25_threshold_km: 40.23,
        translator_contour_check: 'PASS',
        translator_contour_note: 'FM 60 dBu contour (≈12.5 km) fits within AM 2 mV/m contour (≈21.67 km). Contour overlap requirement likely met at this candidate site.',
        filing_windows: [
          { window: 'First AM Revitalization Window', dates: 'October 2015 – February 2016', eligibility: 'All AM stations in continuous operation since October 1, 2015', status: 'CLOSED' },
          { window: 'Second AM Revitalization Window', dates: 'September 2020 – November 2020', eligibility: 'AM stations that did not receive a translator in the first window', status: 'CLOSED' },
          { window: 'Future Windows (FCC discretion)', dates: 'Not yet announced', eligibility: 'Watch FCC Public Notice in MB Docket 13-249', status: 'WATCH' }
        ],
        spectrum_search_guidance: {
          tool: 'FCC CDBS / LMS FM Query at stations.fcc.gov',
          candidate_site_coords: { lat: 34.86, lon: -111.82 },
          method: 'Search for available FM channels at candidate lat/lon.',
          key_checks: [
            'No co-channel full-power FM within 115 km (§73.207 Class A)',
            'No first-adjacent FM within 72 km',
            'No second-adjacent FM within 32 km',
            'No third-adjacent FM within 32 km (§73.207)',
            'LPFM protection: translator must not cause interference to LPFM stations on or adjacent to desired channel',
            'Interference to existing translators: check for co-channel translators within 63 km'
          ],
          note: 'Run a full LMS search using the CDBS FM query tool or BIA FM database.'
        },
        lpfm_protection: {
          rule: '47 CFR §74.1204',
          co_channel: 'AM-revitalization translator must protect LPFM stations on the same channel within 7 km',
          first_adjacent: 'Protect LPFM stations on ±200 kHz within FCC-defined short-spacing distances',
          note: 'LPFM has secondary but protected status relative to translators under the 2015 rules.'
        },
        form_349_exhibits: [
          { exhibit: 'Exhibit A (Technical)', description: 'Proposed FM translator coordinates, antenna height, ERP, FM channel', required: true },
          { exhibit: 'Exhibit B (Interference)', description: '§73.207 spacing analysis showing no conflicts with co/adj-channel FM', required: true },
          { exhibit: 'Exhibit C (LPFM)', description: '§74.1204 LPFM protection showing minimum separation met (LPFM spacing per §73.807)', required: true },
          { exhibit: 'Exhibit D (AM Contour)', description: 'FM 60 dBu contour within GREATER of AM 2 mV/m daytime groundwave contour OR 40 km (25 mi) of AM transmitter per §74.1231(i)', required: true },
          { exhibit: 'Exhibit E (Eligibility)', description: 'Certification of continuous AM operation since October 1, 2015', required: true },
          { exhibit: 'Environmental Certification', description: 'NEPA §1.1307 environmental assessment or negative declaration', required: true }
        ],
        audience_gain_note: 'A 250 W FM translator at 34.8600, -111.8200 would provide a ≈12.5 km 60 dBu coverage radius, potentially reaching an additional FM audience not served by the AM signal.',
        filing_form: 'FCC Form 349 (Translator / Booster Station Application)',
        docket: 'MB Docket No. 13-249 (FCC 15-142)',
        reference: '47 CFR §74.1201(g) (eligibility); §74.1231(i) (fill-in area: GREATER of 2 mV/m daytime contour OR 40 km radius); §74.1235(b) (250 W ERP max); §74.1204 (LPFM protection); §73.207 (FM spacing); §73.313 (FM propagation); MB Docket 13-249',
        note: 'FM translator opportunity is a screening-grade assessment. Actual channel availability requires a full §73.207 spacing analysis using FCC LMS data. Fill-in area is GREATER of the AM 2 mV/m daytime groundwave contour OR a 40 km (25-mile) radius per §74.1231(i).'
      },
      da_array_design_guide: {
        applicable: true, pattern_mode: 'DA-D', da_mode_type: 'DA-D',
        has_daytime_pattern: true, has_nighttime_pattern: false,
        frequency_khz: 780, wavelength_m: 384.62, quarter_wave_m: 96.15, quarter_wave_ft: 315.5,
        is_clear_channel: false, is_local_channel: false,
        recommended_min_elements: 2,
        recommended_config: { config_label: '2-Element End-Fire (Cardioid)', n_elements: 2, spacing_m: 96.15, spacing_ft: 315.5, property_footprint_m: 126.15, property_footprint_ft: 413.9 },
        array_configurations: [
          { n_elements: 2, config_label: '2-Element End-Fire (Cardioid)', spacing_lambdas: 0.25, spacing_m: 96.15, spacing_ft: 315.5, amplitude_ratios: [1.0, 1.0], phase_deg: [0, -90], max_gain_dbd: 3.0, null_depth_theoretical_db: '>40', null_depth_practical_db: '20–35', suppression_achievable_db: '20–35', property_footprint_m: 126.15, property_footprint_ft: 413.9, use_case: 'Single interference bearing. Simplest 2-tower array; deep null opposite maximum.', mutual_coupling_note: 'Z_12 ≈ 15–35 Ω for λ/4 spacing; phasing network must compensate to achieve null depth' },
          { n_elements: 2, config_label: '2-Element Broadside (Figure-8)', spacing_lambdas: 0.5, spacing_m: 192.31, spacing_ft: 630.9, amplitude_ratios: [1.0, 1.0], phase_deg: [0, 0], max_gain_dbd: 4.8, null_depth_theoretical_db: '>40', null_depth_practical_db: '25–40', suppression_achievable_db: '25–40', property_footprint_m: 222.31, property_footprint_ft: 729.4, use_case: 'Two nulls at 90°/270° to array axis; maximum gain along axis.', mutual_coupling_note: 'Z_12 ≈ 0–10 Ω for λ/2 spacing' },
          { n_elements: 3, config_label: '3-Element Linear Array', spacing_lambdas: 0.25, spacing_m: 96.15, spacing_ft: 315.5, amplitude_ratios: [0.5, 1.0, 0.5], phase_deg: [90, 0, -90], max_gain_dbd: 4.8, null_depth_theoretical_db: '30–40', null_depth_practical_db: '25–38', suppression_achievable_db: '25–38', property_footprint_m: 232.3, property_footprint_ft: 762.1, use_case: 'Multiple interference threats at different bearings; more flexible pattern shaping.', mutual_coupling_note: 'Full 3×3 mutual impedance matrix required' },
          { n_elements: 4, config_label: '4-Element T or L Array', spacing_lambdas: 0.25, spacing_m: 96.15, spacing_ft: 315.5, amplitude_ratios: [0.5, 1.0, 1.0, 0.5], phase_deg: [90, 0, 0, -90], max_gain_dbd: 5.5, null_depth_theoretical_db: '30–45', null_depth_practical_db: '25–42', suppression_achievable_db: '25–42', property_footprint_m: 338.45, property_footprint_ft: 1110.4, use_case: 'Co-channel threats at 2+ azimuths simultaneously.', mutual_coupling_note: 'Full 4×4 mutual impedance matrix; professional design required' }
        ],
        suppression_requirement_db: 28.3,
        suppression_note: '§73.37 / §73.182: suppression ratio of ≥28.3 dB toward co-channel protected contours (NIF D/U standard for Class D on regional channel).',
        n_hrp_radials: 72, hrp_increment_deg: 5,
        form_301am_exhibits: [
          { exhibit: 'Schedule B (Antenna)', description: 'Tower heights (degrees electrical), self-impedance values', required: true },
          { exhibit: 'Schedule C (Transmitter)', description: 'Transmitter make/model, authorized TPO', required: true },
          { exhibit: 'Exhibit E (Pattern Plots)', description: 'Theoretical HRP and NDA pattern plots (0°–360°, linear field scale)', required: true },
          { exhibit: 'Exhibit F (HRP Table)', description: 'HRP table at 5° increments (72 radials per §73.150(a)), EF at 1 km', required: true },
          { exhibit: 'Exhibit G (Phasing Data)', description: 'Base current ratios (I_n/I_1), phase angles, and monitor parameters', required: true },
          { exhibit: 'Exhibit H (Suppression)', description: 'Suppression ratios toward co-channel protected stations', required: true },
          { exhibit: 'Exhibit I (Mutual Z)', description: 'Self- and mutual-impedance matrix (2-element: not required)', required: false },
          { exhibit: 'Form 302-AM (License)', description: 'License to cover: proof-of-performance measurements per §73.154', required: true }
        ],
        base_current_monitoring: { check_interval_hours: 3, current_ratio_tolerance_pct: 5, phase_tolerance_deg: 3, monitor_method: 'Antenna monitor with base current sample loops on each element', fcc_specified_monitor_points: false, reference: '§73.61' },
        reference: '47 CFR §73.150; §73.152; §73.37; §73.61; §73.182',
        note: 'DA array element positions, amplitude ratios, and phase angles are screening-grade estimates. Actual design requires a licensed broadcast engineer and full §73.182 NIF analysis.'
      },
      proof_of_performance_requirements: {
        frequency_khz: 780, fcc_class: 'D', tpo_kw: 5, pattern_mode: 'DA-D',
        traversal_spec: {
          method: 'Full field intensity traversal (§73.154(a) DA proof)',
          radial_count: 72, radial_spacing_deg: 5,
          measurement_distances_km: [0.8, 1.6, 3.2, 6.4, 12.9, 25.7],
          min_radial_length_km: 25,
          field_contours_required: ['5.0 mV/m', '2.0 mV/m', '1.0 mV/m', '0.5 mV/m', '0.25 mV/m'],
          elements_measured_per_tower: 'Phase (deg) and ratio (dB) for each element during proof',
          note: 'DA proof: 72 radials at 5° intervals per §73.154(a). Full field intensity measurements at each point. Must include element phases and ratios in proof report.'
        },
        base_current_requirements: {
          required: true, rule: '47 CFR §73.61', location: 'Base of each tower in the antenna array',
          monitor_type: 'RF ammeter or equivalent licensed measuring instrument',
          reading_method: 'Readable from the transmitter control point',
          note: '§73.61: AM stations ≥ 1 kW licensed power must install base current monitors on each tower.'
        },
        mpe_requirements: {
          required: true, rule: '47 CFR §1.1310 / OET Bulletin 65',
          measurement_method: 'Calibrated broadband or narrowband field meter',
          exclusion_zone_m: 9.62,
          note: 'TPO = 5 kW ≥ 5 kW threshold. RF exposure (MPE) evaluation required. Measure field strength at accessible locations within and around the antenna exclusion zone.'
        },
        antenna_proof_exhibits: [
          '§73.150 / §73.154: Directional antenna proof report including all 72-radial FI traversals, element phases/ratios, and comparison to licensed pattern',
          'Ground system description and base current measurement data (§73.190)',
          'RF exposure (MPE) evaluation — required at this TPO',
          'Antenna monitoring point data (two or more monitoring points per §73.158)',
          'Completed FCC Form 302-AM with engineering certification',
          'ASR Form 854 registration confirmation'
        ],
        required_instrumentation: [
          'Calibrated field intensity meter (FIM-41, FIM-71, or equivalent; calibrated within 2 years)',
          'GPS receiver with WAAS accuracy (for traversal point coordinates)',
          'Calibrated dipole or whip antenna appropriate for AM broadcast band',
          'RF base current monitor (for §73.61 compliance)',
          'Broadband RF power density meter (Narda SRM-3006 or equivalent) for MPE measurement',
          'Phase and ratio monitoring equipment for DA element measurements during proof',
          'Data recording system: GPS-tagged FIM readings at each traversal point'
        ],
        proof_timeline_weeks_low: 8, proof_timeline_weeks_high: 16,
        filing_form: 'FCC Form 302-AM (license to cover)',
        reference: '47 CFR §73.154; §73.155; §73.61; §73.190; §1.1310; OET Bulletin 65; FCC Form 302-AM instructions',
        note: 'Proof-of-performance requirements based on DA (DA-D) §73.154(a) — 72-radial FI traversal. Allow 8–16 weeks for field measurements, data reduction, and report preparation.'
      },
      atmospheric_noise_analysis: {
        frequency_khz: 780, frequency_mhz: 0.78,
        candidate_lat: 34.86, candidate_lon: -111.82,
        estimated_pop_density_km2: 68,
        site_noise_class: 'RURAL',
        man_made_noise_fa: {
          business: 93.7, residential: 89.4, rural: 84.1, quiet_rural: 70.5, site_estimate: 84.1,
          units: 'dB above kT0B (ITU-R P.372-15 Table 1)'
        },
        atmospheric_noise_fa_day: 76.4,
        atmospheric_noise_fa_night: 88.4,
        effective_noise_fa_day: 84.1,
        effective_noise_fa_night: 88.4,
        minimum_detectable_field_day_mvm: 0.85,
        minimum_detectable_field_night_mvm: 1.41,
        noise_advisory: 'LOW NOISE: Fa ≈ 84.1 dB. Site is in a relatively quiet RF environment. Minimum detectable field ≈ 0.85 mV/m daytime.',
        reference: 'ITU-R P.372-15; ITU-R P.368-9; FCC §73.182',
        note: 'Atmospheric and man-made noise analysis applies ITU-R P.372-15 simplified equations at 780 kHz. Man-made noise class estimated from regional population density proxy. Results are screening-grade only.'
      },
      community_of_license_profile: {
        col_data_source: 'NO_COL_DATA',
        col_data_source_note: 'No CoL data supplied — distance proxy uses candidate-to-current-site distance. Commission GeoJSON polygon for §73.24(i) analysis.',
        col_centroid_lat: null, col_centroid_lon: null,
        candidate_lat: 34.86, candidate_lon: -111.82,
        candidate_to_col_dist_km: 8.2,
        bearing_from_candidate_to_col_deg: null,
        geographic_tier: 'NEAR',
        geographic_tier_note: 'Candidate within 10 km of CoL. §73.24(i) compliance straightforward at typical class TPO. Blanket population monitoring advisable.',
        daytime_reach_km: 36.8,
        field_at_col_centroid_mvm: 12.4,
        col_5mvm_centroid_covered: true,
        col_coverage_pct: 97.0,
        col_compliant: true,
        minimum_tpo_for_col_kw: null,
        engineering_recommendations: ['No immediate engineering actions required at screening grade.'],
        reference: '47 CFR §73.24(i); §73.24(g); §73.150',
        note: 'Community of license profile is a screening-grade geographic assessment. Coverage_pct uses a 10-km disc proxy when no CoL polygon is supplied.'
      },
      tower_structural_assessment_guide: {
        frequency_khz: 780, fcc_class: 'D', tpo_kw: 5,
        candidate_lat: 34.86, candidate_lon: -111.82,
        wavelength_m: 384.6, quarter_wave_height_m: 96.2, half_wave_height_m: 192.3,
        asr_registration_required: true,
        asr_note: 'λ/4 = 96.2 m exceeds 60.96 m (200 ft) §17.7 threshold. FCC ASR Form 854 + FAA Form 7460-1 required before construction.',
        wind_ice_zone: 'ZONE_II_MODERATE',
        wind_ice_zone_data: { label: 'Zone II — Moderate Wind + Ice', wind_speed_mph: 90, ice_thickness_in: 1.0, note: 'Combined wind-on-ice design controls. Standard structural design applies. Guyed towers common.' },
        tower_types: [
          { type: 'GUYED_MAST', suitable: true, typical_height_range_m: '96–192', notes: 'Most common AM tower type. Lower material cost, larger guy radius footprint. Base-insulated series-fed monopole configuration.', max_recommended_tpo_kw: 50 },
          { type: 'SELF_SUPPORTING_LATTICE', suitable: false, typical_height_range_m: '96–115', notes: 'Higher per-foot cost. Smaller footprint — no guy anchors. Suitable for constrained sites. Structural weight limits height at lower frequencies.', max_recommended_tpo_kw: 10 },
          { type: 'MONOPOLE_TUBULAR', suitable: true, typical_height_range_m: '67–96', notes: 'Tapered tubular steel monopole. Smallest footprint. Limited to lower heights and powers. Higher cost per unit height than guyed mast.', max_recommended_tpo_kw: 5 }
        ],
        recommended_tower_type: 'GUYED_MAST',
        faa_requirements: {
          marking_required: true, lighting_required: true, type: 'MEDIUM_INTENSITY',
          paint: 'Aviation orange/white alternating bands (§17.23)',
          lights: 'Medium-intensity white flashing (L-864/L-865) day/night + red steady-burning night (L-810)',
          note: 'Tower height 96–192 m (200–500 ft range): medium-intensity marking/lighting required (§17.21 Table 1). 7 aviation-orange/white bands, 2 m minimum band width.'
        },
        foundation: {
          estimated_soil_bearing_kpa: 150, recommended_type: 'spread_footing',
          note: 'Spread footing or mat foundation likely suitable. Geotechnical report required to confirm bearing capacity.'
        },
        structural_standards: ['TIA-222-H', 'ASCE 7-22', 'IBC 2021', 'AC 70/7460-1M'],
        reference: '47 CFR §17.7; §17.21–§17.50; TIA-222-H; AC 70/7460-1M; ASCE 7-22; IBC 2021',
        note: 'Tower structural assessment guide is a screening-grade reference. Actual structural design, foundation engineering, and FAA aeronautical study required before construction.'
      },
      ground_system_design_guide: {
        frequency_khz: 780, fcc_class: 'D', tpo_kw: 5,
        sigma_msm: 9, soil_resistivity_ohm_m: 111.11,
        soil_conductivity_class: 'GOOD',
        soil_note: 'Good conductivity. Standard 120-radial system (λ/4) achieves near-ideal efficiency. FCC M3 zone meets §73.190 screening threshold.',
        wavelength_m: 384.6, optimal_radial_length_m: 96.2, minimum_radial_length_m: 48.1,
        burial_depth_recommended: '5–10 cm',
        conductor_specification: '#10 AWG copper-clad steel or solid copper',
        scenarios: [
          { label: 'Standard (120 radials)', radial_count: 120, radial_length_m: 96.2, ground_loss_ohm: 1.53, antenna_efficiency_pct: 96.0, effective_tpo_kw: 4.8, suitable_for: 'Preferred for all AM stations. Required for §73.190 certification without soil survey waiver.' },
          { label: 'Reduced (60 radials)', radial_count: 60, radial_length_m: 96.2, ground_loss_ohm: 3.06, antenna_efficiency_pct: 92.3, effective_tpo_kw: 4.6, suitable_for: 'Acceptable for temporary operations or land-constrained sites. §73.190 soil survey waiver application may be required.' },
          { label: 'Urban-constrained (30 radials)', radial_count: 30, radial_length_m: 48.1, ground_loss_ohm: 6.11, antenna_efficiency_pct: 85.7, effective_tpo_kw: 4.3, suitable_for: 'Absolute minimum for urban/rooftop sites. Significant efficiency reduction. §73.190 variance required.' }
        ],
        staging_phase1: { radial_count: 60, description: 'Phase 1 (60 radials): minimum viable system for initial operation while Phase 2 radials are installed in stages.' },
        staging_phase2: { radial_count: 120, description: 'Phase 2 (120 radials): complete standard system for §73.190 certification.' },
        wenner_survey: {
          method: 'Wenner 4-electrode (equal-spacing) soil resistivity measurement',
          electrode_spacing_m: 96.2,
          measurement_locations: 'Minimum 4 traverses at 0°, 45°, 90°, 135° from tower base to 96.2 m radius.',
          interpretation: 'Measured ρ (Ω·m) → σ (mS/m) = 1000/ρ. Compare to M3 zone value (9 mS/m). If measured σ differs > ±30%, update groundwave reach and coverage calculations.'
        },
        certification_requirements: [
          'Soil resistivity survey (Wenner 4-electrode method) at proposed radial layout locations',
          'Minimum 120 copper radials at λ/4 (96.2 m) length, buried 5–10 cm',
          'Ground ring: solid copper conductor connecting all radial tips at 96.2 m radius',
          'All radials bonded to tower base connection point',
          'Conductor specification: #10 AWG copper-clad steel or solid copper',
          'Antenna base current measurement before and after radial installation',
          'Document ground system layout (as-built drawing) for §73.190 filing',
          'FCC Form 302-AM ground system certification'
        ],
        reference: '47 CFR §73.190; §73.61; ARRL Antenna Handbook; Terman (1943); Belrose (1992); FCC M3 zone data',
        note: 'Ground system design guide based on Terman/Belrose formula and FCC M3 conductivity σ = 9 mS/m at this candidate. All values are theoretical screening estimates requiring soil resistivity survey and field measurements.'
      },
      regulatory_compliance_checklist: {
        overall_status: 'WARN',
        filing_readiness: 'CONDITIONAL — no hard failures; outstanding items require professional study/consultation before filing',
        pass_count: 2, warn_count: 8, fail_count: 0, not_evaluated_count: 2,
        items: [
          { id: 'col_coverage', label: 'Principal community 5 mV/m coverage', rule: '47 CFR §73.24(i)', status: 'PASS', note: '97% of principal community receives ≥5 mV/m (floor: 80%).', required_action: null },
          { id: 'blanket_pop', label: 'Blanket population (1000 mV/m contour)', rule: '47 CFR §73.24(g)', status: 'PASS', note: 'Estimated blanket population 0.5% ≤ 1% ceiling.', required_action: null },
          { id: 'asr_registration', label: 'ASR tower registration (§17.7)', rule: '47 CFR §17.7 / FCC Form 854', status: 'WARN', note: 'λ/4 = 96.2 m at 780 kHz exceeds the 60.96 m (200 ft) §17.7 threshold. FCC ASR Form 854 and FAA Form 7460-1 required before construction.', required_action: 'File FAA Form 7460-1 and obtain FAA determination before filing Form 854 with FCC. Marking/lighting per FAA determination (§17.21–§17.50).' },
          { id: 'mpe_evaluation', label: 'RF exposure MPE evaluation', rule: '47 CFR §1.1310 / OET Bulletin 65', status: 'WARN', note: 'TPO = 5 kW ≥ 5 kW threshold. Routine MPE evaluation required before license grant.', required_action: 'Compute uncontrolled MPE limit distance from antenna base; fence or post exclusion zone signage per OET-65 guidance.' },
          { id: 'nif_study', label: 'Nighttime interference-free (NIF) contour study', rule: '47 CFR §73.182', status: 'WARN', note: 'Regional channel: §73.182 nighttime interference screening required. Demonstrate no increase in inter-station skywave interference.', required_action: 'Commission §73.182 NIF study from consulting engineer before Form 301-AM filing.' },
          { id: 'treaty_zone', label: 'International treaty coordination', rule: '1941/1986 US/MX, 1941 US/CA NARBA', status: 'PASS', note: 'Candidate site is outside treaty coordination zones at screening grade. No treaty coordination required.', required_action: null },
          { id: 'da_pattern', label: 'Directional antenna (DA) pattern requirements', rule: '47 CFR §73.150', status: 'WARN', note: 'Pattern mode DA-D: §73.150 requires HRP table (72 radials at 5° increments) and suppression ratios filed with Form 301-AM.', required_action: 'Engage AM DA design engineer. Prepare §73.150 HRP table and DA proof schedule per §73.154. Budget 16–52 weeks for pattern design.' },
          { id: 'ground_system', label: 'Ground system conductivity & §73.190 certification', rule: '47 CFR §73.190', status: 'WARN', note: 'Zone-table conductivity σ = 9 mS/m (FCC M3 zone map). Soil survey required before §73.190 ground system certification.', required_action: 'Engage licensed broadcast engineer for Wenner four-electrode soil resistivity survey.' },
          { id: 'nepa_screening', label: 'NEPA §1.1306 desktop environmental screening', rule: '47 CFR §1.1306 / §1.1307', status: 'WARN', note: 'NEPA §1.1306 desktop environmental screening is required for all new transmitter site applications.', required_action: 'Complete §1.1306 environmental checklist. If any trigger is present, prepare an EA before Form 301-AM filing.' },
          { id: 'nhpa_106', label: 'NHPA §106 historic/cultural resource consultation', rule: '47 CFR §1.1307(a)(4) / 36 CFR Part 800', status: 'WARN', note: 'All new tower construction requires NHPA §106 SHPO consultation for archaeological and architectural survey.', required_action: 'Submit tower proposal to SHPO for §106 review. Allow 90–180 days for SHPO response.' },
          { id: 'form_301_am', label: 'FCC Form 301-AM application completeness', rule: '47 CFR §73.3533 / LMS', status: 'NOT_EVALUATED', note: 'Form 301-AM completeness depends on final engineering package, NIF study, and NEPA/NHPA outcomes.', required_action: 'Prepare complete engineering filing package with licensed broadcast consultant before filing.' },
          { id: 'construction_deadline', label: 'CP construction completion and Form 302-AM deadline', rule: '47 CFR §73.3536', status: 'NOT_EVALUATED', note: 'CP not yet granted — construction deadline not applicable at screening stage.', required_action: 'Develop construction schedule immediately upon CP grant to avoid missing §73.3598 CP expiration deadline.' }
        ],
        reference: '47 CFR §73.24(g)(i); §73.182; §73.150; §73.190; §1.1306; §1.1307; §1.1310; §17.7; §73.3536; OET Bulletin 65',
        note: 'regulatory_compliance_checklist is a screening-grade pre-filing assessment only. All WARN and NOT_EVALUATED items require professional engineering study, legal review, or additional data collection before Form 301-AM can be filed.'
      },
      licensing_timeline_estimate: {
        frequency_khz: 780, fcc_class: 'D', tpo_kw: 5, pattern_mode: 'DA-D',
        total_weeks_optimistic: 63, total_weeks_conservative: 164,
        total_years_optimistic: 1.21, total_years_conservative: 3.15,
        licensing_risk_tier: 'HIGH',
        risk_note: 'Clear channel (§73.25): FCC Media Bureau clear-channel analysis + dominant station notification adds 4–12 months to processing.',
        treaty_zone_present: false, asr_required: true,
        phases: [
          { phase: 'PRE_APPLICATION', label: 'Pre-application (site study, engineering, NEPA/NHPA)', weeks_low: 26, weeks_high: 52, key_tasks: ['Conductivity survey (§73.190) and site evaluation', 'DA array design and §73.182 NIF analysis', 'NEPA §1.1306 desktop environmental review', 'NHPA §106 SHPO consultation', 'FAA Form 7460-1 aeronautical study + FCC ASR Form 854'] },
          { phase: 'APPLICATION_FILING', label: 'Application preparation and LMS Form 301-AM filing', weeks_low: 4, weeks_high: 12, key_tasks: ['Finalize engineering exhibits (coverage, blanket pop, MPE)', 'DA pattern exhibits per §73.150 (72-radial HRP at 5° increments, suppression ratios)', 'FCC filing attorney review and LMS Form 301-AM submission'] },
          { phase: 'FCC_PROCESSING', label: 'FCC processing, comment period, and CP grant', weeks_low: 26, weeks_high: 78, key_tasks: ['FCC public notice / comment period (30 days)', 'Clear-channel coordination — FCC Media Bureau field analysis', 'Petitions to deny / objections review', 'Construction Permit (CP) grant'] },
          { phase: 'CONSTRUCTION', label: 'Construction and equipment installation', weeks_low: 20, weeks_high: 36, key_tasks: ['Tower erection with FAA marking/lighting (ASR required)', 'Ground radial system installation', 'DA array element installation and initial phasing'] },
          { phase: 'LICENSE_TO_COVER', label: 'Proof of performance and Form 302-AM', weeks_low: 8, weeks_high: 16, key_tasks: ['DA proof (72-radial FI traversals per §73.154)', 'Base current measurements and antenna efficiency verification', 'File FCC Form 302-AM (license to cover)'] }
        ],
        reference: '47 CFR §73.3520; §73.3533; §73.3536; 47 CFR §1.47; FCC Media Bureau AM processing data',
        note: 'Timeline estimates are based on FCC processing history and regulatory requirements as of 2024. Actual timelines vary significantly. All phase estimates are calendar weeks.'
      },
      fcc_form_301_exhibit_checklist_guide: {
        frequency_khz: 780, fcc_class: 'D', pattern_mode: 'NDA', tpo_kw: 5,
        is_directional: false, is_clear_channel: true, tower_height_ft: 315, asr_required: true,
        n_exhibits_total: 24, n_exhibits_required: 22, n_exhibits_da_specific: 0,
        filing_fee_usd: 4200, filing_system: 'FCC LMS (Licensing Management System)',
        n_deficiency_risks: 5,
        deficiency_triggers: [
          { rank: 1, issue: 'Missing nighttime skywave analysis', cfr: '§73.182', how_to_avoid: 'Run §73.182 skywave NIF contour analysis before filing; include FCC SKYWAVE tool output as exhibit' },
          { rank: 2, issue: 'Incomplete NEPA checklist (§1.1306)', cfr: '§1.1306', how_to_avoid: 'Complete all 13 NEPA categories; consult environmental attorney if any "yes" — EA may be required' },
          { rank: 3, issue: 'ASR number missing for tower ≥ 200 ft', cfr: '§17.4; §17.7', how_to_avoid: 'Register ASR in FCC ASR system before filing Form 301' },
          { rank: 4, issue: 'Site coordinates not in NAD83', cfr: '§73.1020(c)', how_to_avoid: 'Convert all GPS coordinates to NAD83 using NGS NADCON5 tool' },
          { rank: 5, issue: 'RF exposure (MPE) exhibit missing', cfr: '§1.1310; OET-65', how_to_avoid: 'Calculate MPE per OET Bulletin 65; include calculation exhibit' }
        ],
        required_exhibits: [
          { id: 'A1', section: 'A', title: 'FCC Form 301 main application (fully completed)', required: true, cfr: '§73.3533; §73.3536' },
          { id: 'A2', section: 'A', title: 'Legal name and entity documentation', required: true, cfr: '§73.1020; §73.3533' },
          { id: 'A3', section: 'A', title: 'Ownership disclosure (FCC Form 323)', required: true, cfr: '§73.3615' },
          { id: 'A4', section: 'A', title: 'CORES entity registration', required: true, cfr: '§1.8001' },
          { id: 'B1', section: 'B', title: 'Site coordinates — FCC datum (NAD83)', required: true, cfr: '§73.1020(c)' },
          { id: 'B2', section: 'B', title: 'Proposed ERP and TPO (kW)', required: true, cfr: '§73.21; §73.51' },
          { id: 'B3', section: 'B', title: 'Antenna height data (AMSL and AGL)', required: true, cfr: '§73.1020(b)' },
          { id: 'B4', section: 'B', title: 'Ground system design description', required: true, cfr: '§73.190' },
          { id: 'B5', section: 'B', title: 'Soil conductivity (M3 value or measured)', required: true, cfr: '§73.184; §73.150' },
          { id: 'B6', section: 'B', title: 'Proposed operating schedule (day/night/critical hours)', required: true, cfr: '§73.99; §73.1740' },
          { id: 'C1', section: 'C', title: 'Co-channel groundwave interference analysis (§73.182)', required: true, cfr: '§73.182; §73.24' },
          { id: 'C2', section: 'C', title: 'Adjacent channel interference check (±10 kHz)', required: true, cfr: '§73.37; §73.182' },
          { id: 'C3', section: 'C', title: 'Blanket interference analysis (§73.24(g))', required: true, cfr: '§73.24(g)' },
          { id: 'C4', section: 'C', title: 'Nighttime skywave interference analysis (§73.182)', required: true, cfr: '§73.182; §73.24(g)' },
          { id: 'D1', section: 'D', title: 'NEPA Environmental Checklist (§1.1307)', required: true, cfr: '§1.1306; §1.1307' },
          { id: 'D2', section: 'D', title: 'RF Exposure (MPE) evaluation — OET Bulletin 65', required: true, cfr: '§1.1310; OET Bulletin 65' },
          { id: 'D4', section: 'D', title: 'NHPA §106 / cultural resources desktop survey', required: true, cfr: 'NHPA §106; §1.1307(a)(4)' },
          { id: 'E1', section: 'E', title: 'ASR registration number', required: true, cfr: '47 CFR §17.4; §17.7' },
          { id: 'E2', section: 'E', title: 'FAA aeronautical study (Form 7460-1)', required: true, cfr: '14 CFR §77; §17.23' },
          { id: 'F1', section: 'F', title: 'Engineer certification', required: true, cfr: '§73.1870; §73.3536(a)(2)' },
          { id: 'F2', section: 'F', title: 'Applicant signature and certification', required: true, cfr: '§73.3533(a)(7)' },
          { id: 'F3', section: 'F', title: 'Filing fee payment', required: true, cfr: '§1.1102' }
        ],
        reference: '47 CFR §73.1; §73.21; §73.24; §73.150; §73.182; §73.190; §1.1102; §1.1306; §1.1310; §17.4; FCC Form 301 Instructions (2024); OET Bulletin 65',
        note: 'FCC Form 301-AM NDA application for 780 kHz Class D: 22 required exhibits across 6 sections. Top deficiency risk: Missing nighttime skywave analysis. ASR registration required (tower ≈ 315 ft). Filing fee: $4,200.'
      },
      electrical_power_consumption_guide: {
        frequency_khz: 780, tpo_kw: 5, hours_per_year: 8760,
        electricity_rate_low_usd_per_kwh: 0.10, electricity_rate_high_usd_per_kwh: 0.16,
        auxiliary_load_kw: 1.0, n_transmitter_models: 3,
        transmitter_models: [
          { type: 'TUBE',        label: 'Vacuum tube (legacy)',  example_models: 'Harris MW-5, RCA BTA-5R',     efficiency_low_pct: 50, efficiency_high_pct: 55, input_power_low_kw: 9.09,  input_power_high_kw: 10.0,  hvac_load_est_kw: 3.64, total_facility_low_kw: 11.09, total_facility_high_kw: 14.99, annual_kwh_low: 97147, annual_kwh_high: 131312, annual_cost_low_usd: 9715, annual_cost_high_usd: 21010 },
          { type: 'HYBRID',      label: 'Hybrid solid-state',   example_models: 'Harris DX-5, early Nautel NA', efficiency_low_pct: 58, efficiency_high_pct: 62, input_power_low_kw: 8.06,  input_power_high_kw: 8.62,  hvac_load_est_kw: 1.54, total_facility_low_kw: 9.29,  total_facility_high_kw: 10.35, annual_kwh_low: 81381, annual_kwh_high: 90666, annual_cost_low_usd: 8138, annual_cost_high_usd: 14507 },
          { type: 'SOLID_STATE', label: 'Modern solid-state',   example_models: 'Nautel NX5, GatesAir FAX-5',  efficiency_low_pct: 65, efficiency_high_pct: 72, input_power_low_kw: 6.94,  input_power_high_kw: 7.69,  hvac_load_est_kw: 0.46, total_facility_low_kw: 8.31,  total_facility_high_kw: 9.25, annual_kwh_low: 72797, annual_kwh_high: 81030, annual_cost_low_usd: 7280, annual_cost_high_usd: 12965 }
        ],
        recommended_type: 'SOLID_STATE',
        solid_state_annual_cost_low_usd: 7280, solid_state_annual_cost_high_usd: 12965,
        annual_savings_vs_tube_usd: 6337, solid_state_tx_upgrade_cost_usd: 18000, upgrade_payback_years: 2.8,
        power_factor_uncorrected: 0.78, apparent_power_kva: 10.65,
        reference: '47 CFR §73.1590; DOE EIA Commercial Electricity Rates (2024); Nautel NX5 spec; GatesAir FAX-5 spec; ITU-R BS.2101',
        note: '780 kHz 5 kW facility (modern solid-state): total load ~8.31–9.25 kW; estimated annual electricity $7,280–$12,965 at 2024 commercial rates. Tube-to-solid-state upgrade saves ~$6,337/yr; payback ≈ 2.8 yr on a $18,000 transmitter.'
      },
      antenna_base_impedance_and_atu_design_guide: {
        frequency_khz: 780, f_hz: 780000, lambda_m: 384.6, lambda_quarter_m: 96, tpo_kw: 5, pattern_mode: 'NDA',
        feedline_impedance_ohm: 50, rr_ohm: 36.6, rg_low_ohm: 2.0, rg_high_ohm: 5.0, rcond_ohm: 0.4,
        r_base_low_ohm: 39.0, r_base_high_ohm: 42.0, r_base_typ_ohm: 40.5,
        q_network: 0.484, xl_shunt_ohm: 103.3, xc_series_ohm: 19.6,
        l_shunt_uh: 21.06, c_series_pf: 10402,
        bw_3db_khz: 1610.5, bw_adequate: true,
        antenna_efficiency_low_pct: 87.1, antenna_efficiency_high_pct: 93.8, antenna_efficiency_typ_pct: 90.4,
        base_current_low_a: 10.91, base_current_high_a: 11.34, base_current_typ_a: 11.12,
        detuning_radius_m: 96, guy_wire_detuning_required: true,
        n_atu_networks: 'one (NDA — single tower)', is_directional: false,
        atu_network_type: 'L-network (shunt inductor / series capacitor)',
        reference: '47 CFR §73.190 (ground system/detuning); §73.62 (base current monitoring); §73.154 (proof); ITU-R BS.346-1; IEEE Std 100',
        note: '780 kHz λ/4 monopole (96 m): base impedance ~39–42 Ω (Rr=36.6 Ω + Rg=2–5 Ω). ATU: L-network; shunt L ≈ 21.06 μH, series C ≈ 10,402 pF; -3 dB BW ≈ 1610 kHz. Efficiency ≈ 90.4%. Base current at 5 kW: ≈ 11.12 A. Guy wire detuning coils required within 96 m (§73.190).'
      },
      station_total_project_cost_pro_forma_guide: {
        frequency_khz: 780, fcc_class: 'D', pattern_mode: 'NDA', tpo_kw: 5,
        tower_height_m: 96, tower_height_ft: 315, n_radials: 120, radial_length_m: 96,
        n_cost_categories: 9,
        cost_categories: [
          { category: 'FCC Regulatory Fees',            low_usd: 5295,   high_usd: 5955,   notes: 'Form 301 CP ($4,200) + Form 302-AM ($435) + annual fee ($660)' },
          { category: 'Professional Services',           low_usd: 30000,  high_usd: 60000,  notes: 'Broadcast attorney + engineer; NDA simplifies attorney scope' },
          { category: 'Site Acquisition (excl. land)',   low_usd: 8500,   high_usd: 31000,  notes: 'Title search, survey, Phase I ESA, NEPA §1.1307, local permits' },
          { category: 'Tower Construction',              low_usd: 107100, high_usd: 252000, notes: 'λ/4 guyed monopole 96 m (315 ft); foundation, base insulator, guys, ASR' },
          { category: 'Ground Radial System',            low_usd: 21888,  high_usd: 61488,  notes: '120 radials × 96 m; AWG-10 copper wire + burial/bonding labor; §73.190' },
          { category: 'Transmitter & ATU Equipment',     low_usd: 25000,  high_usd: 68000,  notes: '5 kW transmitter + ATU + hardline + base current monitoring' },
          { category: 'Transmitter Building',            low_usd: 83000,  high_usd: 235000, notes: '1000 sq ft + HVAC + 200A electrical + 50 kW generator + security' },
          { category: 'STL System',                      low_usd: 11000,  high_usd: 33000,  notes: 'Microwave or IP studio-transmitter link; equipment + installation' },
          { category: 'Proof of Performance',            low_usd: 8000,   high_usd: 20000,  notes: '8-radial NDA field intensity traversal (§73.154(b)) + report + FCC exhibit' }
        ],
        subtotal_low_usd: 299783, subtotal_high_usd: 766443,
        contingency_pct: 15, contingency_low_usd: 44967, contingency_high_usd: 114967,
        total_project_low_usd: 344750, total_project_high_usd: 881410, total_project_typ_usd: 613080,
        total_timeline_months_low: 18, total_timeline_months_high: 30,
        timeline_milestones: [
          { milestone: 'Engineering study + Form 301 filed',      month_start: 0,  month_end: 2,  parallel: false },
          { milestone: 'FCC CP processing',                        month_start: 2,  month_end: 20, parallel: false },
          { milestone: 'Site acquisition + permitting',            month_start: 1,  month_end: 12, parallel: true  },
          { milestone: 'Tower construction + radial installation', month_start: 12, month_end: 18, parallel: false },
          { milestone: 'Equipment install + ATU commissioning',    month_start: 18, month_end: 21, parallel: false },
          { milestone: 'Proof of performance + Form 302-AM',       month_start: 21, month_end: 24, parallel: false }
        ],
        n_financing_options: 4,
        financing_options: [
          { source: 'SBA 7(a) loan', max_usd: 5000000, term_years: 10, notes: 'Equipment and working capital; 7-8% rate typical (2024)' },
          { source: 'SBA 504 loan', max_usd: 5500000, term_years: 20, notes: 'Real estate and tower construction; lower fixed rate' },
          { source: 'CoBank / Farm Credit', max_usd: null, term_years: null, notes: 'Broadcast-specialized lender; familiar with FCC license collateral' },
          { source: 'Seller financing', max_usd: null, term_years: null, notes: 'If acquiring existing AM facility; negotiate CP contingency clause' }
        ],
        reference: '47 CFR §73.21; §73.154; §73.182; §73.190; §1.1102; §1.1307; NHPA §106; SBA 7(a)/504 program guidelines',
        note: 'Complete relocation budget for 780 kHz Class D (NDA) 5 kW: estimated $344,750–$881,410 (typical $613,080), including 15% contingency. Excludes land purchase price. Timeline: 18–30 months from CP filing to new license. All figures are 2024 screening-grade estimates.'
      },
      transmitter_power_upgrade_pathway_guide: {
        frequency_khz: 780, fcc_class: 'D', pattern_mode: 'NDA',
        current_tpo_kw: 5, day_max_tpo_kw: 10, night_max_tpo_kw: 1,
        day_headroom_kw: 5, can_upgrade_day_power: true, upgraded_tpo_kw: 10,
        coverage_radius_factor: 1.414, coverage_gain_pct: 41,
        is_directional: false, night_upgrade_requires_da_n: true,
        form301_fee_usd: 4200, form302_fee_usd: 435,
        transmitter_cost_low_usd: 15000, transmitter_cost_high_usd: 45000,
        installation_cost_usd: 7500,
        engineering_cost_low_usd: 4000, engineering_cost_high_usd: 8000,
        total_project_low_usd: 31135, total_project_high_usd: 65135,
        cp_processing_months_low: 6, cp_processing_months_high: 18,
        n_upgrade_steps: 5,
        upgrade_steps: [
          { step: 1, action: 'Interference analysis', form: null, cost_range_usd: '$4,000–$8,000', timeline: '2–4 weeks', notes: '§73.182 co-channel/adjacent-channel analysis; NDA — no pattern proof needed' },
          { step: 2, action: 'File FCC Form 301 (CP application)', form: 'Form 301', cost_range_usd: '$4,200', timeline: '1–2 weeks', notes: 'Major facility change; engineering exhibit, interference study, environmental checklist (§1.1307)' },
          { step: 3, action: 'FCC processing / CP grant', form: null, cost_range_usd: 'included', timeline: '6–18 months', notes: 'CP grants construction authority; build must commence within 3 years (§73.1620)' },
          { step: 4, action: 'Procure and install transmitter', form: null, cost_range_usd: '$22,500–$52,500', timeline: '4–12 weeks', notes: '10 kW AM transmitter + electrical service upgrade + bonding + commissioning' },
          { step: 5, action: 'File FCC Form 302-AM (license to cover)', form: 'Form 302-AM', cost_range_usd: '$435', timeline: '2–8 weeks', notes: 'NDA 8-radial proof data required (§73.154(b))' }
        ],
        reference: '47 CFR §73.21 (power limitations); §73.182 (nighttime interference); §73.154 (proof of performance); §73.1620 (CP construction period); §1.1102 (filing fees); FCC Form 301; FCC Form 302-AM',
        note: '780 kHz Class D (NDA) — current 5 kW TPO. Daytime upgrade to 10 kW available (§73.21 Class D ceiling) — groundwave coverage radius grows ~41% (√ERP scaling). Nighttime ceiling: 1 kW (Class D secondary; DA-N antenna + §73.182 skywave analysis required for night upgrade).'
      },
      am_coverage_optimization_by_tower_height_guide: {
        frequency_khz: 780, wavelength_m: 384.6,
        lambda_eighth_m: 48,  lambda_eighth_ft: 157,
        lambda_quarter_m: 96, lambda_quarter_ft: 315,
        lambda_half_m: 192,   lambda_half_ft: 630,
        five_eighth_m: 240,   five_eighth_ft: 787,
        current_height_m: 96, current_height_ft: 315, current_elec_deg: 90,
        optimal_height_m: 240, optimal_height_ft: 787,
        height_increase_m: 144,
        max_field_gain_rel: 1.16, max_coverage_gain_pct: 16,
        asr_required: true, faa_lighting_required: true,
        n_height_milestones: 5,
        height_milestones: [
          { label: 'λ/8  (45°)',  height_m: 48,  height_ft: 157, elec_deg: 45,  rr_ohm: 10.5, field_gain_rel: 0.71, notes: 'Short; requires large inductive loading coil; low efficiency; typical of land-locked urban sites' },
          { label: 'λ/4  (90°)',  height_m: 96,  height_ft: 315, elec_deg: 90,  rr_ohm: 36.6, field_gain_rel: 1.00, notes: 'Standard reference height; excellent efficiency; used by most Class D/C stations' },
          { label: '3λ/8 (135°)', height_m: 144, height_ft: 472, elec_deg: 135, rr_ohm: 55.0, field_gain_rel: 1.10, notes: 'Medium height; field gain +10% over λ/4; requires FAA lighting study above 200 ft (§17.23)' },
          { label: 'λ/2  (180°)', height_m: 192, height_ft: 630, elec_deg: 180, rr_ohm: 74.0, field_gain_rel: 1.14, notes: 'Half-wave; peak at 5λ/8 approaching; FAA ASR required (>61 m per §17.7); major tower project' },
          { label: '5λ/8 (225°)', height_m: 240, height_ft: 787, elec_deg: 225, rr_ohm: 37.0, field_gain_rel: 1.16, notes: 'Near-optimal field strength; Rr returns to ~37 Ω; most efficient coverage per watt; rarely practical for Class D' }
        ],
        coverage_estimates: [
          { label: 'λ/8  (45°)',  height_m: 48,  height_ft: 157, field_gain_rel: 0.71, coverage_radius_ratio: 0.71, coverage_gain_pct: -29, rr_ohm: 10.5 },
          { label: 'λ/4  (90°)',  height_m: 96,  height_ft: 315, field_gain_rel: 1.00, coverage_radius_ratio: 1.00, coverage_gain_pct: 0,   rr_ohm: 36.6 },
          { label: '3λ/8 (135°)', height_m: 144, height_ft: 472, field_gain_rel: 1.10, coverage_radius_ratio: 1.10, coverage_gain_pct: 10,  rr_ohm: 55.0 },
          { label: 'λ/2  (180°)', height_m: 192, height_ft: 630, field_gain_rel: 1.14, coverage_radius_ratio: 1.14, coverage_gain_pct: 14,  rr_ohm: 74.0 },
          { label: '5λ/8 (225°)', height_m: 240, height_ft: 787, field_gain_rel: 1.16, coverage_radius_ratio: 1.16, coverage_gain_pct: 16,  rr_ohm: 37.0 }
        ],
        reference: '47 CFR §73.160 (antenna height); §17.7 (ASR); §17.23 (FAA marking); ITU-R BS.346-1 (antenna gain vs height)',
        note: 'For 780 kHz (λ=385 m): current tower 315 ft (λ/4, 90°) achieves baseline field strength. Increasing to 5λ/8 (787 ft) yields +16% field gain. Towers above 200 ft require FAA ASR registration (§17.7) and painting/lighting per §17.23.'
      },
      spectrum_monitoring_and_frequency_drift_guide: {
        frequency_khz: 780, freq_hz: 780000, tolerance_hz: 20, tolerance_ppm: 25.64,
        lower_limit_hz: 779980, upper_limit_hz: 780020,
        n_monitoring_methods: 4, n_required_methods: 2, n_drift_causes: 5,
        n_transmitter_types: 3, antenna_induced_drift_hz_max: 1,
        monitor_check_interval_days: 30, n_correction_steps: 5,
        transmitter_types: [
          { type: 'MODERN_PLL',        label: 'Modern PLL (DX, Nautel, BE, GatesAir)', drift_typ_hz: 1,  drift_max_hz: 5,  ppm_typ: 0.001, margin_pct: 97.5, notes: 'GPS-disciplined or TCXO/OCXO reference; autonomous correction' },
          { type: 'OLDER_SOLID_STATE', label: 'Older solid-state (1980s–90s)',         drift_typ_hz: 5,  drift_max_hz: 12, ppm_typ: 0.006, margin_pct: 75.0, notes: 'Crystal oscillator; temperature-sensitive; periodic realignment needed' },
          { type: 'TUBE_AM',           label: 'Vintage tube transmitter (pre-1980)',   drift_typ_hz: 10, drift_max_hz: 18, ppm_typ: 0.013, margin_pct: 50.0, notes: 'Plate-modulated; warm-up drift significant; check after power cycling' }
        ],
        monitoring_options: [
          { method: 'GPS_COUNTER',    label: 'GPS-disciplined frequency counter',    accuracy_hz: 0.01, cost_usd: 800,  required: true,  notes: 'Primary on-site reference; ±0.01 Hz; GPSDO-locked' },
          { method: 'REMOTE_SDR',     label: 'Software-defined radio (SDR) monitor', accuracy_hz: 1.0,  cost_usd: 350,  required: false, notes: 'RTL-SDR + software; useful for continuous remote monitoring' },
          { method: 'COMMERCIAL_MON', label: 'Commercial frequency monitor',          accuracy_hz: 0.1,  cost_usd: 2500, required: false, notes: 'e.g., Inovonics 223, Belar FMCS-1; integrated with logging' },
          { method: 'THIRD_PARTY',    label: 'Annual third-party frequency check',    accuracy_hz: 0.05, cost_usd: 500,  required: true,  notes: '§73.1540 (carrier frequency measurements): independent verification annually; file in station log' }
        ],
        correction_steps: [
          { step: 1, action: 'IDENTIFY_SOURCE', label: 'Identify drift source',                  time_min: 30, notes: 'Compare transmitter ref output vs. GPS counter; check oscillator temp' },
          { step: 2, action: 'OSCILLATOR_TRIM', label: 'Trim oscillator reference (if in-spec)', time_min: 60, notes: 'Adjust TCXO trimmer or synthesizer offset register; log adjustment' },
          { step: 3, action: 'ATU_CHECK',       label: 'Verify ATU tuning and ground system',    time_min: 45, notes: 'Check base impedance; re-tune if ground saturation has shifted loading' },
          { step: 4, action: 'REDUCE_POWER',    label: 'Reduce power if approaching tolerance',  time_min: 5,  notes: 'If drift >15 Hz, reduce to auxiliary power (§73.1560) until corrected' },
          { step: 5, action: 'LOG_AND_REPORT',  label: 'Log correction in station records',      time_min: 15, notes: '§73.1820: all equipment adjustments logged; preserve GPS counter printout' }
        ],
        reference: '47 CFR §73.1545 (carrier frequency tolerance ±20 Hz); §73.1820 (station logs); §73.1560 (power reduction)',
        note: 'AM frequency tolerance is ±20 Hz (25.64 ppm at 780 kHz) per §73.1545. Modern PLL transmitters operate well within this with <2 Hz typical drift. Annual third-party frequency check required. Monitor after relocation — new site ground conditions may shift ATU tuning slightly.'
      },
      broadcast_attorney_and_consulting_guide: {
        frequency_khz: 780, fcc_class: 'D', pattern_mode: 'NDA',
        attorney_total_typ_usd: 24000,
        engineering_total_typ_usd: 36500,
        combined_total_usd: { low: 39325, typical: 60500, high: 93775 },
        n_professional_services: 9,
        n_required_services: 7,
        professional_services: [
          { type: 'ATTORNEY', service: 'CP Application Filing (Form 301-AM)', required: true, cost_low_usd: 7500, cost_typical_usd: 11500, cost_high_usd: 18000, notes: 'Includes FCC Form 301-AM preparation, environmental review checklist, and NEPA initial screening' },
          { type: 'ATTORNEY', service: 'FCC License Coordination and Correspondence', required: true, cost_low_usd: 2500, cost_typical_usd: 4500, cost_high_usd: 7000, notes: 'Letter of acceptance, informal objection responses, Media Bureau correspondence' },
          { type: 'ATTORNEY', service: 'CP Modification and Amendment Filing', required: true, cost_low_usd: 3000, cost_typical_usd: 5000, cost_high_usd: 9000, notes: 'Minor modifications, second-window amendments, tolling petitions' },
          { type: 'ATTORNEY', service: 'License to Cover Filing (Form 302-AM)', required: true, cost_low_usd: 1500, cost_typical_usd: 3000, cost_high_usd: 5000, notes: 'Form 302-AM preparation, proof-of-performance certification, equipment filing' },
          { type: 'ATTORNEY', service: 'Ongoing FCC Compliance and Annual Reporting', required: false, cost_low_usd: 1000, cost_typical_usd: 2000, cost_high_usd: 4000, notes: 'Optional: FCC ownership reports, public file compliance, license renewal planning' },
          { type: 'ENGINEER', service: 'Site Survey and Propagation Analysis', required: true, cost_low_usd: 3500, cost_typical_usd: 5500, cost_high_usd: 8500, notes: 'Ground conductivity measurement, topographic analysis, ITM/longley-rice propagation modeling' },
          { type: 'ENGINEER', service: 'Antenna System Engineering (NDA)', required: true, cost_low_usd: 5500, cost_typical_usd: 8500, cost_high_usd: 13000, notes: 'Monopole design, impedance matching, ATU specification, grounding system layout' },
          { type: 'ENGINEER', service: 'NDA Proof of Performance', required: true, cost_low_usd: 7000, cost_typical_usd: 11500, cost_high_usd: 18000, notes: 'NDA: 8 cardinal + spot check measurements; inverse-distance field-strength verification per §73.154' },
          { type: 'ENGINEER', service: 'FCC Form 301-AM Technical Exhibits', required: true, cost_low_usd: 3500, cost_typical_usd: 5500, cost_high_usd: 8500, notes: 'Radiation pattern computation, coverage contour map, interference analysis exhibits' },
          { type: 'ENGINEER', service: 'Interference Study (Adjacent/Co-channel)', required: false, cost_low_usd: 3000, cost_typical_usd: 5500, cost_high_usd: 9000, notes: 'Optional but common: D/U ratio analysis vs. protected contours, sky-wave interference, §73.182 compliance verification' }
        ],
        reference: '47 CFR §73.3533; §73.3536; §73.154; §73.182; FCC Form 301-AM; NABOB Engineering Manual',
        note: 'Cost estimates reflect 2024 market rates for experienced broadcast communications attorneys and licensed RF engineers. NDA proof is less costly than full DA proof (72-radial FI traversal). Attorney fees vary by firm size and market.'
      },
      zoning_and_land_use_compliance_guide: {
        frequency_khz: 780, fcc_class: 'D',
        tower_height_m: 96, tower_height_ft: 315,
        setback_m_required: 96, setback_ft_required: 315,
        permit_weeks_low_rural: 8, permit_weeks_high_rural: 24,
        permit_weeks_low_residential: 16, permit_weeks_high_residential: 52,
        preferred_zoning_type: 'AGRICULTURAL',
        n_environmental_triggers: 6,
        environmental_review_triggers: [
          { id: 'HISTORIC', label: 'National Register historic properties in area of effect', cfr: 'FCC §1.1307(a)(4); NHPA §106', note: 'Programmatic Agreement (FCC-ACHP-NCSHPO) governs review; Tower Construction Notification System (TCNS) must be used' },
          { id: 'FLOODPLAIN', label: 'Location in FEMA 100-year floodplain', cfr: 'FCC §1.1307(a)(6); EO 11988', note: 'Floodplain development permit required from local authority; FCC environmental assessment required' },
          { id: 'WETLANDS', label: 'Wetlands present on or adjacent to site', cfr: 'FCC §1.1307(a)(7); CWA §404', note: 'Army Corps of Engineers Section 404 permit required; FCC environmental assessment required' },
          { id: 'ENDANGERED_SPECIES', label: 'Listed species habitat (ESA §7)', cfr: 'FCC §1.1307(a)(3); ESA §7', note: 'FCC consults with USFWS/NMFS; biological opinion required if jeopardy possible; tower lighting affects migratory birds (MBTA)' },
          { id: 'WILDERNESS', label: 'Wilderness, wild/scenic river, or national forest', cfr: 'FCC §1.1307(a)(5)', note: 'Federal land use agency concurrence required; FCC environmental assessment required' },
          { id: 'NATIVE_AMERICAN', label: 'Native American religious or cultural sites (NHPA §106)', cfr: 'FCC §1.1307(a)(4); NHPA §106', note: 'Tribal consultation required via TCNS; 30-day tribal comment period mandatory for all new tower construction' }
        ],
        n_local_permits: 4, n_required_local_permits: 2,
        local_permits: [
          { id: 'BUILDING_PERMIT', label: 'Building permit', required: true, typical_weeks: 4, typical_cost_usd: 2000, notes: 'Structural plans and TIA-222-H analysis required; building official must approve' },
          { id: 'USE_PERMIT', label: 'Use permit / conditional use permit (CUP)', required: true, typical_weeks: 12, typical_cost_usd: 3000, notes: 'Public hearing typically required; neighbors notified within 300–500ft; planning commission approval' },
          { id: 'GRADING_PERMIT', label: 'Grading and drainage permit', required: false, typical_weeks: 3, typical_cost_usd: 1500, notes: 'Required if site grading exceeds local threshold (typically >50 cy of cut/fill)' },
          { id: 'ENCROACHMENT', label: 'Road encroachment permit', required: false, typical_weeks: 2, typical_cost_usd: 500, notes: 'Required if construction access requires disturbing public right-of-way' }
        ],
        total_permit_cost_usd: 7000,
        tca_preemption_applies: false,
        fcc_env_review_cfr: '47 CFR §1.1307',
        nhpa_section_106_required: true, tribal_consultation_required: true,
        reference: 'TCA §332(c)(7); 47 CFR §1.1307 (environmental review); NHPA §106; ESA §7; CWA §404; FCC-ACHP-NCSHPO Programmatic Agreement; FEMA National Flood Insurance Program',
        note: 'Tower: 315ft (96m), setback ≥315ft (fall zone). Preferred zone: agricultural/industrial. Permit timeline: 8–24 wks (rural) or 16–52 wks (residential). TCA §332(c)(7) does NOT preempt local zoning for AM broadcast towers. 6 federal environmental review triggers. NHPA §106 tribal consultation required.'
      },
      faa_obstruction_marking_guide: {
        frequency_khz: 780, fcc_class: 'D',
        tower_height_m: 96, tower_height_ft: 315,
        asr_required_by_height: true, asr_height_threshold_m: 60.96, asr_height_threshold_ft: 200,
        faa_lighting_tier: 'L-810_RED_STEADY',
        n_paint_bands: 7, painting_required: true,
        painting_cost_usd: 1733, lighting_cost_usd: 8000, total_marking_cost_usd: 9733,
        rf_decoupling_required: true, monitoring_required: true, annual_inspection_required: true,
        asr_cfr: '47 CFR §17.7', painting_cfr: '47 CFR §17.23',
        lighting_cfr: '47 CFR §17.47', monitoring_cfr: '47 CFR §17.48',
        faa_ac: 'FAA AC 70/7460-1M',
        reference: '47 CFR §17.7 (ASR registration); §17.23 (painting); §17.47 (lighting); §17.48 (monitoring); FAA Advisory Circular 70/7460-1M; FCC Form 854 (ASR update)',
        note: 'Tower: 315ft (96m, λ/4 at 780 kHz). ASR required (>200ft). FAA tier: L-810_RED_STEADY. 7 paint bands (§17.23), cost ~$1,733. Lighting cost: ~$8,000. RF decoupling required on lighting cables.'
      },
      antenna_tuning_unit_commissioning_guide: {
        frequency_khz: 780, fcc_class: 'D', pattern_mode: 'NDA',
        is_da: false, n_towers: 1, lambda_quarter_m: 96,
        base_resistance_ohm_typical: 36, ground_series_r_typical_ohm: 3,
        antenna_efficiency_pct: 92, base_current_rms_a: 11.79, tpo_kw: 5,
        atu_cost_per_tower_usd_typ: 12000, phasor_cost_usd: 0,
        total_atu_cost_usd: { low: 7800, typical: 12000, high: 19200 },
        commissioning_days_low: 2, commissioning_days_high: 5,
        n_commissioning_steps: 5,
        commissioning_steps: [
          { step: 1, action: 'Pre-installation base impedance measurement', detail: 'Measure tower base impedance (R + jX) with calibrated antenna analyzer at 780 kHz; record measured Ra and Xa; compare to theoretical (36Ω + j0 at λ/4)', equipment: 'Antenna analyzer (e.g., RigExpert AA-2000 or AIM 4170)' },
          { step: 2, action: 'ATU design and fabrication', detail: 'Design L/T/π network to transform measured base impedance to 50Ω; specify component L and C values; use RF-rated components with adequate current/voltage rating', equipment: 'ATU fabrication (commercial or custom)' },
          { step: 3, action: 'Low-power coarse tune (10W test transmitter)', detail: 'Inject 10W at 780 kHz; adjust ATU for minimum reflected power; verify SWR < 1.5:1 before increasing power', equipment: 'Lab transmitter or signal generator + RF amplifier' },
          { step: 4, action: 'Full-power fine tune and SWR verification', detail: 'Increase to licensed power (5 kW TPO); fine-tune for minimum SWR; target SWR < 1.1:1; record final L and C settings', equipment: 'Directional wattmeter (e.g., Bird 43 or equivalent)' },
          { step: 5, action: 'Base current calibration and documentation', detail: 'Calibrate base current meter to read licensed current value; verify operating power within +5%/-10% per §73.1560(a); document settings for FCC records', equipment: 'Base current meter (e.g., Deltec or Potomac Instruments)' }
        ],
        current_tolerance_pct: 5, phase_tolerance_deg: null, ratio_tolerance_pct: null,
        current_tolerance_cfr: '47 CFR §73.1560(a)', da_tolerance_cfr: null,
        frequency_tolerance_hz: 20, frequency_tolerance_cfr: '47 CFR §73.1545',
        reference: '47 CFR §73.1560 (operating power tolerance); §73.61 (base current monitoring); §73.1545 (frequency tolerance); §73.49 (RF fencing); ARRL Antenna Handbook (ATU design); Terman (1943) antenna impedance',
        note: 'NDA 780 kHz, λ/4=96m. Base resistance ~36Ω; base current ~11.79A rms at 5 kW. ATU cost: $7,800–$19,200 (typ. $12,000). Commissioning: 2–5 days. Antenna efficiency: ~92% with 120-radial system.'
      },
      tower_construction_contract_guide: {
        frequency_khz: 780, fcc_class: 'D',
        pattern_mode: 'NDA', is_da: false, n_towers: 1,
        tower_height_m: 96, tower_height_ft: 315, tpo_kw: 5,
        per_tower_erection_cost_usd: 7087,
        per_tower_foundation_cost_usd: 50000,
        per_tower_guying_cost_usd: 25000,
        per_tower_painting_cost_usd: 1418,
        per_tower_lighting_cost_usd: 15000,
        per_tower_site_prep_cost_usd: 15000,
        per_tower_atu_building_cost_usd: 40000,
        per_tower_total_cost_usd: 153505,
        total_estimated_cost_usd: { low: 107453, typical: 153505, high: 222582 },
        excludes_ground_radials: true,
        excludes_proof_engineering: true,
        n_key_contract_clauses: 7,
        n_required_clauses: 5,
        key_contract_clauses: [
          { id: 'PERFORMANCE_BOND', label: 'Performance bond (10% of contract value)', required: true, note: 'Protects licensee if contractor defaults during CP construction period; CP has finite term and delays can cause permit expiration' },
          { id: 'OSHA_COMPLIANCE', label: 'OSHA 1926 Subpart R compliance certification', required: true, note: 'Tower erection is high-hazard work; contractor must certify competent person designation, fall protection plan, and daily pre-task planning' },
          { id: 'TIA222_CERT', label: 'TIA-222-H structural compliance documentation', required: true, note: "Tower manufacturer's structural analysis letter for proposed height, loading, and soil class; required for building permit and FCC filing" },
          { id: 'FAA_COORD', label: 'FAA ASR coordination and lighting commissioning', required: true, note: 'Contractor must coordinate FAA painting/lighting installation and commissioning; aviation orange/white marking per §17.23; lighting per FAA AC 70/7460-1' },
          { id: 'LIQUIDATED_DAMAGES', label: 'Liquidated damages clause (CP deadline protection)', required: true, note: 'CP expires 3 years from grant; specify per-day damages for delays that put CP expiration at risk; AM construction timelines frequently slip' },
          { id: 'CHANGE_ORDER_CONTROL', label: 'Change order approval threshold ($500)', required: false, note: 'Require written station engineer approval for any change order >$500; AM towers accumulate significant change orders during erection' },
          { id: 'RADIO_FREQ_AWARENESS', label: 'RF awareness clause for ground radial installation', required: false, note: 'Ground radial contractor must not use metallic equipment across radials until radial system is complete and detuned; RF burns can occur during testing' }
        ],
        timeline_weeks_low: 12, timeline_weeks_high: 28, timeline_weeks_typ: 20,
        nate_certification_preferred: true,
        reference: 'OSHA 1926 Subpart R; ANSI/TIA-222-H; 47 CFR §17.23; FAA AC 70/7460-1; NATE tower industry standards; FCC Form 301-AM / CP requirements (§73.3533)',
        note: 'NDA 780 kHz, tower height ~315ft (λ/4). Construction cost estimate: $107,453–$222,582 (typ. $153,505) excluding ground radials and proof engineering. Timeline: 12–28 weeks (typ. 20).'
      },
      ground_radial_installation_cost_guide: {
        frequency_khz: 780, fcc_class: 'D',
        pattern_mode: 'NDA', is_da: false, n_towers: 1,
        wavelength_m: 385, lambda_quarter_m: 96, lambda_half_m: 192,
        n_radials: 120, radial_length_m: 96, total_wire_length_m: 11520,
        copper_cost_per_m: 0.95, trench_cost_per_m: 3.5,
        ground_ring_cost_usd: 3500, bonding_testing_cost_usd: 2000,
        engineering_supervision_cost_usd: 3500, equipment_rental_cost_usd: 4000,
        per_tower_wire_cost_usd: 10944, per_tower_trench_cost_usd: 40320, per_tower_fixed_cost_usd: 13000,
        per_tower_total_cost_usd: 64264,
        total_estimated_cost_usd: { low: 48198, typical: 64264, high: 96396 },
        half_wave_upgrade_cost_usd: 51264,
        copper_lbs_total: 114,
        fcc_minimum_radials: 120, radial_cfr: '47 CFR §73.190',
        reference: '47 CFR §73.190 (AM ground system); FCC AM Engineering Handbook; Terman (1943) radial ground system efficiency; ARRL Antenna Book (copper wire specifications)',
        note: '780 kHz, λ/4=96m. Standard ground system: 120 radials × 96m = 11,520m total wire. Estimated cost: $48,198–$96,396 (typ. $64,264). Half-wave upgrade adds ~$51,264.'
      },
      frequency_coordination_with_adjacent_stations_guide: {
        frequency_khz: 780, fcc_class: 'D',
        pattern_mode: 'NDA',
        is_da: false,
        channel_type: 'CLEAR',
        is_clear_channel: true,
        is_local_channel: false,
        is_secondary_on_clear: true,
        skywave_protection_required: false,
        n_du_ratio_pairs: 4,
        du_protection_ratios: [
          { offset_khz: 0,  label: 'Co-channel',      du_ratio_db: 20, field_ratio: 10.0, cfr: '§73.182' },
          { offset_khz: 10, label: 'First adjacent',  du_ratio_db: 6,  field_ratio: 2.0,  cfr: '§73.182(r) / §73.37(a)' },
          { offset_khz: 20, label: 'Second adjacent', du_ratio_db: 0,  field_ratio: 1.0,  cfr: '§73.182(r)' },
          { offset_khz: 30, label: 'Third adjacent',  du_ratio_db: -6, field_ratio: 0.5,  cfr: 'Engineering practice' }
        ],
        co_channel_du_ratio_db: 20,
        first_adj_du_ratio_db: 6,
        second_adj_du_ratio_db: 0,
        separation_minimums_km: {
          co_channel_class_a: 800, co_channel_class_b: 640, co_channel_class_c: 480, co_channel_class_d: 320,
          first_adj_class_a: 400, first_adj_class_b: 320, second_adj_class_a: 200, second_adj_class_b: 160
        },
        n_coordination_steps: 5,
        coordination_steps: [
          { step: 1, action: 'Co-channel station inventory within 1500 km', detail: 'Pull all co-channel AM stations from FCC LMS; compute daytime 0.5 mV/m and 2 mV/m contour intersections with proposed site coordinates', tool: 'FCC LMS / AM Query tool', cfr: '§73.182' },
          { step: 2, action: 'Adjacent-channel station inventory within 500 km', detail: 'Pull all ±10 kHz and ±20 kHz channel stations from LMS; apply §73.37 minimum separation table; flag any potential short-spacing', tool: 'FCC LMS', cfr: '§73.37' },
          { step: 3, action: 'D/U interference analysis for short-spaced stations', detail: 'For any station within §73.37 minimum separation distance, compute ITM/Longley-Rice predicted field strengths and D/U ratios at protected contours; document compliance or interference', tool: 'FCC AM interference calculator / ITM', cfr: '§73.37; §73.182' },
          { step: 4, action: 'Night-time skywave analysis (clear channel)', detail: '780 kHz is a CLEAR CHANNEL; night-time skywave from Class A dominant (e.g., WBBM/Chicago) must be protected; Class D secondary stations must not increase interference to dominant station\'s 0.5 mV/m contour', tool: 'FCC skywave prediction model', cfr: '§73.182(a); §73.24(b)' },
          { step: 5, action: 'Coordination agreement with affected stations (if needed)', detail: 'If interference analysis shows potential impact, negotiate engineering agreement with affected station; document agreement as exhibit to FCC Form 301-AM', tool: 'Direct station-to-station contact', cfr: '§73.37(b); §73.525' }
        ],
        interference_analysis_required: true,
        form_exhibit_required: true,
        reference: '47 CFR §73.182 (dominant station protection); §73.37 (minimum separation); §73.37(b) (short-spacing); §73.24(b) (clear channels); §73.525 (engineering agreements); ITU-R BS.560',
        note: '780 kHz CLEAR channel, Class D (SECONDARY on clear channel — must protect Class A dominant). D/U ratios: co-channel ≥20 dB, 1st-adj ≥6 dB, 2nd-adj ≥0 dB. 5 coordination steps required. Night-time: secondary status; must not increase Class A interference.'
      },
      remote_control_authority_guide: {
        frequency_khz: 780, fcc_class: 'D',
        pattern_mode: 'NDA',
        is_da: false,
        n_towers_monitored: 1,
        remote_control_authorized: true,
        remote_control_cfr: '47 CFR §73.1350',
        ats_authorized: true,
        ats_cfr: '47 CFR §73.1400',
        n_rc_components: 7,
        n_required_components: 5,
        rc_components: [
          { id: 'IP_REMOTE', label: 'IP-based remote control unit (RCU)', required: true, examples: 'Burk ARC-16, Davicom DV216, WorldCast Plexus', typical_cost_usd: 3500, cfr: '§73.1350(a)' },
          { id: 'BASE_CURRENT_METERS', label: 'Base current meter (1 tower)', required: true, examples: 'Deltec, Potomac Instruments, Bird', typical_cost_usd: 1200, cfr: '§73.1350(b)(3); §73.61' },
          { id: 'PLATE_TELEMETRY', label: 'Plate voltage/current telemetry', required: true, examples: 'Transmitter built-in metering or external transducer', typical_cost_usd: 500, cfr: '§73.1350(b)(5)' },
          { id: 'MOD_MONITOR', label: 'Modulation monitor', required: true, examples: 'Orban 9200AM, CRL Systems, Inovonics 531', typical_cost_usd: 2500, cfr: '§73.1570; §73.1350(b)(4)' },
          { id: 'FREQ_MONITOR', label: 'Frequency monitor', required: true, examples: 'Belar FMS-1, ERI Model 100', typical_cost_usd: 2000, cfr: '§73.1215 (monitor required); §73.1545 (±20 Hz tolerance)' },
          { id: 'CELLULAR_DATA', label: 'Cellular data backup for remote control link', required: false, examples: 'LTE/4G cellular modem; redundant to primary internet', typical_cost_usd: 150, cfr: 'Engineering best practice' },
          { id: 'ATS', label: 'Automatic Transmission System (ATS) for unattended operation', required: false, examples: 'Built into Burk ARC or standalone ATS controller', typical_cost_usd: 2000, cfr: '§73.1400' }
        ],
        total_equipment_cost_usd: 11850,
        required_equipment_cost_usd: 9700,
        n_ats_thresholds: 5,
        ats_thresholds: [
          { parameter: 'Modulation (positive)', limit: '100%', action: 'Reduce modulation; alert operator', cfr: '§73.1570' },
          { parameter: 'Modulation (negative)', limit: '125%', action: 'Reduce modulation; alert operator', cfr: '§73.1570' },
          { parameter: 'Loss of modulation', limit: '3 hours continuous', action: 'Alert operator; automatic off-air after timeout', cfr: '§73.1400(b)' },
          { parameter: 'Carrier frequency', limit: '±20 Hz (AM)', action: 'Alert operator; FCC §73.1545', cfr: '§73.1545' },
          { parameter: 'Power reduction', limit: 'Any fault condition', action: 'Reduce to 10% TPO or off-air per §73.1350', cfr: '§73.1350(e)' }
        ],
        da_phasor_monitoring: null,
        frequency_tolerance_hz: 20,
        modulation_limit_positive_pct: 100,
        modulation_limit_negative_pct: 125,
        control_point_license_copy_required: true,
        reference: '47 CFR §73.1350 (remote control); §73.1400 (ATS); §73.61 (base current monitoring); §73.1545 (frequency tolerance); §73.1570 (modulation monitor)',
        note: 'NDA 780 kHz: remote control authorized §73.1350. ATS (unattended) authorized §73.1400. 5 required RC components, $9,700 estimated cost. 1 tower monitored. Frequency tolerance ±20 Hz (§73.1545).'
      },
      fcc_silent_station_authorization_guide: {
        frequency_khz: 780, fcc_class: 'D',
        pattern_mode: 'NDA',
        is_da: false,
        silent_days_auto_allowed: 10,
        silent_months_forfeiture: 12,
        silence_estimate_days_min: 30,
        silence_estimate_days_max: 120,
        silence_estimate_days_typ: 60,
        sta_required: true,
        sta_cfr: '47 CFR §73.1635',
        forfeiture_risk: false,
        forfeiture_cfr: '47 CFR §73.1740(a)(1)',
        notification_cfr: '47 CFR §73.1740(b)',
        n_sta_requirements: 4,
        sta_requirements: [
          { id: 'FILING_FEE', label: 'FCC STA filing fee', detail: 'No fee for STA if related to CP construction', cost_usd: 0 },
          { id: 'LETTER_REQUEST', label: 'Written STA request to FCC Media Bureau', detail: 'Describe reason for silence, expected duration, and steps being taken to return to air; cite §73.1635 and §73.1740', cost_usd: 0 },
          { id: 'CP_REFERENCE', label: 'Reference Construction Permit number', detail: 'Include CP file number in STA request to establish nexus between silence and authorized construction', cost_usd: 0 },
          { id: 'MILESTONE_REPORT', label: 'Quarterly progress reports if silence > 90 days', detail: 'FCC Media Bureau may request periodic construction progress updates; document tower erection, ground radial installation, transmitter installation milestones', cost_usd: 0 }
        ],
        translator_continuity_available: true,
        translator_cfr: 'FCC MB Docket 13-249',
        n_silence_minimization_strategies: 4,
        silence_minimization_strategies: [
          { strategy: 'PARALLEL_OPERATION', label: 'Operate old site until new site ready', detail: 'Do not demolish old tower until Form 302-AM filed at new site; this may require temporary dual-site operation costs but avoids prolonged silence', risk_reduction: 'ELIMINATES silence beyond transition day' },
          { strategy: 'TEMP_TRANSMITTER', label: 'Temporary low-power operation at new site', detail: 'Commission FCC STA to operate temporary low-power (e.g., 10W) transmitter at new site for testing before proof; not a substitute for final proof but enables equipment commissioning', risk_reduction: 'REDUCES proof timeline by 2–4 weeks' },
          { strategy: 'TRANSLATOR_BACKUP', label: 'AM-to-FM translator maintains service continuity', detail: 'If station has authorized AM-to-FM translator, translator continues operating during main station silence; listeners maintain FM service; FCC MB 13-249', risk_reduction: 'MAINTAINS listener service during silence' },
          { strategy: 'EXPEDITED_PROOF', label: 'Expedited proof-of-performance contractor', detail: 'Hire experienced AM proof contractor who can mobilize quickly; some contractors can complete NDA proof in 2–3 weeks vs. 8–12 weeks for less experienced teams', risk_reduction: 'REDUCES proof timeline by 50%' }
        ],
        preferred_strategy: 'PARALLEL_OPERATION',
        reference: '47 CFR §73.1635 (STA); §73.1740 (silent station); §73.1635(a)(1); FCC MB Docket 13-249 (AM translators); FCC Form 399 (emergency authorization)',
        note: 'NDA station relocation silence estimate: 30–120 days (typ. 60). STA REQUIRED (§73.1635). Forfeiture risk at 12 months (§73.1740). Best strategy: maintain old site until new site proof complete. Translator continuity available per MB 13-249.'
      },
      antenna_rfi_from_nearby_equipment_guide: {
        frequency_khz: 780, fcc_class: 'D',
        frequency_sensitivity: 'HIGH',
        wavelength_m: 385,
        lambda_quarter_m: 96,
        part15_limit_uv_m: 30,
        part15_test_distance_m: 30,
        n_rfi_source_categories: 6,
        n_high_severity_sources: 3,
        rfi_source_categories: [
          { id: 'POWER_LINE_HV', label: 'High-voltage transmission lines (69kV+)', recommended_clearance_m: 500, noise_floor_impact_db: 20, severity: 'HIGH', cfr: '§15.5(b); §15.109(f)', mitigation: 'Choose site ≥500m from 69kV+ lines; request utility "corona audit" of nearest spans; document pre-construction noise floor via spectrum analyzer sweep' },
          { id: 'SOLAR_INVERTER', label: 'Grid-tied solar inverter farms', recommended_clearance_m: 300, noise_floor_impact_db: 15, severity: 'HIGH', cfr: '§15.109; §15.5(b)', mitigation: 'Modern string inverters generate broadband switching noise 50 kHz–30 MHz; identify solar installations within 500m via satellite imagery; measure noise floor before site selection' },
          { id: 'LED_STREET_LIGHT', label: 'LED street lighting with switching drivers', recommended_clearance_m: 150, noise_floor_impact_db: 10, severity: 'MEDIUM', cfr: '§15.109; §15.107', mitigation: 'LED retrofit programs in municipal lighting often create widespread LF RFI; measure noise floor at candidate site during night-time LED operation; prefer sites outside LED lighting corridors' },
          { id: 'DATA_CENTER', label: 'Data centers and large UPS systems', recommended_clearance_m: 400, noise_floor_impact_db: 18, severity: 'HIGH', cfr: '§15.109; §15.107', mitigation: 'UPS systems, server PDUs, and cooling VFDs generate pervasive switching noise; avoid industrial parks with known data center presence within 400m of proposed antenna' },
          { id: 'INDUSTRIAL_VFD', label: 'Industrial variable-frequency drives (VFDs)', recommended_clearance_m: 200, noise_floor_impact_db: 12, severity: 'MEDIUM', cfr: '§15.109; §15.107', mitigation: 'Manufacturing facilities with large HVAC or motor-drive VFDs are significant LF noise sources; review land use maps for industrial zoning within 300m of candidate site' },
          { id: 'SWITCHING_PS', label: 'Residential switching power supplies (aggregate)', recommended_clearance_m: 50, noise_floor_impact_db: 5, severity: 'LOW', cfr: '§15.109', mitigation: 'Individual residential SMPS are low-impact but dense residential areas create aggregate noise floor elevation; prefer rural sites over dense residential subdivisions immediately adjacent' }
        ],
        pre_construction_survey_required: true,
        n_survey_steps: 5,
        survey_protocol: [
          { step: 1, action: 'Wideband spectrum sweep', detail: 'Conduct 100 kHz–2 MHz spectrum sweep at proposed antenna base location using calibrated field strength meter; record noise floor at 780 kHz ±10 kHz passband', equipment: 'Calibrated EMI receiver or spectrum analyzer with whip antenna', timing: 'Before site commitment' },
          { step: 2, action: 'Power line noise survey', detail: 'Walk transmission line right-of-way within 1km of site using AM receiver; listen for buzzing, crackling, or hash noise; note utility pole numbers for reporting', equipment: 'Portable AM receiver (e.g., Icom IC-R75)', timing: 'Before site commitment' },
          { step: 3, action: 'Nighttime LED lighting check', detail: 'Survey site at night with AM receiver; note degradation when street lights are active vs. off; identify luminaire locations on municipal map', equipment: 'Portable AM receiver', timing: 'Before site commitment' },
          { step: 4, action: 'Noise floor documentation', detail: 'Record 24-hour noise floor measurement at candidate site; note diurnal variation; compare to ITU-R P.372 ambient noise curves for rural/residential/industrial environments', equipment: 'Calibrated field strength meter with data logger', timing: 'Before site commitment' },
          { step: 5, action: 'FCC complaint pathway', detail: 'If harmful interference from Part 15 device confirmed post-construction, file complaint with FCC Enforcement Bureau per §15.5(b); utility power line noise may require separate coordination under §15.109(f)', equipment: 'Documentation of interference measurements', timing: 'Post-construction if needed' }
        ],
        estimated_survey_cost_usd: { low: 800, typical: 1500, high: 3500 },
        noise_headroom_db_min: 20,
        power_line_clearance_m: 500,
        solar_inverter_clearance_m: 300,
        data_center_clearance_m: 400,
        fcc_enforcement_pathway: '§15.5(b) harmful interference complaint to FCC Enforcement Bureau',
        reference: '47 CFR §15.5(b); §15.107; §15.109; §15.109(f); ITU-R P.372-15 (radio noise); FCC Enforcement Advisory EA-2016-01',
        note: 'AM 780 kHz (HIGH RFI sensitivity, λ/4=96m). Part 15 limit: 30 µV/m at 30m. 6 RFI source categories assessed (3 HIGH severity). Pre-construction spectrum survey required. Power line clearance ≥500m; solar inverter clearance ≥300m.'
      },
      neighboring_landowner_notification_guide: {
        frequency_khz: 780, fcc_class: 'D',
        fcc_public_notice_required: true,
        fcc_public_notice_weeks: 2,
        fcc_public_notice_cfr: '§73.3580',
        zoning_notice_radius_ft: 500,
        zoning_notice_radius_m: 152,
        recommended_notice_radius_km: 2,
        rf_safety_radius_m: 30,
        n_notification_methods: 5,
        n_required_methods: 2,
        notification_methods: [
          { id: 'FCC_PUBLIC_NOTICE', label: 'FCC public notice (§73.3580)', required: true, description: 'Published in a newspaper of general circulation in the community of license for 2 consecutive weeks before filing; must include application filing date, facility ID, and contact information', typical_cost_usd: 300 },
          { id: 'CERTIFIED_MAIL', label: 'Certified mail to adjacent landowners', required: true, description: 'Written notification sent via USPS certified mail to all landowners within recommended notice radius; provides documented delivery for FCC record', typical_cost_usd: 150 },
          { id: 'IN_PERSON', label: 'In-person community meeting', required: false, description: 'Optional but highly recommended for contested sites; allows Q&A on RF safety, tower aesthetics, and property values; significantly reduces formal opposition', typical_cost_usd: 500 },
          { id: 'LOCAL_GOV', label: 'Local government courtesy notice', required: false, description: 'Proactive notice to city/county planning department, zoning board, and local elected officials; reduces risk of zoning opposition coordinated through government channels', typical_cost_usd: 0 },
          { id: 'RF_SAFETY_INFO', label: 'RF safety information packet', required: false, description: 'Distribute FCC OET Bulletin 56 plain-language RF safety summary; address misconceptions about AM tower health effects; include site-specific MPE analysis results', typical_cost_usd: 100 }
        ],
        n_opposition_concerns: 5,
        opposition_mitigation: [
          { concern: 'RF radiation health fears', severity: 'HIGH', mitigation: 'Provide FCC OET Bulletin 56 plain-language summary; show site-specific MPE analysis confirming compliance with §1.1310 general population limits; offer open site tours', cfr_support: '§1.1310; OET Bulletin 56; OET Bulletin 65' },
          { concern: 'Property value impacts', severity: 'HIGH', mitigation: 'Commission independent property value study for comparable tower sites; provide real estate data showing minimal impact in similar markets; offer property value guarantee agreement', cfr_support: 'N/A (private law matter)' },
          { concern: 'Tower aesthetics and view obstruction', severity: 'MEDIUM', mitigation: 'Share tower design renderings; propose lighting minimization plan per FAA §17.23 requirements; consider stealth design if structurally feasible; propose landscaping buffer', cfr_support: '47 CFR §17.23; FAA Advisory Circular 70/7460-1' },
          { concern: 'Construction noise and traffic', severity: 'MEDIUM', mitigation: 'Provide construction schedule with noise mitigation plan; commit to daylight-only construction hours; designate dedicated construction access route minimizing residential traffic', cfr_support: 'N/A (local ordinance)' },
          { concern: 'Emergency access and security', severity: 'LOW', mitigation: 'Provide site security plan per §73.49 fence requirements; include emergency services contact plan; agree to immediate shut-down protocol for emergency RF safety incidents', cfr_support: '47 CFR §73.49' }
        ],
        estimated_total_notification_cost_usd: { low: 800, typical: 1400, high: 3000 },
        opposition_risk: 'MEDIUM',
        relocation_note: 'FCC public notice required per §73.3580 (2 weeks in local newspaper before filing). Additional outreach to landowners within 2km radius is not FCC-required but significantly reduces formal opposition risk. RF safety concerns are the highest-severity issue; provide OET Bulletin 56 materials and site-specific MPE analysis.',
        reference: '47 CFR §73.3580; §73.49; §1.1310; OET Bulletin 56; OET Bulletin 65; FCC Media Bureau public notice requirements',
        note: 'FCC §73.3580 public notice required (2 weeks). Proactive outreach within 2km recommended. 5 notification methods (2 required). 5 opposition concerns with mitigation strategies.'
      },
      transmitter_insurance_guide: {
        frequency_khz: 780, fcc_class: 'D',
        tpo_kw: 5,
        transmitter_value_usd: 75000,
        tower_value_usd: 275000,
        atu_value_usd: 14000,
        ancillary_value_usd: 12000,
        building_value_usd: 40000,
        estimated_equipment_value_usd: 416000,
        tower_covered: true,
        coverage_types: [
          { id: 'BEF', label: 'Broadcast Equipment Floater', value_usd: 101000, coverage: 'Replacement cost; transmitter, ATU, EAS, STL', carrier_examples: "Chubb, Lloyd's, Navigators" },
          { id: 'TOWER', label: 'Tower and Structure Coverage', value_usd: 275000, coverage: 'Wind, ice, lightning, aircraft strike; guyed tower at new site', note: 'List by ASR number and replacement value' },
          { id: 'BUILDING', label: 'Transmitter Building Coverage', value_usd: 40000, coverage: 'Fire, wind, hail, vandalism at transmitter building' },
          { id: 'GL', label: 'General Liability', value_usd: null, coverage: 'Bodily injury/property damage; $1M per occurrence / $2M aggregate minimum', note: 'AM towers attract unauthorized climbers; §73.49 fence required but insufficient alone' },
          { id: 'BI', label: 'Business Interruption', value_usd: null, coverage: '72-hour waiting period; should exceed 10 days (§73.1740 silent station rule)', note: 'Off-air revenue loss: ~$1,000–$3,000/day for small AM' }
        ],
        n_coverage_types: 5,
        estimated_annual_premium_usd: { low: 3328, typical: 4160, high: 6240 },
        relocation_steps: [
          { priority: 1, action: 'Update BEF schedule with new site address and equipment', detail: 'Notify insurer of new transmitter site before moving equipment; coverage may lapse if insurer not notified', timeline: 'Before equipment move' },
          { priority: 2, action: 'Add new tower to structure coverage', detail: 'New tower must be listed by ASR number and replacement value; old tower coverage ends when decommissioned', timeline: 'Upon CP grant / tower erection' },
          { priority: 3, action: 'Update GL policy with new site address', detail: 'General liability must name new site as covered location; blanket site coverage may or may not automatically include new site', timeline: 'Before going on-air at new site' },
          { priority: 4, action: 'Confirm BI coverage covers silent period during move', detail: 'Some BI policies require a covered physical peril; a planned move may not trigger BI — separate coverage for planned outage may be needed', timeline: 'Before construction begins' }
        ],
        silent_station_rule_days: 10,
        relocation_note: 'Total insured value: ~$416,000 (transmitter $75,000 + tower $275,000 + ATU + building). Estimated annual premium: $4,160 (~1% rate). Update all policies before equipment moves. Business interruption should exceed 10 days (§73.1740 silent station rule).',
        reference: '47 CFR §73.49; §73.1740; §17.7 (ASR); NFPA 101; standard broadcast insurance underwriting guidelines',
        note: 'Broadcast equipment insurance: $416,000 insured value. Annual premium ~$4,160. 5 coverage types including BEF, tower, GL, and BI. Update all policies before site move.'
      },
      signal_booster_prohibited_guide: {
        frequency_khz: 780, fcc_class: 'D',
        am_booster_authorized: false,
        am_translator_authorized: true,
        n_legal_alternatives: 5,
        legal_alternatives: [
          { id: 'RELOCATION', label: 'Main transmitter relocation (this optimizer)', cfr: '§73.3533; §73.3536', authorized: true, note: 'Move transmitter to better site for coverage improvement — requires FCC CP and construction' },
          { id: 'AM_TRANSLATOR', label: 'AM-to-FM translator', cfr: '§74.1201; MB 13-249', authorized: true, note: 'FCC authorized AM-to-FM translator service; 250W ERP FM fill-in translator within AM contour' },
          { id: 'IBOC_HD', label: 'AM HD Radio (IBOC digital sidebands)', cfr: '§73.404 (IBOC); MB Docket 99-325', authorized: true, note: 'Digital audio sidebands on AM carrier; improves quality and perceived coverage; requires separate FCC authorization' },
          { id: 'PART15_CC', label: 'Part 15 carrier current (in-building only)', cfr: '§15.221', authorized: true, note: 'Unlicensed; power limit 100 mW; effective only inside the building connected to the power line; not practical for area coverage' },
          { id: 'NEW_STATION', label: 'New AM station at a different frequency', cfr: '§73.3533; §73.21', authorized: true, note: 'Requires full FCC application, auction if competing applications, and separate license; very expensive' }
        ],
        prohibited_devices: [
          { id: 'AM_BOOSTER', label: 'AM broadcast booster/repeater', cfr: '§73.1660', prohibited: true, note: 'FCC does not authorize AM boosters; any device retransmitting AM on the same frequency at another location is illegal' },
          { id: 'UNAUTH_TX', label: 'Unauthorized AM transmitter', cfr: '§301; §503(b)', prohibited: true, note: 'Operating any radio transmitter without FCC license is illegal; penalties up to $10,000/day and equipment seizure' },
          { id: 'PART15_EXCEED', label: 'Part 15 AM device exceeding limits', cfr: '§15.209; §15.5', prohibited: true, note: 'Part 15 AM devices have strict field strength limits (250 µV/m at 30m for 535–1705 kHz); exceeding limits is prohibited' }
        ],
        n_prohibited: 3,
        forfeiture_risk_usd: { unauthorized_transmitter: { low: 10000, typical: 15000, high: 25000 }, part15_violation: { low: 4000, typical: 8000, high: 15000 }, typical: 15000 },
        best_legal_option: 'RELOCATION',
        part15_limit_uv_m: 250,
        relocation_note: 'AM broadcast boosters are NOT authorized (§73.1660). The legally correct approach to coverage improvement is transmitter relocation (this optimizer), an AM-to-FM translator (§74.1201), or AM HD Radio. Unauthorized AM repeater devices can result in $10,000–$25,000 FCC forfeitures.',
        reference: '47 CFR §73.1660; §73.404 (IBOC); §74.1201; §15.209; §15.221; §15.5; §301; §503(b); MB Docket 99-325 (AM IBOC); MB 13-249 (AM revitalization)',
        note: 'AM boosters: PROHIBITED (§73.1660). 5 legal alternatives available. Best option: transmitter relocation. AM-to-FM translator also authorized. Unauthorized booster forfeiture: $10k–$25k (§503b).'
      },
      community_of_license_change_guide: {
        frequency_khz: 780, fcc_class: 'D',
        col_centroid: { lat: 34.7418, lon: -112.0110 },
        distance_from_col_km: 12.4,
        triggers_col_change: false,
        col_change_risk: 'LOW',
        auction_required: 'UNLIKELY',
        col_contour_threshold_mv_m: 5,
        col_service_cfr: '§73.24(i)',
        col_change_risks: [
          { risk: 'Principal community contour failure', cfr: '§73.24(i); §73.3571', description: '5 mV/m daytime contour must cover the COL (entire community for new stations; ≥50% of area or population for modifications)', severity: 'CRITICAL' },
          { risk: 'Unauthorized COL change', cfr: '§73.3571(b)', description: 'Relocating without maintaining COL service may constitute an unauthorized COL change', severity: 'HIGH' },
          { risk: 'Forfeiture exposure', cfr: '§503(b)', description: 'FCC NAL for unauthorized COL change; typically $4,000–$20,000 per §503(b) guidelines', severity: 'HIGH' },
          { risk: 'Auction exposure', cfr: '§73.3571(b)', description: 'A major COL change that draws competing applications may trigger spectrum auction', severity: 'MEDIUM' }
        ],
        col_preservation_strategies: [
          { priority: 1, action: 'Verify 5 mV/m contour over COL at each candidate site', detail: 'Run FCC curves (§73.190) to confirm daytime 5 mV/m contour covers the COL per §73.24(i) (≥50% of area or population for modifications)', cfr: '§73.24(i)' },
          { priority: 2, action: 'Document COL coverage in Form 301-AM contour exhibit', detail: 'Include COL boundary on contour map exhibit; show that the COL is covered by the 5 mV/m daytime contour', cfr: '§73.3533; §73.3571' },
          { priority: 3, action: 'Consider directional antenna to maintain COL service', detail: 'If NDA relocation degrades COL service, a DA pattern with a stronger lobe toward COL may preserve service', cfr: '§73.150; §73.24(i)' },
          { priority: 4, action: 'If COL change is unavoidable, file formal COL change request', detail: 'File a major change Form 301-AM with an explicit COL change request; coordinate with FCC communications counsel', cfr: '§73.3571(b)' }
        ],
        n_strategies: 4,
        relocation_note: 'Candidate is 12.4 km from COL centroid. COL change risk: LOW. COL coverage likely preserved — verify with FCC contour computation before filing.',
        reference: '47 CFR §73.24(i); §73.3571; §73.3571(b); §73.190; §503(b); FCC AM processing policies',
        note: 'COL change: 12.4 km from COL, risk LOW. Must verify 5 mV/m daytime contour covers COL per §73.24(i). COL coverage expected — confirm with FCC curves.'
      },
      fcc_license_modification_guide: {
        frequency_khz: 780, fcc_class: 'D',
        pattern_mode: 'NDA',
        is_directional: false,
        fcc_form: '301-AM',
        fcc_system: 'FCC LMS (lms.fcc.gov)',
        filing_fee_usd: 325,
        n_required_exhibits: 9,
        required_exhibits: [
          { id: 'SITE_COORDS', label: 'Site coordinates (NAD83 lat/lon)', cfr: '§73.3533; §73.25', required: true, note: 'Must be NAD83 datum; GPS survey with sub-meter accuracy required' },
          { id: 'CONTOUR_MAP', label: 'Service area contour map', cfr: '§73.182; §73.3533', required: true, note: 'Day and night 0.5 mV/m and 0.1 mV/m service contours using FCC curves (§73.190)' },
          { id: 'INTERFERENCE', label: 'Interference analysis', cfr: '§73.182', required: true, note: 'Must show no new objectionable interference to all co-channel and adjacent-channel stations' },
          { id: 'ANTENNA_EFF', label: 'Antenna efficiency and ground system data', cfr: '§73.190; §73.24', required: true, note: 'Ground system parameters; predicted efficiency factor used in power/contour calculations' },
          { id: 'TOWER_HEIGHT', label: 'Tower height (AGL/AMSL) and structural data', cfr: '§73.1560; §17.7', required: true, note: 'Height of antenna structure above ground level and above mean sea level' },
          { id: 'FAA_CLEARANCE', label: 'FAA Form 7460-1 or FAA determination', cfr: '§17.7; §17.23', required: true, note: 'Required for any structure > 61m AGL; FAA determination must be attached to LMS filing' },
          { id: 'ENVIRONMENTAL', label: 'EA or categorical exclusion finding', cfr: '§1.1301–§1.1319', required: true, note: 'Most AM tower relocations qualify for categorical exclusion; full EA required if in floodplain, wetland, etc.' },
          { id: 'ASR_NUMBER', label: 'FCC ASR registration number', cfr: '§17.7', required: true, note: 'Tower > 60.96m AGL must be registered in FCC Antenna Structure Registration system before CP grant' },
          { id: 'TECH_PARAMS', label: 'Technical parameters (frequency, power, pattern, class)', cfr: '§73.21; §73.182', required: true, note: 'ERP, TPO, antenna system parameters, and authorized power class must be filed and consistent' }
        ],
        fcc_processing_steps: [
          { step: 1, action: 'File FCC Form 301-AM via LMS', detail: 'Complete all sections; attach all required exhibits; pay $325 filing fee electronically', timeline: 'Day 1 of application process', cfr: '§73.3533(a)' },
          { step: 2, action: 'FCC issues public notice (PNOH)', detail: 'FCC Public Notice of Hearing or Application — 30-day window for petitions to deny (major modifications)', timeline: '30-day public comment period', cfr: '§73.3580' },
          { step: 3, action: 'FCC engineering review', detail: 'FCC Media Bureau AM engineers review technical exhibits, interference analysis, and DA proof if applicable', timeline: '3–18 months (NDA faster; DA longer)', cfr: '§73.3533' },
          { step: 4, action: 'FCC issues CP grant', detail: 'Upon grant, upload CP to OPIF within 24 hours; begin construction per CP specifications', timeline: 'After engineering clearance', cfr: '§73.3533; §73.3526(e)(1)' },
          { step: 5, action: 'Construct and file Form 302-AM (license to cover)', detail: 'After construction and proof-of-performance, file Form 302-AM with proof exhibits for license to cover', timeline: '3-year CP term per §73.3598; file 302-AM before CP expiration', cfr: '§73.3536; §73.3598' }
        ],
        n_processing_steps: 5,
        cp_term_years: 3,
        extension_available: true,
        extension_months: 6,
        major_change_radius_km: 3.2,
        major_change_radius_miles: 2,
        processing_time_estimate: { nda_optimistic_months: 3, nda_conservative_months: 9, da_optimistic_months: 9, da_conservative_months: 18 },
        relocation_note: 'File FCC Form 301-AM via LMS. 9 required exhibits including interference analysis, contour map, FAA determination, and ASR number. $325 filing fee. NDA station. Processing: 3–9 months. CP valid for 3 years; 6-month extension available.',
        reference: '47 CFR §73.3533; §73.3536; §73.3598; §73.3539; §73.3580; §73.150; §17.7; §1.1301; FCC LMS (lms.fcc.gov); FCC Schedule of Application Fees',
        note: 'Form 301-AM via FCC LMS. 9 required exhibits. Filing fee: $325. CP term: 3 years + 6-month extension. Processing: 3–9 months. Public notice triggers 30-day petition window for major changes.'
      },
      transmitter_building_design_guide: {
        frequency_khz: 780, fcc_class: 'D',
        tpo_kw: 5,
        tx_input_kw: 14,
        heat_dissipation_kw: 9,
        hvac_tons_required: 2,
        min_floor_area_sqft: 160,
        recommended_floor_area_sqft: 240,
        equipment_list: [
          { id: 'TRANSMITTER', label: 'AM transmitter', space_sqft: 8, note: '5 kW class; 24"×36"×72" footprint' },
          { id: 'ATU', label: 'Antenna tuning unit (ATU)', space_sqft: 8, note: 'Must be sited close to tower base; outdoor cabinet alternative' },
          { id: 'EAS_RACK', label: 'EAS encoder/decoder + rack', space_sqft: 4, note: '19" rack, 2U–4U; requires broadband connection for IPAWS CAP' },
          { id: 'TRANSFER_SW', label: 'Automatic transfer switch (ATS)', space_sqft: 4, note: 'For generator changeover; must be inside or in adjacent weatherproof enclosure' },
          { id: 'CONTROL', label: 'Control console / metering panel', space_sqft: 6, note: 'Base current metering, modulation monitoring, remote control interface' },
          { id: 'HVAC', label: 'HVAC system', space_sqft: 0, note: '2 tons cooling required; mini-split preferred for unattended sites' },
          { id: 'WORKBENCH', label: 'Work/maintenance area', space_sqft: 20, note: '5×4 ft minimum for service work on transmitter and ATU' }
        ],
        n_equipment_items: 7,
        construction_steps: [
          { priority: 1, action: 'Site survey and soil test for slab design', detail: 'Confirm bearing capacity; design concrete slab for transmitter/ATU static + dynamic loads', timeline_weeks: [1, 2] },
          { priority: 2, action: 'Building permit and local code review', detail: 'Submit plans to county; confirm setbacks from fence line per §73.49 fence requirements', timeline_weeks: [2, 8] },
          { priority: 3, action: 'Slab pour and ground ring installation', detail: 'Install perimeter ground ring (2" copper) during slab pour; bond all equipment to ring per IEEE Std 1100', timeline_weeks: [1, 3] },
          { priority: 4, action: 'Building erection (prefab or block)', detail: '240 sq ft transmitter building; HVAC rough-in; electrical service entrance', timeline_weeks: [2, 6] },
          { priority: 5, action: 'Equipment installation and AT alignment', detail: 'Install transmitter, ATU, EAS, ATS; tune ATU to new antenna; verify carrier frequency and modulation', timeline_weeks: [1, 3] }
        ],
        estimated_building_cost_usd: { prefab_shell_usd: 20400, block_shell_usd: 36000, site_prep_usd: 8000, grounding_usd: 4000, typical: 32400, high: 58000 },
        atu_location_note: 'ATU should be at or very near tower base to minimize RF transmission line loss. Outdoor weatherproof ATU cabinet is an alternative to running coax to the transmitter building.',
        relocation_note: '5 kW transmitter → 9 kW heat dissipation + solar gain → 2 tons HVAC. Recommended building: 240 sq ft (12×20 ft). Estimated cost: $32,400 (prefab) to $58,000 (block).',
        reference: '47 CFR §73.49; §73.182; §73.1215; NEC §250; IEEE Std 1100; IBC; NFPA 70/72; manufacturer specifications',
        note: 'Transmitter building: 240 sq ft recommended. HVAC: 2 tons (9 kW transmitter heat + solar). Estimated build cost: $32,400 typical.'
      },
      am_monitoring_point_guide: {
        frequency_khz: 780, fcc_class: 'D',
        pattern_mode: 'NDA',
        is_directional: false,
        n_patterns: 1,
        n_points_per_pattern: 2,
        n_monitoring_points: 2,
        wavelength_m: 384.6,
        min_distance_m: 192,
        typical_monitoring_distance_m: 577,
        max_useful_distance_m: 1923,
        monitoring_methods: [
          { id: 'REMOTE_FSM', label: 'Remote field strength monitor (FSM)', cost_usd_per_year: { low: 2000, high: 6000 }, note: 'Automated; provides continuous monitoring with data logging; preferred for DA stations' },
          { id: 'MANUAL_DRIVE', label: 'Manual drive-by monitoring', cost_usd_per_year: { low: 800, high: 2500 }, note: 'Licensed engineer quarterly measurements; lower cost but no continuous logging' },
          { id: 'HYBRID', label: 'Hybrid: FSM on critical bearings + manual on others', cost_usd_per_year: { low: 1500, high: 4000 }, note: 'Recommended for DA stations with complex patterns' }
        ],
        relocation_steps: [
          { priority: 1, action: 'Identify provisional monitoring point locations for CP application', detail: 'Choose candidate monitoring point sites along main DA lobes and nulls; confirm GPS coordinates', cfr: '§73.154; §73.3533' },
          { priority: 2, action: 'Obtain access permissions for monitoring points on private land', detail: 'Some monitoring points may require landowner permission; document access agreements', cfr: '§73.158' },
          { priority: 3, action: 'Establish monitoring points during proof-of-performance', detail: 'Measure field strength at all monitoring points during 72-radial proof (DA) or 8-radial proof (NDA)', cfr: '§73.154(a)' },
          { priority: 4, action: 'File monitoring point data with FCC Form 302-AM', detail: 'Include monitoring point GPS coordinates, measured FS values, and antenna system parameters as an exhibit', cfr: '§73.3526; Form 302-AM' },
          { priority: 5, action: 'Install remote FSM units at permanent monitoring points', detail: 'After license to cover is issued, install remote monitoring hardware at established monitoring points for ongoing compliance', cfr: '§73.158; §73.68' }
        ],
        n_relocation_steps: 5,
        estimated_annual_monitoring_cost_usd: 1200,
        fcc_tolerance_pct: 5,
        carrier_tolerance_hz: 20,
        relocation_note: 'NDA station: 2 recommended monitoring points. New points should be measured during proof and documented. Monitoring point distances: 192–1923m from tower (at 780 kHz). FCC tolerance: ±5% of authorized field value.',
        reference: '47 CFR §73.158; §73.68; §73.1215; §73.154; Form 302-AM exhibit requirements',
        note: 'AM monitoring: 2 points required (1 pattern × 2). Distance range: 192–1923m. Annual cost: ~$1,200. NDA: manual quarterly monitoring adequate.'
      },
      utility_power_service_guide: {
        frequency_khz: 780, fcc_class: 'D',
        tpo_kw: 5,
        transmitter_draw_kw: 14,
        hvac_kw: 2,
        ancillary_kw: 3,
        total_site_load_kw: 19,
        required_service_amps: 200,
        required_utility_service_kw: 48,
        generator_recommended: true,
        generator_kw_recommended: 25,
        utility_extension_costs: {
          overhead_line_per_mile_usd: { low: 5000, typical: 10000, high: 15000 },
          underground_per_mile_usd: { low: 30000, typical: 55000, high: 80000 },
          service_entrance_usd: { low: 3000, typical: 5500, high: 8000 },
          transformer_grounding_usd: { low: 2000, typical: 3500, high: 5000 },
          total_typical_rural_usd: 19000
        },
        estimated_utility_extension_cost_usd: { low: 5000, typical: 19000, high: 93000 },
        generator_costs: {
          generator_purchase_usd: { low: 8000, typical: 15000, high: 28000, note: '25 kW diesel generator' },
          ats_installation_usd: { low: 2500, typical: 4000, high: 6000 },
          annual_fuel_maintenance_usd: { low: 800, typical: 1500, high: 3000 }
        },
        backup_power_cfr: '§11.35(a) (EAS); §73.1680 (backup transmitter); §73.1215 (monitoring)',
        relocation_note: '5 kW TPO → 14 kW transmitter draw + 2 kW HVAC + 3 kW ancillary = 19 kW total. Requires 200A / 240V utility service (48 kW). Recommend 25 kW diesel generator with ATS for EAS continuity.',
        reference: '47 CFR §11.35(a); §73.1680; §73.1215; NFPA 110; NEC Article 700/702; utility service handbook',
        note: 'Utility power: 19 kW total load → 200A / 48 kW service. Generator: 25 kW recommended. Estimated utility extension cost: $19,000 typical.'
      },
      antenna_deicing_guide: {
        frequency_khz: 780, fcc_class: 'D',
        candidate_lat: 34.86,
        ice_zone: 'Zone II',
        ice_mm: 12.5,
        deicing_recommended: false,
        n_applicable_systems: 1,
        all_deicing_systems: [
          { id: 'HEAT_TAPE', label: 'Resistive heat tape (guy anchor points)', cost_usd_per_year: { low: 800, high: 2000 }, ice_zone_threshold: 'Zone III', note: 'Protects guy wire anchor hardware from ice seizure; effective in Zones III–IV' },
          { id: 'ICEPHOBIC', label: 'Ice-phobic coating (tower base sections)', cost_usd_per_year: { low: 500, high: 1500 }, ice_zone_threshold: 'Zone III', note: 'Reduces ice adhesion; must be reapplied every 3–5 years' },
          { id: 'HEATED_ATU', label: 'Heated ATU/base insulator enclosure', cost_usd_per_year: { low: 300, high: 800 }, ice_zone_threshold: 'Zone II', note: 'Prevents ice from affecting base impedance matching network and carrier frequency stability' },
          { id: 'ICE_MONITOR', label: 'Remote ice/weather monitoring', cost_usd_per_year: { low: 400, high: 1200 }, ice_zone_threshold: 'Zone II', note: 'Allows early warning of icing events for ATU retuning and structural inspection scheduling' }
        ],
        applicable_deicing_systems: [
          { id: 'HEATED_ATU', label: 'Heated ATU/base insulator enclosure', cost_usd_per_year: { low: 300, high: 800 }, ice_zone_threshold: 'Zone II', note: 'Prevents ice from affecting base impedance matching network and carrier frequency stability' },
          { id: 'ICE_MONITOR', label: 'Remote ice/weather monitoring', cost_usd_per_year: { low: 400, high: 1200 }, ice_zone_threshold: 'Zone II', note: 'Allows early warning of icing events for ATU retuning and structural inspection scheduling' }
        ],
        estimated_annual_deicing_cost_usd: { low: 700, typical: 1150, high: 2000 },
        electrical_risks: [
          { risk: 'Carrier frequency drift', cfr: '§73.1545', trigger: '25mm radial ice on tower base can shift ATU impedance, causing carrier drift >±20 Hz', mitigation: 'Monitor carrier frequency during icing events; retune ATU as needed' },
          { risk: 'DA pattern distortion', cfr: '§73.182', trigger: 'Non-uniform ice on DA elements distorts radiation pattern; may cause interference to co-channel stations', mitigation: 'Pattern monitoring during icing; inspect antenna elements post-storm' },
          { risk: 'Base insulator flashover', cfr: '§73.49', trigger: 'Ice bridging across base insulator can cause flashover and transmitter shutdown', mitigation: 'Heated ATU enclosure; insulator inspection after freeze/thaw cycles' }
        ],
        n_electrical_risks: 3,
        relocation_note: 'Site at 34.86°N is Zone II (radial ice design thickness: 12.5mm). Icing events occur; ATU heated enclosure and remote monitoring recommended at minimum. Monitor carrier frequency (§73.1215) during icing events.',
        reference: 'TIA-222-H (2017); ASCE 7-22; 47 CFR §73.1215; §73.49; §73.182; ANSI/TIA-322 tower climbing safety',
        note: 'Ice zone: Zone II (12.5mm design thickness at 34.86°N). 2 applicable deicing systems. Estimated annual cost: $1,150. Deicing not required but monitor.'
      },
      ground_lease_negotiation_guide: {
        frequency_khz: 780, fcc_class: 'D',
        recommended_lease_term_years: 25,
        minimum_lease_term_years: 20,
        lease_term: { recommended_years: 25, minimum_years: 20, renewal_options: 2, renewal_option_years: 10, total_max_years: 45, rationale: 'AM license term is 8 years (47 U.S.C. §307(c)(1)). Lease should span at least 3 license terms to avoid mid-license lease expiration. Two 10-year renewal options provide flexibility.' },
        tower_height_m: 144.23,
        guy_radius_m: 101,
        ground_radial_radius_m: 96,
        min_site_radius_m: 99,
        min_site_area_acres: 0.07,
        estimated_annual_rent_usd: { rural: 5500, suburban: 13000, urban: 25000, typical: 5500 },
        rent_estimates: {
          rural_agricultural: { low_usd: 3000, typical_usd: 5500, high_usd: 8000, note: 'Per acre basis; AM sites typically 5–15 acres' },
          suburban_fringe: { low_usd: 8000, typical_usd: 13000, high_usd: 20000, note: 'Higher land values; may need additional permitting' },
          urban_industrial: { low_usd: 15000, typical_usd: 25000, high_usd: 45000, note: 'Limited AM tower sites in urban industrial zones' }
        },
        key_provisions: [
          { id: 'QUIET_ENJOYMENT', label: 'Quiet enjoyment covenant', priority: 'CRITICAL', note: 'Protects broadcaster from landlord interference with tower or radial ground system during lease term', cfr: '§73.49; §73.1560' },
          { id: 'ASSIGNMENT', label: 'Assignment and sublease rights', priority: 'CRITICAL', note: 'Lease must be freely assignable to FCC permittees and successors-in-interest without landlord consent', cfr: '§73.3533' },
          { id: 'CONDEMNATION', label: 'Condemnation proceeds', priority: 'HIGH', note: 'In the event of eminent domain taking, broadcaster receives share of condemnation award proportionate to lease value' },
          { id: 'FAA_ZONING', label: 'Landlord cooperation for FAA/zoning filings', priority: 'HIGH', note: 'Landlord must sign as property owner on FAA Form 7460-1 and local CUP applications' },
          { id: 'GROUND_SYSTEM', label: 'Ground radial system easement', priority: 'HIGH', note: 'Ground radials must extend to 96m from tower base (λ/4 at 780 kHz). Easement must cover full radial sweep.' },
          { id: 'ACCESS_ROAD', label: 'All-weather access road easement', priority: 'MEDIUM', note: 'Broadcaster needs 24/7 unobstructed access to transmitter site for maintenance; road must support equipment delivery trucks' },
          { id: 'EXPANSION', label: 'Right to expand tower or building', priority: 'MEDIUM', note: 'Broadcaster may need to add directional antenna elements, change tower height, or expand transmitter building during lease term' }
        ],
        n_key_provisions: 7,
        n_critical_provisions: 2,
        option_to_purchase_recommended: true,
        option_to_purchase_note: 'Negotiate right of first refusal or option to purchase the site at fair market value. AM transmitter sites are difficult to replicate once lost.',
        relocation_note: 'New transmitter site lease must cover: tower base, 96m radial ground system, guy wire anchors (101m radius), transmitter building, and all-weather access road. Minimum site area: ~0.07 acres. Lease term: 25 years minimum.',
        reference: '47 CFR §73.49; §73.1560; §73.3533; §73.182; §17.7; §1.1307; FCC Form 7460-1; local zoning/CUP requirements',
        note: 'Ground lease: 25-year recommended term, 2×10-year renewals. Minimum site area ~0.07 acres (99m radius). 7 key provisions; 2 CRITICAL. Option to purchase recommended.'
      },
      emergency_alert_system_equipment_guide: {
        frequency_khz: 780, fcc_class: 'D',
        eas_equipment_required: true,
        eas_cfr_basis: '47 CFR Part 11',
        n_required_cap_sources: 3,
        weekly_test_required: true,
        monthly_relay_window_minutes: 60,
        equipment_list: [
          { id: 'ENCODER_DECODER', label: 'EAS Encoder/Decoder', cfr: '§11.35(a)', requirement: 'Must receive, generate, and retransmit EAS alerts; CAP-capable if manufactured after Dec 2007', relocation_action: 'Move with transmitter or re-establish at studio' },
          { id: 'MONITORING_RADIO', label: 'Two EAS monitoring assignments (LP-1, LP-2)', cfr: '§11.52(d)', requirement: 'Monitor two local EAS sources continuously; at least one must be LP-1', relocation_action: 'Re-tune monitoring receivers at new site; verify signal quality' },
          { id: 'CAP_RECEIVER', label: 'FEMA IPAWS CAP feed', cfr: '§11.56; §11.52', requirement: 'Broadband connection to IPAWS CAP feed required since June 2012', relocation_action: 'Ensure broadband at new transmitter site or tunnel via STL IP link' },
          { id: 'OPERATING_HANDBOOK', label: 'EAS Operating Handbook', cfr: '§11.15', requirement: 'FCC EAS Operating Handbook must be posted at EAS control point', relocation_action: 'Post handbook at new EAS control point' },
          { id: 'BACKUP_POWER', label: 'Backup power for EAS equipment', cfr: '§11.35(a)', requirement: 'EAS equipment must remain operational during commercial power outages (generator or UPS)', relocation_action: 'Verify generator or UPS at new site covers EAS equipment runtime' }
        ],
        required_cap_sources: [
          { id: 'IPAWS', label: 'FEMA IPAWS CAP feed', cfr: '§11.56', required: true, note: 'Primary CAP source; must be monitored by all EAS participants' },
          { id: 'LP1_A', label: 'Local LP-1 primary EAS source (analog)', cfr: '§11.52(d)', required: true, note: 'Typically the local NWS or state EAS LP-1 entry point station' },
          { id: 'LP1_B', label: 'Second monitoring assignment (LP-1 or LP-2)', cfr: '§11.52(d)', required: true, note: 'Second analog monitoring assignment per state EAS plan' }
        ],
        test_schedule: {
          weekly_test: { name: 'Required Weekly Test (RWT)', cfr: '§11.61(a)(1)', frequency: 'Weekly', window: 'Any day, 8:30 AM to local sunset', originated_by: 'Station', duration_seconds: 8, weekly_test_required: true },
          monthly_test: { name: 'Required Monthly Test (RMT)', cfr: '§11.61(a)(2)', frequency: 'Monthly', window: 'As scheduled by LP-1; must relay within 60 minutes of receipt', originated_by: 'State/LP-1 EAS', max_relay_delay_minutes: 60, duration_max_seconds: 120 }
        },
        relocation_checklist: [
          { priority: 1, action: 'Maintain EAS monitoring continuity', detail: 'Do not go dark on EAS between old and new site; use emergency authorization or brief silent period if needed', cfr: '§11.35(a)' },
          { priority: 2, action: 'Re-establish monitoring assignments at new site', detail: 'Verify LP-1 and LP-2 signal quality at new transmitter location; re-tune if needed', cfr: '§11.52(d)' },
          { priority: 3, action: 'Verify IPAWS CAP broadband at new site', detail: 'EAS equipment needs internet/IP connectivity for CAP monitoring; arrange with new site landlord', cfr: '§11.56' },
          { priority: 4, action: 'Notify State EAS Chair', detail: 'Inform state EAS coordinator of new transmitter site address and updated monitoring assignments', cfr: '§11.52(d)' },
          { priority: 5, action: 'Post EAS Operating Handbook at new control point', detail: 'FCC EAS handbook must be accessible at the EAS control point at new location', cfr: '§11.15' }
        ],
        n_relocation_steps: 5,
        relocation_note: 'EAS monitoring must remain continuous through the relocation. Establish broadband for IPAWS CAP at new site before moving. Notify State EAS Chair of new site address and updated monitoring assignments.',
        reference: '47 CFR Part 11; §11.15; §11.35; §11.52; §11.56; §11.61; FCC IPAWS integration guidance; state EAS plan',
        note: 'EAS: 5 equipment items. 3 CAP sources required (IPAWS + 2 analog). Weekly test at station discretion; monthly test originated by LP-1 and must be relayed within 60 minutes.'
      },
      public_inspection_file_guide: {
        frequency_khz: 780, fcc_class: 'D',
        opif_system: 'FCC Online OPIF (publicfiles.fcc.gov)',
        is_commercial_am: true,
        issues_programs_list_required: false,
        n_required_documents: 6,
        required_documents: [
          { id: 'LICENSE', label: 'Current license and all pending applications', cfr: '§73.3526(e)(1)', update_trigger: 'After any FCC action; upload CP within 24 hr of grant', retention: 'Duration of license period' },
          { id: 'POLITICAL_FILE', label: 'Political file (requests, decisions, rates)', cfr: '§73.3526(e)(6)', update_trigger: 'Within 24 hours of any candidate request or decision', retention: '2 years' },
          { id: 'OWNERSHIP_RPT', label: 'Ownership report (FCC Form 323)', cfr: '§73.3526(e)(3)', update_trigger: 'Biennially; within 30 days of any ownership change', retention: 'Current + previous' },
          { id: 'EEO_REPORT', label: 'EEO public file report', cfr: '§73.3526(e)(7); §73.2080', update_trigger: 'Annually; due on renewal anniversary date', retention: '2 years' },
          { id: 'LOCAL_NOTICE', label: 'Local public notice of filed applications (§73.3580)', cfr: '§73.3526(e)(10)', update_trigger: 'When application filed and FCC public notice issued', retention: 'Duration of proceeding' },
          { id: 'ISSUES_PROGRAMS', label: 'Issues/programs list (if noncommercial) or quarterly reports', cfr: '§73.3527 (noncommercial only)', update_trigger: 'Quarterly', retention: '2 years — commercial AM EXEMPT since 2018' }
        ],
        n_relocation_updates: 5,
        relocation_updates: [
          { priority: 1, action: 'Upload CP grant', detail: 'Construction permit for new site must be uploaded to OPIF within 24 hours of FCC grant', cfr: '§73.3526(e)(1)', timeline: '24 hours after CP grant' },
          { priority: 2, action: 'Update ownership report if needed', detail: 'If relocation accompanies any ownership change, Form 323 must be updated within 30 days', cfr: '§73.3526(e)(3); §73.3555', timeline: '30 days of change' },
          { priority: 3, action: 'EEO report update', detail: 'EEO report must reflect new COL/service area if community of license changes with the relocation', cfr: '§73.2080; §73.3526(e)(7)', timeline: 'On next annual EEO report' },
          { priority: 4, action: 'Local public notice', detail: 'FCC requires local notice in community of license upon application grant; post notice to OPIF', cfr: '§73.3580; §73.3526(e)(10)', timeline: 'When FCC issues public notice' },
          { priority: 5, action: 'Confirm political file access', detail: 'OPIF political file does not move; confirm existing entries remain accessible and add new station address', cfr: '§73.1943(f); §73.3526(e)(6)', timeline: 'At time of move' }
        ],
        forfeiture_risk: {
          missing_documents_usd: { low: 4000, high: 10000 },
          political_file_violations_usd: { low: 8000, high: 25000 },
          total_risk_per_inspection_usd: { low: 12000, high: 35000 },
          cfr: '§503(b); FCC Forfeiture Policy Statement'
        },
        relocation_note: 'Upload CP grant to OPIF within 24 hours. Political file remains in FCC online system — no physical move needed. EEO report must reflect new service area at next annual filing. Commercial AM stations are exempt from issues/programs list requirement since 2018.',
        reference: '47 CFR §73.2080; §73.3526; §73.3527; §73.3555; §73.3580; §73.1943; §503(b); FCC OPIF system (publicfiles.fcc.gov)',
        note: 'OPIF: 6 document categories. 5 updates required post-relocation. Commercial AM EXEMPT from quarterly issues/programs list (since 2018). FCC OPIF: publicfiles.fcc.gov.'
      },
      broadcast_content_compliance_guide: {
        frequency_khz: 780, fcc_class: 'D',
        indecency_rules: {
          prohibited_hours_start: '06:00', prohibited_hours_end: '22:00',
          safe_harbor_start: '22:00', safe_harbor_end: '06:00',
          cfr: '§73.3999', max_forfeiture_per_incident_usd: 503000,
          note: 'FCC indecency forfeiture cap is $503,000 per incident; $3,021,500 for continuing violations'
        },
        telephone_consent: {
          required: true, cfr: '§73.1206',
          method: 'Oral notice to caller before recording or broadcast; or written consent',
          exception: 'Emergency calls, calls not intended for broadcast',
          forfeiture_risk_usd: { low: 8000, high: 25000 }
        },
        rebroadcast_rules: {
          consent_required: true, cfr: '§73.1207', anti_simulcast_cfr: null,
          am_fm_simulcast_restriction: 'AM and commonly-owned FM may simulcast if FM is within AM service area, but must offer separate programming for some portion of broadcast day'
        },
        compliance_elements: [
          { id: 'INDECENCY_POLICY',  label: 'Written indecency/obscenity policy for all staff and contractors', cfr: '§73.3999', priority: 'HIGH' },
          { id: 'TELEPHONE_PROC',    label: 'Telephone consent procedure for all on-air calls', cfr: '§73.1206', priority: 'HIGH' },
          { id: 'COMPLAINT_LOG',     label: 'Log all content complaints received; retain for 2 years', cfr: '§73.3526(e)(7)', priority: 'MEDIUM' },
          { id: 'HOAX_POLICY',       label: 'Written policy prohibiting broadcast hoaxes', cfr: '§73.1217', priority: 'MEDIUM' },
          { id: 'JSA_LMA_REVIEW',    label: 'Review any JSA/LMA for attribution compliance', cfr: '§73.1210; §73.3555', priority: 'MEDIUM' },
          { id: 'SPONSORSHIP_LOG',   label: 'Document all paid/sponsored programming (sponsorship ID)', cfr: '§73.1212', priority: 'HIGH' }
        ],
        n_compliance_elements: 6, high_priority_elements: 3,
        max_forfeiture_indecency_usd: 503000,
        reference: '47 CFR §73.1206; §73.1207; §73.1210; §73.1212; §73.1217; §73.3526; §73.3555; §73.3999; §73.4005; §73.1211',
        note: 'Content compliance: 6 elements, 3 HIGH priority. Indecency safe harbor: 10 PM–6 AM. Max forfeiture: $503,000 per incident.'
      },
      political_programming_compliance_guide: {
        frequency_khz: 780, fcc_class: 'D',
        candidate_site_lat: 34.86, candidate_site_lon: -111.82,
        region_note: 'Southern/Western latitude — verify congressional district coverage change post-relocation',
        political_obligations: [
          { id: 'REASONABLE_ACCESS', label: 'Reasonable access to federal candidates (§312(a)(7))', cfr: '§73.1940; §73.1944', applies_to: 'Federal candidates only', trigger: 'Candidate request during campaign season' },
          { id: 'EQUAL_OPPORTUNITIES', label: 'Equal opportunities if any candidate receives air time (§315)', cfr: '§73.1941', applies_to: 'All legally qualified candidates for same office', trigger: 'Within 7 days of opponent use' },
          { id: 'LOWEST_UNIT_CHARGE', label: 'Lowest unit charge during LUC windows', cfr: '§73.1942; §73.1943', applies_to: 'Legally qualified candidates', trigger: '45/60 day windows before elections' },
          { id: 'POLITICAL_FILE',    label: 'Maintain political file in OPIF', cfr: '§73.1943(f); §73.3526(e)(6)', applies_to: 'All candidates requesting time', trigger: 'Continuous; requests logged within 24 hours' },
          { id: 'SPONSORSHIP_ID',   label: 'Sponsorship identification for political ads', cfr: '§73.1212', applies_to: 'All political advertising', trigger: 'Each political broadcast' }
        ],
        n_obligations: 5,
        election_windows: {
          luc_pre_primary_days: 45, luc_pre_general_days: 60,
          equal_opp_request_days: 7, political_file_retention_years: 2, cfr: '§73.1942; §73.1943'
        },
        relocation_impacts: [
          { id: 'DISTRICT_CHANGE',  impact: 'EVALUATE', detail: 'Relocation changes service area; identify new federal/state/local districts served', cfr: '§73.1940' },
          { id: 'OPIF_UPDATE',      impact: 'REQUIRED',  detail: 'Political file in OPIF must be updated when station moves', cfr: '§73.3526; §73.3527' },
          { id: 'COL_CHANGE',       impact: 'EVALUATE', detail: 'If COL changes, political programming obligations may shift to new community', cfr: '§73.3533; §73.3571' },
          { id: 'MAIN_STUDIO_FILE', impact: 'REQUIRED',  detail: 'Political file address must be updated when studio moves', cfr: '§73.3526(b); §73.1943(f)' }
        ],
        n_required_impacts: 2,
        compliance_cost: {
          political_file_software_usd: { low: 0, high: 3000 },
          legal_counsel_per_election_usd: { low: 2000, high: 8000 },
          staff_training_usd: { low: 500, high: 2000 },
          total_annual_estimate_usd: { low: 2500, high: 13000 }
        },
        reference: '47 CFR §73.1212; §73.1940; §73.1941; §73.1942; §73.1943; §73.1944; §73.3526; §73.3527; 47 U.S.C. §312(a)(7); §315',
        note: 'Political programming: 5 obligations. LUC windows: 45 days pre-primary / 60 days pre-general. Political file retention: 2 years. OPIF update required post-relocation.'
      },
      transmitter_redundancy_guide: {
        frequency_khz: 780, fcc_class: 'D', tpo_kw: 5,
        backup_required_by_fcc: false, backup_strongly_recommended: true,
        emergency_operation: {
          reduced_power_ok_without_pta: true, max_days_no_notification: 10,
          cfr: '§73.1615(a)', notification_cfr: '§73.1615(b)', sta_required_after_days: 30
        },
        backup_sizing_options: [
          { option: 'FULL_BACKUP',  power_kw: 5,   cost_est_usd: { low: 15000, high: 60000 }, note: 'Full-power backup; no STA required for short-term outages' },
          { option: 'HALF_BACKUP',  power_kw: 2.5, cost_est_usd: { low: 8000,  high: 30000 }, note: 'Half-power backup; may need STA if main down >30 days' },
          { option: 'SOLID_STATE',  power_kw: 5,   cost_est_usd: { low: 20000, high: 80000 }, note: 'Solid-state backup; lower maintenance, higher upfront cost' }
        ],
        n_sizing_options: 3,
        input_power_kva_estimate: 20,
        generator_guidance: {
          recommended_kva: 25, fuel_type: 'Diesel', run_time_hours_per_tank: 24,
          automatic_transfer_switch: true, cfr_reference: '§73.1680; NFPA 110'
        },
        full_redundancy_cost: {
          backup_transmitter_usd: { low: 15000, high: 60000 },
          transmission_line_switching_usd: { low: 2000, high: 8000 },
          generator_usd: { low: 10000, high: 40000 },
          automatic_transfer_switch_usd: { low: 2000, high: 6000 },
          total_estimated_usd: { low: 29000, high: 114000 }
        },
        eas_participant_redundancy_note: 'EAS participants (§11.35) should maintain backup transmitter capability to ensure continuous EAS message relay.',
        reference: '47 CFR §73.1615; §73.1635; §73.1680; §11.35; NFPA 110; NAB Engineering Handbook Chapter 7',
        note: 'Backup transmitter NOT required by FCC but strongly recommended. Emergency reduced-power ≤10 days without notification. Full redundancy: $29k–$114k.'
      },
      frequency_monitoring_plan_guide: {
        frequency_khz: 780, fcc_class: 'D', pattern_mode: 'NDA', is_directional: false,
        carrier_frequency_monitoring: {
          max_deviation_hz: 20, cfr: '§73.1545',
          monitoring_method: 'GPS-locked frequency reference or calibrated frequency counter',
          check_frequency: 'Weekly minimum; continuous with automatic monitoring system preferred'
        },
        modulation_monitoring: {
          max_negative_mod_pct: 100, max_positive_mod_pct: 125,
          cfr: '§73.1570; §73.1215(a)', equipment_required: 'Calibrated modulation monitor',
          log_required: true, log_cfr: '§73.1820'
        },
        da_base_current_monitoring: {
          required: false, note: 'NDA station — no base current monitoring required', cfr: '§73.61 (not applicable to NDA)'
        },
        spurious_monitoring: {
          nrsc_2b_compliant: true, spurious_limit_dbc_below_2nd_harmonic: -60, spurious_limit_dbc_above_10mhz: -80,
          cfr: '§73.44', check_method: 'Spectrum analyzer measurement at transmitter output; annual check recommended',
          transmitter_filter_recommended: false
        },
        remote_monitoring: {
          permitted: true, cfr: '§73.1350(c)',
          required_alarms: ['carrier level', 'modulation overload', 'VSWR/SWR high', 'antenna current deviation'],
          response_time_minutes: 10, nda_vs_da: 'NDA station: carrier and modulation alarms sufficient'
        },
        equipment_cost_estimate: {
          frequency_monitor_usd: { low: 500, high: 3000 }, modulation_monitor_usd: { low: 800, high: 4000 },
          base_current_monitors_usd: { low: 0, high: 0 }, remote_control_system_usd: { low: 3000, high: 15000 },
          total_estimated_usd: { low: 4300, high: 22000 }
        },
        reference: '47 CFR §73.44; §73.61; §73.62; §73.1215; §73.1350; §73.1570; §73.1820; NRSC-2-B',
        note: 'Monitoring: carrier ±20 Hz (§73.1545), modulation 100%/125% (§73.1570). Remote control permitted (§73.1350(c)).'
      },
      asr_registration_update_guide: {
        frequency_khz: 780, fcc_class: 'D',
        estimated_tower_height_m: 144.23, quarter_wave_height_m: 96.15,
        asr_height_threshold_m: 60.96, asr_required_by_height: true,
        asr_airport_check_required: true, faa_notification_likely: true,
        filing_steps: [
          { step: 1, action: 'FAA Form 7460-1 filing', detail: 'File Notice of Proposed Construction with FAA via OEAAA online portal', cfr: '14 CFR §77.9; FCC §17.7' },
          { step: 2, action: 'Await FAA determination', detail: 'FAA issues "no hazard" finding (typically 45 days)', cfr: '14 CFR §77.17' },
          { step: 3, action: 'File FCC Form 854 (ASR)', detail: 'Submit ASR application with FAA study reference number', cfr: '47 CFR §17.4; §17.7' },
          { step: 4, action: 'Install lighting per FAA order', detail: 'FAA Determination Letter specifies lighting type', cfr: '47 CFR §17.21; §17.23' },
          { step: 5, action: 'Update FCC station license', detail: 'Include ASR number on CP application (Form 301-AM)', cfr: '47 CFR §73.816(a); §73.3533' },
          { step: 6, action: 'Report lighting outages', detail: 'Outages >30 min must be reported to FAA (§17.48) within 24 hours', cfr: '47 CFR §17.48' }
        ],
        n_filing_steps: 6,
        timeline: {
          faa_form_7460_days: { min: 45, typical: 60, max: 120 },
          fcc_form_854_days: { min: 7, typical: 30, max: 60 },
          total_asr_days: { min: 52, typical: 90, max: 180 }
        },
        cost_estimate: {
          faa_filing_usd: { low: 0, high: 0 },
          fcc_asr_fee_usd: { low: 0, high: 0 },
          engineering_study_usd: { low: 1500, high: 5000 },
          faa_light_install_usd: { low: 5000, high: 30000 },
          total_estimated_usd: { low: 6500, high: 35000 }
        },
        post_registration_obligations: [
          { id: 'MARK_PAINT',     label: 'Tower must be painted (orange/white bands) if required by FAA', cfr: '§17.21(c)', trigger: 'FAA Determination Letter' },
          { id: 'LIGHT_MAINTAIN', label: 'Lighting must be maintained and outages reported within 30 min', cfr: '§17.48', trigger: 'Continuous' },
          { id: 'ASR_ACCURACY',   label: 'ASR record must be updated within 5 days of any ownership or height change', cfr: '§17.57', trigger: 'Any change' },
          { id: 'DECOMMISSION',   label: 'ASR must be cancelled if tower demolished; FCC Form 854 (decommission)', cfr: '§17.7(f)', trigger: 'Tower removal' }
        ],
        n_obligations: 4,
        reference: '47 CFR §17.4; §17.7; §17.21; §17.23; §17.48; §17.57; §73.816(a); §73.3533; 14 CFR §77; FAA Form 7460-1; FCC Form 854',
        note: 'ASR required by height: true (tower 144.23m vs 60.96m threshold). FAA 7460-1: LIKELY. Filing is free; engineering/lighting: $6.5k–$35k.'
      },
      tower_climbing_safety_plan_guide: {
        frequency_khz: 780, fcc_class: 'D', tpo_kw: 5,
        rf_ppe_required: true, safe_work_power_threshold_kw: 0.05,
        estimated_tower_height_m: 144.23,
        fall_protection_zones: [
          { zone: 'Ground (0–1.8 m)', requirement: 'No fall protection required; perimeter fencing §73.49', cfr: '§73.49; OSHA §1910.268(n)' },
          { zone: 'Low (1.8–3 m)',    requirement: '100% tie-off required; personal fall arrest system (PFAS)', cfr: 'OSHA §1926.502(d)' },
          { zone: 'Mid (3–30 m)',     requirement: '100% tie-off; PFAS; periodic rest platforms recommended', cfr: 'OSHA §1926.502(d); ANSI/TIA-1019-A §6' },
          { zone: 'High (30+ m)',     requirement: '100% tie-off; PFAS; rescue plan required; two-person climb rule recommended', cfr: 'OSHA §1926.502(d); ANSI/TIA-1019-A §7' }
        ],
        n_fall_protection_zones: 4,
        rf_safety_requirements: [
          { id: 'DE_ENERGIZE', label: 'Station must be off-air for all structural work unless RF shielding provided', cfr: '§1.1310; OET Bulletin 65', required: true },
          { id: 'RF_PPE',      label: 'RF protective equipment (RF-shielded suit, gloves) required for on-air tower work', cfr: 'OET Bulletin 65; ANSI C95.1', required: true },
          { id: 'MONITOR',     label: 'On-site RF field strength monitor during any on-air climbing', cfr: 'OET Bulletin 65 §4.3', required: true },
          { id: 'RESCUE_PLAN', label: 'Rescue plan required for work above 30 m; tower rescue certification', cfr: 'OSHA §1926.502(d)(16)', required: true }
        ],
        n_rf_requirements: 4, n_required_rf_measures: 4,
        safety_plan_documents: [
          'Job Hazard Analysis (JHA) for all tower climbing tasks',
          'Emergency Response and Rescue Plan (ERP)',
          'RF Exposure Plan: de-energize protocol for transmitter (5 kW)',
          'Worker RF training records (OET Bulletin 65 awareness training)',
          'PFAS inspection logs (pre-climb and post-climb)',
          'ANSI/TIA-1019-A compliance acknowledgment signed by tower crew supervisor',
          'FAA coordination for any work on towers with lighting systems (§17.48 notification)'
        ],
        n_safety_documents: 7,
        osha_applicable_standards: ['29 CFR §1910.268 (telecommunications)', '29 CFR §1926.502 (fall protection)', 'ANSI/TIA-1019-A (tower climbing)', 'ANSI C95.1 (RF safety)'],
        fcc_applicable: '47 CFR §73.49; §1.1310; OET Bulletin 65',
        reference: 'OSHA 29 CFR §1910.268; §1926.502; ANSI/TIA-1019-A; ANSI C95.1; 47 CFR §73.49; §1.1310; OET Bulletin 65; NATE Safety Guidelines; FAA §17.48',
        note: 'Tower climbing safety plan required for new 144.23m AM tower. RF PPE REQUIRED at 5 kW. 7 plan documents needed.'
      },
      remote_pickup_unit_guide: {
        frequency_khz: 780, fcc_class: 'D',
        approximate_studio_to_tx_km: 18.5,
        vhf_path_feasible: true, uhf_path_feasible: true,
        rpu_bands: [
          { band: 'VHF', range_mhz: '161–170 MHz', max_erp_w: 250, part: 'Part 74 §74.402(a)', typical_range_km: 80, path_feasible: true },
          { band: 'UHF', range_mhz: '450–455 MHz', max_erp_w: 250, part: 'Part 74 §74.402(b)', typical_range_km: 50, path_feasible: true }
        ],
        licensing: {
          requires_fcc_license: true, form: 'FCC Form 349 (Part 74 auxiliary broadcast license)',
          license_term_years: 8, coordination_required: 'Yes — frequency coordination with other RPU users',
          cfr: '§74.432; §74.433', sta_available: true, sta_cfr: '§73.1635', sta_duration_days: 180
        },
        relocation_impacts: [
          { id: 'PATH_DISTANCE',  impact: 'MINOR',    detail: 'New site ~18.5 km from assumed studio; within typical VHF/UHF RPU range' },
          { id: 'LINE_OF_SIGHT',  impact: 'EVALUATE', detail: 'VHF/UHF path requires near-line-of-sight; terrain analysis needed for new site' },
          { id: 'FREQUENCY_REUSE', impact: 'LOW',     detail: 'Existing RPU frequencies typically remain valid at new site if interference analysis clears' },
          { id: 'LICENSE_UPDATE', impact: 'REQUIRED', detail: 'FCC license must be updated if transmitter site coordinates change materially; file FCC Form 349 modification', cfr: '§73.3533' }
        ],
        n_impacts: 4, significant_impacts: 1,
        cost_estimate: {
          frequency_coordination_usd: { low: 500, high: 2000 },
          new_antenna_usd: { low: 1000, high: 5000 },
          equipment_upgrade_usd: { low: 0, high: 15000 },
          license_modification_usd: { low: 300, high: 1500 },
          total_estimated_usd: { low: 1800, high: 23500 }
        },
        reference: '47 CFR §74.401; §74.402; §74.432; §74.433; §73.1635; FCC Form 349',
        note: 'RPU path from new site: ~18.5 km. VHF feasible: true. UHF feasible: true. FCC license update required for any transmitter site change.'
      },
      spectrum_repack_readiness_guide: {
        frequency_khz: 780, fcc_class: 'D',
        channel_type: 'CLEAR_CHANNEL', repack_vulnerability: 'HIGH', repack_mandate_current: false,
        active_proceedings: [
          { docket: 'MB 13-249', title: 'AM Revitalization', status: 'ACTIVE', note: 'AM-to-FM translator windows, third-adjacent deletion, nighttime power flexibility' },
          { docket: 'MB 04-233', title: 'AM Broadcast Interference', status: 'ONGOING', note: 'FCC interference policy; co-channel spacing rules' },
          { docket: 'MB 17-105', title: 'Additional AM-to-FM Windows', status: 'CLOSED', note: '2nd and 3rd AM-to-FM translator windows; completed 2019' }
        ],
        n_proceedings: 3,
        readiness_actions: [
          { priority: 1, action: 'File full-power CP at best available site', rationale: 'Granted CP establishes preferred future site; repack would grandfather existing authorizations', cfr: '§73.3533' },
          { priority: 2, action: 'Obtain FM translator while windows open', rationale: 'FM translator creates secondary FM asset surviving AM band changes', cfr: '§74.1201; FCC 15-14' },
          { priority: 3, action: 'Update FCC LMS records with accurate site data', rationale: 'Inaccurate records weaken interference protection claims', cfr: '§73.3526; §73.3527' },
          { priority: 4, action: 'Comment in MB 13-249 proceedings if affected', rationale: 'Participation in FCC rulemaking protects small-market AM interests', cfr: '§1.415' },
          { priority: 5, action: 'Evaluate digital (HD Radio / DRM) compatibility', rationale: 'Early conversion may provide spectrum flexibility', cfr: '§73.404; NRSC-5-D' }
        ],
        n_readiness_actions: 5,
        relocation_repack_interaction: {
          voluntary_move_favorable: true,
          reason: 'AM Revitalization policy encourages relocation; modern facility strengthens position in any future repack proceeding',
          timing_note: 'File CP before any new FCC AM-band proceeding; pending CP gives stronger position in rulemaking',
          risk_if_no_action: 'HIGH'
        },
        last_major_action: 'FCC 15-14 (AM Revitalization, Feb 2015); FCC 17-105 (Additional translator windows, 2017)',
        reference: 'FCC Docket MB 13-249; FCC 15-14; FCC 17-105; 47 CFR §73.404; §1.415; §74.1201; NRSC-5-D',
        note: 'AM spectrum repack vulnerability: HIGH. No mandatory AM repack exists (2025). Voluntary relocation under AM Revitalization policy is encouraged.'
      },
      interference_complaint_resolution_guide: {
        frequency_khz: 780, fcc_class: 'D', pattern_mode: 'NDA',
        protected_contours_mvm: { day: 0.5, night: null },
        complaint_types: [
          { id: 'CO_CHANNEL_DAY',    label: 'Co-channel daytime interference',             cfr: '§73.182(a)', trigger: 'New site groundwave reduces co-channel protected area', probability: 'MODERATE', resolution: 'Reduce TPO or add directional pattern' },
          { id: 'CO_CHANNEL_NIGHT',  label: 'Co-channel nighttime skywave interference',   cfr: '§73.182(k)', trigger: 'Skywave reaches Class A or B night-protected area',     probability: 'LOW',      resolution: 'Class D has no nighttime protection' },
          { id: 'ADJACENT_SPURIOUS', label: 'Spurious/harmonic emissions complaint',       cfr: '§73.44',     trigger: 'New transmitter with higher spurious emissions',        probability: 'LOW',      resolution: 'Ensure §73.44 compliance; add filtering if needed' },
          { id: 'GROUNDWAVE_OVERLAP', label: 'Groundwave overlap with nearby co-channel', cfr: '§73.182; §73.37', trigger: 'New site closer to co-channel AM station',        probability: 'MODERATE', resolution: 'Engineering analysis showing contour separation' }
        ],
        n_complaint_types: 4, high_risk_types: 0, moderate_risk_types: 2,
        resolution_timeline: {
          informal_objection_weeks: { min: 8, typical: 16, max: 52 },
          formal_petition_weeks: { min: 26, typical: 52, max: 156 },
          field_inspection_weeks: { min: 4, typical: 12, max: 26 },
          engineering_analysis_weeks: { min: 2, typical: 4, max: 8 }
        },
        defense_cost_estimate: {
          engineering_study_usd: { low: 2000, high: 8000 },
          fcc_counsel_usd: { low: 5000, high: 25000 },
          field_measurement_usd: { low: 3000, high: 10000 },
          total_estimated_usd: { low: 10000, high: 43000 }
        },
        mitigation_steps: [
          { step: 1, action: 'Pre-relocation interference study', detail: 'Commission §73.182 groundwave study vs. co-channel stations within 1000 km', cfr: '§73.182' },
          { step: 2, action: 'FCC LMS co-channel search', detail: 'Identify all AM stations within 3-skywave-skip distances on same channel', cfr: '§73.37(a)' },
          { step: 3, action: 'DA pattern evaluation', detail: 'Evaluate if directional antenna would reduce interference risk', cfr: '§73.150; §73.154' },
          { step: 4, action: 'Notify potentially affected stations', detail: 'Informal notification to co-channel stations whose protected area may be affected', cfr: 'Best practice; §73.3533(a)(7)' },
          { step: 5, action: 'Retain engineering record', detail: 'Document all pre-move interference analyses', cfr: '§73.1800; §73.1840' }
        ],
        n_mitigation_steps: 5,
        reference: '47 CFR §73.37; §73.44; §73.88; §73.150; §73.154; §73.182; §73.3587; §1.106',
        note: 'Interference complaint risk for Class D station at 780 kHz: 0 HIGH, 2 MODERATE. NDA pattern — no directional mitigation available.'
      },
      am_broadcast_translator_path_guide: {
        frequency_khz: 780, fcc_class: 'D', pattern_mode: 'NDA',
        translator_opportunity_available: true,
        am_2mvm_coverage_radius_km: 22.4,
        fm_translator: {
          max_erp_w: 250, max_erp_dbw: 23.98,
          estimated_60dbu_radius_km: 4.5,
          assumed_haat_m: 30,
          band: 'Non-reserved FM (92.1–107.9 MHz)',
          status: 'Secondary (§74.1201(a))'
        },
        spacing_requirements: [
          { separation_type: 'Co-channel',   min_km: 115, cfr: '§74.1204(a)(1)' },
          { separation_type: '1st adjacent', min_km: 55,  cfr: '§74.1204(a)(2)' },
          { separation_type: '2nd adjacent', min_km: 32,  cfr: '§74.1204(a)(3)' },
          { separation_type: '3rd adjacent', min_km: 8,   cfr: '§74.1204(a)(4)' }
        ],
        filing_steps: [
          { step: 1, action: 'Frequency search', detail: 'Identify candidate FM frequencies at proposed AM site', cfr: '§74.1201; §74.1204' },
          { step: 2, action: 'Contour overlay study', detail: 'Verify FM 60 dBu fits within AM 2 mV/m daytime contour', cfr: '§74.1232(d)' },
          { step: 3, action: 'Interference analysis', detail: 'Protect all full-power FM, LPFM, existing translators', cfr: '§74.1204' },
          { step: 4, action: 'File FCC Form 349', detail: 'Submit construction permit application in filing window', cfr: '§74.1231; Form 349' },
          { step: 5, action: 'Construction', detail: 'Build translator facility', cfr: '§74.1263' },
          { step: 6, action: 'License', detail: 'File FCC Form 2100 Schedule 350 after construction', cfr: '§73.3536(b)(5)' }
        ],
        n_filing_steps: 6,
        cost_estimate: {
          frequency_search_usd: { low: 500, high: 2000 },
          engineering_filing_usd: { low: 3000, high: 8000 },
          equipment_usd: { low: 5000, high: 20000 },
          construction_usd: { low: 5000, high: 30000 },
          total_estimated_usd: { low: 13500, high: 60000 },
          annual_operating_usd: { low: 1000, high: 5000 }
        },
        restrictions: [
          { id: 'SIMULCAST_ONLY',   label: 'Must simulcast AM programming 100%', cfr: '§74.1232(d)(3)', severity: 'HARD' },
          { id: 'MAX_ERP',          label: 'Maximum 250W ERP', cfr: '§74.1235(b)', severity: 'HARD' },
          { id: 'CONTOUR_FIT',      label: 'FM 60 dBu contour must fit within AM 2 mV/m daytime contour', cfr: '§74.1232(d)(1)', severity: 'HARD' },
          { id: 'SECONDARY_STATUS', label: 'FM translator is secondary — must accept interference', cfr: '§74.1201(a)', severity: 'HARD' },
          { id: 'NO_STL_RELAY',     label: 'Cannot use translator to relay STL or other studio link', cfr: '§74.1231', severity: 'HARD' }
        ],
        n_restrictions: 5,
        reference: '47 CFR §74.1201; §74.1204; §74.1231; §74.1232; §74.1235; §74.1263; FCC Report and Order FCC 09-15; FCC 12-17; FCC 20-52',
        note: 'AM-to-FM translator simulcast opportunity: 250W ERP max. FM 60 dBu service radius ~4.5 km. AM 2 mV/m daytime radius ~22.4 km.'
      },
      daytime_only_operation_guide: {
        frequency_khz: 780, fcc_class: 'D',
        is_daytime_only: true, is_clear_channel: true,
        operating_hours: { estimated_hours_summer: 14, estimated_hours_winter: 10, estimated_hours_per_day: 12, latitude_used: 34.9 },
        psa_pra: {
          psa_available: true, psa_duration_min: 15, psa_max_power_w: 500, psa_cfr: '§73.99(b)',
          pra_available: true, pra_max_hours_before_sunrise: 2, pra_cfr: '§73.99(c)',
          note: 'PSA and PRA authorizations are automatic per §73.99; no separate filing required unless license restricts'
        },
        fulltime_upgrade: {
          eligible: true,
          method: 'Section 73.99 petition with interference analysis showing no objectionable interference to Class A',
          cfr: '§73.99(a); §73.182',
          typical_requirements: [
            'Night propagation study to the dominant station using FCC groundwave curves',
            'Show that 0.5 mV/m nighttime contour of proposed operation does not overlap dominant Class A service area',
            'For directional antenna: submit new proof-of-performance showing nighttime pattern',
            'Engineering certification by licensed broadcast engineer'
          ],
          processing_weeks: { min: 12, typical: 24, max: 52 }
        },
        operating_constraints: [
          { id: 'SUNRISE_BEGIN', label: 'Operations begin at official local sunrise', cfr: '§73.99(a)', notes: 'FCC provides sunrise/sunset table; must use transmitter site coordinates' },
          { id: 'SUNSET_END',    label: 'Operations cease at official local sunset', cfr: '§73.99(a)', notes: 'Except during PSA window (15 min post-sunset, reduced power)' },
          { id: 'NO_NIGHT_OPS',  label: 'No nighttime transmissions without authority', cfr: '§73.1745', notes: 'Unauthorized transmission is a §503(b) forfeiture offense; $15,000 base forfeiture per day' },
          { id: 'LOG_TIMES',     label: 'Log station sign-on and sign-off times', cfr: '§73.1820', notes: 'Operating log must record sign-on, sign-off, and any interruptions with times' }
        ],
        n_operating_constraints: 4,
        reference: '47 CFR §73.99; §73.1745; §73.1820; §73.182; §503(b) forfeiture; FCC §73.99 App. A',
        note: 'DAYTIME ONLY: Station is restricted to sunrise-to-sunset operation. Relocation may open path to full-time authority.'
      },
      ownership_multiple_rules_guide: {
        frequency_khz: 780, fcc_class: 'D',
        local_am_limit: 5, local_radio_combo_limit: 8,
        market_size_tiers: [
          { market_size: 'LARGE (15+ stations)', max_am: 5, max_fm: 5, max_total: 8 },
          { market_size: 'MEDIUM (10–14)',       max_am: 3, max_fm: 3, max_total: 4 },
          { market_size: 'SMALL (5–9)',          max_am: 2, max_fm: 2, max_total: 3 },
          { market_size: 'TINY (< 5)',           max_am: 2, max_fm: 2, max_total: 2 }
        ],
        attributable_interests: [
          { id: 'DIRECT_OWNERSHIP',   label: 'Direct equity ownership ≥ 25%',          cfr: '§73.3555 Note 2(b)', attributable: true  },
          { id: 'INDIRECT_OWNERSHIP', label: 'Indirect ownership ≥ 25% through chain',  cfr: '§73.3555 Note 2(c)', attributable: true  },
          { id: 'OFFICER_DIRECTOR',   label: 'Officer or director of corporate licensee',cfr: '§73.3555 Note 2(a)', attributable: true  },
          { id: 'LMA_BROKER',         label: 'LMA: programs ≥ 15% of broadcast hours',  cfr: '§73.3555 Note 2(j)', attributable: true  },
          { id: 'JSA',                label: 'JSA (Joint Sales Agreement)',              cfr: '§73.3555 Note 2(k)', attributable: true  },
          { id: 'SILENT_PARTNER',     label: 'Silent partner / passive investor < 25%', cfr: '§73.3555 Note 2(i)', attributable: false }
        ],
        n_attributable_types: 5,
        contour_shift_risk: 'LOW', attribution_risk_level: 'LOW',
        relocation_impact_note: 'Site is within ~30 km of current; metro market attribution likely unchanged — routine §73.3555 review sufficient',
        waiver_standards: [
          { id: 'FINANCIALLY_TROUBLED', label: 'Financially troubled station (failing station defense)', cfr: '§73.3555(f)', notes: 'Allows temporary waivers for stations that would otherwise fail; time-limited' },
          { id: 'NEW_ENTRANT', label: 'Eligible entity / new entrant preference', cfr: '§73.3555 Note 5', notes: 'FCC may grant waiver where eligible entity (small/diverse owner) would benefit market' }
        ],
        practical_steps: [
          'Identify all attributable interests in licensee entity per §73.3555 Notes',
          'Determine Nielsen Audio market (or FCC-defined market if no Arbitron rating)',
          'Count all AM stations with attributable ownership in same market',
          'Verify relocation does not shift station into a new Nielsen market where limits are exceeded',
          'File FCC Form 323 Ownership Report within 30 days of any ownership change (§73.3615)'
        ],
        reference: '47 CFR §73.3555; §73.3615; FCC Form 323; FCC 2018 Quadrennial Review (MB Docket 18-227); 2014 JSA attribution rule',
        note: 'Class D at 780 kHz. Local AM limit: 5. Combo limit: 8. Attribution risk from relocation: LOW.'
      },
      adjacent_channel_protection_guide: {
        frequency_khz: 780, fcc_class: 'D', tpo_kw: 5,
        adjacent_10khz: { required_du_db: 20, lower_channel_khz: 770, upper_channel_khz: 790, sideband_rolloff_db: 20, cfr: '§73.182(b) Table 1' },
        adjacent_20khz: { required_du_db: 6,  lower_channel_khz: 760, upper_channel_khz: 800, sideband_rolloff_db: 40, cfr: '§73.182(b) Table 1' },
        adjacent_channels: [
          { id: 'ADJ10_LOW',  frequency_khz: 770, separation_khz: 10, direction: 'LOWER', du_db_required: 20 },
          { id: 'ADJ10_HIGH', frequency_khz: 790, separation_khz: 10, direction: 'UPPER', du_db_required: 20 },
          { id: 'ADJ20_LOW',  frequency_khz: 760, separation_khz: 20, direction: 'LOWER', du_db_required: 6  },
          { id: 'ADJ20_HIGH', frequency_khz: 800, separation_khz: 20, direction: 'UPPER', du_db_required: 6  }
        ],
        n_adjacent_channels_checked: 4,
        candidate_primary_reach_km: 87.4,
        sideband_rolloff: [
          { offset_khz: 5,  rolloff_db: 3  },
          { offset_khz: 10, rolloff_db: 20 },
          { offset_khz: 20, rolloff_db: 40 },
          { offset_khz: 30, rolloff_db: 60 }
        ],
        assessment_notes: [
          'Check §73.182 Table 1 for exact D/U ratios applicable to your class-pair combination',
          'Your 0.5 mV/m reach from this candidate: 87.4 km — adjacent stations within ~131.1 km may need interference analysis',
          'First adjacent (±10 kHz, 20 dB D/U required): check 770 kHz and 790 kHz licensees',
          'Second adjacent (±20 kHz, 6 dB D/U required): check 760 kHz and 800 kHz licensees',
          'Use FCC AM Query (query.fcc.gov) or LMS to find adjacent-channel stations within interference range',
          'If site change creates new adjacent-channel conflict, FCC may require directional antenna or reduced power to protect'
        ],
        reference: '47 CFR §73.182(b) Table 1; §73.37; FCC AM Query (query.fcc.gov); ITU AM Bandwidth Spec',
        note: '780 kHz Class D. Adj-10 D/U: 20 dB. Adj-20 D/U: 6 dB. 4 adjacent channels to check.'
      },
      main_studio_rule_guide: {
        frequency_khz: 780, fcc_class: 'D',
        main_studio_required: false,
        repeal_date: '2017-11-01',
        repeal_doc: 'FCC 17-18 (MB Docket 17-106)',
        distance_from_col_km: 20,
        col_proximity_note: 'Candidate site is within ~40 km of current site; main studio historically would have been compliant',
        waiver_eligible: false,
        legacy_requirements: [
          { id: 'LOCATION', label: 'Studio location', requirement: 'Within principal community contour or 25 miles of COL reference coordinates', cfr_repealed: '§73.1125(a)' },
          { id: 'STAFFING', label: 'Staffing', requirement: 'Full-time managerial and full-time staff at main studio during business hours', cfr_repealed: '§73.1125(b)' },
          { id: 'EQUIPMENT', label: 'Program origination', requirement: 'Technical capability to originate programming at main studio', cfr_repealed: '§73.1125(c)' },
          { id: 'PUBLIC_FILE', label: 'Public inspection file access', requirement: 'OPIF accessible at main studio or online (online now required)', cfr_current: '§73.3526' }
        ],
        current_obligations: [
          { id: 'OPIF', label: 'Online Public Inspection File (OPIF)', cfr: '§73.3526', notes: 'Must be maintained online at stations.fcc.gov; updated as required. No physical studio required for access.' },
          { id: 'POLITICAL_FILE', label: 'Political file within 1 business day', cfr: '§73.3526(e)(6)', notes: 'Requests for political advertising time must be recorded in OPIF within 1 business day of request.' },
          { id: 'EAS_STATION', label: 'EAS equipment at transmitter or remote control point', cfr: '§11.35', notes: 'EAS decoder must be operational at or electronically connected to monitoring point.' },
          { id: 'REMOTE_CONTROL', label: 'Remote control or attended operation', cfr: '§73.1400', notes: 'Station may be operated unattended by remote control per §73.1400; operator must be able to reduce to minimum power or silence within 3 minutes.' }
        ],
        n_current_obligations: 4,
        practical_guidance: [
          'Main studio rule repealed Nov 2017; no physical staffed studio required',
          'OPIF must be maintained online; accessible to public at stations.fcc.gov',
          'EAS must remain operational; remote control or attended operation required per §73.1400',
          'Political file still requires 1-business-day OPIF entry for advertising requests',
          'Community ascertainment/program origination obligations eliminated for AM'
        ],
        reference: '47 CFR §73.1125 (repealed); §73.3526; §73.3527; §11.35; §73.1400; FCC 17-18 (MB Docket 17-106)',
        note: '§73.1125 main studio requirement REPEALED Nov 2017 (FCC 17-18). No staffed studio required. 4 current OPIF/EAS obligations apply.'
      },
      silent_station_consideration: {
        frequency_khz: 780, fcc_class: 'D',
        silent_authorization: {
          max_silent_weeks: 52,
          initial_sta_form: 'FCC Form 2100',
          sta_options: [
            { id: 'INITIAL_STA', label: 'Initial 30-day STA (§73.1635)', form: 'FCC Form 2100 / FCC Form 319 (legacy)', fee_usd: 290, duration_weeks: 4, notes: 'Must demonstrate good cause; file before going silent or within 10 days' },
            { id: 'RENEWAL_STA', label: 'STA renewal (each 6-month extension)', form: 'STA renewal request (informal letter acceptable)', fee_usd: 290, duration_weeks: 26, notes: 'FCC will grant up to 12 months total absent extraordinary circumstances' },
            { id: 'REDUCED_POWER', label: 'Reduced power STA (interim operation during construction)', form: 'FCC Form 2100', fee_usd: 290, duration_weeks: null, notes: 'Allows partial operation during construction; must protect co-channel/adjacent allocations' }
          ],
          filing_requirement: 'STA required for silent period > 30 days; file FCC Form 2100 citing §73.1635',
          cancellation_risk: 'CP or license may be cancelled after 12 months of silence per §73.1740(a)'
        },
        construction_timeline: {
          steps: [
            { id: 'ZONING_AND_PERMITS', label: 'Zoning approval and building permits', weeks_low: 4, weeks_high: 26, required: true, notes: 'Varies widely by jurisdiction; tower > 200 ft may require conditional use permit' },
            { id: 'SITE_PREP', label: 'Site preparation (clearing, access, ground system)', weeks_low: 2, weeks_high: 6, required: true, notes: 'Ground radial installation is critical path item; 120 radials minimum' },
            { id: 'FOUNDATION', label: 'Tower foundation and anchor construction', weeks_low: 2, weeks_high: 5, required: true, notes: 'Concrete cure time 28 days minimum before tower erection' },
            { id: 'TOWER_ERECT', label: 'Tower erection and climbing crew', weeks_low: 1, weeks_high: 3, required: true, notes: 'Crane required for towers > 200 ft; FAA NOTAM required during erection' },
            { id: 'TUNE_AND_PROOF', label: 'Antenna tuning, base impedance, DA proof if required', weeks_low: 2, weeks_high: 6, required: true, notes: 'DA proof: 72-radial field intensity traversals per §73.154; 2-4 weeks for pattern verification' },
            { id: 'LIC_TO_COVER', label: 'FCC license to cover review (Form 302-AM)', weeks_low: 4, weeks_high: 16, required: true, notes: 'FCC processing; applicant may begin operation upon filing if CP conditions met' }
          ],
          construction_weeks_min: 15, construction_weeks_typical: 32, construction_weeks_max: 62
        },
        license_risk_level: 'MODERATE',
        exceeds_silent_limit: false,
        mitigation_strategies: [
          { id: 'OVERLAP_WINDOW', label: 'Overlap construction with existing site operation', notes: 'Build new tower while operating at old site; file CP for new site, operate old until LTC granted. Avoids silent period entirely.' },
          { id: 'STAGGER_PERMITS', label: 'Accelerate zoning/permit phase before CP filing', notes: 'Begin local permitting and land work before or concurrent with FCC CP application. Reduces critical-path duration.' },
          { id: 'PREFAB_TOWER', label: 'Pre-fabricated guyed tower for faster erection', notes: 'Reduces erection phase from 3 to 1-2 weeks. Useful for standard heights < 300 ft.' },
          { id: 'INTERIM_CP', label: 'File for interim CP on existing site as backup', notes: 'If new site falls through, interim authority to modify existing site preserves continuity. Dual-track approach.' }
        ],
        n_mitigation_strategies: 4,
        reference: '47 CFR §73.1740; §73.1750; §73.1635; §1.65; FCC Form 2100; FCC Form 319 (legacy); §73.154',
        note: 'Construction: 15–62 wks (typical 32 wks). Max silent: 52 wks. License risk: MODERATE.'
      },
      am_propagation_variability_guide: {
        frequency_khz: 780, fcc_class: 'D', sigma_msm: 8,
        channel_type: 'CLEAR',
        seasonal_variation: {
          seasons: [
            { id: 'WINTER', label: 'Winter (Dec–Feb)', sigma_factor: 0.85, coverage_factor: 0.92, notes: 'Frozen ground reduces conductivity; reduced groundwave reach' },
            { id: 'SPRING', label: 'Spring (Mar–May)', sigma_factor: 1.25, coverage_factor: 1.06, notes: 'Wet soil, high moisture; peak conductivity; best groundwave reach' },
            { id: 'SUMMER', label: 'Summer (Jun–Aug)', sigma_factor: 1.00, coverage_factor: 1.00, notes: 'Baseline; typical FCC curve conductivity assumption' },
            { id: 'FALL',   label: 'Fall (Sep–Nov)',   sigma_factor: 0.90, coverage_factor: 0.95, notes: 'Drying soils; conductivity declining toward winter minimum' }
          ],
          worst_case_season: 'WINTER', best_case_season: 'SPRING',
          worst_case_change_pct: -8, best_case_change_pct: 6
        },
        ionospheric_skip: {
          min_skip_distance_km: 274, max_skip_distance_km: 509,
          typical_night_boost_db: 15,
          interference_risk: 'LOW — this station is or shares the dominant assignment'
        },
        fade_margins: { groundwave_seasonal_db: { min: 1, max: 6, typical: 3 }, diurnal_skywave_db: { min: 10, max: 20, typical: 15 }, building_loss_urban_db: { min: 5, max: 12, typical: 8 }, vehicle_mobile_db: { min: 2, max: 6, typical: 4 } },
        mitigation_options: [
          { id: 'GROUND_SYSTEM', label: 'Ground radial system improvement', effectiveness: 'HIGH', notes: 'Adding radials from 60→120 can increase ERP by 1–3 dB; reduces seasonal variation' },
          { id: 'ERECT_HEIGHT',  label: 'Tower height optimization (3/8λ)', effectiveness: 'HIGH', notes: 'Optimal at ~144.2m for 780 kHz; reduces reactive component' },
          { id: 'NIGHT_REDUCTION', label: 'Nighttime power reduction per §73.99', effectiveness: 'MODERATE', notes: 'Accepted regulatory mitigation for secondary stations on clear/regional channels' },
          { id: 'TRANSLATOR', label: 'FM translator supplemental coverage', effectiveness: 'MODERATE', notes: 'FM unaffected by AM skywave; provides reliable night coverage in urban cores' }
        ],
        n_mitigation_options: 4,
        reference: '47 CFR §73.182 Note; ITU-R P.368-10; FCC R&O DA 04-3586; OET Bulletin 73; §73.99',
        note: '780 kHz clear channel. Seasonal coverage swing: -8% to +6%. Night skip zone: 274–509 km. Night boost ~15 dB.'
      },
      adjacent_market_coverage_analysis: {
        fcc_class: 'D', frequency_khz: 780, tpo_kw: 5,
        candidate_dist_from_current_km: 20,
        col_field_thresholds: { day_mvm: 2, night_mvm: null, service_contour_mvm: 0.5 },
        coverage_zones: [
          { id: 'PRIMARY', label: 'Primary Service Contour (0.5 mV/m)', cfr: '§73.182 / §73.187', threshold_mvm: 0.5, radius_km: 87.4, area_km2: 23990.2, service_quality: 'Reliable daytime reception; defines primary coverage area' },
          { id: 'COL_MINIMUM', label: 'City of License Minimum Coverage', cfr: '§73.24 (Class D)', threshold_mvm: 2, radius_km: 42.1, area_km2: 5569.8, service_quality: 'COL must receive ≥2 mV/m daytime for Class D' },
          { id: 'INTERFERENCE_FREE', label: 'Interference-Free Service (5 mV/m)', cfr: '§73.182 Table 1', threshold_mvm: 5, radius_km: 22.3, area_km2: 1561.8, service_quality: 'High-fidelity reception; resists co-channel interference at D/U > 20 dB' }
        ],
        n_coverage_zones: 3,
        primary_service_radius_km: 87.4,
        primary_service_area_km2: 23990.2,
        translator_opportunity: { authorized: true, cfr: '47 CFR §74.1201; FCC AMTA 2020 proceeding', max_erp_w: 250, fm_band: '88.1–107.9 MHz', coverage_note: 'FM translator can extend effective coverage into areas with poor AM reception (buildings, urban canyons)', application_form: 'FCC Form 349', filing_fee_usd: 655, application_window: 'FCC AM Translator Window (periodic; last 2021)', band_stacking: 'FM translator must protect all co-channel and adjacent FM stations per §74.1204' },
        reference: '47 CFR §73.24; §73.182; §73.187; §74.1201; FCC AMTA 2020; FCC Form 349',
        note: 'Class D at 780 kHz. Primary 0.5 mV/m reach: 87.4 km (23990.2 km²). COL min: 5 mV/m day (§73.24(i)). FM translator (250W) authorized under AMTA.'
      },
      license_renewal_compliance_guide: {
        fcc_class: 'D', frequency_khz: 780,
        renewal_cycle: { term_years: 8, form: 'FCC Form 303-S', filing_fee_usd: 345, filing_window_days_before_expiry: 120, publication_required: true, publication_cfr: '§73.3580', publication_notes: '3 consecutive weeks in newspaper of general circulation; OR 4 weeks on-air. Months 5–4 before expiry.', grace_period_days: 30 },
        license_term_years: 8, renewal_form: 'FCC Form 303-S', renewal_filing_fee_usd: 345,
        opif_requirements: [
          { id: 'LICENSE', label: 'FCC License and authorizations', update_freq: 'As issued', cfr: '§73.3526(e)(1)', required: true },
          { id: 'OWNERSHIP_REPORTS', label: 'FCC Form 323 Ownership Reports', update_freq: 'Biennial (every 2 years in even years)', cfr: '§73.3526(e)(3)', required: true },
          { id: 'POLITICAL_FILE', label: 'Political broadcasting records', update_freq: 'Within 1 business day of request', cfr: '§73.3526(e)(6)', required: true },
          { id: 'EEO_ANNUAL', label: 'EEO Annual Public File Report', update_freq: 'Annually, 1 year after renewal window opens', cfr: '§73.2080(c)(6)', required: true },
          { id: 'QUARTERLY_ISSUES', label: 'Issues & Programs Lists', update_freq: 'Quarterly (Jan 10, Apr 10, Jul 10, Oct 10)', cfr: '§73.3526(e)(11)(i)', required: true },
          { id: 'CONTOUR_MAPS', label: 'Station contour maps', update_freq: 'On change of coverage area', cfr: '§73.3526(e)(4)', required: true },
          { id: 'CONSTRUCTION_PERMIT', label: 'Construction permit (if CP pending)', update_freq: 'As issued', cfr: '§73.3526(e)(2)', required: false }
        ],
        n_opif_required: 6,
        eeo_obligations: { threshold_employees: 5, applicable: true, cfr: '§73.2080', outreach_initiatives_per_year: 2, annual_report_form: 'FCC Form 2100 (Schedule 396)', mid_term_review: { required: true, timing: '4 years into license term', form: 'EEO Mid-term Review', cfr: '§73.2080(f)' }, violation_risk: 'Forfeiture or license renewal challenge for documented EEO deficiencies' },
        ownership_reporting: { form: 'FCC Form 323', frequency: 'Biennial (even-numbered years, by December 1)', cfr: '§73.3615', covers: ['Licensee identity and ownership structure', 'Attributable interests', 'Local marketing agreements', 'Time brokerage agreements'], filing_fee_usd: 0 },
        compliance_calendar: [
          { month_before_expiry: 4, action: 'Begin renewal application preparation; confirm OPIF is complete', cfr: '§73.3539' },
          { month_before_expiry: 4, action: 'Publish first newspaper notice of renewal or begin on-air announcements', cfr: '§73.3580' },
          { month_before_expiry: 3, action: 'File Form 303-S with FCC (4 months before license expiry)', cfr: '§73.3539' },
          { month_before_expiry: 0, action: 'License expiry — operate under pending status if renewal not yet granted', cfr: '§73.3539(d)' }
        ],
        n_calendar_actions: 4,
        reference: '47 CFR §73.3539; §73.3526; §73.2080; §73.3580; §73.3615; FCC Form 303-S; FCC Form 323; FCC Form 2100',
        note: 'AM Class D. 8-year license term. Form 303-S renewal filing fee $345. OPIF: 6 required items. EEO: 2 outreach initiatives/year if ≥5 FTE.'
      },
      nighttime_pattern_switching_guide: {
        fcc_class: 'D', frequency_khz: 780, pattern_mode: 'NDA',
        is_clear_channel: true, is_da_pattern: false,
        nighttime_obligation: { power_reduction_required: true, pattern_switch_required: false, night_operation: 'Secondary to Class A; nighttime power reduced or DA-N required to protect dominant station', cfr: '§73.24' },
        power_reduction_required: true, pattern_switch_required: false,
        operating_schedule: [
          { id: 'SUNRISE_TRANSITION', label: 'Sunrise pattern switch (NDA → DA-D or power increase)', cfr: '§73.99(a)', trigger: 'Local sunrise at transmitter site ± 30 min', automation: 'ASID timer or automatic transmission system' },
          { id: 'SUNSET_TRANSITION', label: 'Sunset pattern switch (DA-D → DA-N or power reduction)', cfr: '§73.99(b)', trigger: 'Local sunset at transmitter site ± 30 min', automation: 'ASID timer or automatic transmission system' },
          { id: 'NIGHT_OPERATION', label: 'Nighttime operation (reduced power or DA-N)', cfr: '§73.99(c)', trigger: 'Sunset to sunrise', automation: 'Automatic current monitoring; alarms for excessive base current' },
          { id: 'LOG_ENTRY', label: 'Station log entry at each pattern change', cfr: '47 CFR §73.1820', trigger: 'Each transition', automation: 'Automatic logging system; EAS encoder records; operator signature required if attended' }
        ],
        n_operating_schedule_items: 4,
        asid_requirements: {
          required: true, cfr: '47 CFR §73.1745; §73.1820',
          functions: ['Trigger pattern switch at correct sunrise/sunset time (within ± 15 minutes per §73.99)', 'Reduce transmitter output to licensed nighttime ERP', 'Log each transition with time, current ratios, and any alarms', 'Alert operator if transition fails (current alarm threshold ± 5% of licensed value)', 'Maintain operating schedule within ± 30 minutes of published SR/SS times'],
          cost_est_usd: 3500,
          vendors: ['Burk Technology AutoPilot', 'Broadcastify RCS', 'Axia Livewire+', 'Harris BroadLynx']
        },
        sr_ss_variation: { max_seasonal_diff_hours: 2.9, schedule_update_freq: 'Monthly update to ASID timer recommended; FCC sunrise/sunset tables used', cfr: '§73.99; FCC Sunrise/Sunset Table (Media Bureau)' },
        reference: '47 CFR §73.99; §73.21–§73.24; §73.1745; §73.1820; FCC Sunrise/Sunset Table (Media Bureau)',
        note: 'Class D on clear channel. Night power reduction: required. Pattern switch: not required. ASID: required.'
      },
      property_acquisition_guide: {
        tower_height_m: 144.23, guy_radius_m: 72.12, min_site_radius_m: 87.12,
        min_site_area_m2: 23845.77, min_site_area_acres: 5.89,
        site_options: [
          { id: 'PURCHASE', label: 'Fee Simple Purchase', pros: ['Full control; no landlord risk', 'No annual payments after purchase', 'Simpler FCC application (no lease terms)'], cons: ['Highest upfront cost', 'Illiquid capital', 'Property tax obligation'], cost_usd: 50065, annual_cost_usd: 751, recommended_tenure: 'Permanent', fcc_exhibit: 'Deed or purchase agreement as Exhibit A to Form 301-AM' },
          { id: 'LONG_TERM_LEASE', label: 'Long-Term Lease (≥ 20 years)', pros: ['Lower upfront cost', 'Preserves capital', 'FCC-acceptable with long initial + renewal terms'], cons: ['Landlord approval required for modifications', 'Lease expiry risk at license renewal', 'Annual payments'], cost_usd: 1001, annual_cost_usd: 3004, recommended_tenure: '≥ 20-year initial term with 10-year renewals', fcc_exhibit: 'Signed lease (≥ 20 yr) as Exhibit A; FCC requires copy of lease with Form 301-AM' },
          { id: 'SHORT_TERM_LEASE', label: 'Short-Term Lease (< 20 years)', pros: ['Lowest upfront cost', 'Flexibility if site proves unsuitable'], cons: ['FCC may require justification for short lease', 'License grant may be conditioned on lease renewal', 'High risk at license renewal'], cost_usd: 501, annual_cost_usd: 3004, recommended_tenure: 'Not recommended — FCC prefers ≥ 20-year term', fcc_exhibit: 'Lease with option to renew; FCC will condition grant on maintaining site rights' }
        ],
        n_site_options: 3, recommended_option: 'LONG_TERM_LEASE',
        due_diligence: [
          { id: 'TITLE_SEARCH', label: 'Title search and title insurance', required: true, cost_est_usd: 800, notes: 'Clear title required; check for easements, covenants, or prior encumbrances affecting tower construction' },
          { id: 'SURVEY', label: 'ALTA/NSPS land survey', required: true, cost_est_usd: 3500, notes: 'Required for FCC legal description exhibit; includes monumentation of tower base location' },
          { id: 'ENVIRONMENTAL_REVIEW', label: 'Phase I Environmental Site Assessment', required: true, cost_est_usd: 2800, notes: 'ASTM E1527-21 Phase I ESA required before closing; identifies recognized environmental conditions' },
          { id: 'ZONING_CONFIRM', label: 'Zoning confirmation letter', required: true, cost_est_usd: 350, notes: 'Confirm tower is permitted use or obtain variance before executing purchase agreement' },
          { id: 'ACCESS_EASEMENT', label: 'Access road easement', required: false, cost_est_usd: 1500, notes: 'If site not road-accessible, negotiate easement for permanent access before closing' },
          { id: 'POWER_EASEMENT', label: 'Utility easement (power service)', required: false, cost_est_usd: 1200, notes: 'Confirm utility easement to property line; utility extension may add $5k–$50k depending on distance' }
        ],
        n_required_due_diligence: 4, due_diligence_cost_usd: 7450,
        fcc_form_301_requirement: 'Legal description of transmitter site required as Exhibit A; lease or deed must be attached',
        site_control_required_by: 'FCC requires demonstrated site control before CP grant (47 CFR §1.65)',
        reference: '47 CFR §1.65; 47 CFR §73.3533; FCC Form 301-AM Instructions; ASTM E1527-21; ALTA/NSPS Survey Standards',
        note: 'Min site area: 5.89 acres (23845.77 m²) at 87.12m radius. DD cost est. $7,450. Long-term lease recommended.'
      },
      rf_exposure_compliance_guide: {
        frequency_mhz: 0.78, tpo_kw: 5, mpe_evaluation_required: true, mpe_threshold_kw: 5,
        mpe_limit_gp_mwcm2: 100, mpe_limit_occ_mwcm2: 500,
        exclusion_radius_gp_m: 38.73, exclusion_radius_occ_m: 17.32,
        exposure_zones: [
          { id: 'CONTROLLED', label: 'Controlled (Occupational) Zone', cfr: '47 CFR §1.1310 Table 1', mpe_limit_mwcm2: 500, mpe_limit_vm: 1374.77, exclusion_radius_m: 17.32, who_is_exposed: 'Station employees and contractors aware of and able to exercise control over their exposure', marking_required: 'RF Caution signs; personnel dosimeter recommended', averaging_time_min: 6 },
          { id: 'UNCONTROLLED', label: 'Uncontrolled (General Population) Zone', cfr: '47 CFR §1.1310 Table 1', mpe_limit_mwcm2: 100, mpe_limit_vm: 614.43, exclusion_radius_m: 38.73, who_is_exposed: 'General public, including bystanders without RF training', marking_required: 'RF Warning signs at fence perimeter; barrier required if within exclusion zone', averaging_time_min: 30 }
        ],
        n_exposure_zones: 2,
        evaluation_triggers: [
          { trigger: 'ERP ≥ 5 kW', applicable: true, note: 'AM broadcast evaluation threshold per §1.1310 Table 1' },
          { trigger: 'New construction or modification', applicable: true, note: 'Any new CP or modification requires evaluation or categorical exclusion determination' },
          { trigger: 'Tower within 50m of public access', applicable: true, note: 'Any publicly accessible area within exclusion zone triggers formal MPE evaluation' },
          { trigger: 'Colocation with other RF sources', applicable: false, note: 'Multiple RF sources may require combined field strength analysis per OET-65 §4' }
        ],
        compliance_steps: [
          { step: 1, label: 'Calculate exclusion zones', tool: 'FCC online MPE calculator or OET-65 Supplement B worksheets', days_est: 1 },
          { step: 2, label: 'Survey site for public access points', tool: 'Site walkthrough + aerial mapping', days_est: 1 },
          { step: 3, label: 'Install warning signs at controlled/uncontrolled boundaries', tool: 'ANSI Z535.2 signs; RF WARNING yellow/black', days_est: 1 },
          { step: 4, label: 'Verify fence/barrier compliance per §73.49', tool: 'Physical inspection', days_est: 0.5 },
          { step: 5, label: 'Document and file MPE analysis with Form 301-AM if required', tool: 'FCC LMS filing system', days_est: 1 }
        ],
        n_compliance_steps: 5, total_compliance_days: 4.5,
        applicable_bulletin: 'OET Bulletin 65, Edition 97-01 (August 1997)',
        reference: '47 CFR §1.1310; 47 CFR §1.1307; OET Bulletin 65 (Ed. 97-01); IEEE C95.1-2005; ANSI Z535.2',
        note: 'AM 0.78 MHz, 5 kW ERP. MPE eval required. Uncontrolled exclusion zone: 38.73m; controlled: 17.32m.'
      },
      tower_structural_analysis_guide: {
        tower_height_m: 144.23, tower_height_ft: 473.21, tower_weight_class: 'MEDIUM', asr_required: true,
        wind_exposure_categories: [
          { id: 'B', label: 'Exposure B — Urban / Suburban', basic_wind_speed_mph: 115, design_pressure_psf: 33.84 },
          { id: 'C', label: 'Exposure C — Open Terrain', basic_wind_speed_mph: 120, design_pressure_psf: 36.86 },
          { id: 'D', label: 'Exposure D — Coastal / Exposed', basic_wind_speed_mph: 130, design_pressure_psf: 43.26 }
        ],
        n_exposure_categories: 3,
        selected_exposure: { id: 'C', label: 'Exposure C — Open Terrain', basic_wind_speed_mph: 120, design_pressure_psf: 36.86 },
        design_standard: 'TIA-222-H (2018) / ASCE 7-16',
        antenna_loads: { antenna_assembly_lbs: 275, base_insulator_lbs: 400, guy_wire_tension_lbs: 2163, n_guy_levels: 3, total_tension_load_lbs: 6490 },
        ice_zone: 'MEDIUM', ice_load_psf: 0.75,
        inspection_schedule: [
          { type: 'Initial', frequency: 'Before first use', cfr: 'TIA-222-H §4', required: true, cost_est_usd: 3500, notes: 'PE-stamped report required for FCC ASR if height > 200 ft' },
          { type: 'Periodic', frequency: 'Every 3 years', cfr: 'TIA-222-H §4.2', required: true, cost_est_usd: 2500, notes: 'Visual inspection of all structural members, guy wires, and anchors' },
          { type: 'Post-event', frequency: 'After wind/ice/seismic event', cfr: 'TIA-222-H §4.3', required: true, cost_est_usd: 1500, notes: 'Immediate inspection after any significant weather event exceeding design criteria' },
          { type: 'Corrosion', frequency: 'Every 5 years', cfr: 'SSPC-SP2', required: false, cost_est_usd: 4000, notes: 'Full corrosion inspection and paint/galvanizing assessment.' }
        ],
        n_inspection_types: 4, n_required_inspections: 3,
        cost_estimates: { structural_analysis_pe_usd: 10048, foundation_design_pe_usd: 5885, tower_erection_usd: 55384, guy_wire_system_usd: 14490 },
        total_structural_cost_usd: 85807,
        reference: 'TIA-222-H (2018); ASCE 7-16; 47 CFR §73.49; 47 CFR §17.7; FCC Antenna Structure Registration; SSPC-SP2',
        note: 'Tower 144.23m (473.21ft) — MEDIUM class. Wind exposure C: 120 mph. Ice zone: MEDIUM. Est. structural cost: $85,807.'
      },
      directional_antenna_proof_guide: {
        applicable: false,
        reason: "Pattern mode 'NDA' is not a directional antenna (DA) pattern. §73.154 proof not required.",
        reference: '47 CFR §73.154'
      },
      insurance_liability_analysis: {
        tower_height_m: 144.23, asr_required: true,
        tower_replacement_cost_usd: 317076, equipment_value_usd: 95000, total_insured_value_usd: 412076,
        coverage_lines: [
          { id: 'PROPERTY', label: 'Tower & Equipment Property Insurance', required: true, coverage_limit_usd: 412076, annual_premium_usd: 3709, premium_rate_pct: 0.9, insured_items: ['Tower structure (replacement cost)', 'Transmitter and RF equipment', 'Transmitter building / equipment shelter'], notes: 'Replacement cost coverage required by most lenders. ASR non-compliance may trigger exclusion for aviation-related damage.' },
          { id: 'GENERAL_LIABILITY', label: 'General Liability (CGL)', required: true, per_occurrence_usd: 1000000, aggregate_usd: 2000000, annual_premium_usd: 2100, notes: '$1M/$2M CGL is FCC standard recommendation. Tower collapse and RF exposure claims covered. Tenant/visitor injuries on transmitter site.' },
          { id: 'ERRORS_OMISSIONS', label: 'Broadcast Professional Liability (E&O)', required: false, coverage_limit_usd: 1000000, annual_premium_usd: 2400, notes: 'Covers claims related to broadcast content, signal interference, and operational errors. Required by some broadcast groups.' },
          { id: 'UMBRELLA', label: 'Umbrella / Excess Liability', required: false, coverage_limit_usd: 5000000, annual_premium_usd: 840, notes: 'Extends general liability limits. Recommended for towers adjacent to public areas or roads. ~40% of CGL premium.' }
        ],
        n_coverage_lines: 4, n_required_lines: 2,
        total_annual_premium_usd: 9049, property_annual_premium_usd: 3709, gl_annual_premium_usd: 2100,
        asr_compliance: {
          asr_required: true, tower_height_m: 144.23, threshold_m: 60.96, cfr: '47 CFR §17.7',
          non_compliance_risks: ['Premium surcharge of 15–25% on property coverage', 'Exclusion of aviation-related hull/liability claims', 'FCC forfeiture up to $10,000 (§1.80)', 'FAA enforcement referral for lighting/marking failures', 'Voided coverage if damage linked to non-compliant structure'],
          compliance_steps: ['Register tower with FCC ASR (towers.fcc.gov) before construction', 'Obtain FAA determination (Form 7460-1) if within 6 miles of airport or >60m AGL', 'Install aviation lighting per FAA Advisory Circular 70/7460-1L', 'Submit CP (FCC Form 301-AM) with ASR number in exhibit', 'Notify FCC within 5 days of completion (Form 854)']
        },
        reference: '47 CFR §17.7; 47 CFR §1.80; FAA Form 7460-1; ISO/IEC 27001 (cyber); NAIC Broadcast Insurance Guidelines; FCC ASR Database (towers.fcc.gov)',
        note: 'Total insured value est. $412,076. Annual premium est. $9,049. ASR required for 144.23m tower.'
      },
      site_security_perimeter_guide: {
        tower_height_m: 144.23, fence_radius_m: 7.21, perimeter_m: 45.3,
        mpe_evaluation_required: true, mpe_threshold_kw: 5,
        security_components: [
          { id: 'FENCE', label: '§73.49 Chain-Link Fence or Enclosure', required: true, cfr: '47 CFR §73.49', spec: '8-foot chain-link (ASTM F567), galvanized, with locked entry gate', perimeter_m: 45.3, unit_cost_per_m: 85, cost_usd: 3850.50, notes: 'FCC requires substantial barrier; most inspectors accept 8-ft chain-link with barbed wire top' },
          { id: 'RF_WARNING', label: 'RF Exposure Warning Signs (OET Bulletin 65)', required: true, cfr: '47 CFR §1.1310; OET Bulletin 65', spec: 'ANSI Z535.2 caution signs at all fence entry points; post at ≤ 10m intervals', n_signs: 5, cost_usd: 175, notes: 'ERP 5 kW meets §1.1310 evaluation threshold — RF signage required' },
          { id: 'ANTI_CLIMB', label: 'Anti-Climb Device / Tower Base Barrier', required: true, cfr: '47 CFR §73.49', spec: 'Anti-climb collar on tower base sections (first 4m); smooth conduit sleeve or steel collar', cost_usd: 1200, notes: 'Required at any accessible tower; deters unauthorized climbing' },
          { id: 'INTRUSION_DETECTION', label: 'Intrusion Detection and CCTV', required: false, cfr: 'DHS/CISA Tower Security Guidance', spec: '4-camera IP CCTV system with motion detection; cellular alarm relay to station', n_cameras: 4, cost_usd: 4800, notes: 'Not explicitly required by FCC but strongly recommended post-2001' },
          { id: 'EQUIPMENT_ROOM', label: 'Transmitter Building Physical Security', required: true, cfr: '47 CFR §73.1745; §11.35', spec: 'Solid-core door with deadbolt; no accessible windows at ground level; alarm monitoring', cost_usd: 1800, notes: '§11.35 requires EAS equipment remain secure and operable' }
        ],
        n_components: 5, n_required_components: 4,
        total_capex_usd: 11825.50, annual_maintenance_usd: 473.02,
        primary_regulation: '47 CFR §73.49',
        inspection_authority: 'FCC Field Offices; FCC Enforcement Bureau',
        violation_risk: 'Forfeiture up to $10,000 per violation per day (47 CFR §1.80)',
        reference: '47 CFR §73.49; 47 CFR §1.1310; OET Bulletin 65; ANSI Z535.2; DHS CISA AM Tower Security Guide',
        note: '§73.49 requires fence/enclosure around AM antenna base. Perimeter est. 45.3m at 7.21m radius. Total security capex est. $11,826.'
      },
      environmental_impact_assessment: {
        n_nepa_exclusions: 8,
        categorical_exclusion: {
          applies: true,
          cfr: '47 CFR §1.1306',
          basis: 'Replacement or modification of existing AM broadcast facility with no substantial change in physical structure',
          conditions: ['No wilderness area', 'Outside floodplain', 'No wetland impact', 'No ESA-listed species in APE'],
          limitations: ['Antenna height < 60m above mean terrain', 'No new ground disturbance > 0.5 acres']
        },
        nhpa_106: {
          applicable: true,
          statute: 'National Historic Preservation Act §106 (36 CFR Part 800)',
          trigger: 'Undertaking with federal nexus (FCC license action)',
          process_steps: [
            { step: 1, label: 'APE Delineation', description: 'Define Area of Potential Effect for direct and indirect effects on historic properties', days_est: 10 },
            { step: 2, label: 'Historic Property Identification', description: 'Search National Register, consult SHPO, conduct Phase I survey if needed', days_est: 30 },
            { step: 3, label: 'Effect Assessment', description: 'Determine No Effect / No Adverse Effect / Adverse Effect per 36 CFR §800.5', days_est: 15 },
            { step: 4, label: 'SHPO Consultation', description: 'Submit effect determination to SHPO for 30-day review and concurrence', days_est: 30 },
            { step: 5, label: 'Resolution of Adverse Effects', description: 'If adverse effect: MOA negotiation, public involvement, mitigation measures', days_est: 25 }
          ],
          total_process_days: 110,
          shpo_contact: 'State Historic Preservation Office',
          note: 'FCC will not grant construction permit until §106 compliance is documented'
        },
        esa_section7: {
          statute: 'Endangered Species Act §7 (50 CFR Part 402)',
          screening_tool: 'IPaC (Information for Planning and Consultation)',
          trigger_conditions: ['ESA-listed species in APE', 'Critical habitat overlap'],
          consultation_types: ['Informal consultation (species not likely affected)', 'Formal consultation (may affect, likely to adversely affect)'],
          informal_days_est: 30,
          formal_days_est: 135
        },
        wetland_analysis: {
          statute: 'Clean Water Act §404',
          nationwide_permit_applicable: true,
          nwp_62: {
            number: 62,
            title: 'Recreational Facilities and Broadcast Antenna Structures',
            max_structure_height_m: 150,
            requires_pre_construction_notification: true,
            usace_district: 'Contact local USACE district office',
            conditions: ['Minimize fill in wetlands', 'Mitigation for impacts > 0.1 acre', 'No conversion of special aquatic sites']
          },
          wetland_delineation_required: true,
          firm_flood_zone_check: 'Required — consult FEMA Flood Insurance Rate Map'
        },
        env_risk_level: 'LOW',
        estimated_ea_days: 90,
        environmental_checklist: [
          { id: 'CAT_EX', label: '47 CFR §1.1306 Categorical Exclusion Review', required: true, completed: false, responsible: 'Applicant / Consultant' },
          { id: 'NHPA_106', label: 'NHPA §106 Consultation with SHPO', required: true, completed: false, responsible: 'Applicant / FCC' },
          { id: 'ESA_IPAC', label: 'ESA §7 IPaC Species Screening', required: true, completed: false, responsible: 'Applicant / USFWS' },
          { id: 'CWA_404', label: 'CWA §404 Wetland Delineation & NWP-62', required: true, completed: false, responsible: 'Applicant / USACE' },
          { id: 'FIRM_MAP', label: 'FEMA FIRM Floodplain Map Review', required: true, completed: false, responsible: 'Applicant' },
          { id: 'TRIBAL', label: 'Tribal Historic Preservation Office (THPO) Notification', required: false, completed: false, responsible: 'FCC / Applicant' }
        ],
        n_checklist_items: 6,
        n_required_items: 5,
        reference: '47 CFR §1.1306; §1.1307; NHPA §106 (36 CFR Part 800); ESA §7; CWA §404; NEPA; EO 11988; FCC Environmental Review Guidelines',
        note: 'NEPA categorical exclusion assumed for standard AM relocation with no unusual environmental conditions. EA or EIS required if exclusion criteria not met.'
      },
      ground_conductivity_improvement: {
        frequency_khz: 780, tpo_kw: 5, fcc_class: 'D',
        baseline_sigma_msm: 9, is_high_conductivity: true, is_moderate_conductivity: false, is_low_conductivity: false,
        improvement_techniques: [
          { id: 'RADIAL_EXTENSION', label: 'Extended radial count and length', sigma_impact: 'INDIRECT', applicable: true, cost_per_km2: 12000, max_improvement_pct: 15, description: 'FCC §73.150(b): increasing radial count from 60 to 120 reduces ground loss by ~40%.', prerequisites: ['Open site', 'No flooding'], standard: '§73.150' },
          { id: 'BENTONITE_BACKFILL', label: 'Bentonite clay soil injection', sigma_impact: 'DIRECT', applicable: false, cost_per_km2: 35000, max_improvement_pct: 200, description: 'Sodium bentonite expanded 15× in water; injected around radials.', prerequisites: ['Sandy soil', 'Available water source'], standard: 'IEEE 80-2013' },
          { id: 'CARBON_GROUND_ROD', label: 'Carbon/graphite ground enhancement', sigma_impact: 'DIRECT', applicable: false, cost_per_km2: 22000, max_improvement_pct: 120, description: 'ERITECH ERICO compound; highly conductive carbon matrix bonds to soil.', prerequisites: ['Ground rods accessible'], standard: 'IEEE 80' },
          { id: 'COPPER_MESH', label: 'Copper mesh ground plane (short radials)', sigma_impact: 'EFFECTIVE', applicable: true, cost_per_km2: 45000, max_improvement_pct: 80, description: 'Dense copper mesh buried at 0.15m around tower base.', prerequisites: ['Clear site within 50m'], standard: 'FCC §73.150(b)(2)' },
          { id: 'SALTWATER_PROXIMITY', label: 'Site selection near saltwater / high-sigma terrain', sigma_impact: 'SITE_DEPENDENT', applicable: true, cost_per_km2: 0, max_improvement_pct: 400, description: 'Best sigma improvement via site relocation to coastal/agricultural bottomland.', prerequisites: ['Available land near water'], standard: 'FCC §73.183 conductivity maps' }
        ],
        applicable_techniques: [
          { id: 'RADIAL_EXTENSION', label: 'Extended radial count and length', sigma_impact: 'INDIRECT', applicable: true, cost_per_km2: 12000, max_improvement_pct: 15, description: 'Increasing radials from 60 to 120 reduces ground loss ~40%.', prerequisites: [], standard: '§73.150' },
          { id: 'COPPER_MESH', label: 'Copper mesh ground plane (short radials)', sigma_impact: 'EFFECTIVE', applicable: true, cost_per_km2: 45000, max_improvement_pct: 80, description: 'Dense copper mesh (#10 AWG, 1m grid) buried at 0.15m around tower base.', prerequisites: [], standard: 'FCC §73.150(b)(2)' },
          { id: 'SALTWATER_PROXIMITY', label: 'Site selection near saltwater / high-sigma terrain', sigma_impact: 'SITE_DEPENDENT', applicable: true, cost_per_km2: 0, max_improvement_pct: 400, description: 'Best sigma improvement via site relocation.', prerequisites: [], standard: 'FCC §73.183' }
        ],
        n_all_techniques: 5, n_applicable_techniques: 3,
        sigma_after_improvement_msm: 9, coverage_gain_pct: 0,
        treatment_area_km2: 0.07,
        improvement_budget_usd: { low: 0, high: 0, note: 'No improvement needed — sigma already preferred.' },
        reference: '47 CFR §73.150; §73.183; IEEE Std 80-2013; Terman (1950) Radio Engineers Handbook; Belrose (1966) IRE; ERITECH GCP-35',
        note: 'Baseline σ=9 mS/m (preferred — no improvement needed). Est. σ after improvement: 9 mS/m (+0% coverage).'
      },
      frequency_spectrum_coordination: {
        frequency_khz: 780, fcc_class: 'D', tpo_kw: 5,
        channel_class: 'REGIONAL',
        is_clear_channel: false, is_local_channel: false,
        channel_relationships: [
          { id: 'CO_CHANNEL', label: 'Co-channel (0 kHz separation)', cfr: '47 CFR §73.182', du_daytime_db: 20, du_nighttime_db: 0, min_spacing_km: 402, class_applies: 'ALL', notes: 'D/U ≥ 20 dB day; ≥ 0 dB night.' },
          { id: 'FIRST_ADJ', label: 'First adjacent (±10 kHz)', cfr: '47 CFR §73.184', du_daytime_db: 6, du_nighttime_db: -6, min_spacing_km: 322, class_applies: 'ALL', notes: 'D/U ≥ 6 dB during daytime.' },
          { id: 'SECOND_ADJ', label: 'Second adjacent (±20 kHz)', cfr: '47 CFR §73.182(r)', du_daytime_db: 0, du_nighttime_db: -12, min_spacing_km: 161, class_applies: 'ALL', notes: 'D/U ≥ 0 dB day.' },
          { id: 'THIRD_ADJ', label: 'Third adjacent (±30 kHz)', cfr: '47 CFR §73.182(r)', du_daytime_db: -6, du_nighttime_db: -18, min_spacing_km: 80, class_applies: 'ALL', notes: 'D/U ≥ -6 dB day.' },
          { id: 'IBOC_SIDEBAND', label: 'IBOC/HD Radio sideband (±15 kHz)', cfr: '47 CFR §73.404', du_daytime_db: -10, du_nighttime_db: -10, min_spacing_km: 160, class_applies: 'HD_AUTHORIZED', notes: 'HD Radio digital sidebands at ±15 kHz.' }
        ],
        n_relationships: 5,
        protection_contours: { day_mvm: 2.0, night_mvm: 0.5, col_mvm: 5 },
        nif_required: false, nif_service_area_km2: null,
        coordination_zone_km: 402,
        coordination_items: [
          { item: 'Co-channel station database search', cfr: '§73.182', required: true, tool: 'FCC LMS API or REC Networks AMQUERY' },
          { item: 'First adjacent station search (±10 kHz)', cfr: '§73.184', required: true, tool: 'FCC LMS API' },
          { item: 'Second adjacent station search (±20 kHz)', cfr: '§73.182(r)', required: true, tool: 'FCC LMS API' },
          { item: 'Third adjacent station search (±30 kHz)', cfr: '§73.182(r)', required: true, tool: 'FCC LMS API' },
          { item: 'IBOC interference study', cfr: '§73.404', required: false, tool: 'iBiquity/xperi modeling software' },
          { item: 'NIF study (clear channel)', cfr: '§73.182', required: false, tool: 'FCC groundwave/skywave propagation software' },
          { item: 'Treaty protection analysis (Canada/Mexico)', cfr: '§73.1650', required: true, tool: 'FCC treaty database; AMQUERY' }
        ],
        n_coordination_items: 7, n_required_items: 5,
        coordination_timeline: { database_search_days: 3, propagation_study_days: 5, expert_review_days: 5, total_days: 13, note: 'Engineering study must be filed with Form 301-AM as Exhibit C (Interference Analysis)' },
        reference: '47 CFR §73.182; §73.37; §73.184; §73.404; §73.1650; FCC AM Allocation Engineering Data; REC Networks AMQUERY',
        note: 'REGIONAL channel at 780 kHz. Co-channel zone: 402 km. NIF study: not required.'
      },
      stl_network_link_guide: {
        frequency_khz: 780, fcc_class: 'D',
        stl_path_distance_km: 20,
        stl_options: [
          { id: 'UHF_950MHZ', label: '950 MHz STL (Part 74)', band_mhz: 950, part: 'Part 74 §74.502', los_required: true, max_range_km: 80, audio_quality: 'BROADCAST_QUALITY', latency_ms: 2, data_rate_kbps: 128, fcc_license_required: true, cost_usd_est: 8500, suitable: true, pros: ['Broadcast standard', 'Low latency', 'Licensed spectrum protection'], cons: ['LOS required', 'FCC license ($1,035 fee)'] },
          { id: 'IP_STL', label: 'IP/Internet STL (codec pair)', band_mhz: null, part: 'No FCC license required', los_required: false, max_range_km: 10000, audio_quality: 'BROADCAST_QUALITY', latency_ms: 80, data_rate_kbps: 192, fcc_license_required: false, cost_usd_est: 4200, suitable: true, pros: ['No LOS required', 'No FCC license', 'Low cost'], cons: ['Internet latency/jitter'] },
          { id: 'MICROWAVE_STL', label: 'Microwave STL (Part 101, 6–11 GHz)', band_mhz: 7125, part: 'Part 101 §101.113', los_required: true, max_range_km: 120, audio_quality: 'BROADCAST_QUALITY', latency_ms: 1, data_rate_kbps: 10000, fcc_license_required: true, cost_usd_est: 18000, suitable: true, pros: ['Very high capacity', 'Extremely low latency'], cons: ['High cost', 'Strict LOS requirement'] },
          { id: 'FIBER_STL', label: 'Fiber optic (leased or owned)', band_mhz: null, part: 'No FCC license (private wire)', los_required: false, max_range_km: 1000, audio_quality: 'BROADCAST_QUALITY', latency_ms: 5, data_rate_kbps: 1000000, fcc_license_required: false, cost_usd_est: 29000, suitable: false, pros: ['No weather fade', 'Unlimited capacity'], cons: ['Expensive for long distances', 'Trenching required'] }
        ],
        n_stl_options: 4,
        recommended_stl: { id: 'UHF_950MHZ', label: '950 MHz STL (Part 74)', los_required: true, fcc_license_required: true, cost_usd_est: 8500 },
        los_analysis: { path_distance_km: 20, fresnel_zone_1_m: 14.49, clearance_required_m: 8.69, k_factor: 1.33, earth_bulge_m: 5.91, note: 'Actual LOS analysis requires 30m terrain DEM profile.', survey_required: true },
        redundancy_plan: { primary: '950 MHz STL (Part 74)', secondary: 'IP/Internet STL (codec pair)', failover_time_sec: 5, eas_continuity: 'EAS audio must be maintained through backup link per §11.35', sla_requirement: '99.9% uptime = max 8.76 hrs/yr downtime' },
        part74_licensing: { applicable: true, form: 'FCC Form 601 (UHF STL) or FCC Form 601 (microwave)', fee_usd: 1035, coordination: 'Frequency coordination required before filing', processing_days: 45, note: 'Part 74 STL license is separate from AM station license' },
        equip_cost_usd: 8500, install_cost_usd: 2550, license_fee_usd: 1035, total_stl_cost_usd: 12085,
        reference: '47 CFR Part 74 §74.502; Part 101 §101.113; §11.35 EAS; SBE RP-5 (2020) STL system design guide; FCC Form 601',
        note: 'STL path ~20 km. Recommended: 950 MHz STL (Part 74). Total estimated cost: $12,085.'
      },
      regulatory_filing_checklist: {
        frequency_khz: 780, fcc_class: 'D', pattern_mode: 'NDA',
        is_da: false, is_clear_channel: false, needs_asr: true,
        pre_filing: [
          { id: 'SITE_SURVEY', phase: 'PRE_FILING', form: 'None (internal)', required: true, description: 'Ground conductivity survey (Wenner 4-pin method); soil analysis for radial design' },
          { id: 'FAA_OE', phase: 'PRE_FILING', form: 'FAA Form 7460-1', required: true, description: 'FAA aeronautical study (OE/AAA). Required when tower exceeds 61m. REQUIRED for this site.' },
          { id: 'ASR', phase: 'PRE_FILING', form: 'FCC ASR (CORES)', required: true, description: 'Antenna Structure Registration. Required when tower ≥ 60.96m AGL. REQUIRED.' },
          { id: 'ENV_REVIEW', phase: 'PRE_FILING', form: 'FCC Environmental Review', required: false, description: 'FCC §1.1306/§1.1307 NEPA environmental checklist.' },
          { id: 'SHPO', phase: 'PRE_FILING', form: 'NHPA §106 Consultation', required: false, description: 'State Historic Preservation Officer consultation.' },
          { id: 'SPACING_STUDY', phase: 'PRE_FILING', form: 'Engineering study', required: true, description: 'Co-channel and adjacent-channel spacing verification per §73.182.' },
          { id: 'NIF_STUDY', phase: 'PRE_FILING', form: 'Engineering study', required: false, description: 'Nighttime interference/protection study. Not required (not clear channel).' }
        ],
        fcc_forms: [
          { id: 'FORM_301_AM', phase: 'FCC_APPLICATION', form: 'FCC Form 301-AM', required: true, fee_usd: 6465, description: 'Application for construction permit — major change of facility.' },
          { id: 'FORM_603', phase: 'FCC_APPLICATION', form: 'FCC Form 603 (if transfer)', required: false, fee_usd: 820, description: 'Transfer of control / assignment of license.' },
          { id: 'FORM_301_EXH', phase: 'FCC_APPLICATION', form: 'Form 301-AM Exhibit A', required: false, description: 'Directional antenna pattern exhibit. Not required (NDA).' },
          { id: 'FORM_301_HRP', phase: 'FCC_APPLICATION', form: 'Form 301-AM HRP', required: false, description: 'Horizontal radiation pattern table. Not required (NDA).' },
          { id: 'FORM_335', phase: 'FCC_APPLICATION', form: 'FCC Form 335', required: true, fee_usd: 0, description: 'AM antenna efficiency certification.' }
        ],
        construction_filings: [
          { id: 'GROUND_SYSTEM', phase: 'CONSTRUCTION', form: 'Engineering certification', required: true, description: 'Radial ground system installation certification.' },
          { id: 'TOWER_LIGHTING', phase: 'CONSTRUCTION', form: 'FCC FAA coordination', required: true, description: 'Tower lighting and marking compliance certification per §17.7.' },
          { id: 'TOWER_REG', phase: 'CONSTRUCTION', form: 'ASR update', required: true, description: 'Update ASR registration with actual tower height after construction.' }
        ],
        post_construction: [
          { id: 'FORM_302_AM', phase: 'POST_CONSTRUCTION', form: 'FCC Form 302-AM', required: true, fee_usd: 0, description: 'License to cover construction permit.' },
          { id: 'DA_PROOF', phase: 'POST_CONSTRUCTION', form: 'DA Proof of Performance', required: false, description: 'DA field strength traversal. Not required (NDA).' },
          { id: 'MPE_STUDY', phase: 'POST_CONSTRUCTION', form: 'MPE Exhibit (Form 302)', required: true, description: 'RF exposure MPE analysis per OET Bulletin 65. REQUIRED (5 kW).' },
          { id: 'ANNUAL_EAS', phase: 'ONGOING', form: 'EAS Compliance Review', required: true, description: 'Annual EAS compliance review per §11.61.' }
        ],
        n_total_filings: 18,
        n_required_filings: 11,
        total_required_fees_usd: 6465,
        filings_by_phase: [
          { phase: 'PRE_FILING', required_count: 4, filings: [] },
          { phase: 'FCC_APPLICATION', required_count: 2, filings: [] },
          { phase: 'CONSTRUCTION', required_count: 3, filings: [] },
          { phase: 'POST_CONSTRUCTION', required_count: 2, filings: [] },
          { phase: 'ONGOING', required_count: 1, filings: [] }
        ],
        reference: '47 CFR §73.150; §73.154; §73.182; §73.1212; §1.1307; §17.7; FCC Form 301-AM instructions; FCC Media Bureau AM processing guide 2024',
        note: '11 required filings for Class D NDA at 780 kHz. Total FCC fees: $6,465. DA proof required: false. ASR/FAA: true.'
      },
      transmitter_cooling_hvac_guide: {
        frequency_khz: 780, tpo_kw: 5, fcc_class: 'D',
        tx_efficiency_pct: 58, tx_heat_kw: 3.62, tx_draw_kw: 8.62,
        ancillary_heat_kw: 0.65, total_heat_kw: 4.27, total_heat_btu_h: 14569.64,
        hvac_capacity_tons: 1.76, hvac_capacity_kw: 6.19,
        design_criteria: { supply_air_temp_c: 18, return_air_temp_c: 27, max_room_temp_c: 30, min_room_temp_c: 15, humidity_rh_low: 40, humidity_rh_high: 60, air_changes_per_hour: 14 },
        hvac_options: [
          { id: 'SPLIT_SYSTEM', label: 'Mini-split or split system', suitable_kw_max: 10, suitable: true, cooling_cop: 3.2, power_kw: 1.93, pros: ['Low first cost', 'Easy installation'], cons: ['Limited capacity'] },
          { id: 'PACKAGED_RTU', label: 'Packaged rooftop unit (RTU)', suitable_kw_max: 50, suitable: true, cooling_cop: 2.8, power_kw: 2.21, pros: ['Self-contained', 'Standard utility connections'], cons: ['Requires roof penetrations'] },
          { id: 'PRECISION_COOLING', label: 'Precision computer room AC (CRAC)', suitable_kw_max: 200, suitable: true, cooling_cop: 2.5, power_kw: 2.48, pros: ['Temperature/humidity control ±0.5°C', 'ASHRAE A1 rated'], cons: ['High cost'] }
        ],
        n_hvac_options: 3,
        recommended_hvac: { id: 'SPLIT_SYSTEM', label: 'Mini-split or split system', suitable_kw_max: 10, suitable: true, cooling_cop: 3.2, power_kw: 1.93 },
        n_plus_one_redundancy: { strategy: 'N+1 redundancy', n_units: 2, each_unit_tons: 1.14, note: 'N+1: each unit sized at 65% capacity so either unit alone handles 100% of design load' },
        annual_hvac_cost_usd: 2032,
        maintenance_schedule: [
          { interval: 'Monthly', task: 'Check filter condition and replace if ΔP > 0.25 in. H2O' },
          { interval: 'Monthly', task: 'Verify supply/return air temperatures meet ASHRAE targets' },
          { interval: 'Quarterly', task: 'Clean condenser coils; check refrigerant pressure' },
          { interval: 'Biannual', task: 'Belt tension check (if belt-drive); motor lubrication' },
          { interval: 'Annual', task: 'Full refrigerant leak test; compressor megohm test; EER measurement' }
        ],
        n_maintenance_tasks: 5,
        thermal_risk_level: 'MODERATE',
        thermal_protection: [
          { measure: 'High-temp transmitter interlock (§73.49)', threshold_c: 55, action: 'Reduce power to 50%; alarm' },
          { measure: 'High-temp room alarm', threshold_c: 38, action: 'Alert engineer; engage backup cooling' },
          { measure: 'Fire suppression (FM-200 preferred)', threshold_c: null, action: 'Automatic release at detector activation' }
        ],
        reference: 'ASHRAE 2021 Thermal Guidelines for Data Processing Environments; NFPA 70 §430; FCC §73.49; EIA/TIA-569-D',
        note: 'Transmitter heat: 3.62 kW; total facility heat: 4.27 kW (14,569 BTU/h). HVAC capacity: 1.76 tons (6.19 kW). Est. annual HVAC cost: $2,032.'
      },
      zoning_land_use_compatibility_guide: {
        frequency_khz: 780, fcc_class: 'D',
        tower_height_est_m: 144.23, tower_height_est_ft: 473.19,
        zoning_tiers: [
          { id: 'AGRICULTURAL', label: 'Agricultural / Rural', compatibility: 'EXCELLENT', approval_difficulty: 'LOW', typical_setback_m: 50, height_limit_m: null, conditional_use_required: false, variance_likely: false, timeline_months: 2, notes: 'Best zoning class for AM towers.' },
          { id: 'INDUSTRIAL', label: 'Industrial / Heavy Commercial', compatibility: 'GOOD', approval_difficulty: 'LOW', typical_setback_m: 30, height_limit_m: null, conditional_use_required: true, variance_likely: false, timeline_months: 3, notes: 'CUP typically required.' },
          { id: 'COMMERCIAL', label: 'Commercial', compatibility: 'FAIR', approval_difficulty: 'MODERATE', typical_setback_m: 20, height_limit_m: 30, conditional_use_required: true, variance_likely: true, timeline_months: 5, notes: 'Height variance required.' },
          { id: 'RESIDENTIAL', label: 'Residential', compatibility: 'POOR', approval_difficulty: 'HIGH', typical_setback_m: 15, height_limit_m: 12, conditional_use_required: true, variance_likely: true, timeline_months: 12, notes: 'Significant opposition likely.' },
          { id: 'WETLAND_FLOODPLAIN', label: 'Wetland / Floodplain', compatibility: 'EXCELLENT_CONDUCTIVITY', approval_difficulty: 'VERY_HIGH', typical_setback_m: 100, height_limit_m: null, conditional_use_required: true, variance_likely: false, timeline_months: 18, notes: 'Excellent conductivity but permitting burden 12–24 months.' }
        ],
        n_zoning_tiers: 5,
        tower_height_vs_zoning: [
          { zone_id: 'AGRICULTURAL', zone_label: 'Agricultural / Rural', height_limit_m: null, tower_height_m: 144.23, variance_required: false, clearance_m: null },
          { zone_id: 'INDUSTRIAL', zone_label: 'Industrial / Heavy Commercial', height_limit_m: null, tower_height_m: 144.23, variance_required: false, clearance_m: null },
          { zone_id: 'COMMERCIAL', zone_label: 'Commercial', height_limit_m: 30, tower_height_m: 144.23, variance_required: true, clearance_m: 114.23 },
          { zone_id: 'RESIDENTIAL', zone_label: 'Residential', height_limit_m: 12, tower_height_m: 144.23, variance_required: true, clearance_m: 132.23 },
          { zone_id: 'WETLAND_FLOODPLAIN', zone_label: 'Wetland / Floodplain', height_limit_m: null, tower_height_m: 144.23, variance_required: false, clearance_m: null }
        ],
        nepa_triggers: [
          { trigger: 'Wilderness Area / National Park', applies: false, form: 'FCC Form 620 Environmental Review', risk: 'PROHIBITIVE' },
          { trigger: 'Floodplain (100-year)', applies: false, form: 'FEMA Elevation Certificate + §1.1307', risk: 'HIGH' },
          { trigger: 'Wetland (CWA §404)', applies: false, form: 'Army Corps NWP or Individual Permit', risk: 'HIGH' },
          { trigger: 'Endangered Species (ESA)', applies: false, form: 'USFWS Section 7 Consultation', risk: 'MODERATE' },
          { trigger: 'Historic Properties (NHPA §106)', applies: false, form: 'SHPO Consultation', risk: 'MODERATE' },
          { trigger: 'Tribal Lands', applies: false, form: 'Tribal Consultation Required', risk: 'MODERATE' },
          { trigger: 'ATDS Aeronautical Study (FAA OE)', applies: true, form: 'FAA Form 7460-1', risk: 'REQUIRED' }
        ],
        n_nepa_triggers: 7,
        fcc_preemption: { statute: '47 USC §332(c)(7)', applies_to_am: 'PARTIAL', effective_prohibition_standard: 'Local zoning cannot effectively prohibit broadcast service', shot_clock: 'No FCC shot clock for AM broadcast', note: 'AM broadcast towers fall under local zoning authority more fully than wireless towers.' },
        site_preference_order: [
          { rank: 1, zone: 'AGRICULTURAL', reason: 'Lowest opposition, no height limit, excellent conductivity typical' },
          { rank: 2, zone: 'INDUSTRIAL', reason: 'CUP required but approvals fast' },
          { rank: 3, zone: 'COMMERCIAL', reason: 'Feasible with variance for height' },
          { rank: 4, zone: 'WETLAND_FLOODPLAIN', reason: 'Superior conductivity but permitting burden 12–24 months' },
          { rank: 5, zone: 'RESIDENTIAL', reason: 'Avoid unless no alternative' }
        ],
        access_requirements: [
          { item: 'Permanent access road easement', required: true, width_m: 5, notes: 'FCC requires reliable access to transmitter site per §73.49' },
          { item: 'Ground radial field easement', required: true, width_m: 57.69, notes: 'Radials extend ~57.69m; need easement or ownership' },
          { item: 'Utility easement (power + telco)', required: true, width_m: 10, notes: 'Electrical service + STL/IP link easement' },
          { item: 'Fencing easement (§73.49 RF barrier)', required: true, width_m: 2, notes: 'FCC §73.49 requires locked fencing around tower base' }
        ],
        n_access_requirements: 4,
        reference: '47 CFR §1.1307 (NEPA); 47 USC §332(c)(7); CWA §404; ESA §7; NHPA §106; NFPA 101; FCC Env. Review',
        note: 'Tower height est. 144.23 m (473.19 ft) for Class D at 780 kHz. Agricultural/industrial zoning preferred. Height variance likely in commercial zones.'
      },
      emergency_power_backup_guide: {
        frequency_khz: 780, tpo_kw: 5, fcc_class: 'D',
        transmitter_draw_kw: 8.62, facility_overhead_kw: 1.05, total_facility_load_kw: 9.67,
        recommended_gen_kw: 12.09,
        gen_options: [
          { id: 'PORTABLE', label: 'Portable genset', rating_kw: 12.09, fuel_type: 'gasoline', runtime_hrs_per_tank: 8, suitable: true, pros: ['Low capital cost ($2K–$5K)', 'Moveable'], cons: ['Gasoline storage risk', 'Manual start', 'High maintenance', 'Noisy'] },
          { id: 'STATIONARY_DIESEL', label: 'Stationary diesel genset', rating_kw: 30, fuel_type: 'diesel', runtime_hrs_per_tank: 72, suitable: true, pros: ['NFPA 110 compliant', 'Auto-start ATS', 'Long runtime (≥72hr)', 'Lower fuel cost than propane'], cons: ['Higher capital cost ($15K–$80K)', 'Requires spill containment'] },
          { id: 'PROPANE_NG', label: 'Propane / natural gas genset', rating_kw: 20, fuel_type: 'propane_or_ng', runtime_hrs_per_tank: 48, suitable: true, pros: ['No diesel spill risk', 'Indefinite runtime (NG tie-in)', 'Lower maintenance'], cons: ['NG pressure may drop during regional emergency'] }
        ],
        n_gen_options: 3,
        ups_bridge_target_min: 15, eas_load_w: 250, ups_capacity_wh: 75,
        ups_options: [
          { type: 'ONLINE_DOUBLE_CONVERSION', watt_hours: 600, runtime_min: 144, cost_usd_est: 800 },
          { type: 'LINE_INTERACTIVE', watt_hours: 400, runtime_min: 96, cost_usd_est: 400 }
        ],
        diesel_fuel_72hr_gal: 93.6, fuel_storage_class: 'CLASS_IIB_TANK',
        ats_spec: { transfer_time_sec: 10, ats_rating_a: 50, nec_article: '700.12(B)', nfpa_110_class: 'CLASS_60', utility_notify: 'Required if >100A at utility meter per NESC §230' },
        compliance_checklist: [
          { item: '§11.35(a) EAS equipment on backup power', required: true, status: 'REQUIRED' },
          { item: '§73.1530 auxiliary transmitter authorization', required: false, status: 'OPTIONAL' },
          { item: 'NFPA 110 generator installation standard', required: false, status: 'RECOMMENDED' },
          { item: 'Local fire code — fuel storage permit', required: true, status: 'REQUIRED' },
          { item: 'Monthly genset test run (30 min at ≥30% load)', required: false, status: 'RECOMMENDED' },
          { item: 'Annual load bank test', required: false, status: 'RECOMMENDED' },
          { item: 'Automatic transfer switch test quarterly', required: false, status: 'RECOMMENDED' }
        ],
        n_checklist_items: 7,
        total_capex_est_usd: 18850,
        reference: '47 CFR §11.35; §73.1530; NFPA 110 (2021 ed.); NEC Article 700; NESC §230; NFPA 30 fuel storage',
        note: 'Emergency power for 5 kW TPO at 780 kHz. Total facility load: 9.67 kW; recommended generator: 12.09 kW. Estimated capital cost: $18,850.'
      },
      market_competitive_analysis: {
        frequency_khz: 780, tpo_kw: 5, fcc_class: 'D',
        channel_type: 'REGIONAL',
        market_profile: { n_am_typical: 8, n_clear_typical: 1, competition_tier: 'SMALL_MARKET' },
        am_formats: [
          { id: 'NEWS_TALK', label: 'News/Talk', share_pct: 28, trend: 'STABLE', revenue_index: 1.20 },
          { id: 'SPORTS', label: 'Sports', share_pct: 18, trend: 'GROWING', revenue_index: 1.35 },
          { id: 'RELIGIOUS', label: 'Religious', share_pct: 16, trend: 'STABLE', revenue_index: 0.75 },
          { id: 'SPANISH', label: 'Spanish/Ethnic', share_pct: 14, trend: 'GROWING', revenue_index: 1.10 },
          { id: 'OLDIES_MOR', label: 'Oldies/MOR', share_pct: 10, trend: 'DECLINING', revenue_index: 0.80 },
          { id: 'COUNTRY', label: 'Country', share_pct: 7, trend: 'STABLE', revenue_index: 1.00 },
          { id: 'OTHER', label: 'Other/Unrated', share_pct: 7, trend: 'DECLINING', revenue_index: 0.60 }
        ],
        n_formats: 7,
        co_channel_competitor_radius_km: 402,
        estimated_co_channel_competitors: 2,
        streaming_competition: { dab_applicable: false, iboc_hd_pct: 18, streaming_threat: 'MODERATE', podcast_overlap: 'MODERATE', smart_speaker_pct: 31 },
        moat_factors: [
          { factor: 'High conductivity site', value: true, benefit: 'Superior groundwave propagation; larger COL service area' }
        ],
        n_moat_factors: 1,
        revenue_benchmark_usd: { low: 50000, high: 300000, median: 120000 },
        audience_erosion: { am_total_weekly_reach_pct: 14.5, annual_decline_pct: -3.2, under_35_share_pct: 8, peak_commute_share_pct: 52, sports_bump_pct: 6 },
        relocation_impact: { coverage_expansion_benefit: 'Larger COL contour increases TSA eligibility', signal_parity_note: 'Site relocation cannot increase TPO; coverage improvement from conductor/height only', format_flexibility: 'MODERATE', comp_differentiation: 'Competitive differentiation via format strategy and local content' },
        reference: 'BIA/Kelsey AM Revenue Survey 2022; NAB State of the News Media 2023; Pew Research AM/FM Listening 2023; FCC LMS AM database',
        note: 'Class D regional at 780 kHz. Estimated 8 co-market AM stations; 1 competitive moat factor identified.'
      },
      terrain_path_loss_analysis: {
        frequency_khz: 780, tpo_kw: 5, sigma_msm: 9, wavelength_m: 384.62,
        terrain_class: { id: 'FLAT', label: 'Flat / coastal', delta_h_m: 15, path_loss_extra_db: 0, description: 'Plains, desert, coastal marsh. Closest to smooth-earth FCC curves.' },
        terrain_classes: [
          { id: 'FLAT', label: 'Flat / coastal', delta_h_m: 15, path_loss_extra_db: 0, description: 'Plains, desert, coastal marsh.' },
          { id: 'ROLLING', label: 'Rolling terrain', delta_h_m: 50, path_loss_extra_db: 2.5, description: 'Gently rolling hills.' },
          { id: 'HILLY', label: 'Hilly terrain', delta_h_m: 120, path_loss_extra_db: 5.0, description: 'Pronounced hills.' },
          { id: 'MOUNTAINOUS', label: 'Mountainous', delta_h_m: 300, path_loss_extra_db: 9.0, description: 'Ridge-to-valley terrain.' },
          { id: 'SEVERE', label: 'Severe mountain', delta_h_m: 500, path_loss_extra_db: 14, description: 'Deep canyons.' }
        ],
        n_terrain_classes: 5,
        itm_inputs: { frequency_mhz: 0.78, wavelength_m: 384.62, polarization: 'vertical', climate_zone: 'continental_temperate', surface_refractivity_N: 301, delta_h_m: 15, ground_sigma_msm: 9, relative_permittivity: 25 },
        path_loss_profile: [
          { distance_km: 1,   smooth_loss_db: 30, terrain_extra_db: 0,   total_loss_db: 30, field_strength_mvm: 316.23 },
          { distance_km: 10,  smooth_loss_db: 58, terrain_extra_db: 0,   total_loss_db: 58, field_strength_mvm: 39.81 },
          { distance_km: 25,  smooth_loss_db: 72, terrain_extra_db: 0,   total_loss_db: 72, field_strength_mvm: 7.94 },
          { distance_km: 50,  smooth_loss_db: 84, terrain_extra_db: 0,   total_loss_db: 84, field_strength_mvm: 1.99 },
          { distance_km: 100, smooth_loss_db: 96, terrain_extra_db: 0,   total_loss_db: 96, field_strength_mvm: 0.50 },
          { distance_km: 200, smooth_loss_db: 110, terrain_extra_db: 0,  total_loss_db: 110, field_strength_mvm: 0.10 }
        ],
        n_profile_distances: 6,
        ridge_diffraction: { applicable: false, note: 'Terrain too flat for significant knife-edge diffraction.' },
        coverage_reduction_factor: 1.0,
        effective_2mvm_coverage_km: 50,
        propagation_study_required: false,
        propagation_notes: [
          'Terrain class: Flat / coastal (Δh ≈ 15m)',
          'Estimated terrain correction: +0 dB excess path loss',
          'Smooth-earth FCC groundwave curves (§73.183) applicable with minor terrain correction',
          'Ground conductivity σ=9 mS/m; permittivity ε=25',
          'Polarization: vertical (AM §73.150); climate: continental_temperate'
        ],
        fcc_method: '§73.182 groundwave curves; §73.183 terrain correction; ITM (Longley-Rice) for mountainous terrain',
        reference: '47 CFR §73.182; §73.183; FCC OET Supplement B (ITM v7.0); Longley-Rice (NTIA Report 82-100); Hufford (1995)',
        note: 'ITM terrain path loss analysis for 780 kHz at 5 kW. Flat terrain — smooth-earth FCC curves apply directly.'
      },
      antenna_height_optimization: {
        fcc_class: 'D', frequency_khz: 780,
        wavelength_m: 384.62, quarter_wave_m: 96.15, five_eighths_wave_m: 240.38,
        standard_height_fraction: 0.375, standard_height_m: 144.23, standard_height_ft: 473.19,
        standard_elec_deg: 135,
        height_tiers: [
          { elec_deg: 90,  frac_lambda: 0.25,  label: 'Quarter-wave (λ/4)',   eff_rel: 0.78, height_m: 96.15,  height_ft: 315.46 },
          { elec_deg: 120, frac_lambda: 0.33,  label: 'One-third wave',        eff_rel: 0.88, height_m: 128.21, height_ft: 420.64 },
          { elec_deg: 135, frac_lambda: 0.375, label: 'Three-eighth wave',     eff_rel: 0.93, height_m: 144.23, height_ft: 473.19 },
          { elec_deg: 180, frac_lambda: 0.50,  label: 'Half-wave (λ/2)',       eff_rel: 0.97, height_m: 192.31, height_ft: 630.93 },
          { elec_deg: 225, frac_lambda: 0.625, label: '5/8-wave (optimum)',    eff_rel: 1.00, height_m: 240.38, height_ft: 788.67 },
          { elec_deg: 270, frac_lambda: 0.75,  label: 'Three-quarter wave',    eff_rel: 0.95, height_m: 288.46, height_ft: 946.41 }
        ],
        n_height_tiers: 6,
        optimum_tier: { elec_deg: 225, frac_lambda: 0.625, label: '5/8-wave (optimum)', eff_rel: 1.00, height_m: 240.38, height_ft: 788.67 },
        recommended_tier: { elec_deg: 135, frac_lambda: 0.375, label: 'Three-eighth wave', eff_rel: 0.93, height_m: 144.23, height_ft: 473.19 },
        zoning_max_height_m: 61, base_loading_needed: true, base_coil_uh_est: 66.58,
        top_loading_note: 'Top loading (capacitance hat) may reduce base current and radiated field; not recommended for NDA.',
        haat_note: 'HAAT (height above average terrain) differs from physical height and is computed per §73.313 for coverage predictions.',
        proof_of_performance: '§73.154: 72-radial field intensity traversal; Form 302-AM; base current ±5%; phase ±3°',
        reference: '47 CFR §73.150; §73.154; FCC AM antenna efficiency curves; Ballantine (1924); Belrose (1966) IRE',
        note: 'Class D at 780 kHz: standard height 3/8λ = 144.23 m (473 ft), base loading required. Class A/B would use 5/8λ = 240.38 m for maximum radiation efficiency.'
      },
      population_demographics_overlay: {
        candidate_lat: 34.8606, candidate_lon: -111.8206,
        frequency_khz: 780, tpo_kw: 5, sigma_msm: 9,
        n_contours: 3,
        contours: [
          { id: 'col_min',  mvm: 5.0, label: 'COL (5 mV/m)',      rule: '§73.24(i)', radius_km: 18.4, area_km2: 1063, population_estimate: 15945,  pop_density_assumed_per_km2: 15, pop_data_source: 'Disc-area × conductivity-based density proxy' },
          { id: 'standard', mvm: 2.0, label: 'Standard (2 mV/m)', rule: 'FCC standard service', radius_km: 42.3, area_km2: 5621, population_estimate: 84315,  pop_density_assumed_per_km2: 15, pop_data_source: 'Disc-area × conductivity-based density proxy' },
          { id: 'primary',  mvm: 0.5, label: 'Primary (0.5 mV/m)',rule: '§73.182 protection', radius_km: 115.2, area_km2: 41710, population_estimate: 625650, pop_density_assumed_per_km2: 15, pop_data_source: 'Disc-area × conductivity-based density proxy' }
        ],
        col_service_radius_km: 18.4, col_service_area_km2: 1063, col_population_estimate: 15945,
        primary_contour_radius_km: 115.2, primary_population_estimate: 625650,
        audience_demographics: {
          peak_age_band: '45–64', median_listener_age: 54,
          male_pct: 58, female_pct: 42,
          primary_daypart: 'Morning drive (6–9 AM)',
          secondary_daypart: 'Afternoon drive (3–7 PM)',
          top_formats: ['News/Talk', 'Sports', 'Spanish-language', 'Religious'],
          weekly_cume_pct_of_adults_12plus: 14.5,
          source: 'NAB State of Audio 2023; Nielsen Audio Monthly; Edison Research Share of Ear 2023'
        },
        pop_data_source: 'US Census ACS 5-year estimates (not yet integrated); disc-area approximation with conductivity-based density proxy',
        reference: '47 CFR §73.24(i); §73.182; FCC Form 301-AM Schedule D; US Census Bureau ACS 5-year; NAB State of Audio 2023',
        note: 'Population overlay at 780 kHz, 5 kW, σ=9 mS/m. COL radius: 18.4 km. Primary radius: 115.2 km. Replace density proxy with Census API for filing-grade estimates.'
      },
      power_line_interference_analysis: {
        fcc_class: 'D', frequency_khz: 780, tpo_kw: 5,
        in_am_broadcast_band: true, bpl_exclusion_zone_km: 1, bpl_exclusion_applicable: true,
        recommended_min_distance_m: 300,
        risk_tiers: [
          { min_m: 0,    max_m: 30,    label: 'CRITICAL', risk: 'HIGH',    note: '< 30m: unacceptable noise floor for AM antenna. Relocate or bury line.' },
          { min_m: 30,   max_m: 100,   label: 'HIGH',     risk: 'HIGH',    note: '30–100m: elevated corona noise risk. Request utility noise audit.' },
          { min_m: 100,  max_m: 300,   label: 'MODERATE', risk: 'MODERATE',note: '100–300m: BPL or old equipment can cause S/N degradation.' },
          { min_m: 300,  max_m: 1000,  label: 'LOW',      risk: 'LOW',     note: '300m–1 km: low risk for modern infrastructure; verify BPL not active.' },
          { min_m: 1000, max_m: null,  label: 'MINIMAL',  risk: 'MINIMAL', note: '> 1 km: minimal risk. Background noise dominated by atmospheric sources.' }
        ],
        n_risk_tiers: 5,
        noise_measurement_protocol: {
          standard: 'IEEE Std 1560 / ITU-R CISPR 22',
          method: 'Spectrum analyzer sweep at candidate site, 1 MHz bandwidth centered on station frequency',
          reference_level_dbuv_m: 34,
          measurement_points: ['Tower base', '30m from nearest power line', '100m from power line', 'Quiet reference site'],
          acceptance_criterion: 'S/N ≥ 50 dB for acceptable AM service; noise floor ≤ −40 dBm/Hz at operating frequency'
        },
        fcc_complaint_process: [
          { step: 1, action: 'Document interference with spectrum analyzer screenshots and field strength measurements', rule: '§73.184(a)' },
          { step: 2, action: 'Notify power company / BPL operator in writing; allow 30 days to resolve', rule: '§73.184(b)', note: 'FCC requires good-faith effort before complaint.' },
          { step: 3, action: 'File FCC Form 2000D (Part 15 interference complaint) if unresolved', rule: '§15.5(c)', note: 'Include measurement data, correspondence, and site coordinates.' },
          { step: 4, action: 'FCC investigates; may issue Notice of Apparent Liability to Part 15 operator', rule: '§15.5(c)' }
        ],
        n_complaint_steps: 4,
        mitigation_options: [
          { id: 'site_distance', strategy: 'Select site > 300m from transmission lines', applicable: true, cost_est: 'Site-dependent', effectiveness: 'HIGH' },
          { id: 'bpl_exclusion', strategy: 'Invoke §15.615 BPL exclusion (1 km)',         applicable: true, cost_est: 'FCC enforcement (no cost)', effectiveness: 'HIGH' },
          { id: 'site_survey',   strategy: 'Pre-purchase noise floor survey (IEEE 1560)',  applicable: true, cost_est: '$1,500–$5,000', effectiveness: 'DIAGNOSTIC' }
        ],
        n_applicable_mitigations: 3,
        reference: '47 CFR §73.184; §15.5; §15.615; IEEE Std 1560; ITU-R CISPR 22; FCC BPL Order (ET Docket 03-104)',
        note: 'AM 780 kHz in AM broadcast band (535–1705 kHz). BPL exclusion zone: 1 km per §15.615(c). Minimum recommended distance from power lines: 300m.'
      },
      station_relocation_cost_estimator: {
        fcc_class: 'D', frequency_khz: 780, tpo_kw: 5, is_directional: false, is_clear_channel: true,
        tower_height_est_m: 144.23,
        line_items: [
          { id: 'land',        category: 'Land / site acquisition',              low: 50000,  high: 250000, note: 'Highly variable; rural option ~$25K; suburban can exceed $500K.' },
          { id: 'tower',       category: 'Tower (new self-supporting)',           low: 253684, high: 507369, note: '144m tower at 3/8λ (473 ft). Guy-wired 30% less.' },
          { id: 'radials',     category: 'Ground radial system (120 × 0.4λ)',    low: 34155,  high: 62388,  note: '18,462 m #8 AWG copper + installation labor.' },
          { id: 'building',    category: 'Transmitter building',                  low: 60000,  high: 200000, note: 'Modular pre-fab low; custom masonry high.' },
          { id: 'transmitter', category: 'Transmitter equipment',                 low: 20000,  high: 55000,  note: '5 kW NDA AM transmitter; new unit.' },
          { id: 'phasor_atu',  category: 'Antenna tuning unit (ATU)',             low: 5000,   high: 12000,  note: 'Non-directional ATU.' },
          { id: 'eas',         category: 'EAS encoder/decoder (IPAWS)',           low: 8000,   high: 8000,   note: 'IPAWS-compatible EAS unit per §11.35/§11.56.' },
          { id: 'fcc_fees',    category: 'FCC filing fees',                       low: 6465,   high: 6465,   note: 'FCC Schedule of Application Fees — major change CP application fee.' },
          { id: 'engineering', category: 'Engineering + proof-of-performance',    low: 25000,  high: 75000,  note: 'Spacing, NIF, §73.154 proof, FCC forms.' },
          { id: 'env_legal',   category: 'Environmental + legal + zoning',        low: 15000,  high: 60000,  note: 'NEPA §106, zoning CUP, FCC counsel.' },
          { id: 'contingency', category: 'Contingency (15–20%)',                  low: 71913,  high: 247234, note: 'Reserve for scope changes, cost escalation, permit delays.' }
        ],
        n_line_items: 11,
        subtotal_low: 477304, subtotal_high: 1236222,
        total_low: 549217, total_high: 1483456, total_midpoint: 1016337,
        reference: 'Budget model based on FCC Schedule of Application Fees, engineering industry cost data, and RSMeans construction cost indices (2024).',
        note: 'Total estimated relocation cost: $549,217 – $1,483,456 (midpoint ~$1,016,337). Estimates are screening-grade; actual costs vary significantly with site conditions.'
      },
      rf_exposure_mpe_analysis: {
        fcc_class: 'D', frequency_khz: 780, tpo_kw: 5,
        evaluation_required: true, evaluation_threshold_kw: 5,
        compliance_status: 'EVALUATION_REQUIRED',
        mpe_general_population_mw_cm2: 100, mpe_general_population_e_vm: 614, mpe_general_population_h_am: 163,
        mpe_occupational_mw_cm2: 500,
        eirp_w: 8200, exclusion_radius_m: 8.1, exclusion_radius_ft: 26.6, occupational_exclusion_m: 3.6,
        filing_exhibits: [
          { id: 'mpe_calc',  exhibit: 'MPE calculation worksheet',             rule: '§1.1310',     note: 'Show EIRP, distance, and power density at fence line vs MPE limit.' },
          { id: 'excl_zone', exhibit: 'Exclusion zone diagram (in site plan)', rule: 'OET Bul 65 §3.3', note: 'Identify controlled/uncontrolled exposure zones on scaled site plan.' },
          { id: 'fencing',   exhibit: 'Fencing plan (§73.49)',                 rule: '§73.49',      note: 'Fence must enclose exclusion zone; prevent unauthorized access.' }
        ],
        n_filing_exhibits: 3,
        monitoring_requirement: 'RF monitor at fence perimeter recommended; portable RF survey at commissioning',
        reference: '47 CFR §1.1310; §1.1307(b); §73.49; FCC OET Bulletin 65 (Ed. 97-01); IEEE C95.1-2019',
        note: 'RF exposure: EVALUATION_REQUIRED. ERP 5 kW ≥ 5 kW threshold. Exclusion zone: ≥ 8.1 m radius.'
      },
      tower_lighting_marking_guide: {
        fcc_class: 'D', frequency_khz: 780,
        tower_height_estimate_m: 144.23, tower_height_estimate_ft: 473.15,
        tower_height_basis: '3/8λ typical AM tower height estimate',
        asr_required: true, asr_threshold_m: 61,
        faa_lighting_tier: 'Medium obstruction',
        faa_lighting_required: 'L-864 red medium-intensity flashing + L-810 red steady-burning',
        faa_marking_required: 'Aviation orange/white paint bands',
        faa_rule: 'FAA AC 70/7460-1M §3.5',
        led_retrofit: {
          applicable: true, led_power_l810_w: 11, led_power_l864_w: 56,
          energy_savings_pct: 89, fcc_notice_required: true,
          fcc_notice_rule: '§73.1213(e): 30-day advance notice to FCC for lighting system changes',
          faa_authorization: 'FAA determination of no hazard required for lighting system changes',
          note: 'FAA SN (Solid-State Lighting) approved; FCC allows LED equivalents per §73.1213.'
        },
        maintenance_obligations: [
          { id: 'daily_check',    task: 'Daily lighting status check (or automated monitor)', rule: '§73.1213(b)', note: 'Lights must be inspected daily.' },
          { id: 'faa_notify',     task: 'Notify FAA immediately if lights fail',              rule: '§17.47(a)',   note: 'FAA Flight Service Station within 30 minutes.' },
          { id: 'fcc_notify',     task: 'Notify FCC within 30 min if lights fail',            rule: '§17.47(b)',   note: 'FCC notification via ASR system or phone.' },
          { id: 'repair_72hr',    task: 'Restore lighting within 72 hours of failure',        rule: '§17.56',     note: 'Contact FAA and FCC if repair exceeds 72 hours.' },
          { id: 'annual_inspect', task: 'Annual tower inspection by qualified technician',     rule: '§73.1213(d)', note: 'Retain inspection records 3 years.' }
        ],
        n_maintenance_items: 5,
        reference: '47 CFR §17.7; §17.21; §17.23; §17.47; §17.56; §73.1213; FAA AC 70/7460-1M',
        note: 'Estimated tower height: 144.23 m (473 ft) at 3/8λ. ASR REQUIRED (> 61m). FAA tier: Medium obstruction.'
      },
      eas_acp_compliance_guide: {
        fcc_class: 'D', frequency_khz: 780, tpo_kw: 5,
        station_type: 'FULL_PARTICIPANT', eas_participation: 'MANDATORY',
        monitoring_sources_required: 2,
        monitoring_note: 'LP1 and LP2 sources designated by State EAS Plan. Must monitor 2 sources simultaneously. Sources typically include NWS Weather Radio, State EAS primary, and local LP stations.',
        equipment_requirements: [
          { id: 'encoder',     device: 'EAS encoder',              rule: '§11.35',     required: true,  note: 'Must encode and transmit EAS messages from LP1/LP2 sources.' },
          { id: 'decoder',     device: 'EAS decoder',              rule: '§11.35',     required: true,  note: 'Must decode EAS messages from monitored LP1/LP2 sources.' },
          { id: 'audio_out',   device: 'Audio output relay',       rule: '§11.35',     required: true,  note: 'Must interrupt normal programming automatically on EAN/EAS activation.' },
          { id: 'logging',     device: 'EAS message log',          rule: '§11.35(c)',  required: true,  note: 'Log of received/sent EAS messages; retain 60 days.' },
          { id: 'fips_decode', device: 'FIPS code decoder',        rule: '§11.31',     required: true,  note: 'Must decode FIPS location codes for state/county-specific alerts.' },
          { id: 'ipaws',       device: 'IPAWS compatibility',      rule: '§11.56',     required: true,  note: 'CAP-to-EAS gateway required; encoder must be IPAWS-compatible for national alerts.' }
        ],
        n_required_equipment: 6,
        test_schedule: [
          { id: 'rwt', test: 'Required Weekly Test (RWT)',          freq: 'Weekly',  rule: '§11.61(a)(1)', origin_by_us: false, pass_through: true,  note: 'LP1/LP2 originates; relay within 60 min.' },
          { id: 'rmt', test: 'Required Monthly Test (RMT)',          freq: 'Monthly', rule: '§11.61(a)(2)', origin_by_us: false, pass_through: true,  note: 'State EAS originates; relay required.' },
          { id: 'nat', test: 'National Periodic Test (NPT)',         freq: 'Annual',  rule: '§11.61(a)(3)', origin_by_us: false, pass_through: true,  note: 'FEMA/IPAWS originates; relay within 60 min.' },
          { id: 'acp', test: 'Annual Communications Plan review',   freq: 'Annual',  rule: '§11.15(e)',    origin_by_us: true,  pass_through: false, note: 'Participate in State EAS plan update meetings.' }
        ],
        n_tests: 4,
        prohibited_codes: [
          { code: 'EAN', description: 'Emergency Action Notification', note: 'May only be originated by President/FEMA.' },
          { code: 'EAT', description: 'Emergency Action Termination',  note: 'Only FEMA/President may terminate EAN.' },
          { code: 'NPT', description: 'National Periodic Test',        note: 'Only FEMA may originate NPT.' }
        ],
        recordkeeping: [
          { id: 'msg_log',   record: 'EAS message log (received and sent)', retention_days: 60,  rule: '§11.35(c)' },
          { id: 'test_log',  record: 'RWT/RMT test log',                   retention_days: 365, rule: '§11.61(b)' },
          { id: 'equip_log', record: 'Equipment maintenance log',           retention_days: 365, rule: '§11.35(d)' }
        ],
        n_recordkeeping_items: 3,
        ipaws_required: true,
        reference: '47 CFR Part 11 (§11.15; §11.31; §11.35; §11.45; §11.52; §11.56; §11.61); FEMA IPAWS; NRSC EAS Standards',
        note: 'All AM broadcast stations must participate in EAS. IPAWS-compatible encoder/decoder required. Monitor 2 LP sources; relay RWT weekly, RMT monthly. Log all messages for 60 days.'
      },
      skywave_coverage_analysis: {
        fcc_class: 'D', frequency_khz: 780, tpo_kw: 5,
        is_clear_channel: true, is_directional: false,
        nighttime_power_max_kw: 0.25, actual_night_power_kw: 0.25,
        skywave_contour: { field_mvm: 0.025, label: '25 µV/m skywave (§73.182 Class D secondary)' },
        skywave_dist_50pct_km: 70.7, skywave_dist_10pct_km: 91.9, skywave_dist_1pct_km: 120.2,
        nif_required: true, nif_study_type: 'FULL_CLEAR_CHANNEL_NIF',
        nighttime_da_note: 'Non-directional; nighttime protection based on omnidirectional ERP and §73.182 spacing.',
        protection_levels: [
          { id: 'class_a_protected', field_mvm: 0.5,   basis: '§73.182: Class A 0.5 mV/m daytime GW',          applies_to_us: false },
          { id: 'class_b_protected', field_mvm: 0.25,  basis: '§73.182: Class B 0.25 mV/m daytime GW',         applies_to_us: false },
          { id: 'skywave_50pct',     field_mvm: 0.05,  basis: '§73.182: skywave 50 µV/m, 50% time, 50% locs',  applies_to_us: true },
          { id: 'skywave_10pct',     field_mvm: 0.05,  basis: '§73.182: skywave 50 µV/m, 10% time',            applies_to_us: true },
          { id: 'skywave_1pct',      field_mvm: 0.025, basis: '§73.182: NIF skywave (1% time)',                 applies_to_us: true }
        ],
        n_protection_levels: 5,
        reference: '47 CFR §73.182; §73.21; §73.25; §73.27; FCC skywave propagation curves (M3/M3a); ITU-R P.1147',
        note: 'Nighttime skywave at 0.25 kW: 50% time ≈ 70.7 km; 10% ≈ 91.9 km; NIF 1% ≈ 120.2 km. NIF study: FULL_CLEAR_CHANNEL_NIF.'
      },
      radial_system_engineering_guide: {
        fcc_class: 'D', frequency_khz: 780, tpo_kw: 5, sigma_msm_current: 9,
        wavelength_m: 384.62, quarter_wave_m: 96.15,
        optimum_radial_length_m: 153.85, optimum_radial_length_ft: 504.76,
        recommended_n_radials: 120, radial_spacing_deg: 3,
        recommended_radial_tier: { n: 120, label: 'FCC recommended', efficiency_pct: 95, ground_loss_ohm: 0.15, note: '120 radials at 0.4λ: FCC §73.190 / Terman optimum.' },
        ground_loss_ohm_recommended: 0.15,
        radial_tiers: [
          { n: 16,  label: 'Minimum practical', efficiency_pct: 50, ground_loss_ohm: 1.15, note: 'Severely limited.' },
          { n: 30,  label: 'Reduced',           efficiency_pct: 70, ground_loss_ohm: 0.61, note: 'Common for low-power translators.' },
          { n: 60,  label: 'Moderate',          efficiency_pct: 85, ground_loss_ohm: 0.31, note: 'FCC minimum guidance for Class C/D stations.' },
          { n: 120, label: 'FCC recommended',   efficiency_pct: 95, ground_loss_ohm: 0.15, note: '120 radials at 0.4λ: Terman optimum.' },
          { n: 240, label: 'High-performance',  efficiency_pct: 98, ground_loss_ohm: 0.08, note: 'Used by clear-channel Class A stations.' }
        ],
        recommended_awg: 8,
        awg_options: [
          { awg: 8,  dia_mm: 3.26, resist_mohm_per_m: 2.06, cost_usd_per_m: 1.85, note: 'Industry standard for ≥5 kW AM sites.' },
          { awg: 10, dia_mm: 2.59, resist_mohm_per_m: 3.28, cost_usd_per_m: 1.12, note: 'Standard for AM ground radials.' },
          { awg: 12, dia_mm: 2.05, resist_mohm_per_m: 5.21, cost_usd_per_m: 0.78, note: 'Acceptable for < 1 kW installations.' }
        ],
        total_radial_length_m: 18462, total_radial_length_ft: 60571,
        copper_mass_kg: 923, material_cost_usd_estimate: 34155,
        burial_depth_inches: 2,
        compliance_checklist: [
          { id: 'wenner_before', task: 'Wenner 4-electrode σ measurement before installation', rule: '§73.190', days: 2 },
          { id: 'radial_layout', task: 'Survey and layout of radial azimuths (3° spacing)',    rule: null,     days: 1 },
          { id: 'radial_trench', task: 'Trenching or direct burial of copper wire',            rule: null,     days: 18 },
          { id: 'bonding',       task: 'Bond all radials to common ground bus at tower base',  rule: 'IEEE 1100', days: 1 },
          { id: 'wenner_after',  task: 'Post-installation σ measurement for FCC filing',       rule: '§73.190', days: 2 }
        ],
        n_compliance_items: 5,
        reference: '47 CFR §73.190; Terman (1943); Belrose (1966) IRE; IEEE 1100; NEC Article 250',
        note: 'Recommended: 120 radials at 153.85 m (0.4λ) length, #8 AWG copper. Total copper: 18,462 m. Estimated material cost: $34,155.'
      },
      construction_permit_timeline_optimizer: {
        fcc_class: 'D', frequency_khz: 780, pattern_mode: 'NDA',
        is_major_change: true, is_directional: false, is_clear_channel: true,
        total_optimistic_weeks: 94, total_conservative_weeks: 228,
        total_optimistic_months: 21.71, total_conservative_months: 52.65,
        total_milestones: 22, n_phases: 6,
        critical_path_milestone_ids: ['spacing_study','nif_study','da_pattern','asr_filing','fcc_review','cp_grant'],
        n_critical_path: 6,
        filing_fee_major_change_usd: 6465,
        phases: [
          { id: 'pre_engineering',  label: 'Pre-Engineering & Site Control',  weeks_optimistic: 4,  weeks_conservative: 12,  milestones: [
            { id: 'site_option',    task: 'Execute site option or purchase agreement', days: 30, rule: null },
            { id: 'title_survey',   task: 'Title search + ALTA/NSPS land survey', days: 21, rule: null },
            { id: 'soil_survey',    task: 'Soil conductivity survey (Wenner 4-point)', days: 14, rule: '§73.190' },
            { id: 'topo_survey',    task: 'Topographic survey for tower foundation & radial field', days: 14, rule: null }
          ]},
          { id: 'fcc_engineering',  label: 'FCC Engineering Study',           weeks_optimistic: 6,  weeks_conservative: 16,  milestones: [
            { id: 'spacing_study',  task: '§73.37 spacing analysis (all channels)', days: 10, rule: '§73.37' },
            { id: 'nif_study',      task: '§73.182 NIF study (clear channel)',       days: 30, rule: '§73.182' },
            { id: 'da_pattern',     task: 'Non-directional antenna design',           days: 7,  rule: '§73.183' },
            { id: 'coverage_map',   task: '§73.183 coverage map',                     days: 7,  rule: '§73.183' },
            { id: 'env_assessment', task: 'Environmental assessment (§1.1301)',        days: 14, rule: '§1.1301' },
            { id: 'asr_filing',     task: 'ASR registration (FCC Form 854)',           days: 7,  rule: '§17.7' }
          ]},
          { id: 'form_301_prep',    label: 'Form 301-AM Preparation & Filing', weeks_optimistic: 2,  weeks_conservative: 6,   milestones: [
            { id: 'schedule_a',     task: 'Schedule A: Legal/ownership', days: 7, rule: '§73.3533' },
            { id: 'schedule_b',     task: 'Schedule B: Technical (antenna, pattern, ERP)', days: 7, rule: '§73.3533' },
            { id: 'schedule_c',     task: 'Schedule C: Transmitter', days: 3, rule: '§73.3533' },
            { id: 'schedule_d',     task: 'Schedule D: Coverage map + §73.183 contour', days: 5, rule: '§73.183' },
            { id: 'schedule_e',     task: 'Schedule E: Environmental compliance', days: 5, rule: '§1.1301' },
            { id: 'fcc_filing',     task: 'LMS filing + fee payment', days: 1, rule: 'FCC Schedule of Application Fees' }
          ]},
          { id: 'fcc_processing',   label: 'FCC Processing (CP Issuance)',     weeks_optimistic: 52, weeks_conservative: 130, milestones: [
            { id: 'fcc_review',     task: 'FCC staff review (Audio Division)', days: 180, rule: '§73.3571' },
            { id: 'public_notice',  task: 'Public notice / petitions to deny period', days: 30, rule: '§73.3584' },
            { id: 'cp_grant',       task: 'CP grant', days: 30, rule: '§73.3598' }
          ]},
          { id: 'construction',     label: 'Construction Phase',               weeks_optimistic: 26, weeks_conservative: 52,  milestones: [
            { id: 'zoning',         task: 'Local zoning / conditional use permit', days: 90, rule: null },
            { id: 'tower_permit',   task: 'Building / tower erection permit',      days: 30, rule: null },
            { id: 'radial_install', task: 'Ground radial system installation',     days: 21, rule: '§73.190' },
            { id: 'tower_erect',    task: 'Tower erection + FAA painting/lighting', days: 30, rule: '§17.21' },
            { id: 'tx_install',     task: 'Transmitter installation + RF plumbing', days: 14, rule: null },
            { id: 'proof_of_perf',  task: 'Proof of performance (§73.154)',        days: 14, rule: '§73.154' }
          ]},
          { id: 'license_grant',    label: 'License Grant Phase',              weeks_optimistic: 4,  weeks_conservative: 12,  milestones: [
            { id: 'form_302',       task: 'Form 302-AM: License application', days: 7,  rule: '§73.3536' },
            { id: 'fcc_license',    task: 'FCC license grant',                 days: 45, rule: '§73.3536' }
          ]}
        ],
        reference: '47 CFR §73.3533; §73.3598; §73.3571; §73.3584; §73.3536; §73.1620; §17.7; §73.154',
        note: 'CP timeline for Class D non-directional AM relocation. Optimistic: 94 weeks (~21.71 months). Conservative: 228 weeks (~52.65 months).'
      },
      co_channel_interference_budget: {
        fcc_class: 'D', frequency_khz: 780, tpo_kw: 5, is_clear_channel: true, is_directional: false,
        du_daytime_min_db: 20, du_nighttime_min_db: 0,
        required_cc_spacing_km: 402, nif_study_required: true, nif_study_type: 'FULL_CLEAR_CHANNEL_NIF',
        du_budget_by_distance: [
          { distance_km: 50,  protection_status: 'PROTECTED',   du_threshold_db: 20 },
          { distance_km: 100, protection_status: 'PROTECTED',   du_threshold_db: 20 },
          { distance_km: 200, protection_status: 'MARGINAL',    du_threshold_db: 20 },
          { distance_km: 400, protection_status: 'UNPROTECTED', du_threshold_db: 20 }
        ],
        threat_tiers: [
          { tier: 1, label: 'Co-channel (0 kHz offset)',   offset_khz: 0,  du_threshold_db: 20,  spacing_req_km: 402, rule: '§73.37 Table 1 / §73.182' },
          { tier: 2, label: 'First Adjacent (±10 kHz)',    offset_khz: 10, du_threshold_db: 6,   spacing_req_km: null, rule: '§73.37 Table 1 (FA column)' },
          { tier: 3, label: 'Second Adjacent (±20 kHz)',   offset_khz: 20, du_threshold_db: 0,   spacing_req_km: null, rule: '§73.37 Table 1 (SA column)' },
          { tier: 4, label: 'IBOC Sideband (±10–15 kHz)', offset_khz: 12, du_threshold_db: -10, spacing_req_km: null, rule: '§73.404(c) / NRSC-5-D' }
        ],
        n_threat_tiers: 4,
        propagation_factors: [
          { factor: 'Daytime groundwave',   mode: 'RELIABLE', applicability: 'Primary service area',       du_assumption: 'Field at 0.5 mV/m protection contour relative to co-channel undesired' },
          { factor: 'Nighttime skywave',    mode: 'VARIABLE', applicability: 'NIF study (FULL_CLEAR_CHANNEL_NIF)', du_assumption: '1% of nights, 50% of locations (§73.182 envelope)' },
          { factor: 'Ionospheric scatter',  mode: 'RARE',     applicability: 'Trans-horizon anomalies',   du_assumption: 'Typically neglected in FCC AM engineering' },
          { factor: 'Conductivity gradient',mode: 'STATIC',   applicability: 'Mixed terrain path loss',   du_assumption: 'σ = 9 mS/m at candidate; may differ along propagation paths' }
        ],
        mitigation_strategies: [
          { id: 'da_nulling',     strategy: 'Directional Antenna (DA) null toward interferer', applicable: true, impact_db: '20–35 dB null depth achievable', rule: '§73.150', note: 'Most effective single mitigation; requires §73.150 directional antenna authorization.' },
          { id: 'power_reduction',strategy: 'Nighttime power reduction',                       applicable: true, impact_db: '3–10 dB reduction in undesired signal at victim', rule: '§73.21/§73.25', note: 'Reduces interference but also reduces desired coverage.' },
          { id: 'site_selection', strategy: 'Site relocation away from interfered-with contour',applicable: true, impact_db: 'Variable — depends on distance improvement', rule: '§73.37', note: 'Optimizer primary function: find sites with improved D/U margins.' },
          { id: 'iboc_reduction', strategy: 'IBOC nighttime digital power reduction',          applicable: true, impact_db: '6–10 dB reduction in IBOC hash', rule: '§73.404(c)', note: 'Reduces IBOC sideband interference without affecting analog coverage.' }
        ],
        n_applicable_mitigations: 4,
        reference: '47 CFR §73.182; §73.37; §73.404(c); FCC OET Bulletin 69',
        note: 'D/U budget framework for co-channel interference assessment at 780 kHz. Required co-channel spacing: 402 km for Class D. NIF study: FULL_CLEAR_CHANNEL_NIF.'
      },
      iboc_hd_radio_analysis: {
        applicable: true, fcc_class: 'D', frequency_khz: 780, tpo_kw: 5,
        is_clear_channel: true, hybrid_mode_available: true, all_digital_available: false,
        iboc_digital_erp_dbw: -14, digital_sideband_erp_kw: 0.0199,
        digital_bandwidth_khz: { lower: 765, upper: 795, span_khz: 30 },
        first_adj_threatened_khz: { lower: 770, upper: 790 },
        analog_reach_km: 115.2, iboc_digital_reach_km: 97.92, iboc_digital_reach_fraction: 0.85,
        nighttime_interference_risk: 'HIGH',
        nighttime_note: 'Clear-channel 50 kW stations transmit IBOC at night causing digital hash to secondary stations. §73.404(c) requires nighttime digital power reduction to comply with interference rules.',
        filing_requirement: {
          form: 'None — notification only', rule: '47 CFR §73.404(d)',
          deadline: 'Within 10 business days of commencement', fee: 0,
          note: 'IBOC operation does not require a construction permit or license modification. File notification letter with FCC Audio Division.'
        },
        nrsc5_requirements: [
          { id: 'hybrid_mode',   req: 'Hybrid (analog + digital) mode',      standard: 'NRSC-5-D §4.2',        status: 'REQUIRED_FOR_AM_IBOC', note: 'All-digital AM not yet FCC-approved.' },
          { id: 'digital_power', req: 'Digital sideband level ≤ −14 dBc',    standard: '47 CFR §73.404(c)',     status: 'MANDATORY',            note: 'At 5 kW analog, digital sidebands ≤ 0.0199 kW.' },
          { id: 'exporter',      req: 'HD Exporter device',                   standard: 'NRSC-5-D Appendix D',  status: 'REQUIRED',             note: 'Converts audio + metadata to OFDM digital baseband for exciter injection.' },
          { id: 'importer',      req: 'HD Importer (SFN/delay alignment)',    standard: 'NRSC-5-D Appendix E',  status: 'REQUIRED_IF_SFN',      note: 'Required only for single-frequency networks using IBOC fill-in translators.' },
          { id: 'psd',           req: 'Program Service Data (PSD)',           standard: 'NRSC-5-D §7',          status: 'RECOMMENDED',          note: 'Artist/title metadata on IBOC logical channel 1.' },
          { id: 'station_id',    req: 'Station ID logo (SIS)',                standard: 'NRSC-5-D §6',          status: 'RECOMMENDED',          note: 'Station logo and slogan on Station Information Service channel.' }
        ],
        n_mandatory_requirements: 3,
        equipment_options: [
          { vendor: 'Nautel',           products: ['GV Series', 'VS Series'],  iboc_integrated: true,  note: 'Integrated HD Radio exciter; no external exporter required for basic operation.' },
          { vendor: 'GatesAir',         products: ['Flexiva', 'Maxiva'],        iboc_integrated: true,  note: 'Compatible with iBiquity/Xperi HD Radio chipset.' },
          { vendor: 'Xperi (iBiquity)', products: ['HD Radio Exporter'],        iboc_integrated: false, note: 'Required for non-integrated transmitters.' }
        ],
        equipment_cost_estimate_usd: { low: 15000, high: 30000 },
        reference: '47 CFR §73.404; NRSC-5-D (2017); iBiquity Digital / Xperi HD Radio System Specification',
        note: 'AM IBOC (HD Radio) adds digital sidebands at ±10–15 kHz from the analog carrier. No FCC authorization required — notify within 10 days per §73.404(d). Digital coverage ≈ 85% of analog reach.'
      },
      coverage_service_area_map_spec: {
        candidate_lat: 34.8606, candidate_lon: -111.8206,
        frequency_khz: 780, tpo_kw: 5, sigma_msm: 9,
        n_contours: 4,
        contours: [
          { id: 'col_min',  mvm: 5.0,    label: 'COL Minimum Service (§73.24j)',          color: '#22c55e', fill_opacity: 0.12, stroke_width: 2,   priority: 1, center_lat: 34.8606, center_lon: -111.8206, radius_km: 18.4,  radius_m: 18400,  geojson_type: 'circle', n_sides: 64 },
          { id: 'standard', mvm: 2.0,    label: 'Standard Service (2 mV/m)',              color: '#3b82f6', fill_opacity: 0.08, stroke_width: 1.5, priority: 2, center_lat: 34.8606, center_lon: -111.8206, radius_km: 42.3,  radius_m: 42300,  geojson_type: 'circle', n_sides: 64 },
          { id: 'primary',  mvm: 0.5,    label: 'Primary Service / Protection (§73.182)', color: '#6366f1', fill_opacity: 0.05, stroke_width: 1,   priority: 3, center_lat: 34.8606, center_lon: -111.8206, radius_km: 115.2, radius_m: 115200, geojson_type: 'circle', n_sides: 64 },
          { id: 'blanket',  mvm: 1000.0, label: 'Blanket (§73.24g / 1000 mV/m)',          color: '#ef4444', fill_opacity: 0.20, stroke_width: 2,   priority: 0, center_lat: 34.8606, center_lon: -111.8206, radius_km: 0.42,  radius_m: 420,    geojson_type: 'circle', n_sides: 64 }
        ],
        col_service_area_km2: 1063,
        primary_area_km2: 41710,
        blanket_area_km2: 1,
        render_spec: {
          layer_type: 'ScatterplotLayer', coordinate_system: 'LNGLAT',
          center: [-111.8206, 34.8606], unit: 'km',
          legend: [
            { id: 'col_min',  label: 'COL 5 mV/m',    color: '#22c55e' },
            { id: 'standard', label: 'Standard 2 mV/m', color: '#3b82f6' },
            { id: 'primary',  label: 'Primary 0.5 mV/m', color: '#6366f1' },
            { id: 'blanket',  label: 'Blanket 1000 mV/m', color: '#ef4444' }
          ]
        },
        reference: '47 CFR §73.24(g); §73.24(i); §73.182; FCC groundwave curves',
        note: 'Radii computed via FCC groundwave curves at σ = 9 mS/m. Render as concentric circles using deck.gl ScatterplotLayer or MapLibre fill-circle layers.'
      },
      candidate_scoring_audit: {
        score_pre_confidence: 89.2,
        confidence_tier: 'MEDIUM',
        confidence_factor: 0.97,
        confidence_penalty_pts: -2.68,
        score_final: 86.6,
        normalization_factor: 1.43,
        weight_sum: 70,
        active_goals_count: 3,
        total_weighted_pts: 86.6,
        goal_details: [
          { goal: 'maximize_col_coverage', label: 'COL coverage (§73.24j)', enabled: true, weight: 35, raw_metric: 0.97, raw_unit: 'fraction 0–1', formula: 'coverage_pct × 100 → clamp 0–100', sub_score: 97.0, weighted_pts: 49.0, data_source: '10-km disc proxy (no polygon supplied)', limiting_factor: null },
          { goal: 'maximize_population', label: 'Population reach', enabled: true, weight: 28, raw_metric: 36.8, raw_unit: 'km (0.5 mV/m radius)', formula: '(reach / reach_scale)² × 100 → clamp 0–100', sub_score: 72.4, weighted_pts: 28.8, data_source: 'FCC groundwave curve (σ, ERP, freq)', limiting_factor: null },
          { goal: 'minimize_blanket_population', label: 'Blanket Pop.', enabled: false, weight: 0, raw_metric: 0.5, raw_unit: '% of metro within 1 mV/m', formula: '100 − 50×blanket_pct → clamp 0–100', sub_score: 75.0, weighted_pts: 0, data_source: 'FCC groundwave curve (1 mV/m contour)', limiting_factor: 'Goal not enabled — weight = 0' },
          { goal: 'prefer_high_conductivity', label: 'Conductivity', enabled: true, weight: 7, raw_metric: 9.0, raw_unit: 'mS/m', formula: 'sqrt(σ / 8) × 100 → clamp 0–100', sub_score: 100.0, weighted_pts: 10.0, data_source: 'FCC conductivity zone map', limiting_factor: null },
          { goal: 'avoid_wildfire_risk', label: 'Wildfire risk avoidance', enabled: false, weight: 0, raw_metric: null, raw_unit: 'N/A', formula: 'NOT EVALUATED (placeholder)', sub_score: null, weighted_pts: 0, data_source: 'USFS/NIFC risk layer (not yet integrated)', limiting_factor: 'Goal not enabled — weight = 0' },
          { goal: 'minimize_int_treaty_zone', label: 'Treaty zone margin', enabled: false, weight: 0, raw_metric: null, raw_unit: 'km to nearest border', formula: '(dist / 320 km) × 100 → clamp 0–100', sub_score: null, weighted_pts: 0, data_source: 'FCC/ISED treaty zone geometry', limiting_factor: 'Goal not enabled — weight = 0' }
        ],
        note: 'candidate_scoring_audit exposes every step of the scoring pipeline — sub-score per goal, weight, normalization factor, weighted contribution, and confidence dampening — for full explainability.'
      }
    },
    {
      rank: 2, rank_percentile: 96.1, lat: 34.83, lon: -111.74,
      distance_from_current_km: 7.8, bearing_deg: 128, cardinal_direction: 'SE', score: 84.0,
      score_delta_vs_baseline: 21.6,
      col_coverage_pct: 0.91, nif_status: 'PROMISING — HIGH skywave risk (§73.182 NIF study required)',
      principal_community_5mvm_km: 4.9, daytime_reach_km: 31.2, blanket_population_pct: 0.7,
      blanket_1000mvm_km: 0.7, minimum_tpo_for_compliance_kw: null, minimum_tpo_for_col_coverage_kw: null,
      ground_sigma_mS_m: 6, ground_sigma_quality: 'GOOD', ground_sigma_filing_grade: 'screening',
      ground_sigma_source: 'FCC M3 zone table', ground_radial_advisory: null,
      score_confidence: 'LOW', field_at_col_centroid_mvm: 8.7,
      estimated_daytime_population_served: 103900,
      score_confidence_band: {
        score_low: 62.0, score_high: 100, uncertainty_pts: 22,
        uncertainty_factors: [
          'zone-table conductivity (±12 pts): measured σ could shift conductivity sub-score — commission soil survey to resolve',
          'COL disc proxy (±10 pts): polygon-based coverage analysis could differ materially from 10 km radius disc'
        ]
      },
      treaty_zone: null, fuel_risk: 'LOW',
      notes: '91% city-coverage; ground σ slightly lower; daytime reach acceptable.',
      explanation: {
        score_breakdown: { col_coverage: 35.6, population: 27.6, blanket: 14.9, conductivity: 9.2, wildfire: 0, treaty_zone: 0, confidence_penalty: -6.4 },
        ranking_rationale: 'Strong overall — second only on COL coverage; fuel-risk score positive.'
      },
      status_labels: ['PROMISING', 'REVIEW REQUIRED'],
      status_category: 'REVIEW_REQUIRED',
      source: 'GRID',
      infrastructure_ref: null,
      colocation_analysis: null,
      limitations: ['NIF status REVIEW — engineering DA pattern may be required'],
      regulatory_risk_score: {
        risk_score: 30, risk_category: 'MODERATE',
        risk_factors: [
          { factor: 'ASR_REQUIRED', points: 15, note: 'λ/4 ≈ 96 m at 780 kHz exceeds 60.96 m §17.7 threshold: FAA 7460-1 + FCC Form 854 required' },
          { factor: 'FAIR_CONDUCTIVITY', points: 5, note: 'σ=6 mS/m (GOOD): soil survey still required for §73.190 certification' },
          { factor: 'NIF_STUDY_REQUIRED', points: 10, note: '§73.182 NIF study required for all non-local-channel stations at a new transmitter site' }
        ],
        interpretation: 'MODERATE risk — routine but non-trivial filing requirements; plan for ASR and NIF study.'
      },
      co_channel_spacing_estimate: {
        candidate_distance_km: 7.8,
        co_channel: { min_separation_km: 953, meets_separation: false, note: 'Class D co-channel minimum 953 km' },
        adjacent_10khz: { min_separation_km: 724, meets_separation: false, note: 'Class D ±10 kHz minimum 724 km' },
        adjacent_20khz: { min_separation_km: 354, meets_separation: false, note: 'Class D ±20 kHz minimum 354 km' },
        screening_verdict: 'BELOW_ALL_SPACING_MINIMUMS',
        rule: '47 CFR §73.37 (daytime, proposed station vs. same class)',
        caveat: 'Spacing screen uses distance from current site as proxy. Actual §73.37 separation must be measured to nearest co-channel and adjacent-channel stations.'
      },
      mpe_rf_exposure_summary: {
        evaluation_required: true,
        rule: '47 CFR §1.1307 / OET Bulletin 65 §3.B',
        frequency_mhz: 0.78,
        near_field_boundary_m: 61.12,
        mpe_limit_mw_cm2: 0.0020,
        far_field_exclusion_m: 44.7,
        recommended_fence_distance_m: 61.12,
        note: 'At 5 kW, near-field boundary (λ/2π) dominates. Fence at ≥62 m from base of antenna.'
      },
      power_efficiency_metrics: {
        tpo_kw: 5,
        people_per_kw: 20780,
        km2_per_kw: 611,
        col_coverage_pct_per_kw: 18.2,
        efficiency_tier: 'HIGH',
        note: 'At 5 kW TPO: ~20,780 people/kW, 611 km²/kW service area (national avg density proxy)'
      },
      nighttime_classification: {
        eligibility: 'RESTRICTED',
        nif_complexity: 'VERY_HIGH',
        protection_class: 'Clear channel — Class A dominant (§73.25)',
        key_constraint: '780 kHz is a §73.25 clear channel. Class D secondary operation at night limited by WJR skywave protection zone.',
        nighttime_power_max_kw: 0.5,
        nif_study_required: true,
        rule: '47 CFR §73.182 / §73.25'
      },
      da_gain_potential: { applicable: false, reason: 'Already ≥100% NDA COL coverage — DA not needed for §73.24(i)' },
      directional_antenna_study_guide: {
        recommended: true,
        primary_reason: 'CLEAR_CHANNEL_SECONDARY_NIGHTTIME',
        study_type: 'DA_N_NIGHTTIME_ONLY',
        triggers: [
          { trigger: 'CLEAR_CHANNEL_SECONDARY_NIGHTTIME', detail: 'Secondary Class D on clear channel 780 kHz — DA-N required at night to protect WJR Class A skywave contours.', cfr: '47 CFR §73.25 / §73.182' }
        ],
        key_constraints: [
          'DA-N pattern must protect Class A dominant\'s 0.5 mV/m and 25 µV/m contours.',
          '§73.150(a): horizontal pattern filed in 5° increments (72 tabulated values, 0°–355°).',
          'Typical AM DA array: 2–4 tower elements; ground system must be extended to all towers.'
        ],
        pattern_radials_required: 72, additional_engineering_weeks_min: 8, additional_engineering_weeks_max: 16,
        note: 'Commission a DA N NIGHTTIME ONLY study before filing.', rule: '47 CFR §73.150'
      },
      skywave_protection_advisory: {
        advisory_level: 'HIGH', nif_required: true,
        nif_study_type: '§73.182 full azimuthal skywave NIF (1° bearings, OET-72 methodology)',
        protected_contour_25uvm_est_km: 120.21, groundwave_05mvm_est_km: 31.2,
        advisory_items: [
          'Secondary Class D on clear channel 780 kHz: must not increase nighttime interference to dominant Class A WJR\'s 0.5 mV/m and 25 µV/m contours.',
          '§73.182 NIF must demonstrate interference not materially increased from current authorized site.'
        ],
        key_risk: 'Secondary on §73.25 clear channel — delta comparison to current authorized site', treaty_factor: null, rule: '47 CFR §73.25 / §73.182'
      },
      transmission_line_analysis: {
        frequency_khz: 780, tpo_kw: 5, assumed_run_m: 60,
        feedline_options: [
          { id: 'EIA_7_8_IN', label: 'EIA 7/8" coax', atten_db_per_100m: 0.32, total_loss_db_at_60m: 0.19, erp_at_antenna_kw: 4.79 },
          { id: 'EIA_1_5_8_IN', label: 'EIA 1-5/8" coax', atten_db_per_100m: 0.18, total_loss_db_at_60m: 0.11, erp_at_antenna_kw: 4.87 },
          { id: 'EIA_3_1_8_IN', label: 'EIA 3-1/8" coax', atten_db_per_100m: 0.10, total_loss_db_at_60m: 0.06, erp_at_antenna_kw: 4.93 },
          { id: 'OPEN_WIRE', label: 'Open wire (600 Ω)', atten_db_per_100m: 0.03, total_loss_db_at_60m: 0.02, erp_at_antenna_kw: 4.98 }
        ],
        recommended_feedline_id: 'EIA_7_8_IN',
        recommendation_rationale: 'At TPO ≤ 25 kW, EIA 7/8" coax provides excellent efficiency with manageable cost and installation complexity.',
        note: 'Attenuation computed from skin-effect formula (A_cond×√f + A_diel×f) at 0.780 MHz, 60 m assumed run.'
      },
      antenna_base_impedance: {
        frequency_khz: 780, sigma_msm: 6, quarter_wave_m: 96.2, N_radials: 120,
        quarter_wave: { R_r_ohm: 36.6, R_g_standard_ohm: 6.5, R_total_ohm: 43.1, efficiency_standard_pct: 84.9, R_g_extended_ohm: 2.9, efficiency_extended_pct: 92.7 },
        five_eighths_wave: { R_r_ohm: 49.8, X_base_j: 45, note: 'Matching network required to cancel +j45 Ω reactance' },
        base_reactance_table: [
          { height_label: 'λ/4 (electrical 90°)', X_base_j: 0, notes: 'Purely resistive — simplest matching' },
          { height_label: '5/8λ (electrical 225°)', X_base_j: 45, notes: 'Inductive — series cap or shunt network required' },
          { height_label: '0.19λ (electrical 68°)', X_base_j: -150, notes: 'Capacitive — series inductor required' }
        ],
        matching_network_complexity: 'LOW — λ/4 tower presents near-unity VSWR; σ=6 mS/m ground gives slightly better efficiency than rank 1.',
        design_note: 'Standard 120-radial ground system at 96 m length achieves ~85% radiation efficiency at σ=6 mS/m.'
      },
      permit_and_engineering_cost_estimate: {
        cost_tier: 'HIGH',
        range_label: '$58,000 – $117,000',
        total_soft_cost_low_usd: 58000, total_soft_cost_high_usd: 117000,
        line_items: [
          { item: 'FCC_FORM_301', label: 'FCC Form 301-AM application fee', cost_low_usd: 1380, cost_high_usd: 1380 },
          { item: 'FCC_FORM_302', label: 'FCC Form 302-AM license fee', cost_low_usd: 690, cost_high_usd: 690 },
          { item: 'FCC_FORM_854_ASR', label: 'FCC Form 854 ASR registration (96 m > 60.96 m)', cost_low_usd: 630, cost_high_usd: 630 },
          { item: 'FAA_AERO_STUDY', label: 'FAA 7460-1 aeronautical study & marking/lighting', cost_low_usd: 4500, cost_high_usd: 9000 },
          { item: 'SOIL_RESISTIVITY_SURVEY', label: 'Soil resistivity survey (§73.190 certification)', cost_low_usd: 3500, cost_high_usd: 7000 },
          { item: 'NIF_STUDY', label: '§73.182 NIF skywave study (OET-72 / LMS)', cost_low_usd: 15000, cost_high_usd: 35000 },
          { item: 'DA_ENGINEERING', label: 'DA-N pattern modeling & §73.150 filing', cost_low_usd: 12000, cost_high_usd: 30000 },
          { item: 'RF_EXPOSURE_STUDY', label: 'RF MPE evaluation (OET Bulletin 65)', cost_low_usd: 2000, cost_high_usd: 4000 },
          { item: 'FCC_COUNSEL', label: 'Communications counsel (FCC filing oversight)', cost_low_usd: 8000, cost_high_usd: 20000 }
        ],
        note: 'Soft-cost estimate only. 2024 USD.'
      },
      signal_propagation_profile: {
        frequency_khz: 780, tpo_kw: 5, sigma_msm: 6,
        contours: [
          { id: 'DAYTIME_5MVM',    label: '5 mV/m (city-grade / §73.24(i) COL floor)',   target_mvm: 5.0,    distance_km: 6.7,  area_km2: 141.0 },
          { id: 'DAYTIME_2MVM',    label: '2 mV/m (primary service contour)',             target_mvm: 2.0,    distance_km: 15.2, area_km2: 726.0 },
          { id: 'DAYTIME_05MVM',   label: '0.5 mV/m (secondary daytime / §73.24 reach)', target_mvm: 0.5,    distance_km: 37.8, area_km2: 4491 },
          { id: 'DAYTIME_01MVM',   label: '0.1 mV/m (daytime interference floor)',        target_mvm: 0.1,    distance_km: 74.1, area_km2: 17281 },
          { id: 'BLANKET_1000MVM', label: '1000 mV/m (§73.24(g) blanket contour)',        target_mvm: 1000.0, distance_km: 0.22, area_km2: 0.15 }
        ],
        skywave_25uvm_est_km: 120.2,
        note: 'Groundwave contours use FCC gwave curves (§73.184) at this σ and TPO. Skywave 25 µV/m estimate uses OET-72 textbook approximation — actual NIF requires FCC skywave propagation software.'
      }
    },
    {
      rank: 3, rank_percentile: 72.6, lat: 34.95, lon: -111.92,
      distance_from_current_km: 12.5, bearing_deg: 315, cardinal_direction: 'NW', score: 71.8,
      score_delta_vs_baseline: 9.4,
      col_coverage_pct: 0.78, nif_status: 'NON-COMPLIANT — HIGH skywave risk (§73.182 NIF study required)',
      principal_community_5mvm_km: 6.1, daytime_reach_km: 28.4, blanket_population_pct: 0.3,
      blanket_1000mvm_km: 0.9, minimum_tpo_for_compliance_kw: null, minimum_tpo_for_col_coverage_kw: 8.5,
      ground_sigma_mS_m: 10, ground_sigma_quality: 'EXCELLENT', ground_sigma_filing_grade: 'screening',
      ground_sigma_source: 'FCC M3 zone table', ground_radial_advisory: null,
      score_confidence: 'LOW', field_at_col_centroid_mvm: 3.2,
      estimated_daytime_population_served: 85600,
      score_confidence_band: {
        score_low: 49.8, score_high: 93.8, uncertainty_pts: 22,
        uncertainty_factors: [
          'zone-table conductivity (±12 pts): measured σ could shift conductivity sub-score — commission soil survey to resolve',
          'COL disc proxy (±10 pts): polygon-based coverage analysis could differ materially from 10 km radius disc'
        ]
      },
      treaty_zone: null, fuel_risk: 'MODERATE',
      notes: 'Lower COL but excellent conductivity and minimal blanket exposure.',
      explanation: {
        score_breakdown: { col_coverage: 27.6, population: 20.7, blanket: 18.4, conductivity: 13.8, wildfire: 0, treaty_zone: 0, confidence_penalty: -5.63 },
        ranking_rationale: 'Conductivity wins offset lower coverage; §73.24(i) COL coverage 78% is below 80% floor — increase TPO to ≥8.5 kW to fix.'
      },
      status_labels: ['NON-COMPLIANT', 'ENGINEER REVIEW REQUIRED'],
      status_category: 'RECOVERABLE_WITH_POWER_INCREASE',
      blanket_pop_risk: 'OK', col_coverage_gap_pct: 0.02, population_delta_vs_baseline: -1500,
      regulatory_compliance_summary: {
        col_coverage: { status: 'FAIL',  value: 0.78, threshold: 0.80, rule: '47 CFR §73.24(i)' },
        blanket_pop:  { status: 'PASS',  value: 0.30, threshold: 1.00, rule: '47 CFR §73.24(g)' },
        class_power:  { status: 'PASS',  value: 5, ceiling: 50, rule: '47 CFR §73.21' },
        treaty_zone:  { status: 'CLEAR', value: null, rule: 'US/MX 1986 Agreement; US/CA 1991 LOU' }
      },
      source: 'GRID',
      infrastructure_ref: null,
      colocation_analysis: null,
      limitations: ['Moderate wildfire exposure — manual review of fuel maps required'],
      coverage_feasibility_assessment: {
        verdict: 'FEASIBLE_WITH_POWER_INCREASE',
        col_coverage_pct: 0.78,
        col_coverage_meets_floor: false,
        tpo_needed_for_col_floor_kw: 8.5,
        tpo_needed_within_class_ceiling: true,
        class_power_ceiling_kw: 50,
        blanket_pop_pct: 0.30,
        blanket_pop_meets_limit: true,
        da_pattern_may_resolve: true,
        summary: 'COL coverage 78% (floor 80%); 8.5 kW achieves floor (class ceiling 50 kW); DA pattern shaping may close coverage gap'
      },
      per_candidate_engineering_checklist: [
        { id: 'SOIL_RESISTIVITY_SURVEY', priority: 'REQUIRED', label: 'Soil resistivity survey', note: 'Zone-table σ=10 mS/m used for screening. Commission a 4-electrode Wenner array survey.' },
        { id: 'ASR_REGISTRATION', priority: 'REQUIRED', label: 'ASR registration (47 CFR §17.7)', note: 'λ/4 ≈ 96 m at 780 kHz exceeds the §17.7 200-ft (60.96 m) threshold. File FCC Form 854.' },
        { id: 'MPE_STUDY', priority: 'REQUIRED', label: 'RF exposure (MPE) evaluation (OET-65 / §1.1307)', note: 'Near-field boundary λ/(2π) ≈ 61 m at 780 kHz.' },
        { id: 'COL_COVERAGE_REMEDY', priority: 'REQUIRED', label: 'COL coverage remedy engineering', note: '78% COL coverage < §73.24(i) 80% floor. Increase TPO to ≥8.5 kW or design DA pattern (§73.150) to push coverage above floor.' }
      ],
      regulatory_risk_score: {
        risk_score: 45, risk_category: 'HIGH',
        risk_factors: [
          { factor: 'ASR_REQUIRED', points: 15, note: 'λ/4 ≈ 96 m at 780 kHz exceeds 60.96 m §17.7 threshold: FAA 7460-1 + FCC Form 854 required' },
          { factor: 'MODERATE_CONDUCTIVITY', points: 5, note: 'σ=10 mS/m (EXCELLENT): standard 120-radial system adequate but soil survey still required' },
          { factor: 'COL_COVERAGE_FAILS', points: 10, note: 'COL coverage 78% < §73.24(i) 80% floor (gap 2%): coverage remedy required before filing' },
          { factor: 'NIF_STUDY_REQUIRED', points: 10, note: '§73.182 NIF study required for all non-local-channel stations at a new transmitter site' },
          { factor: 'DA_PATTERN_REQUIRED', points: 5, note: 'DA pattern shaping may close coverage gap — §73.150 pattern design may be needed' }
        ],
        interpretation: 'HIGH regulatory risk — at least one major filing barrier present (COL coverage gap); budget additional engineering resources.'
      },
      co_channel_spacing_estimate: {
        candidate_distance_km: 12.5,
        co_channel: { min_separation_km: 953, meets_separation: false, note: 'Class D co-channel minimum 953 km' },
        adjacent_10khz: { min_separation_km: 724, meets_separation: false, note: 'Class D ±10 kHz minimum 724 km' },
        adjacent_20khz: { min_separation_km: 354, meets_separation: false, note: 'Class D ±20 kHz minimum 354 km' },
        screening_verdict: 'BELOW_ALL_SPACING_MINIMUMS',
        rule: '47 CFR §73.37 (daytime, proposed station vs. same class)',
        caveat: 'Spacing screen uses distance from current site as proxy. Actual §73.37 separation must be measured to nearest co-channel and adjacent-channel stations.'
      },
      mpe_rf_exposure_summary: {
        evaluation_required: true,
        rule: '47 CFR §1.1307 / OET Bulletin 65 §3.B',
        frequency_mhz: 0.78,
        near_field_boundary_m: 61.12,
        mpe_limit_mw_cm2: 0.0020,
        far_field_exclusion_m: 44.7,
        recommended_fence_distance_m: 61.12,
        note: 'At 5 kW, near-field boundary (λ/2π) dominates. Fence at ≥62 m from base of antenna.'
      },
      power_efficiency_metrics: {
        tpo_kw: 5,
        people_per_kw: 17120,
        km2_per_kw: 504,
        col_coverage_pct_per_kw: 15.6,
        efficiency_tier: 'HIGH',
        note: 'At 5 kW TPO: ~17,120 people/kW, 504 km²/kW service area (national avg density proxy)'
      },
      nighttime_classification: {
        eligibility: 'RESTRICTED',
        nif_complexity: 'VERY_HIGH',
        protection_class: 'Clear channel — Class A dominant (§73.25)',
        key_constraint: '780 kHz is a §73.25 clear channel. Increasing TPO from 5→8.5 kW increases skywave NIF complexity significantly.',
        nighttime_power_max_kw: 0.5,
        nif_study_required: true,
        rule: '47 CFR §73.182 / §73.25'
      },
      da_gain_potential: {
        applicable: true,
        nda_col_coverage_pct: 78,
        col_gap_to_floor_pct: 2,
        da_col_coverage_estimate_pct: 97.4,
        would_recover_col_compliance: true,
        da_erp_boost_modeled: '4× NDA ERP toward COL bearing (best-case pattern)',
        recommendation: 'DA pattern likely recovers §73.24(i) compliance — commission §73.150 DA study toward COL bearing',
        rule: '47 CFR §73.150 / §73.24(i)'
      },
      directional_antenna_study_guide: {
        recommended: true,
        primary_reason: 'COL_COVERAGE_GAP',
        study_type: 'FULL_DA_STUDY_DAY_NIGHT',
        triggers: [
          { trigger: 'COL_COVERAGE_GAP', detail: 'NDA coverage 78% < §73.24(i) 80% floor. DA with max ERP toward COL centroid bearing can recover compliance.', cfr: '47 CFR §73.150 / §73.24(i)' },
          { trigger: 'CLEAR_CHANNEL_SECONDARY_NIGHTTIME', detail: 'Secondary Class D on clear channel 780 kHz — DA-N also required at night.', cfr: '47 CFR §73.25 / §73.182' }
        ],
        key_constraints: [
          'Maximize ERP toward COL centroid bearing (§73.24(i) ≥80% coverage goal).',
          'DA-N pattern must protect Class A dominant\'s 0.5 mV/m and 25 µV/m contours.',
          '§73.150(a): horizontal pattern filed in 5° increments (72 tabulated values, 0°–355°).',
          'Typical AM DA array: 2–4 tower elements; ground system must be extended to all towers.'
        ],
        pattern_radials_required: 72, additional_engineering_weeks_min: 16, additional_engineering_weeks_max: 32,
        note: 'Commission a FULL DA STUDY DAY NIGHT before filing. Adds 16–32 weeks to engineering timeline.', rule: '47 CFR §73.150'
      },
      skywave_protection_advisory: {
        advisory_level: 'HIGH', nif_required: true,
        nif_study_type: '§73.182 full azimuthal skywave NIF (1° bearings, OET-72 methodology)',
        protected_contour_25uvm_est_km: 120.21, groundwave_05mvm_est_km: 28.4,
        advisory_items: [
          'Secondary Class D on clear channel 780 kHz: must not increase nighttime interference to dominant Class A WJR\'s 0.5 mV/m and 25 µV/m contours.',
          'Increasing TPO from 5→8.5 kW significantly increases skywave NIF complexity — must re-study full azimuthal skywave exposure at the higher power level.'
        ],
        key_risk: 'Secondary on §73.25 clear channel — power increase amplifies NIF burden on all bearings', treaty_factor: null, rule: '47 CFR §73.25 / §73.182'
      },
      transmission_line_analysis: {
        frequency_khz: 780, tpo_kw: 8.5, assumed_run_m: 60,
        feedline_options: [
          { id: 'EIA_7_8_IN', label: 'EIA 7/8" coax', atten_db_per_100m: 0.32, total_loss_db_at_60m: 0.19, erp_at_antenna_kw: 8.13 },
          { id: 'EIA_1_5_8_IN', label: 'EIA 1-5/8" coax', atten_db_per_100m: 0.18, total_loss_db_at_60m: 0.11, erp_at_antenna_kw: 8.28 },
          { id: 'EIA_3_1_8_IN', label: 'EIA 3-1/8" coax', atten_db_per_100m: 0.10, total_loss_db_at_60m: 0.06, erp_at_antenna_kw: 8.38 },
          { id: 'OPEN_WIRE', label: 'Open wire (600 Ω)', atten_db_per_100m: 0.03, total_loss_db_at_60m: 0.02, erp_at_antenna_kw: 8.46 }
        ],
        recommended_feedline_id: 'EIA_7_8_IN',
        recommendation_rationale: 'At TPO ≤ 25 kW, EIA 7/8" coax provides excellent efficiency with manageable cost and installation complexity.',
        note: 'Attenuation computed from skin-effect formula at 0.780 MHz, 60 m assumed run. 8.5 kW TPO (power upgrade scenario).'
      },
      antenna_base_impedance: {
        frequency_khz: 780, sigma_msm: 4, quarter_wave_m: 96.2, N_radials: 120,
        quarter_wave: { R_r_ohm: 36.6, R_g_standard_ohm: 9.7, R_total_ohm: 46.3, efficiency_standard_pct: 79.0, R_g_extended_ohm: 4.3, efficiency_extended_pct: 89.5 },
        five_eighths_wave: { R_r_ohm: 49.8, X_base_j: 45, note: 'Matching network required to cancel +j45 Ω reactance' },
        base_reactance_table: [
          { height_label: 'λ/4 (electrical 90°)', X_base_j: 0, notes: 'Purely resistive — simplest matching' },
          { height_label: '5/8λ (electrical 225°)', X_base_j: 45, notes: 'Inductive — series cap or shunt network required' },
          { height_label: '0.19λ (electrical 68°)', X_base_j: -150, notes: 'Capacitive — series inductor required' }
        ],
        matching_network_complexity: 'MODERATE — σ=4 mS/m raises ground resistance to ~9.7 Ω; consider extended radial system to improve efficiency.',
        design_note: 'At σ=4 mS/m, efficiency is 79% standard / 89.5% extended. Extending to 180 radials recommended if pursuing power upgrade to 8.5 kW.'
      },
      permit_and_engineering_cost_estimate: {
        cost_tier: 'HIGH',
        range_label: '$62,000 – $128,000',
        total_soft_cost_low_usd: 62000, total_soft_cost_high_usd: 128000,
        line_items: [
          { item: 'FCC_FORM_301', label: 'FCC Form 301-AM application fee', cost_low_usd: 1380, cost_high_usd: 1380 },
          { item: 'FCC_FORM_302', label: 'FCC Form 302-AM license fee', cost_low_usd: 690, cost_high_usd: 690 },
          { item: 'FCC_FORM_854_ASR', label: 'FCC Form 854 ASR registration (96 m > 60.96 m)', cost_low_usd: 630, cost_high_usd: 630 },
          { item: 'FAA_AERO_STUDY', label: 'FAA 7460-1 aeronautical study & marking/lighting', cost_low_usd: 4500, cost_high_usd: 9000 },
          { item: 'SOIL_RESISTIVITY_SURVEY', label: 'Soil resistivity survey (§73.190 certification)', cost_low_usd: 3500, cost_high_usd: 7000 },
          { item: 'NIF_STUDY', label: '§73.182 NIF skywave study at 8.5 kW (OET-72 / LMS)', cost_low_usd: 18000, cost_high_usd: 40000 },
          { item: 'DA_ENGINEERING', label: 'FULL DA STUDY DAY+NIGHT pattern modeling & §73.150 filing', cost_low_usd: 18000, cost_high_usd: 40000 },
          { item: 'RF_EXPOSURE_STUDY', label: 'RF MPE evaluation at upgraded power (OET Bulletin 65)', cost_low_usd: 2500, cost_high_usd: 5000 },
          { item: 'FCC_COUNSEL', label: 'Communications counsel (FCC filing oversight)', cost_low_usd: 10000, cost_high_usd: 22000 }
        ],
        note: 'Soft-cost estimate only. NIF and DA costs elevated by power upgrade to 8.5 kW. 2024 USD.'
      },
      signal_propagation_profile: {
        frequency_khz: 780, tpo_kw: 8.5, sigma_msm: 4,
        contours: [
          { id: 'DAYTIME_5MVM',    label: '5 mV/m (city-grade / §73.24(i) COL floor)',   target_mvm: 5.0,    distance_km: 7.5,  area_km2: 176.7 },
          { id: 'DAYTIME_2MVM',    label: '2 mV/m (primary service contour)',             target_mvm: 2.0,    distance_km: 16.1, area_km2: 814.9 },
          { id: 'DAYTIME_05MVM',   label: '0.5 mV/m (secondary daytime / §73.24 reach)', target_mvm: 0.5,    distance_km: 37.2, area_km2: 4352 },
          { id: 'DAYTIME_01MVM',   label: '0.1 mV/m (daytime interference floor)',        target_mvm: 0.1,    distance_km: 72.8, area_km2: 16638 },
          { id: 'BLANKET_1000MVM', label: '1000 mV/m (§73.24(g) blanket contour)',        target_mvm: 1000.0, distance_km: 0.29, area_km2: 0.26 }
        ],
        skywave_25uvm_est_km: 156.7,
        note: 'Groundwave contours use FCC gwave curves (§73.184) at this σ and TPO. Skywave 25 µV/m estimate uses OET-72 textbook approximation — actual NIF requires FCC skywave propagation software.'
      }
    },
    {
      rank: 4, rank_percentile: 24.8, lat: 34.78, lon: -111.95,
      distance_from_current_km: 15.0, bearing_deg: 247, cardinal_direction: 'WSW', score: 58.5,
      score_delta_vs_baseline: -3.9,
      col_coverage_pct: 0.62, nif_status: 'FAIL',
      principal_community_5mvm_km: 3.4, daytime_reach_km: 22.5, blanket_population_pct: 1.1,
      blanket_1000mvm_km: 0.6, minimum_tpo_for_compliance_kw: 4.2, minimum_tpo_for_col_coverage_kw: 47.8,
      ground_sigma_mS_m: 1.5, ground_sigma_quality: 'POOR', ground_sigma_filing_grade: 'screening',
      ground_sigma_source: 'FCC M3 zone table',
      ground_radial_advisory: 'POOR conductivity (σ=1.5 mS/m): §73.190 extended ground system likely required — consider deep-driven ground rods or buried copper grid in addition to standard 120 radials. Site soil resistivity survey strongly recommended before committing to this location.',
      score_confidence: 'LOW', field_at_col_centroid_mvm: 0.31,
      estimated_daytime_population_served: 54000,
      treaty_zone: 'US-MX advisory',
      fuel_risk: 'LOW',
      notes: 'Coverage gap on east side of COL; treaty advisory zone.',
      explanation: {
        score_breakdown: { col_coverage: 20.7, population: 16.1, blanket: 6.9, conductivity: 4.6, wildfire: 0, treaty_zone: 0 },
        ranking_rationale: 'COL coverage gap + §73.24(g) blanket pop overage — kept for completeness only.'
      },
      status_labels: ['NON-COMPLIANT'],
      status_category: 'NON_COMPLIANT',
      source: 'GRID',
      infrastructure_ref: null,
      colocation_analysis: null,
      limitations: ['§73.182 NIF projected to fail', 'US/MX treaty advisory in scope'],
      regulatory_risk_score: {
        risk_score: 100, risk_category: 'VERY_HIGH',
        risk_factors: [
          { factor: 'TREATY_ZONE', points: 40, note: 'In treaty zone (US-MX advisory): FCC IB coordination adds 12–52 weeks; power/pattern restrictions likely' },
          { factor: 'ASR_REQUIRED', points: 15, note: 'λ/4 ≈ 96 m at 780 kHz exceeds 60.96 m §17.7 threshold: FAA 7460-1 + FCC Form 854 required before construction' },
          { factor: 'POOR_CONDUCTIVITY', points: 20, note: 'σ=1.5 mS/m (POOR): extended ground system required; adds cost, time, and uncertainty to §73.190 certification' },
          { factor: 'BLANKET_POP_EXCEEDS_LIMIT', points: 25, note: 'Estimated blanket pop 1.1% > §73.24(g) 1% limit: filing cannot proceed without power reduction or DA-N pattern' },
          { factor: 'COL_COVERAGE_FAILS', points: 20, note: 'COL coverage 62% < §73.24(i) 80% floor (gap 18%): coverage remedy required before filing' },
          { factor: 'NIF_STUDY_REQUIRED', points: 10, note: '§73.182 NIF study required; failure likely due to coverage constraints' }
        ],
        interpretation: 'VERY HIGH regulatory complexity — multiple blocking issues; recommend deprioritizing unless site has exceptional propagation advantages.'
      },
      co_channel_spacing_estimate: {
        candidate_distance_km: 15.0,
        co_channel: { min_separation_km: 953, meets_separation: false, note: 'Class D co-channel minimum 953 km' },
        adjacent_10khz: { min_separation_km: 724, meets_separation: false, note: 'Class D ±10 kHz minimum 724 km' },
        adjacent_20khz: { min_separation_km: 354, meets_separation: false, note: 'Class D ±20 kHz minimum 354 km' },
        screening_verdict: 'BELOW_ALL_SPACING_MINIMUMS',
        rule: '47 CFR §73.37 (daytime, proposed station vs. same class)',
        caveat: 'Spacing screen uses distance from current site as proxy. Actual §73.37 separation must be measured to nearest co-channel and adjacent-channel stations.'
      },
      mpe_rf_exposure_summary: {
        evaluation_required: true,
        rule: '47 CFR §1.1307 / OET Bulletin 65 §3.B',
        frequency_mhz: 0.78,
        near_field_boundary_m: 61.12,
        mpe_limit_mw_cm2: 0.0020,
        far_field_exclusion_m: 44.7,
        recommended_fence_distance_m: 61.12,
        note: 'At 5 kW, near-field boundary (λ/2π) dominates. Fence at ≥62 m from base of antenna.'
      },
      power_efficiency_metrics: {
        tpo_kw: 5,
        people_per_kw: 10800,
        km2_per_kw: 318,
        col_coverage_pct_per_kw: 12.4,
        efficiency_tier: 'MODERATE',
        note: 'At 5 kW TPO: ~10,800 people/kW, 318 km²/kW service area (national avg density proxy)'
      },
      nighttime_classification: {
        eligibility: 'RESTRICTED',
        nif_complexity: 'VERY_HIGH',
        protection_class: 'Clear channel — Class A dominant (§73.25)',
        key_constraint: '780 kHz clear channel + US-MX treaty zone: FCC IB pre-coordination required before any nighttime operation.',
        nighttime_power_max_kw: 0.25,
        nif_study_required: true,
        rule: '47 CFR §73.182 / §73.25'
      },
      da_gain_potential: {
        applicable: true,
        nda_col_coverage_pct: 62,
        col_gap_to_floor_pct: 18,
        da_col_coverage_estimate_pct: 83.1,
        would_recover_col_compliance: true,
        da_erp_boost_modeled: '4× NDA ERP toward COL bearing (best-case pattern)',
        recommendation: 'DA pattern likely recovers §73.24(i) compliance — commission §73.150 DA study toward COL bearing',
        rule: '47 CFR §73.150 / §73.24(i)'
      },
      directional_antenna_study_guide: {
        recommended: true,
        primary_reason: 'COL_COVERAGE_GAP',
        study_type: 'FULL_DA_STUDY_DAY_NIGHT',
        triggers: [
          { trigger: 'COL_COVERAGE_GAP', detail: 'NDA coverage 62% < §73.24(i) 80% floor. DA with max ERP toward COL centroid bearing can recover compliance.', cfr: '47 CFR §73.150 / §73.24(i)' },
          { trigger: 'BLANKET_POP_SUPPRESSION', detail: 'Blanket pop 1.1% exceeding §73.24(g) 1% limit. DA must also null the 1000 mV/m lobe away from population centers.', cfr: '47 CFR §73.24(g) / §73.150' },
          { trigger: 'TREATY_CONSTRAINT', detail: 'Within US-MX treaty zone. DA likely required to reduce power toward the border.', cfr: '1986 US/Mexico AM Agreement' },
          { trigger: 'CLEAR_CHANNEL_SECONDARY_NIGHTTIME', detail: 'Secondary Class D on clear channel 780 kHz — DA-N required at night.', cfr: '47 CFR §73.25 / §73.182' }
        ],
        key_constraints: [
          'Maximize ERP toward COL centroid bearing (§73.24(i) ≥80% coverage goal).',
          'Null 1000 mV/m contour away from populated areas (§73.24(g) ≤1% blanket limit).',
          'Reduce power toward US-MX border for binational coordination.',
          'DA-N pattern must protect Class A dominant\'s 0.5 mV/m and 25 µV/m contours.',
          '§73.150(a): horizontal pattern filed in 5° increments (72 tabulated values, 0°–355°).'
        ],
        pattern_radials_required: 72, additional_engineering_weeks_min: 16, additional_engineering_weeks_max: 32,
        note: 'Commission a FULL DA STUDY DAY NIGHT before filing. Multiple competing constraints — expect 16–32 weeks additional DA engineering.', rule: '47 CFR §73.150'
      },
      skywave_protection_advisory: {
        advisory_level: 'CRITICAL', nif_required: true,
        nif_study_type: '§73.182 full azimuthal skywave NIF (1° bearings, OET-72 methodology)',
        protected_contour_25uvm_est_km: 120.21, groundwave_05mvm_est_km: 22.5,
        advisory_items: [
          'Secondary Class D on clear channel 780 kHz: must not increase nighttime interference to dominant Class A WJR\'s 0.5 mV/m and 25 µV/m contours.',
          '§73.182 NIF must demonstrate interference not materially increased from current authorized site — this is a delta comparison.',
          'TREATY ZONE US-MX: binational skywave coordination required — FCC IB review adds 12–52 weeks. Pattern authorization likely restricted in directions toward the border.'
        ],
        key_risk: 'Secondary on §73.25 clear channel IN treaty zone — maximum NIF complexity class; CRITICAL advisory',
        treaty_factor: 'US-MX advisory', rule: '47 CFR §73.25 / §73.182'
      },
      transmission_line_analysis: {
        frequency_khz: 780, tpo_kw: 5, assumed_run_m: 60,
        feedline_options: [
          { id: 'EIA_7_8_IN', label: 'EIA 7/8" coax', atten_db_per_100m: 0.32, total_loss_db_at_60m: 0.19, erp_at_antenna_kw: 4.79 },
          { id: 'EIA_1_5_8_IN', label: 'EIA 1-5/8" coax', atten_db_per_100m: 0.18, total_loss_db_at_60m: 0.11, erp_at_antenna_kw: 4.87 },
          { id: 'EIA_3_1_8_IN', label: 'EIA 3-1/8" coax', atten_db_per_100m: 0.10, total_loss_db_at_60m: 0.06, erp_at_antenna_kw: 4.93 },
          { id: 'OPEN_WIRE', label: 'Open wire (600 Ω)', atten_db_per_100m: 0.03, total_loss_db_at_60m: 0.02, erp_at_antenna_kw: 4.98 }
        ],
        recommended_feedline_id: 'EIA_7_8_IN',
        recommendation_rationale: 'At TPO ≤ 25 kW, EIA 7/8" coax provides excellent efficiency with manageable cost and installation complexity.',
        note: 'Attenuation computed from skin-effect formula at 0.780 MHz, 60 m assumed run.'
      },
      antenna_base_impedance: {
        frequency_khz: 780, sigma_msm: 3, quarter_wave_m: 96.2, N_radials: 120,
        quarter_wave: { R_r_ohm: 36.6, R_g_standard_ohm: 12.9, R_total_ohm: 49.5, efficiency_standard_pct: 73.9, R_g_extended_ohm: 5.7, efficiency_extended_pct: 86.5 },
        five_eighths_wave: { R_r_ohm: 49.8, X_base_j: 45, note: 'Matching network required to cancel +j45 Ω reactance' },
        base_reactance_table: [
          { height_label: 'λ/4 (electrical 90°)', X_base_j: 0, notes: 'Purely resistive — simplest matching' },
          { height_label: '5/8λ (electrical 225°)', X_base_j: 45, notes: 'Inductive — series cap or shunt network required' },
          { height_label: '0.19λ (electrical 68°)', X_base_j: -150, notes: 'Capacitive — series inductor required' }
        ],
        matching_network_complexity: 'HIGH — σ=3 mS/m drives ground resistance to ~12.9 Ω; extended radial system strongly recommended before filing.',
        design_note: 'At σ=3 mS/m, standard efficiency is only 73.9%. Extended 180-radial system improves to 86.5%. Ground system cost may reach $80k+ at this conductivity.'
      },
      permit_and_engineering_cost_estimate: {
        cost_tier: 'VERY_HIGH',
        range_label: '$95,000 – $195,000',
        total_soft_cost_low_usd: 95000, total_soft_cost_high_usd: 195000,
        line_items: [
          { item: 'FCC_FORM_301', label: 'FCC Form 301-AM application fee', cost_low_usd: 1380, cost_high_usd: 1380 },
          { item: 'FCC_FORM_302', label: 'FCC Form 302-AM license fee', cost_low_usd: 690, cost_high_usd: 690 },
          { item: 'FCC_FORM_854_ASR', label: 'FCC Form 854 ASR registration (96 m > 60.96 m)', cost_low_usd: 630, cost_high_usd: 630 },
          { item: 'FAA_AERO_STUDY', label: 'FAA 7460-1 aeronautical study & marking/lighting', cost_low_usd: 4500, cost_high_usd: 9000 },
          { item: 'SOIL_RESISTIVITY_SURVEY', label: 'Soil resistivity survey (§73.190 certification)', cost_low_usd: 3500, cost_high_usd: 7000 },
          { item: 'NIF_STUDY', label: '§73.182 NIF skywave study (OET-72 / LMS)', cost_low_usd: 18000, cost_high_usd: 45000 },
          { item: 'DA_ENGINEERING', label: 'FULL DA STUDY DAY+NIGHT — COL + treaty pattern modeling', cost_low_usd: 22000, cost_high_usd: 55000 },
          { item: 'RF_EXPOSURE_STUDY', label: 'RF MPE evaluation (OET Bulletin 65)', cost_low_usd: 2500, cost_high_usd: 5000 },
          { item: 'TREATY_COORDINATION', label: 'US-MX treaty coordination (FCC IB / Conatel)', cost_low_usd: 25000, cost_high_usd: 55000 },
          { item: 'FCC_COUNSEL', label: 'Communications counsel (FCC filing oversight + treaty)', cost_low_usd: 15000, cost_high_usd: 35000 }
        ],
        note: 'Soft-cost estimate only. Treaty coordination adds $25–55k and 12–52 weeks. 2024 USD.'
      },
      signal_propagation_profile: {
        frequency_khz: 780, tpo_kw: 5, sigma_msm: 3,
        contours: [
          { id: 'DAYTIME_5MVM',    label: '5 mV/m (city-grade / §73.24(i) COL floor)',   target_mvm: 5.0,    distance_km: 5.4,  area_km2: 91.6 },
          { id: 'DAYTIME_2MVM',    label: '2 mV/m (primary service contour)',             target_mvm: 2.0,    distance_km: 11.9, area_km2: 444.7 },
          { id: 'DAYTIME_05MVM',   label: '0.5 mV/m (secondary daytime / §73.24 reach)', target_mvm: 0.5,    distance_km: 28.1, area_km2: 2479 },
          { id: 'DAYTIME_01MVM',   label: '0.1 mV/m (daytime interference floor)',        target_mvm: 0.1,    distance_km: 55.8, area_km2: 9785 },
          { id: 'BLANKET_1000MVM', label: '1000 mV/m (§73.24(g) blanket contour)',        target_mvm: 1000.0, distance_km: 0.22, area_km2: 0.15 }
        ],
        skywave_25uvm_est_km: 120.2,
        note: 'Groundwave contours use FCC gwave curves (§73.184) at this σ and TPO. Skywave 25 µV/m estimate uses OET-72 textbook approximation — actual NIF requires FCC skywave propagation software.'
      }
    }
  ]
};

// Co-location demo payload — used when the colocation endpoint is not
// yet deployed.  Builds on DEMO_RESULT and appends two infrastructure-
// source rows demonstrating the new shape (`source`, `infrastructure_ref`,
// `colocation_analysis`, `status_category`).
const DEMO_COLOCATION_RESULT = {
  ...DEMO_RESULT,
  conductivity_mode: 'zone-table',
  n_infrastructure_sites: 4,
  scoring_time_ms: 824,
  n_candidates_evaluated: 312,
  n_candidates_returned:  6,
  candidate_count_by_status: {
    PROMISING: 71, REVIEW_REQUIRED: 178, NON_COMPLIANT: 42,
    RECOVERABLE_WITH_DA: 18, RECOVERABLE_WITH_POWER_INCREASE: 3
  },
  candidates: [
    ...DEMO_RESULT.candidates,
    {
      rank: 5, rank_percentile: 97.7, lat: 34.88, lon: -111.85,
      distance_from_current_km: 3.4, score: 88.7,
      col_coverage_pct: 0.94, nif_status: 'PROMISING',
      daytime_reach_km: 33.0, blanket_population_pct: 0.5,
      ground_sigma_mS_m: 7, treaty_zone: null, fuel_risk: 'LOW',
      notes: 'Existing 122 m guyed tower — shared-lease advantage; same-band caution.',
      explanation: {
        score_breakdown: { col_coverage: 32, population: 26, blanket: 13, conductivity: 9, wildfire: 3, treaty_zone: 4 },
        ranking_rationale: 'Strong COL coverage with parcel + ASR + grounding already in place.'
      },
      status_labels: ['PROMISING', 'REVIEW REQUIRED'],
      status_category: 'RECOVERABLE_WITH_DA',
      source: 'INFRASTRUCTURE',
      infrastructure_ref: {
        id: 'ASR-1062845',
        kind: 'TOWER',
        name: 'Sedona Ridge Tower 4',
        owner: 'Verde Broadcasting LLC',
        lat: 34.88, lon: -111.85,
        height_m: 122,
        structure_type: 'GUYED',
        asr_number: '1062845',
        frequency_khz: null,
        station_call: null
      },
      colocation_analysis: {
        distance_to_host_m: 0,
        host_kind: 'TOWER',
        host_owner: 'Verde Broadcasting LLC',
        host_height_m: 122,
        tower_loading_advisory: 'Loading study required — antenna mass + wind area must be re-computed for the added array.',
        same_band_interference_risk: 'MEDIUM',
        structural_engineering_required: true,
        shared_lease_advantage: true,
        diplexing_required: false,
        regulatory_notes: [
          'ASR registered — FAA/FCC notification of structure change may apply.',
          'RF MPE must be re-evaluated with all existing tenants in place.'
        ]
      },
      limitations: ['Shared-lease only; site not owned outright.']
    },
    {
      rank: 6, rank_percentile: 83.3, lat: 34.81, lon: -111.78,
      distance_from_current_km: 6.0, score: 76.1,
      col_coverage_pct: 0.86, nif_status: 'REVIEW',
      daytime_reach_km: 29.4, blanket_population_pct: 0.9,
      ground_sigma_mS_m: 6, treaty_zone: null, fuel_risk: 'LOW',
      notes: 'Co-located on existing AM site — diplexing required, same-band HIGH.',
      explanation: {
        score_breakdown: { col_coverage: 28, population: 22, blanket: 10, conductivity: 7, wildfire: 5, treaty_zone: 4 },
        ranking_rationale: 'Existing AM facility already authorized — diplexing path well-trodden.'
      },
      status_labels: ['REVIEW REQUIRED'],
      status_category: 'RECOVERABLE_WITH_DA',
      source: 'INFRASTRUCTURE',
      infrastructure_ref: {
        id: 'AM-KVRD-790',
        kind: 'AM_SITE',
        name: 'KVRD 790 kHz transmitter',
        owner: 'Red Rock Radio Group',
        lat: 34.81, lon: -111.78,
        height_m: 90,
        structure_type: 'SERIES_FED',
        asr_number: null,
        frequency_khz: 790,
        station_call: 'KVRD'
      },
      colocation_analysis: {
        distance_to_host_m: 0,
        host_kind: 'AM_SITE',
        host_owner: 'Red Rock Radio Group',
        host_height_m: 90,
        tower_loading_advisory: 'Series-fed tower — diplexer + isolator engineering required.',
        same_band_interference_risk: 'HIGH',
        structural_engineering_required: true,
        shared_lease_advantage: true,
        diplexing_required: true,
        regulatory_notes: [
          'Co-channel adjacency — full §73.182 NIF re-projection with host pattern required.',
          'Diplexer specification and re-grounding plan must accompany the filing.'
        ]
      },
      limitations: ['Host carrier at 790 kHz — only 10 kHz spacing from proposed 780 kHz.']
    }
  ]
};
