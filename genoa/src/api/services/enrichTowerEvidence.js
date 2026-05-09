// Shared tower-evidence enrichment.
//
// Enriches an exhibit with evidence.asr / evidence.faa_oe /
// tower_compliance just before the engineering report or LMS filing
// package is rendered.  The compute orchestrator (exhibitService.js)
// only attaches evidence.asr when an asr_number is supplied OR when
// the ZTR rich-station response carried tower data.  Many exhibits
// fall through both paths — the operator typed only call + facility_id
// + coords, ZTR didn't have _tower data — and the Tower Study /
// LMS Section III 3E rows then render EVIDENCE MISSING despite the
// FCC ULS bulk DB knowing the tower from its lat/lon alone.
//
// This module fills that gap by calling the asrClient's lat/lon
// proximity lookup (which now hits the genoa-asr-sidecar with a 1km
// → 5km → 25km radius ladder), then chains FAA OE/AAA fetch (when
// the resolved ASR carries faa_study_number) and rules-derived tower
// compliance (§17.21 / §17.23 / AC 70/7460-1L).
//
// All three steps are fail-soft — a Socrata outage or sidecar
// unreachability simply leaves the rows as-is and the renderer
// emits its own "deferred" placeholder.
//
// MUTATES the supplied exhibit in place.  The exhibit isn't persisted
// downstream of these routes, so this is the simplest way to make the
// new evidence visible to every section builder that already reads
// exhibit.evidence.asr / .faa_oe / exhibit.tower_compliance.

export async function enrichTowerEvidence(exhibit, log = console){
  if (!exhibit || typeof exhibit !== 'object') return;
  exhibit.evidence = exhibit.evidence || {};

  // ASR by lat/lon proximity — only when not already attached.
  if (!exhibit.evidence.asr?.available){
    const lat = Number(exhibit.station_inputs?.lat);
    const lon = Number(exhibit.station_inputs?.lon);
    if (Number.isFinite(lat) && Number.isFinite(lon)){
      try {
        const { makeAsrClient, checkAsrAgainstApplication } = await import('../../evidence/asrClient.js');
        const asrClient = makeAsrClient();
        if (!asrClient){
          log.warn?.('[enrichTowerEvidence] asrClient is null (no ASR_SIDECAR_URL / ZTR / Socrata configured)');
        } else {
          // Default ladder is 1km → 5km → 25km inside getByLocation.
          // Operator can pin a single radius via ASR_LOCATION_RADIUS_M.
          const radius_m = process.env.ASR_LOCATION_RADIUS_M
            ? Number(process.env.ASR_LOCATION_RADIUS_M)
            : null;
          log.info?.(`[enrichTowerEvidence] asr getByLocation lat=${lat} lon=${lon} radius_m=${radius_m || 'ladder'}`);
          const byLoc = await asrClient.getByLocation({ lat, lon, radius_m });
          log.info?.(`[enrichTowerEvidence] asr result available=${byLoc.available} source=${byLoc.source || '-'} asr=${byLoc.asr_number || '-'} dist=${byLoc.distance_m ?? '-'} err=${byLoc.error || '-'}`);
          if (byLoc.available){
            const asrResult = checkAsrAgainstApplication({
              asr: byLoc,
              application: {
                asr_number:            exhibit.station_inputs?.asr_number || null,
                lat, lon,
                overall_height_m:      exhibit.station_inputs?.overall_height_m || null,
                overall_height_amsl_m: exhibit.station_inputs?.overall_height_amsl_m || null
              }
            });
            exhibit.evidence.asr = asrResult;
          } else {
            // Surface the search-ladder + final error on the exhibit so
            // Tower Study can render NOT_REGISTERED with citation
            // instead of a blank "no record attached" message.
            exhibit.evidence.asr_attempt = {
              ok:           false,
              source:       byLoc.source,
              error:        byLoc.error,
              search_ladder: byLoc.search_ladder
            };
          }
        }
      } catch (err){
        log.warn?.('[enrichTowerEvidence] asr threw:', err?.message || err);
      }
    }
  }

  // FAA OE/AAA by Aeronautical Study Number on the ASR record.
  if (!exhibit.evidence.faa_oe?.available
      && exhibit.evidence.asr?.faa_study_number){
    try {
      const { makeFaaOeClient, checkFaaAgainstAsr } = await import('../../evidence/faaOeClient.js');
      const faaClient = makeFaaOeClient();
      if (faaClient){
        const faa = await faaClient.getByStudyNumber(exhibit.evidence.asr.faa_study_number);
        if (faa.available || faa.error){
          exhibit.evidence.faa_oe = checkFaaAgainstAsr({ faa, asr: exhibit.evidence.asr });
        }
      }
    } catch { /* fail-soft */ }
  }

  // Rules-derived tower compliance (lighting + painting per §17.21 /
  // §17.23 / AC 70/7460-1L).  Only adds when ASR resolved a height
  // above threshold AND tower_compliance not already present.
  if (!exhibit.tower_compliance?.applicable
      && exhibit.evidence.asr?.available){
    try {
      const { requiredTowerCompliance, compareToAsr } =
        await import('../../engine/tower/index.js');
      const compliance = requiredTowerCompliance({
        height_agl_m:   exhibit.evidence.asr.overall_height_m
                          ?? exhibit.station_inputs?.overall_height_m
                          ?? null,
        height_amsl_m:  exhibit.evidence.asr.overall_height_amsl_m ?? null,
        structure_type: exhibit.station_inputs?.structure_type || 'TOWER',
        near_airport:   !!exhibit.station_inputs?.near_airport
      });
      if (compliance.applicable){
        exhibit.tower_compliance = compareToAsr({ compliance, asr: exhibit.evidence.asr });
      }
    } catch { /* fail-soft */ }
  }
}
