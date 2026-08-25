// Runs on HLTV match and map-stats pages. Answers capture requests from the
// background worker with the same dual payload a Ctrl+A / Ctrl+C produces:
// the page text and the page HTML.

// The app's parser rejects oversized input, so stay inside its budgets.
const MAX_PLAIN_CHARS = 119000;
const MAX_HTML_CHARS = 2900000;

function buildCapture() {
  const clone = document.body.cloneNode(true);
  for (const element of clone.querySelectorAll(
    "script, noscript, style, iframe, canvas, video, audio, link, template",
  )) {
    element.remove();
  }
  let html = clone.outerHTML;
  if (html.length > MAX_HTML_CHARS) {
    for (const element of clone.querySelectorAll("[style]")) element.removeAttribute("style");
    html = clone.outerHTML.slice(0, MAX_HTML_CHARS);
  }
  const statsLinks = [
    ...new Set(
      [...document.querySelectorAll('a[href*="/stats/matches/mapstatsid/"]')].map(
        (anchor) => anchor.href,
      ),
    ),
  ];
  return {
    plain: document.body.innerText.slice(0, MAX_PLAIN_CHARS),
    html,
    url: location.href,
    statsLinks,
  };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message && message.type === "pmt-capture") {
    sendResponse(buildCapture());
  }
  return false;
});
