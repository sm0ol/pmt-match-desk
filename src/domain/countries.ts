// HLTV flag images carry a code in their src, e.g. /img/static/flags/30x20/DK.gif
// or /img/static/flags/300x200/EU.png. The code is stored on teams and players;
// this module turns it into an emoji flag for the rendered post.

const SPECIAL_FLAGS: Record<string, string> = {
  WORLD: "🌍",
  CIS: "🌍",
  "GB-ENG": "🏴󠁧󠁢󠁥󠁮󠁧󠁿",
  "GB-SCT": "🏴󠁧󠁢󠁳󠁣󠁴󠁿",
  "GB-WLS": "🏴󠁧󠁢󠁷󠁬󠁳󠁿",
};

const REGIONAL_INDICATOR_OFFSET = 0x1f1e6 - "A".charCodeAt(0);

export function flagEmoji(code: string | undefined): string | null {
  const normalized = code?.trim().toUpperCase() ?? "";
  if (!normalized) return null;
  if (SPECIAL_FLAGS[normalized]) return SPECIAL_FLAGS[normalized];
  if (!/^[A-Z]{2}$/.test(normalized)) return null;
  return String.fromCodePoint(
    ...[...normalized].map((letter) => letter.charCodeAt(0) + REGIONAL_INDICATOR_OFFSET),
  );
}
