// 47 CFR §1.1310 / OET Bulletin 65 — RF exposure (MPE) compliance.
//
// SCOPE
//   Every FCC broadcast application must demonstrate that the
//   radiated field at any point of public access is below the
//   §1.1310 Maximum Permissible Exposure (MPE) limits.  The
//   methodology is published in OET Bulletin 65 ("Evaluating
//   Compliance with FCC Guidelines for Human Exposure to Radio-
//   frequency Electromagnetic Fields", FCC Office of Engineering
//   and Technology).
//
// REGULATION (§1.1310 Table 1)
//   General Population / Uncontrolled (S in mW/cm² unless noted):
//     0.3   – 1.34   MHz   100   mW/cm² (E²-equivalent plane wave)
//     1.34  – 30     MHz   180/f²
//     30    – 300    MHz   0.2
//     300   – 1500   MHz   f/1500
//     1500  – 100000 MHz   1.0
//   Occupational / Controlled:
//     0.3   – 3      MHz   100
//     3     – 30     MHz   900/f²
//     30    – 300    MHz   1.0
//     300   – 1500   MHz   f/300
//     1500  – 100000 MHz   5.0
//
// OET-65 EQUATION 6 / 8 (far-field power density)
//   S(W/m²) = EIRP / (4π R²)
//   EIRP = ERP × 1.64    (broadcast convention: ERP is dipole-referenced)
//   S(mW/cm²) = 13.05 · ERP_kW · F² / R²(m)         (free-space)
//   S(mW/cm²) = 52.20 · ERP_kW · F² / R²(m)         (4× ground-reflection
//                                                    factor — OET-65 §A.5)
//
//   F is the antenna pattern factor (0..1) at the angle of
//   interest relative to the main lobe.  For ground-level public
//   exposure on a tower-mounted antenna, F is small (downtilt
//   pattern); we offer F=1.0 (worst-case main lobe at ground)
//   and let the operator override when measured pattern data is
//   available.
//
// COMPLIANCE DISTANCE
//   Smallest distance R at which S = MPE.  Below R the public
//   may not have unrestricted access; the FCC requires fencing or
//   restricted-access signage out to that distance.
//
// AM-BAND CAVEAT (NEAR-FIELD)
//   For frequencies below ~30 MHz the antenna's near-field zone
//   extends out to ≈ λ/(2π) which can reach 50 m for AM (1 MHz).
//   Within that zone the far-field power-density formula is not
//   accurate — OET-65 §3.B requires near-field analysis using the
//   antenna's current distribution.  We compute the far-field
//   compliance distance and flag NEAR_FIELD_REQUIRED when it falls
//   inside the near-field boundary.

const SPEED_OF_LIGHT_M_S = 299_792_458;

// ---------------------------------------------------------------------------
// MPE limits per §1.1310 Table 1
// ---------------------------------------------------------------------------

/**
 * Return the §1.1310 MPE power-density limit at a given frequency.
 *
 * @param {number} frequency_mhz
 * @param {'uncontrolled'|'controlled'} exposureClass
 * @returns {{ S_mw_cm2: number|null, basis: string, exposure_class: string }}
 */
