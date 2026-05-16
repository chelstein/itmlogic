// Vector-chart sections — pure pdfkit primitives, no PNG round-trip.
// Surfaces engineering data already computed in evidence:
//   - AM-night NIF contour          → polar plot of NIF radius vs azimuth
//   - FORTRAN reference-engine parity → scatter plot of Δkm vs azimuth
//
// Both render only when the upstream computation actually ran AND
// produced enough points to plot.  Otherwise the builder returns
// null and the section is skipped.

export function buildNifPolarChartSection(exhibit){
  const svc = String(exhibit?.station_inputs?.service || '').toUpperCase();
  if (svc !== 'AM') return null;
  const nif = exhibit?.evidence?.am_night_nif;
  if (!nif || !nif.available) return null;
  const contour = Array.isArray(nif.contour) ? nif.contour : [];
  if (contour.length < 6) return null;

  const data = contour
    .map((p) => ({
      azimuth_deg: Number(p.azimuth_deg),
      value:       Number(p.distance_km)
    }))
    .filter((p) => Number.isFinite(p.azimuth_deg) && Number.isFinite(p.value) && p.value > 0);
  if (data.length < 6) return null;

  const s = nif.summary || {};
  const captionBits = [
    'AM nighttime interference-free (NIF) contour per 47 CFR §73.182.',
    'Each point: the radial distance (km, north up) at which the proposed station\'s 50% skywave equals the §73.182(k) RSS-aggregated interference at the §73.183 D/U for the proposed class.',
    Number.isFinite(s.mean_radius_km)
      ? `Mean radius ${s.mean_radius_km.toFixed(1)} km; min ${Number(s.min_radius_km).toFixed(1)} km; max ${Number(s.max_radius_km).toFixed(1)} km.`
      : null,
    nif.provenance?.upstream_skywave
      ? `Skywave engine: ${nif.provenance.upstream_skywave}.`
      : null
  ].filter(Boolean).join('  ');

  return {
    id:        'am-night-nif-chart',
    type:      'polar-chart',
    heading:   'Appendix F-3 — NIF contour polar plot',
    data,
    r_unit:    'km',
    r_max:     Number.isFinite(s.max_radius_km) ? s.max_radius_km * 1.1 : null,
    caption:   captionBits
  };
}

// Directional-antenna polar pattern — the V-Soft signature visual.
// Plots the filed pattern_table as a closed polar polygon.  Data
// already exists on exhibit.station_inputs.pattern as [[az, f], ...]
// where f is the relative field (0..1).  The chart shows the radiation
// pattern shape that the §73.150 / §73.316 protection studies actually
// used; matches what the H&D DA-pattern exhibit page looks like.

export function buildDaPatternChartSection(exhibit){
  const pattern = exhibit?.station_inputs?.pattern;
  if (!Array.isArray(pattern) || pattern.length < 12) return null;

  const data = pattern
    .map((row) => {
      const az = Array.isArray(row) ? Number(row[0]) : Number(row?.az ?? row?.azimuth_deg);
      const f  = Array.isArray(row) ? Number(row[1]) : Number(row?.f  ?? row?.relative_field);
      return { azimuth_deg: az, value: f };
    })
    .filter((p) => Number.isFinite(p.azimuth_deg) && Number.isFinite(p.value) && p.value >= 0);
  if (data.length < 12) return null;

  const svc = String(exhibit?.station_inputs?.service || '').toUpperCase();
  const erp = Number(exhibit?.station_inputs?.erp_kw);
  const mode = svc === 'AM' ? '§73.150 ground-wave' : '§73.316 horizontal';
  const captionBits = [
    `Filed directional-antenna horizontal radiation pattern — relative field f(az) per ${mode}.`,
    'Polygon shows the pattern shape that drove every contour distance, §73.207/§73.215 protection check, and (for AM) the §73.182 NIF + §73.99 reduced-power compute.',
    Number.isFinite(erp) ? `Maximum ERP at f=1.0: ${erp.toFixed(2)} kW.` : null,
    'f(az)² scales the ERP per radial; the polygon below is f, not f² (matches FCC filing convention).'
  ].filter(Boolean).join('  ');

  return {
    id:        'da-pattern-chart',
    type:      'polar-chart',
    heading:   'Antenna pattern — horizontal radiation polygon',
    data,
    r_unit:    'f',
    r_max:     1.0,                  // pattern is normalized; max field = 1
    caption:   captionBits
  };
}

export function buildFortranParityChartSection(exhibit){
  const ev = exhibit?.evidence?.fcc_curve_parity;
  if (!ev || !ev.available) return null;
  const pairs = Array.isArray(ev.pairs) ? ev.pairs : [];
  if (pairs.length < 4) return null;

  // Plot Δkm (engine − FORTRAN) vs azimuth; one point per (radial × contour).
  const data = pairs
    .map((p) => ({
      x:  Number(p.azimuth_deg),
      y:  Number(p.delta_km),
      ok: Number.isFinite(Number(p.abs_delta_km))
            ? Number(p.abs_delta_km) <= Number(ev.tolerance_km || 0.05)
            : true
    }))
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  if (data.length < 4) return null;

  const captionBits = [
    `Per-(radial × contour) parity vs FCC TVFMFS reference engine (${ev.source || 'fcc-tvfmfs-fortran'}).`,
    `${ev.n_ok}/${ev.n_requests} pairs within tolerance ${Number(ev.tolerance_km).toFixed(3)} km.`,
    Number.isFinite(ev.max_abs_delta_km) ? `Max |Δ| ${Number(ev.max_abs_delta_km).toFixed(3)} km.` : null,
    Number.isFinite(ev.rms_delta_km)     ? `RMS Δ ${Number(ev.rms_delta_km).toFixed(4)} km.`      : null,
    ev.pass ? 'PASS.' : 'FAIL — see Appendix C for detail.'
  ].filter(Boolean).join('  ');

  return {
    id:          'fcc-fortran-parity-chart',
    type:        'scatter-chart',
    heading:     'Appendix C-1 — FCC FORTRAN parity scatter',
    data,
    x_label:     'Azimuth (°)',
    y_label:     'Δ km  (engine − FCC FORTRAN)',
    x_min:       0,
    x_max:       360,
    y_symmetric: true,
    tolerance:   Number(ev.tolerance_km) || 0.05,
    caption:     captionBits
  };
}
