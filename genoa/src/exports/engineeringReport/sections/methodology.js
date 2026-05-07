// Methodology — traditional consulting wording + Genoa's reproducibility advantage.

export function buildMethodologySection(exhibit){
  const svc = String(exhibit.station_inputs?.service || '').toUpperCase();
  const mv  = exhibit.method_versions || {};
  const ev  = exhibit.evidence || {};
  const ip  = exhibit.interpolation || {};

  const paragraphs = [];
  if (svc === 'FM' || svc === 'LPFM' || svc === 'FX'){
    paragraphs.push(
      'Propagation curves for FM broadcast stations were determined using the F(50,50) and F(50,10) curves specified in 47 CFR §73.333.',
      'Height Above Average Terrain was evaluated in accordance with 47 CFR §73.313.',
      'Contour distances were determined by interpolation of FCC tabulated data.'
    );
  } else if (svc === 'AM'){
    paragraphs.push(
      'AM groundwave field strengths were determined using the curves specified in 47 CFR §73.184 and the engineering standards of allocation in 47 CFR §73.183.',
      'Where applicable, nighttime skywave protection was evaluated under 47 CFR §73.187 using the SS-1 (50%) field strength formulation of 47 CFR §73.190.',
      'Field-strength values were determined by interpolation of FCC tabulated data.'
    );
  }
  paragraphs.push(
    'Genoa uses a bivariate cubic surface interpolation consistent with the FCC contours implementation and records the curve dataset hash for reproducibility.'
  );
  if (exhibit.engineering_confidence){
    paragraphs.push(
      'A terrain-aware engineering-confidence layer assesses each radial against the curve prediction using terrain metrics and any attached SDR or ITM residuals.  ' +
      'This assessment is advisory only; it does not modify FCC curve outputs or §73.207 / §73.215 compliance results.'
    );
  }

  return {
    id:      'methodology',
    type:    'paragraphs-with-kv',
    heading: 'METHODOLOGY',
    paragraphs,
    rows: [
      ['Curve dataset',          mv.dataset           || '—'],
      ['Curve dataset SHA-256',  mv.dataset_meta_sha256 || '—'],
      ['Curve engine',           mv.curve_engine      || '—'],
      ['Interpolation — field',  ip.along_field       || mv.interpolation || '—'],
      ['Interpolation — HAAT',   ip.along_haat        || '—'],
      ['Projection',             mv.projection        || '—'],
      ['Distance method',        '47 CFR §73.208 — great-circle (WGS-84 Karney 2013 inverse)'],
      ['Terrain source',         ev.terrain?.source   || 'flat HAAT'],
      ['DEM dataset',            ev.terrain?.dem?.dataset || ev.terrain?.dem?.source || '—'],
      ['Radial step',            (exhibit.station_inputs?.radial_step_deg || 10) + '°'],
      ['FCC orchestration commit', mv.fcc_orchestration?.commit || '—']
    ]
  };
}
