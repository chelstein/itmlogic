// Validation panel — surfaces the validation suite the engine ran
// against the active curve dataset.

export function renderValidation(exhibit){
  const v = exhibit.validation || {};
  const last = v.runs?.[v.runs.length - 1] || null;
  document.getElementById('kv-validation').innerHTML = last ? kv([
    ['Curve dataset',           last.curve_version],
    ['Authoritative cases',     `${last.n_run} run / ${last.n_pass} pass`],
    ['Authoritative pass',      last.authoritative_pass ? 'yes' : 'no — CURVE_VALIDATION_MISSING blocker stays'],
    ['Regression cases',        `${last.n_regression_run} run / ${last.n_regression_pass} pass`],
    ['Mean error (km)',         last.mean_error_km ?? '—'],
    ['Max error (km)',          last.max_error_km  ?? '—'],
    ['Reference cases present', last.reference_cases_present ? 'yes' : 'no']
  ]) : '<div class="muted">no validation run attached.</div>';

  const body = document.querySelector('#validation-table tbody');
  body.innerHTML = (last?.results || []).map(r =>
    `<tr>
      <td>${r.case || '—'}</td>
      <td>${r.role || '—'}</td>
      <td>${r.authoritative === true ? 'yes' : (r.authoritative === false ? 'no' : '—')}</td>
      <td class="${r.status === 'pass' ? 'ok' : (r.status === 'fail' ? 'blk' : 'warn')}">${r.status || '—'}</td>
    </tr>`
  ).join('') || `<tr><td colspan="4" class="muted">no cases run.</td></tr>`;
}

function kv(rows){
  return rows.map(([k, v]) => `<div class="k">${k}</div><div class="v">${v ?? '—'}</div>`).join('');
}