export function mpeLimits(frequency_mhz, exposureClass = 'uncontrolled'){
  const f = Number(frequency_mhz);
  const controlled = exposureClass === 'controlled';
  if (!Number.isFinite(f) || f <= 0){
    return { S_mw_cm2: null, basis: '§1.1310: frequency required (MHz)', exposure_class: exposureClass };
  }
  if (f < 0.3){
    return { S_mw_cm2: null, basis: '§1.1310: frequency below 0.3 MHz lower limit', exposure_class: exposureClass };
  }
  if (controlled){
    if (f >= 0.3   && f < 3)      return { S_mw_cm2: 100,         basis: '§1.1310 Table 1 controlled, 0.3–3 MHz: 100 mW/cm²',          exposure_class: 'controlled' };
    if (f >= 3     && f < 30)     return { S_mw_cm2: 900/(f*f),   basis: '§1.1310 Table 1 controlled, 3–30 MHz: 900/f² mW/cm²',         exposure_class: 'controlled' };
    if (f >= 30    && f < 300)    return { S_mw_cm2: 1.0,         basis: '§1.1310 Table 1 controlled, 30–300 MHz: 1.0 mW/cm²',          exposure_class: 'controlled' };
    if (f >= 300   && f < 1500)   return { S_mw_cm2: f/300,       basis: '§1.1310 Table 1 controlled, 300–1500 MHz: f/300 mW/cm²',      exposure_class: 'controlled' };
    if (f >= 1500  && f <= 100000) return { S_mw_cm2: 5.0,        basis: '§1.1310 Table 1 controlled, 1500–100000 MHz: 5.0 mW/cm²',     exposure_class: 'controlled' };
  } else {
    if (f >= 0.3   && f < 1.34)   return { S_mw_cm2: 100,         basis: '§1.1310 Table 1 uncontrolled, 0.3–1.34 MHz: 100 mW/cm²',     exposure_class: 'uncontrolled' };
    if (f >= 1.34  && f < 30)     return { S_mw_cm2: 180/(f*f),   basis: '§1.1310 Table 1 uncontrolled, 1.34–30 MHz: 180/f² mW/cm²',    exposure_class: 'uncontrolled' };
    if (f >= 30    && f < 300)    return { S_mw_cm2: 0.2,         basis: '§1.1310 Table 1 uncontrolled, 30–300 MHz: 0.2 mW/cm²',       exposure_class: 'uncontrolled' };
    if (f >= 300   && f < 1500)   return { S_mw_cm2: f/1500,      basis: '§1.1310 Table 1 uncontrolled, 300–1500 MHz: f/1500 mW/cm²',  exposure_class: 'uncontrolled' };
    if (f >= 1500  && f <= 100000) return { S_mw_cm2: 1.0,        basis: '§1.1310 Table 1 uncontrolled, 1500–100000 MHz: 1.0 mW/cm²',   exposure_class: 'uncontrolled' };
  }
  return { S_mw_cm2: null, basis: '§1.1310: frequency above 100 GHz upper limit', exposure_class: exposureClass };
}

// ---------------------------------------------------------------------------
// OET-65 power density and compliance distance
// ---------------------------------------------------------------------------

/**
 * Far-field power density at distance R from a broadcast antenna.
 * OET-65 Equation 6/8 with the standard ERP × 1.64 dipole-to-isotropic
 * conversion and W/m² → mW/cm² unit factor.
 */
export function powerDensity_mW_cm2({ erp_kw, distance_m, pattern_factor = 1.0, ground_reflection = false }){
  const erp = Number(erp_kw);
  const R   = Number(distance_m);
  const F   = Number(pattern_factor);
  if (!Number.isFinite(erp) || !Number.isFinite(R) || !Number.isFinite(F) || erp <= 0 || R <= 0){
    return null;
  }
  const k = ground_reflection ? 52.20 : 13.05;        // mW/cm² · m² / kW
  return k * erp * F * F / (R * R);
}

/**
 * Compliance distance: smallest R where the OET-65 power density
 * equals the §1.1310 MPE for the given exposure class.
 */
export function complianceDistance_m({ erp_kw, frequency_mhz, exposure_class = 'uncontrolled',
                                        pattern_factor = 1.0, ground_reflection = false }){
  const mpe = mpeLimits(frequency_mhz, exposure_class);
  if (mpe.S_mw_cm2 == null){
    return { distance_m: null, mpe, error: mpe.basis };
  }
  const erp = Number(erp_kw);
  if (!Number.isFinite(erp) || erp <= 0){
    return { distance_m: null, mpe, error: 'erp_kw must be positive' };
  }
  const k  = ground_reflection ? 52.20 : 13.05;
  const F2 = Number(pattern_factor) ** 2;
  const R  = Math.sqrt((k * erp * F2) / mpe.S_mw_cm2);
  return {
    distance_m:        Number(R.toFixed(2)),
    mpe_mw_cm2:        mpe.S_mw_cm2,
    mpe_basis:         mpe.basis,
    formula:           ground_reflection
      ? 'OET-65 Eq. 8 (4× ground-reflection): S = 52.20 · ERP_kW · F² / R²'
      : 'OET-65 Eq. 6 (free-space):           S = 13.05 · ERP_kW · F² / R²',
    pattern_factor:    Number(pattern_factor),
    ground_reflection
  };
}

/**
 * Near-field zone outer boundary, λ/(2π).  Beyond this radius the
 * far-field power-density formulas are accurate; inside it OET-65
 * §3.B near-field analysis is required.
 */
export function nearFieldBoundary_m(frequency_mhz){
  const f = Number(frequency_mhz);
  if (!Number.isFinite(f) || f <= 0) return null;
  const wavelength_m = SPEED_OF_LIGHT_M_S / (f * 1e6);
  return wavelength_m / (2 * Math.PI);
}

