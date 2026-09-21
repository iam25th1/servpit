import { describe, expect, it } from "vitest";
import { readNdjson } from "./ndjson";

/** A Response whose body yields the given chunks in order. */
const responseOf = (chunks: string[]): Response => {
  const encoder = new TextEncoder();
  let i = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i >= chunks.length) return controller.close();
      controller.enqueue(encoder.encode(chunks[i++]));
    },
  });
  return new Response(stream);
};

const collect = async (chunks: string[]): Promise<unknown[]> => {
  const seen: unknown[] = [];
  await readNdjson(responseOf(chunks), (v) => seen.push(v));
  return seen;
};

describe("readNdjson", () => {
  it("hands over one value per line", async () => {
    expect(await collect(['{"a":1}\n{"a":2}\n'])).toEqual([{ a: 1 }, { a: 2 }]);
  });

  it("joins a line split across chunks, which is where the network puts the boundary", async () => {
    expect(await collect(['{"a":', '1}\n{"a":2', '}\n'])).toEqual([{ a: 1 }, { a: 2 }]);
  });

  it("splits two lines that arrived in one chunk", async () => {
    expect(await collect(['{"a":1}\n{"a":2}\n{"a":3}\n'])).toEqual([{ a: 1 }, { a: 2 }, { a: 3 }]);
  });

  it("reads a final line with no trailing newline", async () => {
    expect(await collect(['{"a":1}\n{"a":2}'])).toEqual([{ a: 1 }, { a: 2 }]);
  });

  it("ignores blank lines rather than throwing on them", async () => {
    expect(await collect(['{"a":1}\n\n\n{"a":2}\n'])).toEqual([{ a: 1 }, { a: 2 }]);
  });

  it("yields nothing for an empty body", async () => {
    expect(await collect([""])).toEqual([]);
  });

  it("throws on a malformed line rather than skipping it silently", async () => {
    await expect(collect(["not json\n"])).rejects.toThrow();
  });

  it("refuses a response with no body", async () => {
    await expect(readNdjson(new Response(null, { status: 204 }), () => {})).rejects.toThrow(/no body/);
  });

  it("stops when the signal aborts", async () => {
    const controller = new AbortController();
    const seen: unknown[] = [];
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      pull(c) { c.enqueue(encoder.encode('{"a":1}\n')); },
    });
    const p = readNdjson(new Response(stream), (v) => { seen.push(v); if (seen.length === 3) controller.abort(); }, { signal: controller.signal });
    await p;
    expect(seen.length).toBeGreaterThanOrEqual(3);
  });
});
