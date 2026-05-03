// FCC Method panel — renders the deterministic-method block.

const $ = id => document.getElementById(id);

export function renderMethod(exhibit){
  const m  = exhibit.calculation_method || {};
  const ip = exhibit.interpolation || {};
  const tr = exhibit.calculation_trace || {};
  const trService = tr[Object.keys(tr)[0]] || {};
  $('kv-method').innerHTML = kvHtml([
    ['Method',            m.name],
    ['Regulations',       (m.regulations || []).join(', ')],
    ['Engine module',     m.engine_module],
    ['Engine version',    m.engine_version],
    ['Interp · field',    ip.along_field],
    ['Interp · HAAT',     ip.along_haat],
    ['Curve dataset',     trService.dataset],
    ['Curve meta sha256', (trService.dataset_meta_sha256 || '').slice(0, 12) + '…'],
    ['Pattern factor',    trService.pattern_factor_applied ? 'applied' : 'non-directional'],
    ['Formula',           trService.formula_summary]
  ]);

  const polys = exhibit.polygons || [];
  $('kv-contours').innerHTML = polys.length ? polys.map(p => {
    const fs = p.field_strength || {};
    return `<div class="k">${p.label || p.contour_id}</div>
            <div class="v">mean ${fmt(p.mean_radial_km, 2)} km · area ${fmt(p.area_km2, 0)} km² (${fs.value ?? '—'} ${fs.unit ?? ''})</div>`;
  }).join('') : '<div class="muted">no polygons (no facility coordinates)</div>';
}

function kvHtml(rows){
  return rows.map(([k, v]) =>
    `<div class="k">${k}</div><div class="v">${v ?? '—'}</div>`).join('');
}
function fmt(v, d = 2){
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  return Number(v).toFixed(d);
}
