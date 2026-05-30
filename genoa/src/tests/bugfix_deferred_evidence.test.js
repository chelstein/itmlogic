// Regression tests for KJIM deferred evidence plumbing.
//
// P1: Population per-contour — §73.24(g) PASS/FAIL instead of NOT_MEASURED
// P2: Community boundary — §73.24(j) auto-fetch via Census/Nominatim
// P3: FAA OE error message — DATA SOURCE ERROR, not vague "not configured"
// P4: FCCAM wired in app.yaml + docker-compose env vars present (config test)
// P5: OET-65 near-field → ENGINEERING REVIEW REQUIRED, not overstatement

import test from 'node:test';
import assert from 'node:assert/strict';

// ─────────────────────────────────────────────────────────────────────────────
// P1: §73.24(g) population ratio PASS/FAIL
// ─────────────────────────────────────────────────────────────────────────────

import { checkAm73_24g } from '../engine/regulatory/section_73_24g.js';

test('P1: §73.24(g) returns PASS when by_contour populations satisfy 1% ratio', () => {
  const exhibit = {
    station_inputs: { service: 'AM' },
    radial_table:   [
      { azimuth_deg: 0, contour_distances_km: { blanket_1000mvm: 1.2, service_25mvm: 45.0 } }
    ],
    polygons: [
      { contour_id: 'blanket_1000mvm', label: '1000 mV/m', mean_radial_km: 1.2, closed: true },
      { contour_id: 'service_25mvm',   label: '25 mV/m',   mean_radial_km: 45.0, closed: true }
    ],
    population_estimate: {
      primary: 200000,
      by_contour: {
        blanket_1000mvm: 1000,    // 1000 / 200000 = 0.5% < 1% → PASS
        service_25mvm:   200000
      }
    }
  };
  const result = checkAm73_24g({ exhibit });
  assert.equal(result.applicable, true);
  const ratioFinding = result.findings.find(f => f.rule === 'blanket_population_ratio');
  assert.ok(ratioFinding, 'ratio finding should exist');
  assert.equal(ratioFinding.pass, true, 'ratio should PASS at 0.5%');
  assert.equal(result.overall_pass, true);
  assert.match(result.summary, /passes/i);
});

test('P1: §73.24(g) returns FAIL when by_contour ratio exceeds 1%', () => {
  const exhibit = {
    station_inputs: { service: 'AM' },
    radial_table:   [
      { azimuth_deg: 0, contour_distances_km: { blanket_1000mvm: 2.5, service_25mvm: 30.0 } }
    ],
    polygons: [
      { contour_id: 'blanket_1000mvm', label: '1000 mV/m', mean_radial_km: 2.5, closed: true },
      { contour_id: 'service_25mvm',   label: '25 mV/m',   mean_radial_km: 30.0, closed: true }
    ],
    population_estimate: {
      by_contour: {
        blanket_1000mvm: 3500,    // 3500 / 280000 = 1.25% > 1% → FAIL
        service_25mvm:   280000
      }
    }
  };
  const result = checkAm73_24g({ exhibit });
  const ratioFinding = result.findings.find(f => f.rule === 'blanket_population_ratio');
  assert.equal(ratioFinding.pass, false, 'ratio should FAIL at 1.25%');
  assert.equal(result.overall_pass, false);
  assert.match(result.summary, /FAILED/i);
});

test('P1: §73.24(g) ratio finding is null (not measured) when by_contour absent', () => {
  const exhibit = {
    station_inputs: { service: 'AM' },
    radial_table:   [{ azimuth_deg: 0, contour_distances_km: { blanket_1000mvm: 1.5, service_25mvm: 40 } }],
    polygons: [],
    population_estimate: { primary: 100000 }   // no by_contour
  };
  const result = checkAm73_24g({ exhibit });
  const ratioFinding = result.findings.find(f => f.rule === 'blanket_population_ratio');
  assert.equal(ratioFinding.pass, null, 'ratio finding pass should be null (not measured)');
  // Blanket contour is present (radial_table has the distance) so the blanket
  // presence finding passes; overall_pass is true for the decisive findings
  // but ratio remains unmeasured.  The detail text should call out that the
  // population sidecar needs per-contour invocation.
  assert.match(ratioFinding.detail, /population sidecar/i);
});

