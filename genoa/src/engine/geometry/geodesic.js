// Geodesic destination + bearing on the WGS-84 ellipsoid.
//
// MIGRATION FROM PRIOR (spherical Earth) IMPLEMENTATION
//   This module now uses Vincenty's formulae against WGS-84 (a, b, f).
//   The previous spherical-Earth haversine + great-circle destination
//   produced sub-100 m absolute error vs WGS-84 at FCC contour ranges
//   (≤ 300 km).  Vincenty gives sub-mm error, identical to what
//   geo.fcc.gov uses internally.  Function signatures are unchanged
//   so all callers keep working.
//
//   The constant R_EARTH_KM is RETAINED as a convenience for callers
//   that need a spherical-mean radius (e.g. legacy distance bounds);
//   it is NO LONGER used by destPoint() or bearingAndRange_km().

import { vincentyDirect, vincentyInverse, WGS84_A_KM, WGS84_B_KM } from './wgs84.js';

// Spherical-mean radius (kept for callers that import this constant).
// Not used by the geodesic functions below.
export const R_EARTH_KM = 6371.0088;

/**
 * Returns [lat_deg, lon_deg] at azimuth `az_deg` and distance `dist_km`
 * from (lat, lon) on the WGS-84 ellipsoid.
 */
export function destPoint(lat, lon, az_deg, dist_km){
  const r = vincentyDirect(lat, lon, az_deg, dist_km);
  return [r.lat, r.lon];
}

/**
 * Returns { az_deg, range_km } from (lat1, lon1) to (lat2, lon2)
 * on the WGS-84 ellipsoid via Vincenty's inverse formula.
 */
export function bearingAndRange_km(lat1, lon1, lat2, lon2){
  const r = vincentyInverse(lat1, lon1, lat2, lon2);
  return { az_deg: r.initial_bearing_deg, range_km: r.distance_km };
}

// Re-export ellipsoid constants for callers that want them direct.
export { WGS84_A_KM, WGS84_B_KM };
