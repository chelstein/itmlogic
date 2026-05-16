// Visual Summary — the showpiece page.
//
// Composes everything the engineer already computed into one stylized
// composition that a non-engineer can read at a glance:
//   - service contours (city / primary / secondary / night)
//   - population dot-density inside the primary contour
//   - environmental tree-canopy halo at the transmitter site
//   - big stylized population + canopy stats
//   - advisory banner verbatim
//
// All data comes from the exhibit that already exists; no extra sidecar
// calls happen at render time.  Renders only when there are real
// contours to plot AND finite tx coordinates.  Otherwise returns null
// and the page is skipped.
//
// REGULATORY POSTURE
//   Population values are INFORMATIONAL ONLY (verbatim from the
//   contour-results limitations).  Tree canopy is ADVISORY ONLY and
//   FROM the geo-RF evidence sidecar (filing_effect=none).  This page
//   does NOT modify FCC §73.184 / §73.333 contour distances or any
//   filing-controlling rule output.

export function buildVisualSummarySection(exhibit){
  const inp = exhibit?.station_inputs || {};
  const txLat = Number(inp.lat);
  const txLon = Number(inp.lon);
  if (!Number.isFinite(txLat) || !Number.isFinite(txLon)) return null;

  // Contour definitions from the engine.  Shape:
  //   { id, label, mean_km, min_km, max_km, area_km2 }  (non-DA: all same)
  // Plus optionally per-radial polygons on exhibit.radial_table.
  const defs = Array.isArray(exhibit?.contour_definitions) ? exhibit.contour_definitions : [];
  if (defs.length === 0) return null;

  // Build a stable, ordered palette of rings — outermost first so the
  // renderer paints back-to-front (large washes underneath, tight rings
  // on top).  IDs follow the engine's contour ID convention.
  const PALETTE = {
    night_intf:      { color: '#2b4a5d', label: '0.025 mV/m night',  fill_opacity: 0.05,  dashed: true  },
    secondary_05mvm: { color: '#d6a85d', label: '0.5 mV/m secondary',fill_opacity: 0.10,  dashed: false },
    primary_2mvm:    { color: '#c8843c', label: '2 mV/m primary',    fill_opacity: 0.18,  dashed: false },
    city_5mvm:       { color: '#a8412a', label: '5 mV/m city grade', fill_opacity: 0.28,  dashed: false }
  };

  const contours = defs
    .map((d) => {
      const km = Number(d?.mean_km ?? d?.max_km);
      if (!Number.isFinite(km) || km <= 0) return null;
      const id = String(d?.id || '').toLowerCase();
      const style = PALETTE[id] || { color: '#666666', label: d?.label || id, fill_opacity: 0.08, dashed: false };
      return {
        id,
        label:        d?.label || style.label,
        radius_km:    km,
        area_km2:     Number(d?.area_km2),
        color:        style.color,
        fill_opacity: style.fill_opacity,
        dashed:       style.dashed,
        is_dominant:  id === 'primary_2mvm'    // primary is the "people inside" reference
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.radius_km - a.radius_km);   // outermost first

  if (contours.length === 0) return null;

  // Population — informational only.  exhibit.population_estimate is
  // attached for both AM and FM exhibits when the population sidecar /
  // FCC Census / ACS chain returned a count.
  const pe = exhibit?.population_estimate || {};
  const persons = Number.isFinite(Number(pe.persons))
    ? Math.max(0, Math.round(Number(pe.persons)))
    : null;
  const population = persons != null
    ? {
        persons,
        source:  pe.source  || null,
        vintage: pe.vintage || null
      }
    : null;

  // Environmental RF evidence — geo-RF tree canopy at tx site.
  const ge = exhibit?.evidence?.geo_rf_evidence;
  const tc = ge?.datasets?.tree_canopy_conus || {};
  const canopy = (ge?.status === 'run' && tc.available)
    ? {
        value_numeric:  Number.isFinite(Number(tc.value_numeric)) ? Number(tc.value_numeric) : null,
        value_raw:      tc.value_raw || null,
        dataset:        tc.dataset || null,
        interpretation: tc.interpretation || null
      }
    : null;

  const fmtKhz = (f) => {
    const n = Number(f);
    if (!Number.isFinite(n)) return null;
    if (String(inp.frequency_unit || '').toLowerCase() === 'khz' || (n > 500 && n < 1800)) return `${Math.round(n)} kHz`;
    if (n > 80 && n < 110) return `${n.toFixed(1)} MHz`;
    return `${n} ${inp.frequency_unit || ''}`.trim();
  };

  return {
    id:      'visual-summary',
    type:    'visual-summary',
    heading: 'COVERAGE & ENVIRONMENT — VISUAL SUMMARY',
    tx: {
      lat:           txLat,
      lon:           txLon,
      call:          inp.call         || null,
      facility_id:   inp.facility_id  || null,
      service:       String(inp.service || '').toUpperCase() || null,
      fcc_class:     inp.fcc_class    || null,
      frequency:     fmtKhz(inp.frequency),
      erp_kw:        Number(inp.erp_kw),
      community:     inp.community_of_license || inp.community || null
    },
    contours,
    population,
    canopy,
    advisory: 'Environmental RF evidence is advisory only.  Does not modify FCC filing-controlling contour or allocation calculations.  Population values are informational only — FCC §73.x compliance is determined by distance and field-strength tests, not population.'
  };
}
