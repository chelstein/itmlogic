// MapLibre GL canvas — the ONE place that touches the GL instance.
//
// Builds the style from BASE_STYLE, then adds every entry in the LAYERS
// registry as a pg_tileserv vector source + layer.  Render only; no FCC
// math, no DB access — PostGIS is the source of truth, pg_tileserv the
// API, this is just the renderer (per the platform architecture).
//
// Reports status (loaded / rendered-feature-count / errors) via onStatus
// so the page HUD can surface what the map is actually doing.

import React, { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Protocol } from 'pmtiles';
import { MAP_STYLE_URL, INITIAL_VIEW, LAYERS, tileUrl, CONTOURS_URL, TOWERS_URL, CANOPY_URL } from './config.js';

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

// [[minLng,minLat],[maxLng,maxLat]] over every coordinate in a GeoJSON FC,
// recursing through Polygon/MultiPolygon/LineString nesting.  Returns null
// when the collection has no usable coordinates (so callers can fall back).
function boundsOf(fc){
  if (!fc || !Array.isArray(fc.features) || !fc.features.length) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, seen = false;
  const visit = (c) => {
    if (typeof c[0] === 'number'){
      const [x, y] = c;
      if (Number.isFinite(x) && Number.isFinite(y)){
        minX = Math.min(minX, x); minY = Math.min(minY, y);
        maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); seen = true;
      }
    } else for (const cc of c) visit(cc);
  };
  for (const f of fc.features) if (f?.geometry?.coordinates) visit(f.geometry.coordinates);
  return seen ? [[minX, minY], [maxX, maxY]] : null;
}

