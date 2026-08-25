const MATCH_PATH = /^\/matches\/(\d+)\/([a-z0-9](?:[a-z0-9-]*[a-z0-9])?)\/?$/;

export function canonicalHltvMatchUrl(value: string): string | null {
  if (!value) return null;
  try {
    const url = new URL(value, "https://www.hltv.org");
    if (
      url.protocol !== "https:" ||
      url.hostname !== "www.hltv.org" ||
      url.username ||
      url.password ||
      url.port ||
      url.search ||
      url.hash
    ) {
      return null;
    }
    const match = url.pathname.match(MATCH_PATH);
    if (!match) return null;
    return `https://www.hltv.org/matches/${match[1]}/${match[2]}`;
  } catch {
    return null;
  }
}
