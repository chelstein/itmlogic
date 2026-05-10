// JS port of NTIA's ITM v1.2.2 / ITWOM 3.0 - high-level entry.
//
// This file replaces the staging stub from Phase 2 part 1.  With
// terrain.js + troposcatter.js + variability.js + lrprop.js +
// qlrpfl.js now landed, the full point-to-point pipeline is
// available in pure JS:
//
//   1. Build prop_type via qlrps (frequency, refractivity,
//      polarization, ground impedance).
//   2. Hand a pfl[] terrain profile to qlrpfl, which runs hzns,
//      d1thx, z1sq1 to populate dh / he[] / dl[] / the[], then
//      primes lrprop (line-of-sight + diffraction-extrapolation +
//      troposcatter coefficients).
//   3. Each subsequent lrprop(d) call yields prop.aref (the median
//      reference attenuation at distance d).
//   4. Hand prop.aref + climate + mode-of-variability to avar with
//      the desired (zzt, zzl, zzc) quantiles for the
//      time/location/situation-confidence-adjusted path loss.
//
// pointToPoint() bundles steps 1-4 in one call for the common case
// of "give me path loss at a single distance for a single quantile".
//
// The C++ source is the canonical specification - every function
// here matches itwom3.0.cpp line-for-line on field names.
//
// Reference: NTIA TR 82-100, ITWOM 3.0 (Sid Shumate's extensions),
// itm.cpp v1.2.2 (NTIA-ITS).

import { qlrps, makeProp, makePropa, makePropv } from './propagation.js';
import { makeAdiff }                              from './diffraction.js';
import { makeAlos }                               from './alos.js';
import { alos2 }                                  from './alos2.js';
import { saalos }                                 from './canopy.js';
import { makeAscat }                              from './troposcatter.js';
import { makeAvar }                               from './variability.js';
import { makeLrprop }                             from './lrprop.js';
import { makeQlrpfl }                             from './qlrpfl.js';
import { hzns, hzns2, z1sq1, z1sq2, qtile, d1thx } from './terrain.js';
import { qerfi }                                   from './primitives.js';

// Re-exports so tests/cross-validation can poke at primitives directly.
export { qlrps, makeProp, makePropa, makePropv };
export { makeAdiff, makeAlos, alos2, saalos, makeAscat, makeAvar, makeLrprop, makeQlrpfl };
export { hzns, hzns2, z1sq1, z1sq2, qtile, d1thx };
export * from './primitives.js';

// Phase 2 part 2 flips this on: the JS port now spans the full ITM
// v1.2.2 pipeline (qlrpfl -> lrprop -> alos/adiff/ascat -> avar).
// Callers that gate on this can stop falling back to the splat
// sidecar for resilience-only reasons.  ITWOM 3.0 extensions
// (alos2 with canopy + lrprop2 + qlrpfl2) are still pending - the
// production-ready predicate covers v1.2.2 baseline only.
export const ITM_V122_PRODUCTION_READY = true;

// Convenience: assemble a prop_type populated from the parameters
// Genoa typically has on hand.  The terrain-derived fields (he, dl,
// the, dh) are filled by qlrpfl when a pfl profile is supplied.
//
//   tx_height_m, rx_height_m   antenna AGL (m)
//   frequency_mhz              MHz
//   en0                        N-units, default 301
//   ipol                       0=H, 1=V (default 1; FM convention)
//   eps_dielect                relative permittivity (default 15)
//   sgm_conduct                ground conductivity S/m (default 0.005)
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

