import express from 'express';
import { computeExhibit, getOrRunValidation } from '../services/exhibitService.js';
import { saveExhibit, listExhibits, getExhibit, PersistenceUnavailable } from '../services/persistence.js';
import { asyncHandler } from '../middleware/errors.js';

import { exportJson, JSON_CONTENT_TYPE }       from '../../exports/json/exporter.js';
import { exportTxt,  TXT_CONTENT_TYPE  }       from '../../exports/txt/exporter.js';
import { exportGeoJson, GEOJSON_CONTENT_TYPE } from '../../exports/geojson/exporter.js';
import { exportPdf,  PDF_CONTENT_TYPE  }       from '../../exports/pdf/stub.js';

import { readiness } from '../../types/readiness.js';

const r = express.Router();

// POST /api/exhibits/compute  — pure compute, no persistence.
r.post('/exhibits/compute', asyncHandler(async (req, res) => {
  if (!req.body || typeof req.body !== 'object') return res.status(400).json({ error: 'BAD_REQUEST', message: 'JSON body required' });
  const exhibit = await computeExhibit(req.body);
  res.json(exhibit);
}));

// POST /api/exhibits/save  — compute (if not already) and persist.
r.post('/exhibits/save', asyncHandler(async (req, res) => {
  let exhibit = req.body?.exhibit;
  if (!exhibit) exhibit = await computeExhibit(req.body || {});
  const saved = await saveExhibit(exhibit);
  res.json({ id: saved.id, created_at: saved.created_at, exhibit });
}));

// POST /api/exhibits  — backward-compat: persist a fully-formed exhibit.
r.post('/exhibits', asyncHandler(async (req, res) => {
  const exhibit = req.body;
  if (!exhibit || !exhibit.station_inputs) return res.status(400).json({ error: 'BAD_REQUEST', message: 'exhibit body required' });
  const saved = await saveExhibit(exhibit);
  res.json({ id: saved.id, created_at: saved.created_at });
}));

// GET /api/exhibits  — list.
r.get('/exhibits', asyncHandler(async (req, res) => {
  const limit = parseInt(req.query.limit, 10) || 100;
  const rows = await listExhibits({ limit });
  res.json(rows);
}));

// GET /api/exhibits/:id
r.get('/exhibits/:id', asyncHandler(async (req, res) => {
  const row = await getExhibit(req.params.id);
  if (!row) return res.status(404).json({ error: 'NOT_FOUND' });
  res.json(row);
}));

// GET /api/exhibits/:id/readiness  — re-derive readiness from stored payload.
r.get('/exhibits/:id/readiness', asyncHandler(async (req, res) => {
  const row = await getExhibit(req.params.id);
  if (!row) return res.status(404).json({ error: 'NOT_FOUND' });
  const exhibit = row.payload;
  const fr = readiness({ warnings: exhibit.warnings || [], exhibit });
  res.json({ exhibit_id: row.id, ...fr });
}));

// GET /api/exhibits/:id/export/json
r.get('/exhibits/:id/export/json', asyncHandler(async (req, res) => {
  const row = await getExhibit(req.params.id);
  if (!row) return res.status(404).json({ error: 'NOT_FOUND' });
  const exhibit = row.payload;
  exhibit.exports = { ...(exhibit.exports || {}), json: 'rendered', generated_at: new Date().toISOString() };
  const body = exportJson(exhibit, { pretty: true });
  res.type(JSON_CONTENT_TYPE);
  res.set('X-Genoa-Exports-Generated-At', exhibit.exports.generated_at);
  res.set('Content-Disposition', `attachment; filename="${stem(row)}.exhibit.json"`);
  res.send(body);
}));

// GET /api/exhibits/:id/export/txt
r.get('/exhibits/:id/export/txt', asyncHandler(async (req, res) => {
  const row = await getExhibit(req.params.id);
  if (!row) return res.status(404).json({ error: 'NOT_FOUND' });
  const exhibit = row.payload;
  exhibit.exports = { ...(exhibit.exports || {}), txt: 'rendered', generated_at: new Date().toISOString() };
  const body = exportTxt(exhibit);
  res.type(TXT_CONTENT_TYPE);
  res.set('X-Genoa-Exports-Generated-At', exhibit.exports.generated_at);
  res.set('Content-Disposition', `attachment; filename="${stem(row)}.exhibit.txt"`);
  res.send(body);
}));

// GET /api/exhibits/:id/export/geojson
r.get('/exhibits/:id/export/geojson', asyncHandler(async (req, res) => {
  const row = await getExhibit(req.params.id);
  if (!row) return res.status(404).json({ error: 'NOT_FOUND' });
  const exhibit = row.payload;
  exhibit.exports = { ...(exhibit.exports || {}), geojson: 'rendered', generated_at: new Date().toISOString() };
  const body = exportGeoJson(exhibit, { pretty: true });
  res.type(GEOJSON_CONTENT_TYPE);
  res.set('X-Genoa-Exports-Generated-At', exhibit.exports.generated_at);
  res.set('Content-Disposition', `attachment; filename="${stem(row)}.contours.geojson"`);
  res.send(body);
}));

// GET /api/exhibits/:id/export/pdf  — wired but explicitly 501 today.
r.get('/exhibits/:id/export/pdf', asyncHandler(async (req, res) => {
  try {
    const row = await getExhibit(req.params.id);
    if (!row) return res.status(404).json({ error: 'NOT_FOUND' });
    const body = exportPdf(row.payload);
    res.type(PDF_CONTENT_TYPE);
    res.send(body);
  } catch (err){
    if (err.code === 'PDF_NOT_IMPLEMENTED'){
      return res.status(err.http_status || 501).json({
        error: err.code, message: err.message, warning: err.warning
      });
    }
    throw err;
  }
}));

// GET /api/validation  — current validation suite snapshot.
r.get('/validation', asyncHandler(async (_req, res) => {
  const v = await getOrRunValidation();
  res.json(v);
}));

function stem(row){
  return (row.call_sign || ('exhibit_' + row.id)).replace(/[^A-Z0-9]/gi, '_');
}

// Translate persistence-unavailable into a clean 503.
r.use((err, _req, res, next) => {
  if (err instanceof PersistenceUnavailable){
    return res.status(503).json({ error: err.code, message: err.message });
  }
  next(err);
});

export default r;
