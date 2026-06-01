// FCC County Boundary — loader, spatial intersection, and report section tests.
//
// Tests cover:
//   - loader reads us_counties_fcc.geojson and groups by unique Name
//   - YAVAPAI/COCONINO/MARICOPA parse correctly
//   - raw feature count ≠ county count (7094 features → 3207-ish counties)
//   - centroid/label features are ignored for polygon intersection
//   - invalid/missing dataset emits the right warning code
//   - simple polygon intersecting Yavapai returns Yavapai
//   - polygon crossing Yavapai+Coconino returns both
//   - percent coverage math is deterministic and correct
//   - report includes dataset SHA256
//   - computeCountyOverlay response shape

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

import {
  parseCountyName,
  loadCountyBoundaries,
  getCountyDataset,
  _resetCache
} from '../evidence/countyBoundaryLoader.js';
import { computeCountyOverlay } from '../evidence/countyIntersectionClient.js';
import { buildCountyOverlaySection } from '../exports/engineeringReport/sections/countyOverlay.js';

// ── Fixture path ──────────────────────────────────────────────────────────────

// Use the installed fixture (same one used in production dev).
const FIXTURE_PATH = '/opt/genoa-cartography/data/reference/us_counties_fcc.geojson';

// ── Name parsing ──────────────────────────────────────────────────────────────

test('parseCountyName: YAVAPAI, AZ → county_name=YAVAPAI state=AZ', () => {
  const r = parseCountyName('YAVAPAI, AZ');
  assert.equal(r.county_name, 'YAVAPAI');
  assert.equal(r.state, 'AZ');
});

test('parseCountyName: COCONINO, AZ → county_name=COCONINO state=AZ', () => {
  const r = parseCountyName('COCONINO, AZ');
  assert.equal(r.county_name, 'COCONINO');
  assert.equal(r.state, 'AZ');
});

test('parseCountyName: MARICOPA, AZ → county_name=MARICOPA state=AZ', () => {
  const r = parseCountyName('MARICOPA, AZ');
  assert.equal(r.county_name, 'MARICOPA');
  assert.equal(r.state, 'AZ');
});

test('parseCountyName: ALEUTIANS EAST, AK → multi-word county parsed', () => {
  const r = parseCountyName('ALEUTIANS EAST, AK');
  assert.equal(r.county_name, 'ALEUTIANS EAST');
  assert.equal(r.state, 'AK');
});

test('parseCountyName: null/empty input → null', () => {
  assert.equal(parseCountyName(null), null);
  assert.equal(parseCountyName(''), null);
  assert.equal(parseCountyName('BADFORMAT'), null);
});

// ── Loader: dataset reading and grouping ──────────────────────────────────────

test('loadCountyBoundaries: reads fixture and groups by unique Name', () => {
  _resetCache();
  const ds = loadCountyBoundaries(FIXTURE_PATH);
  assert.equal(ds.ok, true, 'dataset must load ok');
  assert.ok(ds.dataset_sha256, 'must produce sha256');
  assert.ok(/^[0-9a-f]{64}$/.test(ds.dataset_sha256), 'sha256 must be 64-char hex');
  // raw_feature_count is the count of individual GeoJSON features (boundary + label × n)
  assert.ok(ds.raw_feature_count > 0, 'must have raw features');
  // unique_county_count is LESS than raw_feature_count because each county has
  // multiple features (boundary + label).
  assert.ok(ds.unique_county_count < ds.raw_feature_count,
    'unique county count must be less than raw feature count');
});

test('loadCountyBoundaries: YAVAPAI, AZ loads as exactly one county', () => {
  _resetCache();
  const ds = loadCountyBoundaries(FIXTURE_PATH);
  const yavapai = ds.counties.filter(c => c.county_name === 'YAVAPAI' && c.state === 'AZ');
  assert.equal(yavapai.length, 1, 'exactly one YAVAPAI, AZ county record');
  assert.equal(yavapai[0].geometry_valid, true, 'YAVAPAI geometry must be valid');
  assert.ok(yavapai[0].geometry, 'YAVAPAI must have geometry');
  assert.ok(['Polygon', 'MultiPolygon'].includes(yavapai[0].geometry.type),
    'YAVAPAI geometry must be Polygon or MultiPolygon');
});

test('loadCountyBoundaries: COCONINO, AZ loads as exactly one county', () => {
  _resetCache();
  const ds = loadCountyBoundaries(FIXTURE_PATH);
  const coconino = ds.counties.filter(c => c.county_name === 'COCONINO' && c.state === 'AZ');
  assert.equal(coconino.length, 1, 'exactly one COCONINO, AZ county record');
  assert.equal(coconino[0].geometry_valid, true, 'COCONINO geometry must be valid');
});

