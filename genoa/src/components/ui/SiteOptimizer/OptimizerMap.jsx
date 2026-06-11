import React, { useEffect, useRef, useState } from 'react';
import RackPanel from '../RackPanel.jsx';
import { primaryStatus, rankColor } from './statusUtil.js';
import InfrastructureLegend, { INFRA_MARKER_SPEC } from './InfrastructureLegend.jsx';

// OptimizerMap — Leaflet container.  Uses window.L (Leaflet is loaded
// globally from index.html, matching the existing Genoa contour map).
//
// Layers:
//   • current site               — diamond/star marker (distinct shape)
//   • search-radius              — translucent ring
//   • candidate markers          — coloured by rank
//   • candidate heat-circles     — semi-transparent overlay, shown when
//                                  zoomed out (z <= 9), simulating a
//                                  "heatmap of ranked candidates"
//   • infrastructure markers     — 9 visual treatments (5 kinds ×
//                                  selected/unselected + 1 non-evaluated
//                                  reserve).  Only added when
//                                  searchMode !== 'GRID'.
//
// All state changes flow through props.  When `selectedRank` changes
// the map pans to the candidate and opens its popup.

const HEATMAP_MAX_ZOOM = 9;

const COLOR_MODES = ['rank', 'status', 'sigma'];
const COLOR_MODE_LABELS = { rank: 'By rank', status: 'By status', sigma: 'By σ' };

function sigmaMarkerColor(sigma){
  if (sigma == null || !Number.isFinite(sigma)) return '#6b6b5e';
  if (sigma >= 8)  return '#63d471';
  if (sigma >= 5)  return '#ffb347';
  return '#ff7a7a';
}

function statusMarkerColor(c){
  const cat = c.status_category;
  if (cat === 'PROMISING')                      return '#63d471';
  if (cat === 'NON_COMPLIANT')                  return '#ff5a5a';
  if (cat === 'TREATY_REVIEW')                  return '#c79bff';
  if (cat && cat.startsWith('RECOVERABLE'))     return '#6fd3ff';
  return '#ffb347';
}

