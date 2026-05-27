// Live-map geospatial config.
//
// The tile base is env-driven so ONE build works everywhere:
//   • production  → leave unset; defaults to same-origin '/tiles'
//                   (the App Platform proxy → droplet pg_tileserv, TLS).
//   • local dev   → VITE_TILES_BASE=http://165.245.171.116:7800
//                   (Vite dev server is HTTP, so no mixed-content block).
//
// LAYERS is the single source of truth for what renders.  Add a layer by
// adding an entry here — never by hand-coding addLayer calls.  Each entry
// maps a pg_tileserv source-layer (schema.table) to its MapLibre paint.

// MapLibre needs ABSOLUTE tile URLs — its tile worker calls new Request()
// with no base, so a leading-slash path ('/tiles/…') throws "Failed to
// parse URL".  Resolve a same-origin base against window.location.origin
// (→ https://host/tiles in prod, http://localhost:5173/tiles in dev).
const RAW_TILES_BASE = String(import.meta.env.VITE_TILES_BASE || '/tiles').replace(/\/+$/, '');
export const TILES_BASE = (RAW_TILES_BASE.startsWith('/') && typeof window !== 'undefined')
  ? window.location.origin + RAW_TILES_BASE
  : RAW_TILES_BASE;

// pg_tileserv serves each table at {base}/{schema.table}/{z}/{x}/{y}.pbf.
export function tileUrl(sourceLayer){
  return `${TILES_BASE}/${sourceLayer}/{z}/{x}/{y}.pbf`;
}

export const LAYERS = [
  {
    id:          'stations',        // base for the MapLibre layer id (purpose-suffixed in MapView)
    sourceLayer: 'geo.stations',    // pg_tileserv table id == MVT source-layer name
    type:        'circle',
    label:       'Stations',
    minzoom:     0,
    paint: {
      // Big + bright so a station is unmistakable even with no basemap.
      'circle-radius':       ['interpolate', ['linear'], ['zoom'], 4, 6, 10, 12, 14, 20],
      'circle-color':        '#ffb000',     // bright amber
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 2,
      'circle-opacity':      0.95
    }
  }
  // Future (add when the schemas land — config only, no component changes):
  //  { id: 'contours', sourceLayer: 'derived.contours', type: 'line', paint: {...} }
  //  { id: 'coverage', sourceLayer: 'geo.coverage',     type: 'fill', paint: {...} }
];

// Initial view — centered on the current data (KAZM / Sedona).  Zoomed in
// enough that a single station reads as placed-on-a-map, not a dot in a
// void.
export const INITIAL_VIEW = { center: [-111.820544, 34.860547], zoom: 9 };

// Basemap.  A solid themed background layer sits UNDER an optional CARTO
// dark raster: if the external tiles load you get a real basemap; if they
// don't (offline, ad-blocker, CDN hiccup) the map is still a deliberate
// dark surface rather than a broken black void.  Swap for a vector style
// — e.g. your maputnik output or self-hosted PMTiles — later.
export const BASE_STYLE = {
  version: 8,
  sources: {
    'carto-dark': {
      type: 'raster',
      tiles: [
        'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
        'https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png'
      ],
      tileSize: 256,
      attribution: '© OpenStreetMap contributors © CARTO'
    }
  },
  layers: [
    { id: 'bg',         type: 'background', paint: { 'background-color': '#0a1a25' } },
    { id: 'carto-dark', type: 'raster',     source: 'carto-dark' }
  ]
};
