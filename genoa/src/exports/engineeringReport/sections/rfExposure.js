// RF Exposure section — 47 CFR §1.1307, §1.1310 (OET-65).
//
// FCC §1.1310 requires categorical evaluation of MPE for broadcast
// transmitters above 1 kW ERP.  H&D-style exhibits typically dedicate
// a one-page Section 7 to this with controlled / uncontrolled distance
// limits and a near-field flag.  Genoa's compute attaches an `oet65`
// block — this section typesets it; if the block is missing, the
// section emits a structured "deferred to engineer of record" note
// rather than silently dropping (which would let a non-compliant
// filing slip through).

export function buildRfExposureSection(exhibit){
  const oet = exhibit?.oet65;
  if (!oet){
    return {
      id:      'rf-exposure',
      type:    'paragraphs',
      heading: 'Radiofrequency Exposure (OET-65 / §1.1310)',
      paragraphs: [
        'Per 47 CFR §1.1307(b)(1), the subject facility falls within the categorical evaluation thresholds of §1.1310 for routine RF-exposure compliance.  An OET-65 evaluation is required prior to filing.',
        'No OET-65 evaluation block is attached to this exhibit (exhibit.oet65 is absent).  The engineer of record must perform a controlled / uncontrolled-environment MPE assessment per OET Bulletin 65 (1997) Supplement A — including controlled compliance distance, uncontrolled compliance distance, and a near-field reactive-region check at antenna mounting heights below 10 m AGL — and attach that as a separate exhibit to the LMS application.'
      ]
    };
  }

  const c   = oet.compliance || {};
  const ctl = c.controlled   || {};
  const unc = c.uncontrolled || {};
  const nf  = oet.near_field  || {};
  const bc  = c.boundary_check || {};

  const passLabel = bc.pass === true  ? 'PASS — boundary clears uncontrolled MPE'
                  : bc.pass === false ? 'FAIL — uncontrolled MPE exceeded at boundary'
                  : nf.required_for_filing ? 'NEAR-FIELD MODELING REQUIRED — antenna mounting height below the OET-65 simplified-equation validity range'
                  : 'NOT EVALUATED';

  const rows = [
    ['Status',                    passLabel],
    ['Method',                    oet.method || 'OET-65 simplified-equation (far-field, omni)'],
    ['Frequency',                 oet.frequency_mhz != null ? `${oet.frequency_mhz} MHz` : '—'],
    ['ERP (peak, controlling)',   oet.erp_kw != null ? `${oet.erp_kw} kW` : '—'],
    ['Controlled MPE limit',      ctl.mpe_limit_mw_cm2 != null ? `${ctl.mpe_limit_mw_cm2} mW/cm²` : '—'],
    ['Controlled compliance distance', ctl.distance_m != null ? `${ctl.distance_m.toFixed?.(2) ?? ctl.distance_m} m` : '—'],
    ['Uncontrolled MPE limit',    unc.mpe_limit_mw_cm2 != null ? `${unc.mpe_limit_mw_cm2} mW/cm²` : '—'],
    ['Uncontrolled compliance distance', unc.distance_m != null ? `${unc.distance_m.toFixed?.(2) ?? unc.distance_m} m` : '—'],
    ['Boundary check distance',   bc.boundary_distance_m != null ? `${bc.boundary_distance_m} m (per filed lot/property line or fence)` : '—'],
    ['Boundary power density',    bc.power_density_mw_cm2 != null ? `${bc.power_density_mw_cm2.toFixed?.(4) ?? bc.power_density_mw_cm2} mW/cm²` : '—'],
    ['Near-field required',       nf.required_for_filing ? `YES — antenna RC AGL ${nf.rcagl_m ?? '—'} m is below the OET-65 simplified-equation lower bound; full NEC near-field modeling required` : 'no'],
    ['Engine module',             oet.engine_module || 'genoa.regulatory.oet65'],
    ['Bulletin',                  'OET-65 Bulletin (Edition 97-01) Supplement A · 47 CFR §1.1310 Table 1']
  ];

  const preface =
    'The following is a categorical OET-65 / §1.1310 evaluation of routine RF exposure at the licensed-facility boundary, computed by the Genoa regulatory engine from the filed ERP, frequency, and antenna geometry.  Controlled and uncontrolled-environment compliance distances are reported per OET Bulletin 65 (Edition 97-01) Supplement A.';

  const summary = nf.required_for_filing
    ? 'NEAR-FIELD MODELING REQUIRED.  The antenna RC AGL falls below the validity range of the OET-65 simplified far-field equation; the engineer of record must perform an NEC reactive-region near-field study and attach it as a separate exhibit before filing.'
    : (bc.pass === true
        ? 'The categorical evaluation indicates the controlling boundary distance clears the uncontrolled-environment MPE limit; no further mitigation is identified by this study.'
        : bc.pass === false
          ? 'The categorical evaluation indicates the controlling boundary distance does NOT clear the uncontrolled-environment MPE limit.  Operational mitigation (signage, fencing, controlled-access designation, or feed-power adjustment) is required before construction.'
          : 'Result is indeterminate; engineer of record must verify boundary geometry and re-run with the as-built lot/property line dimensions.');

  return {
    id:      'rf-exposure',
    type:    'paragraphs-with-kv',
    heading: 'Radiofrequency Exposure (OET-65 / §1.1310)',
    paragraphs: [preface, summary],
    rows
  };
}
