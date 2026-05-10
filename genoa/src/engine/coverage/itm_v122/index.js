// JS port of NTIA's ITM v1.2.2 - Genoa-side high-level entry.
//
// SCOPE OF THIS COMMIT (Phase 2 partial)
//   - Primitive scalar helpers (primitives.js)
//   - prop_type / propa_type structs + qlrps frequency-and-ground
//     parameter setup (propagation.js)
//   - alos line-of-sight attenuation (alos.js)
//   - adiff extended-range diffraction (diffraction.js)
//
// NOT YET PORTED (Phase 2 follow-up)
//   - hzns / hzns2 (terrain-horizon geometry)
//   - z1sq1 / z1sq2 (least-squares fit of terrain irregularity)
//   - lrprop / lrprop2 (mode-selection orchestrator that picks alos
//     vs adiff vs ascat per distance band and assembles propa)
//   - ascat (troposcatter, eq. 6.x in NTIA TR 82-100)
//   - avar (ITS time/location/situation variability statistics)
//   - qlrpfl (terrain-profile-driven point-to-point entry)
//
// As a result, the high-level `predictItmV122` exported from this
// file is a STAGING entry point: it sets prop via qlrps, runs alos
// or adiff for a given distance, but DOES NOT run the full Longley-
// Rice mode-blending or variability-stats pipeline yet.  Callers
// that need filing-grade numbers today should keep using either:
//   - the splat sidecar (full ITWOM 3.0 fidelity), or
//   - genoa/src/engine/coverage/itm_radial.js (Bullington fallback).
//
// Once lrprop + avar land, this module replaces itm_radial.js as the
// JS-side coverage engine and Genoa stops needing the splat sidecar
// for resilience/speed.

import { qlrps, makeProp, makePropa } from './propagation.js';
import { makeAdiff }                  from './diffraction.js';
import { makeAlos }                   from './alos.js';

export { qlrps, makeProp, makePropa, makeAdiff, makeAlos };
export * from './primitives.js';

// Convenience: build a prop_type populated from the high-level
// parameters Genoa typically has on hand.  This does NOT yet set
// prop.dh / prop.dl / prop.he - those come from the terrain profile
// (hzns + z1sq2), which lands in the follow-up.
//
//   tx_height_m    transmitter antenna AGL (m)
//   rx_height_m    receiver antenna AGL (m)
//   frequency_mhz  carrier frequency (MHz)
//   en0            surface refractivity (N-units), default 301
//   ipol           polarization, 0=H 1=V; default 1 (V is FM convention)
//   eps_dielect    relative permittivity, default 15 (avg ground)
//   sgm_conduct    ground conductivity (S/m), default 0.005
export function buildProp({
  tx_height_m,
  rx_height_m,
  frequency_mhz,
  en0           = 301.0,
  ipol          = 1,
  eps_dielect   = 15.0,
  sgm_conduct   = 0.005
} = {}){
  const prop = makeProp();
  prop.hg[0] = tx_height_m;
  prop.hg[1] = rx_height_m;
  qlrps(frequency_mhz, 0, en0, ipol, eps_dielect, sgm_conduct, prop);
  return prop;
}

// Predicate: does this build of itm_v122 cover everything a
// production caller needs?  False until lrprop + avar + ascat land.
// Wire the JS path through the splat sidecar fallback in callers
// that gate on this.
export const ITM_V122_PRODUCTION_READY = false;

// Deliberately DO NOT export a `predictItmCoverage`-shaped function
// here yet - that contract should drop in only when lrprop +
// variability stats are real.  Stub callers that try to import a
// production entry point should fail loudly:
export function predictItmCoverage(){
  throw new Error(
    'itm_v122.predictItmCoverage is not implemented yet (Phase 2 partial).  '
  + 'Use splatClient.predictItmCoverage or itm_radial.computeItmCoverage.'
  );
}
