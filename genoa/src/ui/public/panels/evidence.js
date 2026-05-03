// Evidence panel — terrain, measurements, identity.

export function renderEvidence(exhibit){
  const ev = exhibit.evidence || {};
  document.getElementById('kv-terrain').innerHTML = ev.terrain?.available ? kv([
    ['Source',  ev.terrain.source],
    ['Profiles', (ev.terrain.profiles || []).length + ' radials']
  ]) : muted('No terrain evidence attached. Engine ran with flat HAAT (or n/a for AM).');

  document.getElementById('kv-meas').innerHTML = ev.measurements?.available ? kv([
    ['Source',     ev.measurements.source],
    ['Records',    ev.measurements.n_records ?? (ev.measurements.records || []).length],
    ['Calibrated', ev.measurements.calibrated ? 'yes' : 'no — raw indications only'],
    ['Author',     ev.measurements.author],
    ['Hardware',   ev.measurements.hw]
  ]) : muted('No SDR / SigMF records attached.');

  document.getElementById('kv-identity').innerHTML = ev.identity?.available ? kv([
    ['Available',     'yes'],
    ['Confirmations', (ev.identity.confirmations || []).length],
    ['Sources',       (ev.identity.sources || []).map(s => s.kind + ':' + s.status).join(', ')]
  ]) : muted('Identity sidecar not attached or no confirmations returned.');
}

function kv(rows){
  return rows.map(([k, v]) => `<div class="k">${k}</div><div class="v">${v ?? '—'}</div>`).join('');
}
function muted(text){ return `<div class="muted">${text}</div>`; }
