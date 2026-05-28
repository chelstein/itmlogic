// Live-map data endpoints (GeoJSON for MapLibre sources).
//
// /map/contours.geojson — §73.333 contour polygons from the latest saved
// exhibit per station, merged into one FeatureCollection.  No recompute;
// read straight from saved exhibit payloads.  Mounted PUBLIC (FCC contour
// geometry, not sensitive) so the map's GeoJSON source loads without auth
// edge cases; returns an empty FeatureCollection when the DB isn't
// configured so the map never errors.

import express from 'express';
import { listExhibitContours, PersistenceUnavailable } from '../services/persistence.js';

const router = express.Router();
const EMPTY = { type: 'FeatureCollection', features: [] };

router.get('/map/contours.geojson', async (req, res) => {
  res.set('cache-control', 'no-cache');
  try {
    const fc = await listExhibitContours({ limit: Number(req.query.limit) || 300 });
    res.json(fc);
  } catch (err) {
    if (err instanceof PersistenceUnavailable) return res.json(EMPTY);
    res.status(500).json({ error: 'contours unavailable', detail: String(err?.message || err) });
  }
});

export default router;
