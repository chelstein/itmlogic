// Map panel — Leaflet rendering, sunset-warm contour fills.
//
// Color ramp moves from amber (city / strongest) through sunset orange
// (intermediate) to teal (protected / outer). Polygons are filled with a
// soft gradient feel (alpha + dashed stroke) rather than hard line work.

let map, txMarker;
let layers = [];

const CONTOUR_COLORS = ['#FFC857', '#FF7A2F', '#2F6F73'];

export function ensureMap(lat, lon){
  const target = document.getElementById('map');
  if (!target) return;
  if (!map){
    map = L.map('map', { zoomControl: true, attributionControl: true })
      .setView([lat ?? 37.0902, lon ?? -95.7129], 8);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap · © CARTO · DEM via SPLAT/itmlogic'
    }).addTo(map);
  } else if (Number.isFinite(lat) && Number.isFinite(lon)){
    map.setView([lat, lon], map.getZoom() < 7 ? 9 : map.getZoom());
  }
}

export function clearMap(){
  if (!map) return;
  for (const l of layers) map.removeLayer(l);
  layers = [];
  if (txMarker){ map.removeLayer(txMarker); txMarker = null; }
}

export function renderMap(exhibit){
  const s = exhibit.station_inputs || {};
  const lat = s.lat, lon = s.lon;
  const polys = exhibit.polygons || [];
  const features = exhibit.geojson?.features || [];

  if (!Number.isFinite(lat) || !Number.isFinite(lon)){
    document.getElementById('map-caption').innerHTML =
      `<span class="warn">Map unavailable — facility coordinates missing.</span> Radial table is still computed; see the Radials tab.`;
    document.getElementById('legend').innerHTML = '';
    return;
  }
  document.getElementById('map-caption').textContent =
    'Deterministic FCC contour map. Contour fills warm→cool from city grade to protected.';

  ensureMap(lat, lon);
  clearMap();

  txMarker = L.circleMarker([lat, lon], {
    radius: 6, color: '#FFC857', weight: 2, fillColor: '#FF7A2F', fillOpacity: .95
  }).bindPopup(`<b>${s.call || '—'}</b><br/>${s.service} · ${s.frequency} ${s.frequency_unit || ''}<br/>ERP ${s.erp_kw} kW · HAAT ${s.haat_m_input ?? '—'} m`).addTo(map);

  const legendItems = [];
  polys.forEach((p, i) => {
    if (!p.closed || !p.ring_latlng?.length) return;
    const color = CONTOUR_COLORS[i] || '#9fdcb1';
    const layer = L.polygon(p.ring_latlng, {
      color, weight: i === 0 ? 2.5 : 1.5, opacity: .92,
      fillColor: color, fillOpacity: i === 0 ? 0.14 : 0.06,
      dashArray: i > 0 ? '4,5' : null
    }).bindPopup(`<b>${p.label}</b><br/>${p.field_strength?.value ?? '—'} ${p.field_strength?.unit ?? ''}<br/>mean radial ${(p.mean_radial_km || 0).toFixed(1)} km`);
    layer.addTo(map);
    layers.push(layer);
    legendItems.push(`<span><span class="sw" style="background:${color}"></span>${p.label}</span>`);
  });

  const allPts = polys.flatMap(p => p.ring_latlng || []);
  if (allPts.length) map.fitBounds(L.latLngBounds(allPts).pad(0.15));

  document.getElementById('legend').innerHTML = legendItems.join('') +
    ` <span class="muted">· ${features.length} GeoJSON features</span>`;
}