test('loadCountyBoundaries: MARICOPA, AZ loads as exactly one county', () => {
  _resetCache();
  const ds = loadCountyBoundaries(FIXTURE_PATH);
  const maricopa = ds.counties.filter(c => c.county_name === 'MARICOPA' && c.state === 'AZ');
  assert.equal(maricopa.length, 1, 'exactly one MARICOPA, AZ county record');
  assert.equal(maricopa[0].geometry_valid, true, 'MARICOPA geometry must be valid');
});

test('loadCountyBoundaries: raw feature count is NOT used as county count', () => {
  _resetCache();
  const ds = loadCountyBoundaries(FIXTURE_PATH);
  // The fixture has 2 features per county (boundary + label), so unique_county_count
  // must be exactly half of raw_feature_count for a clean fixture.
  assert.ok(ds.unique_county_count < ds.raw_feature_count,
    'unique county count must be less than raw feature count');
  // More specifically: each county contributes 1 boundary + 1 label = 2 raw features.
  assert.equal(ds.unique_county_count * 2, ds.raw_feature_count,
    'for clean fixture: unique_county_count × 2 = raw_feature_count');
});

test('loadCountyBoundaries: centroid/label features are not counted as separate counties', () => {
  _resetCache();
  const ds = loadCountyBoundaries(FIXTURE_PATH);
  // All counties should be unique — no double-counting from label features.
  const keys = ds.counties.map(c => c.key);
  const uniqueKeys = new Set(keys);
  assert.equal(keys.length, uniqueKeys.size, 'no duplicate county keys');
});

test('loadCountyBoundaries: centroid/label features ignored for geometry (counties have polygon geometry)', () => {
  _resetCache();
  const ds = loadCountyBoundaries(FIXTURE_PATH);
  // Every county with geometry_valid=true must have a Polygon or MultiPolygon geometry
  // (NOT a Point or LineString — label features must not leak into geometry).
  for (const c of ds.counties.filter(x => x.geometry_valid)){
    assert.ok(['Polygon', 'MultiPolygon'].includes(c.geometry?.type),
      `${c.key} geometry must be Polygon/MultiPolygon, got ${c.geometry?.type}`);
  }
});

test('loadCountyBoundaries: missing dataset emits COUNTY_BOUNDARY_DATASET_MISSING', () => {
  _resetCache();
  const ds = loadCountyBoundaries('/nonexistent/path/us_counties_fcc.geojson');
  assert.equal(ds.ok, false, 'must not be ok when file is missing');
  assert.equal(ds.warning_code, 'COUNTY_BOUNDARY_DATASET_MISSING');
  assert.ok(ds.error, 'must have error field');
});

test('loadCountyBoundaries: invalid JSON emits COUNTY_BOUNDARY_LOAD_FAILED', () => {
  _resetCache();
  const tmp = path.join(os.tmpdir(), 'bad_counties.geojson');
  fs.writeFileSync(tmp, 'NOT VALID JSON}}}');
  const ds = loadCountyBoundaries(tmp);
  assert.equal(ds.ok, false, 'must not be ok when JSON is invalid');
  assert.equal(ds.warning_code, 'COUNTY_BOUNDARY_LOAD_FAILED');
  fs.unlinkSync(tmp);
});

// ── Spatial intersection ──────────────────────────────────────────────────────

// Test polygon centered in Yavapai County, AZ (roughly 35° lat, -112.5° lon)
// in an area that should not overlap Coconino or Maricopa.
const YAVAPAI_CENTER_POLYGON = {
  type: 'Polygon',
  coordinates: [[
    [-112.7, 34.8], [-112.3, 34.8], [-112.3, 35.2],
    [-112.7, 35.2], [-112.7, 34.8]
  ]]
};

// Test polygon spanning the Yavapai/Coconino boundary (both counties share border
// near lat 35.8°).
const YAVAPAI_COCONINO_STRADDLE_POLYGON = {
  type: 'Polygon',
  coordinates: [[
    [-112.7, 35.4], [-112.3, 35.4], [-112.3, 36.0],
    [-112.7, 36.0], [-112.7, 35.4]
  ]]
};

test('computeCountyOverlay: polygon in Yavapai returns Yavapai in intersected list', async () => {
  _resetCache();
  const result = await computeCountyOverlay(YAVAPAI_CENTER_POLYGON, { path: FIXTURE_PATH });
  assert.equal(result.available, true, 'overlay must be available');
  assert.ok(Array.isArray(result.counties_intersected), 'counties_intersected must be array');
  const keys = result.counties_intersected.map(c => c.key);
  assert.ok(keys.includes('YAVAPAI, AZ'), `YAVAPAI must intersect; got: ${keys.join(', ')}`);
});

