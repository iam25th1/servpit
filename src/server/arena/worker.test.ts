// What the loop does when a round goes wrong, when the money runs low, and
// when an operator wants it to stop.
//
// The round itself is injected here. Whether a round plays correctly is
// covered by the round's own tests and by the worker running against the fake
// chain; what is being checked here is that nothing a round does can stop the
// pit, and that it knows when not to start one.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ArenaStore } from "./state";
import { fundsCheck, runArenaLoop } from "./worker";
import type { ServerContext } from "../context";

let dir: string;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

const store = (): { store: ArenaStore; dir: string } => {
  dir = mkdtempSync(join(tmpdir(), "servpit-arena-loop-"));
  return { store: new ArenaStore(join(dir, "arena.json"), "fake"), dir };
};

/** Only the parts of a context the loop touches. */
const context = (options: { potWei: bigint; reserveWei?: bigint; carriedWei?: bigint; bankWei?: bigint }): ServerContext => {
  const balances: Record<string, bigint> = { pot: options.potWei, bank: options.bankWei ?? 0n };
  return {
    chain: { gasReserveWei: options.reserveWei ?? 0n },
    wallets: { pot: { id: "pot" }, bank: options.bankWei === undefined ? undefined : { id: "bank" } },
    bankroll: { get: async (wallet: { id: string }) => balances[wallet.id] ?? 0n },
    flow: { rollover: { carriedWei: options.carriedWei ?? 0n } },
  } as unknown as ServerContext;
};

/** A loop that stops itself, so a test never waits on a clock. */
const bounded = (rounds: number) => {
  let left = rounds;
  return () => left-- > 0;
};

describe("a round that goes wrong", () => {
  it("is recorded with its reason, and the next one still runs", async () => {
    const { store: arena, dir: data } = store();
    let round = 0;
    const counts = await runArenaLoop({
      ctx: context({ potWei: 100n }),
      store: arena,
      pauseFile: join(data, "nope"),
      intervalMs: 0,
      maxRounds: 2,
      sleep: async () => undefined,
      running: bounded(4),
      play: async (_ctx, s, nextAt) => {
        round += 1;
        if (round === 1) throw new Error("the chain did not answer");
        s.write({
          round: { roundId: "r-2", startedAt: "", phase: "result", phases: [{ phase: "result", at: "" }], network: "fake", backend: "fake", entrants: 24, bots: 20, stakeChips: 10, weiPerChip: "1", decisions: [], loans: [], refusals: [], bank: null, entries: [] },
          last: null,
          paused: false,
          nextRoundAt: new Date(nextAt).toISOString(),
        });
      },
    });

    expect(counts).toEqual({ played: 1, failed: 1, rested: 0 });
    // The second round is what is on file, so the failure did not stop the pit.
    expect(arena.read().round?.roundId).toBe("r-2");
  });

  it("says what went wrong in the round it failed", async () => {
    const { store: arena, dir: data } = store();
    arena.write({
      round: { roundId: "r-1", startedAt: "", phase: "settling", phases: [{ phase: "settling", at: "" }], network: "fake", backend: "fake", entrants: 24, bots: 20, stakeChips: 10, weiPerChip: "1", decisions: [], loans: [], refusals: [], bank: null, entries: [] },
      last: null,
      paused: false,
      nextRoundAt: null,
    });
    await runArenaLoop({
      ctx: context({ potWei: 100n }),
      store: arena,
      pauseFile: join(data, "nope"),
      intervalMs: 0,
      maxRounds: 1,
      sleep: async () => undefined,
      running: bounded(2),
      play: async () => {
        throw new Error("insufficient balance: 1 wei < 2 wei");
      },
    });

    const round = arena.read().round!;
    expect(round.phase).toBe("failed");
    expect(round.phases.at(-1)).toMatchObject({ phase: "failed", reason: "insufficient balance: 1 wei < 2 wei" });
  });
});

