// Linear interpolation across a parsed directional pattern table.
// Returns 1.0 for non-directional (null table).

export function patternFactor(table, az_deg){
  if (!table) return 1.0;
  const az = ((az_deg % 360) + 360) % 360;
  for (let i = 0; i < table.length; i++){
    const [a1, v1] = table[i];
    const [a2, v2] = table[(i + 1) % table.length];
    const a2w = (a2 < a1) ? a2 + 360 : a2;
    const azw = (az < a1) ? az + 360 : az;
    if (azw >= a1 && azw <= a2w){
      const t = (azw - a1) / Math.max(1e-6, (a2w - a1));
      return v1 + t * (v2 - v1);
    }
  }
  return 1.0;
}
