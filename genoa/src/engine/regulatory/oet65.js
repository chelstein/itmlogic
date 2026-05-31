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
 * §1.1310 Table 1 E-field and H-field limits (V/m, A/m) at a given frequency.
 *
 * Separate from the S-based mpeLimits() to support the independent E/H
 * evaluation required for near-field analysis where the plane-wave
 * relationship E = 377H does not hold.
 *
 * Source: 47 CFR §1.1310 Table 1 / OET Bulletin 65, Edition 97-01, Table 1.
 */
export function mpeFieldLimits(frequency_mhz, exposureClass = 'uncontrolled'){
  const f    = Number(frequency_mhz);
  const ctrl = exposureClass === 'controlled';
  if (!Number.isFinite(f) || f <= 0) return null;

  // Controlled limits (§1.1310 Table 1):
  //   0.3 – 3   MHz  E = 614 V/m,    H = 1.63 A/m
  //   3   – 30  MHz  E = 1842/f V/m, H = 4.89/f A/m
  // Uncontrolled limits (§1.1310 Table 1):
  //   0.3 – 1.34 MHz  E = 614 V/m,   H = 1.63 A/m
  //   1.34 – 30 MHz   E = 824/f V/m, H = 2.19/f A/m
  if (ctrl){
    if (f >= 0.3  && f < 3)   return { E_Vm: 614,      H_Am: 1.63,    basis: '§1.1310 Table 1 controlled, 0.3–3 MHz' };
    if (f >= 3    && f < 30)  return { E_Vm: 1842/f,   H_Am: 4.89/f,  basis: '§1.1310 Table 1 controlled, 3–30 MHz: 1842/f, 4.89/f' };
  } else {
    if (f >= 0.3  && f < 1.34) return { E_Vm: 614,     H_Am: 1.63,    basis: '§1.1310 Table 1 uncontrolled, 0.3–1.34 MHz' };
    if (f >= 1.34 && f < 30)   return { E_Vm: 824/f,   H_Am: 2.19/f,  basis: '§1.1310 Table 1 uncontrolled, 1.34–30 MHz: 824/f, 2.19/f' };
  }
  return null;
}

/**
 * Near-field compliance distance for a vertical monopole AM broadcast
 * antenna per OET-65 Supplement A / §2.2.1.  Evaluates both E-field and
 * H-field criteria from §1.1310 Table 1 and returns the binding (largest)
 * distance.
 *
 * Physical model: single-tower λ/4 vertical monopole over flat ground.
 *   R_r = 36.56 Ω  (radiation resistance, λ/4 monopole over perfect ground;
 *                   Balanis, "Antenna Theory," 3rd ed., Table 4.2)
 *   G_iso = 3.28   (isotropic gain, λ/4 monopole over ground; = 2 × 1.64)
 *
 * E-field bound (conservative): far-field formula extended to near field.
 *   E(r) = √(30 · G_iso · P_rad · F²) / r  [plane-wave upper bound]
 *   r_E  = √(30 · G_iso · P_rad · F²) / E_limit
 *   Source: OET Bulletin 65 Eq. 6 / IEEE Std C95.3.
 *
 * H-field (near-field dominant term): exact induction-zone result for
 * sinusoidal current distribution monopole at ground level (z = 0):
 *   H_φ(r) = I₀ · (1 − cos βh) / (2π r)   where βh = 2πh/λ
 *   For λ/4: (1 − cos(π/2)) = 1 → H = I₀ / (2π r)
 *   Source: Jordan & Balmain, "Electromagnetic Waves and Radiating
 *           Systems," 2nd ed. (1968), § 11.5, eq. 11-16a.
 *
 * Base current: I₀ = √(P_rad / R_r)   (rms, power-balance identity)
 *
 * @param {object} p
 * @param {number}  p.erp_kw        Radiated power (TPO for AM stations), kW
 * @param {number}  p.frequency_mhz Operating frequency, MHz
 * @param {string}  [p.exposure_class] 'uncontrolled' | 'controlled'
 * @param {number}  [p.pattern_factor] Antenna pattern factor 0–1 (default 1)
 * @param {number}  [p.tower_height_m] Physical tower height m (default: λ/4)
 * @returns {{ distance_m, e_field_distance_m, h_field_distance_m,
 *             binding, E_limit_Vm, H_limit_Am, I_base_A, F_H,
 *             formula, assumptions }} | null
 */
