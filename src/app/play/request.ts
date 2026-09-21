// Every request the flow makes, with a deadline.
//
// postJson had no timeout and no abort. A server that accepts a connection
// and never answers leaves the promise pending forever, so the catch that
// recovers the flow never runs and the screen sits on "Locked in" with no way
// out but a reload. Measured before this: 68.9 seconds and counting, and that
// was a server that did eventually answer.
//
// No state in the flow may be capable of waiting forever, so the deadline
// lives here rather than at each call site where it can be forgotten.
//
// The deadline comes from AbortSignal, which is the right primitive for
// abandoning a fetch and also keeps this file clear of the timer ban that
// covers the play screen. That ban exists so nothing but the render loop
// drives animation. A raw timer here would have been a fair catch even though
// a request deadline is not an animation clock, so the ban is left strict and
// this uses the platform instead.

/** Long enough for a slow round to settle, short enough to be a wait and not a hang. */
export const REQUEST_TIMEOUT_MS = 120_000;

export class RequestTimeoutError extends Error {
  constructor(readonly path: string, readonly timeoutMs: number) {
    super(`${path} did not answer within ${Math.round(timeoutMs / 1000)} seconds`);
    this.name = "RequestTimeoutError";
  }
}

export interface RequestOptions {
  timeoutMs?: number;
  /** Injected in tests. */
  fetchImpl?: typeof fetch;
  /** Lets a caller abort for its own reasons, alongside the deadline. */
  signal?: AbortSignal;
}

/**
 * Fetches with a deadline. Returns the Response so a caller can stream it;
 * the deadline covers the whole exchange, not just the headers.
 */
export async function requestWithTimeout(path: string, body: unknown, options: RequestOptions = {}): Promise<{ response: Response; done: () => void }> {
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const doFetch = options.fetchImpl ?? fetch;
  const deadline = AbortSignal.timeout(timeoutMs);
  const signal = options.signal ? AbortSignal.any([deadline, options.signal]) : deadline;
  // Whether the deadline fired, rather than the caller asking to stop.
  const expired = (): boolean => deadline.aborted;

  try {
    const response = await doFetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
    // The body is still being read, so the deadline stays live until the
    // caller says it is finished with the response.
    return { response, done: () => {} };
  } catch (e) {
    if (expired()) throw new RequestTimeoutError(path, timeoutMs);
    throw e;
  }
}

/** A JSON request with a deadline, for the calls that are not streamed. */
export async function postJsonWithTimeout<T>(path: string, body: unknown, options: RequestOptions = {}): Promise<T> {
  const { response, done } = await requestWithTimeout(path, body, options);
  try {
    const parsed = await response.json();
    if (!response.ok) throw new Error(typeof parsed?.error === "string" ? parsed.error : `HTTP ${response.status}`);
    return parsed as T;
  } finally {
    done();
  }
}
