// County Boundary / FCC County Overlay Analysis report section.
//
// Renders when exhibit.evidence.county_overlay is populated.
// Skipped (returns null) if county overlay evidence is absent or unavailable.
//
// Section layout:
//   1. Dataset provenance paragraph (name, path, SHA256, feature counts, partial flag)
//   2. Table of intersecting counties with overlap percentages
//   3. Missing-county notice paragraph (if applicable)

export function buildCountyOverlaySection(exhibit){
  const ov = exhibit?.evidence?.county_overlay;
  if (!ov || !ov.available) return null;

  const countyRows = (ov.counties_intersected || []).map(c => ({
    display_name:                  c.display_name || c.key,
    county_name:                   c.county_name,
    state:                         c.state,
    intersection_area_sq_km:       c.intersection_area_sq_km != null ? c.intersection_area_sq_km.toFixed(1) : '—',
    county_area_sq_km:             c.county_area_sq_km != null ? c.county_area_sq_km.toFixed(1) : '—',
    percent_of_county_covered:     c.percent_of_county_covered != null ? c.percent_of_county_covered.toFixed(1) + ' %' : '—',
    percent_of_contour_in_county:  c.percent_of_contour_in_county != null ? c.percent_of_contour_in_county.toFixed(1) + ' %' : '—',
    coverage_status:               (ov.counties_fully_contained || []).includes(c.key) ? 'FULLY CONTAINED' : 'PARTIAL'
  }));

  // Dataset provenance paragraph.
  const datasetParagraph = [
    `FCC-derived county boundary dataset: us_counties_fcc.geojson.`,
    `Path: ${ov.dataset_path}.`,
    `SHA-256: ${ov.dataset_sha256 || '—'}.`,
    `Source: ${ov.valid_source_kml_files ?? '—'} valid FCC KML boundary files`,
    `(${ov.fcc_endpoint_misses ?? 0} FCC endpoint misses documented;`,
    `dataset is marked partial_but_valid=${ov.partial_but_valid ?? false}).`,
    `Unique county-equivalents loaded: ${ov.unique_county_count ?? '—'};`,
    `valid polygon count: ${ov.valid_county_count ?? '—'}.`,
    `Contour study area: ${ov.contour_area_sq_km != null ? ov.contour_area_sq_km.toFixed(1) + ' km²' : '—'}.`
  ].join('  ');

  const paragraphs = [datasetParagraph];

  // Intersection summary.
  const n = countyRows.length;
  if (n === 0){
    paragraphs.push('The study-area contour does not intersect any county in the loaded dataset.');
  } else {
    const fullyList  = (ov.counties_fully_contained || []).join('; ') || 'none';
    const partialList = (ov.counties_partially_intersected || []).join('; ') || 'none';
    paragraphs.push(
      `The study-area contour intersects ${n} FCC county-equivalent(s): ` +
      `${countyRows.map(r => r.display_name).join(', ')}.  ` +
      `Fully contained: ${fullyList}.  Partially intersected: ${partialList}.`
    );
  }

  // Missing-county notice.
  const missingWarn = (ov.warnings || []).find(w => w.code === 'COUNTY_MISSING_INTERSECTION');
  if (missingWarn){
    paragraphs.push(
      `WARNING: ${missingWarn.detail}  ` +
      `A complete county coverage determination cannot be made for those counties; ` +
      `the engineer of record must verify coverage independently.`
    );
  }

  return {
    id:      'county-overlay',
    type:    'table',
    heading: 'County Boundary / FCC County Overlay Analysis',
    paragraphs,
    table: {
      columns: [
        { key: 'display_name',                label: 'County' },
        { key: 'state',                       label: 'State' },
        { key: 'intersection_area_sq_km',     label: 'Overlap (km²)' },
        { key: 'county_area_sq_km',           label: 'County area (km²)' },
        { key: 'percent_of_county_covered',   label: '% of County covered' },
        { key: 'percent_of_contour_in_county',label: '% of Contour in County' },
        { key: 'coverage_status',             label: 'Status' }
      ],
      rows: countyRows
    },
    // Raw evidence for downstream use.
    evidence_summary: {
      source:               'FCC_COUNTY_KML',
      dataset_sha256:       ov.dataset_sha256,
      valid_features:       ov.valid_county_count,
      fcc_endpoint_misses:  ov.fcc_endpoint_misses,
      n_counties:           n,
      counties_intersected: (ov.counties_intersected || []).map(c => c.key)
    }
  };
}
