// Geodesic destination on a spherical Earth.  Adequate for FCC contour
// radial endpoints (≤ ~300 km, sub-100 m absolute error vs WGS-84).
// Returns [lat, lon] in degrees.  Longitude is normalized to (-180, 180].

export const R_EARTH_KM = 6371.0088;

export function destPoint(lat, lon, az_deg, dist_km){
  const br = az_deg  * Math.PI / 180;
  const φ1 = lat     * Math.PI / 180;
  const λ1 = lon     * Math.PI / 180;
  const dr = dist_km / R_EARTH_KM;
  const φ2 = Math.asin(
    Math.sin(φ1) * Math.cos(dr) +
    Math.cos(φ1) * Math.sin(dr) * Math.cos(br)
  );
  const λ2 = λ1 + Math.atan2(
    Math.sin(br) * Math.sin(dr) * Math.cos(φ1),
    Math.cos(dr) - Math.sin(φ1) * Math.sin(φ2)
  );
  return [
    φ2 * 180 / Math.PI,
    ((λ2 * 180 / Math.PI + 540) % 360) - 180
  ];
}

export function bearingAndRange_km(lat1, lon1, lat2, lon2){
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(Δφ/2)**2 + Math.cos(φ1)*Math.cos(φ2)*Math.sin(Δλ/2)**2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  const range_km = R_EARTH_KM * c;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1)*Math.sin(φ2) - Math.sin(φ1)*Math.cos(φ2)*Math.cos(Δλ);
  const az_deg = ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360;
  return { az_deg, range_km };
}
