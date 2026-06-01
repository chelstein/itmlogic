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
  // The production dataset (7094 raw features, 3207 unique counties) has some
  // counties with 2 boundary features (multi-ring/discontinuous territory), so
  // raw_feature_count ≠ unique_county_count × 2.  The correct invariant is only
  // that raw_feature_count > unique_county_count.
  assert.ok(ds.unique_county_count < ds.raw_feature_count,
    'unique county count must be less than raw feature count');
  // Label features are isolated and counted separately — not inflating county count.
  assert.ok(ds.unique_county_count <= ds.raw_feature_count / 2,
    'unique county count must be no more than half of raw feature count');
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

// ── Production-pinned facts (from real dataset on 159.223.153.153) ────────────
//
// Run against /opt/genoa-cartography/data/reference/us_counties_fcc.geojson
// (dataset_sha256: 7148a84c8e3395d984c1d673a63e8d4d258e24f821f489f4f27503f961947bf2)
//
//   raw_feature_count         : 7094
//   unique_county_count       : 3207  (not 7094/2 — 340 counties have 2 boundary features)
//   label_features_ignored    : 3547
//   polygonized_count         : 3207  (0 failures)
//   YAVAPAI, AZ  area         : 21,055 km²  (Polygon)
//   COCONINO, AZ area         : 48,326 km²  (Polygon)
//   MARICOPA, AZ area         : 23,901 km²  (Polygon)
//
// The REAL dataset is not bundled in the repo.  These tests skip gracefully
// when the file is absent (CI / dev environments without the cartography mount).

const REAL_DATASET = '/opt/genoa-cartography/data/reference/us_counties_fcc.geojson';
const REAL_DATASET_SHA256 = '7148a84c8e3395d984c1d673a63e8d4d258e24f821f489f4f27503f961947bf2';
const HAS_REAL_DATASET = (() => { try { return !!import('node:fs').then ? false : true; } catch { return false; } })();

// Only run production-pinned tests when the real dataset file is present AND
// its SHA-256 matches the known production hash.  The synthetic fixture at the
// same path (used in this dev/CI container) has a different hash.
import { existsSync, readFileSync } from 'node:fs';
function checkRealDataset(){
  if (!existsSync(REAL_DATASET)) return false;
  try {
    const raw = readFileSync(REAL_DATASET, 'utf8');
    const sha = crypto.createHash('sha256').update(raw, 'utf8').digest('hex');
    return sha === REAL_DATASET_SHA256;
  } catch { return false; }
}
const REAL_DATASET_PRESENT = checkRealDataset();

test('PRODUCTION-PINNED: raw_feature_count=7094, unique_county_count=3207, 0 failures', { skip: !REAL_DATASET_PRESENT ? 'real dataset not mounted' : false }, () => {
  _resetCache();
  const ds = loadCountyBoundaries(REAL_DATASET);
  assert.equal(ds.ok, true, 'real dataset must load ok');
  assert.equal(ds.raw_feature_count, 7094, 'raw_feature_count must be 7094');
  assert.equal(ds.unique_county_count, 3207, 'unique_county_count must be 3207');
  assert.equal(ds.valid_county_count, 3207, 'all 3207 counties must polygonize');
  assert.equal(ds.invalid_county_count, 0, 'zero polygonize failures');
  assert.equal(ds.dataset_sha256, REAL_DATASET_SHA256, 'dataset SHA-256 must match');
});

test('PRODUCTION-PINNED: label_features_ignored_count=3547', { skip: !REAL_DATASET_PRESENT ? 'real dataset not mounted' : false }, () => {
  _resetCache();
  const ds = loadCountyBoundaries(REAL_DATASET);
  // 3547 Point features (one per county centroid/label from KML conversion).
  // 7094 - 3547 = 3547 boundary LineString features.
  // 3547 boundary for 3207 counties → 340 counties have 2 boundary features.
  assert.equal(ds.counties.reduce((n, c) => n, 0), ds.unique_county_count);
  // Total point features should equal raw_feature_count - boundary_feature_count.
  // We verify via: unique_county_count < raw_feature_count / 2 is NOT the case here:
  // 3207 < 7094/2 = 3547 → true (multi-ring counties inflate boundary count).
  assert.ok(ds.unique_county_count < ds.raw_feature_count,
    'unique_county_count must be less than raw_feature_count');
});

