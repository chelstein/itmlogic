// §73.189(b)(4) ground system / radial field installation guide.
// Extracted verbatim from siteOptimizer.js scoreCandidate() (2026
// decomposition) — see guides/README.md for the pattern.

export const key = 'am_ground_system_and_radial_field_installation_guide';

export function build({ frequency_khz, tpo_kw, pattern_mode, sigma_msm }){
  // §73.189(b)(4) and FCC Engineering Circular AM Ground System requirements
  // Standard: 120 radials × 0.35 wavelength (FCC Std Reference Antenna) per §73.189(b)(4)
  // Bevington (1997): fewer radials increase loss and reduce effective radiated power
  const freq_khz  = frequency_khz ?? 1000;
  const tpo       = tpo_kw ?? 1;
  const isDA      = /^DA/i.test(pattern_mode ?? '');
  const sigma_val = sigma_msm ?? 5;   // site soil conductivity (mS/m)
  void tpo; // kept for parity with the original scope (unused there too)

  // Wavelength and radial length calculation
  const wavelength_m      = Math.round(300000 / freq_khz);            // λ in metres (c/f)
  const quarter_wave_m    = Math.round(wavelength_m / 4);
  const std_radial_len_m  = Math.round(wavelength_m * 0.35);          // FCC std: 0.35λ
  const std_radial_len_ft = Math.round(std_radial_len_m * 3.281);

  // FCC standard: 120 radials; below-standard counts trigger proof-of-performance requirements
  const std_n_radials = 120;

  // Minimum recommended based on conductivity (ITU-R P.832 / Bevington guidance):
  // Poor soil needs more radials to compensate for higher ground loss
  const min_radials =
    sigma_val < 2  ? 120 :   // POOR — full 120 radials recommended
    sigma_val < 5  ? 90  :   // FAIR
    sigma_val < 15 ? 60  :   // GOOD
                     60;     // EXCELLENT — 60-radial practical minimum (engineering practice)

  // Total copper required (AWG 10 copper: ~0.0471 kg/m = 47.1 g/m)
  const copper_kg_per_m = 0.0471;
  const total_radial_length_m = std_n_radials * std_radial_len_m;
  const copper_kg  = Math.round(total_radial_length_m * copper_kg_per_m);

  // Installation cost: $0.80–$1.50/m for buried copper radials; $0.30–$0.60/m for surface
  // Full 120-radial 0.35λ system cost estimate
  const install_low_per_m  = 0.80;
  const install_high_per_m = 1.50;
  const material_low_usd   = Math.round(copper_kg * 4.0);    // ~$4/kg copper
  const material_high_usd  = Math.round(copper_kg * 6.5);
  const labor_low_usd      = Math.round(total_radial_length_m * install_low_per_m);
  const labor_high_usd     = Math.round(total_radial_length_m * install_high_per_m);
  const total_low_usd      = material_low_usd + labor_low_usd;
  const total_high_usd     = material_high_usd + labor_high_usd;

  // DA arrays: ground system per tower
  const n_towers = isDA ? 2 : 1;
  const total_system_low_usd  = total_low_usd  * n_towers;
  const total_system_high_usd = total_high_usd * n_towers;

  // Below-standard ground systems require §73.151 proof of performance
  const proof_required = min_radials < std_n_radials;

  // Inspection recommendations: §73.1580 — annual visual; §73.151 / station records — ground system
  const inspection_interval_months = 12;

  const checklist = [
    `Install ${std_n_radials} copper radials each ${std_radial_len_m} m (${std_radial_len_ft} ft) at 0.35λ (FCC standard)`,
    'Bury radials 15–30 cm below grade to minimize RF hazard and mechanical damage',
    'Bond all radials to tower base at a single copper bus ring (star ground)',
    'Use AWG #10 copper wire minimum; larger AWG for radials >250 m',
    'Install cadweld or exothermic connections at all junctions (no mechanical clamps)',
    'Maintain ground system record (station files; §73.151 basis): radial count, length, burial depth, installation date',
    `Conduct annual visual inspection of ground field per §73.1580 (interval: ${inspection_interval_months} months)`,
  ];
  if (proof_required) {
    checklist.push(`File §73.151 proof of performance because ground system has <${std_n_radials} radials`);
  }
  if (isDA) {
    checklist.push(`Repeat full ${std_n_radials}-radial installation for each DA tower (${n_towers} towers total)`);
  }

  return {
    wavelength_m,
    quarter_wave_m,
    std_radial_len_m,
    std_radial_len_ft,
    std_n_radials,
    min_radials_recommended: min_radials,
    total_radial_length_m,
    copper_kg,
    n_towers,
    proof_of_performance_required: proof_required,
    inspection_interval_months,
    n_checklist_items: checklist.length,
    checklist,
    cost_estimates: {
      material_low_usd,
      material_high_usd,
      labor_low_usd,
      labor_high_usd,
      total_system_low_usd,
      total_system_high_usd,
    },
    reference: '47 CFR §73.189(b)(4); §73.151; §73.1580; FCC Engineering Circular AM Ground System; ITU-R P.832',
    note: `${std_n_radials} radials × ${std_radial_len_m} m (0.35λ at ${freq_khz} kHz). ${copper_kg} kg copper. Est. $${total_system_low_usd.toLocaleString()}–$${total_system_high_usd.toLocaleString()} (${n_towers} tower${n_towers > 1 ? 's' : ''}).`
  };
}
