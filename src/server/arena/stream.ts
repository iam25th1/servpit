// The phase stream: one event when the pit moves, and nothing in between.
//
// The worker writes the arena file; a reader watches it. Watching is a poll
// rather than fs.watch, because the file is replaced by a rename on every
// write and a watcher on the old inode stops hearing about it. The store
// stats the file first and only parses when it has changed, so a poll is a
// stat.
//
// Not in the route file because src/app may not open a timer: that ban keeps
// the animation clock in one place, and a server side poll is not an
// animation clock, but the rule is worth more than the exception.

import { arenaReader } from "./read";
import { arenaView, phaseEvent } from "./view";

/** How often the file is checked. A phase lasts seconds at least. */
export const POLL_MS = 1_000;

/**
 * How long the stream may say nothing before it says nothing on purpose.
 *
 * A resting phase can last a whole interval, an hour by default, and this
 * stream only speaks when something moves. A proxy in front of it does not
 * know the difference between a quiet pit and a dead connection: Cloudflare
 * closes a proxied response that has sent nothing for about a hundred
 * seconds. So every twenty seconds of quiet gets a comment, which is a legal
 * server sent events line that carries no event and no data, and which the
 * browser's EventSource ignores. Well inside the window, and cheap: a
 * spectator watching an empty pit is the normal case here.
 */
export const HEARTBEAT_MS = 20_000;

export interface PhaseStreamOptions {
  /** Ends the stream when the client goes away. */
  signal: AbortSignal;
  send: (event: string, data: unknown) => void;
  /** Writes a comment line, so a quiet stream stays a live connection. */
  ping: () => void;
  close: () => void;
  pollMs?: number;
  heartbeatMs?: number;
}

/**
 * Sends the current phase, then one event per change until the client leaves.
 *
 * The first event is sent immediately so a page that joins mid round knows
 * where it is without waiting for the next change.
 */
export function streamPhases(options: PhaseStreamOptions): void {
  const reader = arenaReader();
  const pollMs = options.pollMs ?? POLL_MS;
  const heartbeatMs = options.heartbeatMs ?? HEARTBEAT_MS;
  let last = "";
  // Counted in ticks rather than read from a clock: the poll is the only
  // thing this file knows about time, and one source of it is enough.
  let quiet = 0;

  const tick = (): void => {
    try {
      const event = phaseEvent(arenaView(reader.state(), reader.chain));
      const key = JSON.stringify(event);
      if (key === last) {
        quiet += 1;
        if (quiet * pollMs >= heartbeatMs) {
          quiet = 0;
          options.ping();
        }
        return;
      }
      last = key;
      quiet = 0;
      options.send("phase", event);
    } catch {
      // A read that fails is not worth telling a viewer about in a stream
      // whose next tick will try again, and the error itself may quote an
      // endpoint. The route's own handler logs a failure that matters.
    }
  };

  tick();
  const timer = setInterval(tick, pollMs);
  const stop = (): void => {
    clearInterval(timer);
    options.close();
  };
  if (options.signal.aborted) stop();
  else options.signal.addEventListener("abort", stop, { once: true });
}
