// Reads a newline delimited JSON response, handing over each line as it
// arrives.
//
// The plan endpoint streams one line per agent so a decision can be shown the
// moment it lands. A chunk boundary falls wherever the network puts it, so a
// line can arrive in pieces and two lines can arrive together; both are the
// normal case rather than an edge one.

export interface NdjsonOptions {
  /** Aborts the read. The caller owns the timeout policy. */
  signal?: AbortSignal;
}

export async function readNdjson(response: Response, onLine: (value: unknown) => void, options: NdjsonOptions = {}): Promise<void> {
  const body = response.body;
  if (!body) throw new Error("response has no body to read");
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const abort = (): void => void reader.cancel().catch(() => {});
  options.signal?.addEventListener("abort", abort, { once: true });

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line.length > 0) onLine(JSON.parse(line));
        newline = buffer.indexOf("\n");
      }
    }
    // A final line with no trailing newline is still a line.
    const rest = buffer.trim();
    if (rest.length > 0) onLine(JSON.parse(rest));
  } finally {
    options.signal?.removeEventListener("abort", abort);
    reader.releaseLock();
  }
}
