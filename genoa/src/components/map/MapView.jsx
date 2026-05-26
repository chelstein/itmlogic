// MapLibre GL canvas — the ONE place that touches the GL instance.
//
// Builds the style from BASE_STYLE, then adds every entry in the LAYERS
// registry as a pg_tileserv vector source + layer.  Render only; no FCC
// math, no DB access — PostGIS is the source of truth, pg_tileserv the
// API, this is just the renderer (per the platform architecture).

import React, { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { BASE_STYLE, INITIAL_VIEW, LAYERS, tileUrl } from './config.js';

// Escape feature property values before injecting into popup HTML — tile
// attributes are external input and could contain markup.
function esc(v){
  return String(v).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

export default function MapView({ onError }){
  const containerRef = useRef(null);
  const mapRef = useRef(null);

  useEffect(() => {
    if (mapRef.current || !containerRef.current) return;
    const map = new maplibregl.Map({
      container:          containerRef.current,
      style:              BASE_STYLE,
      center:             INITIAL_VIEW.center,
      zoom:               INITIAL_VIEW.zoom,
      attributionControl: { compact: true }
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), 'top-left');
    map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }));

    map.on('error', (e) => { if (onError) onError(e?.error || e); });

    map.on('load', () => {
      for (const L of LAYERS){
        const srcId   = `pgts:${L.sourceLayer}`;
        const layerId = `${L.id}-${L.type}`;
        if (!map.getSource(srcId)){
          map.addSource(srcId, { type: 'vector', tiles: [tileUrl(L.sourceLayer)], minzoom: 0, maxzoom: 22 });
        }
        map.addLayer({
          id:             layerId,
          type:           L.type,
          source:         srcId,
          'source-layer': L.sourceLayer,
          minzoom:        L.minzoom ?? 0,
          paint:          L.paint || {}
        });

        // Click → attribute popup (point/circle layers).
        if (L.type === 'circle'){
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
          map.on('mouseenter', layerId, () => { map.getCanvas().style.cursor = 'pointer'; });
          map.on('mouseleave', layerId, () => { map.getCanvas().style.cursor = ''; });
        }
      }
    });

    return () => { map.remove(); mapRef.current = null; };
  }, [onError]);

  return <div ref={containerRef} className="absolute inset-0" />;
}
