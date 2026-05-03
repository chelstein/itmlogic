// AM groundwave (47 CFR §73.183 / §73.184).
//
// HONEST STATE:
//   The reference Sommerfeld–Norton attenuation factor A(p) requires a
//   per-(σ, ε, f) family of curves rather than the single normalized
//   A(p) approximation shipped in the legacy v0.2 dataset.  Until the
//   §73.184 Figures are digitized into a sigma-aware grid, this module
//   refuses to return a contour distance and instead emits the
//   AM_ENGINE_NOT_IMPLEMENTED warning.
//
// What this module DOES provide today, deterministically:
//   - the unattenuated reference field 100·sqrt(P_kW) mV/m at 1 km
//   - the structural radial table (azimuth, pattern factor) so an AM
//     exhibit can still be saved with explicit "engine not implemented"
//     warnings rather than silently fabricated distances.
//
// Never returns a contour distance number.  Never silently substitutes
// FM math.  Never calls AI.

import { W } from '../../types/warnings.js';

export const AM_DEFAULT_CONTOURS = Object.freeze([
  { id: 'city_5mvm',      label: '5 mV/m (city grade)',       field_mvm: 5    },
  { id: 'primary_2mvm',   label: '2 mV/m (primary)',          field_mvm: 2    },
  { id: 'secondary_05mvm',label: '0.5 mV/m (secondary)',      field_mvm: 0.5  },
  { id: 'night_intf',     label: '0.025 mV/m (night intf.)',  field_mvm: 0.025}
]);

export function amReferenceField_mVm_at_1km(erp_kW){
  return 100 * Math.sqrt(Math.max(0, erp_kW));
}

export function amRadialTable({ erp_kW, patternFactorFn, radials_deg, contours = AM_DEFAULT_CONTOURS }){
  const e0 = amReferenceField_mVm_at_1km(erp_kW);
  return radials_deg.map(az => {
    const f = patternFactorFn(az);
    const erp_az = erp_kW * f * f;
    const distances = {};
    for (const c of contours){
      distances[c.id] = null;
    }
    return {
      azimuth_deg:            az,
      relative_field:         f,
      haat_input_m:           null,
      haat_computed_m:        null,
      haat_source:            'n/a (AM groundwave)',
      terrain_profile_source: null,
      reference_field_mVm_at_1km: 100 * Math.sqrt(Math.max(0, erp_az)),
      contour_distances_km:   distances
    };
  });
}

export function amWarnings(){
  return [
    W.make('AM_ENGINE_NOT_IMPLEMENTED',
      'AM groundwave contour solver is not yet implemented to §73.184 fidelity. Reference field at 1 km is reported; per-distance attenuation is not. Refer to a licensed broadcast engineer for AM filings.'),
    W.make('CURVE_VALIDATION_MISSING',
      'AM §73.184 sigma-aware curve grid has not been ingested; engine intentionally refuses to interpolate.')
  ];
}
