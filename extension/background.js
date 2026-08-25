// Orchestrates the one-click flow: capture the current HLTV page, capture
// each finished map's stats page in a background tab, then deliver all
// captures to the PMT Match Desk tab.

const APP_HOME = "https://pmt-production-4bee.up.railway.app/";
const APP_URL_PATTERNS = [
  "https://pmt-production-4bee.up.railway.app/*",
  "http://localhost:5173/*",
  "http://localhost:4173/*",
  "http://127.0.0.1:5173/*",
  "http://127.0.0.1:4173/*",
];
const HLTV_PAGE = /^https:\/\/www\.hltv\.org\/(matches\/\d+\/|stats\/matches\/)/;
const MAX_STATS_PAGES = 5;
const STATS_PAGE_SETTLE_MS = 1500;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitForComplete(tabId, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error("Tab did not finish loading."));
    }, timeoutMs);
    const listener = (id, info) => {
      if (id === tabId && info.status === "complete") {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.get(tabId).then((tab) => {
      if (tab.status === "complete") {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }).catch(() => { /* resolved or rejected by the listener path */ });
  });
}

function requestCapture(tabId) {
  return chrome.tabs.sendMessage(tabId, { type: "pmt-capture" });
}

async function captureStatsPage(url) {
  const tab = await chrome.tabs.create({ url, active: false });
  try {
    await waitForComplete(tab.id, 20000);
    await sleep(STATS_PAGE_SETTLE_MS);
    return await requestCapture(tab.id);
  } finally {
    chrome.tabs.remove(tab.id).catch(() => { /* already closed */ });
  }
}

async function tryDeliver(tabId, captures) {
  // The bridge content script may not be ready yet; retry until it answers.
  // The bridge itself only reports ok once the app acknowledged the batch.
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      const response = await chrome.tabs.sendMessage(tabId, { type: "pmt-deliver", captures });
      return Boolean(response && response.ok);
    } catch {
      await sleep(500);
    }
  }
  return false;
}

async function deliverToApp(captures, sourceWindowId) {
  const openTabs = await chrome.tabs.query({ url: APP_URL_PATTERNS });
  // Prefer the production app over a local dev tab.
  let appTab =
    openTabs.find((candidate) => candidate.url && candidate.url.startsWith(APP_HOME)) ??
    openTabs[0];
  if (appTab) {
    await chrome.tabs.update(appTab.id, { active: true });
    await chrome.windows.update(appTab.windowId, { focused: true }).catch(() => {});
  } else {
    appTab = await chrome.tabs.create({ url: APP_HOME, active: true, windowId: sourceWindowId });
    await waitForComplete(appTab.id, 30000);
  }
  if (await tryDeliver(appTab.id, captures)) return;
  // No acknowledgment: the tab predates the extension install or runs an old
  // app bundle without the listener. Reload it and try once more.
  await chrome.tabs.reload(appTab.id);
  await waitForComplete(appTab.id, 30000);
  await sleep(500);
  if (await tryDeliver(appTab.id, captures)) return;
  throw new Error("The Match Desk tab did not accept the captures.");
}

async function setBadge(text, color) {
  await chrome.action.setBadgeBackgroundColor({ color });
  await chrome.action.setBadgeText({ text });
  setTimeout(() => {
    chrome.action.setBadgeText({ text: "" }).catch(() => {});
  }, 5000);
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message && message.type === "pmt-reddit-post" && message.post) {
    chrome.storage.session.set({ pendingRedditPost: message.post });
    sendResponse({ ok: true });
    return false;
  }
  if (message && message.type === "pmt-get-reddit-post") {
    chrome.storage.session
      .get("pendingRedditPost")
      .then((data) => sendResponse({ post: data.pendingRedditPost ?? null }))
      .catch(() => sendResponse({ post: null }));
    return true; // sendResponse is called asynchronously
  }
  return false;
});

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab || !tab.id || !tab.url) return;
  if (!HLTV_PAGE.test(tab.url)) {
    await deliverToApp([], tab.windowId).catch(() => {
      chrome.tabs.create({ url: APP_HOME, active: true });
    });
    return;
  }
  try {
    await setBadge("…", "#3b82f6");
    const main = await requestCapture(tab.id);
    const captures = [main];
    const isMatchPage = /^https:\/\/www\.hltv\.org\/matches\/\d+\//.test(tab.url);
    if (isMatchPage) {
      for (const link of (main.statsLinks || []).slice(0, MAX_STATS_PAGES)) {
        try {
          captures.push(await captureStatsPage(link));
        } catch {
          // A stats page that fails to load or answer is skipped; the app
          // shows which maps still need stats.
        }
      }
    }
    await deliverToApp(captures, tab.windowId);
    await setBadge(String(captures.length), "#059669");
  } catch {
    await setBadge("!", "#dc2626");
  }
});