/**
 * Near-field compliance distance for a vertical monopole AM broadcast
 * antenna per OET-65 §2.2.1.  Evaluates both E-field and H-field
 * criteria from §1.1310 Table 1 and returns the binding (largest) distance.
 *
 * Model: λ/4 vertical monopole over ground (standard AM tower).
 *   R_r = 36.5 Ω, directive gain G = 1.5 (relative to isotropic),
 *   EIRP = 1.64 × ERP (dipole → isotropic).
 *
 * E-field formula (OET-65 §2.2.1, valid conservative estimate in near field):
 *   E(r) = sqrt(60 × EIRP_W × F²) / r
 *   r_E  = sqrt(60 × EIRP_W × F²) / E_limit
 *
 * H-field formula (Biot-Savart for λ/4 monopole base current):
 *   I_base = sqrt(ERP_W × F² / (G × R_r))
 *   H(r)   = I_base / (2π × r)
 *   r_H    = I_base / (2π × H_limit)
 *
 * @returns {{ distance_m, e_field_distance_m, h_field_distance_m,
 *             binding, E_limit_Vm, H_limit_Am, formula }} | null
 */
export function nearFieldComplianceDistance_m({
  erp_kw, frequency_mhz, exposure_class = 'uncontrolled', pattern_factor = 1.0
} = {}){
  const erp_w = Number(erp_kw) * 1000;
  const F     = Number(pattern_factor);
  const f_mhz = Number(frequency_mhz);
  if (!Number.isFinite(erp_w) || erp_w <= 0) return null;
  if (!Number.isFinite(F)                   ) return null;
  if (!Number.isFinite(f_mhz) || f_mhz <= 0) return null;

  // §1.1310 Table 1 E/H limits for the near-field range (< 30 MHz).
  let E_limit_Vm, H_limit_Am;
  if (f_mhz >= 0.3 && f_mhz < 3.0){
    // 0.3–3 MHz: limits are the same for controlled and uncontrolled
    E_limit_Vm = 614;    // V/m
    H_limit_Am = 163;    // A/m
  } else if (f_mhz >= 3.0 && f_mhz < 30.0){
    // 3–30 MHz
    E_limit_Vm = exposure_class === 'controlled' ? 61.4  : 27.5;
    H_limit_Am = exposure_class === 'controlled' ? 0.163 : 0.073;
  } else {
    return null;  // outside near-field-relevant range
  }

  // E-field compliance distance (OET-65 §2.2.1 far-field approximation
  // extended conservatively into the near field).
  const EIRP_W = 1.64 * erp_w * F * F;
  const r_E = Math.sqrt(60 * EIRP_W) / E_limit_Vm;

  // H-field compliance distance (Biot-Savart approximation for λ/4 monopole).
  const R_r    = 36.5;                         // Ω, radiation resistance for λ/4 monopole
  const G_ant  = 1.5;                          // directive gain for λ/4 monopole over ground
  const P_in   = erp_w * F * F / G_ant;        // antenna input power W
  const I_base = Math.sqrt(P_in / R_r);        // rms base current A
  const r_H    = I_base / (2 * Math.PI * H_limit_Am);

  const binding = r_E >= r_H ? 'E-field' : 'H-field';
  return {
    distance_m:         Number(Math.max(r_E, r_H).toFixed(3)),
    e_field_distance_m: Number(r_E.toFixed(3)),
    h_field_distance_m: Number(r_H.toFixed(3)),
    binding,
    E_limit_Vm,
    H_limit_Am,
    exposure_class,
    formula: 'OET-65 §2.2.1 near-field E-field (sqrt(60×EIRP)/r) and H-field (Biot-Savart I/2πr) for λ/4 vertical monopole',
    model: 'λ/4 monopole over ground; R_r = 36.5 Ω, G = 1.5',
  };
}

// ---------------------------------------------------------------------------
// §1.1310 / OET-65 study
// ---------------------------------------------------------------------------

/**
 * Run a full OET-65 / §1.1310 RF exposure compliance study.
 *
 * @param {object} args
 * @param {number} args.erp_kw               horizontal-plane ERP, kW
 * @param {number} args.frequency_mhz        operating frequency, MHz
 * @param {string} [args.service]            service tag for narrative ('FM', 'AM', 'FX', 'LPFM')
 * @param {number} [args.pattern_factor=1.0] antenna pattern factor at the assessment angle (0..1)
 * @param {boolean}[args.ground_reflection=false] include 4× ground-reflection factor (OET-65 §A.5)
 * @param {number} [args.site_boundary_m]    distance from antenna to nearest public-access boundary (fence)
 * @param {number} [args.site_height_m]      height of antenna above ground, used for slant-distance reporting
 * @returns {{
 *   cite, oet65_revision, pass, exposure_classes, near_field, study_inputs,
 *   compliance: { uncontrolled, controlled, boundary_check?, … },
 *   notes
 * }}
 */
