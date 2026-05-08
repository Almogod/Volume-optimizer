# VolumeIQ

> **Real-time, scene-aware volume regulation for your browser.**  
> No more yanking your headphones off when an explosion hits mid-dialogue.

---

## The Problem

If you have ever watched an old anime, a classic film, or really any streaming content with inconsistent audio mixing, you already know the pain. Characters talking — soft, pleasant, perfectly audible at your set volume. Then a car crash, a gunshot, a tire screech, or a bomb detonation hits and the audio physically stings. You reach for the volume, turn it down, miss the next line of dialogue because now it is too quiet, turn it back up, and the cycle repeats for the rest of the episode.

This was built because that got frustrating enough to do something about it.

---

## What VolumeIQ Does

VolumeIQ runs silently in the background while you watch anything in your browser. Every **120 milliseconds** it analyses the audio coming from your tab, figures out what kind of sound is happening, and adjusts the volume accordingly — before you even register that it was loud.

It distinguishes between four scene types:

| Scene | Example | What VolumeIQ Does |
|---|---|---|
| 🗣 **Dialogue** | Two characters talking | Fully protected — volume untouched |
| 🔊 **Argument** | Characters shouting at each other | Gentle, minimal reduction only |
| ⚡ **SFX / Action** | Explosion, crash, screech | Aggressive, fast duck — then restores |
| 🎵 **Ambient** | Background music, crowd noise | Moderate regulation |

The key distinction from any other volume tool: **it knows the difference between a character raising their voice and a tire screech.** Both are loud. Only one should be ducked.

---

## How It Works

### Architecture

```
Tab Audio Output
      │
      ▼  chrome.tabCapture API
 Background Script
      │
      ▼  MediaStream ID
 Offscreen Document  ◄──── Web Audio API analysis runs here
      │
      ▼  gain commands (every 120ms)
 Background Script
      │
      ▼  relayed to all frames
 Content Script (injected into every iframe too)
      │
      ▼  element.volume = baseVolume × gain
   Video / Audio Element  ✓
```

This architecture exists for a specific reason. Streaming sites like AnimePahe, Crunchyroll, and others embed their video player inside a **cross-origin iframe** — from a completely different domain than the main page. A naive extension that tries to hook the `<video>` element directly will fail with a CORS error the moment it tries to use `createMediaElementSource()`. VolumeIQ sidesteps this entirely by capturing the tab's full audio output at the browser level, analysing it in an offscreen document, and then communicating gain values back to the content script which applies them using `element.volume` — a property that works regardless of iframe origin.

### Audio Analysis — Two Parallel Methods

#### 1. FFT Frequency Band Analysis

The Web Audio API's `AnalyserNode` provides a full frequency spectrum of the audio every tick. Human speech occupies a predictable range — the fundamental frequency of most voices sits between 85Hz and 255Hz, with the primary harmonics and formants (the parts that carry intelligibility) extending up to about 3400Hz. VolumeIQ divides the spectrum into three bands:

```
20 Hz  – 300 Hz   →  Bass / Rumble band    (explosions, sub-bass hits)
300 Hz – 3400 Hz  →  Speech band           (voice fundamentals + harmonics)
3400 Hz – 12 kHz  →  SFX / Treble band    (screeches, metallic impact, glass)
```

The energy in each band is summed and compared. If the speech band accounts for **42% or more** of the total audio energy in that tick, the extension considers dialogue to be happening and engages speech protection mode.

#### 2. Transient Detection

Frequency analysis alone is not enough. A very loud argument still has speech-dominant frequencies, and a brief explosion might happen to have some mid-range content. So VolumeIQ also tracks how fast the RMS (Root Mean Square — the mathematical measure of audio energy) changes between ticks.

If the RMS jumps by more than **2.2× in a single 120ms window**, that is classified as a transient — a sudden onset event. Human vocal cords cannot produce energy spikes that fast. Explosions, crashes, and impact sounds absolutely can. A transient flag combined with non-speech-dominant frequencies locks the classification as SFX and triggers the aggressive duck.

#### 3. Rolling Baseline

The gain rules are not absolute — they are relative to what "normal" sounds like in your current content. VolumeIQ maintains a rolling 8-second history of RMS values, discards the loudest 10% (to ignore outliers and action peaks from skewing the baseline), and uses the trimmed mean as the reference point. So it adapts whether you are watching a loud action film or a quiet slice-of-life — the "loud" threshold is always calibrated to that specific content.

### Scene Classification Logic

```
Is it a transient spike AND speech band < 42%?  →  SFX
Is speech band ≥ 42% AND louder than baseline?  →  ARGUMENT  
Is speech band ≥ 42%?                           →  SPEECH
Everything else                                 →  AMBIENT
```

There is also a one-tick transition buffer: if the scene was classified as SFX and the very next tick reads as SPEECH, it briefly holds at AMBIENT first. This prevents the volume from lurching back up immediately after an explosion fades into dialogue.

### Gain Application — Per Scene Rules

```
SPEECH    →  floor: 82%   step down: 0.010   step up: 0.025   ramp: 300ms
ARGUMENT  →  floor: 68%   step down: 0.025   step up: 0.020   ramp: 300ms
SFX       →  floor: 22%   step down: 0.075   step up: 0.015   ramp: 80ms
AMBIENT   →  floor: 55%   step down: 0.040   step up: 0.018   ramp: 300ms
```