export function nearFieldComplianceDistance_m({
  erp_kw, frequency_mhz, exposure_class = 'uncontrolled',
  pattern_factor = 1.0, tower_height_m = null
} = {}){
  const P_rad = Number(erp_kw) * 1000;   // treat erp_kw as P_rad (TPO for AM)
  const F     = Number(pattern_factor);
  const f_mhz = Number(frequency_mhz);
  if (!Number.isFinite(P_rad) || P_rad <= 0) return null;
  if (!Number.isFinite(F)                  ) return null;
  if (!Number.isFinite(f_mhz) || f_mhz <= 0) return null;

  const limits = mpeFieldLimits(f_mhz, exposure_class);
  if (!limits) return null;
  const { E_Vm: E_limit_Vm, H_Am: H_limit_Am } = limits;

  const wavelength_m = SPEED_OF_LIGHT_M_S / (f_mhz * 1e6);
  const h_m   = (tower_height_m != null && Number.isFinite(Number(tower_height_m)) && Number(tower_height_m) > 0)
    ? Number(tower_height_m)
    : wavelength_m / 4;    // default: λ/4 assumption
  const beta_h = (2 * Math.PI / wavelength_m) * h_m;

  // Height factor for H-field from exact Biot-Savart integration of
  // sinusoidal current distribution: F_H = 1 − cos(βh).
  // Valid for any electrical height; = 1 at βh = π/2 (λ/4), = 2 at βh = π (λ/2).
  const F_H = 1 - Math.cos(beta_h);

  // Radiation resistance — λ/4 monopole over perfect ground (36.56 Ω).
  // Conservative (overestimates I_base) for taller towers; may underestimate
  // for towers shorter than λ/4 — see amNearFieldScreening() for screening
  // logic that restricts applicability.
  const R_r    = 36.56;
  const G_iso  = 3.28;    // isotropic gain, λ/4 monopole over ground

  const I_base = Math.sqrt(P_rad * F * F / R_r);

  // E-field: conservative plane-wave upper bound (OET-65 Eq. 6 extended).
  const r_E = Math.sqrt(30 * G_iso * P_rad * F * F) / E_limit_Vm;

  // H-field: exact induction-zone formula (Jordan & Balmain § 11.5).
  const r_H = (I_base * Math.abs(F_H)) / (2 * Math.PI * H_limit_Am);

  const binding = r_E >= r_H ? 'E-field' : 'H-field';
  const assumed_quarter_wave = tower_height_m == null;
  return {
    distance_m:          Number(Math.max(r_E, r_H).toFixed(3)),
    e_field_distance_m:  Number(r_E.toFixed(3)),
    h_field_distance_m:  Number(r_H.toFixed(3)),
    binding,
    E_limit_Vm:          Number(E_limit_Vm.toFixed(4)),
    H_limit_Am:          Number(H_limit_Am.toFixed(4)),
    I_base_A:            Number(I_base.toFixed(4)),
    F_H:                 Number(F_H.toFixed(4)),
    beta_h_rad:          Number(beta_h.toFixed(4)),
    tower_height_m:      Number(h_m.toFixed(2)),
    assumed_quarter_wave,
    exposure_class,
    limits_basis:        limits.basis,
    formula: {
      e_field: 'E(r) = √(30 · G_iso · P_rad · F²) / r; G_iso = 3.28 (λ/4 monopole); OET-65 Eq. 6 conservative bound',
      h_field: 'H_φ(r) = I₀ · (1−cos βh) / (2πr); Jordan & Balmain (1968) §11.5 eq. 11-16a',
      i_base:  'I₀ = √(P_rad · F² / R_r); R_r = 36.56 Ω (λ/4 monopole, Balanis Table 4.2)',
    },
    assumptions: [
      'Single vertical monopole over flat, uniform ground plane',
      assumed_quarter_wave ? 'Tower height assumed λ/4 (not supplied); R_r = 36.56 Ω' : `Tower height ${h_m.toFixed(1)} m; R_r = 36.56 Ω (λ/4 value — conservative for h > λ/4, non-conservative for h < λ/4)`,
      'E-field formula is plane-wave upper bound; conservative in near field',
      'H-field formula is exact induction-zone result at z = 0',
    ]
  };
}

