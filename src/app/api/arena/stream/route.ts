// GET /api/arena/stream: server sent events, one per phase change.
//
// Read only, like /api/arena, and under the same spoiler rule: an event
// carries the phase, when it started and how long it lasts, never the seed,
// the log, the placements or the winner. A client that wants the fight asks
// /api/arena once the phase says fight.

import { streamPhases } from "@/server/arena/stream";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const encoder = new TextEncoder();
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
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}
