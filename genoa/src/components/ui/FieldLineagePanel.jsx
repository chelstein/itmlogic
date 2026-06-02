import React, { useEffect, useState } from 'react';

// Field Lineage Panel — tabular audit view of every filing field's
// provenance: value, status, source system, source path, confidence,
// blocking status, and validation result.
//
// Accepts an `exhibit` prop; when it changes, re-runs the lineage call.
// Handles null exhibit gracefully (shows prompt to compute first).

const STATUS_COLOR = {
  filled:           '#43a85a',
  FILLED:           '#43a85a',
  suggested:        '#5a9ec4',
  SUGGESTED:        '#5a9ec4',
  gap:              '#c4745a',
  NEEDS_INPUT:      '#c4745a',
  unknown:          '#d6a36a',
  EVIDENCE_MISSING: '#d6a36a',
  invalid:          '#e55',
  INVALID:          '#e55',
  conflict:         '#f90',
  CONFLICT:         '#f90',
  na:               '#666',
  NOT_APPLICABLE:   '#666'
};

const CONF_COLOR = {
  high:     '#43a85a',
  medium:   '#d6a36a',
  low:      '#c4745a',
  advisory: '#5a9ec4',
  unknown:  '#666'
};

function Badge({ color, label }){
  return (
    <span style={{
      background: color + '22',
      color,
      border: `1px solid ${color}44`,
      borderRadius: 3,
      padding: '1px 6px',
      fontSize: 10,
      fontFamily: 'monospace',
      letterSpacing: '0.08em',
      textTransform: 'uppercase',
      whiteSpace: 'nowrap'
    }}>{label}</span>
  );
}

function StatusBadge({ status }){
  const color = STATUS_COLOR[status] || '#666';
  const LABELS = {
    filled: 'FILLED', FILLED: 'FILLED',
    suggested: 'SUGGESTED', SUGGESTED: 'SUGGESTED',
    gap: 'NEEDS INPUT', NEEDS_INPUT: 'NEEDS INPUT',
    unknown: 'MISSING', EVIDENCE_MISSING: 'MISSING',
    invalid: 'INVALID', INVALID: 'INVALID',
    conflict: 'CONFLICT', CONFLICT: 'CONFLICT',
    na: 'N/A', NOT_APPLICABLE: 'N/A'
  };
  return <Badge color={color} label={LABELS[status] || status} />;
}

function ConfBadge({ confidence }){
  const color = CONF_COLOR[confidence] || '#666';
  return <Badge color={color} label={String(confidence || 'unknown').toUpperCase()} />;
}

function ValidBadge({ result }){
  const { valid, reason } = result || {};
  const color = valid ? '#43a85a' : '#e55';
  return (
    <span title={reason || ''} style={{ cursor: reason ? 'help' : 'default' }}>
      <Badge color={color} label={valid ? 'PASS' : 'FAIL'} />
    </span>
  );
}

const TH_STYLE = {
  padding: '4px 10px',
  textAlign: 'left',
  fontSize: 10,
  letterSpacing: '0.1em',
  color: '#888',
  borderBottom: '1px solid #333',
  whiteSpace: 'nowrap',
  fontFamily: 'monospace'
};

const TD_STYLE = {
  padding: '5px 10px',
  fontSize: 11,
  fontFamily: 'monospace',
  borderBottom: '1px solid #1e1e1e',
  verticalAlign: 'top',
  maxWidth: 260,
  wordBreak: 'break-all'
};