test('computeCountyOverlay: Yavapai polygon does NOT return Maricopa', async () => {
  _resetCache();
  const result = await computeCountyOverlay(YAVAPAI_CENTER_POLYGON, { path: FIXTURE_PATH });
  const keys = result.counties_intersected.map(c => c.key);
  assert.ok(!keys.includes('MARICOPA, AZ'),
    `MARICOPA must not appear in Yavapai-center polygon; got: ${keys.join(', ')}`);
});

test('computeCountyOverlay: straddling polygon returns both Yavapai and Coconino', async () => {
  _resetCache();
  const result = await computeCountyOverlay(YAVAPAI_COCONINO_STRADDLE_POLYGON, { path: FIXTURE_PATH });
  assert.equal(result.available, true, 'overlay must be available');
  const keys = result.counties_intersected.map(c => c.key);
  assert.ok(keys.includes('YAVAPAI, AZ'),
    `YAVAPAI must appear in straddling polygon; got: ${keys.join(', ')}`);
  assert.ok(keys.includes('COCONINO, AZ'),
    `COCONINO must appear in straddling polygon; got: ${keys.join(', ')}`);
});

test('computeCountyOverlay: percent coverage values are finite and in range [0, 100]', async () => {
  _resetCache();
  const result = await computeCountyOverlay(YAVAPAI_CENTER_POLYGON, { path: FIXTURE_PATH });
  for (const c of result.counties_intersected){
    if (c.percent_of_county_covered != null){
      assert.ok(c.percent_of_county_covered >= 0 && c.percent_of_county_covered <= 100,
        `${c.key} percent_of_county_covered out of [0,100]: ${c.percent_of_county_covered}`);
    }
    if (c.percent_of_contour_in_county != null){
      assert.ok(c.percent_of_contour_in_county >= 0 && c.percent_of_contour_in_county <= 100,
        `${c.key} percent_of_contour_in_county out of [0,100]: ${c.percent_of_contour_in_county}`);
    }
  }
});

test('computeCountyOverlay: percent coverage is deterministic across two runs', async () => {
  _resetCache();
  const r1 = await computeCountyOverlay(YAVAPAI_CENTER_POLYGON, { path: FIXTURE_PATH });
  _resetCache();
  const r2 = await computeCountyOverlay(YAVAPAI_CENTER_POLYGON, { path: FIXTURE_PATH });
  const y1 = r1.counties_intersected.find(c => c.key === 'YAVAPAI, AZ');
  const y2 = r2.counties_intersected.find(c => c.key === 'YAVAPAI, AZ');
  assert.ok(y1 && y2, 'YAVAPAI must appear in both runs');
  assert.equal(y1.percent_of_county_covered, y2.percent_of_county_covered,
    'percent_of_county_covered must be identical across two runs');
  assert.equal(y1.intersection_area_sq_km, y2.intersection_area_sq_km,
    'intersection_area_sq_km must be identical across two runs');
});

test('computeCountyOverlay: missing dataset → available:false with warning code', async () => {
  _resetCache();
  const result = await computeCountyOverlay(YAVAPAI_CENTER_POLYGON,
    { path: '/nonexistent/path/us_counties_fcc.geojson' });
  assert.equal(result.available, false, 'must not be available when dataset is missing');
  assert.ok(Array.isArray(result.warnings) && result.warnings.length > 0, 'must have warnings');
  assert.ok(result.warnings.some(w => w.code === 'COUNTY_BOUNDARY_DATASET_MISSING'),
    'must emit COUNTY_BOUNDARY_DATASET_MISSING when file is absent');
});

test('computeCountyOverlay: response includes dataset_sha256', async () => {
  _resetCache();
  const result = await computeCountyOverlay(YAVAPAI_CENTER_POLYGON, { path: FIXTURE_PATH });
  assert.equal(result.available, true);
  assert.ok(result.dataset_sha256, 'response must include dataset_sha256');
  assert.ok(/^[0-9a-f]{64}$/.test(result.dataset_sha256), 'dataset_sha256 must be 64-char hex');
});

test('computeCountyOverlay: response includes source = FCC_COUNTY_KML', async () => {
  _resetCache();
  const result = await computeCountyOverlay(YAVAPAI_CENTER_POLYGON, { path: FIXTURE_PATH });
  assert.equal(result.source, 'FCC_COUNTY_KML');
});

