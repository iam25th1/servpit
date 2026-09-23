import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CLAIMABLE_FACES } from "@/config/fighters";
import { tokenHash } from "../backing/identity";
import { RateLimiter } from "../backing/limit";
import { FighterStore } from "./log";
import { claimFighter, fighterStatus } from "./service";

let dir: string;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

const TOKEN = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

const store = (): FighterStore => {
  dir = mkdtempSync(join(tmpdir(), "servpit-claim-"));
  return new FighterStore(join(dir, "fighters-fake.ndjson"), "fake");
};

const deps = (log: FighterStore, over: { cap?: number; perMinute?: number; logs?: Array<{ owner: (h: string) => string | null }> } = {}) => ({
  store: log,
  limiter: new RateLimiter(over.perMinute ?? 10),
  arenaMode: true,
  cap: over.cap,
  logs: over.logs,
});

describe("claiming a fighter", () => {
  it("takes a seat with a chosen name and a free face", () => {
    const log = store();
    const answer = claimFighter({ handle: "ash", token: TOKEN, name: "Cinder", face: "Monk" }, deps(log));
    expect(answer.ok).toBe(true);
    if (answer.ok) {
      expect(answer.view.fighter).toEqual({ handle: "ash", name: "Cinder", face: "Monk", entrantId: "fighter-ash" });
      expect(answer.view.freeFaces).not.toContain("Monk");
      expect(answer.view.message).toMatch(/enters every round/);
    }
  });

  it("tells nobody anything about a round", () => {
    const answer = claimFighter({ handle: "ash", token: TOKEN, name: "Cinder", face: "Monk" }, deps(store()));
    expect(answer.ok).toBe(true);
    // Counts of seats, a fighter and a sentence. Nothing about a round.
    if (answer.ok) expect(Object.keys(answer.view).sort()).toEqual(["claimed", "fighter", "freeFaces", "message", "seats"]);
  });

  it("gives one handle one fighter", () => {
    const log = store();
    claimFighter({ handle: "ash", token: TOKEN, name: "Cinder", face: "Monk" }, deps(log));
    const again = claimFighter({ handle: "ash", token: TOKEN, name: "Other", face: "Bear" }, deps(log));
    expect(again.ok).toBe(true);
    if (again.ok) {
      expect(again.view.fighter?.name).toBe("Cinder");
      expect(again.view.message).toMatch(/already yours/);
    }
  });

  it("refuses a handle another browser holds, here and in the other logs", () => {
    const log = store();
    claimFighter({ handle: "ash", token: TOKEN, name: "Cinder", face: "Monk" }, deps(log));
    const thief = claimFighter({ handle: "ash", token: OTHER, name: "Thief", face: "Bear" }, deps(log));
    expect(thief).toMatchObject({ ok: false, status: 409 });

    const elsewhere = claimFighter(
      { handle: "bee", token: OTHER, name: "Bee", face: "Bear" },
      deps(log, { logs: [{ owner: () => tokenHash(TOKEN) }] }),
    );
    expect(elsewhere).toMatchObject({ ok: false, status: 409 });
  });

  it("never gives one face to two fighters", () => {
    const log = store();
    claimFighter({ handle: "ash", token: TOKEN, name: "Cinder", face: "Monk" }, deps(log));
    const second = claimFighter({ handle: "bee", token: OTHER, name: "Bee", face: "Monk" }, deps(log));
    expect(second).toMatchObject({ ok: false, status: 409 });
    if (!second.ok) expect(second.message).toMatch(/took that face first/);
  });

  it("refuses a face nobody is offering", () => {
    const answer = claimFighter({ handle: "ash", token: TOKEN, name: "Cinder", face: "Knight" }, deps(store()));
    expect(answer).toMatchObject({ ok: false, status: 400 });
  });

  it("refuses a name that is not one", () => {
    for (const name of ["", "x", "a name with spaces", "waaaaaaytoolong"]) {
      expect(claimFighter({ handle: "ash", token: TOKEN, name, face: "Monk" }, deps(store()))).toMatchObject({ ok: false, status: 400 });
    }
  });

  it("rate limits a browser that will not stop", () => {
    const log = store();
    const shared = deps(log, { perMinute: 2 });
    claimFighter({ handle: "ash", token: TOKEN, name: "One", face: "Monk" }, shared);
    claimFighter({ handle: "ash", token: TOKEN, name: "Two", face: "Bear" }, shared);
    expect(claimFighter({ handle: "ash", token: TOKEN, name: "Three", face: "Dragon" }, shared)).toMatchObject({ ok: false, status: 429 });
  });

  it("holds the cap, so a newcomer can still claim", () => {
    const log = store();
    claimFighter({ handle: "ash", token: TOKEN, name: "Cinder", face: "Monk" }, deps(log, { cap: 1 }));
    const second = claimFighter({ handle: "bee", token: OTHER, name: "Bee", face: "Bear" }, deps(log, { cap: 1 }));
    expect(second).toMatchObject({ ok: false, status: 409 });
    if (!second.ok) expect(second.message).toMatch(/seat is taken/);
  });

  it("is closed where the pit does not run itself", () => {
    const answer = claimFighter({ handle: "ash", token: TOKEN, name: "Cinder", face: "Monk" }, { ...deps(store()), arenaMode: false });
    expect(answer).toMatchObject({ ok: false, status: 403 });
  });
});

describe("asking about a fighter", () => {
  it("says what this browser has, and what is left to take", () => {
    const log = store();
    claimFighter({ handle: "ash", token: TOKEN, name: "Cinder", face: "Monk" }, deps(log));
    const view = fighterStatus({ handle: "ash", token: TOKEN }, deps(log));
    expect(view.fighter?.name).toBe("Cinder");
    expect(view.freeFaces).toHaveLength(CLAIMABLE_FACES.length - 1);
  });

  it("shows nobody else's fighter, even under their handle", () => {
    const log = store();
    claimFighter({ handle: "ash", token: TOKEN, name: "Cinder", face: "Monk" }, deps(log));
    expect(fighterStatus({ handle: "ash", token: OTHER }, deps(log)).fighter).toBeNull();
  });

  it("says nothing at all before a handle is chosen", () => {
    const view = fighterStatus({ handle: null, token: TOKEN }, deps(store()));
    expect(view.fighter).toBeNull();
    expect(view.message).toMatch(/Claim a fighter/);
  });
});
