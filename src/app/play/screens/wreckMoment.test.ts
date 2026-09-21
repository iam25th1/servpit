import { describe, expect, it } from "vitest";
import { wreckMoments, type ReplacementShape, type WreckShape } from "./wreckMoment";

const per = 1_000_000_000_000n;
const chips = (n: number): string => (BigInt(n) * per).toString();

const wreck = (extra: Partial<WreckShape> = {}): WreckShape => ({
  walletId: "flint",
  name: "Flint",
  face: null,
  trigger: "broke and denied credit",
  overReached: false,
  debtAtDeathWei: chips(0),
  seizedWei: chips(0),
  writtenOffWei: chips(0),
  peakBalanceWei: chips(140),
  borrowedWei: chips(0),
  roundsSurvived: 6,
  wins: 1,
  ...extra,
});

const heir = (extra: Partial<ReplacementShape> = {}): ReplacementShape => ({
  walletId: "flint",
  name: "Onyx",
  face: "NinjaDark",
  arrival: "I watched that happen. I do not intend to be next.",
  fundedWei: chips(100),
  ...extra,
});

describe("wreckMoments", () => {
  it("names the agent and reads its cause the way the graveyard will", () => {
    const [m] = wreckMoments([wreck()], [], per);
    expect(m.name).toBe("Flint");
    expect(m.cause).toBe("ran out of credit");
    expect(wreckMoments([wreck({ overReached: true })], [], per)[0].cause).toBe("over-reached");
  });

  it("carries the face it wore, so the screen does not have to guess", () => {
    expect(wreckMoments([wreck({ face: "NinjaFire" })], [], per)[0].face).toBe("NinjaFire");
    expect(wreckMoments([wreck()], [], per)[0].face).toBeNull();
  });

  it("says how long it lasted and what it ever won, in plain language", () => {
    const [m] = wreckMoments([wreck({ roundsSurvived: 6, wins: 1, peakBalanceWei: chips(140) })], [], per);
    expect(m.life).toBe("6 rounds, 1 win, 140 chips at its best.");
  });

  it("counts a single round and no wins without leaving a stray plural", () => {
    const [m] = wreckMoments([wreck({ roundsSurvived: 1, wins: 0 })], [], per);
    expect(m.life).toBe("1 round, no wins, 140 chips at its best.");
  });

  it("says what Marrow took and what it could not take", () => {
    const [m] = wreckMoments([wreck({ seizedWei: chips(3), writtenOffWei: chips(12), debtAtDeathWei: chips(15) })], [], per);
    expect(m.toll).toBe("Marrow took the 3 chips it had left and wrote off 12.");
  });

  it("says nothing about Marrow when it owed nothing", () => {
    expect(wreckMoments([wreck()], [], per)[0].toll).toBeNull();
  });

  it("puts the whole debt against Marrow when there was nothing left to take", () => {
    const [m] = wreckMoments([wreck({ seizedWei: chips(0), writtenOffWei: chips(15), debtAtDeathWei: chips(15) })], [], per);
    expect(m.toll).toBe("It had nothing left, so Marrow wrote off all 15.");
  });

  it("hands the seat to whoever takes it, and lets them speak", () => {
    const [m] = wreckMoments([wreck()], [heir()], per);
    expect(m.heir?.name).toBe("Onyx");
    expect(m.heir?.face).toBe("NinjaDark");
    expect(m.heir?.arrival).toBe("I watched that happen. I do not intend to be next.");
    expect(m.heir?.staked).toBe("Onyx sits down with 100 chips from the operator.");
  });

  it("matches an heir to its own seat and never to somebody else's", () => {
    const [m] = wreckMoments([wreck({ walletId: "flint" })], [heir({ walletId: "ember", name: "Vex" })], per);
    expect(m.heir).toBeNull();
  });

  it("says the seat stayed empty when the operator had nothing to stake it with", () => {
    const [m] = wreckMoments([wreck()], [heir({ fundedWei: chips(0) })], per);
    expect(m.heir?.staked).toBe("Onyx sits down with nothing. The operator had none to give.");
  });

  it("gives one moment per wreck, in the order the round reported them", () => {
    const moments = wreckMoments([wreck({ walletId: "flint", name: "Flint" }), wreck({ walletId: "ember", name: "Ember" })], [], per);
    expect(moments.map((m) => m.name)).toEqual(["Flint", "Ember"]);
  });
});
