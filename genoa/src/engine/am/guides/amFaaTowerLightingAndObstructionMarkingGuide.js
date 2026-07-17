// FAA obstruction marking / tower lighting guide (§17.7, §17.21–§17.23,
// §17.47, §17.58; FAA AC 70/7460-1M).
// Extracted verbatim from siteOptimizer.js scoreCandidate() (2026
// decomposition) — see guides/README.md for the pattern.

import { ASR_THRESHOLD_17_7 } from '../../regulatory/regulatoryConstants.js';

export const key = 'am_faa_tower_lighting_and_obstruction_marking_guide';

export function build({ frequency_khz, tpo_kw, pattern_mode, fcc_class }){
  // FAA obstruction marking thresholds per 47 CFR §17.7/§17.21–§17.23 and FAA AC 70/7460-1M
  // Height above ground level (AGL) in feet drives lighting requirements.
  // For AM towers: 3/8λ for Class C/D (e.g., ~369 ft at 1000 kHz); 5/8λ for Class A/B.
  const freq_khz   = frequency_khz ?? 1000;
  const tpo        = tpo_kw ?? 1;
  const isDA       = /^DA/i.test(pattern_mode ?? '');

  // Tower height by class: 5/8λ for Class A/B (FCC optimum), 3/8λ for Class C/D (standard design).
  // Used for FAA obstruction-marking analysis only — actual licensed height governs construction.
  const lambda_faa         = Math.round(300000 / freq_khz);  // full wavelength, m
  const h_frac_faa_lt      = ['A', 'B'].includes(fcc_class) ? 0.625 : 0.375;
  const tower_height_m     = Math.round(lambda_faa * h_frac_faa_lt);
  const tower_height_ft    = Math.round(tower_height_m * 3.28084);

  // §17.7(a): ASR registration required for towers >60.96 m (200 ft) AGL, or towers near airports
  const asr_required_height_m  = ASR_THRESHOLD_17_7.height_m;  // 200 ft
  const asr_required_height_ft = 200;
  const asr_required           = tower_height_m > asr_required_height_m;

  // §17.21: Medium intensity lighting required 200–499 ft; High intensity 500+ ft (daytime)
  // §17.23: Red obstruction lights for towers ≤200 ft in certain situations
  const lighting_type =
    tower_height_ft >= 500 ? 'HIGH_INTENSITY_WHITE_DAY_RED_NIGHT' :
    tower_height_ft >= 200 ? 'MEDIUM_INTENSITY_RED' :
                             'LOW_INTENSITY_RED';

  // §17.47: Notification to FAA required for tower outages >30 min
  const faa_outage_notification_hrs = 0.5;

  // DA towers require additional structure notifications (multiple towers)
  const n_towers   = isDA ? (tpo >= 50 ? 4 : tpo >= 10 ? 3 : 2) : 1;

  // FAA Form 7460-1 filing required before construction; FCC Form 854 for existing towers
  const requires_form_7460_1 = asr_required || tower_height_ft >= 200;
  const requires_form_854    = asr_required;

  // Lighting system cost estimates (§17.21 compliance)
  // LED obstruction: LOW=$2k–$5k, MED=$5k–$15k, HIGH=$15k–$60k
  const LIGHT_LOW  =
    lighting_type === 'HIGH_INTENSITY_WHITE_DAY_RED_NIGHT' ? 15000 :
    lighting_type === 'MEDIUM_INTENSITY_RED'               ? 5000  : 2000;
  const LIGHT_HIGH =
    lighting_type === 'HIGH_INTENSITY_WHITE_DAY_RED_NIGHT' ? 60000 :
    lighting_type === 'MEDIUM_INTENSITY_RED'               ? 15000 : 5000;
  const annual_maint_usd = Math.round(LIGHT_HIGH * 0.05);

  // Per-tower cost for DA arrays
  const total_lighting_low_usd  = LIGHT_LOW  * n_towers;
  const total_lighting_high_usd = LIGHT_HIGH * n_towers;

  // Checklist items
  const checklist = [
    'File FAA Form 7460-1 Notice of Proposed Construction at least 45 days before breaking ground',
    'Obtain ASR number from FCC ULS before construction if tower >200 ft AGL',
    'Install obstruction lighting per lighting_type specification (§17.21–§17.23)',
    'Paint tower with aviation orange/white bands if required by FAA determination (AC 70/7460-1M)',
    'Establish FAA outage notification procedure: report outages >30 min (§17.47)',
    'File FCC Form 854 (ASR) update when lighting system installed or changed',
    'Maintain lighting inspection log; check every 24 hours or install automatic monitoring',
  ];
  if (isDA) checklist.push(`Repeat lighting compliance for all ${n_towers} DA array towers (§17.58)`);
  if (tower_height_ft >= 500) checklist.push('Coordinate high-intensity daytime lighting schedule with FAA (§17.23)');

  return {
    tower_height_ft:            tower_height_ft,
    tower_height_m:             tower_height_m,
    asr_required:               asr_required,
    asr_registration_threshold_ft: asr_required_height_ft,
    lighting_type:              lighting_type,
    n_towers:                   n_towers,
    requires_form_7460_1:       requires_form_7460_1,
    requires_form_854:          requires_form_854,
    faa_outage_notification_hrs: faa_outage_notification_hrs,
    n_checklist_items:          checklist.length,
    checklist,
    cost_estimates: {
      lighting_install_low_usd:  total_lighting_low_usd,
      lighting_install_high_usd: total_lighting_high_usd,
      annual_maintenance_usd:    annual_maint_usd,
    },
    reference: '47 CFR §17.7, §17.21–§17.23, §17.47, §17.58; FAA AC 70/7460-1M; FAA Form 7460-1; FCC Form 854 (ASR)',
    note: `Est. tower height ${tower_height_ft} ft AGL. Lighting: ${lighting_type.replace(/_/g,' ')}. ASR registration ${asr_required ? 'REQUIRED' : 'not required'}. ${n_towers > 1 ? `${n_towers}-tower DA array.` : ''}`
  };
}
