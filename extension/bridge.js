// Runs on the PMT Match Desk app. Forwards capture batches from the
// background worker into the page and waits for the app to acknowledge.
// The app only acknowledges once it has hydrated and attached its listener,
// so the bridge re-posts until then.

let batchCounter = 0;

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.type !== "pmt-deliver" || !Array.isArray(message.captures)) {
    return false;
  }
  batchCounter += 1;
  const batchId = `pmt-batch-${Date.now()}-${batchCounter}`;
  const payload = {
    source: "pmt-match-desk-extension",
    kind: "capture-batch",
    batchId,
    captures: message.captures.map((capture) => ({
      plain: capture && typeof capture.plain === "string" ? capture.plain : "",
      html: capture && typeof capture.html === "string" ? capture.html : "",
    })),
  };

  let attempts = 0;
  const MAX_ATTEMPTS = 30;
  const finish = (ok) => {
    clearInterval(timer);
    window.removeEventListener("message", onAck);
    sendResponse({ ok, batchId });
  };
  const onAck = (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (
      data &&
      data.source === "pmt-match-desk-app" &&
      data.kind === "batch-received" &&
      data.batchId === batchId
    ) {
      finish(true);
    }
  };
  const post = () => {
    attempts += 1;
    if (attempts > MAX_ATTEMPTS) {
      finish(false);
      return;
    }
    window.postMessage(payload, window.location.origin);
  };

  window.addEventListener("message", onAck);
  const timer = setInterval(post, 700);
  post();
  return true; // sendResponse is called asynchronously
});