test('P1: §73.24(g) DATA SOURCE ERROR in by_contour does not crash', () => {
  const exhibit = {
    station_inputs: { service: 'AM' },
    radial_table:   [{ azimuth_deg: 0, contour_distances_km: { blanket_1000mvm: 1.0, service_25mvm: 40 } }],
    polygons: [
      { contour_id: 'blanket_1000mvm', mean_radial_km: 1.0, closed: true }
    ],
    population_estimate: {
      by_contour: {
        blanket_1000mvm: { error: 'sidecar timeout', source: 'DATA SOURCE ERROR' },
        service_25mvm:   150000
      }
    }
  };
  // populationFor() returns null for error objects; check should still run without throw
  const result = checkAm73_24g({ exhibit });
  assert.ok(result.applicable);
  const ratioFinding = result.findings.find(f => f.rule === 'blanket_population_ratio');
  assert.equal(ratioFinding.pass, null, 'should be null when blanket pop is an error object');
});

// ─────────────────────────────────────────────────────────────────────────────
// P2: Community boundary resolver helpers
// ─────────────────────────────────────────────────────────────────────────────

import { parseCommunityState } from '../evidence/communityBoundaryClient.js';

test('P2: parseCommunityState parses "Sherman, TX"', () => {
  const r = parseCommunityState('Sherman, TX');
  assert.equal(r.name, 'Sherman');
  assert.equal(r.stateAbbr, 'TX');
});

test('P2: parseCommunityState handles "Sherman,TX" (no space)', () => {
  const r = parseCommunityState('Sherman,TX');
  assert.equal(r.name, 'Sherman');
  assert.equal(r.stateAbbr, 'TX');
});

test('P2: parseCommunityState handles bare city name', () => {
  const r = parseCommunityState('Sherman');
  assert.equal(r.name, 'Sherman');
  assert.equal(r.stateAbbr, null);
});

test('P2: parseCommunityState handles null/undefined', () => {
  assert.deepEqual(parseCommunityState(null),      { name: null, stateAbbr: null });
  assert.deepEqual(parseCommunityState(undefined), { name: null, stateAbbr: null });
});

test('P2: makeCommunityBoundaryClient returns null when no fetch available', async () => {
  const { makeCommunityBoundaryClient } = await import('../evidence/communityBoundaryClient.js');
  const client = makeCommunityBoundaryClient({ fetchFn: null });
  assert.equal(client, null);
});

test('P2: makeCommunityBoundaryClient.getByName fetches TIGER and returns polygon', async () => {
  const { makeCommunityBoundaryClient } = await import('../evidence/communityBoundaryClient.js');
  // Mock TIGER returning a GeoJSON feature
  const tigerFc = {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [[[-96.7, 33.6],[-96.6, 33.6],[-96.6, 33.7],[-96.7, 33.7],[-96.7, 33.6]]] },
      properties: { GEOID: '4868716', NAME: 'Sherman', LSADC: '25', STATEFP: '48' }
    }]
  };
  const fakeFetch = async (url) => ({
    ok: true,
    json: async () => tigerFc
  });
  const client = makeCommunityBoundaryClient({ fetchFn: fakeFetch });
  const result = await client.getByName({ community: 'Sherman', state: 'TX' });
  assert.equal(result.available, true);
  assert.equal(result.source, 'census-tiger');
  assert.equal(result.geojson.geometry.type, 'Polygon');
  assert.equal(result.geoid, '4868716');
});

