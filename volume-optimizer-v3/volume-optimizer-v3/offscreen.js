// offscreen.js – VolumeIQ v3
// Smart audio classification:
//   • Speech detection via frequency band analysis (300–3400 Hz)
//   • Transient SFX detection via sudden RMS onset spikes
//   • Comfort level locking (user-set floor gain)

'use strict';

const SAMPLE_RATE   = 48000;
const FFT_SIZE      = 4096;
const TICK_MS       = 120;
const BASELINE_WIN  = Math.ceil(8000 / TICK_MS);
const BIN_SIZE      = SAMPLE_RATE / FFT_SIZE;
const freqToBin     = hz => Math.round(hz / BIN_SIZE);

// Frequency bands
const SPEECH_LO = freqToBin(300);
const SPEECH_HI = freqToBin(3400);
const BASS_LO   = freqToBin(20);
const BASS_HI   = freqToBin(300);
const SFX_LO    = freqToBin(3400);
const SFX_HI    = freqToBin(12000);

// Per-scene ducking behaviour
const SCENE = {
  SPEECH:   { floor: 0.82, down: 0.010, up: 0.025 },
  ARGUMENT: { floor: 0.68, down: 0.025, up: 0.020 },
  SFX:      { floor: 0.22, down: 0.075, up: 0.015 },
  AMBIENT:  { floor: 0.55, down: 0.040, up: 0.018 },
};

const SPEECH_RATIO_THRESH   = 0.42;
const TRANSIENT_THRESH      = 2.2;
const LOUD_MULT             = 1.50;
const QUIET_MULT            = 0.55;

let audioCtx = null, analyser = null, gainNode = null, sourceNode = null;
let ticker = null, stream = null;
let rmsHistory = [], currentGain = 1.0, sensitivity = 0.5;
let prevRMS = 0, prevScene = 'AMBIENT';
let comfortLocked = false, comfortFloor = 0.0;

let lastStats = { rms:0, baseline:0, gain:1.0, loudness:0, scene:'AMBIENT', speechRatio:0, transient:false, comfortLocked:false, comfortFloor:0 };

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg._target !== 'offscreen') return;
  if (msg.type === 'START_ANALYSIS') {
    startAnalysis(msg.streamId, msg.sensitivity).then(() => sendResponse({ ok: true })).catch(e => sendResponse({ ok: false, error: e.message }));
    return true;
  }
  if (msg.type === 'STOP_ANALYSIS')   { stopAnalysis(); sendResponse({ ok: true }); }
  if (msg.type === 'GET_STATS')       { sendResponse({ ...lastStats }); }
  if (msg.type === 'SET_SENSITIVITY') { sensitivity = msg.value; sendResponse({ ok: true }); }
  if (msg.type === 'LOCK_COMFORT') {
    comfortLocked = true; comfortFloor = currentGain;
    lastStats.comfortLocked = true; lastStats.comfortFloor = comfortFloor;
    sendResponse({ ok: true, floor: comfortFloor });
  }
  if (msg.type === 'UNLOCK_COMFORT') {
    comfortLocked = false; comfortFloor = 0;
    lastStats.comfortLocked = false; lastStats.comfortFloor = 0;
    sendResponse({ ok: true });
  }
});

async function startAnalysis(streamId, sens) {
  stopAnalysis();
  sensitivity = sens ?? 0.5;
  stream = await navigator.mediaDevices.getUserMedia({
    audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } },
    video: false,
  });
  audioCtx   = new AudioContext({ sampleRate: SAMPLE_RATE });
  sourceNode = audioCtx.createMediaStreamSource(stream);
  analyser   = audioCtx.createAnalyser();
  gainNode   = audioCtx.createGain();
  analyser.fftSize = FFT_SIZE;
  analyser.smoothingTimeConstant = 0.75;
  gainNode.gain.value = 1.0;
  sourceNode.connect(analyser);
  analyser.connect(gainNode);
  gainNode.connect(audioCtx.destination);
  ticker = setInterval(tick, TICK_MS);
}

function stopAnalysis() {
  if (ticker) { clearInterval(ticker); ticker = null; }
  if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
  try { sourceNode?.disconnect(); analyser?.disconnect(); gainNode?.disconnect(); } catch(_) {}
  try { audioCtx?.close(); } catch(_) {}
  audioCtx = sourceNode = analyser = gainNode = null;
  rmsHistory = []; currentGain = 1.0; prevRMS = 0;
}

