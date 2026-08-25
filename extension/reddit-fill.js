// Runs on old.reddit.com. On a submit page, fills the post body (and the
// title if the URL prefill was dropped) from the post the desk announced.
// The URL carries the title itself; the body usually exceeds the URI limit.

(async () => {
  if (!/\/submit\/?$/.test(location.pathname)) return;
  let response;
  try {
    response = await chrome.runtime.sendMessage({ type: "pmt-get-reddit-post" });
  } catch {
    return;
  }
  const post = response && response.post;
  const MAX_AGE_MS = 10 * 60 * 1000;
  if (!post || !post.body || Date.now() - post.at > MAX_AGE_MS) return;

  const titleField = document.querySelector("[name='title']");
  if (titleField && !titleField.value && post.title) {
    titleField.value = post.title;
    titleField.dispatchEvent(new Event("input", { bubbles: true }));
  }
  const textarea = document.querySelector("textarea[name='text']");
  if (textarea && !textarea.value) {
    textarea.value = post.body;
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  }
})();