SFX ducks fast (80ms ramp) and restores slowly. Dialogue barely moves. The asymmetry is intentional — ears adapt well to gradual restoration but are sensitive to sudden increases.

---

## Features

**Scene-Aware Volume Control**  
Classifies audio in real time and applies appropriate gain rules per scene type. Dialogue is protected. SFX is ducked hard and fast.

**Comfort Level Locking**  
When the volume sounds right to you, click **Lock Level** in the popup. The extension records that gain value as a permanent floor for the session. SFX will still get ducked below it, but dialogue and ambient audio will never go quieter than what you locked. Unlock anytime with one click.

**Adjustable Sensitivity**  
A slider from Gentle to Reactive controls how aggressively the extension responds. At Gentle, only severe spikes get touched. At Reactive, even moderate loudness variations are caught quickly.

**Works on Cross-Origin Iframes**  
Because of the tabCapture architecture, VolumeIQ works on AnimePahe, Crunchyroll, and any other site that embeds its player in a cross-origin iframe — something simpler extensions cannot do.

**Live Popup Dashboard**  
The popup shows real-time loudness, current gain percentage, active scene classification with a speech content bar, and the comfort lock status while you watch.

**Non-Destructive**  
VolumeIQ never exceeds the volume you set. It only manages downward from your original level. When you turn it off, your volume is fully restored.

---

## Installation

VolumeIQ is not on the Chrome Web Store. It is a developer build. Installation takes about 30 seconds.

**Step 1** — Download or clone this repository and unzip the folder if needed.

**Step 2** — Open Chrome and navigate to `chrome://extensions`

**Step 3** — Enable **Developer Mode** using the toggle in the top right corner.

**Step 4** — Click **"Load unpacked"** and select the `volume-optimizer-v3` folder.

**Step 5** — The extension will appear in your toolbar area. Click the puzzle piece icon and **pin VolumeIQ** for easy access.

**Step 6** — Navigate to any streaming site, start playing something, open the VolumeIQ popup, and toggle **Auto-Regulate Volume** on. Chrome will ask permission to capture the tab's audio — allow it.

---

## Usage

Once enabled, VolumeIQ runs automatically. The popup gives you live feedback on what it is doing.

**To lock your comfort level:** Let the audio settle to a point that feels right during a normal dialogue scene. Open the popup and click **Lock Level**. A yellow indicator appears showing the locked floor percentage. The extension will continue ducking SFX below that point but will restore dialogue to at least your locked level.

**To adjust sensitivity:** If dialogue is being touched when it should not be, move the slider toward Gentle. If SFX spikes are getting through, move it toward Reactive.

**To stop:** Toggle the switch off in the popup. Volume restores to your original level immediately.

---

## File Structure

```
volume-optimizer-v3/
│
├── manifest.json        Chrome extension manifest (MV3)
├── background.js        Service worker — manages tabCapture and message routing
├── offscreen.html       Shell for the offscreen document
├── offscreen.js         Audio analysis engine — FFT, RMS, scene classification
├── content.js           Injected into all frames — applies element.volume
├── popup.html           Extension popup UI
├── popup.css            Popup styles
├── popup.js             Popup logic — rendering, comfort lock, polling
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

---

## Permissions

| Permission | Why It Is Needed |
|---|---|
| `tabCapture` | To capture the full audio output of the active tab for analysis |
| `offscreen` | To run the Web Audio API context in an offscreen document (MV3 requirement) |
| `scripting` | To inject content scripts into all frames including cross-origin iframes |
| `storage` | To persist enabled state and sensitivity preference across sessions |
| `tabs` | To identify the active tab and relay gain commands to it |
| `activeTab` | To request capture permission on the current tab |

---

## Tested On

- AnimePahe
- YouTube
- Crunchyroll
- Netflix
- Prime Video
- Bilibili
- Any site using a standard HTML `<video>` or `<audio>` element

---

## Known Limitations

**Music-heavy scenes** — Background scores with a lot of mid-range instrumentation (orchestral strings, piano) can occasionally overlap with the speech frequency band and slightly reduce sensitivity. This is a fundamental limitation of FFT-based speech detection without a trained ML model.

**Compressed streaming audio** — Heavily compressed audio (low bitrate streams) can occasionally confuse the transient detector since compression artificially smooths onsets.

**Bluetooth audio devices** — Some Bluetooth audio drivers introduce a buffering delay of 100–200ms. The analysis is still accurate but the perceived response may feel slightly delayed compared to wired headphones.

**Dual audio tabs** — If you have two videos playing in the same tab simultaneously, the extension analyses the mixed signal and may not classify either stream accurately.

---

## Roadmap

- [ ] ML-based speech/non-speech classifier to replace heuristic FFT thresholds
- [ ] Per-site sensitivity profiles that save automatically
- [ ] Visual waveform view in the popup
- [ ] Export/import comfort presets
- [ ] Firefox port (using browser.tabCapture equivalent)

---

## Contributing

This is an open project and feedback is genuinely useful. If you encounter a streaming site where the classification feels wrong, or a scene type that the extension mishandles, open an issue with the site name and a rough description of what was playing. Edge case reports are the most valuable contribution at this stage.

Pull requests are welcome. The core analysis logic lives entirely in `offscreen.js` — that is the best place to start if you want to improve classification accuracy.

---

## Background

Built in roughly two hours after a roommate complained mid-anime-episode that nobody had automated this yet. Handed to him as a test build. He approved it after a few rounds of tweaking. This is what shipped after those tweaks.
