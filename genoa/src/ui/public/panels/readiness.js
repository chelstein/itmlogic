// Filing-readiness panel — score, status, blockers, warnings, recs.

const SEV_CLASS = { blocker: 'blocker', warning: 'warning', info: 'info' };

export function renderReadiness(exhibit){
  const fr = exhibit.filing_readiness || {};
  document.getElementById('readiness-score').textContent = fr.score ?? '—';
  const statusEl = document.getElementById('readiness-status');
  statusEl.textContent = fr.status || 'awaiting compute';
  statusEl.className = 'readiness-status ' + (fr.status || '');
  document.getElementById('readiness-status-line').innerHTML = exhibit.degraded_mode
    ? `<span class="warn">degraded mode</span> — ${exhibit.degraded_reasons?.length || 0} reason(s); see warnings.`
    : `<span class="ok">no warnings raised.</span>`;

  const blockers = exhibit.blockers || [];
  document.getElementById('readiness-blockers').innerHTML = blockers.length
    ? blockers.map(w => chip(w)).join('')
    : '<span class="ok">none</span>';

  const ws = (exhibit.warnings || []).filter(w => w.severity !== 'blocker');
  document.getElementById('readiness-warnings').innerHTML = ws.length
    ? ws.map(w => chip(w)).join('')
    : '<span class="ok">none</span>';

  const recs = fr.recommendations || [];
  document.getElementById('readiness-recs').innerHTML = recs.length
    ? recs.map(r => `<li>${r}</li>`).join('')
    : '<li class="muted">none</li>';
}

function chip(w){
  const cls = SEV_CLASS[w.severity] || 'info';
  const detail = w.detail ? ` · ${escapeHtml(w.detail)}` : '';
  return `<span class="warning-chip ${cls}" title="${escapeHtml(w.description || '')}${detail}">${w.code}</span>`;
}
function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
