// Source freshness assessment.
//
// Evaluates how recent each evidence source record is, relative to
// authority-specific thresholds.  A fresh FCC LMS record matters far
// more than a fresh DEM — the thresholds below reflect that.
//
// Freshness statuses (per source):
//   current          — within aging threshold
//   aging            — past aging threshold, not yet stale
//   stale            — past stale threshold; filing review required
//   missing_timestamp — record present but retrieved_at / source_last_modified absent
//   unknown          — source record itself absent
//
// Retrieved_at / source_last_modified are expected as ISO-8601 strings
// on the evidence record (e.g. evidence.fcc_lms.retrieved_at).
// Both fields are optional; the module degrades gracefully when absent.

import { SOURCE_AUTHORITY } from './sourceAuthority.js';

// Days thresholds: [aging_days, stale_days]
const THRESHOLDS = {
  [SOURCE_AUTHORITY.FCC_LMS]:        [14,   30],
  [SOURCE_AUTHORITY.FCC_FMQ]:        [14,   30],
  [SOURCE_AUTHORITY.FCC_ASR]:        [14,   30],
  [SOURCE_AUTHORITY.FAA_OEAAA]:      [30,   90],
  [SOURCE_AUTHORITY.USGS_DEM]:       [365, 1095],
  [SOURCE_AUTHORITY.ENGINE_DERIVED]: [7,    14],
  [SOURCE_AUTHORITY.OPERATOR_INPUT]: [null, null],  // age-gated by policy, not days
  [SOURCE_AUTHORITY.AI_INFERENCE]:   [0,     0],    // never authoritative
  [SOURCE_AUTHORITY.UNKNOWN]:        [null, null]
};

// Critical sources whose staleness can block filing when critical_fields are affected.
const CRITICAL_AUTHORITIES = new Set([
  SOURCE_AUTHORITY.FCC_LMS,
  SOURCE_AUTHORITY.FCC_FMQ,
  SOURCE_AUTHORITY.FCC_ASR,
  SOURCE_AUTHORITY.FAA_OEAAA
]);

function daysBetween(dateStr, referenceDate){
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  return (referenceDate - d) / 86_400_000;
}

// Assess freshness of a single source record.
//
// sourceRecord shape (all optional):
//   {
//     source_authority:    string  — one of SOURCE_AUTHORITY values
//     retrieved_at:        string? — ISO-8601 fetch timestamp
//     source_last_modified:string? — ISO-8601 upstream modification time
//     refresh_required:    boolean? — caller asserts refresh is needed
//   }
//
// options:
//   { now: Date, thresholds: { [authority]: [aging_days, stale_days] } }
export function assessSourceFreshness(sourceRecord, options = {}){
  const authority = sourceRecord?.source_authority || SOURCE_AUTHORITY.UNKNOWN;
  const now       = options.now instanceof Date ? options.now : new Date();
  const custom    = options.thresholds?.[authority];
  const [agingDays, staleDays] = custom ?? THRESHOLDS[authority] ?? [null, null];

  const retrievedAt  = sourceRecord?.retrieved_at        || null;
  const lastModified = sourceRecord?.source_last_modified || null;

  // Prefer last_modified for age calculation (more conservative); fall back to retrieved_at.
  const referenceTimestamp = lastModified || retrievedAt;
  const staleness_days = daysBetween(referenceTimestamp, now);

  const warnings  = [];
  const blockers  = [];

  // Determine freshness_status
  let freshness_status;

  if (authority === SOURCE_AUTHORITY.AI_INFERENCE){
    freshness_status = 'not_authoritative';
  } else if (!referenceTimestamp){
    freshness_status = retrievedAt === null && lastModified === null
      ? 'missing_timestamp'
      : 'unknown';
    if (CRITICAL_AUTHORITIES.has(authority)){
      warnings.push({
        code:   'SOURCE_TIMESTAMP_MISSING',
        source: authority,
        detail: `No retrieved_at or source_last_modified on ${authority} record`
      });
    }
  } else if (staleDays !== null && staleness_days > staleDays){
    freshness_status = 'stale';
    warnings.push({
      code:   'SOURCE_STALE',
      source: authority,
      detail: `${authority} record is ${staleness_days.toFixed(0)} days old (threshold ${staleDays} days)`
    });
    if (sourceRecord?.refresh_required === true && CRITICAL_AUTHORITIES.has(authority)){
      blockers.push({
        code:   'SOURCE_REFRESH_REQUIRED',
        source: authority,
        detail: `${authority} record requires refresh — staleness ${staleness_days.toFixed(0)} d exceeds ${staleDays} d threshold and source is marked refresh_required`
      });
    }
  } else if (agingDays !== null && staleness_days > agingDays){
    freshness_status = 'aging';
    warnings.push({
      code:   'SOURCE_AGING',
      source: authority,
      detail: `${authority} record is ${staleness_days.toFixed(0)} days old (aging threshold ${agingDays} days)`
    });
  } else {
    freshness_status = 'current';
  }

  // Operator input without a timestamp is a soft warning, not a block.
  if (authority === SOURCE_AUTHORITY.OPERATOR_INPUT && !retrievedAt){
    warnings.push({
      code:   'SOURCE_TIMESTAMP_MISSING',
      source: authority,
      detail: 'Operator input has no recorded timestamp'
    });
    freshness_status = freshness_status === 'unknown' ? 'missing_timestamp' : freshness_status;
  }

  return {
    source_authority:    authority,
    retrieved_at:        retrievedAt,
    source_last_modified: lastModified,
    staleness_days:      staleness_days != null ? +staleness_days.toFixed(1) : null,
    freshness_status,
    warnings,
    blockers
  };
}

