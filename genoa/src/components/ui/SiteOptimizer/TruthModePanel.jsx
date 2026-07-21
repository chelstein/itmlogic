import React from 'react';
import pkg from '../../../../package.json';

// TruthModePanel — internal/developer-only diagnostic view
// (canonical-consistency-audit-followup, Phase 5).
//
// Makes it possible to trace any visible number on this candidate back to
// the calculation that produced it. READ-ONLY: this panel never lets a
// developer edit or override a canonical value from the UI, only inspect
// it -- there is no input, no dispatch, no mutation anywhere below.
//
// Gated behind ?debug=1 (checked by the caller, CandidateDetailDrawer.jsx,
// which only renders this component when that param is present) -- NOT
// visible in the normal candidate-review UI by default, since this is
// internal tooling, not a customer-facing feature.
//
// Every section below surfaces data that ALREADY EXISTS on the candidate;
// nothing here computes a new value. Where a category the spec asked for
// genuinely does not exist in this codebase (a build/engine version
// constant distinct from package.json; any provenance tracking beyond
// EngineeringValue/RegulatoryDecision's built-in source/rationale/
// inputsUsed fields), this panel says so explicitly rather than
// inventing one.

const mono = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' };

function Section({ title, subtitle, children }) {
  return (
    <div style={{ border: '1px solid #3a3a2e', borderRadius: 6, padding: '10px 12px', marginBottom: 10, background: '#14140f' }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#ffd166', textTransform: 'uppercase', letterSpacing: '0.06em', ...mono }}>
        {title}
      </div>
      {subtitle && (
        <div style={{ fontSize: 9, color: '#8a8a76', marginTop: 2, marginBottom: 6, ...mono }}>{subtitle}</div>
      )}
      <div style={{ marginTop: subtitle ? 0 : 6 }}>{children}</div>
    </div>
  );
}

/** Collapsible raw-JSON viewer -- read-only, no editing affordance. */
function JsonBlock({ value, defaultOpen = false }) {
  const [open, setOpen] = React.useState(defaultOpen);
  if (value === null || value === undefined) {
    return <span style={{ color: '#6b6b5e', fontSize: 10, ...mono }}>null</span>;
  }
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{ fontSize: 9, color: '#7ec8e3', background: 'none', border: '1px solid #2f4f5f', borderRadius: 3, padding: '1px 6px', cursor: 'pointer', ...mono }}
      >
        {open ? '▾ collapse' : '▸ expand raw JSON'}
      </button>
      {open && (
        <pre style={{
          fontSize: 9, lineHeight: 1.4, color: '#c8bfa8', background: '#0a0a08',
          border: '1px solid #2a2a20', borderRadius: 4, padding: 8, marginTop: 4,
          maxHeight: 320, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word', ...mono,
        }}>
          {JSON.stringify(value, null, 2)}
        </pre>
      )}
    </div>
  );
}

function KeyVal({ k, v }) {
  return (
    <div style={{ display: 'flex', gap: 8, fontSize: 10, padding: '1px 0', ...mono }}>
      <span style={{ color: '#8a8a76', minWidth: 160 }}>{k}</span>
      <span style={{ color: '#e2d9c5' }}>{typeof v === 'object' ? JSON.stringify(v) : String(v)}</span>
    </div>
  );
}

