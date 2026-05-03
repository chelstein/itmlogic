// Radials panel — renders the radial table (the engine's full
// per-azimuth output, not a summary).

export function renderRadials(exhibit){
  const rt = exhibit.radial_table || [];
  const cdef = exhibit.contour_definitions || [];
  const head = document.querySelector('#radial-table thead');
  const body = document.querySelector('#radial-table tbody');
  head.innerHTML = '<tr>' +
    '<th>Az (°)</th><th>F·rel</th><th>HAAT (m)</th>' +
    cdef.map(c => `<th>${c.label || c.id}</th>`).join('') +
    '</tr>';
  body.innerHTML = rt.map(r => {
    const dists = cdef.map(c => `<td>${fmt(r.contour_distances_km?.[c.id], 2)}</td>`).join('');
    const haat = r.haat_computed_m ?? r.haat_input_m;
    return `<tr>
      <td>${fmt(r.azimuth_deg, 1)}</td>
      <td>${fmt(r.relative_field, 3)}</td>
      <td>${fmt(haat, 0)}</td>
      ${dists}
    </tr>`;
  }).join('');
}

function fmt(v, d = 2){
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  return Number(v).toFixed(d);
}
