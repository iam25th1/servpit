// Who owns a seat in the pit.
//
// The same shape as the pick and pull logs, for the same reasons: many
// browsers write here at once, so it is an append only log rather than a
// document somebody reads and rewrites, the append is taken under a lock
// because O_APPEND does not promise a whole line, and the file is network
// namespaced by its name and by a head line inside it.
//
// Three rules are decided inside the lock, because all three are races:
// one fighter per handle, one face per fighter, and a cap on how many seats
// are claimed at once. Reading first and appending after would let two
// browsers take the same face in the same second.

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { CLAIMABLE_FACES, fighterEntrantId } from "@/config/fighters";
import { withAppendLock } from "../backing/appendLock";
import { StoreNetworkMismatch, storeStamp } from "../store/file";

/** A handle bound to the hash of a device token. First claim wins. */
interface ClaimLine {
  k: "claim";
  handle: string;
  tokenHash: string;
  name: string;
  face: string;
  at: string;
}

/** A claim given up, or aged out. The record behind it is kept. */
interface ReleaseLine {
  k: "release";
  handle: string;
  at: string;
}

/** A visit, so a claim that nobody comes back for can be released later. */
interface SeenLine {
  k: "seen";
  handle: string;
  at: string;
}

type Line = ClaimLine | ReleaseLine | SeenLine | { k: "head"; network: string };

/** A claimed seat, as everything downstream reads it. */
export interface Fighter {
  handle: string;
  tokenHash: string;
  name: string;
  face: string;
  /** The entrant id this fighter fights under, every round. */
  entrantId: string;
  /** When it was claimed, and when its owner was last here. */
  claimedAt: number;
  seenAt: number;
}

/** What happened to a claim, in the caller's words rather than an exception. */
export type ClaimOutcome = "claimed" | "handle taken" | "already claimed" | "face taken" | "pit full";

export interface ClaimRequest {
  handle: string;
  tokenHash: string;
  name: string;
  face: string;
  /** Most seats that may be claimed at once. Zero or less means no cap. */
  cap?: number;
}

export class FighterStore {
  /** Null until the first read, because an absent file stamps as empty too. */
  private stamp: string | null = null;
  private claims = new Map<string, Fighter>();

  constructor(
    private readonly file: string,
    private readonly network: string,
    /** Injected by tests that need to age a claim without waiting. */
    private readonly now: () => number = Date.now,
  ) {}

  /** The token hash a handle belongs to here, or null when nobody claimed it. */
  owner(handle: string): string | null {
    this.reload();
    return this.claims.get(handle)?.tokenHash ?? null;
  }

  /** This handle's fighter, or null. */
  fighterOf(handle: string): Fighter | null {
    this.reload();
    return this.claims.get(handle) ?? null;
  }

  /** Every claimed seat, oldest claim first. */
  all(): Fighter[] {
    this.reload();
    return [...this.claims.values()].sort((a, b) => a.claimedAt - b.claimedAt);
  }

  /** The faces nobody is using, in roster order. */
  freeFaces(): string[] {
    this.reload();
    const taken = new Set([...this.claims.values()].map((f) => f.face));
    return CLAIMABLE_FACES.filter((face) => !taken.has(face));
  }

  /**
   * Takes a seat, or says why it was not taken.
   *
   * Everything is decided inside the lock: two browsers asking for the last
   * free face in the same second cannot both be told yes.
   */
  claim(request: ClaimRequest): { outcome: ClaimOutcome; fighter?: Fighter } {
    this.head();
    return withAppendLock(this.file, () => {
      this.stamp = null;
      this.reload();

      const held = this.claims.get(request.handle);
      if (held && held.tokenHash !== request.tokenHash) return { outcome: "handle taken" as const };
      if (held) return { outcome: "already claimed" as const, fighter: held };

      const cap = request.cap ?? 0;
      if (cap > 0 && this.claims.size >= cap) return { outcome: "pit full" as const };

      const usedFace = [...this.claims.values()].some((f) => f.face === request.face);
      if (usedFace || !CLAIMABLE_FACES.includes(request.face)) return { outcome: "face taken" as const };

      const at = new Date(this.now()).toISOString();
      this.write([{ k: "claim", handle: request.handle, tokenHash: request.tokenHash, name: request.name, face: request.face, at }]);
      return {
        outcome: "claimed" as const,
        fighter: {
          handle: request.handle,
          tokenHash: request.tokenHash,
          name: request.name,
          face: request.face,
          entrantId: fighterEntrantId(request.handle),
          claimedAt: this.now(),
          seenAt: this.now(),
        },
      };
    });
  }