export default function TruthModePanel({ candidate, rankingDiagnostics }) {
  if (!candidate) return null;
  const canonical = candidate.canonical ?? null;

  const CANONICAL_SUBSECTIONS = [
    'regulatory', 'antenna', 'groundSystem', 'costs', 'schedule',
    'rfExposure', 'confidence', 'scoring', 'recommendation', 'validation',
  ];

  return (
    <div style={{ border: '2px dashed #ffd166', borderRadius: 8, padding: 12, marginBottom: 16, background: '#0d0d0a' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span style={{ fontSize: 12, fontWeight: 800, color: '#ffd166', textTransform: 'uppercase', letterSpacing: '0.08em', ...mono }}>
          ⚠ Developer Truth Mode
        </span>
        <span style={{ fontSize: 9, color: '#8a8a76', ...mono }}>
          Internal diagnostic view — READ-ONLY, not shown by default (?debug=1). Never customer-facing.
        </span>
      </div>

      <Section title="Build / schema version" subtitle="package.json version + canonical result schema tag — this repo has no separate engine/build-version constant beyond these.">
        <KeyVal k="package.json (name@version)" v={`${pkg.name}@${pkg.version}`} />
        <KeyVal k="canonical.schema" v={canonical?.schema ?? '(no canonical result attached)'} />
        <KeyVal k="canonical.source" v={canonical?.source ?? '(no canonical result attached)'} />
      </Section>

      <Section title="canonical.scenario" subtitle="OperatingScenario / AntennaDesignCategory labels (Phase 2) — a naming layer, not a new computation.">
        {canonical?.scenario ? (
          <>
            <KeyVal k="operatingScenario" v={canonical.scenario.operatingScenario} />
            <KeyVal k="operatingScenarioBasis" v={canonical.scenario.operatingScenarioBasis} />
            <KeyVal k="antennaDesignCategory" v={canonical.scenario.antennaDesignCategory} />
            <KeyVal k="antennaDesignCategoryBasis" v={canonical.scenario.antennaDesignCategoryBasis} />
            <KeyVal k="primaryScenarioLabel" v={canonical.scenario.primaryScenarioLabel} />
          </>
        ) : (
          <span style={{ fontSize: 10, color: '#ff7a7a', ...mono }}>canonical.scenario is absent on this candidate.</span>
        )}
      </Section>

      <Section title="ranking_diagnostics" subtitle="Computed once across the full scored set (Phase 3), not per-candidate -- see the response-level ranking_diagnostics field.">
        {rankingDiagnostics ? (
          <>
            <KeyVal k="rankingConfidence" v={rankingDiagnostics.rankingConfidence} />
            <KeyVal k="rankingConfidenceBasis" v={rankingDiagnostics.rankingConfidenceBasis} />
            <KeyVal k="evaluatedCandidates" v={rankingDiagnostics.evaluatedCandidates} />
            <KeyVal k="uniqueScores" v={rankingDiagnostics.uniqueScores} />
            <KeyVal k="topScoreTieCount" v={rankingDiagnostics.topScoreTieCount} />
            <KeyVal k="activeFeatures" v={rankingDiagnostics.activeFeatures} />
            <KeyVal k="zeroVarianceFeatures" v={rankingDiagnostics.zeroVarianceFeatures} />
            <div style={{ borderTop: '1px solid #2a2a20', marginTop: 6, paddingTop: 6 }}>
              <div style={{ fontSize: 9, color: '#8a8a76', marginBottom: 2, ...mono }}>This candidate's own tie fields (canonical/scoring.js):</div>
              <KeyVal k="tied_within_model_precision" v={candidate.tied_within_model_precision ?? null} />
              <KeyVal k="tie_group_size" v={candidate.tie_group_size ?? null} />
              <KeyVal k="scoring_display_label" v={candidate.scoring_display_label ?? null} />
            </div>
          </>
        ) : (
          <span style={{ fontSize: 10, color: '#ff7a7a', ...mono }}>ranking_diagnostics was not passed to this panel (response-level field — see SiteOptimizerApp's runSiteOptimizer() response).</span>
        )}
      </Section>

      <Section title="canonical.validation" subtitle="Invariant-consistency report attached by validateCandidateResult() -- the SAME report the recommendation/filingReadiness gates read.">
        {canonical?.validation ? (
          <>
            <KeyVal k="consistent" v={canonical.validation.consistent} />
            {canonical.validation.violations?.length > 0 ? (
              <div style={{ marginTop: 4 }}>
                {canonical.validation.violations.map((v, i) => (
                  <div key={i} style={{ fontSize: 10, color: '#ff7a7a', padding: '2px 0', ...mono }}>
                    [{v.invariant}] {v.detail} — fields: {Array.isArray(v.fields) ? v.fields.join(', ') : String(v.fields)}
                  </div>
                ))}
              </div>
            ) : (
              <span style={{ fontSize: 10, color: '#63d471', ...mono }}>No invariant violations.</span>
            )}
          </>
        ) : (
          <span style={{ fontSize: 10, color: '#ff7a7a', ...mono }}>canonical.validation is absent on this candidate.</span>
        )}
      </Section>

      <Section
        title="Provenance (source / rationale / inputsUsed / assumptions)"
        subtitle="EngineeringValues (ev()) carry source/confidence/assumptions; RegulatoryDecisions (decision()) carry rationale/blockers/ruleReferences/inputsUsed -- this IS the codebase's existing provenance mechanism (canonical/types.js). Nothing beyond this is tracked today (e.g. no per-run request ID or timestamped calculation log) -- that is a real, honestly-reported gap, not fabricated here."
      >
        {canonical?.regulatory ? (
          <div>
            {Object.entries(canonical.regulatory).map(([name, d]) => {
              const dec = d && typeof d === 'object' && 'state' in d ? d : (d?.decision ?? null);
              if (!dec) return null;
              return (
                <div key={name} style={{ borderBottom: '1px solid #2a2a20', padding: '4px 0' }}>
                  <div style={{ fontSize: 10, color: '#7ec8e3', fontWeight: 700, ...mono }}>{name}</div>
                  <KeyVal k="state" v={dec.state} />
                  <KeyVal k="required" v={dec.required} />
                  <KeyVal k="completion" v={dec.completion} />
                  <div style={{ fontSize: 9, color: '#a89c84', marginTop: 2, ...mono }}>rationale: {dec.rationale}</div>
                  {Array.isArray(dec.ruleReferences) && dec.ruleReferences.length > 0 && (
                    <div style={{ fontSize: 9, color: '#8a8a76', ...mono }}>rules: {dec.ruleReferences.join('; ')}</div>
                  )}
                  {Array.isArray(dec.blockers) && dec.blockers.length > 0 && (
                    <div style={{ fontSize: 9, color: '#ffb347', ...mono }}>blockers: {dec.blockers.join('; ')}</div>
                  )}
                  <JsonBlock value={dec.inputsUsed} />
                </div>
              );
            })}
          </div>
        ) : (
          <span style={{ fontSize: 10, color: '#ff7a7a', ...mono }}>canonical.regulatory is absent on this candidate.</span>
        )}
      </Section>

      <Section title="canonical.filingReadiness / recommendation">
        <KeyVal k="filingReadiness.ready" v={canonical?.filingReadiness?.ready ?? null} />
        <KeyVal k="filingReadiness.blockers" v={canonical?.filingReadiness?.blockers ?? null} />
        <KeyVal k="recommendation.level" v={canonical?.recommendation?.level ?? null} />
        <div style={{ fontSize: 9, color: '#a89c84', marginTop: 2, ...mono }}>rationale: {canonical?.recommendation?.rationale ?? '—'}</div>
        <JsonBlock value={canonical?.recommendation?.gatesApplied} />
      </Section>

      <Section title="Raw canonical sub-objects" subtitle="Every top-level canonical.* section, collapsed by default -- click to expand and inspect the exact EngineeringValues (value/unit/source/confidence/assumptions) behind any number shown elsewhere in this drawer.">
        {canonical ? (
          CANONICAL_SUBSECTIONS.map((key) => (
            <div key={key} style={{ padding: '3px 0' }}>
              <span style={{ fontSize: 10, color: '#7ec8e3', ...mono }}>canonical.{key}</span>
              {' '}
              <JsonBlock value={canonical[key]} />
            </div>
          ))
        ) : (
          <span style={{ fontSize: 10, color: '#ff7a7a', ...mono }}>No canonical result attached to this candidate at all.</span>
        )}
      </Section>

      <Section title="Full canonical object (unfiltered)">
        <JsonBlock value={canonical} />
      </Section>
    </div>
  );
}