// ---------------------------------------------------------------------------
// AM near-field screening — OET-65 / Supplement A broadcast methodology
// ---------------------------------------------------------------------------

/**
 * Conservative near-field RF exposure screening for an AM broadcast tower.
 *
 * Implements the OET Bulletin 65 / Supplement A broadcast-station methodology
 * for single-tower AM monopoles.  Output is SCREENING GRADE for the single-
 * tower case and ENGINEERING_REVIEW_REQUIRED in all other cases (DA arrays,
 * unusual ground systems, electrically short towers, public access within the
 * reactive near-field zone).
 *
 * REGULATORY BASIS
 *   47 CFR §1.1307(b) — categorical RF exposure evaluation
 *   47 CFR §1.1310   — MPE limits (Table 1)
 *   FCC OET Bulletin 65, Edition 97-01, §§ 2–3
 *   FCC OET Bulletin 65 Supplement A, § 4 (broadcast stations)
 *
 * PHYSICAL MODEL (single-tower case)
 *   Single vertical monopole, sinusoidal current distribution I(z) = I₀ sin(β(h−z))
 *   R_r = 36.56 Ω (λ/4 monopole over perfect ground; Balanis, "Antenna Theory," Table 4.2)
 *   H-field at ground level (z=0), induction zone:
 *     H_φ(r) = I₀ · F_H / (2πr),  F_H = 1 − cos(βh)   [Jordan & Balmain §11.5 eq. 11-16a]
 *   E-field: conservative plane-wave upper bound (OET-65 Eq. 6)
 *     E(r) ≤ √(30 · G_iso · P_rad) / r,  G_iso = 3.28
 *   Base current: I₀ = √(P_rad / R_r)  or  I₀ = e1km_mvm / 60  (λ/4 identity)
 *   Duty-cycle-averaged: P_eff = P_rad × duty_factor
 *
 * NOT MODELED (require NEC or measured RF survey):
 *   - DA arrays (fields from multiple towers superpose vectorially)
 *   - Elevated or non-standard ground systems
 *   - Towers significantly shorter than λ/4 (R_r < 36.56 → I₀ underestimated)
 *   - Rooftop / co-located transmitter scenarios
 *   - Directional antenna pattern effects on near-field distribution
 *
 * @param {object} p
 * @param {number}   p.frequency_khz             AM carrier, kHz (530–1710)
 * @param {number}   [p.tpo_kw]                  Transmitter power output, kW
 * @param {number}   [p.e1km_mvm]                Reference field at 1 km, mV/m (λ/4 identity)
 * @param {number}   [p.tower_height_m]           Physical tower height, m
 * @param {number}   [p.site_boundary_m]          Distance to nearest public access, m
 * @param {number}   [p.radiation_center_height_m=0] Height of radiation centre above ground, m
 * @param {number}   [p.duty_factor=1.0]          Transmit duty factor (1.0 for broadcast)
 * @param {number}   [p.n_towers=1]               Number of towers in array
 * @param {boolean}  [p.is_directional=false]     Directional / phased array
 * @param {string}   [p.ground_system='standard_buried'] 'standard_buried'|'elevated'|'unknown'
 * @param {string}   [p.exposure_class='uncontrolled']   'uncontrolled'|'controlled'
 *
 * @returns {{
 *   method, source_bulletin, filing_grade, filing_effect,
 *   requires_nec, near_field_status,
 *   mpe_uncontrolled, mpe_controlled,
 *   e_field_distance_m, h_field_distance_m, binding_distance_m,
 *   reactive_nf_boundary_m, site_boundary_m, site_boundary_pass,
 *   I_base_A, F_H, duty_factor_applied,
 *   assumptions, review_triggers, notes
 * }}
 */