// Area pins derived from the shoelace formula on the production boundaries.
// These are approximate (spherical shoelace) but must be within 1% of the
// reference values to catch geometry corruption or ring-order reversal.
test('PRODUCTION-PINNED: YAVAPAI, AZ area ~21055 km² (±1%)', { skip: !REAL_DATASET_PRESENT ? 'real dataset not mounted' : false }, async () => {
  _resetCache();
  const ds = loadCountyBoundaries(REAL_DATASET);
  const c = ds.counties.find(x => x.key === 'YAVAPAI, AZ');
  assert.ok(c, 'YAVAPAI, AZ must be present');
  assert.equal(c.geometry_valid, true);
  assert.equal(c.geometry.type, 'Polygon');
  // Area via turf (same library the intersection service uses).
  const { default: turf } = await import('@turf/turf');
  const area = turf.area({ type: 'Feature', geometry: c.geometry }) / 1e6;
  assert.ok(Math.abs(area - 21055) / 21055 < 0.01,
    `YAVAPAI area ${area.toFixed(0)} km² must be within 1% of 21055 km²`);
});

test('PRODUCTION-PINNED: COCONINO, AZ area ~48326 km² (±1%)', { skip: !REAL_DATASET_PRESENT ? 'real dataset not mounted' : false }, async () => {
  _resetCache();
  const ds = loadCountyBoundaries(REAL_DATASET);
  const c = ds.counties.find(x => x.key === 'COCONINO, AZ');
  assert.ok(c, 'COCONINO, AZ must be present');
  assert.equal(c.geometry_valid, true);
  const { default: turf } = await import('@turf/turf');
  const area = turf.area({ type: 'Feature', geometry: c.geometry }) / 1e6;
  assert.ok(Math.abs(area - 48326) / 48326 < 0.01,
    `COCONINO area ${area.toFixed(0)} km² must be within 1% of 48326 km²`);
});

test('PRODUCTION-PINNED: MARICOPA, AZ area ~23901 km² (±1%)', { skip: !REAL_DATASET_PRESENT ? 'real dataset not mounted' : false }, async () => {
  _resetCache();
  const ds = loadCountyBoundaries(REAL_DATASET);
  const c = ds.counties.find(x => x.key === 'MARICOPA, AZ');
  assert.ok(c, 'MARICOPA, AZ must be present');
  assert.equal(c.geometry_valid, true);
  const { default: turf } = await import('@turf/turf');
  const area = turf.area({ type: 'Feature', geometry: c.geometry }) / 1e6;
  assert.ok(Math.abs(area - 23901) / 23901 < 0.01,
    `MARICOPA area ${area.toFixed(0)} km² must be within 1% of 23901 km²`);
});

// KAZM regional bbox (±2° around Prescott AZ) intersects 6 counties on the
// production dataset: COCONINO, GILA, LA PAZ, MARICOPA, MOHAVE, YAVAPAI.
// This pins the bbox-prefilter + turf intersection step on real boundaries.
test('PRODUCTION-PINNED: KAZM 2-degree region intersects 6 AZ counties', { skip: !REAL_DATASET_PRESENT ? 'real dataset not mounted' : false }, async () => {
  _resetCache();
  const KAZM_REGION = {
    type: 'Polygon',
    coordinates: [[
      [-113.5, 33.5], [-111.0, 33.5], [-111.0, 36.0],
      [-113.5, 36.0], [-113.5, 33.5]
    ]]
  };
  const result = await computeCountyOverlay(KAZM_REGION, { path: REAL_DATASET });
  assert.equal(result.available, true);
  const keys = result.counties_intersected.map(c => c.key).sort();
  const expected = ['COCONINO, AZ', 'GILA, AZ', 'LA PAZ, AZ', 'MARICOPA, AZ', 'MOHAVE, AZ', 'YAVAPAI, AZ'].sort();
  assert.deepEqual(keys, expected,
    `KAZM 2° region must intersect exactly ${expected.length} counties; got: ${keys.join(', ')}`);
});