test('P2: getByName falls back to Nominatim when TIGER returns empty features', async () => {
  const { makeCommunityBoundaryClient } = await import('../evidence/communityBoundaryClient.js');
  let callCount = 0;
  const fakeFetch = async (url) => {
    callCount++;
    if (url.includes('tigerweb')) {
      return { ok: true, json: async () => ({ features: [] }) };  // TIGER miss
    }
    // Nominatim response
    return {
      ok: true,
      json: async () => ({
        type: 'FeatureCollection',
        features: [{
          type: 'Feature',
          geometry: { type: 'Polygon', coordinates: [[[-96.7,33.6],[-96.6,33.6],[-96.6,33.7],[-96.7,33.6]]] },
          properties: { category: 'boundary', type: 'administrative' }
        }]
      })
    };
  };
  const client = makeCommunityBoundaryClient({ fetchFn: fakeFetch });
  // Use a different community name to avoid cache collision with the TIGER-hit test above.
  const result = await client.getByName({ community: 'Denison', state: 'TX' });
  assert.equal(result.available, true);
  assert.equal(result.source, 'nominatim-osm');
  assert.ok(callCount >= 2, 'should have tried both TIGER and Nominatim');
});

test('P2: getByName returns DATA SOURCE ERROR when both tiers fail', async () => {
  const { makeCommunityBoundaryClient } = await import('../evidence/communityBoundaryClient.js');
  const fakeFetch = async () => ({ ok: false, status: 500 });
  const client = makeCommunityBoundaryClient({ fetchFn: fakeFetch });
  const result = await client.getByName({ community: 'Nonexistent City', state: 'ZZ' });
  assert.equal(result.available, false);
  assert.equal(result.source, 'DATA SOURCE ERROR');
  assert.ok(result.error, 'error message should be set');
});

// ─────────────────────────────────────────────────────────────────────────────
// P3: FAA OE error message — DATA SOURCE ERROR
// ─────────────────────────────────────────────────────────────────────────────

import { makeFaaOeClient } from '../evidence/faaOeClient.js';

test('P3: FAA OE client getByStudyNumber returns DATA SOURCE ERROR when unconfigured', async () => {
  // Override env to ensure sidecar URL is not set
  const saved = process.env.FAA_OE_SIDECAR_URL;
  delete process.env.FAA_OE_SIDECAR_URL;
  delete process.env.FAA_OE_HTML_FALLBACK;
  delete process.env.FAA_OE_DISABLE;
  try {
    const client = makeFaaOeClient({ fetchFn: fetch });
    assert.ok(client, 'client should be created even without sidecar URL');
    const result = await client.getByStudyNumber('2025-ASW-14368-OE');
    assert.equal(result.available, false);
    assert.equal(result.source, 'DATA SOURCE ERROR');
    assert.match(result.error, /DATA SOURCE ERROR/i);
    assert.match(result.error, /FAA_OE_SIDECAR_URL/);
  } finally {
    if (saved !== undefined) process.env.FAA_OE_SIDECAR_URL = saved;
  }
});

test('P3: FAA OE client returns error with study number embedded', async () => {
  delete process.env.FAA_OE_SIDECAR_URL;
  delete process.env.FAA_OE_HTML_FALLBACK;
  const client = makeFaaOeClient({ fetchFn: fetch });
  const result = await client.getByStudyNumber('2025-ASW-99999-OE');
  assert.match(result.error, /2025-ASW-99999-OE/, 'study number should appear in error message');
});

// ─────────────────────────────────────────────────────────────────────────────
// P4: FCCAM and FAA_OE env vars wired in config files
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const appYaml        = readFileSync(path.join(__dir, '../../infra/digitalocean/app.yaml'), 'utf8');
const dockerCompose  = readFileSync(path.join(__dir, '../../docker-compose.yml'), 'utf8');

test('P4: FCCAM_SIDECAR_URL env var present in app.yaml', () => {
  assert.ok(appYaml.includes('FCCAM_SIDECAR_URL'), 'app.yaml must reference FCCAM_SIDECAR_URL');
});

test('P4: FAA_OE_SIDECAR_URL env var present in app.yaml', () => {
  assert.ok(appYaml.includes('FAA_OE_SIDECAR_URL'), 'app.yaml must reference FAA_OE_SIDECAR_URL');
});

