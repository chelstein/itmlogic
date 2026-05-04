// WGS-84 ellipsoid constants + Vincenty (1975) direct & inverse
// formulae.  Replaces the spherical-earth haversine + great-circle
// destination math with the canonical FCC reference ellipsoid.
//
// REFERENCES
//   Vincenty, T. (1975).  "Direct and Inverse Solutions of Geodesics
//     on the Ellipsoid with Application of Nested Equations."
//     Survey Review, XXIII (176): 88–93.
//     https://www.ngs.noaa.gov/PUBS_LIB/inverse.pdf
//   NIMA TR 8350.2 (2000).  WGS-84 reference ellipsoid.
//   Karney, C.F.F. (2013).  "Algorithms for geodesics."  J. Geodesy.
//     (Karney's iterative inverse handles antipodal cases that
//      Vincenty's diverges on; we keep Vincenty here because FCC
//      contour endpoints are always well under 1000 km from the
//      transmitter where Vincenty converges in 1-3 iterations.)
//
// PRECISION
//   Direct formula: ~0.5 mm error vs Karney over Earth-scale distances.
//   Inverse formula: ~mm-class error; 20-iteration cap returns the
//     last estimate even on a non-converged antipodal case (won't
//     happen for FCC contour use cases — radial distances are bounded
//     by §73.333 to ≤500 km).
//
// All inputs are in degrees / km; outputs in degrees / km / degrees.

// WGS-84 ellipsoid parameters (NIMA TR 8350.2).
export const WGS84_A_M       = 6378137.0;                 // semi-major axis (meters)
export const WGS84_F         = 1 / 298.257223563;         // flattening
export const WGS84_B_M       = WGS84_A_M * (1 - WGS84_F); // semi-minor axis
export const WGS84_A_KM      = WGS84_A_M / 1000;
export const WGS84_B_KM      = WGS84_B_M / 1000;
export const WGS84_E2        = WGS84_F * (2 - WGS84_F);   // first eccentricity²
export const WGS84_EP2       = WGS84_E2 / (1 - WGS84_E2); // second eccentricity²

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

/**
 * Vincenty's DIRECT formula.
 * Given a starting point, an initial bearing, and a distance, return
 * the destination point and final bearing.
 *
 * @param {number} lat       starting latitude  in degrees
 * @param {number} lon       starting longitude in degrees
 * @param {number} az_deg    initial bearing    in degrees from true north (clockwise)
 * @param {number} dist_km   distance to travel in kilometers
 * @returns {{ lat:number, lon:number, final_bearing_deg:number, iterations:number }}
 */
export function vincentyDirect(lat, lon, az_deg, dist_km){
  const φ1   = lat    * D2R;
  const λ1   = lon    * D2R;
  const α1   = az_deg * D2R;
  const s    = dist_km * 1000;          // meters
  const a    = WGS84_A_M;
  const b    = WGS84_B_M;
  const f    = WGS84_F;

  const sinα1 = Math.sin(α1);
  const cosα1 = Math.cos(α1);

  const tanU1 = (1 - f) * Math.tan(φ1);
  const cosU1 = 1 / Math.sqrt(1 + tanU1*tanU1);
  const sinU1 = tanU1 * cosU1;

  // σ1 — angular distance on the sphere from the equator to point 1.
  const σ1   = Math.atan2(tanU1, cosα1);
  const sinα = cosU1 * sinα1;
  const cos2α = 1 - sinα*sinα;
  const u2    = cos2α * (a*a - b*b) / (b*b);

  const A = 1 + u2/16384 * (4096 + u2 * (-768 + u2 * (320 - 175*u2)));
  const B =     u2/1024  * (256  + u2 * (-128 + u2 * (74  - 47 *u2)));

  let σ      = s / (b * A);
  let σPrev  = 0;
  let cos2σm = 0;
  let sinσ   = 0;
  let cosσ   = 0;
  let Δσ     = 0;
  let iter   = 0;
  do {
    cos2σm = Math.cos(2*σ1 + σ);
    sinσ   = Math.sin(σ);
    cosσ   = Math.cos(σ);
    Δσ     = B * sinσ * (cos2σm + B/4 * (
              cosσ*(-1 + 2*cos2σm*cos2σm)
              - B/6 * cos2σm * (-3 + 4*sinσ*sinσ) * (-3 + 4*cos2σm*cos2σm)
             ));
    σPrev = σ;
    σ     = s / (b * A) + Δσ;
    iter++;
  } while (Math.abs(σ - σPrev) > 1e-12 && iter < 20);

  const x   = sinU1 * sinσ - cosU1 * cosσ * cosα1;
  const φ2  = Math.atan2(sinU1*cosσ + cosU1*sinσ*cosα1,
                          (1 - f) * Math.sqrt(sinα*sinα + x*x));
  const λ   = Math.atan2(sinσ*sinα1, cosU1*cosσ - sinU1*sinσ*cosα1);
  const C   = f/16 * cos2α * (4 + f*(4 - 3*cos2α));
  const L   = λ - (1 - C) * f * sinα * (
                σ + C*sinσ*(cos2σm + C*cosσ*(-1 + 2*cos2σm*cos2σm))
              );
  const λ2  = λ1 + L;

  // final azimuth
  const α2  = Math.atan2(sinα, -x);

  return {
    lat:               φ2 * R2D,
    lon:               ((λ2 * R2D + 540) % 360) - 180,
    final_bearing_deg: ((α2 * R2D + 360) % 360),
    iterations:        iter
  };
}

