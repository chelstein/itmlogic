// ADA Title II/III accessibility guide for AM transmitter sites.
// Extracted verbatim from siteOptimizer.js scoreCandidate() (2026
// decomposition) — see guides/README.md for the pattern.

export const key = 'am_site_accessibility_and_ada_compliance_guide';

export function build({ pt, pattern_mode, tpo_kw, land_use_class }){
  // ADA Title II/III: Transmitter buildings with regular employee access require
  // accessible design (parking, entrance, workspaces). Remote/unmanned sites may
  // have limited requirements, but construction must comply with local building codes.
  // §73.1350: Unattended operation reduces but doesn't eliminate ADA scope.
  const dist_km = pt.distance_from_current_km ?? 10;
  const isDA    = /^DA/i.test(pattern_mode ?? '');
  const tpo     = tpo_kw ?? 1;
  void dist_km; // kept for parity with the original scope (unused there too)

  // Staffing model: higher power / DA sites more likely staffed (chief op on-site)
  const is_likely_staffed = tpo >= 5 || isDA;

  // ADA applicability level (land_use_class proxies site urbanization / visit frequency)
  const ada_applicability =
    is_likely_staffed                                           ? 'FULL'    :   // staffed site — full ADA Title I/III
    (land_use_class === 'SUBURBAN' || land_use_class === 'SUBURBAN_RURAL') ? 'PARTIAL' :   // near-urban — likely visited regularly
                                                                  'MINIMAL';    // remote unmanned — basic accessibility

  // Required accessibility features
  const accessibility_features = [];
  if (ada_applicability === 'FULL' || ada_applicability === 'PARTIAL') {
    accessibility_features.push('Accessible parking space (1 per 25 spaces, per ADA §208)');
    accessibility_features.push('Accessible route from parking to building entrance');
    accessibility_features.push('Doorway width ≥32 in. (34 in. preferred) per ADA §404');
    accessibility_features.push('Threshold ramp if grade change >0.5 in. at entrance');
  }
  if (ada_applicability === 'FULL') {
    accessibility_features.push('Accessible interior workspaces (control room, equipment racks)');
    accessibility_features.push('Accessible restroom facilities if provided on-site');
  }
  accessibility_features.push('Signage: RF hazard warning signs per §73.49 (all sites)');

  const n_features = accessibility_features.length;

  // Cost
  const ACCESS_LOW  = ada_applicability === 'FULL'    ? 8000  :
                      ada_applicability === 'PARTIAL' ? 3000  : 500;
  const ACCESS_HIGH = ada_applicability === 'FULL'    ? 25000 :
                      ada_applicability === 'PARTIAL' ? 8000  : 2000;

  return {
    ada_applicability,
    is_likely_staffed,
    n_accessibility_features:  n_features,
    accessibility_features,
    cost_estimates: {
      accessibility_low_usd:  ACCESS_LOW,
      accessibility_high_usd: ACCESS_HIGH,
    },
    reference: 'Americans with Disabilities Act (42 USC §12182); ADA Standards 2010; 47 CFR §73.1350; §73.49',
    note: `ADA applicability: ${ada_applicability}${is_likely_staffed ? ' (staffed site)' : ''}. ${n_features} accessibility features required. Est. $${ACCESS_LOW.toLocaleString()}–$${ACCESS_HIGH.toLocaleString()}.`
  };
}
