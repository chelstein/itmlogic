import test from 'node:test';
import assert from 'node:assert/strict';

import { buildExhibit, FM_CLASS_A } from './_helpers.js';
import { exportJson }    from '../exports/json/exporter.js';
import { exportTxt }     from '../exports/txt/exporter.js';
import { exportGeoJson } from '../exports/geojson/exporter.js';
import { exportPdf }     from '../exports/pdf/stub.js';

test('JSON export round-trips and validates', async () => {
  const x = await buildExhibit(FM_CLASS_A);
  const s = exportJson(x);
  const back = JSON.parse(s);
  assert.equal(back.schema.name, 'genoa.exhibit.v2');
  assert.equal(back.radial_table.length, x.radial_table.length);
});

test('TXT export contains required engineering sections', async () => {
  const x = await buildExhibit(FM_CLASS_A);
  const t = exportTxt(x);
  for (const section of [
    'GENOA — FCC PROPAGATION EXHIBIT',
    '-- STATION INPUTS --',
    '-- CALCULATION METHOD --',
    '-- CONTOUR RESULTS --',
    '-- RADIAL TABLE',
    '-- WARNINGS --',
    '-- FILING READINESS --',
    '-- VERSION BLOCK --',
    '-- REPRODUCIBILITY STATEMENT --',
    '-- ENGINEERING CERTIFICATION PLACEHOLDER --'
  ]){
    assert.ok(t.includes(section), 'TXT missing section ' + section);
  }
  assert.ok(t.includes(x.calculation_method.name), 'TXT must reference FCC method');
});

test('GeoJSON export is parseable and valid', async () => {
  const x = await buildExhibit(FM_CLASS_A);
  const g = JSON.parse(exportGeoJson(x));
  assert.equal(g.type, 'FeatureCollection');
  for (const f of g.features){
    assert.equal(f.type, 'Feature');
    const ring = f.geometry.coordinates[0];
    assert.deepEqual(ring[0], ring[ring.length - 1]);
  }
});

test('PDF export throws PDF_NOT_IMPLEMENTED with structured warning', async () => {
  const x = await buildExhibit(FM_CLASS_A);
  let caught = null;
  try { exportPdf(x); } catch (e){ caught = e; }
  assert.ok(caught, 'expected PDF export to throw');
  assert.equal(caught.code, 'PDF_NOT_IMPLEMENTED');
  assert.equal(caught.http_status, 501);
  assert.ok(caught.warning?.code, 'PDF error must carry a structured warning');
});
