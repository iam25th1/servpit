// How often one client may pick.
//
// A pick is a line in a log, and a log is a disk. One visitor holding the
// button down should not be able to fill it, and the backing window is a
// minute at most, so a handful of picks a minute is generous for changing
// your mind and useless for flooding.
//
// In process, which is what a single site process needs and all it can
// promise: another process has its own counters. The log itself is what
// stands behind this, since a flood of picks from one handle still resolves
// to that handle's last pick and one row on the board.

/** A sliding minute, because most of these limits are written per minute. */
export const WINDOW_MS = 60_000;

export class RateLimiter {
  private readonly seen = new Map<string, number[]>();

  constructor(
    private readonly perWindow: number,
    private readonly now: () => number = Date.now,
    /** The window this many attempts are counted over. A minute by default. */
    private readonly windowMs: number = WINDOW_MS,
  ) {}

  /** Records an attempt and says whether it is allowed. */
  allow(key: string): boolean {
    const at = this.now();
    const recent = (this.seen.get(key) ?? []).filter((t) => at - t < this.windowMs);
    if (recent.length >= this.perWindow) {
      this.seen.set(key, recent);
      return false;
    }
    recent.push(at);
    this.seen.set(key, recent);
    this.sweep(at);
    return true;
  }

  /** Drops keys whose attempts have all aged out, so the map is not a leak. */
  private sweep(at: number): void {
    for (const [key, times] of this.seen) {
      if (times.every((t) => at - t >= this.windowMs)) this.seen.delete(key);
    }
  }
}
