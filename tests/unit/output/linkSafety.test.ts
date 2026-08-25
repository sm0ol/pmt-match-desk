import { describe, expect, it } from "vitest";
import { containsBlockedTerm, isSafeRedditLink } from "../../../src/output/linkSafety";

describe("linkSafety", () => {
  it("blocks VK and Telegram links", () => {
    expect(isSafeRedditLink("https://vk.com/betboom")).toBe(false);
    expect(isSafeRedditLink("https://m.vk.com/betboom")).toBe(false);
    expect(isSafeRedditLink("https://t.me/somechannel")).toBe(false);
    expect(isSafeRedditLink("https://telegram.me/somechannel")).toBe(false);
  });

  it("blocks any .ru host", () => {
    expect(isSafeRedditLink("https://betboom.ru")).toBe(false);
    expect(isSafeRedditLink("https://www.example.ru/team")).toBe(false);
    expect(isSafeRedditLink("https://example.com/page.ru.html")).toBe(true);
  });

  it("blocks anything containing gambling brand terms", () => {
    expect(isSafeRedditLink("https://bc.game/esports")).toBe(false);
    expect(isSafeRedditLink("https://twitter.com/bcgame_cs")).toBe(false);
    expect(isSafeRedditLink("https://liquipedia.net/counterstrike/BC.Game")).toBe(false);
    expect(containsBlockedTerm("BC.Game")).toBe(true);
    expect(containsBlockedTerm("BCGAME")).toBe(true);
    expect(containsBlockedTerm("FURIA")).toBe(false);
  });

  it("allows normal links and rejects garbage", () => {
    expect(isSafeRedditLink("https://liquipedia.net/counterstrike/FURIA_Esports")).toBe(true);
    expect(isSafeRedditLink("https://www.hltv.org/team/8297/furia")).toBe(true);
    expect(isSafeRedditLink("https://www.twitch.tv/blastpremier")).toBe(true);
    expect(isSafeRedditLink("not a url")).toBe(false);
  });
});
