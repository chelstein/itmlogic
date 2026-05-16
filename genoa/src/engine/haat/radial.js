// Per-radial HAAT (47 CFR §73.313(d) arc-averaged DEM, 3.2–16.1 km).
// This module is sidecar-aware: it accepts an injected terrain client
// (see src/evidence/terrain/client.js).  If the client is null or fails,
// returns null AND the caller is expected to fall back to flat HAAT and
// add a TERRAIN_NOT_APPLIED warning.
//
// §73.313(d) specifies the averaging band as 2 miles (3.2 km) to 10 miles
// (16.1 km) from the antenna site.  The previous defaults of 3/16 km
// were ~200 m short on each end — a literal-text deviation a reviewer
// can ding on amendment.

export async function radialHaat({
  terrainClient,
  tx_lat, tx_lon, tx_amsl_m,
  radials_deg,
  from_km = 3.2, to_km = 16.1, samples = 27
}){
  if (!terrainClient) return null;
  if (!Number.isFinite(tx_amsl_m)) return null;
  try {
    const r = await terrainClient.haatPerRadial({
      tx_lat, tx_lon, tx_amsl_m,
      radials_deg,
      from_km, to_km, samples
    });
    if (!r || !Array.isArray(r.haat_per_radial)) return null;
    const provider = r.provider || 'unknown';
    return r.haat_per_radial.map(row => ({
      az:                     row.az,
      haat_input_m:           tx_amsl_m,
      haat_computed_m:        row.haat_m,
      haat_source:            'arc_averaged_dem',
      terrain_profile_source: provider
    }));
  } catch {
    return null;
  }
}
