// Live-map data endpoints (GeoJSON + report list for MapLibre).
//
// Mounted PUBLIC (FCC contour geometry + station list, not sensitive) so
// the map's same-origin fetches never hit a 401, and they degrade to
// empty results when the DB isn't configured so the map never errors.
//
//   GET /map/exhibits                  → saved reports for the picker
//   GET /map/contours.geojson?exhibit= → one report's §73.333 contours
//                                        (omit exhibit → latest per station)

import express from 'express';
import { listExhibits, listExhibitContours, PersistenceUnavailable } from '../services/persistence.js';
import { sidecars } from '../services/sidecars.js';

const router = express.Router();
const EMPTY_FC = { type: 'FeatureCollection', features: [] };

router.get('/map/exhibits', async (req, res) => {
  res.set('cache-control', 'no-cache');
  try {
    const rows = await listExhibits({ limit: 500 });
    res.json(rows.map(r => ({
      id: r.id, call: r.call_sign, facility_id: r.facility_id,
      service: r.service, frequency: r.frequency,
      lat: r.lat, lon: r.lon, created_at: r.created_at
    })));
  } catch (err) {
    if (err instanceof PersistenceUnavailable) return res.json([]);
    res.status(500).json({ error: 'exhibits unavailable', detail: String(err?.message || err) });
  }
});

router.get('/map/contours.geojson', async (req, res) => {
  res.set('cache-control', 'no-cache');
  try {
    const exhibitId = req.query.exhibit ? Number(req.query.exhibit) : null;
    const fc = await listExhibitContours({ exhibitId, limit: Number(req.query.limit) || 300 });
    res.json(fc);
  } catch (err) {
    if (err instanceof PersistenceUnavailable) return res.json(EMPTY_FC);
    res.status(500).json({ error: 'contours unavailable', detail: String(err?.message || err) });
  }
});

// FCC Antenna Structure Registration towers within radius_m of (lat,lon),
// as GeoJSON points for the live-map "FCC towers" overlay.  Proxies the
// ASR sidecar (sidecars.asr.getByLocation) so the frontend never sees an
// upstream IP and degrades to an empty collection when the sidecar isn't
// configured — the map never errors on this layer.
router.get('/map/towers.geojson', async (req, res) => {
  res.set('cache-control', 'no-cache');
  const lat = Number(req.query.lat);
  const lon = Number(req.query.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return res.json(EMPTY_FC);
  const radius_m = Math.min(Number(req.query.radius_m) || 75_000, 200_000);
  const limit    = Math.min(Number(req.query.limit) || 500, 500);
  const asr = sidecars.asr;
  if (!asr || typeof asr.getByLocation !== 'function') return res.json(EMPTY_FC);
  try {
    const r = await asr.getByLocation({ lat, lon, radius_m, limit });
    // getByLocation returns {records:[...]} for limit>1, a single record
    // for limit===1, or {available:false} when nothing is in range.
    const recs = Array.isArray(r?.records) ? r.records
               : (r?.available ? [r] : []);
    const features = recs
      .filter(t => Number.isFinite(Number(t.longitude_deg)) && Number.isFinite(Number(t.latitude_deg)))
      .map(t => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [Number(t.longitude_deg), Number(t.latitude_deg)] },
        properties: {
          asr_number:       t.asr_number ?? null,
          owner:            t.owner ?? null,
          status:           t.status ?? null,
          structure_type:   t.structure_type ?? null,
          overall_height_m: t.overall_height_m ?? null,
          structure_city:   t.structure_city ?? null,
          structure_state:  t.structure_state ?? null,
          distance_m:       t.distance_m ?? null
        }
      }));
    res.json({ type: 'FeatureCollection', features });
  } catch {
    res.json(EMPTY_FC);
  }
});

// USFS tree-canopy density sampled on an n×n grid within radius_km of
// (lat,lon), returned as GeoJSON points carrying canopy_pct (0–100) for
// in-coverage samples (CONUS only — ocean/Canada/Mexico points report no
// coverage and are dropped, never coerced to a misleading 0).  Proxies the
// geo-RF evidence sidecar with a bounded concurrency pool; best-effort —
// returns whatever sampled within the budget and degrades to an empty
// collection when the sidecar isn't configured.  ADVISORY only.
router.get('/map/canopy.geojson', async (req, res) => {
  res.set('cache-control', 'no-cache');
  const lat = Number(req.query.lat);
  const lon = Number(req.query.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return res.json(EMPTY_FC);
  const radius_km = Math.min(Math.max(Number(req.query.radius_km) || 40, 5), 150);
  const n         = Math.min(Math.max(parseInt(req.query.n, 10) || 11, 4), 14);
  const geo = sidecars.geoRfEvidence;
  if (!geo || typeof geo.sampleTreeCanopy !== 'function') return res.json(EMPTY_FC);

  // Grid of sample points (equirectangular offsets — fine at this scale).
  const dLat = radius_km / 111.32;
  const dLon = radius_km / (111.32 * Math.max(0.1, Math.cos(lat * Math.PI / 180)));
  const pts = [];
  for (let i = 0; i < n; i++){
    for (let j = 0; j < n; j++){
      pts.push([
        lon - dLon + (2 * dLon) * (j / (n - 1)),   // gx (lon)
        lat - dLat + (2 * dLat) * (i / (n - 1))    // gy (lat)
      ]);
    }
  }

  const features = [];
  let idx = 0;
  const worker = async () => {
    while (idx < pts.length){
      const [gx, gy] = pts[idx++];
      try {
        const s = await geo.sampleTreeCanopy({ lat: gy, lon: gx }, { timeoutMs: 5000 });
        const v = Number(s?.value_numeric);
        if (s?.available && Number.isFinite(v)){
          features.push({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [gx, gy] },
            properties: { canopy_pct: v }
          });
        }
      } catch { /* drop this sample */ }
    }
  };
  const CONCURRENCY = 12;
  try {
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, pts.length) }, worker));
  } catch { /* return whatever we collected */ }
  res.json({ type: 'FeatureCollection', features });
});

export default router;
