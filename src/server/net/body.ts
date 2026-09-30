// How much of a request this server will hold in memory.
//
// Every write route already refused a body over a couple of kilobytes, but it
// refused it after reading the whole thing: `await request.text()` buffers
// first and the length check happens second, so a refusal cost exactly as
// much memory as the body an attacker chose to send. Eight refused fifty
// megabyte posts measured 406 MB of resident memory on a machine that is also
// running the pit.
//
// So the body is read with a ceiling instead. The declared length is checked
// first, because an honest client declares one and that costs nothing, and
// the stream is then read chunk by chunk and abandoned the moment it passes
// the ceiling. A body that lies about its length is stopped at the same place
// as one that does not.

/** What a request too large is told. The same sentence whatever the route. */
export const TOO_LARGE = "That is more than this takes.";

export type BodyRead = { ok: true; text: string } | { ok: false };

/**
 * The body as text, or a refusal, without ever holding more than the ceiling.
 *
 * Returns the refusal rather than throwing: a route answers a body that is
 * too big the same way it answers one that is not a pick, with a sentence and
 * a status, and neither is an error worth logging.
 */
export async function readBody(request: Request, maxBytes: number): Promise<BodyRead> {
  const declared = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > maxBytes) return { ok: false };

  const body = request.body;
  if (body === null) return { ok: true, text: "" };

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let held = 0;
  let text = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      held += value.byteLength;
      // Past the ceiling the rest of the body is never read: the stream is
      // cancelled, which tells the runtime to stop pulling it off the socket.
      if (held > maxBytes) {
        await reader.cancel();
        return { ok: false };
      }
      text += decoder.decode(value, { stream: true });
    }
  } catch {
    // A client that hung up mid body. There is nothing to answer it with, and
    // the route's own handler turns this into the ordinary refusal.
    return { ok: false };
  }
  return { ok: true, text: text + decoder.decode() };
}
