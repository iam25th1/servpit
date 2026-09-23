// Who asked the pit for a round, and which round answered them.
//
// The same shape as the pick log next door, and for the same reason: many
// browsers write here at once, so this is an append only log rather than a
// document somebody reads and rewrites. A request is one line. The worker
// answering it is another line. Nothing is ever edited.
//
// One rule is different, and it is why the decision happens inside the lock
// rather than before it: only one request may be waiting at a time. A round
// costs the operator real money and takes minutes, so two people asking in
// the same second are asking for the same round. Reading the log and then
// appending, the way a pick does, would let two requests both find nothing
// pending and both land.
//
// The file is network namespaced by its name and by a head line inside it,
// checked on every read, like every other store here.

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { PULL_STALE_MS } from "@/config/pulls";
import { withAppendLock } from "../backing/appendLock";
import { StoreNetworkMismatch, storeStamp } from "../store/file";

/** A handle bound to the hash of a device token. First claim wins. */
interface ClaimLine {
  k: "claim";
  handle: string;
  tokenHash: string;
  at: string;
}

/** Somebody asking for a round. */
interface PullLine {
  k: "pull";
  id: string;
  handle: string;
  tokenHash: string;
  at: string;
}

/** The worker picking one up, before the round it becomes has an id. */
interface TakenLine {
  k: "taken";
  id: string;
  at: string;
}

/** The worker answering one, with the round it started. */
interface StartedLine {
  k: "started";
  id: string;
  roundId: string;
  at: string;
}

type Line = ClaimLine | PullLine | TakenLine | StartedLine | { k: "head"; network: string };

/** A request waiting for the worker. */
export interface PendingPull {
  id: string;
  handle: string;
  tokenHash: string;
  at: number;
}

/** What happened to an ask, in the caller's words rather than an exception. */
export type PullOutcome = "queued" | "already asked" | "handle taken";

export class PullStore {
  /** Null until the first read, because an absent file stamps as empty too. */
  private stamp: string | null = null;
  private claims = new Map<string, string>();
  private pulls = new Map<string, PullLine>();
  private taken = new Set<string>();
  private started = new Map<string, StartedLine>();
  /** Injected by tests that need to age a request without waiting. */
  private now: () => number = Date.now;

  constructor(
    private readonly file: string,
    private readonly network: string,
  ) {}

  /** The token hash a handle belongs to here, or null when nobody has claimed it. */
  owner(handle: string): string | null {
    this.reload();
    return this.claims.get(handle) ?? null;
  }

  /**
   * Takes an ask, or says why it was not taken.
   *
   * Everything is decided inside the lock, so two processes asking at the
   * same moment cannot both find the queue empty.
   */
  request(handle: string, tokenHash: string): { outcome: PullOutcome; id?: string } {
    this.head();
    return withAppendLock(this.file, () => {
      this.stamp = null;
      this.reload();
      const held = this.claims.get(handle) ?? null;
      if (held !== null && held !== tokenHash) return { outcome: "handle taken" as const };
      if (this.waiting() !== null) return { outcome: "already asked" as const };

      const at = new Date(this.now()).toISOString();
      const id = randomUUID();
      const lines: Line[] = held === null ? [{ k: "claim", handle, tokenHash, at }] : [];
      lines.push({ k: "pull", id, handle, tokenHash, at });
      this.write(lines);
      return { outcome: "queued" as const, id };
    });
  }

  /** The request the worker should answer, or null. */
  pending(): PendingPull | null {
    this.reload();
    return this.waiting();
  }

  /**
   * Records that the worker has this ask, before the round exists.
   *
   * Separate from start because a round id is derived from the plan, which is
   * a minute of chain reads away, and nobody else should be able to queue an
   * ask in that minute.
   */
  take(id: string): void {
    this.head();
    withAppendLock(this.file, () => {
      this.write([{ k: "taken", id, at: new Date(this.now()).toISOString() }]);
    });
  }

  /** Records that this request became this round. */
  start(id: string, roundId: string): void {
    this.head();
    withAppendLock(this.file, () => {
      this.write([{ k: "started", id, roundId, at: new Date(this.now()).toISOString() }]);
    });
  }

  /** The handle that asked for this round, or null when the pit started it. */
  pulledBy(roundId: string): string | null {
    this.reload();
    for (const line of this.started.values()) {
      if (line.roundId !== roundId) continue;
      return this.pulls.get(line.id)?.handle ?? null;
    }
    return null;
  }

  /** The oldest ask nobody has answered and nobody has given up on. */
  private waiting(): PendingPull | null {
    const at = this.now();
    let oldest: PendingPull | null = null;
    for (const line of this.pulls.values()) {
      if (this.taken.has(line.id) || this.started.has(line.id)) continue;
      const asked = Date.parse(line.at);
      if (!Number.isFinite(asked) || at - asked >= PULL_STALE_MS) continue;
      if (oldest === null || asked < oldest.at) oldest = { id: line.id, handle: line.handle, tokenHash: line.tokenHash, at: asked };
    }
    return oldest;
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
    this.pulls = new Map();
    this.taken = new Set();
    this.started = new Map();
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
        // First claim wins, so a later line cannot take a handle over.
        if (!this.claims.has(line.handle)) this.claims.set(line.handle, line.tokenHash);
      } else if (line.k === "pull") {
        this.pulls.set(line.id, line);
      } else if (line.k === "taken") {
        this.taken.add(line.id);
      } else if (line.k === "started") {
        this.started.set(line.id, line);
      }
    }
  }
}
