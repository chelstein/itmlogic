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
  top_candidates_summary: 'Rank 1 scores 91.3 (PROMISING), 6 km NE of current site, σ=8 mS/m (EXCELLENT). COL field 18.4 mV/m (≥§73.24(j) 5 mV/m floor). est. 125K served @0.5 mV/m. vs current site: score +28.9, reach +5.6 km. top 4 σ quality: 3×EXCELLENT, 1×FAIR. statuses: 3 PROMISING, 1 REVIEW_REQUIRED (out of 234 evaluated).',
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
      summary: 'Rank 3 @ 12.5 km NW: COL coverage 78% (below 80% floor), σ=10 mS/m (EXCELLENT), reach 28 km. Increase TPO to ≥8.5 kW to achieve §73.24(j) compliance, then advance to NIF study.',
      recommended_next_step: 'Increase TPO to ≥8.5 kW to achieve §73.24(j) compliance, then advance to NIF study.'
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
      { id: 'COL_COVERAGE', label: 'Principal community (§73.24(j)) coverage', confidence: 'SCREENING', score_impact_pts: 10, upgrade_action: 'Supply community_of_license_polygon as GeoJSON Polygon in the request body.', upgrade_value: 'COL sub-score resolves from ±10 pts to ±2 pts.' },
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
      action: 'Evaluate TPO increase for §73.24(j) COL coverage on 2 candidate(s) (Rank 3: increase to ≥8.5 kW).',
      rationale: 'Ranks 3 and 4 fail the §73.24(j) 5 mV/m principal-community floor at current TPO. The engine has pre-computed the minimum TPO at which the 5 mV/m groundwave contour reaches the community-of-license centroid distance. Verify the increased power is within the licensed class ceiling (§73.21) and does not create new §73.24(g) blanket population problems.'
    },
    {
      priority: 'MEDIUM',
      action: 'Commission §73.182 nighttime skywave NIF study before selecting any candidate site.',
      rationale: 'The operating frequency (780 kHz) is a §73.25 clear channel with HIGH skywave risk. A complete NIF analysis is mandatory for any change of community or transmitter site; this should precede site acquisition to avoid committing to a site that fails nighttime skywave protection.'
    },
    {
      priority: 'MEDIUM',
      action: 'Supply the community-of-license GeoJSON polygon for filing-grade COL coverage scoring.',
      rationale: 'Current run uses a 10 km disc proxy for §73.24(j) coverage. Providing the actual COL boundary as a GeoJSON Polygon enables Monte-Carlo polygon overlap scoring and significantly increases confidence in the coverage sub-score.'
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
    { id: 'ANTENNA_STUDY',     status: 'REQUIRED',    description: 'Design and model AM vertical antenna system for 780 kHz', rule: '47 CFR §73.316 / §73.45', note: 'Non-directional antenna — standard §73.45 field intensity / efficiency certification required' },
    { id: 'ASR_REGISTRATION',  status: 'REQUIRED',    description: 'Verify tower height; file FCC ASR registration if > 200 ft (60.96 m)', rule: '47 CFR §17.7', note: 'ASR REGISTRATION REQUIRED: typical λ/4 antenna height at 780 kHz (96.15 m) exceeds the 200-ft §17.7 threshold' },
    { id: 'RF_EXPOSURE_MPE',   status: 'REQUIRED',    description: 'Prepare RF exposure (MPE) evaluation per OET Bulletin 65', rule: '47 CFR §1.1307 / OET Bulletin 65', note: 'ERP = 5 kW. All AM broadcast stations must demonstrate general population MPE compliance.' },
    { id: 'COL_COVERAGE',      status: 'REQUIRED',    description: 'Document ≥ 80% community-of-license coverage by the 5 mV/m daytime contour', rule: '47 CFR §73.24(j)', note: 'No COL polygon provided — polygon-based analysis required for filing' },
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
        col_coverage: { status: 'PASS', value: 0.97, threshold: 0.80, rule: '47 CFR §73.24(j)' },
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
      da_gain_potential: { applicable: false, reason: 'Already ≥100% NDA COL coverage — DA not needed for §73.24(j)' },
      site_viability_summary: {
        go_no_go: 'GO', confidence: 'PROMISING',
        one_line: 'Meets §73.24(j) COL floor (97%) and §73.24(g) blanket limit at current TPO.',
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
        notes: ['High-conductivity soil (σ=8 mS/m) — seasonal moisture variation is modest (±10–20%) and unlikely to affect §73.24(j) compliance.',
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
          { target_mvm: 5.0,  label: '5 mV/m (§73.24(j) principal community)', distance_km: 5.8,  area_km2: 105.7,  estimated_population: 179690 },
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
          '§73.316: horizontal pattern filed in 5° increments (72 tabulated values + 0°).',
          'Typical AM DA array: 2–4 tower elements; ground system must be extended to all towers.'
        ],
        pattern_radials_required: 72,
        additional_engineering_weeks_min: 8,
        additional_engineering_weeks_max: 16,
        note: 'Commission a DA N NIGHTTIME ONLY study before filing. DA engineering adds 8–16 weeks; budget for multiple antenna modeling iterations.',
        rule: '47 CFR §73.150 / §73.316'
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
          { id: 'COL_COVERAGE', label: '§73.24(j) COL 5 mV/m coverage', status: 'PASS', value: '97% (need ≥80%)', rule: '47 CFR §73.24(j)', note: null },
          { id: 'BLANKET_POP', label: '§73.24(g) blanket population <1%', status: 'PASS', value: '0.5% (max 1%)', rule: '47 CFR §73.24(g)', note: null },
          { id: 'ASR_REGISTRATION', label: '§17.7 ASR tower registration', status: 'WARN', value: 'λ/4 ≈ 96 m (threshold 60.96 m)', rule: '47 CFR §17.7', note: 'FCC Form 854 + FAA aeronautical study (7460-1) required before construction.' },
          { id: 'RF_EXPOSURE_MPE', label: '§1.1307 RF exposure (MPE) evaluation', status: 'WARN', value: 'Near-field boundary λ/(2π) ≈ 61 m', rule: '47 CFR §1.1307 / OET Bulletin 65', note: 'OET-65 near-field evaluation required — fence at ≥61 m from antenna base.' },
          { id: 'TREATY_COORDINATION', label: 'International treaty zone', status: 'PASS', value: 'None detected', rule: 'US/MX AM Agreement (1986)', note: null },
          { id: 'NIGHTTIME_NIF', label: '§73.182 nighttime NIF study', status: 'WARN', value: 'Required at any new site', rule: '47 CFR §73.182', note: 'NIF study must demonstrate no increase in nighttime interference from authorized site.' },
          { id: 'DA_PATTERN', label: '§73.316 directional antenna pattern', status: 'WARN', value: 'DA-N study recommended (clear channel secondary)', rule: '47 CFR §73.150 / §73.316', note: 'Clear channel secondary status requires DA-N nighttime directional pattern.' }
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
          { item: 'DA_ENGINEERING', label: 'DA-N pattern modeling & §73.316 filing', cost_low_usd: 12000, cost_high_usd: 30000 },
          { item: 'RF_EXPOSURE_STUDY', label: 'RF MPE evaluation (OET Bulletin 65)', cost_low_usd: 2000, cost_high_usd: 4000 },
          { item: 'FCC_COUNSEL', label: 'Communications counsel (FCC filing oversight)', cost_low_usd: 8000, cost_high_usd: 20000 }
        ],
        note: 'Soft-cost estimate only (FCC fees, studies, engineering). Tower, land, construction excluded. 2024 USD.'
      },
      signal_propagation_profile: {
        frequency_khz: 780, tpo_kw: 5, sigma_msm: 5,
        contours: [
          { id: 'DAYTIME_5MVM',    label: '5 mV/m (city-grade / §73.24(j) COL floor)',         target_mvm: 5.0,    distance_km: 6.2,  area_km2: 120.8 },
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
          { id: 'LMS_FORM_301', form: 'FCC Form 301-AM', exhibit: 'Section I — Basic Engineering', status: 'REQUIRED', rule: '47 CFR §73.3500 / §73.3525', responsible: 'Communications counsel + broadcast engineer', note: 'Primary change-of-site application. Include antenna system description, coordinates, ground system plan, and TPO.' },
          { id: 'LMS_GROUNDWAVE_STUDY', form: 'Form 301-AM — Exhibit B', exhibit: 'Groundwave field-intensity study (§73.184)', status: 'REQUIRED', rule: '47 CFR §73.183 / §73.184', responsible: 'Licensed broadcast engineer', note: 'FCC M3-zone conductivity σ=8 mS/m used for screening. Exhibit B requires groundwave distance/field table at compass bearings per §73.184.' },
          { id: 'LMS_COL_EXHIBIT', form: 'Form 301-AM — Exhibit C', exhibit: 'Principal community (COL) 5 mV/m coverage certification', status: 'REQUIRED', rule: '47 CFR §73.24(j)', responsible: 'Licensed broadcast engineer', note: 'Demonstrate ≥80% of principal community (97% estimated at screening) is covered by the 5 mV/m daytime groundwave contour.' },
          { id: 'LMS_BLANKET_POP', form: 'Form 301-AM — Exhibit D', exhibit: 'Blanket interference (§73.24(g)) population study', status: 'REQUIRED', rule: '47 CFR §73.24(g)', responsible: 'Licensed broadcast engineer', note: '1000 mV/m contour population must be <1% of service-area population. Current screen: 0.4%.' },
          { id: 'LMS_MPE_STUDY', form: 'Form 301-AM — Exhibit E', exhibit: 'RF exposure (MPE) evaluation (OET Bulletin 65 / §1.1307)', status: 'REQUIRED', rule: '47 CFR §1.1307', responsible: 'Licensed broadcast engineer', note: 'Near-field boundary λ/(2π) ≈ 61 m at 780 kHz. Fence distance and restricted-zone perimeter must be documented.' },
          { id: 'LMS_NEPA', form: 'Form 301-AM — NEPA Checklist', exhibit: 'NEPA environmental review (§1.1306)', status: 'REQUIRED', rule: '47 CFR §1.1306 / §1.1307', responsible: 'Environmental consultant + counsel', note: 'Complete 13-item §1.1306 checklist. File EA if any trigger applies.' },
          { id: 'LMS_ASR_FORM_854', form: 'FCC Form 854 (ASR)', exhibit: 'Antenna Structure Registration', status: 'REQUIRED', rule: '47 CFR §17.7', responsible: 'Tower owner / communications counsel', note: 'λ/4 ≈ 96.2 m exceeds 200 ft (60.96 m) §17.7 threshold. Form 854 + FAA Form 7460-1 required before construction. FAA review can take 45–90 days.' },
          { id: 'LMS_NIGHTTIME_NIF', form: 'Form 301-AM — Exhibit F / NIF Study', exhibit: '§73.182 nighttime interference field (NIF) study', status: 'REQUIRED', rule: '47 CFR §73.182', responsible: 'Licensed broadcast engineer (skywave)', note: 'Clear channel Class D — full §73.182 NIF required at 1° azimuthal resolution (OET-72). New site must not increase interference to dominant Class A protected contours.' },
          { id: 'LMS_DA_PATTERN', form: 'Form 301-AM — Exhibit G / §73.316 pattern table', exhibit: 'Directional antenna (DA) horizontal pattern', status: 'REQUIRED', rule: '47 CFR §73.150 / §73.316', responsible: 'Licensed broadcast engineer (antenna)', note: '§73.316: horizontal pattern in 5° increments (72 tabulated values + 0°). DA pattern must be modeled with moment-method software; physical proof required after construction.' },
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
        col_risk_note: 'GOOD conductivity — seasonal variation is unlikely to threaten §73.24(j) COL compliance.',
        reference: 'Seasonal conductivity variation factors are screening-grade proxies from NTIA 84-136 / FCC §73.190 guidance.',
        note: 'Seasonal propagation summary is a planning tool only. All §73.24(j) compliance determinations must use FCC-approved groundwave software with measured soil data.'
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
          { id: 'FI_RADIAL_NDA', label: 'Pattern proof — all authorized radials', rule: '47 CFR §73.154', instrument: 'Calibrated FCC field-intensity meter with λ/4 whip', notes: 'DA pattern: measure all azimuthal radials specified in authorized DA pattern, plus 8 orthogonal radials for verification. §73.316 requires submission of measured pattern vs. theoretical.' },
          { id: 'INVERSE_DISTANCE_FIELD', label: 'Inverse-distance field (IDF) at 1 km', rule: '47 CFR §73.154(b)', instrument: 'Derived from FI traverse measurements', notes: 'For each radial, plot field × distance vs. distance to extract IDF at 1 km.' },
          { id: 'MPE_NEAR_FIELD', label: 'RF exposure near-field boundary verification (OET-65)', rule: '47 CFR §1.1310 / OET Bulletin 65', instrument: 'Broadband RF field meter calibrated at MF', notes: 'Verify that the general-population MPE is not exceeded beyond the 61 m near-field boundary.' },
          { id: 'ANTENNA_EFFICIENCY', label: 'Antenna radiation efficiency calculation (§73.190)', rule: '47 CFR §73.190', instrument: 'Derived from IDF + base impedance measurements', notes: 'Efficiency η = R_r / (R_r + R_g). For 120-radial system: target η ≥ 85%.' },
          { id: 'MONITOR_POINT', label: 'DA monitor point measurement (§73.158 / §73.62)', rule: '47 CFR §73.158 / §73.62', instrument: 'Calibrated FI meter at FCC-specified monitor point location', notes: 'Clear channel Class D with DA-N pattern: the authorized DA monitor point must be measured at reference field.' }
        ],
        nda_radial_plan: null,
        filing_trigger: 'FCC Form 302-AM (license to cover) must be filed within 3 years of CP grant date (§73.3534). Proof measurements must be complete before 302-AM is submitted.',
        reference: '47 CFR §73.154 (proof of performance); §73.190 (antenna efficiency); §73.316 (DA pattern measurements); OET Bulletin 65.',
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
      da_gain_potential: { applicable: false, reason: 'Already ≥100% NDA COL coverage — DA not needed for §73.24(j)' },
      directional_antenna_study_guide: {
        recommended: true,
        primary_reason: 'CLEAR_CHANNEL_SECONDARY_NIGHTTIME',
        study_type: 'DA_N_NIGHTTIME_ONLY',
        triggers: [
          { trigger: 'CLEAR_CHANNEL_SECONDARY_NIGHTTIME', detail: 'Secondary Class D on clear channel 780 kHz — DA-N required at night to protect WJR Class A skywave contours.', cfr: '47 CFR §73.25 / §73.182' }
        ],
        key_constraints: [
          'DA-N pattern must protect Class A dominant\'s 0.5 mV/m and 25 µV/m contours.',
          '§73.316: horizontal pattern filed in 5° increments (72 tabulated values + 0°).',
          'Typical AM DA array: 2–4 tower elements; ground system must be extended to all towers.'
        ],
        pattern_radials_required: 72, additional_engineering_weeks_min: 8, additional_engineering_weeks_max: 16,
        note: 'Commission a DA N NIGHTTIME ONLY study before filing.', rule: '47 CFR §73.150 / §73.316'
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
          { item: 'DA_ENGINEERING', label: 'DA-N pattern modeling & §73.316 filing', cost_low_usd: 12000, cost_high_usd: 30000 },
          { item: 'RF_EXPOSURE_STUDY', label: 'RF MPE evaluation (OET Bulletin 65)', cost_low_usd: 2000, cost_high_usd: 4000 },
          { item: 'FCC_COUNSEL', label: 'Communications counsel (FCC filing oversight)', cost_low_usd: 8000, cost_high_usd: 20000 }
        ],
        note: 'Soft-cost estimate only. 2024 USD.'
      },
      signal_propagation_profile: {
        frequency_khz: 780, tpo_kw: 5, sigma_msm: 6,
        contours: [
          { id: 'DAYTIME_5MVM',    label: '5 mV/m (city-grade / §73.24(j) COL floor)',   target_mvm: 5.0,    distance_km: 6.7,  area_km2: 141.0 },
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
        ranking_rationale: 'Conductivity wins offset lower coverage; §73.24(j) COL coverage 78% is below 80% floor — increase TPO to ≥8.5 kW to fix.'
      },
      status_labels: ['NON-COMPLIANT', 'ENGINEER REVIEW REQUIRED'],
      status_category: 'RECOVERABLE_WITH_POWER_INCREASE',
      blanket_pop_risk: 'OK', col_coverage_gap_pct: 0.02, population_delta_vs_baseline: -1500,
      regulatory_compliance_summary: {
        col_coverage: { status: 'FAIL',  value: 0.78, threshold: 0.80, rule: '47 CFR §73.24(j)' },
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
        { id: 'COL_COVERAGE_REMEDY', priority: 'REQUIRED', label: 'COL coverage remedy engineering', note: '78% COL coverage < §73.24(j) 80% floor. Increase TPO to ≥8.5 kW or design DA pattern (§73.150) to push coverage above floor.' }
      ],
      regulatory_risk_score: {
        risk_score: 45, risk_category: 'HIGH',
        risk_factors: [
          { factor: 'ASR_REQUIRED', points: 15, note: 'λ/4 ≈ 96 m at 780 kHz exceeds 60.96 m §17.7 threshold: FAA 7460-1 + FCC Form 854 required' },
          { factor: 'MODERATE_CONDUCTIVITY', points: 5, note: 'σ=10 mS/m (EXCELLENT): standard 120-radial system adequate but soil survey still required' },
          { factor: 'COL_COVERAGE_FAILS', points: 10, note: 'COL coverage 78% < §73.24(j) 80% floor (gap 2%): coverage remedy required before filing' },
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
        recommendation: 'DA pattern likely recovers §73.24(j) compliance — commission §73.150 DA study toward COL bearing',
        rule: '47 CFR §73.150 / §73.24(j)'
      },
      directional_antenna_study_guide: {
        recommended: true,
        primary_reason: 'COL_COVERAGE_GAP',
        study_type: 'FULL_DA_STUDY_DAY_NIGHT',
        triggers: [
          { trigger: 'COL_COVERAGE_GAP', detail: 'NDA coverage 78% < §73.24(j) 80% floor. DA with max ERP toward COL centroid bearing can recover compliance.', cfr: '47 CFR §73.150 / §73.24(j)' },
          { trigger: 'CLEAR_CHANNEL_SECONDARY_NIGHTTIME', detail: 'Secondary Class D on clear channel 780 kHz — DA-N also required at night.', cfr: '47 CFR §73.25 / §73.182' }
        ],
        key_constraints: [
          'Maximize ERP toward COL centroid bearing (§73.24(j) ≥80% coverage goal).',
          'DA-N pattern must protect Class A dominant\'s 0.5 mV/m and 25 µV/m contours.',
          '§73.316: horizontal pattern filed in 5° increments (72 tabulated values + 0°).',
          'Typical AM DA array: 2–4 tower elements; ground system must be extended to all towers.'
        ],
        pattern_radials_required: 72, additional_engineering_weeks_min: 16, additional_engineering_weeks_max: 32,
        note: 'Commission a FULL DA STUDY DAY NIGHT before filing. Adds 16–32 weeks to engineering timeline.', rule: '47 CFR §73.150 / §73.316'
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
          { item: 'DA_ENGINEERING', label: 'FULL DA STUDY DAY+NIGHT pattern modeling & §73.316 filing', cost_low_usd: 18000, cost_high_usd: 40000 },
          { item: 'RF_EXPOSURE_STUDY', label: 'RF MPE evaluation at upgraded power (OET Bulletin 65)', cost_low_usd: 2500, cost_high_usd: 5000 },
          { item: 'FCC_COUNSEL', label: 'Communications counsel (FCC filing oversight)', cost_low_usd: 10000, cost_high_usd: 22000 }
        ],
        note: 'Soft-cost estimate only. NIF and DA costs elevated by power upgrade to 8.5 kW. 2024 USD.'
      },
      signal_propagation_profile: {
        frequency_khz: 780, tpo_kw: 8.5, sigma_msm: 4,
        contours: [
          { id: 'DAYTIME_5MVM',    label: '5 mV/m (city-grade / §73.24(j) COL floor)',   target_mvm: 5.0,    distance_km: 7.5,  area_km2: 176.7 },
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
          { factor: 'COL_COVERAGE_FAILS', points: 20, note: 'COL coverage 62% < §73.24(j) 80% floor (gap 18%): coverage remedy required before filing' },
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
        recommendation: 'DA pattern likely recovers §73.24(j) compliance — commission §73.150 DA study toward COL bearing',
        rule: '47 CFR §73.150 / §73.24(j)'
      },
      directional_antenna_study_guide: {
        recommended: true,
        primary_reason: 'COL_COVERAGE_GAP',
        study_type: 'FULL_DA_STUDY_DAY_NIGHT',
        triggers: [
          { trigger: 'COL_COVERAGE_GAP', detail: 'NDA coverage 62% < §73.24(j) 80% floor. DA with max ERP toward COL centroid bearing can recover compliance.', cfr: '47 CFR §73.150 / §73.24(j)' },
          { trigger: 'BLANKET_POP_SUPPRESSION', detail: 'Blanket pop 1.1% exceeding §73.24(g) 1% limit. DA must also null the 1000 mV/m lobe away from population centers.', cfr: '47 CFR §73.24(g) / §73.150' },
          { trigger: 'TREATY_CONSTRAINT', detail: 'Within US-MX treaty zone. DA likely required to reduce power toward the border.', cfr: '1986 US/Mexico AM Agreement' },
          { trigger: 'CLEAR_CHANNEL_SECONDARY_NIGHTTIME', detail: 'Secondary Class D on clear channel 780 kHz — DA-N required at night.', cfr: '47 CFR §73.25 / §73.182' }
        ],
        key_constraints: [
          'Maximize ERP toward COL centroid bearing (§73.24(j) ≥80% coverage goal).',
          'Null 1000 mV/m contour away from populated areas (§73.24(g) ≤1% blanket limit).',
          'Reduce power toward US-MX border for binational coordination.',
          'DA-N pattern must protect Class A dominant\'s 0.5 mV/m and 25 µV/m contours.',
          '§73.316: horizontal pattern filed in 5° increments (72 tabulated values + 0°).'
        ],
        pattern_radials_required: 72, additional_engineering_weeks_min: 16, additional_engineering_weeks_max: 32,
        note: 'Commission a FULL DA STUDY DAY NIGHT before filing. Multiple competing constraints — expect 16–32 weeks additional DA engineering.', rule: '47 CFR §73.150 / §73.316'
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
          { id: 'DAYTIME_5MVM',    label: '5 mV/m (city-grade / §73.24(j) COL floor)',   target_mvm: 5.0,    distance_km: 5.4,  area_km2: 91.6 },
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