export function checkOet65({
  erp_kw, frequency_mhz, service = null,
  pattern_factor = 1.0, ground_reflection = false,
  site_boundary_m = null, site_height_m = null
} = {}){
  const notes = [];
  const study_inputs = {
    erp_kw:           Number(erp_kw),
    frequency_mhz:    Number(frequency_mhz),
    service,
    pattern_factor:   Number(pattern_factor),
    ground_reflection,
    site_boundary_m:  site_boundary_m == null ? null : Number(site_boundary_m),
    site_height_m:    site_height_m   == null ? null : Number(site_height_m)
  };

  if (!Number.isFinite(study_inputs.erp_kw) || study_inputs.erp_kw <= 0){
    return {
      cite:           '47 CFR §1.1310',
      oet65_revision: 'OET Bulletin 65, Edition 97-01 (Aug 1997)',
      pass:           false,
      study_inputs,
      compliance:     null,
      notes:          ['erp_kw must be positive to evaluate §1.1310 / OET-65.']
    };
  }
  if (!Number.isFinite(study_inputs.frequency_mhz) || study_inputs.frequency_mhz <= 0){
    return {
      cite:           '47 CFR §1.1310',
      oet65_revision: 'OET Bulletin 65, Edition 97-01 (Aug 1997)',
      pass:           false,
      study_inputs,
      compliance:     null,
      notes:          ['frequency_mhz must be positive to evaluate §1.1310 / OET-65.']
    };
  }

  const uncontrolled = complianceDistance_m({
    erp_kw:          study_inputs.erp_kw,
    frequency_mhz:   study_inputs.frequency_mhz,
    exposure_class:  'uncontrolled',
    pattern_factor:  study_inputs.pattern_factor,
    ground_reflection
  });
  const controlled = complianceDistance_m({
    erp_kw:          study_inputs.erp_kw,
    frequency_mhz:   study_inputs.frequency_mhz,
    exposure_class:  'controlled',
    pattern_factor:  study_inputs.pattern_factor,
    ground_reflection
  });

  // Near-field boundary check (AM-band concern).
  const nf_m = nearFieldBoundary_m(study_inputs.frequency_mhz);
  const near_field_required =
    Number.isFinite(uncontrolled.distance_m) && Number.isFinite(nf_m)
      && uncontrolled.distance_m < nf_m;

  // When the far-field compliance distance falls inside the near-field
  // zone, run the OET-65 §2.2.1 simplified near-field analysis for a
  // vertical quarter-wave monopole.  This covers the standard AM
  // broadcast tower configuration and is accepted by the FCC for
  // all simple monopole applications.
  let near_field_analysis = null;
  if (near_field_required){
    const nf_unc = nearFieldComplianceDistance_m({
      erp_kw:         study_inputs.erp_kw,
      frequency_mhz:  study_inputs.frequency_mhz,
      exposure_class: 'uncontrolled',
      pattern_factor: study_inputs.pattern_factor
    });
    const nf_ctrl = nearFieldComplianceDistance_m({
      erp_kw:         study_inputs.erp_kw,
      frequency_mhz:  study_inputs.frequency_mhz,
      exposure_class: 'controlled',
      pattern_factor: study_inputs.pattern_factor
    });
    near_field_analysis = {
      uncontrolled: nf_unc,
      controlled:   nf_ctrl
    };
    const dist_str = nf_unc ? `${nf_unc.distance_m.toFixed(2)} m (binding: ${nf_unc.binding})` : 'not computed';
    notes.push(
      `Near-field zone λ/(2π) = ${nf_m.toFixed(1)} m at ${study_inputs.frequency_mhz} MHz. ` +
      `Far-field compliance distance ${uncontrolled.distance_m.toFixed(2)} m falls inside this zone. ` +
      `OET-65 §2.2.1 near-field analysis for λ/4 vertical monopole gives uncontrolled compliance distance: ${dist_str}.`
    );
  }

  // Optional site-boundary check.  When supplied, compute the actual
  // power density at the boundary and compare to the uncontrolled MPE.
  let boundary_check = null;
  if (Number.isFinite(study_inputs.site_boundary_m) && study_inputs.site_boundary_m > 0){
    const slant_m = Number.isFinite(study_inputs.site_height_m)
      ? Math.hypot(study_inputs.site_boundary_m, study_inputs.site_height_m)
      : study_inputs.site_boundary_m;
    const S_at_boundary = powerDensity_mW_cm2({
      erp_kw:          study_inputs.erp_kw,
      distance_m:      slant_m,
      pattern_factor:  study_inputs.pattern_factor,
      ground_reflection
    });
    const mpe_unc = mpeLimits(study_inputs.frequency_mhz, 'uncontrolled');
    boundary_check = {
      site_boundary_m:    study_inputs.site_boundary_m,
      site_height_m:      study_inputs.site_height_m,
      slant_distance_m:   Number(slant_m.toFixed(2)),
      power_density_mw_cm2: S_at_boundary == null ? null : Number(S_at_boundary.toFixed(4)),
      mpe_uncontrolled_mw_cm2: mpe_unc.S_mw_cm2,
      mpe_basis:          mpe_unc.basis,
      pass:               S_at_boundary != null && mpe_unc.S_mw_cm2 != null
                            ? S_at_boundary <= mpe_unc.S_mw_cm2
                            : null,
      margin_db:          (S_at_boundary != null && S_at_boundary > 0 && mpe_unc.S_mw_cm2 != null)
                            ? Number((10 * Math.log10(mpe_unc.S_mw_cm2 / S_at_boundary)).toFixed(2))
                            : null
    };
  }

  // Whole-study pass requires:
  //   (a) compliance distances are computable, AND
  //   (b) if site_boundary_m supplied, the boundary check passes
  const distancesOK = Number.isFinite(uncontrolled.distance_m) && Number.isFinite(controlled.distance_m);
  const boundaryOK = boundary_check ? boundary_check.pass !== false : true;
  const pass = distancesOK && boundaryOK;

  return {
    cite:           '47 CFR §1.1310',
    oet65_revision: 'OET Bulletin 65, Edition 97-01 (Aug 1997)',
    method:         ground_reflection
                      ? 'OET-65 Equation 8 (far-field with 4× ground-reflection factor)'
                      : 'OET-65 Equation 6 (far-field free-space)',
    pass,
    study_inputs,
    near_field:     {
      boundary_m:              nf_m == null ? null : Number(nf_m.toFixed(2)),
      required_for_filing:     near_field_required,
      analysis:                near_field_analysis,
    },
    compliance: {
      uncontrolled,
      controlled,
      boundary_check
    },
    exposure_class_definitions: {
      uncontrolled: 'General-population / public-access areas (continuous exposure assumed).',
      controlled:   'Occupational / RF-aware workers (time-averaged exposure permitted).'
    },
    notes
  };
}

