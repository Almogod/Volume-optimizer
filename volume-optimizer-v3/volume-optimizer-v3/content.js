// content.js – VolumeIQ v2
// Receives gain commands from background and applies them to ALL
// video/audio elements found in this frame (including cross-origin iframes).
// No Web Audio API needed here — element.volume works on any origin.

'use strict';

(function () {
  let baseVolume  = null;  // User's original volume (captured on first media play)
  let lastGain    = 1.0;

  // ─── Capture user's "comfortable" base volume once ──────────────────────────
  function captureBaseVolume(el) {
    if (baseVolume !== null) return;

    // Wait until the user is actually playing something
    const check = () => {
      if (!el.paused && el.volume > 0) {
        baseVolume = el.volume;
        console.log(`[VolumeIQ] Base volume locked at ${baseVolume}`);
      }
    };
    el.addEventListener('play',        check, { once: false });
    el.addEventListener('volumechange', () => {
      // If user manually changes volume while we're NOT adjusting, update base
      if (Math.abs(el.volume - (baseVolume ?? 1) * lastGain) > 0.05) {
        // User touched it — re-anchor
        baseVolume = el.volume / lastGain;
        baseVolume = Math.min(1, Math.max(0.01, baseVolume));
        console.log(`[VolumeIQ] Base re-anchored to ${baseVolume}`);
      }
    });
    check();
  }

  // ─── Apply gain to every media element in this frame ──────────────────────
  function applyGain(gain) {
    lastGain = gain;
    document.querySelectorAll('video, audio').forEach(el => {
      captureBaseVolume(el);
      if (baseVolume === null) return;  // not playing yet

      // Clamp the final volume between 0 and 1
      const target = Math.min(1.0, Math.max(0.0, baseVolume * gain));

      // Only update if meaningfully different (avoid triggering volumechange loop)
      if (Math.abs(el.volume - target) > 0.005) {
        el.volume = target;
      }
    });
  }

  // ─── Also watch for dynamically added elements (SPA/lazy iframes) ──────────
  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      m.addedNodes.forEach(node => {
        if (node.nodeType !== 1) return;
        if (node.matches?.('video, audio')) captureBaseVolume(node);
        node.querySelectorAll?.('video, audio').forEach(captureBaseVolume);
      });
    }
  });
  if (document.body) {
    observer.observe(document.body, { childList: true, subtree: true });
  } else {
    document.addEventListener('DOMContentLoaded', () => {
      observer.observe(document.body, { childList: true, subtree: true });
    });
  }

  // Initialize any existing elements
  document.querySelectorAll('video, audio').forEach(captureBaseVolume);

  // ─── Listen for gain commands from background ──────────────────────────────
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'SET_GAIN') {
      applyGain(msg.gain);
    }
  });

})();
