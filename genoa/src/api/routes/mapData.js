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

export default router;
