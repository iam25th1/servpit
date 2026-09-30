// GET /api/arena/stream: server sent events, one per phase change.
//
// Read only, like /api/arena, and under the same spoiler rule: an event
// carries the phase, when it started and how long it lasts, never the seed,
// the log, the placements or the winner. A client that wants the fight asks
// /api/arena once the phase says fight.

import { PIT_FULL, RETRY_AFTER_SECONDS, StreamSeats } from "@/server/arena/seats";
import { streamPhases } from "@/server/arena/stream";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The seats in front of this stream, for this process. */
const seats = new StreamSeats();

export async function GET(request: Request): Promise<Response> {
  // Taken before anything is built, given back however this ends. Without a
  // ceiling the pit would accept connections until the machine had no memory
  // left for the round it is playing, which is the one thing it must keep.
  if (!seats.take()) {
    return Response.json(
      { error: PIT_FULL, message: PIT_FULL, retryable: true },
      { status: 503, headers: { "retry-after": String(RETRY_AFTER_SECONDS), "cache-control": "no-store" } },
    );
  }

  const encoder = new TextEncoder();
  let seated = true;
  const release = (): void => {
    if (!seated) return;
    seated = false;
    seats.give();
  };

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let open = true;
      streamPhases({
        signal: request.signal,
        send: (event, data) => {
          if (!open) return;
          try {
            controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
          } catch {
            // The client hung up between the check and the write. Nothing to
            // tell anybody: the abort handler is about to close this.
            open = false;
          }
        },
        // A comment line. It keeps the connection alive through a rest that
        // can last an hour, and a browser's EventSource ignores it.
        ping: () => {
          if (!open) return;
          try {
            controller.enqueue(encoder.encode(": ping\n\n"));
          } catch {
            open = false;
          }
        },
        close: () => {
          release();
          if (!open) return;
          open = false;
          try {
            controller.close();
          } catch {
            // Already closed by the runtime when the request was aborted.
          }
        },
      });
    },
    // A client that goes away without the abort reaching the stream loop, and
    // a runtime tearing the response down, both land here.
    cancel() {
      release();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}
