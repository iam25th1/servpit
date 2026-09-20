import { describe, expect, it } from "vitest";
import { pickPlayerDraw, type RunReel } from "./reelPick";

const reels: RunReel[] = [
  { entrantId: "agent-atlas", symbols: ["Knight", "Monk", "Bear"], characterId: "Knight", tier: "common", combo: "none", bonusPct: 0 },
  { entrantId: "bot-00", symbols: ["Boy", "Boy", "Boy"], characterId: "Boy", tier: "common", combo: "threeOfAKind", bonusPct: 60 },
  { entrantId: "agent-blaze", symbols: ["Bear", "Bear", "Monk"], characterId: "Bear", tier: "rare", combo: "pair", bonusPct: 10 },
];

describe("pickPlayerDraw", () => {
  it("shows the draw of the first agent seat, since agents are who the player is backing", () => {
    expect(pickPlayerDraw(reels)?.entrantId).toBe("agent-atlas");
  });

  it("falls back to the first seat when no agent entered", () => {
    expect(pickPlayerDraw(reels.filter((r) => r.entrantId.startsWith("bot")))?.entrantId).toBe("bot-00");
  });

  it("returns null for an empty field rather than inventing a draw", () => {
    expect(pickPlayerDraw([])).toBeNull();
  });

  it("keeps the real symbols and combination, never a fabricated one", () => {
    const draw = pickPlayerDraw(reels)!;
    expect(draw.symbols).toEqual(["Knight", "Monk", "Bear"]);
    expect(draw.combo).toBe("none");
  });
});
