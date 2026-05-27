// Live-map geospatial config.
//
// Tiles come from Martin (vector tile server) via the same-origin /tiles
// proxy. The base is env-driven so ONE build works everywhere:
//   • production  → leave unset; defaults to same-origin '/tiles'
//                   (App Platform proxy → droplet Martin :3000, TLS).
//   • local dev   → the Vite dev server proxies /tiles to Martin.
//
// LAYERS is the single source of truth for what renders.  Add a layer by
// adding an entry here — never by hand-coding addLayer calls.  Each entry
// maps a Martin source (its source-layer name) to its MapLibre paint.

// MapLibre needs ABSOLUTE tile URLs — its tile worker calls new Request()
// with no base, so a leading-slash path ('/tiles/…') throws "Failed to
// parse URL".  Resolve a same-origin base against window.location.origin
// (→ https://host/tiles in prod, http://localhost:5173/tiles in dev).
const RAW_TILES_BASE = String(import.meta.env.VITE_TILES_BASE || '/tiles').replace(/\/+$/, '');
export const TILES_BASE = (RAW_TILES_BASE.startsWith('/') && typeof window !== 'undefined')
  ? window.location.origin + RAW_TILES_BASE
  : RAW_TILES_BASE;

// Martin serves each source at {base}/{source}/{z}/{x}/{y} (no extension).
export function tileUrl(sourceLayer){
  return `${TILES_BASE}/${sourceLayer}/{z}/{x}/{y}`;
}

export const LAYERS = [
  {
    id:          'stations',        // base for the MapLibre layer id (purpose-suffixed in MapView)
    sourceLayer: 'stations',        // Martin source id == MVT source-layer name (geo.stations → "stations")
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
  //  { id: 'contours', sourceLayer: 'contours', type: 'line', paint: {...} }
  //  { id: 'coverage', sourceLayer: 'coverage', type: 'fill', paint: {...} }
];

// Initial view — centered on the current data (KAZM / Sedona).  Zoomed in
// enough that a single station reads as placed-on-a-map, not a dot in a
// void.
export const INITIAL_VIEW = { center: [-111.820544, 34.860547], zoom: 9 };

// Map style — a same-origin style.json served by the app
// (src/ui/public-static/styles/genoa.json → /styles/genoa.json), so it
// loads even when an ad-blocker kills external CDNs, and can be edited
// visually in maputnik (point maputnik at {origin}/styles/genoa.json)
// without a code change.  The style owns the BASEMAP; the data LAYERS
// above are added on top by MapView so they stay data-driven.  Override
// with VITE_MAP_STYLE.  Resolved to absolute for consistency with tiles.
const RAW_MAP_STYLE = String(import.meta.env.VITE_MAP_STYLE || '/styles/genoa.json');
export const MAP_STYLE_URL = (RAW_MAP_STYLE.startsWith('/') && typeof window !== 'undefined')
  ? window.location.origin + RAW_MAP_STYLE
  : RAW_MAP_STYLE;
