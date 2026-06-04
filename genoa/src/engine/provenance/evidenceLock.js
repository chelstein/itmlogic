// Evidence lock — cryptographic anchor for the source records used in an exhibit.
//
// buildEvidenceLock(exhibit) produces a lock object that records:
//   - per-source SHA-256 hash of the normalised evidence record
//   - per-source metadata (retrieved_at, source_last_modified, authority)
//   - an aggregate_hash over the entire lock payload (excluding itself)
//
// verifyEvidenceLock(exhibit, evidenceLock) recomputes every hash and
// returns { valid, mismatches[], warnings[], blockers[] }.  Any changed
// hash produces SOURCE_EVIDENCE_LOCK_INVALID; any critical source that
// was in the original lock but cannot now be found produces
// SOURCE_EVIDENCE_LOCK_MISSING.
//
// The lock shape is designed to be embedded in the study PDF so auditors
// can replay the verification without Genoa.

import { createHash } from 'node:crypto';
import { SOURCE_AUTHORITY } from './sourceAuthority.js';
import { hashEvidence }     from './hashEvidence.js';

export const LOCK_VERSION = '1.0';

// Sources whose presence in the lock is required for a critical exhibit.
const CRITICAL_LOCK_SOURCES = new Set([
  'fcc_lms', 'fcc_asr'
]);

// Critical fields whose values flow through a given source.
const SOURCE_CRITICAL_FIELDS = {
  fcc_lms:  ['frequency', 'erp', 'coordinates', 'fcc_class'],
  fcc_fmq:  ['frequency', 'erp'],
  fcc_asr:  ['tower_height', 'coordinates'],
  faa_oeaaa:['tower_height'],
  usgs_dem: ['haat', 'rcamsl']
};

function sha256hex(obj){
  const json = JSON.stringify(obj);
  return createHash('sha256').update(json, 'utf8').digest('hex');
}

// Build source entries from evidence and existing source_hashes.
function buildSourceEntries(exhibit){
  const ev     = exhibit.evidence || {};
  const hashes = exhibit.source_attestation?.source_hashes || hashEvidence(ev);
  const entries = {};

  const META = {
    fcc_lms:   { authority: SOURCE_AUTHORITY.FCC_LMS,   record: ev.fcc_lms },
    fcc_fmq:   { authority: SOURCE_AUTHORITY.FCC_FMQ,   record: ev.fcc_fmq },
    fcc_asr:   { authority: SOURCE_AUTHORITY.FCC_ASR,   record: ev.asr },
    faa_oeaaa: { authority: SOURCE_AUTHORITY.FAA_OEAAA, record: ev.faa_determination },
    usgs_dem:  { authority: SOURCE_AUTHORITY.USGS_DEM,
                 record: ev.terrain || ev.tx_amsl_resolved || null }
  };

  for (const [key, { authority, record }] of Object.entries(META)){
    if (record == null && !hashes[key]) continue;
    const hashKey = key === 'fcc_asr' ? 'fcc_asr' : key;
    entries[key] = {
      hash:                hashes[hashKey] ?? null,
      retrieved_at:        record?.retrieved_at        || record?._fetched || null,
      source_last_modified:record?.source_last_modified || null,
      authority,
      critical_fields:     SOURCE_CRITICAL_FIELDS[key] ?? []
    };
  }

  return entries;
}

export function buildEvidenceLock(exhibit){
  const si      = exhibit.station_inputs || {};
  const sources = buildSourceEntries(exhibit);

  // Build payload without aggregate_hash first so we can hash it.
  const payload = {
    lock_version: LOCK_VERSION,
    generated_at: exhibit.source_attestation?.generated_at || new Date().toISOString(),
    exhibit_id:   exhibit.id     || exhibit.exhibit_id     || null,
    facility_id:  si.facility_id || null,
    application_id: si.application_id || exhibit.application_id || null,
    call_sign:    si.call        || null,
    sources
  };

  const aggregate_hash = sha256hex(payload);

  return { ...payload, aggregate_hash };
}

export function verifyEvidenceLock(exhibit, evidenceLock){
  if (!evidenceLock || typeof evidenceLock !== 'object'){
    return {
      valid: false,
      mismatches: [],
      warnings: [],
      blockers: [{ code: 'SOURCE_EVIDENCE_LOCK_MISSING', detail: 'No evidence lock provided' }]
    };
  }

  const currentSources = buildSourceEntries(exhibit);
  const mismatches = [];
  const warnings   = [];
  const blockers   = [];

  // 1. Check per-source hashes.
  const lockedSources = evidenceLock.sources || {};

  for (const [key, lockedEntry] of Object.entries(lockedSources)){
    const current = currentSources[key];
    if (!current){
      // Source was in the lock but is now missing from evidence.
      if (CRITICAL_LOCK_SOURCES.has(key)){
        blockers.push({
          code:   'SOURCE_EVIDENCE_LOCK_MISSING',
          source: key,
          detail: `${key} was locked in the original exhibit but is now absent from evidence`
        });
      }
      continue;
    }
    if (lockedEntry.hash && current.hash && lockedEntry.hash !== current.hash){
      mismatches.push({ source: key, locked: lockedEntry.hash, current: current.hash });
      blockers.push({
        code:   'SOURCE_EVIDENCE_LOCK_INVALID',
        source: key,
        detail: `${key} evidence hash changed — locked ${lockedEntry.hash.slice(0, 12)}… current ${current.hash.slice(0, 12)}…`
      });
    }
  }

  // 2. Check for critical sources present in exhibit but not in the lock.
  for (const key of CRITICAL_LOCK_SOURCES){
    if (currentSources[key] && !lockedSources[key]){
      blockers.push({
        code:   'SOURCE_EVIDENCE_LOCK_MISSING',
        source: key,
        detail: `${key} is present in evidence but has no entry in the evidence lock`
      });
    }
  }

  // 3. Verify aggregate hash.
  const { aggregate_hash: lockedAggHash, ...payloadWithoutAgg } = evidenceLock;
  const recomputedAgg = sha256hex(payloadWithoutAgg);

  if (lockedAggHash && recomputedAgg !== lockedAggHash){
    blockers.push({
      code:   'SOURCE_EVIDENCE_LOCK_INVALID',
      source: 'aggregate',
      detail: `Aggregate lock hash changed — lock payload was modified after generation`
    });
  }

  const valid = blockers.length === 0;
  return { valid, mismatches, warnings, blockers };
}
