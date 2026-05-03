// Exports panel — shows what's been rendered + the reproducibility JSON.

export function renderExports(exhibit){
  const ex = exhibit.exports || {};
  document.getElementById('kv-exports').innerHTML = [
    ['JSON',          ex.json    || 'pending'],
    ['TXT',           ex.txt     || 'pending'],
    ['GeoJSON',       ex.geojson || 'pending'],
    ['PDF',           ex.pdf     || 'not_implemented'],
    ['Generated at',  ex.generated_at || '—']
  ].map(([k, v]) => `<div class="k">${k}</div><div class="v">${v}</div>`).join('');

  document.getElementById('repro-json').textContent = JSON.stringify(exhibit, null, 2);
}