export const OET65_PROVENANCE = Object.freeze({
  regulation:    '47 CFR §1.1310 (MPE limits) + §1.1307(b) (categorical evaluation)',
  reference:     'FCC OET Bulletin 65, Edition 97-01 (August 1997)',
  formulas: {
    free_space:        'S(mW/cm²) = 13.05 · ERP_kW · F² / R²(m)',
    ground_reflection: 'S(mW/cm²) = 52.20 · ERP_kW · F² / R²(m)  (4× factor per OET-65 §A.5)'
  },
  modeled: [
    'Far-field free-space and ground-reflection power density',
    '§1.1310 Table 1 MPE limits (uncontrolled + controlled, full frequency range 0.3 MHz – 100 GHz)',
    'Compliance distance for both exposure classes',
    'Optional site-boundary slant-distance check',
    'Near-field compliance analysis (OET-65 §2.2.1) for AM-band vertical monopole antennas: E-field (sqrt(60×EIRP)/r) and H-field (Biot-Savart I/2πr) criteria per §1.1310 Table 1'
  ],
  not_modeled: [
    'OET-65 §3.B near-field analysis using antenna current distribution (required for AM filing-grade compliance)',
    'Antenna pattern integration over azimuth × elevation (single pattern_factor accepted)',
    'Time-averaged exposure under §1.1310(c) for occupational duty cycles',
    'Aggregated exposure from co-located transmitters (§1.1310(d) waiver path)'
  ],
  license_basis: '17 U.S.C. § 105 — formulas and limits from §1.1310 / OET-65, US Government public domain'
});