function Row({ f }){
  const [expanded, setExpanded] = useState(false);
  const isBlocking = f.blocking === true;
  const rowBg = isBlocking ? '#2a0d0d' : expanded ? '#181818' : 'transparent';

  return (
    <>
      <tr
        onClick={() => setExpanded(!expanded)}
        style={{ background: rowBg, cursor: 'pointer' }}
        title="Click to expand provenance"
      >
        <td style={{ ...TD_STYLE, maxWidth: 200 }}>
          <div style={{ fontWeight: isBlocking ? 700 : 400, color: isBlocking ? '#f66' : '#ccc' }}>
            {f.lms_label}
          </div>
          <div style={{ fontSize: 9, color: '#555', marginTop: 2 }}>{f.id}</div>
        </td>
        <td style={{ ...TD_STYLE, maxWidth: 140 }}>
          {f.value === null || f.value === undefined
            ? <span style={{ color: '#555' }}>—</span>
            : <span style={{ color: '#e0e0e0' }}>{typeof f.value === 'object' ? JSON.stringify(f.value) : String(f.value)}</span>}
        </td>
        <td style={TD_STYLE}><StatusBadge status={f.status} /></td>
        <td style={{ ...TD_STYLE, maxWidth: 120 }}>
          <span style={{ color: '#a0c8f0' }}>{f.source_system || '—'}</span>
        </td>
        <td style={{ ...TD_STYLE, maxWidth: 240 }}>
          <span style={{ color: '#888', fontSize: 10 }}>{f.source_path || '—'}</span>
        </td>
        <td style={TD_STYLE}><ConfBadge confidence={f.confidence} /></td>
        <td style={TD_STYLE}>
          {f.blocking
            ? <Badge color="#e55" label="YES" />
            : <Badge color="#43a85a" label="NO" />}
        </td>
        <td style={TD_STYLE}>
          {f.validation_result
            ? <ValidBadge result={f.validation_result} />
            : <span style={{ color: '#555' }}>—</span>}
        </td>
      </tr>
      {expanded && (
        <tr style={{ background: '#141414' }}>
          <td colSpan={8} style={{ padding: '6px 16px 10px', fontSize: 10, fontFamily: 'monospace', color: '#999', borderBottom: '1px solid #222' }}>
            {f.invalid_reason && (
              <div style={{ color: '#e55', marginBottom: 4 }}>
                <strong style={{ color: '#f88' }}>Invalid reason:</strong> {f.invalid_reason}
              </div>
            )}
            {f.expected_source && (
              <div style={{ marginBottom: 4 }}>
                <strong style={{ color: '#ccc' }}>Expected source:</strong> {f.expected_source}
              </div>
            )}
            {f.conflict_values && (
              <div style={{ marginBottom: 4 }}>
                <strong style={{ color: '#f90' }}>Conflict:</strong>{' '}
                {f.conflict_values.map((cv, i) => (
                  <span key={i}>{cv.path}: {JSON.stringify(cv.value)} ({cv.source_system}){i < f.conflict_values.length - 1 ? ' vs ' : ''}</span>
                ))}
              </div>
            )}
            {f.provenance && (
              <div>
                <strong style={{ color: '#ccc' }}>Provenance:</strong>{' '}
                {Object.entries(f.provenance).filter(([,v]) => v != null).map(([k,v]) => `${k}: ${v}`).join(' · ')}
              </div>
            )}
            {f.notes && (
              <div style={{ marginTop: 4, color: '#666' }}>{f.notes}</div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

function SummaryBar({ summary }){
  if (!summary) return null;
  const det = summary.filing_ready
    ? { label: 'READY', color: '#43a85a' }
    : { label: 'NOT READY', color: '#e55' };
  return (
    <div style={{ display: 'flex', gap: 12, padding: '8px 12px', background: '#0f0f0f', borderBottom: '1px solid #222', fontSize: 11, fontFamily: 'monospace', alignItems: 'center', flexWrap: 'wrap' }}>
      <Badge color={det.color} label={det.label} />
      <span style={{ color: '#666' }}>{summary.total} fields</span>
      <Badge color="#43a85a" label={`${summary.filled} filled`} />
      {summary.blocking_gaps > 0 && <Badge color="#e55" label={`${summary.blocking_gaps} blocking`} />}
      {summary.invalid > 0 && <Badge color="#e55" label={`${summary.invalid} invalid`} />}
      {summary.evidence_missing > 0 && <Badge color="#d6a36a" label={`${summary.evidence_missing} missing`} />}
      {summary.advisory_count > 0 && <Badge color="#5a9ec4" label={`${summary.advisory_count} advisory`} />}
      {summary.gating_reason && (
        <span style={{ color: '#888' }}>· {summary.gating_reason}</span>
      )}
    </div>
  );
}

export default function FieldLineagePanel({ exhibit }){
  const [report, setReport]   = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState(null);
  const [filter, setFilter]   = useState('all');
  const [search, setSearch]   = useState('');

  useEffect(() => {
    if (!exhibit) { setReport(null); return; }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch('/api/exhibits/lineage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ exhibit })
    })
      .then(r => r.ok ? r.json() : r.json().then(e => Promise.reject(e.detail || e.error || 'API error')))
      .then(data => { if (!cancelled){ setReport(data); setLoading(false); } })
      .catch(e  => { if (!cancelled){ setError(String(e)); setLoading(false); } });
    return () => { cancelled = true; };
  }, [exhibit]);

  if (!exhibit){
    return (
      <div style={{ padding: 24, fontFamily: 'monospace', fontSize: 12, color: '#555' }}>
        Compute an exhibit first to view field lineage.
      </div>
    );
  }

  if (loading){
    return (
      <div style={{ padding: 24, fontFamily: 'monospace', fontSize: 12, color: '#666' }}>
        Loading lineage…
      </div>
    );
  }

  if (error){
    return (
      <div style={{ padding: 24, fontFamily: 'monospace', fontSize: 12, color: '#e55' }}>
        Lineage error: {error}
      </div>
    );
  }

  if (!report) return null;

  const allFields = report.fields || [];
  const filtered = allFields.filter(f => {
    if (filter === 'blocking' && !f.blocking) return false;
    if (filter === 'invalid'  && f.status !== 'invalid' && f.status !== 'INVALID') return false;
    if (filter === 'filled'   && f.status !== 'filled'  && f.status !== 'FILLED')  return false;
    if (filter === 'advisory' && !f.advisory) return false;
    if (search){
      const q = search.toLowerCase();
      return (
        f.id.toLowerCase().includes(q) ||
        (f.lms_label || '').toLowerCase().includes(q) ||
        (f.source_system || '').toLowerCase().includes(q)
      );
    }
    return true;
  });

  return (
    <div style={{ background: '#111', minHeight: '100%' }}>
      <SummaryBar summary={report.summary} />

      {/* Filter toolbar */}
      <div style={{ display: 'flex', gap: 8, padding: '8px 12px', background: '#0d0d0d', borderBottom: '1px solid #1a1a1a', alignItems: 'center', flexWrap: 'wrap' }}>
        {['all', 'blocking', 'invalid', 'filled', 'advisory'].map(f => (
          <button key={f} onClick={() => setFilter(f)} style={{
            background: filter === f ? '#222' : 'transparent',
            border: `1px solid ${filter === f ? '#444' : '#2a2a2a'}`,
            color: filter === f ? '#ccc' : '#666',
            borderRadius: 3,
            padding: '2px 8px',
            fontSize: 10,
            fontFamily: 'monospace',
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            cursor: 'pointer'
          }}>{f}</button>
        ))}
        <input
          type="text"
          placeholder="Search field id / label / source…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{
            marginLeft: 'auto',
            background: '#1a1a1a',
            border: '1px solid #2a2a2a',
            color: '#ccc',
            borderRadius: 3,
            padding: '3px 8px',
            fontSize: 11,
            fontFamily: 'monospace',
            width: 240,
            outline: 'none'
          }}
        />
        <span style={{ fontSize: 10, color: '#555', fontFamily: 'monospace' }}>
          {filtered.length}/{allFields.length}
        </span>
      </div>

      {/* Table */}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: '#0a0a0a' }}>
              <th style={TH_STYLE}>FIELD</th>
              <th style={TH_STYLE}>VALUE</th>
              <th style={TH_STYLE}>STATUS</th>
              <th style={TH_STYLE}>SOURCE</th>
              <th style={TH_STYLE}>SOURCE PATH</th>
              <th style={TH_STYLE}>CONFIDENCE</th>
              <th style={TH_STYLE}>BLOCKING</th>
              <th style={TH_STYLE}>VALIDATION</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(f => <Row key={f.id} f={f} />)}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={8} style={{ ...TD_STYLE, color: '#555', textAlign: 'center', padding: 24 }}>
                  No fields match the current filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
