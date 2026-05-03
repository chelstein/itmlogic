// FM translator / booster service contour (47 CFR §74.1204).
// Translators reuse the §73.333 F(50,50) curve grid for distance, but
// the protected/interfering field thresholds and the interference
// analysis (D/U ratios, 1st-/2nd-/3rd-adjacent) are translator-specific.
// The contour solver lives here; the interference analysis is left as a
// declared TODO so it never gets quietly inherited from full-service FM.

import { fmRadialTable, FM_DEFAULT_CONTOURS } from '../fm/contour.js';
import { W } from '../../types/warnings.js';

export const FX_METHOD = '47 CFR §74.1204 / §73.333 F(50,50) — FM translator service contour';

// §74.1204(a) protected contour thresholds depend on translator class
// and the underlying primary station class.  Defaulting to 60 dBu / 40
// dBu so the engine returns a reproducible number on day one; the
// per-class table is a documented next step.
export const FX_DEFAULT_CONTOURS = FM_DEFAULT_CONTOURS;

export function fxInputGuards({ erp_kW }){
  const warnings = [];
  if (erp_kW > 0.25){
    warnings.push(W.make('FCC_METHOD_MISSING',
      `FM translator ERP ${erp_kW} kW exceeds the 250 W §74.1235 reference; confirm class.`));
  }
  warnings.push(W.make('FCC_METHOD_MISSING',
    'FM translator interference (§74.1204) D/U analysis is not yet implemented. Distances are the §73.333 F(50,50) lookup only.'));
  return warnings;
}

export async function fxRadialTable(args){
  return fmRadialTable(args);
}