// Single-call point-to-point ITM run.
//
//   profile:        flat Float64Array or number[] in SPLAT pfl format:
//                     [np, xi, elev_0, elev_1, ..., elev_np]
//                   where np is the number of intervals and xi the
//                   sample spacing (m).  Length = np + 3.
//   tx_height_m, rx_height_m, frequency_mhz, en0, ipol, eps_dielect,
//   sgm_conduct: same as buildProp().
//   conf:           confidence quantile in [0..1] (default 0.50).
//   rel:            reliability quantile in [0..1] (default 0.50).
//   klim:           radio climate 1..7 (default 5 = continental temperate).
//   mdvar:          mode-of-variability key (default 12 = broadcast).
//
// Returns:
//   { aref_db, dbloss_db, kwx, mode, dl, the, he, dh, dist }
// where aref_db is the median path loss (excess + free-space), dbloss_db
// is the confidence/reliability-adjusted path loss (this is the "ITM
// path loss" the FCC engine consumes), and kwx is the C++ warning level
// (0 = clean, 1 = note, 2 = caution, 3 = important, 4 = invalid).
export function pointToPoint({
  profile,
  tx_height_m,
  rx_height_m,
  frequency_mhz,
  en0          = 301.0,
  ipol         = 1,
  eps_dielect  = 15.0,
  sgm_conduct  = 0.005,
  conf         = 0.50,
  rel          = 0.50,
  klim         = 5,
  mdvar        = 12,
} = {}){
  const prop  = buildProp({
    tx_height_m, rx_height_m, frequency_mhz, en0, ipol, eps_dielect, sgm_conduct
  });
  const propa = makePropa();
  const propv = makePropv();
  propv.klim  = klim;
  propv.mdvar = mdvar;

  const qlrpfl = makeQlrpfl();
  const lrprop = qlrpfl(profile, klim, mdvar, prop, propa, propv);
  // qlrpfl already called lrprop(0, ...) which set prop.aref to the
  // ref-attenuation at the path distance.  Compute confidence/
  // reliability-adjusted loss via avar.
  //
  // Match SPLAT's point_to_point_ITM (itwom3.0.cpp line 2419):
  //   dbloss = avar(zr, 0.0, zc, prop, propv) + fs;
  // i.e. zzt = qerfi(rel), zzl = 0.0, zzc = qerfi(conf).  With mdvar=12
  // (broadcast / kdv=2) avar internally overrides zl=zt so the zl
  // input is ignored for the default case, but other modes use it
  // directly - matching the C++ exactly avoids subtle drift on those.
  const avar = makeAvar();
  const zt = qerfi(rel);
  const zl = 0.0;
  const zc = qerfi(conf);
  const dbloss = avar(zt, zl, zc, prop, propv);

  // SPLAT's `dbloss` convention is total path loss = excess + free-space.
  // `prop.aref` and the avar return are both "excess above free-space"
  // (NTIA TR 82-100 sec. 4); we compute fsl here and add for the total
  // so callers see the same number splat's site report prints.
  const dist_km    = prop.dist / 1000.0;
  const fsl_db     = 32.45 + 20.0 * Math.log10(frequency_mhz)
                   + 20.0 * Math.log10(Math.max(0.001, dist_km));
  const dbloss_db  = dbloss + fsl_db;     // matches splat point_to_point_ITM
  const aref_total = prop.aref + fsl_db;  // median path loss for symmetry

  return {
    aref_db:    aref_total,
    excess_db:  prop.aref,        // excess (avar input); useful for cross-check
    avar_db:    dbloss,           // confidence/reliability-adjusted excess
    dbloss_db,                    // full path loss = avar_db + fsl_db
    fsl_db,
    kwx:        prop.kwx,
    mode:       describeMode(prop, propa),
    dl:         [prop.dl[0], prop.dl[1]],
    the:        [prop.the[0], prop.the[1]],
    he:         [prop.he[0], prop.he[1]],
    dh:         prop.dh,
    dist_m:     prop.dist,
    dist_km,
    _lrprop:    lrprop,
    _avar:      avar,
    _prop:      prop,
    _propa:     propa,
    _propv:     propv
  };
}

// Build a SPLAT-format profile from a uniform sequence of elevation
// samples (metres) plus the spacing (metres).  Convenience for callers
// that have a (distance, elev) array rather than the bare pfl flat
// layout.  `elev` MUST be in transmitter-to-receiver order.
export function profileFromElevations(elevations, spacing_m){
  const np  = elevations.length - 1;
  const out = new Array(elevations.length + 2);
  out[0]    = np;
  out[1]    = spacing_m;
  for (let i = 0; i < elevations.length; i++) out[i + 2] = elevations[i];
  return out;
}

// String-ification of the path mode based on dist vs propa thresholds.
// Mirrors splat's strmode output for cross-validation reporting.
function describeMode(prop, propa){
  if (prop.dist <= 0)            return 'invalid';
  if (prop.dist < propa.dlsa)    return 'line-of-sight';
  if (prop.dist > (propa.dx ?? Infinity)) return 'troposcatter';
  return 'diffraction';
}
