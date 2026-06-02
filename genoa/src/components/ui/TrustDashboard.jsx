import React, { useState } from 'react';

// Trust Dashboard — /debug/trust
// Paste an exhibit JSON and get a live trust assessment:
// quality score · readiness · engineer review summary · reasoning conclusions · field conflicts

const MONO = { fontFamily: 'monospace' };

const DET_COLOR = {
  READY:     '#43a85a',
  REVIEW:    '#d6a36a',
  NOT_READY: '#e55',
};

function Badge({ color, label }){
  return (
    <span style={{
      background: color + '22', color, border: `1px solid ${color}44`,
      borderRadius: 3, padding: '1px 6px', fontSize: 10,
      ...MONO, letterSpacing: '0.08em', textTransform: 'uppercase', whiteSpace: 'nowrap'
    }}>{label}</span>
  );
}

function ScoreRing({ score }){
  const color = score >= 70 ? '#43a85a' : score >= 40 ? '#d6a36a' : '#e55';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
      <div style={{ fontSize: 36, fontWeight: 700, color, ...MONO }}>{score}</div>
      <div style={{ fontSize: 10, color: '#666', ...MONO }}>/ 100</div>
    </div>
  );
}

function CategoryBar({ name, score, max }){
  const pct = max > 0 ? (score / max) * 100 : 0;
  const color = pct >= 80 ? '#43a85a' : pct >= 50 ? '#d6a36a' : '#e55';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
      <div style={{ width: 120, fontSize: 10, color: '#888', ...MONO, textAlign: 'right' }}>{name}</div>
      <div style={{ flex: 1, height: 6, background: '#1e1e1e', borderRadius: 3 }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 3 }} />
      </div>
      <div style={{ width: 40, fontSize: 10, color, ...MONO }}>{score}/{max}</div>
    </div>
  );
}

function Section({ title, children }){
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 10, color: '#555', letterSpacing: '0.1em', textTransform: 'uppercase', ...MONO, marginBottom: 8, borderBottom: '1px solid #1a1a1a', paddingBottom: 4 }}>
        {title}
      </div>
      {children}
    </div>
  );
}

function EngineerReviewText({ text }){
  if (!text) return null;
  const lines = text.split('\n');
  return (
    <pre style={{ ...MONO, fontSize: 11, color: '#ccc', background: '#111', padding: '10px 14px', borderRadius: 4, border: '1px solid #1e1e1e', whiteSpace: 'pre-wrap', margin: 0 }}>
      {lines.map((line, i) => {
        const color = line.startsWith('[X]') ? '#e55' : line.startsWith('[!]') ? '#f90' : line.startsWith('[i]') ? '#5a9ec4' : '#ccc';
        return <span key={i} style={{ color }}>{line}{'\n'}</span>;
      })}
    </pre>
  );
}

function ConflictRow({ c }){
  return (
    <div style={{ padding: '6px 0', borderBottom: '1px solid #1a1a1a', fontSize: 11, ...MONO }}>
      <span style={{ color: '#f90', fontWeight: 700 }}>{c.field}</span>
      <span style={{ color: '#666', marginLeft: 8 }}>{c.label}</span>
      <span style={{ color: '#888', marginLeft: 8 }}>→ winner: <span style={{ color: '#ccc' }}>{c.winning_source}</span></span>
    </div>
  );
}

function ConclusionRow({ c }){
  const color = c.result === 'PASS' ? '#43a85a' : c.result === 'FAIL' ? '#e55' : '#d6a36a';
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '5px 0', borderBottom: '1px solid #1a1a1a', fontSize: 11, ...MONO }}>
      <Badge color={color} label={c.result} />
      <div>
        <div style={{ color: '#ccc' }}>{c.id}</div>
        {c.rule && <div style={{ fontSize: 10, color: '#888', marginTop: 2 }}>{c.rule}</div>}
        {c.detail && <div style={{ fontSize: 10, color: '#666', marginTop: 2 }}>{c.detail}</div>}
      </div>
    </div>
  );
}

// ── Adversarial Review UI ──────────────────────────────────────────────────────