function tick() {
  if (!analyser) return;

  // Time-domain RMS
  const timeBuf = new Float32Array(FFT_SIZE);
  analyser.getFloatTimeDomainData(timeBuf);
  let sumSq = 0;
  for (let i = 0; i < timeBuf.length; i++) sumSq += timeBuf[i] * timeBuf[i];
  const rms = Math.sqrt(sumSq / timeBuf.length);

  // Frequency band energies
  const freqBuf = new Uint8Array(analyser.frequencyBinCount);
  analyser.getByteFrequencyData(freqBuf);
  const speechE  = bandEnergy(freqBuf, SPEECH_LO, SPEECH_HI);
  const bassE    = bandEnergy(freqBuf, BASS_LO,   BASS_HI);
  const sfxE     = bandEnergy(freqBuf, SFX_LO,    SFX_HI);
  const totalE   = speechE + bassE + sfxE + 0.0001;
  const speechRatio = speechE / totalE;

  // Transient detection: is this a sudden spike?
  const rmsDelta    = prevRMS > 0.0005 ? rms / prevRMS : 1;
  const isTransient = rmsDelta > TRANSIENT_THRESH && rms > 0.01;
  prevRMS = rms;

  // Baseline
  rmsHistory.push(rms);
  if (rmsHistory.length > BASELINE_WIN) rmsHistory.shift();
  const sorted   = [...rmsHistory].sort((a, b) => a - b);
  const trimmed  = sorted.slice(0, Math.floor(sorted.length * 0.9));
  const baseline = trimmed.reduce((s, v) => s + v, 0) / (trimmed.length || 1);
  if (baseline < 0.0005) return;

  const isLoud   = rms > baseline * (LOUD_MULT - sensitivity * 0.35);
  const isQuiet  = rms < baseline * QUIET_MULT;
  const isSpeech = speechRatio >= SPEECH_RATIO_THRESH;

  // Scene classification
  let scene;
  if (isTransient && !isSpeech)   scene = 'SFX';
  else if (isSpeech && isLoud)    scene = 'ARGUMENT';
  else if (isSpeech)              scene = 'SPEECH';
  else                             scene = 'AMBIENT';

  // Brief transition buffer: SFX → SPEECH flips smoothly via AMBIENT
  if (prevScene === 'SFX' && scene === 'SPEECH' && rmsDelta > 0.7) scene = 'AMBIENT';
  prevScene = scene;

  const beh      = SCENE[scene];
  const stepDown = beh.down * (0.4 + sensitivity * 0.8);
  const stepUp   = beh.up   * (0.4 + sensitivity * 0.6);

  let newGain = currentGain;
  if (isLoud && scene !== 'SPEECH') {
    newGain = Math.max(beh.floor, currentGain - stepDown);
  } else if (isQuiet || (!isLoud && scene !== 'SFX')) {
    newGain = Math.min(1.0, currentGain + stepUp);
  }

  // Comfort floor — never duck below what user locked
  if (comfortLocked) newGain = Math.max(comfortFloor, newGain);

  if (Math.abs(newGain - currentGain) > 0.002) {
    currentGain = newGain;
    const ramp  = scene === 'SFX' ? 0.08 : 0.30;
    gainNode.gain.linearRampToValueAtTime(currentGain, audioCtx.currentTime + ramp);
  }

  const loudnessPct = Math.min(100, Math.round((rms / (baseline * LOUD_MULT)) * 100));
  lastStats = {
    rms: Math.round(rms * 1000) / 1000,
    baseline: Math.round(baseline * 1000) / 1000,
    gain: Math.round(currentGain * 100) / 100,
    loudness: loudnessPct,
    scene, speechRatio: Math.round(speechRatio * 100),
    transient: isTransient,
    comfortLocked, comfortFloor: Math.round(comfortFloor * 100) / 100,
  };

  chrome.runtime.sendMessage({ type: 'APPLY_GAIN', gain: currentGain, loudness: loudnessPct, scene }).catch(() => {});
}

function bandEnergy(buf, lo, hi) {
  let sum = 0;
  const l = Math.max(0, lo), h = Math.min(buf.length - 1, hi);
  for (let i = l; i <= h; i++) sum += buf[i] * buf[i];
  return sum / ((h - l + 1) || 1);
}
