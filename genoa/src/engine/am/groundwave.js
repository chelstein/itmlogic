// AM groundwave (47 CFR §73.183 / §73.184).
//
// FCC-CANONICAL via the vendored gwave.js (Sommerfeld-Norton evaluation
// against the FCC's pre-tabulated field grid in
// data/gwave_field.json).  Same code that backs
// geo.fcc.gov/api/contours/amDistance.json.
//
// Unlike the previous stub, this module now returns real
// contour-distance numbers per radial AND fills the radial table.
// Inputs that are out of FCC range (frequency, conductivity, ERP)
// surface as structured warnings rather than fabricated distances.

import { W } from '../../types/warnings.js';
import { fccAmDistanceKm } from '../curves/fcc/index.mjs';

export const AM_DEFAULT_CONTOURS = Object.freeze([
  { id: 'city_5mvm',      label: '5 mV/m (city grade)',       field_mvm: 5    },
  { id: 'primary_2mvm',   label: '2 mV/m (primary)',          field_mvm: 2    },
  { id: 'secondary_05mvm',label: '0.5 mV/m (secondary)',      field_mvm: 0.5  },
  { id: 'night_intf',     label: '0.025 mV/m (night intf.)',  field_mvm: 0.025}
]);

// FCC §73.184 default dielectric (relative permittivity).  The pre-
// tabulated field grid was computed against this value across the
// FCC M3 conductivity map; passing a different ε to gwave.js would
// be inconsistent with the tabulated data.
export const AM_DEFAULT_DIELECTRIC = 15;

export function amReferenceField_mVm_at_1km(erp_kW){
  return 100 * Math.sqrt(Math.max(0, erp_kW));
}

/**
 * Compute the AM contour radial table.
 *
 * @param {object}   args
 * @param {number}   args.erp_kW            ERP in kW
 * @param {number}   args.frequency_khz     AM carrier frequency in kHz (530..1700)
 * @param {number}   args.conductivity_msm  Ground conductivity σ in mS/m (FCC M3: 1..8)
 * @param {function} args.patternFactorFn   az_deg → relative-field factor (0..1)
 * @param {number[]} args.radials_deg       list of azimuths in degrees
 * @param {object[]} [args.contours]        contour list (default = AM_DEFAULT_CONTOURS)
 * @param {number}   [args.dielectric]      ε_r (default = AM_DEFAULT_DIELECTRIC)
 */
export function amRadialTable({
  erp_kW,
  frequency_khz,
  conductivity_msm,
  patternFactorFn,
  radials_deg,
  contours = AM_DEFAULT_CONTOURS,
  dielectric = AM_DEFAULT_DIELECTRIC
}){
  // Capture σ clamp/rounding metadata from the first successful FCC
  // call; the σ used is identical for every radial (M3 grid is keyed
  // on σ alone), so one sample suffices.  Exposed as the table's
  // `_ground_constants` sidecar so the orchestrator can plumb it onto
  // exhibit.evidence.ground_constants and emit SIGMA_CLAMP warnings.
  let groundConstants = null;
  const rows = radials_deg.map(az => {
    const f = patternFactorFn(az);
    const erp_az = erp_kW * f * f;
    const distances = {};
    for (const c of contours){
      try {
        const r = fccAmDistanceKm({
          frequency_khz,
          target_mvm:        c.field_mvm,
          conductivity_msm,
          dielectric,
          erp_kw:            erp_az
        });
        distances[c.id] = r.distance_km;
        if (!groundConstants && r.inputs){
          const sigma_in  = Number(r.inputs.conductivity_msm_raw);
          const sigma_use = Number(r.inputs.conductivity_msm);
          const rounding  = Number.isFinite(sigma_in) && Number.isFinite(sigma_use)
            ? +(sigma_use - sigma_in).toFixed(6)
            : null;
          let src = 'exact';
          if (r.inputs.conductivity_clamp === 'low')  src = 'clamped-low (FCC M3 floor σ=1 mS/m)';
          else if (r.inputs.conductivity_clamp === 'high') src = 'clamped-high (FCC M3 ceiling σ=8 mS/m)';
          else if (rounding !== 0 && rounding !== null) src = 'rounded-to-integer-grid';
          groundConstants = {
            sigma_input:    Number.isFinite(sigma_in) ? sigma_in : null,
            sigma_used:     Number.isFinite(sigma_use) ? sigma_use : null,
            sigma_rounding: rounding,
            sigma_clamp:    r.inputs.conductivity_clamp || null,
            sigma_source:   src,
            dielectric:     Number(r.inputs.dielectric),
            frequency_khz_grid: Number(r.inputs.frequency_khz_grid),
            regulation:     '47 CFR §73.184 / Figure M3 (σ ∈ {1..8} mS/m integer grid)'
          };
        }
      } catch (e){
        // Out-of-range / FCC routine error — record null, do NOT
        // fabricate.  The orchestrator surfaces a warning.
        distances[c.id] = null;
      }
    }
    return {
      azimuth_deg:                az,
      relative_field:             f,
      haat_input_m:               null,
      haat_computed_m:            null,
      haat_source:                'n/a (AM groundwave)',
      terrain_profile_source:     null,
      reference_field_mVm_at_1km: 100 * Math.sqrt(Math.max(0, erp_az)),
      contour_distances_km:       distances
    };
  });
  // Attach the ground-constants sidecar on the array without changing
  // its iteration shape — callers that don't read it see the original
  // per-radial array.
  Object.defineProperty(rows, '_ground_constants', {
    value:        groundConstants,
    enumerable:   false,
    configurable: false
  });
  return rows;
}