test('P4: FCCAM_SIDECAR_URL env var present in docker-compose.yml', () => {
  assert.ok(dockerCompose.includes('FCCAM_SIDECAR_URL'), 'docker-compose must reference FCCAM_SIDECAR_URL');
});

test('P4: FAA_OE_SIDECAR_URL env var present in docker-compose.yml', () => {
  assert.ok(dockerCompose.includes('FAA_OE_SIDECAR_URL'), 'docker-compose must reference FAA_OE_SIDECAR_URL');
});

// ─────────────────────────────────────────────────────────────────────────────
// P5: OET-65 near-field → ENGINEERING REVIEW REQUIRED, not blocker
// ─────────────────────────────────────────────────────────────────────────────

import { buildRfExposureSection } from '../exports/engineeringReport/sections/rfExposure.js';

test('P5: near-field required → label says ENGINEERING REVIEW REQUIRED', () => {
  const exhibit = {
    station_inputs: { service: 'AM', frequency: 1500, frequency_unit: 'kHz' },
    oet65: {
      study_inputs: { frequency_mhz: 1.5 },
      erp_kw: 1.0,
      compliance: {
        controlled:   { distance_m: 5.2 },
        uncontrolled: { distance_m: 11.6 }
      },
      near_field: {
        required_for_filing: true,
        boundary_m:          47.7,
        rcagl_m:             18.5
      }
    }
  };
  const section = buildRfExposureSection(exhibit);
  const statusRow = section.rows.find(([label]) => label.toLowerCase().includes('status'));
  assert.ok(statusRow, 'status row must exist');
  assert.match(statusRow[1], /ENGINEERING REVIEW REQUIRED/i, 'status must say ENGINEERING REVIEW REQUIRED');
  assert.ok(!statusRow[1].match(/BLOCKER/i), 'must NOT say BLOCKER');

  const summaryText = section.paragraphs.join(' ');
  assert.match(summaryText, /ENGINEERING REVIEW REQUIRED/i);
  assert.match(summaryText, /not a compliance failure/i);
  assert.ok(!summaryText.match(/BLOCKER/i), 'summary must NOT say BLOCKER');
});

test('P5: near-field boundary_m shown in table when available', () => {
  const exhibit = {
    station_inputs: { service: 'AM', frequency: 1500, frequency_unit: 'kHz' },
    oet65: {
      study_inputs: { frequency_mhz: 1.5 },
      compliance: {},
      near_field: { required_for_filing: true, boundary_m: 47.7, rcagl_m: 18.5 }
    }
  };
  const section = buildRfExposureSection(exhibit);
  const nfRow = section.rows.find(([label]) => label.toLowerCase().includes('near-field'));
  assert.ok(nfRow, 'near-field row must exist');
  assert.match(nfRow[1], /47\.7/);
  assert.match(nfRow[1], /18\.5/);
});

test('P5: no near-field required → row says "Not required"', () => {
  const exhibit = {
    station_inputs: { service: 'FM', frequency: 107.1 },
    oet65: {
      study_inputs: { frequency_mhz: 107.1 },
      compliance: {
        controlled:   { distance_m: 40 },
        uncontrolled: { distance_m: 90 }
      },
      near_field: { required_for_filing: false }
    }
  };
  const section = buildRfExposureSection(exhibit);
  const nfRow = section.rows.find(([label]) => label.toLowerCase().includes('near-field'));
  assert.ok(nfRow);
  assert.match(nfRow[1], /Not required/i);
});

test('P5: warning code OET65_NEAR_FIELD_REQUIRED has severity warning, not blocker', async () => {
  const { WARNING_CODES } = await import('../types/warnings.js');
  const code = WARNING_CODES['OET65_NEAR_FIELD_REQUIRED'];
  assert.ok(code, 'warning code must be defined');
  assert.equal(code.severity, 'warning', 'near-field required must be warning severity, never blocker');
});
