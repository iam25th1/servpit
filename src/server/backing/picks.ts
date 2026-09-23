// Who backed whom, written by everybody at once.
//
// Every other store in this project has one writer: the worker, or the settle
// path behind a lock. Picks are the opposite. A round's backing window is one
// moment that many viewers act in at the same time, and each of them is a
// separate request, so the read, modify, write a JSON store does would lose
// whichever pick lost the race. Both writes are legitimate there, which is
// exactly why the later one silently replacing the earlier one is wrong.
//
// So this is an append only log instead. A pick is one short line appended to
// the end of the file: nothing is read back and rewritten, so there is
// nothing to lose, and state is the result of reading the lines rather than a
// document anybody owns. The append itself is taken under a lock held for
// microseconds, because O_APPEND puts a write at the end without promising it
// lands whole. See appendLock.ts, and the torn line that proved it.
//
// A torn line, which is what a crash mid append leaves, is skipped. The rest
// of the log is still every pick that landed.
//
// The file is network namespaced like every other store, by its name and by a
// head line inside it that is checked on every read.

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { MAX_BACKERS_PER_ROUND } from "@/config/backing";
import { StoreNetworkMismatch, storeStamp } from "../store/file";
import { withAppendLock } from "./appendLock";

/** A handle bound to the hash of a device token. First claim wins. */
interface ClaimLine {
  k: "claim";
  handle: string;
  tokenHash: string;
  at: string;
}

/** One viewer backing one agent in one round. */
interface PickLine {
  k: "pick";
  roundId: string;
  handle: string;
  agentId: string;
  at: string;
}

type Line = ClaimLine | PickLine | { k: "head"; network: string };

/** What happened to a pick, in the caller's words rather than an exception. */
export type RecordOutcome = "recorded" | "handle taken" | "round full";

export function pickFile(dataDir: string, network: string): string {
  return join(dataDir, `picks-${network}.ndjson`);
}

export class PickStore {
  /** Null until the first read, because an absent file stamps as empty too. */
  private stamp: string | null = null;
  private claims = new Map<string, string>();
  private picks = new Map<string, Map<string, string>>();

  constructor(
    private readonly file: string,
    private readonly network: string,
    /** Most backers one round may have. Lowered by tests that fill a round. */
    private readonly maxBackers: number = MAX_BACKERS_PER_ROUND,
  ) {}

  /** The token hash a handle belongs to, or null when nobody has claimed it. */
  owner(handle: string): string | null {
    this.reload();
    return this.claims.get(handle) ?? null;
  }

  /**
   * Appends a pick, and the claim on the handle if it is a new one.
   *
   * Two rules are enforced here, both inside the lock because both are races:
   * a handle belongs to the token that claimed it, and a round holds only so
   * many backers. Reading first and appending after would let two requests
   * take the same handle, or the last seat in a round, in the same moment.
   *
   * Whether the window is open, whether the agent is in the round and how
   * often this client may ask are the route's business, because they are
   * about the request rather than about the log.
   */
  record(roundId: string, handle: string, tokenHash: string, agentId: string): RecordOutcome {
    this.head();
    return withAppendLock(this.file, () => {
      this.stamp = null;
      this.reload();

      const held = this.claims.get(handle) ?? null;
      if (held !== null && held !== tokenHash) return "handle taken" as const;
      // A backer already in the round may always change their mind. The
      // ceiling is on how many different people one round can carry.
      const round = this.picks.get(roundId);
      if (round !== undefined && !round.has(handle) && round.size >= this.maxBackers) return "round full" as const;

      const at = new Date().toISOString();
      const lines: Line[] = held === null ? [{ k: "claim", handle, tokenHash, at }] : [];
      lines.push({ k: "pick", roundId, handle, agentId, at });
      this.write(lines);
      return "recorded" as const;
    });
  }

  /** What this handle backed in this round, or null. */
  pickOf(roundId: string, handle: string): string | null {
    return this.picksFor(roundId).get(handle) ?? null;
  }

  /** Every backer in a round, and who they backed. */
  picksFor(roundId: string): Map<string, string> {
    this.reload();
    return new Map(this.picks.get(roundId) ?? []);
  }

  /** Backers per agent, which is what the pari mutuel split divides by. */
  countsFor(roundId: string): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const agentId of this.picksFor(roundId).values()) counts[agentId] = (counts[agentId] ?? 0) + 1;
    return counts;
  }

  /**
   * Appends lines. Called with the lock already held.
   *
   * The lock is what makes an append whole: O_APPEND alone does not promise
   * it, and six processes appending at once tore a line on the first run of
   * the concurrency test. One call inside it, so a batch lands together.
   */
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
    this.picks = new Map();
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
      } else if (line.k === "pick") {
        const round = this.picks.get(line.roundId) ?? new Map<string, string>();
        // Last pick wins, which is a viewer changing their mind while the
        // window is open. The route is what stops one arriving after it shuts.
        round.set(line.handle, line.agentId);
        this.picks.set(line.roundId, round);
      }
    }
  }
}
