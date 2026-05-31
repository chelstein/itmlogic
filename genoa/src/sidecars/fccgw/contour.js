// contour.js — FCC/OET R86-1 groundwave contour interpolation.
//
// Exports:
//   findContourDistance(distances, fields, targetField)
//   generateDistanceGrid(n)
//   computeContour({ freq_hz, sigma_s_per_m, epsilon, e1km_mvm, target_field_mvm })

'use strict';

const { runFccgw } = require('./engine.js');

/**
 * Find the distance at which the field equals targetField using log-log
 * interpolation between adjacent grid points.  Returns null when targetField
 * is outside the range covered by the supplied (distances, fields) arrays.
 *
 * Algorithm:
 *   log(E) vs log(d) is approximately linear over each interval in the
 *   FCC ground-wave curves.  We find the bracketing pair and interpolate
 *   on log(E) = m * log(d) + b.
 *
 * @param {number[]} distances  Distances in km (strictly increasing, > 0)
 * @param {number[]} fields     Field strengths in mV/m (same length as distances)
 * @param {number}   targetField  Target field in mV/m (must be > 0)
 * @returns {number | null}  Interpolated distance in km, or null if not bracketed
 */
function findContourDistance(distances, fields, targetField){
  if (!Array.isArray(distances) || !Array.isArray(fields)){
    throw new TypeError('distances and fields must be arrays');
  }
  if (distances.length !== fields.length || distances.length < 2){
    throw new RangeError('distances and fields must have the same length (>= 2)');
  }
  if (!Number.isFinite(targetField) || targetField <= 0){
    throw new RangeError('targetField must be a positive finite number');
  }

  const n = distances.length;

  // Fields typically decrease with distance.  The target must be between
  // the smallest and largest field values in the array.
  const maxField = Math.max.apply(null, fields);
  const minField = Math.min.apply(null, fields);

  if (targetField > maxField || targetField < minField){
    return null;  // target is out of range
  }

  // Find adjacent bracket (i, i+1) where fields[i] >= target > fields[i+1]
  // (for a monotonically decreasing field profile).
  for (let i = 0; i < n - 1; i++){
    const f0 = fields[i];
    const f1 = fields[i + 1];
    const d0 = distances[i];
    const d1 = distances[i + 1];

    if (f0 <= 0 || f1 <= 0 || d0 <= 0 || d1 <= 0) continue;

    // Check bracket: target is between f0 and f1.
    const inBracket = (f0 >= targetField && targetField >= f1)
                   || (f1 >= targetField && targetField >= f0);
    if (!inBracket) continue;

    // Log-log interpolation: log(E) = m * log(d) + b
    const logD0 = Math.log(d0);
    const logD1 = Math.log(d1);
    const logF0 = Math.log(f0);
    const logF1 = Math.log(f1);
    const logE  = Math.log(targetField);

    const dLogD = logD1 - logD0;
    const dLogF = logF1 - logF0;

    if (Math.abs(dLogF) < 1e-15){
      return Math.exp((logD0 + logD1) / 2);
    }

    const logD = logD0 + (logE - logF0) * dLogD / dLogF;
    return Math.exp(logD);
  }

  return null;
}

/**
 * Generate a log-spaced distance grid from 0.5 km to 2000 km.
 *
 * @param {number} [n=200]  Number of grid points
 * @returns {number[]}      Array of distances in km
 */
function generateDistanceGrid(n){
  if (n === undefined) n = 200;
  const logMin = Math.log10(0.5);
  const logMax = Math.log10(2000);
  const grid = [];
  for (let i = 0; i < n; i++){
    const t = i / (n - 1);
    grid.push(Math.pow(10, logMin + t * (logMax - logMin)));
  }
  return grid;
}

/**
 * Compute the distance at which the FCC/OET R86-1 groundwave field equals
 * target_field_mvm, using a 200-point log-spaced distance grid.
 */
async function computeContour(params){
  const { freq_hz, sigma_s_per_m, epsilon, e1km_mvm, target_field_mvm } = params;
  const n_grid = params.n_grid || 200;
  const distances_km = generateDistanceGrid(n_grid);

  const result = await runFccgw({
    freq_hz,
    sigma_s_per_m,
    epsilon,
    e1km_mvm,
    distances_km
  });
  const fields_mvm = result.fields_mvm;

  const contour_distance_km = findContourDistance(distances_km, fields_mvm, target_field_mvm);

  let bracketed_by = null;
  let field_mvm_at_contour = null;

  if (contour_distance_km !== null){
    field_mvm_at_contour = target_field_mvm;

    for (let i = 0; i < distances_km.length - 1; i++){
      const f0 = fields_mvm[i];
      const f1 = fields_mvm[i + 1];
      const d0 = distances_km[i];
      const d1 = distances_km[i + 1];
      const inBracket = (f0 >= target_field_mvm && target_field_mvm >= f1)
                     || (f1 >= target_field_mvm && target_field_mvm >= f0);
      if (inBracket){
        bracketed_by = { d_lo_km: d0, e_lo_mvm: f0, d_hi_km: d1, e_hi_mvm: f1 };
        break;
      }
    }
  }

  return {
    contour_distance_km,
    field_mvm_at_contour,
    bracketed_by,
    n_grid_points: n_grid,
    advisory:      true,
    filing_effect: 'none'
  };
}

module.exports = { findContourDistance, generateDistanceGrid, computeContour };
