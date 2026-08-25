// Runs on the PMT Match Desk app. Forwards captures from the background
// worker into the page, where the app imports them like a paste.

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message && message.type === "pmt-deliver" && Array.isArray(message.captures)) {
    for (const capture of message.captures) {
      window.postMessage(
        {
          source: "pmt-match-desk-extension",
          kind: "hltv-capture",
          plain: typeof capture.plain === "string" ? capture.plain : "",
          html: typeof capture.html === "string" ? capture.html : "",
        },
        window.location.origin,
      );
    }
    sendResponse({ ok: true, delivered: message.captures.length });
  }
  return false;
});
