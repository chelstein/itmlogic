import React from 'react';
import { stateColor, STATE_COLORS } from './format.js';

// CanonicalStatusBanner — compact status strip rendered at the top of the
// candidate detail drawer, driven ONLY by the canonical result pipeline
// (candidate.canonical).  Four cells:
//   1. screening confidence (confidence.engineeringDataConfidence)
//   2. filing readiness (ready / blocker count, expandable blocker list)
//   3. missing required studies (decisions required && completion NOT_RUN)
//   4. internal consistency (validation.consistent; amber technical
//      warning listing violated invariants when false)
//
// Every read is null-guarded: candidate.canonical may be entirely absent
// on older payloads, in which case the banner renders nothing.

const TIER_LABELS = {
  FILING_GRADE:      'FILING GRADE',
  ENGINEERING_GRADE: 'ENGINEERING GRADE',
  SCREENING:         'SCREENING',
  LOW:               'LOW',
};

function tierColor(tier) {
  if (tier === 'FILING_GRADE' || tier === 'ENGINEERING_GRADE') return STATE_COLORS.green;
  if (tier === 'SCREENING') return STATE_COLORS.blue;   // modeled / informational
  if (tier === 'LOW') return STATE_COLORS.amber;        // follow-up warranted
  return STATE_COLORS.gray;                             // unknown
}

function Cell({ label, color, value, children }) {
  return (
    <div className="min-w-0">
      <div className="font-mono text-[8px] uppercase tracking-rack text-textDim/70">{label}</div>
      <div className="font-mono text-[10px] uppercase tracking-rack" style={{ color }}>{value}</div>
      {children}
    </div>
  );
}

export default function CanonicalStatusBanner({ canonical }) {
  const [showBlockers, setShowBlockers] = React.useState(false);
  if (!canonical || typeof canonical !== 'object') return null;

  const conf = canonical.confidence || {};
  const engineering = conf.engineeringDataConfidence || null;
  // filingReadiness lives under confidence in the contract; some payloads
  // attach it at the top level — accept both.
  const readiness = conf.filingReadiness ?? canonical.filingReadiness ?? null;
  const validation = canonical.validation ?? null;
  const regulatory = (canonical.regulatory && typeof canonical.regulatory === 'object')
    ? canonical.regulatory : {};

  // Required studies that never ran.
  const missingStudies = Object.entries(regulatory)
    .filter(([, d]) => d && typeof d === 'object' && d.required === true && d.completion === 'NOT_RUN')
    .map(([name]) => name);

  // 1. Screening confidence
  const tier = engineering?.tier ?? null;
  const confValue = tier ? (TIER_LABELS[tier] ?? tier) : 'NOT EVALUATED';
  const confColor = tierColor(tier);

  // 2. Filing readiness
  const blockers = Array.isArray(readiness?.blockers) ? readiness.blockers : [];
  const ready = readiness?.ready === true;
  const readinessValue = readiness == null
    ? 'NOT EVALUATED'
    : ready ? 'READY' : `${blockers.length} BLOCKER${blockers.length === 1 ? '' : 'S'}`;
  const readinessColor = readiness == null
    ? stateColor(null)
    : ready ? stateColor('PASS') : stateColor('NOT_READY');

  // 3. Missing required studies
  const studiesValue = missingStudies.length === 0 ? 'NONE MISSING' : `${missingStudies.length} NOT RUN`;
  const studiesColor = missingStudies.length === 0
    ? (Object.keys(regulatory).length > 0 ? stateColor('PASS') : stateColor(null))
    : stateColor('REQUIRED');

  // 4. Internal consistency
  const consistent = validation?.consistent;
  const violations = Array.isArray(validation?.violations) ? validation.violations : [];
  const consistencyValue = consistent === true ? 'CONSISTENT'
    : consistent === false ? `${violations.length} VIOLATION${violations.length === 1 ? '' : 'S'}`
    : 'NOT EVALUATED';
  const consistencyColor = consistent === true ? stateColor('CONSISTENT')
    : consistent === false ? stateColor('WARN')
    : stateColor(null);

  return (
    <div className="rounded-sm border px-3 py-2" style={{ borderColor: 'rgba(168,156,132,0.35)', background: 'rgba(168,156,132,0.05)' }}>
      <div className="font-mono text-[8px] uppercase tracking-rack text-textDim/60 mb-1.5">
        Canonical result status
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2">
        <Cell label="Screening confidence" color={confColor} value={confValue}>
          {engineering?.limitedBy && (
            <div className="font-mono text-[8px] text-textDim/60 normal-case truncate" title={`Limited by ${engineering.limitedBy}`}>
              limited by {engineering.limitedBy}
            </div>
          )}
        </Cell>
        <Cell label="Filing readiness" color={readinessColor} value={readinessValue}>
          {blockers.length > 0 && (
            <button
              type="button"
              onClick={() => setShowBlockers(v => !v)}
              className="font-mono text-[8px] underline text-textDim hover:text-cream"
            >
              {showBlockers ? 'hide blockers' : 'show blockers'}
            </button>
          )}
        </Cell>
        <Cell label="Required studies" color={studiesColor} value={studiesValue} />
        <Cell label="Internal consistency" color={consistencyColor} value={consistencyValue} />
      </div>

      {showBlockers && blockers.length > 0 && (
        <ul className="mt-2 space-y-0.5 font-mono text-[9px] leading-snug list-none pl-0" style={{ color: STATE_COLORS.amber }}>
          {blockers.map((b, i) => (
            <li key={i}>· {String(b)}</li>
          ))}
        </ul>
      )}

      {missingStudies.length > 0 && (
        <div className="mt-1.5 font-mono text-[9px] leading-snug" style={{ color: STATE_COLORS.amber }}>
          Missing required studies: {missingStudies.join(', ')}
        </div>
      )}

      {consistent === false && (
        <div className="mt-1.5 rounded-sm border px-2 py-1.5"
          style={{ borderColor: 'rgba(255,179,71,0.45)', background: 'rgba(255,179,71,0.08)' }}>
          <div className="font-mono text-[9px] uppercase tracking-rack" style={{ color: STATE_COLORS.amber }}>
            ⚠ Technical warning — candidate result is internally inconsistent
          </div>
          <ul className="mt-1 space-y-0.5 font-mono text-[9px] leading-snug list-none pl-0 text-textDim">
            {violations.map((v, i) => (
              <li key={i} title={v?.detail ?? ''}>· {v?.invariant ?? String(v)}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