describe("resting rather than overspending", () => {
  it("does not start a round the pot could not pay out", async () => {
    const { store: arena, dir: data } = store();
    let played = 0;
    const counts = await runArenaLoop({
      // Gas reserve of 10, and the pot holds 5.
      ctx: context({ potWei: 5n, reserveWei: 10n }),
      store: arena,
      pauseFile: join(data, "nope"),
      intervalMs: 0,
      maxRounds: 1,
      sleep: async () => undefined,
      running: bounded(2),
      play: async () => {
        played += 1;
      },
    });

    expect(played).toBe(0);
    expect(counts.rested).toBe(1);
    expect(arena.read().paused).toBe(false);
  });

  it("rests when the pot holds less than the prize it is carrying", async () => {
    const check = await fundsCheck(context({ potWei: 50n, reserveWei: 10n, carriedWei: 100n }));
    expect(check.ok).toBe(false);
    if (check.ok) return;
    expect(check.reason).toMatch(/less than the prize it carries/);
  });

  it("plays on an empty bank, because that is a lender saying no rather than a round that cannot finish", async () => {
    const check = await fundsCheck(context({ potWei: 500n, reserveWei: 10n, carriedWei: 0n, bankWei: 0n }));
    expect(check.ok).toBe(true);
  });
});

describe("the kill switch", () => {
  it("pauses the loop while the file is there, without a restart", async () => {
    const { store: arena, dir: data } = store();
    const pauseFile = join(data, "arena-paused");
    writeFileSync(pauseFile, "");
    let played = 0;
    const counts = await runArenaLoop({
      ctx: context({ potWei: 100n }),
      store: arena,
      pauseFile,
      intervalMs: 0,
      maxRounds: 1,
      sleep: async () => undefined,
      running: bounded(2),
      play: async () => {
        played += 1;
      },
    });

    expect(played).toBe(0);
    expect(counts.rested).toBe(1);
    const state = arena.read();
    expect(state.paused).toBe(true);
  });

  it("starts playing again once the file is gone, in the same process", async () => {
    const { store: arena, dir: data } = store();
    const pauseFile = join(data, "arena-paused");
    writeFileSync(pauseFile, "");
    let played = 0;
    let round = 0;
    await runArenaLoop({
      ctx: context({ potWei: 100n }),
      store: arena,
      pauseFile,
      intervalMs: 0,
      maxRounds: 2,
      sleep: async () => undefined,
      running: bounded(4),
      // The operator deletes the file between intervals, which is the whole
      // point of it being a file and not an environment variable.
      beat: () => {
        round += 1;
        if (round === 2) rmSync(pauseFile, { force: true });
      },
      play: async () => {
        played += 1;
      },
    });

    expect(played).toBe(1);
  });

  it("stops saying it is paused the moment it plays again", async () => {
    // The flag went into the state once, on the rest that paused the pit, and
    // every later write carried it forward. So a resumed pit ran rounds under
    // a state that still read paused, and anything reading the state, the
    // health line and the badge in the header, said the pit was stopped while
    // it was playing.
    const { store: arena, dir: data } = store();
    const pauseFile = join(data, "arena-paused");
    writeFileSync(pauseFile, "");
    let round = 0;
    await runArenaLoop({
      ctx: context({ potWei: 100n }),
      store: arena,
      pauseFile,
      intervalMs: 0,
      maxRounds: 2,
      sleep: async () => undefined,
      running: bounded(4),
      beat: () => {
        round += 1;
        if (round === 2) rmSync(pauseFile, { force: true });
      },
      // A round writes the state the way the real one does, carrying whatever
      // the state already said about the pause.
      play: async (_ctx, s, nextAt) => {
        const current = s.read();
        s.write({ round: current.round, last: current.last, paused: current.paused, nextRoundAt: new Date(nextAt).toISOString() });
      },
    });

    expect(arena.read().paused).toBe(false);
  });
});
