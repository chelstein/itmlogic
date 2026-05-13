// Bobby Caldwell background music for long-running operations.
//
// Per the operator:
//   • "Open Your Eyes"             — playing while a study compute runs
//   • "My Flame"                   — playing while a save operation runs
//   • "What You Won't Do for Love" — playing once an exhibit is loaded
//                                    and the operator is working with it
//   • "Down for the Third Time"    — playing while PDF / TXT job runs
//
// When the app is idle with no exhibit loaded, no music plays.
//
// Audio source files are committed to public-static/audio/ with their
// original "Bobby Caldwell <title>.mp3" filenames:
//
//   public-static/audio/Bobby Caldwell Open Your Eyes.mp3
//   public-static/audio/Bobby Caldwell My Flame.mp3
//   public-static/audio/Bobby Caldwell What You Won't Do for Love.mp3
//   public-static/audio/Bobby Caldwell Down for the Third Time.mp3
//
// Filenames are URL-encoded at fetch time via encodeURIComponent so
// spaces and the apostrophe in "Won't" resolve cleanly.
//
// Browser autoplay policy blocks audio until the user has interacted
// with the page at least once, so the player arms itself on the first
// click anywhere — after that, automatic crossfades between tracks
// work without further prompts.

import { useEffect, useRef, useState } from 'react';

// Filenames match the literal MP3s in public-static/audio/.  Spaces
// and the apostrophe in "Won't" go through encodeURIComponent so the
// fetched URL is /audio/Bobby%20Caldwell%20...%20.mp3.
const AUDIO = (file) => `/audio/${encodeURIComponent(file)}`;
export const TRACKS = {
  compute: {
    title:  'Open Your Eyes',
    artist: 'Bobby Caldwell',
    src:    AUDIO('Bobby Caldwell Open Your Eyes.mp3')
  },
  save: {
    title:  'My Flame',
    artist: 'Bobby Caldwell',
    src:    AUDIO('Bobby Caldwell My Flame.mp3')
  },
  exhibit: {
    title:  "What You Won't Do for Love",
    artist: 'Bobby Caldwell',
    src:    AUDIO("Bobby Caldwell What You Won't Do for Love.mp3")
  },
  pdf: {
    title:  'Down for the Third Time',
    artist: 'Bobby Caldwell',
    src:    AUDIO('Bobby Caldwell Down for the Third Time.mp3')
  }
};

const FADE_MS = 600;

function fade(audio, fromVol, toVol, ms){
  if (!audio) return Promise.resolve();
  const steps = 12;
  const dt = ms / steps;
  const dv = (toVol - fromVol) / steps;
  audio.volume = Math.max(0, Math.min(1, fromVol));
  return new Promise((resolve) => {
    let i = 0;
    const t = setInterval(() => {
      i += 1;
      audio.volume = Math.max(0, Math.min(1, fromVol + dv * i));
      if (i >= steps){ clearInterval(t); resolve(); }
    }, dt);
  });
}

/**
 * useStudyMusic({ phase, muted, volume })
 *
 *   phase  — 'idle' | 'compute' | 'save' | 'exhibit' | 'pdf'
 *            which track should play; 'idle' pauses all elements
 *   muted  — boolean                                   pause + fade out
 *   volume — 0..1                                       max track volume
 *
 * Returns: { currentTrack, armed, arm }
 *   currentTrack — the TRACKS entry for the active phase, or null on 'idle'
 *   armed        — whether the user has interacted with the page yet
 *                  (audio can play); set true automatically on the
 *                  first user click
 *   arm()        — call to mark the user-interaction gate satisfied
 *                  (e.g. from a "Play 🎵" button click handler).
 */
export function useStudyMusic({ phase = 'idle', muted = false, volume = 0.35 } = {}){
  const audioRefs = useRef({});                  // { compute, save, exhibit, pdf } -> <audio>
  const [armed, setArmed] = useState(false);
  const arm = () => setArmed(true);

  // Arm on first user gesture so browser autoplay policy doesn't block
  // the first crossfade.  capture: true so we catch every click before
  // it bubbles, and once: true so we self-detach.
  useEffect(() => {
    if (armed) return;
    const onFirstGesture = () => setArmed(true);
    window.addEventListener('click',    onFirstGesture, { capture: true, once: true });
    window.addEventListener('keydown',  onFirstGesture, { capture: true, once: true });
    window.addEventListener('touchend', onFirstGesture, { capture: true, once: true });
    return () => {
      window.removeEventListener('click',    onFirstGesture, { capture: true });
      window.removeEventListener('keydown',  onFirstGesture, { capture: true });
      window.removeEventListener('touchend', onFirstGesture, { capture: true });
    };
  }, [armed]);

  // Lazy-create <audio> elements once.
  useEffect(() => {
    if (typeof Audio === 'undefined') return;
    for (const key of Object.keys(TRACKS)){
      if (audioRefs.current[key]) continue;
      const a = new Audio(TRACKS[key].src);
      a.loop     = true;
      a.preload  = 'none';
      a.volume   = 0;
      a.crossOrigin = 'anonymous';
      audioRefs.current[key] = a;
    }
    return () => {
      for (const a of Object.values(audioRefs.current)){
        try { a.pause(); } catch {}
      }
    };
  }, []);

  // Phase transitions — crossfade the previous track out, the new one in.
  useEffect(() => {
    if (!armed || muted) {
      // Pause everything if not armed or muted.
      for (const a of Object.values(audioRefs.current)){
        if (!a.paused) fade(a, a.volume, 0, FADE_MS).then(() => a.pause());
      }
      return;
    }
    const target = audioRefs.current[phase];
    if (!target) return;
    for (const [key, a] of Object.entries(audioRefs.current)){
      if (key === phase) continue;
      if (!a.paused) fade(a, a.volume, 0, FADE_MS).then(() => a.pause());
    }
    target.play().catch(() => {
      // 404 / decode error — silently no-op so the UI still works
      // when an audio file is missing or unsupported by the browser.
    });
    fade(target, target.volume, volume, FADE_MS);
  }, [phase, armed, muted, volume]);

  return {
    currentTrack: TRACKS[phase] || null,
    armed,
    arm
  };
}
