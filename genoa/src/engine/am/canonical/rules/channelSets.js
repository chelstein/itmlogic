// Canonical AM channel classification sets — 47 CFR §73.25 (clear
// channels), §73.26 (regional channels), §73.27 (local channels).
//
// SINGLE SOURCE for channel-class predicates in the canonical pipeline.
// The members are transcribed verbatim from the sets embedded in
// src/engine/am/siteOptimizer.js (the screening optimizer keeps its own
// private copies; importing from there would create a circular dependency,
// so the canonical pipeline owns this copy and the optimizer's copy is
// slated for removal per docs/architecture-contradiction-origins.md).
//
// - Clear channels (§73.25): channels on which dominant Class A stations
//   operate and skywave protection applies.
// - Local channels (§73.27): the six channels reserved for Class C
//   stations (0.25–1 kW, unlimited time, §73.21(c)).
// - Regional channels (§73.26): every other channel in the 540–1700 kHz
//   band; represented here by exclusion (neither clear nor local).

'use strict';

/** 47 CFR §73.27 — local channels (Class C). */
export const LOCAL_CHANNEL_KHZ = Object.freeze(new Set([
  1230, 1240, 1340, 1400, 1450, 1490,
]));

/** 47 CFR §73.25 — clear channels (dominant Class A skywave protection). */
export const CLEAR_CHANNEL_KHZ = Object.freeze(new Set([
  640, 650, 660, 670, 700, 710, 720, 750, 760, 770, 780,
  820, 830, 840, 870, 880, 890, 940, 990, 1000, 1020, 1030,
  1040, 1060, 1070, 1100, 1120, 1160, 1180, 1200, 1210,
]));

/**
 * @param {number} frequency_khz
 * @returns {boolean} true when the frequency is a §73.25 clear channel.
 */
export function isClearChannel(frequency_khz) {
  return CLEAR_CHANNEL_KHZ.has(Number(frequency_khz));
}

/**
 * @param {number} frequency_khz
 * @returns {boolean} true when the frequency is a §73.27 local channel.
 */
export function isLocalChannel(frequency_khz) {
  return LOCAL_CHANNEL_KHZ.has(Number(frequency_khz));
}

/**
 * @param {number} frequency_khz
 * @returns {boolean} true when the frequency is a §73.26 regional channel
 *   (i.e. an AM-band channel that is neither clear nor local).
 */
export function isRegionalChannel(frequency_khz) {
  const f = Number(frequency_khz);
  if (!Number.isFinite(f) || f < 540 || f > 1700) return false;
  return !CLEAR_CHANNEL_KHZ.has(f) && !LOCAL_CHANNEL_KHZ.has(f);
}
