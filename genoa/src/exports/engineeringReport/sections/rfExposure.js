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

import { mpeLimits } from '../../../engine/regulatory/oet65.js';

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
  const amScr = nf.am_screening || null;  // amNearFieldScreening result (PR #305)

  const s      = exhibit.station_inputs || {};
  const isAM   = String(s.service || oet.study_inputs?.service || '').toUpperCase() === 'AM';
  const svcTag = isAM ? 'AM broadcast' : 'FM broadcast';

  // Bug 1+2 fix: field is mpe_mw_cm2 (not mpe_limit_mw_cm2); fallback via
  // mpeLimits() covers the full §1.1310 Table 1 frequency range, not just
  // the FM 30–300 MHz range that the prior hardcoded fallback covered.
  const freqMHz = oet.study_inputs?.frequency_mhz
               ?? oet.frequency_mhz
               ?? c.frequency_mhz
               ?? (s.frequency_unit === 'kHz'
                    ? (Number.isFinite(Number(s.frequency)) ? Number(s.frequency) / 1000 : null)
                    : (s.frequency ?? null));
  const erpKw = oet.erp_kw ?? c.erp_kw ?? s.erp_kw ?? null;

  const ctlMpe = ctl.mpe_mw_cm2
    ?? (Number.isFinite(Number(freqMHz)) ? mpeLimits(Number(freqMHz), 'controlled')?.S_mw_cm2   : null);
  const uncMpe = unc.mpe_mw_cm2
    ?? (Number.isFinite(Number(freqMHz)) ? mpeLimits(Number(freqMHz), 'uncontrolled')?.S_mw_cm2 : null);

  // Bug 3+4 fix: near-field status reflects amNearFieldScreening grade for AM.
  // For a single-tower AM station (SCREENING), there is no NEC requirement.
  // ENGINEERING_REVIEW_REQUIRED or non-AM still flag the NEC requirement.
  const amScrGrade     = amScr?.filing_grade;
  const amScrIsScreen  = amScrGrade === 'SCREENING';
  const needsNec       = nf.required_for_filing && !amScrIsScreen;

  const nfStatusText = !nf.required_for_filing
    ? 'Not required — antenna is beyond the reactive near-field boundary'
    : amScrIsScreen
      ? `SCREENING GRADE — OET-65 Supplement A §4 single-tower near-field analysis completed; exclusion radius ${amScr.binding_distance_m} m (binding: ${amScr.binding}); filing_effect: none`
      : amScrGrade === 'ENGINEERING_REVIEW_REQUIRED'
        ? `ENGINEERING REVIEW REQUIRED — ${(amScr?.review_triggers || []).join('; ') || 'near-field conditions require NEC or measured RF survey'}`
        : `ENGINEERING REVIEW REQUIRED — RC AGL ${nf.rcagl_m != null ? nf.rcagl_m.toFixed(1) + ' m' : '(AGL unknown)'} < near-field boundary ${nf.boundary_m != null ? nf.boundary_m.toFixed(1) + ' m' : '(λ/2π)'}; NEC reactive-region study required (OET-65 §3.B)`;

  const haveDistances = Number.isFinite(Number(ctl.distance_m)) || Number.isFinite(Number(unc.distance_m));
  // INCOMPLETE_BOUNDARY_GEOMETRY: compliance distances are computed but no
  // property-line / lot-boundary distance has been supplied.  The §1.1307(b)
  // categorical evaluation is incomplete — do NOT imply full RF-exposure compliance.
  const boundaryMissing = haveDistances && bc.boundary_distance_m == null;
  const passLabel = bc.pass === true  ? 'PASS — boundary clears uncontrolled MPE'
                  : bc.pass === false ? 'FAIL — uncontrolled MPE exceeded at boundary'
                  : needsNec         ? 'ENGINEERING REVIEW REQUIRED — near-field NEC study required (far-field equation not applicable at this RC AGL)'
                  : amScrIsScreen    ? `SCREENING GRADE — near-field exclusion radius ${amScr.binding_distance_m} m; boundary check${amScr.site_boundary_pass === true ? ' PASS' : amScr.site_boundary_pass === false ? ' FAIL' : ' DEFERRED'}`
                  : boundaryMissing  ? 'INCOMPLETE_BOUNDARY_GEOMETRY — compliance distances computed but property-line / lot-boundary distance not supplied; §1.1307(b) categorical evaluation is incomplete'
                  : haveDistances    ? 'DISTANCES COMPUTED · BOUNDARY CHECK DEFERRED — supply lot/property-line dimensions to complete §1.1307(b) categorical evaluation'
                  : 'NOT EVALUATED';

  const rows = [
    ['Status',                         passLabel],
    ['Method',                         oet.method || 'OET-65 simplified-equation (far-field, omni)'],
    ['Frequency',                      freqMHz != null ? `${freqMHz} MHz` : '—'],
    ['ERP (peak, controlling)',        erpKw != null ? `${erpKw} kW` : '—'],
    ['Controlled MPE limit',           ctlMpe != null ? `${ctlMpe} mW/cm² (47 CFR §1.1310 Table 1, occupational/controlled)` : '—'],
    ['Controlled compliance distance', ctl.distance_m != null ? `${ctl.distance_m.toFixed?.(2) ?? ctl.distance_m} m` : '—'],
    ['Uncontrolled MPE limit',         uncMpe != null ? `${uncMpe} mW/cm² (47 CFR §1.1310 Table 1, general public/uncontrolled)` : '—'],
    ['Uncontrolled compliance distance', unc.distance_m != null ? `${unc.distance_m.toFixed?.(2) ?? unc.distance_m} m` : '—'],
    ['Boundary check distance',        bc.boundary_distance_m != null ? `${bc.boundary_distance_m} m (per filed lot/property line or fence)` : 'DEFERRED — operator must supply lot/property-line dimensions'],
    ['Boundary power density',         bc.power_density_mw_cm2 != null ? `${bc.power_density_mw_cm2.toFixed?.(4) ?? bc.power_density_mw_cm2} mW/cm²` : 'DEFERRED — depends on boundary distance above'],
    ['Near-field status',              nfStatusText],
    ...(amScr ? [
      ['AM near-field screening grade',    amScr.filing_grade],
      ['AM near-field exclusion radius',   `${amScr.binding_distance_m} m (${amScr.binding})`],
      ['AM screening method',             amScr.method || 'OET-65 Supplement A §4'],
    ] : []),
    ['Engine module',                  oet.engine_module || 'genoa.regulatory.oet65'],
    ['Bulletin',                       'OET-65 Bulletin (Edition 97-01) Supplement A · 47 CFR §1.1310 Table 1']
  ];

  // Bug 2 fix: narrative uses svcTag (service-aware) instead of "FM broadcast facilities".
  const fmtMHz = freqMHz != null ? `${freqMHz} MHz` : 'the filed operating frequency';
  const fmtErp = oet.erp_kw != null ? `${oet.erp_kw} kW` : 'the filed ERP';
  const ctlD = ctl.distance_m != null ? `${ctl.distance_m.toFixed?.(2) ?? ctl.distance_m} m` : 'the calculated controlled-environment distance';
  const uncD = unc.distance_m != null ? `${unc.distance_m.toFixed?.(2) ?? unc.distance_m} m` : 'the calculated uncontrolled-environment distance';
  const preface =
    'A radiofrequency exposure analysis was performed pursuant to OET Bulletin 65 ' +
    `(Edition 97-01) Supplement A using the simplified far-field methodology applicable to ${svcTag} facilities.  At ${fmtMHz} and ${fmtErp}, the controlled-environment maximum permissible exposure (MPE) compliance distance is ${ctlD}, and the corresponding uncontrolled-environment compliance distance is ${uncD}.  ` +
    (bc.boundary_distance_m != null
      ? `The closest property-line / publicly accessible boundary is ${bc.boundary_distance_m} m from the antenna.  Boundary power density is ${bc.power_density_mw_cm2 != null ? `${bc.power_density_mw_cm2.toFixed?.(4) ?? bc.power_density_mw_cm2} mW/cm²` : 'as tabulated below'}, ` +
        (bc.pass === true
          ? 'which clears the §1.1310 uncontrolled-environment limit; the facility therefore qualifies for routine categorical evaluation under §1.1307(b).  '
          : bc.pass === false
            ? 'which does NOT clear the §1.1310 uncontrolled-environment limit.  Operational mitigation (signage, fencing, controlled-access designation, or feed-power adjustment) is required prior to construction in order to qualify under §1.1307(b).  '
            : '')
      : '') +
    (amScrIsScreen
      ? `Near-field OET-65 Supplement A §4 screening was performed for this AM single-tower installation; the uncontrolled-environment near-field exclusion radius is ${amScr.binding_distance_m} m (binding criterion: ${amScr.binding}).  `
      : needsNec
        ? 'Because the antenna radiation center AGL is below the validity range of the OET-65 simplified far-field equation, full near-field reactive-region modeling (NEC or measured RF survey) is REQUIRED before filing.  '
        : '') +
    'Compliance limits are taken from 47 CFR §1.1310 Table 1; controlled-environment limits apply to occupational personnel with awareness training, and uncontrolled-environment limits apply to the general public.';

  const summary = needsNec
    ? 'ENGINEERING REVIEW REQUIRED — far-field equation not applicable.  The antenna radiation center AGL falls inside the OET-65 reactive near-field boundary (λ/2π).  The far-field power-density formula understates actual near-field exposure at this height; the engineer of record must perform an NEC near-field study (OET-65 §3.B) before filing.  This is a study requirement, not a compliance failure — no boundary MPE exceedance has been determined.'
    : amScrGrade === 'ENGINEERING_REVIEW_REQUIRED'
      ? `ENGINEERING REVIEW REQUIRED (AM near-field) — ${(amScr?.review_triggers || []).join('; ')}.  A full NEC near-field analysis or measured RF survey is required before filing.`
      : bc.pass === true
        ? 'The categorical evaluation indicates the controlling boundary distance clears the uncontrolled-environment MPE limit; no further mitigation is identified by this study.'
        : bc.pass === false
          ? 'The categorical evaluation indicates the controlling boundary distance does NOT clear the uncontrolled-environment MPE limit.  Operational mitigation (signage, fencing, controlled-access designation, or feed-power adjustment) is required before construction.'
          : 'Result is indeterminate; engineer of record must verify boundary geometry and re-run with the as-built lot/property line dimensions.';

  return {
    id:      'rf-exposure',
    type:    'paragraphs-with-kv',
    heading: 'Radiofrequency Exposure (OET-65 / §1.1310)',
    paragraphs: [preface, summary],
    rows
  };
}
