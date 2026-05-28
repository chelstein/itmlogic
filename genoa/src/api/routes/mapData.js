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

export default router;
