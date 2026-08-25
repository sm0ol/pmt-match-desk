// Reddit auto-removes posts that link to certain hosts or mention certain
// gambling brands. These rules come from the Post-Match Team lead:
// - never link VK or Telegram
// - never link any .ru host (an official site is often one)
// - never emit anything containing "bc.game" or "bcgame"; the string alone
//   can get a post removed, so such teams get no links at all

const BLOCKED_HOSTS = ["vk.com", "vk.ru", "t.me", "telegram.me", "telegram.org", "telegram.dog"];
const BLOCKED_HOST_SUFFIXES = [".ru"];
const BLOCKED_TERMS = ["bc.game", "bcgame"];

/** True when the text contains a brand term that alone risks auto-removal. */
export function containsBlockedTerm(text: string): boolean {
  const lowered = text.toLocaleLowerCase();
  return BLOCKED_TERMS.some((term) => lowered.includes(term));
}

/** True when a URL is safe to include in a Reddit post. */
export function isSafeRedditLink(url: string): boolean {
  if (containsBlockedTerm(url)) return false;
  let hostname: string;
  try {
    hostname = new URL(url).hostname.toLocaleLowerCase();
  } catch {
    return false;
  }
  if (BLOCKED_HOSTS.some((host) => hostname === host || hostname.endsWith(`.${host}`))) {
    return false;
  }
  return !BLOCKED_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix));
}
