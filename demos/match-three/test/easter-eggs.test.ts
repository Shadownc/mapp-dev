import { describe, expect, test } from "bun:test";
import { createSecretTap, isLastMoveWin, restoreEggs, unlockCampaign } from "../src/easter-eggs.ts";
import { getLevel } from "../src/levels.ts";

const enabled = { enabled: true, secretTheme: true, lastMove: true, campaignEnding: true };
describe("cosmetic easter eggs", () => {
  test("seven taps unlock, long pauses reset, a completed sequence starts over", () => {
    const tap = createSecretTap();
    for (let i = 0; i < 6; i++) expect(tap(i * 100)).toBe(false);
    expect(tap(2500)).toBe(false);
    for (let i = 1; i < 6; i++) expect(tap(2500 + i * 100)).toBe(false);
    expect(tap(3100)).toBe(true);
    expect(tap(3200)).toBe(false);
  });
  test("last-step victory requires both a win and exactly zero remaining moves", () => {
    for (let level = 1; level <= 7; level++) {
      const moves = getLevel(level).moves;
      expect(isLastMoveWin({ level, moves, won: true })).toBe(true);
      expect(isLastMoveWin({ level, moves, won: false })).toBe(false);
      expect(isLastMoveWin({ level, moves: moves - 1, won: true })).toBe(false);
    }
  });
  test("campaign reward is persistent, once only and honors its switch", () => {
    const state = restoreEggs(null);
    expect(unlockCampaign(state, enabled, 6)).toBe(false);
    expect(unlockCampaign(state, { ...enabled, enabled: false }, 7)).toBe(false);
    expect(unlockCampaign(state, { ...enabled, campaignEnding: false }, 7)).toBe(false);
    expect(unlockCampaign(state, enabled, 7)).toBe(true);
    expect(state.endingPending).toBe(true);
    const loaded = restoreEggs(JSON.parse(JSON.stringify(state)));
    expect(loaded).toEqual(state);
    loaded.endingPending = false;
    expect(unlockCampaign(loaded, enabled, 7)).toBe(false);
    expect(loaded.endingPending).toBe(false);
  });
  test("malformed cosmetic saves cannot activate locked rewards", () => {
    const empty = restoreEggs(null);
    expect(restoreEggs({ themeUnlocked: true, themeActive: true })).toEqual(empty);
    expect(restoreEggs({ format: 1, themeActive: true, endingPending: true })).toEqual(empty);
    expect(restoreEggs({ format: 1, themeUnlocked: "true", campaignUnlocked: 1 })).toEqual(empty);
    expect(restoreEggs({ format: 1, themeUnlocked: true, themeActive: true }).themeActive).toBe(true);
  });
});
