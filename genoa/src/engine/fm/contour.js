// FM F(50,50) and F(50,10) contour distance, deterministic, dataset-driven.
// Implements 47 CFR §73.333 Figure 1 (F(50,50)) and Figure 1a (F(50,10))
// via 2-D interpolation over the published curve grid.
//
// AXES (per dataset.axes):
//   rows = haat_m            (ascending)
//   cols = f_dBu             (DESCENDING in the source dataset)
//   value = distance_km at 1 kW ERP
//
// ALGORITHM:
//   1. effective field at 1 kW = target_dBu - 10*log10(erp_kW)
//   2. for each haat row, interpolate log10(distance) vs ascending field
//   3. interpolate that distances-by-haat array linearly along haat
//
// Interpolation choice (linear-along-field on log10(distance), linear-
// along-HAAT) is recorded in the result so the exhibit is reproducible.

import { lerp1, INTERP_METHODS } from '../curves/interp.js';

const MODE_DATASET = {
  '50,50': 'f5050',
  '50,10': 'f5010'
};

export const FM_CONTOUR_METHODS = Object.freeze({
  F50_50: '47 CFR §73.333 F(50,50)',
  F50_10: '47 CFR §73.333 F(50,10)'
});

export const FM_DEFAULT_CONTOURS = Object.freeze([
  { id: 'service_60dbu',  label: '60 dBu (1 mV/m service)', field_dBu: 60 },
  { id: 'city_54dbu',     label: '54 dBu (city grade)',     field_dBu: 54 },
  { id: 'protected_40dbu',label: '40 dBu (protected)',      field_dBu: 40 }
]);

export async function fmContourDistance_km({ datasetByName, mode = '50,50', target_dBu, erp_kW, haat_m }){
  const tbl = await datasetByName(MODE_DATASET[mode]);
  if (!tbl) throw new Error(`fm dataset unavailable for mode ${mode}`);
  const haats     = tbl.haat_grid_m;
  const fields    = tbl.field_grid_dBu;
  const grid      = tbl.distance_km;

  const effective_dBu = target_dBu - 10 * Math.log10(Math.max(1e-3, erp_kW));

  const fieldsAsc = fields.slice().reverse();
  const distsAtH = haats.map((_, hi) => {
    const rowAsc = grid[hi].slice().reverse();
    const logRow = rowAsc.map(d => Math.log10(d));
    const logd   = lerp1(fieldsAsc, logRow, effective_dBu);
    return Math.pow(10, logd);
  });

  const h = Math.max(haats[0], Math.min(haats[haats.length - 1], haat_m));
  return lerp1(haats, distsAtH, h);
}

// Build a full radial table at constant erp / pattern / haat-per-radial.
// haatPerRadial is the array produced by src/engine/haat/{flat,radial}.js
// (same length as radials_deg, same indexing).
export async function fmRadialTable({
  datasetByName,
  mode = '50,50',
  contours = FM_DEFAULT_CONTOURS,
  erp_kW,
  patternFactorFn,
  haatPerRadial
}){
  const out = [];
  for (const r of haatPerRadial){
    const f = patternFactorFn(r.az);
    const erp_az = erp_kW * f * f;
    const haat = r.haat_computed_m ?? r.haat_input_m;
    const distances = {};
    for (const c of contours){
      distances[c.id] = await fmContourDistance_km({
        datasetByName,
        mode,
        target_dBu: c.field_dBu,
        erp_kW:     erp_az,
        haat_m:     haat
      });
    }
    out.push({
      azimuth_deg:            r.az,
      relative_field:         f,
      haat_input_m:           r.haat_input_m,
      haat_computed_m:        r.haat_computed_m,
      haat_source:            r.haat_source,
      terrain_profile_source: r.terrain_profile_source,
      contour_distances_km:   distances
    });
  }
  return out;
}

export const FM_INTERP = Object.freeze({
  along_field: INTERP_METHODS.LINEAR_LOG10,
  along_haat:  INTERP_METHODS.LINEAR_LINEAR,
  source:      '47 CFR §73.333 tabulated F(50,50) / F(50,10) curves'
});