test('computeCountyOverlay: response includes dataset_path', async () => {
  _resetCache();
  const result = await computeCountyOverlay(YAVAPAI_CENTER_POLYGON, { path: FIXTURE_PATH });
  assert.equal(result.dataset_path, FIXTURE_PATH);
});

test('computeCountyOverlay: null contour → available:false', async () => {
  _resetCache();
  const result = await computeCountyOverlay(null, { path: FIXTURE_PATH });
  assert.equal(result.available, false);
  assert.equal(result.error, 'no_contour_geometry');
});

// ── Report section ────────────────────────────────────────────────────────────

test('buildCountyOverlaySection: returns null when county_overlay is absent', () => {
  const sec = buildCountyOverlaySection({ evidence: {} });
  assert.equal(sec, null, 'must return null when no county overlay evidence');
});

test('buildCountyOverlaySection: returns null when county_overlay.available=false', () => {
  const sec = buildCountyOverlaySection({
    evidence: { county_overlay: { available: false, error: 'dataset_missing' } }
  });
  assert.equal(sec, null);
});

test('buildCountyOverlaySection: section id and type are correct', async () => {
  _resetCache();
  const overlay = await computeCountyOverlay(YAVAPAI_CENTER_POLYGON, { path: FIXTURE_PATH });
  const sec = buildCountyOverlaySection({ evidence: { county_overlay: overlay } });
  assert.ok(sec, 'section must be non-null when overlay is available');
  assert.equal(sec.id, 'county-overlay');
  assert.equal(sec.type, 'table');
  assert.match(sec.heading, /County/i);
});

test('buildCountyOverlaySection: section includes dataset SHA256 in evidence_summary', async () => {
  _resetCache();
  const overlay = await computeCountyOverlay(YAVAPAI_CENTER_POLYGON, { path: FIXTURE_PATH });
  const sec = buildCountyOverlaySection({ evidence: { county_overlay: overlay } });
  assert.ok(sec.evidence_summary, 'must have evidence_summary');
  assert.ok(sec.evidence_summary.dataset_sha256, 'evidence_summary must include dataset_sha256');
  assert.ok(/^[0-9a-f]{64}$/.test(sec.evidence_summary.dataset_sha256),
    'dataset_sha256 must be 64-char hex');
});

test('buildCountyOverlaySection: Yavapai polygon produces Yavapai in table rows', async () => {
  _resetCache();
  const overlay = await computeCountyOverlay(YAVAPAI_CENTER_POLYGON, { path: FIXTURE_PATH });
  const sec = buildCountyOverlaySection({ evidence: { county_overlay: overlay } });
  assert.ok(sec, 'section must be present');
  const row = sec.table.rows.find(r => r.county_name === 'YAVAPAI');
  assert.ok(row, 'table must include a YAVAPAI row');
  assert.equal(row.state, 'AZ');
});

test('buildCountyOverlaySection: paragraphs mention dataset path and SHA256', async () => {
  _resetCache();
  const overlay = await computeCountyOverlay(YAVAPAI_CENTER_POLYGON, { path: FIXTURE_PATH });
  const sec = buildCountyOverlaySection({ evidence: { county_overlay: overlay } });
  const joined = sec.paragraphs.join(' ');
  assert.match(joined, /us_counties_fcc\.geojson/, 'must mention dataset filename');
  assert.match(joined, /SHA-256/, 'must mention SHA-256');
  assert.match(joined, /3207/, 'must mention valid KML file count');
});

// ── KAZM / Yavapai sample output ──────────────────────────────────────────────
// KAZM 1550 kHz, Prescott AZ — transmitter at approximately 34.57°N 112.47°W,
// within Yavapai County.  A 0.5 mV/m contour radius of ~120 km would typically
// cover Yavapai, Coconino, Maricopa, and La Paz counties in AZ.
// We test the station-center point and a larger polygon for coverage.

test('KAZM sample: station at Prescott AZ centroid is within Yavapai', async () => {
  _resetCache();
  // A small polygon around the KAZM transmitter site (Prescott AZ area).
  const KAZM_LOCAL = {
    type: 'Polygon',
    coordinates: [[
      [-112.50, 34.50], [-112.40, 34.50], [-112.40, 34.65],
      [-112.50, 34.65], [-112.50, 34.50]
    ]]
  };
  const result = await computeCountyOverlay(KAZM_LOCAL, { path: FIXTURE_PATH });
  assert.equal(result.available, true);
  const keys = result.counties_intersected.map(c => c.key);
  assert.ok(keys.includes('YAVAPAI, AZ'),
    `KAZM local area must be in Yavapai; intersected: ${keys.join(', ')}`);
});