const RISK_COLOR = { HIGH: '#e55', MEDIUM: '#f90', LOW: '#d6a36a', MINIMAL: '#43a85a', UNKNOWN: '#666' };
const SEV_COLOR  = { CRITICAL: '#e55', HIGH: '#f66', MEDIUM: '#f90', LOW: '#d6a36a' };

function ChallengePoint({ cp, index }){
  const [open, setOpen] = React.useState(false);
  const sc = SEV_COLOR[cp.severity] || '#888';
  return (
    <div style={{ marginBottom: 6, border: `1px solid ${sc}22`, borderRadius: 4, background: '#0f0f0f' }}>
      <div
        onClick={() => setOpen(!open)}
        style={{ display: 'flex', gap: 10, padding: '7px 10px', cursor: 'pointer', alignItems: 'flex-start' }}
      >
        <Badge color={sc} label={cp.severity} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 11, color: '#ccc', marginBottom: 2 }}>{cp.reviewer_question}</div>
          <div style={{ fontSize: 9, color: '#555', ...MONO }}>{cp.category}{cp.rule ? ` · ${cp.rule}` : ''}</div>
        </div>
        <span style={{ color: '#555', fontSize: 10 }}>{open ? '▲' : '▼'}</span>
      </div>
      {open && (
        <div style={{ padding: '0 10px 10px', fontSize: 10, ...MONO, borderTop: `1px solid ${sc}18` }}>
          <div style={{ marginBottom: 6, color: '#aaa', lineHeight: 1.6 }}>
            <strong style={{ color: '#888' }}>Why it matters:</strong> {cp.why_it_matters}
          </div>
          {cp.current_evidence && (
            <div style={{ marginBottom: 4 }}>
              <strong style={{ color: '#666' }}>Current evidence:</strong>{' '}
              <span style={{ color: '#888' }}>{cp.current_evidence}</span>
            </div>
          )}
          <div style={{ marginBottom: 4 }}>
            <strong style={{ color: '#666' }}>Gap:</strong>{' '}
            <span style={{ color: '#d6a36a' }}>{cp.gap}</span>
          </div>
          <div>
            <strong style={{ color: '#43a85a' }}>Recommended fix:</strong>{' '}
            <span style={{ color: '#ccc' }}>{cp.recommended_fix}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function AdversarialReviewSection({ review }){
  if (!review) return null;
  const riskColor = RISK_COLOR[review.overall_risk] || '#888';
  const cps       = review.challenge_points || [];
  const critCount = cps.filter(cp => cp.severity === 'CRITICAL').length;
  const highCount = cps.filter(cp => cp.severity === 'HIGH').length;
  const actions   = review.recommended_engineer_actions || [];

  return (
    <div style={{ marginTop: 24 }}>
      {/* header bar */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 12, padding: '8px 12px', background: '#0f0f0f', borderRadius: 4, border: '1px solid #1a1a1a' }}>
        <span style={{ fontSize: 11, color: '#888', ...MONO, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
          Adversarial Review
        </span>
        <Badge color={riskColor} label={`${review.overall_risk} RISK`} />
        {critCount > 0 && <Badge color="#e55" label={`${critCount} CRITICAL`} />}
        {highCount > 0 && <Badge color="#f66" label={`${highCount} HIGH`} />}
        <span style={{ marginLeft: 'auto', fontSize: 10, color: '#555', ...MONO }}>{cps.length} challenge points</span>
      </div>

      {/* reviewer questions */}
      {review.questions_reviewer_may_ask?.length > 0 && (
        <Section title={`Reviewer Questions (${review.questions_reviewer_may_ask.length})`}>
          {review.questions_reviewer_may_ask.map((q, i) => (
            <div key={i} style={{ fontSize: 11, color: '#a0c8f0', marginBottom: 5, paddingLeft: 8, borderLeft: '2px solid #1a3a5a', lineHeight: 1.5 }}>
              {i + 1}. {q}
            </div>
          ))}
        </Section>
      )}

      {/* challenge points (expandable) */}
      {cps.length > 0 && (
        <Section title={`Challenge Points (${cps.length})`}>
          {cps.map((cp, i) => <ChallengePoint key={i} cp={cp} index={i} />)}
        </Section>
      )}

      {/* recommended actions */}
      {actions.length > 0 && (
        <Section title={`Recommended Engineer Actions (${actions.length})`}>
          {actions.map((a, i) => (
            <div key={i} style={{ fontSize: 11, color: '#43a85a', marginBottom: 5, paddingLeft: 8, borderLeft: '2px solid #1a3a1a', lineHeight: 1.5 }}>
              {i + 1}. {a}
            </div>
          ))}
        </Section>
      )}
    </div>
  );
}

export default function TrustDashboard({ onNavigate }){
  const [raw,          setRaw]          = useState('');
  const [exhibit,      setExhibit]      = useState(null);
  const [auditPackage, setAuditPackage] = useState(null);
  const [auditScore,   setAuditScore]   = useState(null);
  const [adversarial,  setAdversarial]  = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState(null);
  const [result, setResult]   = useState(null);
  const [parseErr, setParseErr] = useState('');

  async function handleRun(){
    setParseErr('');
    setError(null);
    let exhibit;
    try {
      const parsed = JSON.parse(raw.trim());
      exhibit = parsed?.station_inputs ? parsed : parsed?.exhibit || parsed;
    } catch (e){
      setParseErr(`JSON parse error: ${e.message}`);
      return;
    }
    setExhibit(exhibit);
    setLoading(true);
    setAuditPackage(null);
    setAuditScore(null);
    setAdversarial(null);
    try {
      // Step 1: POST /api/exhibits/audit-package → auditPackage
      const pkgRes = await fetch('/api/exhibits/audit-package', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ exhibit })
      });
      if (!pkgRes.ok) throw new Error(`audit-package: ${pkgRes.status}`);
      const pkg = await pkgRes.json();
      setAuditPackage(pkg);

      // Step 2: POST /api/exhibits/audit-score → auditScore
      const scoreRes = await fetch('/api/exhibits/audit-score', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ exhibit })
      });
      if (!scoreRes.ok) throw new Error(`audit-score: ${scoreRes.status}`);
      const score = await scoreRes.json();
      setAuditScore(score);

      // Step 3: POST /api/exhibits/adversarial-review → adversarial
      const advRes = await fetch('/api/exhibits/adversarial-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ exhibit })
      });
      if (advRes.ok) {
        const adv = await advRes.json();
        setAdversarial(adv.adversarial_review || null);
      }

      // Build engineer review text client-side from readiness sections
      const readiness = pkg.readiness || {};
      const det = readiness.determination || '—';
      const rscore = readiness.readiness_score ?? readiness.score ?? 0;
      const station = exhibit?.station_inputs || {};
      const header = station.call
        ? `${station.call} · ${station.service || ''} ${station.frequency ? station.frequency : ''} · ${det} · Readiness: ${rscore}/100`
        : `${det} · Readiness: ${rscore}/100`;
      const RULE = '─'.repeat(44);
      const lines = [header, ''];
      const blockers = readiness.blockers || [];
      lines.push(`BLOCKERS ${RULE}`);
      if (blockers.length === 0) lines.push('(none)');
      else blockers.forEach(b => lines.push(`[X] ${b.rule ? b.rule + ': ' : ''}${b.message}`));
      const warnings = readiness.warnings || [];
      lines.push('', `WARNINGS ${RULE}`);
      if (warnings.length === 0) lines.push('(none)');
      else warnings.forEach(w => lines.push(`[!] ${w.message}`));
      const advisories = readiness.advisories || [];
      lines.push('', `ADVISORIES ${RULE}`);
      if (advisories.length === 0) lines.push('(none)');
      else advisories.forEach(a => lines.push(`[i] ${a.message}`));
      const reviewText = lines.join('\n');
      setResult({ score, pkg, reviewText, determination: det, rscore });
    } catch (e){
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  const s   = result?.score;
  const pkg = result?.pkg || auditPackage;

  // Derive summary stats for the summary bar
  const _readiness  = pkg?.readiness || {};
  const _conflicts  = pkg?.conflicts || [];
  const _reasoning  = pkg?.reasoning || {};
  const _lineage    = pkg?.lineage   || {};
  const _det        = _readiness.determination || (result?.determination) || '—';
  const _detColor   = DET_COLOR[_det] || '#888';
  const _trustScore = auditScore?.score ?? s?.score ?? _readiness.readiness_score ?? '—';
  const _blockers   = (_readiness.blockers || []).length;
  const _conclusions = (_reasoning.conclusions || []).length;
  const _fields     = (_lineage.fields || []).length;

  return (
    <div style={{ minHeight: '100vh', background: '#0d0d0d', ...MONO, color: '#ccc' }}>
      {/* header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', background: '#0a0a0a', borderBottom: '1px solid #1e1e1e' }}>
        <button
          onClick={() => onNavigate && onNavigate('/')}
          style={{ background: 'none', border: '1px solid #333', color: '#888', borderRadius: 3, padding: '3px 10px', cursor: 'pointer', fontSize: 11, ...MONO }}
        >← Back to Workbench</button>
        <span style={{ fontSize: 12, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#888' }}>
          Trust Dashboard · /debug/trust
        </span>
        <button
          onClick={() => onNavigate && onNavigate('/debug/lineage')}
          style={{ marginLeft: 'auto', background: 'none', border: '1px solid #2a2a2a', color: '#666', borderRadius: 3, padding: '3px 10px', cursor: 'pointer', fontSize: 10, ...MONO }}
        >Field Lineage →</button>
      </div>

      {/* input zone */}
      <div style={{ padding: '12px 16px', borderBottom: '1px solid #1a1a1a' }}>
        <div style={{ fontSize: 10, color: '#666', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          Paste exhibit JSON (or <code style={{ color: '#888' }}>{'{ exhibit: {...} }'}</code>)
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <textarea
            rows={4}
            value={raw}
            onChange={e => setRaw(e.target.value)}
            placeholder='{"station_inputs":{"call":"WJPZ","service":"FM",...}}'
            style={{
              flex: 1, background: '#111', border: '1px solid #2a2a2a', color: '#ccc',
              borderRadius: 3, padding: '6px 10px', fontSize: 11, ...MONO, resize: 'vertical'
            }}
          />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <button
              onClick={handleRun}
              disabled={loading || !raw.trim()}
              style={{ background: '#1a3a1a', border: '1px solid #2a4a2a', color: loading ? '#555' : '#43a85a', borderRadius: 3, padding: '6px 16px', cursor: loading ? 'not-allowed' : 'pointer', fontSize: 11, ...MONO }}
            >{loading ? 'Running…' : 'Run Trust Audit'}</button>
            <button
              onClick={() => { setRaw(''); setResult(null); setError(null); setParseErr(''); }}
              style={{ background: 'none', border: '1px solid #2a2a2a', color: '#666', borderRadius: 3, padding: '6px 16px', cursor: 'pointer', fontSize: 11, ...MONO }}
            >Clear</button>
          </div>
        </div>
        {parseErr && <div style={{ marginTop: 6, color: '#e55', fontSize: 11 }}>{parseErr}</div>}
        {error   && <div style={{ marginTop: 6, color: '#e55', fontSize: 11 }}>Error: {error}</div>}
      </div>

      {/* Summary bar — visible once any data is loaded */}
      {(result || auditPackage) && (
        <div style={{ display: 'flex', gap: 16, padding: '12px 16px', background: '#0f0f0f', borderBottom: '1px solid #222', flexWrap: 'wrap', alignItems: 'center', ...MONO }}>
          {/* Trust Score */}
          <div style={{ textAlign: 'center', minWidth: 90 }}>
            <div style={{ fontSize: 28, fontWeight: 700, color: '#f3c86d', lineHeight: 1 }}>{_trustScore}<span style={{ fontSize: 14, color: '#666' }}>/100</span></div>
            <div style={{ fontSize: 9, color: '#666', marginTop: 3, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Trust Score</div>
          </div>
          <div style={{ width: 1, background: '#222', alignSelf: 'stretch' }} />
          {/* Filing Status */}
          <div style={{ textAlign: 'center', minWidth: 80 }}>
            <div style={{ marginBottom: 4 }}><Badge color={_detColor} label={_det} /></div>
            <div style={{ fontSize: 9, color: '#666', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Filing Status</div>
          </div>
          <div style={{ width: 1, background: '#222', alignSelf: 'stretch' }} />
          {/* Blockers */}
          <div style={{ textAlign: 'center', minWidth: 60 }}>
            <div style={{ fontSize: 22, fontWeight: 700, color: _blockers > 0 ? '#e55' : '#43a85a' }}>{_blockers}</div>
            <div style={{ fontSize: 9, color: '#666', marginTop: 2, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Blockers</div>
          </div>
          <div style={{ width: 1, background: '#222', alignSelf: 'stretch' }} />
          {/* Conflicts */}
          <div style={{ textAlign: 'center', minWidth: 60 }}>
            <div style={{ fontSize: 22, fontWeight: 700, color: _conflicts.length > 0 ? '#f90' : '#43a85a' }}>{_conflicts.length}</div>
            <div style={{ fontSize: 9, color: '#666', marginTop: 2, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Conflicts</div>
          </div>
          <div style={{ width: 1, background: '#222', alignSelf: 'stretch' }} />
          {/* Reasoning Coverage */}
          <div style={{ textAlign: 'center', minWidth: 80 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#a0c8f0' }}>{_conclusions} conclusions</div>
            <div style={{ fontSize: 9, color: '#666', marginTop: 2, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Reasoning Coverage</div>
          </div>
          <div style={{ width: 1, background: '#222', alignSelf: 'stretch' }} />
          {/* Lineage Fields */}
          <div style={{ textAlign: 'center', minWidth: 80 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#a0c8f0' }}>{_fields} fields</div>
            <div style={{ fontSize: 9, color: '#666', marginTop: 2, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Lineage Fields</div>
          </div>
        </div>
      )}

      {/* results */}
      {result && (
        <div style={{ padding: '16px' }}>

          {/* score + determination row */}
          <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start', marginBottom: 20, flexWrap: 'wrap' }}>
            <div style={{ background: '#111', border: '1px solid #1e1e1e', borderRadius: 6, padding: '16px 24px', minWidth: 120, textAlign: 'center' }}>
              <div style={{ fontSize: 10, color: '#555', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Quality Score</div>
              <ScoreRing score={s?.score ?? 0} />
            </div>

            {result?.determination && (
              <div style={{ background: '#111', border: '1px solid #1e1e1e', borderRadius: 6, padding: '16px 24px', minWidth: 200 }}>
                <div style={{ fontSize: 10, color: '#555', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Determination</div>
                <Badge
                  color={DET_COLOR[result.determination] || '#666'}
                  label={result.determination}
                />
                <div style={{ marginTop: 8, fontSize: 11, color: '#888' }}>
                  Readiness: <span style={{ color: '#ccc' }}>{result.rscore ?? '—'}/100</span>
                </div>
              </div>
            )}

            {/* category bars */}
            {s?.categories && (
              <div style={{ flex: 1, background: '#111', border: '1px solid #1e1e1e', borderRadius: 6, padding: '16px' }}>
                <div style={{ fontSize: 10, color: '#555', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Score Breakdown</div>
                {Object.entries(s.categories).map(([name, cat]) => (
                  <CategoryBar key={name} name={name} score={cat.score} max={cat.max} />
                ))}
              </div>
            )}
          </div>

          {/* Readiness section — BLOCKERS / WARNINGS / ADVISORIES with icons */}
          {result?.reviewText && (
            <Section title="Readiness — Blockers / Warnings / Advisories">
              <EngineerReviewText text={result.reviewText} />
            </Section>
          )}

          {/* reasoning conclusions — collapsible per conclusion */}
          {pkg?.reasoning?.conclusions?.length > 0 && (
            <Section title={`Reasoning (${pkg.reasoning.conclusions.length} conclusions)`}>
              {pkg.reasoning.conclusions.map((c, i) => {
                const resColor = c.result === 'PASS' ? '#43a85a' : c.result === 'FAIL' ? '#e55' : '#d6a36a';
                return (
                  <details key={i} style={{ marginBottom: 4, background: '#0f0f0f', border: '1px solid #1e1e1e', borderRadius: 3 }}>
                    <summary style={{ padding: '6px 10px', cursor: 'pointer', fontSize: 11, listStyle: 'none', display: 'flex', gap: 10, alignItems: 'center' }}>
                      <Badge color={resColor} label={c.result} />
                      <span style={{ color: '#ccc' }}>{c.id}</span>
                      {c.rule && <span style={{ color: '#5a9ec4', fontSize: 10 }}>{c.rule}</span>}
                      {c.confidence && <Badge color={c.confidence === 'HIGH' ? '#43a85a' : '#d6a36a'} label={c.confidence} />}
                    </summary>
                    <div style={{ padding: '6px 14px 10px', fontSize: 10, color: '#aaa', borderTop: '1px solid #1a1a1a' }}>
                      {c.conclusion && <div style={{ marginBottom: 4, color: '#ccc' }}>{c.conclusion}</div>}
                      {c.required   && <div style={{ marginBottom: 4 }}><span style={{ color: '#666' }}>Required: </span>{c.required}</div>}
                      {c.source     && <div style={{ marginBottom: 4 }}><span style={{ color: '#666' }}>Source: </span><code style={{ color: '#5a9ec4' }}>{c.source}</code></div>}
                      {Array.isArray(c.evidence) && c.evidence.length > 0 && (
                        <div>
                          <div style={{ color: '#666', marginBottom: 3, fontSize: 9, textTransform: 'uppercase' }}>Evidence</div>
                          {c.evidence.map((ev, j) => (
                            <div key={j} style={{ display: 'flex', gap: 8, marginBottom: 2, paddingLeft: 8 }}>
                              <span style={{ color: '#555', minWidth: 160 }}>{ev.label}</span>
                              <span style={{ color: '#ddd' }}>{ev.value === null || ev.value === undefined ? '—' : String(typeof ev.value === 'object' ? JSON.stringify(ev.value) : ev.value)}</span>
                              <span style={{ color: '#444', fontSize: 9 }}>{ev.path}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </details>
                );
              })}
            </Section>
          )}

          {/* field conflicts */}
          {pkg?.conflicts && (
            <Section title={`Field Conflicts (${pkg.conflicts.length})`}>
              {pkg.conflicts.length === 0
                ? <div style={{ color: '#555', fontSize: 11 }}>No conflicts detected.</div>
                : pkg.conflicts.map((c, i) => (
                    <div key={i} style={{ padding: '6px 10px', borderBottom: '1px solid #1a1a1a', fontSize: 11, ...MONO }}>
                      <span style={{ color: '#f90', fontWeight: 700 }}>{c.field}</span>
                      {c.label && <span style={{ color: '#666', marginLeft: 8 }}>{c.label}</span>}
                      {(c.values || []).map((v, j) => (
                        <span key={j} style={{ color: '#888', marginLeft: 8 }}>{v.source_system}={JSON.stringify(v.value)}</span>
                      ))}
                      <span style={{ color: '#555', marginLeft: 8 }}>winner: <span style={{ color: '#ccc' }}>{c.winning_source}</span></span>
                    </div>
                  ))}
            </Section>
          )}

          {/* strengths / weaknesses */}
          {(s?.strengths?.length > 0 || s?.weaknesses?.length > 0) && (
            <Section title="Audit Findings">
              {s.strengths.map((str, i) => (
                <div key={i} style={{ fontSize: 11, color: '#43a85a', marginBottom: 3 }}>✓ {str}</div>
              ))}
              {s.weaknesses.map((w, i) => (
                <div key={i} style={{ fontSize: 11, color: '#e55', marginBottom: 3 }}>✗ {w}</div>
              ))}
            </Section>
          )}

          {/* missing items */}
          {s?.missing_items?.length > 0 && (
            <Section title={`Missing / Incomplete (${s.missing_items.length})`}>
              {s.missing_items.map((m, i) => (
                <div key={i} style={{ fontSize: 11, color: '#d6a36a', marginBottom: 3 }}>· {m}</div>
              ))}
            </Section>
          )}

          {/* ── Adversarial Review ─────────────────────────────────────── */}
          {adversarial && <AdversarialReviewSection review={adversarial} />}

        </div>
      )}

      {!result && !loading && (
        <div style={{ padding: 32, color: '#444', fontSize: 12 }}>
          Paste an exhibit JSON above and click <strong style={{ color: '#666' }}>Apply</strong> to assess filing readiness, quality score, and engineering conclusions.
        </div>
      )}
    </div>
  );
}
