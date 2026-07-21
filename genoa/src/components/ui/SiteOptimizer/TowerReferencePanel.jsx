import React from 'react';
import RackPanel from '../RackPanel.jsx';

// TowerReferencePanel — shows antenna sizing constants for the operating
// frequency.  Useful for screening whether candidate sites can physically
// accommodate the required tower height, and whether ASR registration (47
// CFR §17.7, 200-ft / 60.96-m threshold) is likely required.

function Row({ label, value, warn }){
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="font-mono text-[10px] text-textDim shrink-0">{label}</span>
      <span
        className="font-mono text-[11px] text-right"
        style={{ color: warn ? '#ffb347' : '#c8bfa8' }}
      >
        {value}
      </span>
    </div>
  );
}

export default function TowerReferencePanel({ towerReference, frequency_khz, skywaveRiskLevel, protectionClassAdvisory }){
  if (!towerReference && !frequency_khz) return null;

  // Fall back to computing from frequency if engine block isn't present yet.
  // NOTE: λ/4 and 5/8λ are REFERENCE values only (canonical/antennaDesign.js
  // quarterWaveReferenceM / fiveEighthsReferenceM) — neither is the selected
  // design height. The engine's canonical antenna-height rule picks the
  // design height from requested_height_m / host_structure_height_m / a
  // class-typical default (5/8λ for A/B, 3/8λ for C/D), none of which this
  // frequency-only fallback has access to, so it deliberately does NOT
  // fabricate an ASR verdict — asrRequiredKnown is null until the real
  // towerReference prop (canonical.regulatory.asr-derived) is available.
  const tr = towerReference || (() => {
    if (!frequency_khz) return null;
    const lam = Math.round(300000 / frequency_khz * 100) / 100;
    return {
      wavelength_m:  lam,
      quarter_wave_m: Math.round(lam / 4 * 100) / 100,
      half_wave_m:    Math.round(lam / 2 * 100) / 100,
      asr_threshold_m: 60.96,
      asr_registration_required_at_design_height: null,
    };
  })();

  if (!tr) return null;

  const qw = tr.quarter_wave_m;
  const hw = tr.half_wave_m;
  const asr = tr.asr_threshold_m;
  // Rewired to the field siteOptimizer.js's tower_reference actually emits
  // (asr_registration_required_at_design_height, canonical.regulatory.asr-
  // derived) — the old asr_registration_required_at_quarter_wave name never
  // matched the real API response, so this label silently always showed
  // "not required" for real engine data (canonical-consistency-audit-followup,
  // Group 2 item 7).
  const asrReq = tr.asr_registration_required_at_design_height;

  return (
    <RackPanel
      eyebrow="Tower reference"
      title={`${frequency_khz ? `${frequency_khz} kHz ` : ''}antenna sizing`}
      italicAccent="λ/4 – λ/2 typical for AM verticals."
      dense
    >
      <div className="space-y-1">
        <Row label="Wavelength (λ)"   value={`${tr.wavelength_m} m`} />
        {/* λ/4 is a REFERENCE value only (R_rad ≈ 36.6 Ω physics reference)
            — canonical never treats it as the selected design height (that
            is 5/8λ for class A/B or 3/8λ for class C/D, or the operator's
            requested/host-structure height; see canonical/antennaDesign.js).
            Label fixed accordingly (canonical-consistency-audit-followup,
            Group 2 item 7). */}
        <Row label="λ/4 (reference only)" value={`${qw} m (${(qw * 3.28084).toFixed(0)} ft)`} warn={qw > asr} />
        <Row label="λ/2 (max reference)"  value={`${hw} m (${(hw * 3.28084).toFixed(0)} ft)`} warn={hw > asr} />
        <div className="border-t border-rule mt-1.5 pt-1.5">
          <Row
            label="ASR threshold (§17.7)"
            value={`${asr} m (200 ft)`}
          />
          <div className="mt-1">
            {asrReq == null ? (
              <span
                className="font-mono text-[9px] uppercase tracking-rack border rounded-sm px-1.5 py-0.5"
                style={{ color: '#a89c84', background: 'rgba(168,156,132,0.08)', borderColor: 'rgba(168,156,132,0.35)' }}
              >
                ASR requirement unknown — depends on the selected design height
              </span>
            ) : (
              <span
                className="font-mono text-[9px] uppercase tracking-rack border rounded-sm px-1.5 py-0.5"
                style={asrReq
                  ? { color: '#ffb347', background: 'rgba(255,179,71,0.10)', borderColor: 'rgba(255,179,71,0.45)' }
                  : { color: '#63d471', background: 'rgba(99,212,113,0.08)', borderColor: 'rgba(99,212,113,0.35)' }}
              >
                {asrReq ? 'ASR registration likely required (selected design height)' : 'ASR not required at the selected design height'}
              </span>
            )}
          </div>
        </div>
        <div className="font-mono text-[9px] text-textDim leading-tight mt-1.5">
          All candidate sites in this run share these sizing constants.
          Site-specific AGL height determines whether §17.7 applies.
        </div>
        {(skywaveRiskLevel || protectionClassAdvisory) && (
          <div className="border-t border-rule mt-2 pt-2 space-y-1.5">
            {skywaveRiskLevel && (
              <div className="flex items-center gap-1.5">
                <span className="font-mono text-[9px] text-textDim shrink-0">§73.182 risk</span>
                <span
                  className="font-mono text-[9px] uppercase tracking-rack border rounded-sm px-1.5 py-0.5"
                  style={skywaveRiskLevel === 'HIGH'
                    ? { color: '#ff7a7a', background: 'rgba(255,90,90,0.10)', borderColor: 'rgba(255,90,90,0.45)' }
                    : skywaveRiskLevel === 'MODERATE'
                    ? { color: '#ffb347', background: 'rgba(255,179,71,0.10)', borderColor: 'rgba(255,179,71,0.45)' }
                    : { color: '#63d471', background: 'rgba(99,212,113,0.08)', borderColor: 'rgba(99,212,113,0.35)' }}
                >
                  {skywaveRiskLevel}
                </span>
              </div>
            )}
            {protectionClassAdvisory && (
              <p className="font-mono text-[9px] text-amberDim leading-snug">
                {protectionClassAdvisory}
              </p>
            )}
          </div>
        )}
      </div>
    </RackPanel>
  );
}