export default function MapView({ onStatus, selected, overlays }){
  const containerRef = useRef(null);
  const mapRef       = useRef(null);
  const [ready, setReady] = useState(false);   // map 'load' fired
  // Latest callback via ref so status updates never tear down the map.
  const statusRef    = useRef(onStatus);
  statusRef.current  = onStatus;
  const report = (s) => { if (statusRef.current) statusRef.current(s); };
  // Latest overlays via ref so the pulse animation reads current toggle
  // state without restarting.  rafRef holds the beacon-pulse rAF handle;
  // towersHasDataRef gates the pulse so it stays idle (lets the map reach
  // 'idle') until towers are actually loaded AND the overlay is on.
  const overlaysRef       = useRef(overlays);
  overlaysRef.current     = overlays;
  const rafRef            = useRef(null);
  const towersHasDataRef  = useRef(false);
  // The tree-canopy grid is expensive to sample, so it's fetched on demand
  // (only while the overlay is on).  Tracks the report id whose canopy is
  // currently loaded so toggling off→on doesn't refetch the same area.
  const canopyKeyRef      = useRef(null);

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
      // Tree-canopy density field — graduated green dots, drawn at the
      // BOTTOM of the data stack (under contours/stations/towers) as
      // environmental context.  Loaded on demand by the canopy effect.
      if (!map.getSource('genoa:canopy')){
        map.addSource('genoa:canopy', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        map.addLayer({ id: 'canopy-dots', type: 'circle', source: 'genoa:canopy',
          layout: { visibility: 'none' },   // off by default (opt-in)
          paint: {
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 6, 3, 9, 6, 12, 10, 15, 16],
            'circle-color':  ['interpolate', ['linear'], ['get', 'canopy_pct'],
              0, '#16361a', 20, '#27632b', 45, '#3fa53f', 70, '#74e07a', 100, '#bdffb4'],
            'circle-opacity': ['interpolate', ['linear'], ['get', 'canopy_pct'],
              0, 0.12, 20, 0.42, 55, 0.66, 100, 0.82],
            'circle-blur': 0.5
          } });
      }

      // §73.333 contours (GeoJSON from saved exhibits) — amber glow, drawn
      // UNDER the station markers.  Colored by contour_id.
      const contourColor = ['match', ['get', 'contour_id'],
        'service_60dbu', '#ffb000',
        'city_54dbu',    '#f0b53f',
        'protected_40dbu', '#b8860b',
        /* default */    '#9a7b2e'];
      if (!map.getSource('genoa:contours')){
        // Starts empty; the selected-report effect sets the data.
        map.addSource('genoa:contours', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
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

      // FCC ASR towers — pulsing red/white obstruction-beacon dots, drawn
      // ON TOP of everything.  Data is set per selected report (nearby
      // structures) by the selected-report effect; starts empty.
      if (!map.getSource('genoa:towers')){
        map.addSource('genoa:towers', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        // Expanding white halo (radius + opacity animated each frame).
        map.addLayer({ id: 'towers-pulse', type: 'circle', source: 'genoa:towers',
          paint: { 'circle-color': '#ffffff', 'circle-radius': 6, 'circle-opacity': 0.0, 'circle-blur': 0.3 } });
        // Solid red core with a white outline — reads as an aviation beacon.
        map.addLayer({ id: 'towers-core', type: 'circle', source: 'genoa:towers',
          paint: { 'circle-color': '#ff3b30', 'circle-radius': 4.5,
                   'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1.6, 'circle-opacity': 0.95 } });

        map.on('click', 'towers-core', (ev) => {
          const f = ev.features?.[0];
          if (!f) return;
          const p = f.properties || {};
          const line = (k, v) => (v == null || v === '' ? '' : `<div><b>${esc(k)}</b>: ${esc(v)}</div>`);
          const h = p.overall_height_m != null ? `${Math.round(Number(p.overall_height_m))} m AGL` : null;
          const where = [p.structure_city, p.structure_state].filter(Boolean).join(', ');
          new maplibregl.Popup({ closeButton: true })
            .setLngLat(ev.lngLat)
            .setHTML(`<div style="font:12px monospace">`
              + line('ASR', p.asr_number) + line('owner', p.owner) + line('type', p.structure_type)
              + line('height', h) + line('status', p.status) + line('loc', where) + `</div>`)
            .addTo(map);
        });
        map.on('mouseenter', 'towers-core', () => { map.getCanvas().style.cursor = 'pointer'; });
        map.on('mouseleave', 'towers-core', () => { map.getCanvas().style.cursor = ''; });

        // Beacon pulse.  Only dirties the map while towers are loaded AND
        // the overlay is on — otherwise the loop spins cheaply and lets the
        // map reach 'idle' so the feature-count status can report.
        const pulseStart = performance.now();
        const pulse = () => {
          const m = mapRef.current;
          if (!m){ return; }
          const on = overlaysRef.current?.towers !== false;
          if (on && towersHasDataRef.current && m.getLayer('towers-pulse')){
            const phase = ((performance.now() - pulseStart) % 1600) / 1600;
            m.setPaintProperty('towers-pulse', 'circle-radius', 5 + phase * 16);
            m.setPaintProperty('towers-pulse', 'circle-opacity', 0.5 * (1 - phase));
          }
          rafRef.current = requestAnimationFrame(pulse);
        };
        rafRef.current = requestAnimationFrame(pulse);
      }

      report({ kind: 'info', text: `style loaded · ${LAYERS.length} layer(s) added` });
      setReady(true);
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

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      map.remove();
      mapRef.current = null;
    };
  }, []);   // create the map exactly once

  // Load the picked report's contours into the source, then SNAP the
  // viewport to the contour extent.  We fetch the GeoJSON ourselves (rather
  // than handing setData a URL) so we can frame the map to the geometry —
  // otherwise the camera relies on lat/lon, which Postgres returns as
  // strings, so the old Number.isFinite guard silently failed and never
  // moved the map.
  useEffect(() => {
    if (!ready || !mapRef.current || !selected) return;
    const map = mapRef.current;
    const cSrc = map.getSource('genoa:contours');
    const tSrc = map.getSource('genoa:towers');
    const url = `${CONTOURS_URL}?exhibit=${encodeURIComponent(selected.id)}`;
    const lat = Number(selected.lat), lon = Number(selected.lon);
    let cancelled = false;

    const flyToStation = () => {
      if (Number.isFinite(lat) && Number.isFinite(lon)){
        map.flyTo({ center: [lon, lat], zoom: 9, speed: 0.8 });
      }
    };

    // Pull the FCC towers near this report (centered + radius from the
    // contour extent when we have one, else the station point + 75 km).
    const loadTowers = (cLng, cLat, radius_m) => {
      if (!(tSrc && tSrc.setData) || !Number.isFinite(cLng) || !Number.isFinite(cLat)) return;
      const u = `${TOWERS_URL}?lat=${cLat}&lon=${cLng}&radius_m=${Math.round(radius_m)}`;
      fetch(u, { credentials: 'same-origin' })
        .then(r => (r.ok ? r.json() : { type: 'FeatureCollection', features: [] }))
        .then(fc => {
          if (cancelled) return;
          const safe = fc && Array.isArray(fc.features) ? fc : { type: 'FeatureCollection', features: [] };
          tSrc.setData(safe);
          towersHasDataRef.current = safe.features.length > 0;
        })
        .catch(() => {});
    };

    fetch(url, { credentials: 'same-origin' })
      .then(r => (r.ok ? r.json() : { type: 'FeatureCollection', features: [] }))
      .then(fc => {
        if (cancelled) return;
        if (cSrc && cSrc.setData) cSrc.setData(fc);
        const b = boundsOf(fc);
        if (b){
          map.fitBounds(b, { padding: 64, maxZoom: 11, duration: 900 });
          const cLng = (b[0][0] + b[1][0]) / 2, cLat = (b[0][1] + b[1][1]) / 2;
          const spanLatM = (b[1][1] - b[0][1]) * 111_320;
          const spanLonM = (b[1][0] - b[0][0]) * 111_320 * Math.cos(cLat * Math.PI / 180);
          const radius_m = Math.min(200_000, Math.max(40_000, Math.hypot(spanLatM, spanLonM) / 2 * 1.15));
          loadTowers(cLng, cLat, radius_m);
        } else {
          flyToStation();
          loadTowers(lon, lat, 75_000);
        }
      })
      .catch(() => { if (!cancelled){ flyToStation(); loadTowers(lon, lat, 75_000); } });

    return () => { cancelled = true; };
  }, [ready, selected]);

  // Overlay visibility toggles.
  useEffect(() => {
    if (!ready || !mapRef.current || !overlays) return;
    const map = mapRef.current;
    const vis = (id, on) => { if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none'); };
    LAYERS.forEach(L => vis(`${L.id}-${L.type}`, overlays.stations !== false));
    ['contours-fill', 'contours-glow', 'contours-line'].forEach(id => vis(id, overlays.contours !== false));
    ['towers-pulse', 'towers-core'].forEach(id => vis(id, overlays.towers !== false));
    vis('canopy-dots', overlays.canopy === true);   // opt-in, default off
  }, [ready, overlays]);

  // Tree-canopy overlay — sampled on demand (it's expensive).  Fetches the
  // canopy density grid only while the overlay is on, sampling a fixed
  // radius around the selected station, and refetches when the report
  // changes.  Toggling off→on for the same report reuses the loaded grid.
  const canopyOn = overlays?.canopy === true;
  useEffect(() => {
    if (!ready || !mapRef.current || !selected || !canopyOn) return;
    if (canopyKeyRef.current === selected.id) return;   // already loaded for this report
    const map = mapRef.current;
    const src = map.getSource('genoa:canopy');
    const lat = Number(selected.lat), lon = Number(selected.lon);
    if (!(src && src.setData) || !Number.isFinite(lat) || !Number.isFinite(lon)) return;
    let cancelled = false;

    report({ kind: 'info', text: 'sampling tree canopy…' });
    fetch(`${CANOPY_URL}?lat=${lat}&lon=${lon}&radius_km=40`, { credentials: 'same-origin' })
      .then(r => (r.ok ? r.json() : { type: 'FeatureCollection', features: [] }))
      .then(fc => {
        if (cancelled) return;
        const safe = fc && Array.isArray(fc.features) ? fc : { type: 'FeatureCollection', features: [] };
        src.setData(safe);
        canopyKeyRef.current = selected.id;
        report({ kind: 'info', text: `tree canopy · ${safe.features.length} sample(s)` });
      })
      .catch(() => {});

    return () => { cancelled = true; };
  }, [ready, selected, canopyOn]);

  // Inline absolute fill as well, so the canvas is sized even if the
  // utility classes don't resolve a height for any reason.
  return <div ref={containerRef} className="absolute inset-0" style={{ position: 'absolute', inset: 0 }} />;
}
