// Evidence provenance hashing.
//
// Produces per-source SHA-256 fingerprints of the evidence records
// attached to an exhibit so the filed PDF can prove which upstream
// data was actually used.  Hashes are deterministic (deep key-sort
// before serialize) so the same API response always produces the same
// hash regardless of object-property insertion order.
//
// The normaliser strips timestamps, request_id, and other
// freshness-varying fields that change on every fetch but do not
// affect the engineering values.

import { createHash } from 'node:crypto';

// Fields that vary per-request but are not engineering values.
const VOLATILE_KEYS = new Set([
  'request_id', 'fetched_at', 'fetch_duration_ms',
  'request_timestamp', 'response_timestamp', 'cache_hit',
  'cache_age_s', '_fetched', '_duration', 'ttl', 'expires_at'
]);

function deepSort(value){
  if (Array.isArray(value)){
    return value.map(deepSort);
  }
  if (value !== null && typeof value === 'object'){
    const sorted = {};
    for (const key of Object.keys(value).sort()){
      if (!VOLATILE_KEYS.has(key)){
        sorted[key] = deepSort(value[key]);
      }
    }
    return sorted;
  }
  return value;
}

function sha256hex(obj){
  const json = JSON.stringify(deepSort(obj));
  return createHash('sha256').update(json, 'utf8').digest('hex');
}

// Hash the evidence sources relevant to source attestation.
// Returns { [source_name]: sha256_hex_string | null }.
// A null hash means the source was absent from evidence.
export function hashEvidence(evidence){
  if (!evidence || typeof evidence !== 'object') return {};

  const hashes = {};

  if (evidence.fcc_lms != null){
    hashes.fcc_lms = sha256hex(evidence.fcc_lms);
  }
  if (evidence.asr != null){
    hashes.fcc_asr = sha256hex(evidence.asr);
  }
  if (evidence.faa_determination != null){
    hashes.faa_oeaaa = sha256hex(evidence.faa_determination);
  }
  if (evidence.terrain != null || evidence.tx_amsl_resolved != null){
    const terrainObj = {
      terrain:          evidence.terrain          ?? null,
      tx_amsl_resolved: evidence.tx_amsl_resolved ?? null
    };
    hashes.usgs_dem = sha256hex(terrainObj);
  }
  if (evidence.sdr_captures != null){
    hashes.sdr_captures = sha256hex(evidence.sdr_captures);
  }

  return hashes;
}
