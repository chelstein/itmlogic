// History panel — list saved exhibits, click to repopulate.

export async function loadHistory(onPick){
  const tb = document.querySelector('#history-table tbody');
  tb.innerHTML = `<tr><td colspan="7" class="muted">loading…</td></tr>`;
  try {
    const r = await fetch('/api/exhibits');
    if (!r.ok){
      const j = await r.json().catch(() => ({}));
      tb.innerHTML = `<tr><td colspan="7" class="warn">${j.error || 'unavailable'} (${r.status})</td></tr>`;
      return;
    }
    const rows = await r.json();
    if (!Array.isArray(rows) || !rows.length){
      tb.innerHTML = `<tr><td colspan="7" class="muted">no saved exhibits yet.</td></tr>`;
      return;
    }
    tb.innerHTML = rows.map(x => `
      <tr data-id="${x.id}" style="cursor:pointer">
        <td>#${x.id}</td>
        <td>${x.call_sign || '—'}</td>
        <td>${x.service || '—'}</td>
        <td>${x.frequency || '—'}</td>
        <td>${x.filing_score ?? '—'}</td>
        <td>${x.filing_status || '—'}</td>
        <td>${new Date(x.created_at).toISOString().slice(0,16).replace('T',' ')}</td>
      </tr>`).join('');
    tb.querySelectorAll('tr').forEach(tr =>
      tr.addEventListener('click', () => onPick(tr.dataset.id))
    );
  } catch (e){
    tb.innerHTML = `<tr><td colspan="7" class="warn">load failed: ${e.message}</td></tr>`;
  }
}