export function amNearFieldScreening({
  frequency_khz,
  tpo_kw         = null,
  e1km_mvm       = null,
  tower_height_m = null,
  site_boundary_m             = null,
  radiation_center_height_m   = 0,
  duty_factor    = 1.0,
  n_towers       = 1,
  is_directional = false,
  ground_system  = 'standard_buried',
  exposure_class = 'uncontrolled'
} = {}){

  // ── 1. Input coercion / basic validation ──────────────────────────────────
  const f_khz   = Number(frequency_khz);
  const f_mhz   = f_khz / 1000;
  const df      = Math.min(1.0, Math.max(0, Number.isFinite(Number(duty_factor)) ? Number(duty_factor) : 1.0));
  const n_tow   = Number.isFinite(Number(n_towers)) ? Math.max(1, Math.round(Number(n_towers))) : 1;
  const is_dir  = !!is_directional;
  const gnd     = String(ground_system || 'standard_buried');
  const bdy_m   = (site_boundary_m != null && Number.isFinite(Number(site_boundary_m)) && Number(site_boundary_m) > 0)
    ? Number(site_boundary_m) : null;
  const tow_h   = (tower_height_m != null && Number.isFinite(Number(tower_height_m)) && Number(tower_height_m) > 0)
    ? Number(tower_height_m) : null;

  if (!Number.isFinite(f_mhz) || f_mhz < 0.3 || f_mhz > 1.71){
    return { filing_grade: 'ENGINEERING_REVIEW_REQUIRED', filing_effect: 'none',
             error: 'frequency_khz must be in the AM broadcast band (530–1710 kHz)' };
  }

  // ── 2. Determine review triggers ──────────────────────────────────────────
  const review_triggers = [];

  const wavelength_m = SPEED_OF_LIGHT_M_S / (f_mhz * 1e6);
  const reactive_nf_m = wavelength_m / (2 * Math.PI);   // λ/(2π) — reactive NF boundary

  if (n_tow > 1){
    review_triggers.push('DA array: fields from multiple towers superpose vectorially; scalar single-tower model does not apply.');
  }
  if (is_dir){
    review_triggers.push('Directional antenna: pattern affects near-field spatial distribution; single-tower isotropic model not valid.');
  }
  if (gnd === 'elevated'){
    review_triggers.push('Elevated ground system: affects R_r and base-current distribution; buried-radial assumption invalid.');
  }
  if (gnd === 'unknown'){
    review_triggers.push('Ground system type unknown: cannot assess validity of λ/4 R_r assumption.');
  }

  // Tower electrical height check: R_r = 36.56 Ω is conservative for h ≥ λ/4,
  // but non-conservative (underestimates I_base) for electrically short towers.
  // Restrict screening to towers within ±50% of λ/4 (45°–135° electrical height).
  let beta_h = null, F_H = null;
  if (tow_h != null){
    beta_h = (2 * Math.PI / wavelength_m) * tow_h;
    const elec_deg = (beta_h * 180 / Math.PI);
    F_H = 1 - Math.cos(beta_h);
    if (beta_h < Math.PI / 4){       // < λ/8 (45°): R_r << 36.56 Ω → non-conservative
      review_triggers.push(`Tower electrical height ${elec_deg.toFixed(1)}° (< 45°): R_r is well below 36.56 Ω; screening formula underestimates base current.`);
    }
  } else {
    // Assume λ/4 when height unknown — note in assumptions
    beta_h = Math.PI / 2;
    F_H    = 1.0;    // 1 − cos(π/2) = 1
  }

  const filing_grade = review_triggers.length > 0
    ? 'ENGINEERING_REVIEW_REQUIRED'
    : 'SCREENING';

  // ── 3. Power and base current ─────────────────────────────────────────────
  // Duty-cycle-averaged power: P_eff = P_rad × duty_factor.
  // For AM broadcast, duty_factor = 1.0 (continuous carrier).
  let P_rad_w = null, I_base_A = null, power_source = null;

  const tpo_w = tpo_kw != null && Number.isFinite(Number(tpo_kw)) && Number(tpo_kw) > 0
    ? Number(tpo_kw) * 1000 : null;
  const e1km  = e1km_mvm != null && Number.isFinite(Number(e1km_mvm)) && Number(e1km_mvm) > 0
    ? Number(e1km_mvm) : null;

  if (tpo_w != null){
    P_rad_w   = tpo_w * df;
    // I₀ = √(P_rad / R_r); R_r = 36.56 Ω (λ/4 monopole over perfect ground)
    I_base_A  = Math.sqrt(P_rad_w / 36.56);
    power_source = 'tpo_kw → I₀ = √(P_rad/R_r); R_r = 36.56 Ω (Balanis Table 4.2)';
  } else if (e1km != null){
    // λ/4 identity: E(r) = 60·I₀/r → at r=1000 m: I₀ = E1km(mV/m)/60
    // Valid only for λ/4 monopole far-field inverse-distance regime.
    I_base_A  = (e1km * df) / 60;
    P_rad_w   = I_base_A * I_base_A * 36.56;
    power_source = 'e1km_mvm identity: I₀ = E1km/60 (λ/4 monopole, Terman); duty-factor applied';
  } else {
    return {
      filing_grade: 'ENGINEERING_REVIEW_REQUIRED',
      filing_effect: 'none',
      error: 'Provide tpo_kw or e1km_mvm to compute base current.'
    };
  }

  // ── 4. MPE limits ──────────────────────────────────────────────────────────
  const mpe_unc  = mpeFieldLimits(f_mhz, 'uncontrolled');
  const mpe_ctrl = mpeFieldLimits(f_mhz, 'controlled');
  const mpe_use  = exposure_class === 'controlled' ? mpe_ctrl : mpe_unc;

  // ── 5. Near-field field calculations ─────────────────────────────────────
  const G_iso = 3.28;   // isotropic gain, λ/4 monopole over ground; = 2 × 1.64

  // E-field compliance distance: conservative plane-wave upper bound.
  // E(r) = √(30 · G_iso · P_rad) / r  →  r_E = √(30 · G_iso · P_rad) / E_limit
  const r_E = Math.sqrt(30 * G_iso * P_rad_w) / mpe_use.E_Vm;

  // H-field compliance distance: exact induction-zone formula.
  // H_φ(r) = I₀ · F_H / (2π r)  →  r_H = I₀ · F_H / (2π · H_limit)
  const r_H = (I_base_A * Math.abs(F_H)) / (2 * Math.PI * mpe_use.H_Am);

  const binding_m = Math.max(r_E, r_H);
  const binding   = r_E >= r_H ? 'E-field' : 'H-field';

  // Far-field / near-field status of compliance distance relative to λ/(2π)
  let near_field_status;
  if (binding_m < reactive_nf_m){
    near_field_status = 'compliance_distance_inside_reactive_nf';
  } else if (binding_m < wavelength_m / (2 * Math.PI) * 3){
    near_field_status = 'compliance_distance_in_induction_zone';
  } else {
    near_field_status = 'far_field';
  }

  // ── 6. Site boundary check ────────────────────────────────────────────────
  let site_boundary_pass = null;
  if (bdy_m != null){
    site_boundary_pass = bdy_m >= binding_m;
  }

  // ── 7. Build result ───────────────────────────────────────────────────────
  const assumptions = [
    'Single vertical monopole, sinusoidal current distribution',
    tow_h != null ? `Tower height ${tow_h.toFixed(1)} m (βh = ${(beta_h * 180/Math.PI).toFixed(1)}°)` : 'Tower height not supplied — λ/4 assumed; βh = 90°',
    `R_r = 36.56 Ω (λ/4 monopole over perfect ground; Balanis, "Antenna Theory", Table 4.2)`,
    'F_H = 1 − cos(βh) (H-field height factor; Jordan & Balmain §11.5)',
    `Duty factor = ${df.toFixed(3)} (broadcast standard: 1.0)`,
    `Ground system: ${gnd}`,
    'E-field is a conservative plane-wave upper bound; may overestimate field in reactive NF',
    'H-field at z = 0 (ground level); elevated exposure points (e.g. 1.8 m) may differ',
    power_source,
  ];

  return {
    method:           'OET-65 Supplement A broadcast near-field screening (single-tower monopole)',
    source_bulletin:  'FCC OET Bulletin 65, Edition 97-01 + Supplement A §4',
    regulation:       '47 CFR §1.1307(b), §1.1310',
    filing_grade,
    filing_effect:    'none',
    requires_nec:     filing_grade === 'ENGINEERING_REVIEW_REQUIRED',
    near_field_status,
    reactive_nf_boundary_m: Number(reactive_nf_m.toFixed(2)),
    wavelength_m:            Number(wavelength_m.toFixed(2)),
    mpe_uncontrolled: {
      E_Vm:  Number(mpe_unc.E_Vm.toFixed(4)),
      H_Am:  Number(mpe_unc.H_Am.toFixed(4)),
      basis: mpe_unc.basis
    },
    mpe_controlled: {
      E_Vm:  Number(mpe_ctrl.E_Vm.toFixed(4)),
      H_Am:  Number(mpe_ctrl.H_Am.toFixed(4)),
      basis: mpe_ctrl.basis
    },
    exposure_class_used: exposure_class,
    e_field_distance_m:  Number(r_E.toFixed(3)),
    h_field_distance_m:  Number(r_H.toFixed(3)),
    binding_distance_m:  Number(binding_m.toFixed(3)),
    binding,
    site_boundary_m:     bdy_m,
    site_boundary_pass,
    I_base_A:            Number(I_base_A.toFixed(4)),
    P_rad_w:             Number(P_rad_w.toFixed(1)),
    F_H:                 Number(F_H.toFixed(4)),
    beta_h_deg:          Number((beta_h * 180 / Math.PI).toFixed(2)),
    duty_factor_applied: df,
    n_towers,
    is_directional,
    ground_system,
    assumptions,
    review_triggers,
    notes: [
      filing_grade === 'SCREENING'
        ? 'Conservative screening estimate.  Binding exclusion radius must be fenced or access-controlled.  Not a substitute for an engineer-certified OET-65 filing.'
        : 'Result is NOT filing-grade.  One or more conditions require full NEC near-field analysis or a measured RF survey (see review_triggers).',
      'E-field uses far-field plane-wave bound extended into near field — conservative (overestimates E).',
      'H-field uses exact induction-zone formula H = I₀·F_H/(2πr) — exact at z=0 for sinusoidal distribution.',
    ]
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
  site_boundary_m = null, site_height_m = null,
  // AM-specific near-field screening inputs (forwarded to amNearFieldScreening):
  tpo_kw = null, e1km_mvm = null, tower_height_m = null,
  duty_factor = 1.0, n_towers = 1, is_directional = false,
  ground_system = 'standard_buried'
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

  // When the far-field compliance distance falls inside the near-field zone,
  // run the AM near-field screening (OET-65 Supplement A §4) for AM service,
  // or the simplified nearFieldComplianceDistance_m for other services.
  let near_field_analysis = null;
  let am_near_field_screening = null;
  if (near_field_required){
    const isAM = (String(service || '').toUpperCase() === 'AM');
    if (isAM && (tpo_kw != null || e1km_mvm != null || study_inputs.erp_kw > 0)){
      am_near_field_screening = amNearFieldScreening({
        frequency_khz:    study_inputs.frequency_mhz * 1000,
        tpo_kw:           tpo_kw ?? study_inputs.erp_kw,
        e1km_mvm,
        tower_height_m,
        site_boundary_m:  study_inputs.site_boundary_m,
        duty_factor,
        n_towers,
        is_directional,
        ground_system,
        exposure_class:   'uncontrolled'
      });
    }
    const nf_unc = nearFieldComplianceDistance_m({
      erp_kw:         study_inputs.erp_kw,
      frequency_mhz:  study_inputs.frequency_mhz,
      exposure_class: 'uncontrolled',
      pattern_factor: study_inputs.pattern_factor,
      tower_height_m
    });
    const nf_ctrl = nearFieldComplianceDistance_m({
      erp_kw:         study_inputs.erp_kw,
      frequency_mhz:  study_inputs.frequency_mhz,
      exposure_class: 'controlled',
      pattern_factor: study_inputs.pattern_factor,
      tower_height_m
    });
    near_field_analysis = { uncontrolled: nf_unc, controlled: nf_ctrl };
    const dist_str = nf_unc ? `${nf_unc.distance_m.toFixed(2)} m (binding: ${nf_unc.binding})` : 'not computed';
    notes.push(
      `Near-field zone λ/(2π) = ${nf_m.toFixed(1)} m at ${study_inputs.frequency_mhz} MHz. ` +
      `Far-field compliance distance ${uncontrolled.distance_m.toFixed(2)} m falls inside this zone. ` +
      `Near-field analysis (OET-65 Supplement A): uncontrolled compliance distance ${dist_str}.`
    );
    if (am_near_field_screening?.filing_grade === 'ENGINEERING_REVIEW_REQUIRED'){
      notes.push(`AM near-field screening: ENGINEERING_REVIEW_REQUIRED — ${am_near_field_screening.review_triggers.join(' | ')}`);
    }
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
      rcagl_m:                 Number.isFinite(tower_height_m) ? tower_height_m : null,
      required_for_filing:     near_field_required,
      analysis:                near_field_analysis,
      am_screening:            am_near_field_screening
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
  reference:     'FCC OET Bulletin 65, Edition 97-01 (August 1997) + Supplement A §4',
  formulas: {
    free_space:         'S(mW/cm²) = 13.05 · ERP_kW · F² / R²(m)  [OET-65 Eq. 6]',
    ground_reflection:  'S(mW/cm²) = 52.20 · ERP_kW · F² / R²(m)  [OET-65 Eq. 8, 4× ground-reflection]',
    near_field_E:       'E(r) = √(30 · G_iso · P_rad · F²) / r;  G_iso = 3.28 (λ/4 monopole)  [conservative plane-wave bound]',
    near_field_H:       'H_φ(r) = I₀ · (1−cos βh) / (2π r);  I₀ = √(P_rad/R_r),  R_r = 36.56 Ω  [Jordan & Balmain (1968) §11.5 eq. 11-16a]',
    e1km_identity:      'I₀ = E1km(mV/m) / 60  [λ/4 monopole far-field identity; Terman]',
    mpe_eh_limits:      'E-field and H-field limits: §1.1310 Table 1 (frequency-dependent above 1.34 MHz uncontrolled / 3 MHz controlled)',
  },
  modeled: [
    'Far-field free-space and ground-reflection power density (OET-65 Eqs. 6, 8)',
    '§1.1310 Table 1 MPE limits — power density (S), E-field, H-field — uncontrolled + controlled, full frequency range 0.3 MHz – 100 GHz',
    'Frequency-dependent E/H field limits above 1.34 MHz (uncontrolled) and 3 MHz (controlled) per §1.1310 Table 1',
    'Compliance distance for both exposure classes',
    'Optional site-boundary slant-distance check',
    'AM near-field screening (amNearFieldScreening): E-field conservative plane-wave bound + H-field exact induction-zone formula for single-tower λ/4 monopole per OET-65 Supplement A §4',
    'Tower electrical height factor F_H = 1−cos(βh) in H-field formula (Jordan & Balmain §11.5)',
    'Duty-factor-averaged power (P_eff = P_rad × duty_factor)',
  ],
  not_modeled: [
    'DA phased-array near-field (fields from multiple towers superpose vectorially — requires NEC)',
    'Directional antenna pattern effects on near-field spatial distribution',
    'Elevated or non-standard ground system effects on R_r and current distribution',
    'Towers with electrical height < 45° (R_r << 36.56 Ω — non-conservative for H-field)',
    'Antenna pattern integration over full azimuth × elevation sphere',
    'Time-averaged exposure for occupational workers under §1.1310(c) duty cycles',
    'Aggregated exposure from co-located transmitters (§1.1310(d) waiver path)',
  ],
  license_basis: '17 U.S.C. § 105 — formulas and limits from §1.1310 / OET-65, US Government public domain'
});
