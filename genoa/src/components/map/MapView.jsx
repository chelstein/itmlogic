// MapLibre GL canvas — the ONE place that touches the GL instance.
//
// Builds the style from BASE_STYLE, then adds every entry in the LAYERS
// registry as a pg_tileserv vector source + layer.  Render only; no FCC
// math, no DB access — PostGIS is the source of truth, pg_tileserv the
// API, this is just the renderer (per the platform architecture).
//
// Reports status (loaded / rendered-feature-count / errors) via onStatus
// so the page HUD can surface what the map is actually doing.

import React, { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Protocol } from 'pmtiles';
import { MAP_STYLE_URL, INITIAL_VIEW, LAYERS, tileUrl, CONTOURS_URL } from './config.js';

// Register the pmtiles:// protocol once so a self-hosted PMTiles basemap
// (referenced from the style.json, served same-origin via /basemap) reads
// via HTTP range requests.  No-op until a pmtiles source is used.
if (!globalThis.__genoaPmtilesRegistered){
  maplibregl.addProtocol('pmtiles', new Protocol().tile);
  globalThis.__genoaPmtilesRegistered = true;
}

// Escape feature property values before injecting into popup HTML — tile
// attributes are external input and could contain markup.
function esc(v){
  return String(v).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

export default function MapView({ onStatus }){
  const containerRef = useRef(null);
  const mapRef       = useRef(null);
  // Latest callback via ref so status updates never tear down the map.
  const statusRef    = useRef(onStatus);
  statusRef.current  = onStatus;
  const report = (s) => { if (statusRef.current) statusRef.current(s); };

  useEffect(() => {
    if (mapRef.current || !containerRef.current) return;
    const layerIds = LAYERS.map(L => `${L.id}-${L.type}`);
    const map = new maplibregl.Map({
      container:          containerRef.current,
      style:              MAP_STYLE_URL,
      center:             INITIAL_VIEW.center,
      zoom:               INITIAL_VIEW.zoom,
      attributionControl: { compact: true }
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), 'top-left');
    map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }));
    // Safety net: if the container gets its real size after init (lazy
    // mount / layout), force MapLibre to remeasure so the canvas isn't 0px.
    requestAnimationFrame(() => { try { map.resize(); } catch {} });

    map.on('error', (e) => {
      const err = e?.error || e;
      const src = e?.sourceId ? ` [src:${e.sourceId}]` : '';
      const st  = err?.status ? ` ${err.status}` : '';
      const url = err?.url ? ` ${err.url}` : '';
      report({ kind: 'error', text: `${(err?.message || String(err)).slice(0, 200)}${src}${st}${url}` });
    });

    map.on('load', () => {
      // §73.333 contours (GeoJSON from saved exhibits) — amber glow, drawn
      // UNDER the station markers.  Colored by contour_id.
      const contourColor = ['match', ['get', 'contour_id'],
        'service_60dbu', '#ffb000',
        'city_54dbu',    '#f0b53f',
        'protected_40dbu', '#b8860b',
        /* default */    '#9a7b2e'];
      if (!map.getSource('genoa:contours')){
        map.addSource('genoa:contours', { type: 'geojson', data: CONTOURS_URL });
        map.addLayer({ id: 'contours-fill', type: 'fill', source: 'genoa:contours',
          paint: { 'fill-color': contourColor, 'fill-opacity': 0.05 } });
        map.addLayer({ id: 'contours-glow', type: 'line', source: 'genoa:contours',
          paint: { 'line-color': contourColor, 'line-width': 6, 'line-blur': 4, 'line-opacity': 0.35 } });
        map.addLayer({ id: 'contours-line', type: 'line', source: 'genoa:contours',
          paint: { 'line-color': contourColor, 'line-width': 1.4, 'line-opacity': 0.9 } });
      }

      for (const L of LAYERS){
        const srcId   = `genoa:${L.sourceLayer}`;
        const layerId = `${L.id}-${L.type}`;
        if (!map.getSource(srcId)){
          map.addSource(srcId, { type: 'vector', tiles: [tileUrl(L.sourceLayer)], minzoom: 0, maxzoom: 22 });
        }
        // Guard: the style.json may already define this layer (e.g. once
        // it's styled in maputnik) — don't double-add.
        if (!map.getLayer(layerId)){
          map.addLayer({
            id:             layerId,
            type:           L.type,
            source:         srcId,
            'source-layer': L.sourceLayer,
            minzoom:        L.minzoom ?? 0,
            paint:          L.paint || {}
          });
        }

        if (L.type === 'circle'){
          // Click → full attribute popup.
          map.on('click', layerId, (ev) => {
            const f = ev.features?.[0];
            if (!f) return;
            const rows = Object.entries(f.properties || {})
              .map(([k, v]) => `<div><b>${esc(k)}</b>: ${esc(v)}</div>`).join('');
            new maplibregl.Popup({ closeButton: true })
              .setLngLat(ev.lngLat)
              .setHTML(`<div style="font:12px monospace">${rows || 'feature'}</div>`)
              .addTo(map);
          });
          // Hover inspector → lightweight tooltip that follows the cursor.
          const hover = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 12 });
          map.on('mousemove', layerId, (ev) => {
            const f = ev.features?.[0];
            if (!f) return;
            map.getCanvas().style.cursor = 'pointer';
            const p = f.properties || {};
            const title = p.callsign || p.id || 'station';
            hover.setLngLat(ev.lngLat)
              .setHTML(`<div style="font:600 11px/1.3 monospace;color:#cfeefc">${esc(title)}</div>`)
              .addTo(map);
          });
          map.on('mouseleave', layerId, () => { map.getCanvas().style.cursor = ''; hover.remove(); });
        }
      }
      report({ kind: 'info', text: `style loaded · ${LAYERS.length} layer(s) added` });
    });

    // Once the map settles, report how many features actually rendered —
    // distinguishes "tile served but nothing drawn" (source-layer/paint)
    // from "rendered, just not where you're looking".
    map.on('idle', () => {
      try {
        const present = layerIds.filter(id => map.getLayer(id));
        const n = present.length ? map.queryRenderedFeatures({ layers: present }).length : 0;
        report({ kind: 'features', text: `${n} feature(s) rendered` });
      } catch { /* querying before layers exist — ignore */ }
    });

    return () => { map.remove(); mapRef.current = null; };
  }, []);   // create the map exactly once

  // Inline absolute fill as well, so the canvas is sized even if the
  // utility classes don't resolve a height for any reason.
  return <div ref={containerRef} className="absolute inset-0" style={{ position: 'absolute', inset: 0 }} />;
}
