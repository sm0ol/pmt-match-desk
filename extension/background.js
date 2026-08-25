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
  // The bridge resolves with the import outcome once the app reports it.
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      const response = await chrome.tabs.sendMessage(tabId, { type: "pmt-deliver", captures });
      if (response && response.ok) return response;
      return null;
    } catch {
      await sleep(500);
    }
  }
  return null;
}

async function ensureAppTab(sourceWindowId) {
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
  return appTab;
}

async function deliverBatch(appTab, captures, allowRecovery) {
  const response = await tryDeliver(appTab.id, captures);
  if (response) return response;
  if (!allowRecovery) return null;
  // No acknowledgment: the tab predates the extension install or runs an old
  // app bundle without the listener. Reload it and try once more.
  await chrome.tabs.reload(appTab.id);
  await waitForComplete(appTab.id, 30000);
  await sleep(500);
  return tryDeliver(appTab.id, captures);
}

function applyOutcome(step, response) {
  if (response && response.imported !== false) {
    step.status = "done";
    return true;
  }
  step.status = "failed";
  if (response && response.message) step.detail = String(response.message).slice(0, 80);
  return false;
}

function sendProgress(tabId, steps) {
  chrome.tabs
    .sendMessage(tabId, { type: "pmt-progress", steps: steps.map((step) => ({ ...step })) })
    .catch(() => { /* the desk is not listening yet; later updates will land */ });
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
    await ensureAppTab(tab.windowId).catch(() => {
      chrome.tabs.create({ url: APP_HOME, active: true });
    });
    return;
  }
  try {
    await setBadge("…", "#3b82f6");
    const main = await requestCapture(tab.id);
    const isMatchPage = /^https:\/\/www\.hltv\.org\/matches\/\d+\//.test(tab.url);
    const statsLinks = (main.statsLinks || [])
      .slice(0, MAX_STATS_PAGES)
      .map((link, index) =>
        typeof link === "string"
          ? { url: link, label: `Map ${index + 1} stats` }
          : { url: link.url, label: link.name ? `${link.name} stats` : `Map ${index + 1} stats` },
      );

    // The desk opens immediately; the match page arrives first and the maps
    // fill in one by one, with a progress panel narrating each step.
    const steps = [
      { label: isMatchPage ? "Match page" : "Map stats page", status: "active" },
      ...(isMatchPage ? statsLinks.map((link) => ({ label: link.label, status: "pending" })) : []),
    ];
    const appTab = await ensureAppTab(tab.windowId);
    sendProgress(appTab.id, steps);
    const mainResponse = await deliverBatch(appTab, [main], true);
    const mainImported = applyOutcome(steps[0], mainResponse);
    sendProgress(appTab.id, steps);
    if (!mainResponse) throw new Error("The Match Desk tab did not accept the capture.");

    let deliveredCount = mainImported ? 1 : 0;
    if (isMatchPage) {
      for (const [index, link] of statsLinks.entries()) {
        const step = steps[index + 1];
        step.status = "active";
        sendProgress(appTab.id, steps);
        try {
          const capture = await captureStatsPage(link.url);
          // Stats captures carry the match page they belong to, so the desk
          // can anchor them even when the stats page has no match link.
          capture.matchUrl = tab.url;
          if (applyOutcome(step, await deliverBatch(appTab, [capture], false))) deliveredCount += 1;
        } catch {
          // A stats page that fails to load or answer is skipped; the desk
          // shows which maps still need stats.
          step.status = "failed";
        }
        sendProgress(appTab.id, steps);
      }
    }
    await setBadge(String(deliveredCount), "#059669");
  } catch {
    await setBadge("!", "#dc2626");
  }
});
