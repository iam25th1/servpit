import { describe, expect, it } from "vitest";
import { hasSeenOnboarding, markOnboardingSeen, onboardingScreens, ONBOARDING_KEY, type StorageLike } from "./onboarding";
import { memoryStore } from "./backerId";

/** A browser that refuses site data, which throws rather than returning null. */
const refusing = (): StorageLike => ({
  getItem: () => {
    throw new Error("The operation is insecure.");
  },
  setItem: () => {
    throw new Error("The operation is insecure.");
  },
});

describe("what a first time visitor is told", () => {
  it("is a few screens, not a manual", () => {
    expect(onboardingScreens(true)).toHaveLength(6);
    expect(onboardingScreens(false)).toHaveLength(5);
    for (const screen of onboardingScreens(true)) {
      expect(screen.title.length).toBeLessThan(28);
      expect(screen.lines.length).toBeLessThanOrEqual(2);
    }
  });

  it("covers the agents, the lender, the fight and the chain in both modes", () => {
    for (const arena of [true, false]) {
      const text = onboardingScreens(arena)
        .flatMap((s) => [s.title, ...s.lines])
        .join(" ")
        .toLowerCase();
      expect(text).toContain("wallets");
      expect(text).toContain("serv");
      expect(text).toContain("marrow");
      expect(text).toContain("graveyard");
      expect(text).toContain("reels");
      expect(text).toContain("pot");
      expect(text).toContain("base sepolia");
    }
  });

  it("offers backing and the replay only where they exist", () => {
    const arena = onboardingScreens(true).flatMap((s) => s.lines).join(" ");
    const lever = onboardingScreens(false).flatMap((s) => s.lines).join(" ");
    expect(arena).toMatch(/back one agent/i);
    expect(arena).toMatch(/watch the last one again/i);
    // In lever mode the plan route hands out the seed, so a pick would be a
    // pick on a known result. Nothing here offers one.
    expect(lever).not.toMatch(/back one agent|points/i);
  });

  it("says the house pulls the lever in arena mode and the player does in lever mode", () => {
    expect(onboardingScreens(true).flatMap((s) => s.lines).join(" ")).toMatch(/The house pulls the lever/);
    expect(onboardingScreens(false).flatMap((s) => s.lines).join(" ")).toMatch(/You pull the lever/);
  });

  it("says plainly that points are not money and that the network is a testnet", () => {
    const arena = onboardingScreens(true).flatMap((s) => s.lines).join(" ");
    expect(arena).toMatch(/Points only, never money/);
    expect(arena).toMatch(/not worth anything/);
  });

  it("is written in plain punctuation, like every other line a player reads", () => {
    const dash = String.fromCharCode(0x2013, 0x2014);
    for (const arena of [true, false]) {
      for (const screen of onboardingScreens(arena)) {
        for (const line of [screen.title, ...screen.lines]) {
          expect(new RegExp(`[${dash}]`).test(line), line).toBe(false);
        }
      }
    }
  });
});

describe("remembering that it was read", () => {
  it("opens once and not every visit", () => {
    const store = memoryStore();
    expect(hasSeenOnboarding(store)).toBe(false);
    markOnboardingSeen(store);
    expect(store.getItem(ONBOARDING_KEY)).toBe("true");
    expect(hasSeenOnboarding(store)).toBe(true);
  });

  it("shows it rather than swallowing it in a browser that refuses site data", () => {
    const store = refusing();
    expect(hasSeenOnboarding(store)).toBe(false);
    expect(() => markOnboardingSeen(store)).not.toThrow();
    expect(hasSeenOnboarding(store)).toBe(false);
  });
});
