// Genoa UI entry — orchestrates the panels.  This file does NOT
// implement engineering math.  All compute happens server-side via
// /api/exhibits/compute; the UI only renders + collects inputs.

import { readInputs, setInputs, applyFacility, PRESETS } from '/panels/facility.js';
import { renderMethod }     from '/panels/method.js';
import { renderRadials }    from '/panels/radials.js';
import { renderMap }        from '/panels/map.js';
import { renderEvidence }   from '/panels/evidence.js';
import { renderValidation } from '/panels/validation.js';
import { renderReadiness }  from '/panels/readiness.js';
import { renderNarrative }  from '/panels/narrative.js';
import { renderExports }    from '/panels/exports.js';
import { loadHistory }      from '/panels/history.js';

const $ = id => document.getElementById(id);
let LAST_EXHIBIT = null;

async function compute(){
  const inputs = readInputs();
  setStatus('<span class="muted">computing…</span>');
  try {
    const r = await fetch('/api/exhibits/compute', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ inputs })
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || j.message || ('HTTP ' + r.status));
    LAST_EXHIBIT = j;
    renderAll(j);
    const fr = j.filing_readiness;
    setStatus(j.degraded_mode
      ? `<span class="warn">computed in degraded mode · ${fr.score}/100 (${fr.status}) · ${j.warnings.length} warning(s), ${j.blockers.length} blocker(s)</span>`
      : `<span class="ok">computed cleanly · ${fr.score}/100 (${fr.status})</span>`);
  } catch (e){
    setStatus(`<span class="warn">compute failed: ${e.message}</span>`);
  }
}

function renderAll(exhibit){
  renderMethod(exhibit);
  renderRadials(exhibit);
  renderMap(exhibit);
  renderEvidence(exhibit);
  renderValidation(exhibit);
  renderReadiness(exhibit);
  renderNarrative(exhibit);
  renderExports(exhibit);
  $('engine-sig').textContent = `engine ${exhibit.engine_signature.module} v${exhibit.engine_signature.version} · ${exhibit.engine_signature.hash.slice(0, 12)}`;
}

function setStatus(html){ $('run-status').innerHTML = html; }

// ---- Tabs -------------------------------------------------------------
document.querySelectorAll('.tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tabpanel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.querySelector(`.tabpanel[data-panel="${btn.dataset.tab}"]`).classList.add('active');
    if (btn.dataset.tab === 'history') loadHistory(loadExhibit);
  });
});

// ---- Buttons ----------------------------------------------------------
$('run').addEventListener('click', compute);
$('loadKslx').addEventListener('click', async () => {
  setInputs(PRESETS.kslx);
  if (PRESETS.kslx._resolveFacility){
    await lookupFacility(PRESETS.kslx.facility_id, { silent: false });
  }
  compute();
});
$('loadSynthetic').addEventListener('click', () => {
  setInputs(PRESETS.synthetic);
  setFacilitySource('');
  compute();
});
$('lookupFid').addEventListener('click', async () => {
  const fid = ($('fid').value || '').trim();
  if (!fid){ setFacilitySource('<span class="warn">Enter a Facility ID first.</span>'); return; }
  await lookupFacility(fid, { silent: false });
});
$('refreshHistory').addEventListener('click', () => loadHistory(loadExhibit));

async function lookupFacility(id, { silent = true } = {}){
  setFacilitySource('<span class="muted">looking up…</span>');
  try {
    const r = await fetch(`/api/facilities/${encodeURIComponent(id)}`);
    if (r.status === 503){
      const j = await r.json().catch(() => ({}));
      setFacilitySource(`<span class="warn">FACILITY_LOOKUP_UNAVAILABLE — ${j.warning?.detail || 'no upstream configured'}</span>`);
      return;
    }
    if (r.status === 404){
      setFacilitySource(`<span class="warn">Facility ${id} not found in upstream.</span>`);
      return;
    }
    if (!r.ok){
      const j = await r.json().catch(() => ({}));
      setFacilitySource(`<span class="warn">lookup failed (${r.status}): ${j.message || j.error || ''}</span>`);
      return;
    }
    const j = await r.json();
    const { applied } = applyFacility(j.facility);
    const cacheTag = j.cached ? ' (cached)' : '';
    setFacilitySource(applied.length
      ? `<span class="ok">resolved via ${j.source}${cacheTag} — filled: ${applied.join(', ')}</span>`
      : `<span class="muted">resolved via ${j.source}${cacheTag} — no missing fields to fill</span>`);
  } catch (e){
    if (!silent) setFacilitySource(`<span class="warn">lookup failed: ${e.message}</span>`);
  }
}

function setFacilitySource(html){
  const el = document.getElementById('facility-source');
  if (el) el.innerHTML = html;
}

$('save').addEventListener('click', async () => {
  if (!LAST_EXHIBIT){ alert('Run a compute first.'); return; }
  try {
    const r = await fetch('/api/exhibits', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(LAST_EXHIBIT)
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status));
    LAST_EXHIBIT.id = j.id;
    setStatus(`<span class="ok">saved exhibit #${j.id}</span>`);
  } catch (e){
    setStatus(`<span class="warn">save failed: ${e.message}</span>`);
  }
});

function downloadExport(format){
  if (!LAST_EXHIBIT){ alert('Run a compute first.'); return; }
  if (!LAST_EXHIBIT.id){
    // Stateless download: pull from the in-memory exhibit
    const map = {
      json:    () => [JSON.stringify(LAST_EXHIBIT, null, 2),    'application/json',  'exhibit.json'],
      geojson: () => [JSON.stringify(LAST_EXHIBIT.geojson, null, 2), 'application/geo+json', 'contours.geojson']
    };
    const fn = map[format];
    if (!fn){ alert('TXT requires a saved exhibit; click Save first.'); return; }
    const [body, type, suffix] = fn();
    const blob = new Blob([body], { type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${(LAST_EXHIBIT.station_inputs.call || 'exhibit').replace(/[^A-Z0-9]/gi,'_')}_${suffix}`;
    a.click();
    return;
  }
  window.location = `/api/exhibits/${LAST_EXHIBIT.id}/export/${format}`;
}
$('exportJson').addEventListener('click',    () => downloadExport('json'));
$('exportTxt').addEventListener('click',     () => downloadExport('txt'));
$('exportGeojson').addEventListener('click', () => downloadExport('geojson'));

async function loadExhibit(id){
  try {
    const r = await fetch(`/api/exhibits/${id}`);
    const x = await r.json();
    if (!r.ok) throw new Error(x.error || 'load failed');
    LAST_EXHIBIT = x.payload;
    setInputs(LAST_EXHIBIT.station_inputs);
    renderAll(LAST_EXHIBIT);
    setStatus(`<span class="ok">loaded exhibit #${id}</span>`);
  } catch (e){ alert('load failed: ' + e.message); }
}

// ---- Boot -------------------------------------------------------------
window.addEventListener('load', () => {
  setStatus('<span class="muted">ready · click Compute exhibit</span>');
});
