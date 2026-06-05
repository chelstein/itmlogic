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
  const tr = towerReference || (() => {
    if (!frequency_khz) return null;
    const lam = Math.round(300000 / frequency_khz * 100) / 100;
    return {
      wavelength_m:  lam,
      quarter_wave_m: Math.round(lam / 4 * 100) / 100,
      half_wave_m:    Math.round(lam / 2 * 100) / 100,
      asr_threshold_m: 60.96,
      asr_registration_required_at_quarter_wave: lam / 4 > 60.96
    };
  })();

  if (!tr) return null;

  const qw = tr.quarter_wave_m;
  const hw = tr.half_wave_m;
  const asr = tr.asr_threshold_m;
  const asrReq = tr.asr_registration_required_at_quarter_wave;

  return (
    <RackPanel
      eyebrow="Tower reference"
      title={`${frequency_khz ? `${frequency_khz} kHz ` : ''}antenna sizing`}
      italicAccent="λ/4 – λ/2 typical for AM verticals."
      dense
    >
      <div className="space-y-1">
        <Row label="Wavelength (λ)"   value={`${tr.wavelength_m} m`} />
        <Row label="λ/4 (std. height)" value={`${qw} m (${(qw * 3.28084).toFixed(0)} ft)`} warn={qw > asr} />
        <Row label="λ/2 (max height)"  value={`${hw} m (${(hw * 3.28084).toFixed(0)} ft)`} warn={hw > asr} />
        <div className="border-t border-rule mt-1.5 pt-1.5">
          <Row
            label="ASR threshold (§17.7)"
            value={`${asr} m (200 ft)`}
          />
          <div className="mt-1">
            <span
              className="font-mono text-[9px] uppercase tracking-rack border rounded-sm px-1.5 py-0.5"
              style={asrReq
                ? { color: '#ffb347', background: 'rgba(255,179,71,0.10)', borderColor: 'rgba(255,179,71,0.45)' }
                : { color: '#63d471', background: 'rgba(99,212,113,0.08)', borderColor: 'rgba(99,212,113,0.35)' }}
            >
              {asrReq ? 'ASR registration likely required' : 'ASR may not be required at λ/4'}
            </span>
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