/**
 * Inspect σ resolution metadata.  Returns the same shape as the
 * `_ground_constants` sidecar attached to amRadialTable's return value,
 * computed standalone for callers that just want to know how the FCC
 * grid clamped/rounded their σ before computing distances.
 */
export function amGroundConstants({ frequency_khz, conductivity_msm, dielectric = AM_DEFAULT_DIELECTRIC } = {}){
  const sigma_in = Number(conductivity_msm);
  if (!Number.isFinite(sigma_in)) return null;
  let sigma_use = Math.round(sigma_in);
  let clamp = null;
  if (sigma_use < 1){ sigma_use = 1; clamp = 'low'; }
  else if (sigma_use > 8){ sigma_use = 8; clamp = 'high'; }
  const rounding = +(sigma_use - sigma_in).toFixed(6);
  let src = 'exact';
  if (clamp === 'low') src = 'clamped-low (FCC M3 floor σ=1 mS/m)';
  else if (clamp === 'high') src = 'clamped-high (FCC M3 ceiling σ=8 mS/m)';
  else if (rounding !== 0) src = 'rounded-to-integer-grid';
  return {
    sigma_input:    sigma_in,
    sigma_used:     sigma_use,
    sigma_rounding: rounding,
    sigma_clamp:    clamp,
    sigma_source:   src,
    dielectric:     Number(dielectric),
    frequency_khz_grid: Number.isFinite(Number(frequency_khz)) ? Math.round(Number(frequency_khz) / 10) * 10 : null,
    regulation:     '47 CFR §73.184 / Figure M3 (σ ∈ {1..8} mS/m integer grid)'
  };
}

// Returns warnings for the AM compute path.  No longer emits
// AM_ENGINE_NOT_IMPLEMENTED — the engine IS implemented now via the
// vendored FCC gwave.js — but flags real input gaps (missing σ,
// out-of-range frequency, etc).
export function amWarnings({ frequency_khz, conductivity_msm, erp_kw } = {}){
  const out = [];
  const freq = Number(frequency_khz);
  const sigma = Number(conductivity_msm);
  const erp = Number(erp_kw);
  if (!Number.isFinite(freq) || freq < 530 || freq > 1700){
    out.push(W.make('FCC_METHOD_MISSING',
      `AM frequency ${freq} kHz is outside the FCC AM band (530..1700 kHz); §73.184 groundwave does not apply.`));
  }
  if (!Number.isFinite(sigma) || sigma < 1 || sigma > 8){
    out.push(W.make('FCC_METHOD_MISSING',
      `AM ground conductivity ${sigma} mS/m is outside the FCC M3 grid (1..8 mS/m).  The FCC §73.184 tabulated curves do not extend beyond this range.`));
  }
  if (!Number.isFinite(erp) || erp <= 0){
    out.push(W.make('FCC_METHOD_MISSING',
      'AM ERP must be positive for §73.184 groundwave computation.'));
  }
  return out;
}
