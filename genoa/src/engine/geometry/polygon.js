// Polygon utilities for closed contour rings.
// All polygons must be CLOSED (first vertex == last vertex) before any
// downstream consumer (Leaflet, GeoJSON, area math) sees them.

export function closeRing(latlngs){
  if (!latlngs.length) return latlngs;
  const [a0, b0] = latlngs[0];
  const [aN, bN] = latlngs[latlngs.length - 1];
  if (a0 === aN && b0 === bN) return latlngs;
  return [...latlngs, [a0, b0]];
}

export function isClosed(latlngs){
  if (latlngs.length < 4) return false;
  const [a0, b0] = latlngs[0];
  const [aN, bN] = latlngs[latlngs.length - 1];
  return a0 === aN && b0 === bN;
}

// Equirectangular area approximation; OK for FCC-scale contours where
// the ring spans well under 5 degrees of latitude.  Returns km².
export function ringArea_km2(latlngs){
  if (latlngs.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < latlngs.length - 1; i++){
    const [y1, x1] = latlngs[i];
    const [y2, x2] = latlngs[i+1];
    sum += (x2 - x1) * (y2 + y1);
  }
  const meanLat = latlngs.reduce((s,p)=>s+p[0],0) / latlngs.length;
  const km_per_deg_lat = 111.32;
  const km_per_deg_lon = 111.32 * Math.cos(meanLat * Math.PI / 180);
  return Math.abs(sum * km_per_deg_lat * km_per_deg_lon / 2);
}
