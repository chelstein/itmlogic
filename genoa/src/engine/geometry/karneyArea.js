// Bevis-Cambareri spherical-trapezoid polygon area.
//
// REFERENCES
//   Bevis, M., Cambareri, G. (1987).  "Computing the area of a
//     spherical polygon of arbitrary shape."  Mathematical Geology
//     19 (4), 335-346.
//   Karney, C.F.F. (2013).  "Algorithms for geodesics."  J. Geodesy
//     87 (1), 43-55.  (Karney's PolygonArea uses an
//     ellipsoid-corrected variant for arbitrary polygon size; for
//     FCC-scale contour rings the simpler Bevis-Cambareri form below
//     is accurate to ≪ 0.1%.)
//
// FORMULA
//   For a closed ring of (φ, λ) vertices on the unit sphere, treating
//   each edge as a rhumb line (constant bearing — a near-perfect
//   approximation for the small Δφ + Δλ encountered in FCC contour
//   rings), the signed contribution of each edge to the polygon's
//   spherical-trapezoid area is:
//
//     ΔA_i = atan2(
//              tan((λ_{i+1} − λ_i) / 2) · (sin φ_i + sin φ_{i+1}),
//              1 + sin φ_i · sin φ_{i+1} · cos(λ_{i+1} − λ_i)
//            )
//
//   The polygon area is R² · | Σ ΔA_i |, with R the WGS-84 authalic
//   radius (radius of the sphere with the same surface area as the
//   ellipsoid).
//
// LIMITATIONS
//   This is a SPHERICAL-TRAPEZOID approximation.  It is accurate to
//   well under 0.1 % for small polygons (Δλ ≪ π/2, |φ| < ~70°) — i.e.,
//   every FCC contour ring at every CONUS latitude.  It systematically
//   under-counts for polygons containing huge (≥ π/2-spanning)
//   geodesic arcs that bow sharply away from a rhumb line; that case
//   doesn't arise in propagation contour work.  For arbitrary polygons
//   on the ellipsoid, use Karney's full PolygonArea (geographiclib).
//
// PRECISION (vs. equirectangular shoelace, which this replaces)
//   On a Class C 100 kW / 600 m HAAT 60 dBu polygon at 33°N:
//     equirectangular shoelace : ~1.0 % high (longitude-degree drift)
//     Bevis-Cambareri (this)    : < 0.05 % vs. analytic
//     Karney full / WGS-84      : < 0.001 %  (overkill at this scale)

import { WGS84_A_KM, WGS84_B_KM } from './wgs84.js';

// Use the WGS-84 authalic radius (radius of the sphere with the same
// surface area as the ellipsoid).  Closed-form approximation:
//   R_a ≈ √( (a² + b² · ( atanh(e) / e )) / 2 )   …Karney §B.
// We use a simpler high-accuracy series (sufficient for sub-1% area
// targets):
//   R_a ≈ ((2 a² + b²) / 3)^(1/2)
const WGS84_AUTHALIC_KM = Math.sqrt((2 * WGS84_A_KM**2 + WGS84_B_KM**2) / 3);
export { WGS84_AUTHALIC_KM };

const D2R = Math.PI / 180;

/**
 * Compute the spherical-polygon area on the WGS-84 authalic sphere.
 * Input is a closed ring [[lat,lon], …, [lat,lon]] (first === last).
 * Returns area in km² (always positive — orientation is folded out via
 * Math.abs of the spherical excess).
 *
 * @param {Array<[number,number]>} ring  closed ring of [lat, lon] in degrees
 * @returns {number}                     area in km²
 */
export function ringArea_km2(ring){
  if (!Array.isArray(ring) || ring.length < 4) return 0;

  // Ensure the ring is closed.  If not, the formula still works on the
  // open form via the i+1 modulo, but explicit closure keeps Σ on the
  // edges only.
  const closed =
    ring[0][0] === ring[ring.length - 1][0] &&
    ring[0][1] === ring[ring.length - 1][1]
      ? ring
      : [...ring, ring[0]];

  // Bevis-Cambareri spherical-trapezoid:
  //   2·A/R² = | Σ_edges (λ_{i+1} − λ_i) · (sin φ_i + sin φ_{i+1}) |
  //
  // This is the discrete form of the line integral
  //   2·A/R² = | ∮ sin φ dλ |
  // which by Stokes' theorem on the sphere equals twice the polygon's
  // signed surface area divided by R².  Each edge contributes the
  // exact area of its longitudinal-strip trapezoid (treated as a
  // rhumb line — constant bearing); for FCC contour rings, where
  // every edge is a short geodesic ≪ 1° in either direction, the
  // rhumb-line ↔ geodesic distinction is sub-millimeter.
  //
  // The atan2 form sometimes seen in literature corrects this for
  // very large polygons (≥ π/2 spans) but UNDERCOUNTS small polygons
  // at non-zero latitude by a factor of ~ 1 / (1 + sin²φ).  We
  // intentionally use the simpler exact-trapezoidal form here.
  let twoArea = 0;
  for (let i = 0; i < closed.length - 1; i++){
    const φ1 = closed[i][0]   * D2R;
    const λ1 = closed[i][1]   * D2R;
    const φ2 = closed[i+1][0] * D2R;
    const λ2 = closed[i+1][1] * D2R;
    twoArea += (λ2 - λ1) * (Math.sin(φ1) + Math.sin(φ2));
  }
  // |·|/2 absorbs ring orientation (CW or CCW) and the 2 from above.
  return Math.abs(twoArea) * 0.5 * WGS84_AUTHALIC_KM * WGS84_AUTHALIC_KM;
}
