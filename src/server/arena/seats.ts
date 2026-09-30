// How many spectators may hold the phase stream at once.
//
// Measured against the live deployment before it was written. A spectator
// holding a stream costs the server about 176 KB of memory and one file stat
// a second, and the origin was never the thing that ran out: at three
// thousand streams it was at 23 percent of one core's worth of a ten core
// machine and 755 MB resident, with every page still answering in under a
// second. Past that, new connections through the tunnel began failing while
// the streams already open stayed up, and at five thousand about half of new
// ones failed.
//
// So the cap is not there to protect the process from the load it was
// measured under. It is there so that the failure, when it comes, is one the
// pit chooses: a sentence and a retry, rather than a machine that takes every
// connection offered until it has no memory left for the round it is playing.
// Nothing about a refused stream stops a viewer watching: the page falls back
// to asking the arena endpoint, which is what it does whenever the stream is
// down.

/** What the pit holds by default, well inside what it was measured holding. */
export const DEFAULT_MAX_STREAMS = 2_000;

/** How long a refused spectator is asked to wait, in seconds. */
export const RETRY_AFTER_SECONDS = 10;

/** One sentence, for a viewer who cannot have a stream right now. */
export const PIT_FULL = "The pit has all the watchers it can hold right now. The round is still there to read.";

export function maxStreams(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.SERVPIT_MAX_STREAMS?.trim();
  if (raw === undefined || raw.length === 0) return DEFAULT_MAX_STREAMS;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError(`SERVPIT_MAX_STREAMS must be a whole number of connections, got ${raw}`);
  }
  return value;
}

/**
 * The seats in front of the stream, counted.
 *
 * One of these per process. A seat is taken when a stream opens and given
 * back when it closes, however it closes: a client that hangs up, a stream
 * that ends and a request that is aborted all land in the same place.
 */
export class StreamSeats {
  private held = 0;

  constructor(private readonly limit: () => number = () => maxStreams()) {}

  /** Takes a seat, or says there is none. */
  take(): boolean {
    if (this.held >= this.limit()) return false;
    this.held += 1;
    return true;
  }

  /** Gives one back. Never below zero, whatever calls it twice. */
  give(): void {
    if (this.held > 0) this.held -= 1;
  }

  /** How many are held, for a test and for the health of the thing. */
  get taken(): number {
    return this.held;
  }
}
