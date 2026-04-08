// background.js – VolumeIQ v3
let offscreenReady = false, captureTabId = null, capturing = false;

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'START_CAPTURE') {
    handleStartCapture(msg.tabId, msg.sensitivity).then(() => sendResponse({ ok: true })).catch(e => sendResponse({ ok: false, error: e.message }));
    return true;
  }
  if (msg.type === 'STOP_CAPTURE') { stopCapture(msg.tabId); sendResponse({ ok: true }); }
  if (msg.type === 'APPLY_GAIN') {
    if (captureTabId) {
      chrome.tabs.sendMessage(captureTabId, { type: 'SET_GAIN', gain: msg.gain, loudness: msg.loudness, scene: msg.scene }).catch(() => {});
    }
  }
  if (msg.type === 'GET_STATS') {
    forwardToOffscreen({ type: 'GET_STATS' }).then(s => sendResponse(s || {})).catch(() => sendResponse({}));
    return true;
  }
  if (msg.type === 'SET_SENSITIVITY') { forwardToOffscreen({ type: 'SET_SENSITIVITY', value: msg.value }).catch(() => {}); }
  if (msg.type === 'LOCK_COMFORT') {
    forwardToOffscreen({ type: 'LOCK_COMFORT' }).then(r => sendResponse(r)).catch(() => sendResponse({ ok: false }));
    return true;
  }
  if (msg.type === 'UNLOCK_COMFORT') {
    forwardToOffscreen({ type: 'UNLOCK_COMFORT' }).then(r => sendResponse(r)).catch(() => sendResponse({ ok: false }));
    return true;
  }
});

async function handleStartCapture(tabId, sensitivity) {
  if (capturing) stopCapture(captureTabId);
  captureTabId = tabId;
  await ensureOffscreen();
  const streamId = await new Promise((resolve, reject) => {
    chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }, id => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      resolve(id);
    });
  });
  await forwardToOffscreen({ type: 'START_ANALYSIS', streamId, sensitivity });
  capturing = true;
  chrome.action.setBadgeText({ text: 'ON', tabId });
  chrome.action.setBadgeBackgroundColor({ color: '#00e5b0' });
}

function stopCapture(tabId) {
  forwardToOffscreen({ type: 'STOP_ANALYSIS' }).catch(() => {});
  capturing = false; captureTabId = null;
  if (tabId) {
    chrome.action.setBadgeText({ text: '', tabId });
    chrome.tabs.sendMessage(tabId, { type: 'SET_GAIN', gain: 1.0 }).catch(() => {});
  }
}

async function ensureOffscreen() {
  if (offscreenReady) return;
  const existing = await chrome.offscreen.hasDocument();
  if (!existing) {
    await chrome.offscreen.createDocument({ url: 'offscreen.html', reasons: ['USER_MEDIA'], justification: 'Capture and analyse tab audio for volume regulation' });
  }
  offscreenReady = true;
}

function forwardToOffscreen(msg) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ ...msg, _target: 'offscreen' }, resp => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      resolve(resp);
    });
  });
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({ enabled: false, sensitivity: 0.5, comfortLocked: false });
});