function escapeHtml(s){
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function svgDivIcon(L, color, label){
  // Distinct "diamond" star icon for the CURRENT site so it can be
  // told apart from candidate circles at any zoom level.
  const html = `
    <svg viewBox="0 0 28 28" width="28" height="28">
      <defs>
        <filter id="glow"><feGaussianBlur stdDeviation="1.4"/></filter>
      </defs>
      <polygon points="14,2 22,14 14,26 6,14"
               fill="${color}" stroke="#0a1a25" stroke-width="2" filter="url(#glow)"/>
      <text x="14" y="17" text-anchor="middle" font-family="ui-monospace,monospace"
            font-size="9" fill="#0a1a25" font-weight="700">${escapeHtml(label || '◆')}</text>
    </svg>`;
  return L.divIcon({
    html,
    className: 'optimizer-current-site-icon',
    iconSize:  [28, 28],
    iconAnchor:[14, 14]
  });
}

// Per-kind SVG glyph for infrastructure markers.  Two visual states are
// supported via the `selected` flag — selected markers get a bright
// outer ring.  The "non-evaluated" treatment is reserved for V1+ but
// rendered the same way as the spec so the legend stays accurate.
function infraDivIcon(L, kind, { selected }){
  const spec  = INFRA_MARKER_SPEC[kind] || INFRA_MARKER_SPEC.NON_EVAL;
  const color = spec.color;
  const ring  = selected
    ? `<circle cx="11" cy="11" r="10" fill="none" stroke="#ffe9b3" stroke-width="1.6"/>`
    : '';
  let body;
  switch (spec.shape){
    case 'square':
      body = `<rect x="4" y="4" width="14" height="14" fill="${color}" stroke="#0a1a25" stroke-width="1.4"/>`;
      break;
    case 'diamond':
      body = `<polygon points="11,2 20,11 11,20 2,11" fill="${color}" stroke="#0a1a25" stroke-width="1.4"/>`;
      break;
    case 'triangle':
      body = `<polygon points="11,3 20,19 2,19" fill="${color}" stroke="#0a1a25" stroke-width="1.4"/>`;
      break;
    case 'hexagon':
      body = `<polygon points="11,2 19,6 19,16 11,20 3,16 3,6" fill="${color}" stroke="#0a1a25" stroke-width="1.4"/>`;
      break;
    case 'ring':
      body = `<circle cx="11" cy="11" r="7" fill="none" stroke="${color}" stroke-width="1.6" stroke-dasharray="3 2"/>`;
      break;
    case 'circle':
    default:
      body = `<circle cx="11" cy="11" r="7" fill="${color}" stroke="#0a1a25" stroke-width="1.4"/>`;
  }
  const html = `<svg viewBox="0 0 22 22" width="22" height="22">${ring}${body}</svg>`;
  return L.divIcon({
    html,
    className: `optimizer-infra-icon optimizer-infra-${kind.toLowerCase()}${selected ? ' is-selected' : ''}`,
    iconSize:  [22, 22],
    iconAnchor:[11, 11]
  });
}

function inferInfraKind(candidate){
  const ref = candidate?.infrastructure_ref;
  if (ref && typeof ref.kind === 'string'){
    const k = ref.kind.toUpperCase();
    if (INFRA_MARKER_SPEC[k]) return k;
  }
  return 'NON_EVAL';
}

export default function OptimizerMap({
  currentSite,
  colCentroid,
  callsign,
  candidates,
  selectedRank,
  onSelectCandidate,
  searchRadiusKm,
  searchMode = 'GRID',
  infrastructureSites = []
}){
  const [colorMode, setColorMode] = useState('rank');
  const elRef    = useRef(null);
  const ctxRef   = useRef({
    map:            null,
    candLayer:      null,
    heatLayer:      null,
    infraLayer:     null,
    currentMarker:  null,
    colMarker:      null,
    radiusCircle:   null,
    popupsByRank:   new Map()
  });

  // mount / unmount
  useEffect(() => {
    if (typeof window === 'undefined' || !window.L) return;
    if (ctxRef.current.map) return;
    const L = window.L;
    const lat = Number(currentSite?.lat) || 34.86;
    const lon = Number(currentSite?.lon) || -111.82;
    const map = L.map(elRef.current, { zoomControl: true, attributionControl: true })
      .setView([lat, lon], 9);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap · © CARTO'
    }).addTo(map);
    ctxRef.current.map        = map;
    ctxRef.current.candLayer  = L.layerGroup().addTo(map);
    ctxRef.current.heatLayer  = L.layerGroup().addTo(map);
    ctxRef.current.infraLayer = L.layerGroup().addTo(map);
    // toggle the heatmap layer based on zoom — collapsed to a single
    // boolean so we don't have to track listeners by hand.
    const onZoom = () => {
      const z = map.getZoom();
      const hl = ctxRef.current.heatLayer;
      if (!hl) return;
      if (z <= HEATMAP_MAX_ZOOM){
        if (!map.hasLayer(hl)) hl.addTo(map);
      } else {
        if (map.hasLayer(hl)) map.removeLayer(hl);
      }
    };
    map.on('zoomend', onZoom);
    onZoom();
    return () => {
      try { map.off('zoomend', onZoom); map.remove(); } catch {}
      ctxRef.current.map = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // re-draw current site marker + radius
  useEffect(() => {
    const L = window.L;
    const ctx = ctxRef.current;
    if (!L || !ctx.map) return;
    const lat = Number(currentSite?.lat);
    const lon = Number(currentSite?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
    if (ctx.currentMarker){ ctx.map.removeLayer(ctx.currentMarker); ctx.currentMarker = null; }
    if (ctx.radiusCircle){ ctx.map.removeLayer(ctx.radiusCircle); ctx.radiusCircle = null; }
    ctx.currentMarker = L.marker([lat, lon], {
      icon:    svgDivIcon(L, '#ffb347', ''),
      zIndexOffset: 1000
    }).bindPopup(`<b>Current site — ${escapeHtml(callsign || '—')}</b><br/>${lat.toFixed(4)}, ${lon.toFixed(4)}`).addTo(ctx.map);
    const r = Number(searchRadiusKm);
    if (Number.isFinite(r) && r > 0){
      ctx.radiusCircle = L.circle([lat, lon], {
        radius:      r * 1000,
        color:       '#d6a36a',
        weight:      1,
        opacity:     0.7,
        dashArray:   '6 5',
        fillColor:   '#d6a36a',
        fillOpacity: 0.04,
        interactive: false
      }).addTo(ctx.map);
    }
  }, [currentSite?.lat, currentSite?.lon, callsign, searchRadiusKm]);

  // COL centroid marker — cyan circle when col_centroid is provided
  useEffect(() => {
    const L = window.L;
    const ctx = ctxRef.current;
    if (!L || !ctx.map) return;
    if (ctx.colMarker){ ctx.map.removeLayer(ctx.colMarker); ctx.colMarker = null; }
    if (!colCentroid) return;
    const clat = Number(colCentroid.lat), clon = Number(colCentroid.lon);
    if (!Number.isFinite(clat) || !Number.isFinite(clon)) return;
    ctx.colMarker = L.circleMarker([clat, clon], {
      radius: 9, color: '#6fd3ff', weight: 2,
      fillColor: '#6fd3ff', fillOpacity: 0.25, interactive: true
    }).bindPopup(
      `<b>COL centroid</b><br/>Supplied as field-strength target for §73.24(i).<br/>${clat.toFixed(4)}, ${clon.toFixed(4)}`
    ).addTo(ctx.map);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colCentroid?.lat, colCentroid?.lon]);

  // re-draw candidate markers + heatmap circles
  useEffect(() => {
    const L = window.L;
    const ctx = ctxRef.current;
    if (!L || !ctx.map) return;
    ctx.candLayer.clearLayers();
    ctx.heatLayer.clearLayers();
    ctx.popupsByRank.clear();

    const list = Array.isArray(candidates) ? candidates : [];
    if (list.length === 0) return;

    list.forEach((c) => {
      const lat = Number(c.lat), lon = Number(c.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
      const color  = colorMode === 'status' ? statusMarkerColor(c)
                   : colorMode === 'sigma'  ? sigmaMarkerColor(c.ground_sigma_mS_m)
                   : rankColor(c.rank);
      const status = primaryStatus(c.status_labels);

      // markers — smaller for lower ranks
      const baseRadius = Math.max(5, 12 - Math.log2(Math.max(1, c.rank)));
      const marker = L.circleMarker([lat, lon], {
        radius:      baseRadius,
        color:       '#0a1a25',
        weight:      1.5,
        fillColor:   color,
        fillOpacity: 0.95
      });
      const catLabel = (c.status_category || status || '').replace(/_/g, ' ');
      const catColor = (c.status_category === 'PROMISING') ? '#63d471'
        : (c.status_category === 'NON_COMPLIANT') ? '#ff5a5a'
        : (c.status_category && c.status_category.startsWith('RECOVERABLE')) ? '#6fd3ff'
        : '#ffb347';
      const blanketPct = c.blanket_population_pct;
      const blanketStr = blanketPct != null ? `${Number(blanketPct).toFixed(2)}%` : '—';
      const deltaStr = c.score_delta_vs_baseline != null
        ? ` <span style="color:${c.score_delta_vs_baseline >= 0 ? '#63d471' : '#ff7a7a'}">${c.score_delta_vs_baseline >= 0 ? '+' : ''}${c.score_delta_vs_baseline.toFixed(1)}</span>`
        : '';
      const qualStr = c.ground_sigma_quality ? ` <span style="color:#a89c84">(${c.ground_sigma_quality})</span>` : '';
      const popup = `
        <div style="font-family:ui-monospace,monospace;font-size:11px;line-height:1.4">
          <div style="font-weight:700;color:${color}">Rank #${c.rank} · score ${Number(c.score).toFixed(1)}${deltaStr}</div>
          <div style="color:#a89c84;margin-bottom:4px">${lat.toFixed(4)}, ${lon.toFixed(4)}</div>
          <div style="margin-bottom:4px">
            <span style="color:${catColor};font-weight:600;text-transform:uppercase;letter-spacing:.06em">${escapeHtml(catLabel)}</span>
          </div>
          <div><span style="color:#a89c84">COL:</span> ${(Number(c.col_coverage_pct) * 100).toFixed(0)}% ·
               <span style="color:#a89c84">5mV/m:</span> ${c.principal_community_5mvm_km != null ? `${Number(c.principal_community_5mvm_km).toFixed(1)} km` : '—'}</div>
          <div><span style="color:#a89c84">Blkt pop:</span> ${escapeHtml(blanketStr)} ·
               <span style="color:#a89c84">σ:</span> ${c.ground_sigma_mS_m != null ? `${c.ground_sigma_mS_m} mS/m${qualStr}` : '—'}</div>
          <div><span style="color:#a89c84">Dist:</span> ${c.distance_from_current_km != null ? `${Number(c.distance_from_current_km).toFixed(1)} km` : '—'} ·
               <span style="color:#a89c84">Brg:</span> ${c.bearing_deg != null ? `${c.bearing_deg}°` : '—'}</div>
          <div style="margin-top:6px"><i style="color:#6fd3ff">Click row in ledger for full detail.</i></div>
        </div>`;
      marker.bindPopup(popup);
      marker.bindTooltip(`#${c.rank} · ${status}`, { direction: 'top', offset: [0, -6] });
      marker.on('click', () => { if (onSelectCandidate) onSelectCandidate(c.rank); });
      marker.addTo(ctx.candLayer);
      ctx.popupsByRank.set(c.rank, marker);

      // heat-style background circle (semi-transparent, blends down)
      const heat = L.circle([lat, lon], {
        radius:      Math.max(800, (Number(c.score) || 50) * 60),
        color:       color,
        weight:      0,
        fillColor:   color,
        fillOpacity: 0.10,
        interactive: false
      });
      heat.addTo(ctx.heatLayer);
    });
  }, [candidates, onSelectCandidate, colorMode]);

  // re-draw infrastructure layer (one marker per infrastructure-source
  // candidate, plus its 9-treatment glyph from INFRA_MARKER_SPEC).
  useEffect(() => {
    const L = window.L;
    const ctx = ctxRef.current;
    if (!L || !ctx.map || !ctx.infraLayer) return;
    ctx.infraLayer.clearLayers();
    if (searchMode === 'GRID') return;

    const list = Array.isArray(infrastructureSites) ? infrastructureSites : [];
    list.forEach((c) => {
      const ref = c.infrastructure_ref || {};
      const lat = Number(ref.lat ?? c.lat);
      const lon = Number(ref.lon ?? c.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
      const kind = inferInfraKind(c);
      const isSel = c.rank === selectedRank;
      const icon = infraDivIcon(L, kind, { selected: isSel });
      const marker = L.marker([lat, lon], { icon, zIndexOffset: 500 });
      const name   = ref.name || c.notes || `Rank #${c.rank}`;
      const owner  = ref.owner || '—';
      const height = (ref.height_m != null) ? `${ref.height_m} m` : '—';
      const kindL  = kind.replace(/_/g, ' ');
      marker.bindTooltip(
        `<b>${escapeHtml(name)}</b><br/>${escapeHtml(owner)} · ${escapeHtml(kindL)} · ${escapeHtml(height)}`,
        { direction: 'top', offset: [0, -8] }
      );
      marker.on('click', () => { if (onSelectCandidate) onSelectCandidate(c.rank); });
      marker.addTo(ctx.infraLayer);
    });
  }, [infrastructureSites, searchMode, selectedRank, onSelectCandidate]);

  // pan + open popup when selection changes
  useEffect(() => {
    const ctx = ctxRef.current;
    if (!ctx.map || selectedRank == null) return;
    const m = ctx.popupsByRank.get(selectedRank);
    if (!m) return;
    const ll = m.getLatLng();
    ctx.map.panTo(ll);
    m.openPopup();
  }, [selectedRank]);

  const modeNextIdx = (COLOR_MODES.indexOf(colorMode) + 1) % COLOR_MODES.length;
  const modeNext = COLOR_MODES[modeNextIdx];

  return (
    <RackPanel
      eyebrow="Chart Room"
      title="Regional candidate map"
      italicAccent={`Markers coloured by ${colorMode}.  Zoom out for heatmap.`}
      tone="cyan"
      right={(
        <div className="flex items-center gap-3">
          <button
            onClick={() => setColorMode(modeNext)}
            className="font-mono text-[10px] tracking-rack uppercase border border-rule rounded-sm px-2 py-0.5 text-textDim hover:text-cream transition-colors"
            title={`Switch to colour by ${modeNext}`}
          >
            {COLOR_MODE_LABELS[colorMode]} ⇄
          </button>
          {colorMode === 'rank' && (
            <div className="flex items-center gap-2 font-mono text-[10px] tracking-rack uppercase">
              <span className="inline-flex items-center gap-1">
                <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: '#ffb347' }} />
                <span className="text-textDim">Rank 1</span>
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: '#6fd3ff' }} />
                <span className="text-textDim">Low rank</span>
              </span>
            </div>
          )}
          {colorMode === 'status' && (
            <div className="flex items-center gap-2 font-mono text-[10px] tracking-rack uppercase">
              <span className="inline-flex items-center gap-1">
                <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: '#63d471' }} />
                <span className="text-textDim">Promising</span>
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: '#ff5a5a' }} />
                <span className="text-textDim">Non-cmp</span>
              </span>
            </div>
          )}
          {colorMode === 'sigma' && (
            <div className="flex items-center gap-2 font-mono text-[10px] tracking-rack uppercase">
              <span className="inline-flex items-center gap-1">
                <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: '#63d471' }} />
                <span className="text-textDim">≥8 mS/m</span>
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: '#ff7a7a' }} />
                <span className="text-textDim">&lt;5 mS/m</span>
              </span>
            </div>
          )}
        </div>
      )}
    >
      <div className="scope-bezel">
        <div className="scope-grid relative" style={{ height: 560 }}>
          <div ref={elRef} className="absolute inset-0 rounded-md" />
          <div className="scanline" />
          <InfrastructureLegend visible={searchMode !== 'GRID'} />
        </div>
      </div>
    </RackPanel>
  );
}