// Extract source records from evidence and exhibit for freshness assessment.
// Returns a map of source_name → freshness result.
export function assessExhibitSourceFreshness(exhibit, options = {}){
  const ev  = exhibit.evidence || {};
  const now = options.now instanceof Date ? options.now : new Date();

  const sources = {};

  if (ev.fcc_lms != null){
    sources.fcc_lms = assessSourceFreshness({
      source_authority:    SOURCE_AUTHORITY.FCC_LMS,
      retrieved_at:        ev.fcc_lms.retrieved_at        || ev.fcc_lms._fetched || null,
      source_last_modified:ev.fcc_lms.source_last_modified || null,
      refresh_required:    ev.fcc_lms.refresh_required    || false
    }, { ...options, now });
  }

  if (ev.fcc_fmq != null){
    sources.fcc_fmq = assessSourceFreshness({
      source_authority:    SOURCE_AUTHORITY.FCC_FMQ,
      retrieved_at:        ev.fcc_fmq.retrieved_at        || null,
      source_last_modified:ev.fcc_fmq.source_last_modified || null,
      refresh_required:    ev.fcc_fmq.refresh_required    || false
    }, { ...options, now });
  }

  if (ev.asr != null){
    sources.fcc_asr = assessSourceFreshness({
      source_authority:    SOURCE_AUTHORITY.FCC_ASR,
      retrieved_at:        ev.asr.retrieved_at        || null,
      source_last_modified:ev.asr.source_last_modified || null,
      refresh_required:    ev.asr.refresh_required    || false
    }, { ...options, now });
  }

  if (ev.faa_determination != null){
    sources.faa_oeaaa = assessSourceFreshness({
      source_authority:    SOURCE_AUTHORITY.FAA_OEAAA,
      retrieved_at:        ev.faa_determination.retrieved_at        || null,
      source_last_modified:ev.faa_determination.source_last_modified || null,
      refresh_required:    ev.faa_determination.refresh_required    || false
    }, { ...options, now });
  }

  if (ev.terrain != null || ev.tx_amsl_resolved != null){
    const terrainRecord = ev.terrain || ev.tx_amsl_resolved || {};
    sources.usgs_dem = assessSourceFreshness({
      source_authority:    SOURCE_AUTHORITY.USGS_DEM,
      retrieved_at:        terrainRecord.retrieved_at        || null,
      source_last_modified:terrainRecord.source_last_modified || null,
      refresh_required:    false
    }, { ...options, now });
  }

  // Engine-derived values: use exhibit.generated_at as the reference timestamp.
  if (exhibit.generated_at || exhibit.computed_at){
    sources.engine_derived = assessSourceFreshness({
      source_authority:    SOURCE_AUTHORITY.ENGINE_DERIVED,
      retrieved_at:        exhibit.generated_at || exhibit.computed_at,
      source_last_modified:null,
      refresh_required:    false
    }, { ...options, now });
  }

  return sources;
}

// Flatten all freshness warnings and blockers from a freshness map.
export function collectFreshnessIssues(freshnessMap){
  const warnings = [];
  const blockers = [];
  for (const record of Object.values(freshnessMap)){
    warnings.push(...(record.warnings || []));
    blockers.push(...(record.blockers || []));
  }
  return { warnings, blockers };
}