  /** Records that this handle's owner was here, so the claim stays alive. */
  seen(handle: string): void {
    this.reload();
    if (!this.claims.has(handle)) return;
    this.head();
    withAppendLock(this.file, () => {
      this.write([{ k: "seen", handle, at: new Date(this.now()).toISOString() }]);
    });
  }

  /**
   * Gives back the seats nobody has come back to.
   *
   * A claim is released when its owner has not been seen for the release
   * period, and only then: a seat is never taken from somebody who is
   * watching. The record behind it is kept under the handle, so the same
   * visitor claiming again carries on the same career.
   *
   * Called before a claim and by the operator's status command rather than
   * on a timer, because the only moments it matters are when somebody wants
   * a seat and when an operator asks.
   */
  sweep(releaseMs: number): string[] {
    this.reload();
    const at = this.now();
    const stale = [...this.claims.values()].filter((f) => at - f.seenAt >= releaseMs).map((f) => f.handle);
    for (const handle of stale) this.release(handle);
    return stale;
  }

  /** Gives a seat back. The career behind it is kept in the round records. */
  release(handle: string): void {
    this.head();
    withAppendLock(this.file, () => {
      this.write([{ k: "release", handle, at: new Date(this.now()).toISOString() }]);
    });
  }

  private write(lines: readonly Line[]): void {
    appendFileSync(this.file, lines.map((line) => JSON.stringify(line)).join("\n") + "\n", { mode: 0o600 });
    // Force the next read to look, since our own write changed the file.
    this.stamp = null;
  }

  /** Writes the head line once, losing the race harmlessly if two try. */
  private head(): void {
    if (existsSync(this.file)) return;
    mkdirSync(dirname(this.file), { recursive: true });
    try {
      writeFileSync(this.file, JSON.stringify({ k: "head", network: this.network }) + "\n", { flag: "wx", mode: 0o600 });
    } catch {
      // Another writer created it first, which is the same file either way.
    }
  }

  private reload(): void {
    const stamp = storeStamp(this.file);
    if (stamp === this.stamp) return;
    this.stamp = stamp;
    this.claims = new Map();
    if (stamp === "") return;

    for (const text of readFileSync(this.file, "utf8").split("\n")) {
      if (text.length === 0) continue;
      let line: Line;
      try {
        line = JSON.parse(text) as Line;
      } catch {
        // A line cut in half by a crash. Every whole line around it stands.
        continue;
      }
      if (line.k === "head") {
        if (line.network !== this.network) throw new StoreNetworkMismatch(this.file, line.network, this.network);
      } else if (line.k === "claim") {
        const at = Date.parse(line.at);
        this.claims.set(line.handle, {
          handle: line.handle,
          tokenHash: line.tokenHash,
          name: line.name,
          face: line.face,
          entrantId: fighterEntrantId(line.handle),
          claimedAt: Number.isFinite(at) ? at : 0,
          seenAt: Number.isFinite(at) ? at : 0,
        });
      } else if (line.k === "seen") {
        const fighter = this.claims.get(line.handle);
        const at = Date.parse(line.at);
        if (fighter && Number.isFinite(at)) fighter.seenAt = at;
      } else if (line.k === "release") {
        this.claims.delete(line.handle);
      }
    }
  }
}
