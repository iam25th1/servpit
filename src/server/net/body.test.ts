import { describe, expect, it } from "vitest";
import { readBody } from "./body";

/** A request whose body arrives in pieces, like one off a socket. */
function streamed(chunks: readonly string[], declared?: number): Request {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  const headers = new Headers();
  if (declared !== undefined) headers.set("content-length", String(declared));
  return new Request("http://pit.test/api/backing", { method: "POST", body, headers, duplex: "half" } as RequestInit);
}

describe("reading a body with a ceiling", () => {
  it("reads a body that fits", async () => {
    const read = await readBody(streamed(['{"handle":', '"ash"}']), 2_000);
    expect(read).toEqual({ ok: true, text: '{"handle":"ash"}' });
  });

  it("refuses a body that says it is too large, without reading it", async () => {
    // A body that never ends. Reading it to the end is the failure this is
    // about, and a call that tried would never return at all.
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new TextEncoder().encode("x".repeat(1_000)));
      },
    });
    const request = new Request("http://pit.test/api/backing", {
      method: "POST",
      body,
      headers: new Headers({ "content-length": String(50 * 1024 * 1024) }),
      duplex: "half",
    } as RequestInit);

    expect(await readBody(request, 2_000)).toEqual({ ok: false });
  });

  it("stops a body that lies about its length at the ceiling", async () => {
    // Ten chunks of a thousand bytes, a ceiling of two thousand, and no
    // declared length at all: the refusal must not wait for the last chunk.
    let sent = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        sent += 1;
        if (sent > 10) return controller.close();
        controller.enqueue(new TextEncoder().encode("x".repeat(1_000)));
      },
    });
    const request = new Request("http://pit.test/api/backing", { method: "POST", body, duplex: "half" } as RequestInit);

    expect(await readBody(request, 2_000)).toEqual({ ok: false });
    expect(sent).toBeLessThanOrEqual(4);
  });

  it("reads an empty body as empty", async () => {
    const request = new Request("http://pit.test/api/backing", { method: "POST" });
    expect(await readBody(request, 2_000)).toEqual({ ok: true, text: "" });
  });

  it("keeps a character whose bytes span two chunks whole", async () => {
    const bytes = new TextEncoder().encode('{"name":"é"}');
    const encoder = new TextDecoder();
    const first = bytes.slice(0, 10);
    const second = bytes.slice(10);
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(first);
        controller.enqueue(second);
        controller.close();
      },
    });
    const request = new Request("http://pit.test/api/fighter", { method: "POST", body, duplex: "half" } as RequestInit);

    const read = await readBody(request, 2_000);
    expect(read).toEqual({ ok: true, text: encoder.decode(bytes) });
  });
});
