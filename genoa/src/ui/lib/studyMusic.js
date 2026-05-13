// Bobby Caldwell background music for long-running operations.
//
// Per the operator:
//   • "Open Your Eyes"              — playing while a study compute runs
//                                     ("start with open your eyes on initial"
//                                     = the initial action is the study)
//   • "Never Find a Love Like Mine" — playing once an exhibit is loaded
//                                     and the operator is working with it
//   • "Down for the Third Time"     — playing while PDF / TXT job runs
//
// When the app is idle with no exhibit loaded, no music plays.
//
// Audio source files are NOT committed (copyrighted material).  Drop
// MP3s into genoa/src/ui/public-static/audio/ with these filenames and
// the player picks them up automatically:
//
//   public-static/audio/open-your-eyes.mp3
//   public-static/audio/never-find-a-love.mp3
//   public-static/audio/down-for-the-third-time.mp3
//
// Browser autoplay policy blocks audio until the user has interacted
// with the page at least once, so the player arms itself on the first
// click anywhere — after that, automatic crossfades between tracks
// work without further prompts.

import { useEffect, useRef, useState } from 'react';

export const TRACKS = {
  compute: {
    title:  'Open Your Eyes',
    artist: 'Bobby Caldwell',
    src:    '/audio/open-your-eyes.mp3'
  },
  exhibit: {
    title:  'Never Find a Love Like Mine',
    artist: 'Bobby Caldwell',
    src:    '/audio/never-find-a-love.mp3'
  },
  pdf: {
    title:  'Down for the Third Time',
    artist: 'Bobby Caldwell',
    src:    '/audio/down-for-the-third-time.mp3'
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
 *   phase  — 'idle' | 'compute' | 'exhibit' | 'pdf'   which track should play
 *            'idle' = no music; all <audio> elements pause
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
  const audioRefs = useRef({});                  // { idle, compute, pdf } -> <audio>
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
      // Source not yet provided (404 on /audio/*.mp3) — silently no-op
      // so the UI still works when audio files haven't been dropped in.
    });
    fade(target, target.volume, volume, FADE_MS);
  }, [phase, armed, muted, volume]);

  return {
    currentTrack: TRACKS[phase] || null,
    armed,
    arm
  };
}