/**
 * Vincenty's INVERSE formula.
 * Given two points, return the geodesic distance + initial / final bearings.
 *
 * @param {number} lat1, lon1, lat2, lon2 — degrees
 * @returns {{ distance_km:number, initial_bearing_deg:number, final_bearing_deg:number, iterations:number, converged:boolean }}
 */
export function vincentyInverse(lat1, lon1, lat2, lon2){
  const φ1 = lat1 * D2R;
  const φ2 = lat2 * D2R;
  const L  = (lon2 - lon1) * D2R;
  const a  = WGS84_A_M;
  const b  = WGS84_B_M;
  const f  = WGS84_F;

  const tanU1 = (1 - f) * Math.tan(φ1);
  const cosU1 = 1 / Math.sqrt(1 + tanU1*tanU1);
  const sinU1 = tanU1 * cosU1;
  const tanU2 = (1 - f) * Math.tan(φ2);
  const cosU2 = 1 / Math.sqrt(1 + tanU2*tanU2);
  const sinU2 = tanU2 * cosU2;

  let λ      = L;
  let λPrev  = 0;
  let iter   = 0;
  let cos2α  = 0;
  let cos2σm = 0;
  let sinσ   = 0;
  let cosσ   = 0;
  let σ      = 0;
  let sinα   = 0;
  let converged = true;

  do {
    const sinλ = Math.sin(λ);
    const cosλ = Math.cos(λ);
    const sinSqσ =
      (cosU2*sinλ) * (cosU2*sinλ)
      + (cosU1*sinU2 - sinU1*cosU2*cosλ) * (cosU1*sinU2 - sinU1*cosU2*cosλ);
    sinσ = Math.sqrt(sinSqσ);
    if (sinσ === 0){
      // Coincident points.
      return {
        distance_km:        0,
        initial_bearing_deg: 0,
        final_bearing_deg:   0,
        iterations:          iter,
        converged:           true
      };
    }
    cosσ   = sinU1*sinU2 + cosU1*cosU2*cosλ;
    σ      = Math.atan2(sinσ, cosσ);
    sinα   = cosU1 * cosU2 * sinλ / sinσ;
    cos2α  = 1 - sinα*sinα;
    cos2σm = cos2α !== 0 ? cosσ - 2*sinU1*sinU2/cos2α : 0;   // equatorial
    const C = f/16 * cos2α * (4 + f*(4 - 3*cos2α));
    λPrev = λ;
    λ = L + (1 - C) * f * sinα * (
          σ + C*sinσ*(cos2σm + C*cosσ*(-1 + 2*cos2σm*cos2σm))
        );
    iter++;
    if (iter > 100){ converged = false; break; }
  } while (Math.abs(λ - λPrev) > 1e-12);

  const u2 = cos2α * (a*a - b*b) / (b*b);
  const A  = 1 + u2/16384 * (4096 + u2*(-768 + u2*(320 - 175*u2)));
  const B  =     u2/1024  * (256  + u2*(-128 + u2*(74  - 47 *u2)));
  const Δσ = B * sinσ * (
              cos2σm
              + B/4 * (
                  cosσ*(-1 + 2*cos2σm*cos2σm)
                  - B/6 * cos2σm * (-3 + 4*sinσ*sinσ) * (-3 + 4*cos2σm*cos2σm)
                )
            );
  const s   = b * A * (σ - Δσ);                        // meters
  const α1  = Math.atan2(cosU2 * Math.sin(λ),  cosU1*sinU2 - sinU1*cosU2*Math.cos(λ));
  const α2  = Math.atan2(cosU1 * Math.sin(λ), -sinU1*cosU2 + cosU1*sinU2*Math.cos(λ));
  return {
    distance_km:         s / 1000,
    initial_bearing_deg: ((α1 * R2D + 360) % 360),
    final_bearing_deg:   ((α2 * R2D + 360) % 360),
    iterations:          iter,
    converged
  };
}

export const WGS84 = Object.freeze({
  A_M: WGS84_A_M, B_M: WGS84_B_M, F: WGS84_F,
  A_KM: WGS84_A_KM, B_KM: WGS84_B_KM,
  E2: WGS84_E2, EP2: WGS84_EP2
});
