// popup.js – VolumeIQ v3
(function () {
  'use strict';

  const toggleSwitch  = document.getElementById('toggleSwitch');
  const statusBadge   = document.getElementById('statusBadge');
  const meterSection  = document.getElementById('meterSection');
  const gainRow       = document.getElementById('gainRow');
  const meterFill     = document.getElementById('meterFill');
  const loudnessVal   = document.getElementById('loudnessVal');
  const gainVal       = document.getElementById('gainVal');
  const gainPill      = document.getElementById('gainPill');
  const gainArrow     = document.getElementById('gainArrow');
  const sensSlider    = document.getElementById('sensitivitySlider');
  const sensLabel     = document.getElementById('sensLabel');
  const infoText      = document.getElementById('infoText');
  const sourceCount   = document.getElementById('sourceCount');
  const header        = document.querySelector('header');
  const sceneStrip    = document.getElementById('sceneStrip');
  const speechBarFill = document.getElementById('speechBarFill');
  const speechPct     = document.getElementById('speechPct');
  const lockBtn       = document.getElementById('lockBtn');
  const lockLabel     = document.getElementById('lockLabel');
  const comfortBar    = document.getElementById('comfortBar');
  const floorVal      = document.getElementById('floorVal');
  const unlockBtn     = document.getElementById('unlockBtn');

  const SCENE_IDS  = ['SPEECH','ARGUMENT','SFX','AMBIENT'];
  const SENS_NAMES = ['GENTLE','MILD','BALANCED','ALERT','REACTIVE'];
  let enabled = false, sensitivity = 0.5, activeTabId = null;
  let prevGain = 1.0, pollTimer = null;
  let currentScene = 'AMBIENT';

  // ── Init ──────────────────────────────────────────────────────────────────
  chrome.storage.local.get(['enabled','sensitivity'], async data => {
    enabled     = data.enabled     ?? false;
    sensitivity = data.sensitivity ?? 0.5;
    sensSlider.value = Math.round(sensitivity * 100);
    updateSensLabel(sensSlider.value);
    const tab = await getActiveTab();
    if (tab) activeTabId = tab.id;
    applyVisualState();
    if (enabled && activeTabId) startCapture();
  });

  // ── Toggle ────────────────────────────────────────────────────────────────
  toggleSwitch.addEventListener('change', async () => {
    enabled = toggleSwitch.checked;
    chrome.storage.local.set({ enabled });
    if (!activeTabId) { const t = await getActiveTab(); activeTabId = t?.id ?? null; }
    if (enabled) startCapture(); else stopCapture();
    applyVisualState();
  });

  // ── Sensitivity ───────────────────────────────────────────────────────────
  sensSlider.addEventListener('input', e => {
    sensitivity = e.target.value / 100;
    updateSensLabel(e.target.value);
    chrome.storage.local.set({ sensitivity });
    chrome.runtime.sendMessage({ type: 'SET_SENSITIVITY', value: sensitivity });
  });

  // ── Lock / Unlock comfort ─────────────────────────────────────────────────
  lockBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'LOCK_COMFORT' }, resp => {
      if (resp?.ok) {
        setComfortLocked(true, resp.floor);
      }
    });
  });

  unlockBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'UNLOCK_COMFORT' }, () => {
      setComfortLocked(false, 0);
    });
  });

  function setComfortLocked(locked, floor) {
    if (locked) {
      lockBtn.classList.add('locked');
      lockLabel.textContent = 'Locked ✓';
      comfortBar.classList.add('visible');
      floorVal.textContent = Math.round(floor * 100) + '%';
    } else {
      lockBtn.classList.remove('locked');
      lockLabel.textContent = 'Lock Level';
      comfortBar.classList.remove('visible');
    }
  }

  // ── Capture control ───────────────────────────────────────────────────────
  function startCapture() {
    if (!activeTabId) return;
    infoText.textContent = '⏳ Starting audio capture…';
    chrome.runtime.sendMessage({ type: 'START_CAPTURE', tabId: activeTabId, sensitivity }, resp => {
      if (chrome.runtime.lastError || !resp?.ok) {
        infoText.textContent = '⚠️ Could not capture audio. Try refreshing the page.';
        toggleSwitch.checked = false; enabled = false;
        chrome.storage.local.set({ enabled: false }); applyVisualState(); return;
      }
      infoText.textContent = '✓ Listening and classifying audio…';
      startPolling(); countSources();
    });
  }

  function stopCapture() {
    chrome.runtime.sendMessage({ type: 'STOP_CAPTURE', tabId: activeTabId });
    stopPolling(); resetMeter();
  }

  // ── Polling ───────────────────────────────────────────────────────────────
  function startPolling() {
    stopPolling();
    pollTimer = setInterval(() => {
      chrome.runtime.sendMessage({ type: 'GET_STATS' }, stats => {
        if (!stats || chrome.runtime.lastError) return;
        updateMeter(stats);
      });
    }, 200);
  }
  function stopPolling() { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } }

  // ── Meter update ──────────────────────────────────────────────────────────
  function resetMeter() {
    meterFill.style.width = '0%'; loudnessVal.textContent = '—';
    gainVal.textContent = '100%'; gainPill.className = 'gain-pill';
    speechBarFill.style.width = '0%'; speechPct.textContent = '—';
    SCENE_IDS.forEach(s => document.getElementById('chip-' + s)?.classList.remove('active-' + s));
  }

  function updateMeter(stats) {
    const { gain = 1, loudness = 0, scene = 'AMBIENT', speechRatio = 0, comfortLocked, comfortFloor } = stats;
    const pct = Math.min(100, Math.max(0, loudness));

    meterFill.style.width = pct + '%';
    loudnessVal.style.color = pct > 85 ? 'var(--accent2)' : pct > 60 ? 'var(--accent3)' : 'var(--accent)';
    loudnessVal.textContent = pct > 85 ? '🔥 ' + pct + '%' : pct + '%';

    const gainPct = Math.round(gain * 100);
    gainVal.textContent = gainPct + '%';

    gainPill.className = 'gain-pill';
    if (scene === 'SPEECH' || scene === 'ARGUMENT') gainPill.classList.add('speech-protect');
    else if (gain < prevGain - 0.01) gainPill.classList.add('ducking');

    gainArrow.style.transform = gain < prevGain - 0.01 ? 'rotate(0deg)' : 'rotate(180deg)';
    prevGain = gain;

    // Scene chips
    SCENE_IDS.forEach(s => {
      const el = document.getElementById('chip-' + s);
      if (!el) return;
      el.className = 'chip' + (s === scene ? ' active-' + s : '');
    });

    currentScene = scene;

    // Speech bar
    speechBarFill.style.width = speechRatio + '%';
    speechPct.textContent = speechRatio + '%';

    // Info text
    const infoMap = {
      SPEECH:   `🗣 Dialogue detected — protecting voice clarity`,
      ARGUMENT: `🔊 Argument scene — gentle regulation only`,
      SFX:      `⚡ SFX / action — ducking audio spike`,
      AMBIENT:  `🎵 Ambient / background — monitoring`,
    };
    infoText.textContent = infoMap[scene] || '✓ Monitoring…';

    // Sync comfort lock state from stats
    if (comfortLocked !== undefined) setComfortLocked(comfortLocked, comfortFloor);
  }

  // ── Visual state ──────────────────────────────────────────────────────────
  function applyVisualState() {
    toggleSwitch.checked = enabled;
    statusBadge.textContent = enabled ? 'ON' : 'OFF';
    statusBadge.classList.toggle('active', enabled);
    meterSection.classList.toggle('dimmed', !enabled);
    gainRow.classList.toggle('dimmed', !enabled);
    sceneStrip.classList.toggle('dimmed', !enabled);
    header.classList.toggle('scanning', enabled);
    if (!enabled) { infoText.textContent = 'Enable to start monitoring audio'; resetMeter(); }
  }

  function updateSensLabel(val) {
    sensLabel.textContent = SENS_NAMES[Math.round((val / 100) * (SENS_NAMES.length - 1))];
  }

  async function countSources() {
    if (!activeTabId) return;
    try {
      const res = await chrome.scripting.executeScript({ target: { tabId: activeTabId, allFrames: true }, func: () => document.querySelectorAll('video,audio').length });
      const n = res?.reduce((s, r) => s + (r.result || 0), 0) ?? 0;
      sourceCount.textContent = n + ' source' + (n !== 1 ? 's' : '') + ' detected';
    } catch (_) { sourceCount.textContent = 'scanning…'; }
  }

  function getActiveTab() {
    return new Promise(r => chrome.tabs.query({ active: true, currentWindow: true }, tabs => r(tabs?.[0] ?? null)));
  }
})();
