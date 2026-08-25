// Runs on the PMT Match Desk app. Forwards capture batches from the
// background worker into the page and waits for the app to acknowledge.
// The app only acknowledges once it has hydrated and attached its listener,
// so the bridge re-posts until then.

let batchCounter = 0;

// The app announces a Reddit post; the background worker keeps it for the
// submit-page filler.
window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  const data = event.data;
  if (!data || data.source !== "pmt-match-desk-app" || data.kind !== "reddit-post") return;
  chrome.runtime
    .sendMessage({
      type: "pmt-reddit-post",
      post: {
        subreddit: typeof data.subreddit === "string" ? data.subreddit : "",
        title: typeof data.title === "string" ? data.title : "",
        body: typeof data.body === "string" ? data.body : "",
        at: Date.now(),
      },
    })
    .catch(() => {
      // The background worker is unavailable; the clipboard fallback covers it.
    });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message && message.type === "pmt-progress" && Array.isArray(message.steps)) {
    window.postMessage(
      { source: "pmt-match-desk-extension", kind: "capture-progress", steps: message.steps },
      window.location.origin,
    );
    sendResponse({ ok: true });
    return false;
  }
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
      matchUrl: capture && typeof capture.matchUrl === "string" ? capture.matchUrl : "",
    })),
  };

  let attempts = 0;
  let received = false;
  const MAX_ATTEMPTS = 30;
  const RESULT_TIMEOUT_MS = 45000;
  const finish = (result) => {
    clearInterval(timer);
    clearTimeout(deadline);
    window.removeEventListener("message", onAck);
    sendResponse({ batchId, ...result });
  };
  const onAck = (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== "pmt-match-desk-app" || data.batchId !== batchId) return;
    if (data.kind === "batch-received") {
      received = true;
      clearInterval(timer);
      return;
    }
    if (data.kind === "batch-imported") {
      finish({
        ok: true,
        imported: data.ok !== false,
        message: typeof data.message === "string" ? data.message : "",
      });
    }
  };
  const post = () => {
    attempts += 1;
    if (attempts > MAX_ATTEMPTS) {
      finish({ ok: false, imported: false, message: "" });
      return;
    }
    window.postMessage(payload, window.location.origin);
  };

  window.addEventListener("message", onAck);
  const timer = setInterval(post, 700);
  // If the import result never arrives (for example an open dialog is
  // blocking the queue), report delivery without an outcome.
  const deadline = setTimeout(() => {
    finish(received ? { ok: true, imported: null, message: "" } : { ok: false, imported: false, message: "" });
  }, RESULT_TIMEOUT_MS);
  post();
  return true; // sendResponse is called asynchronously
});
