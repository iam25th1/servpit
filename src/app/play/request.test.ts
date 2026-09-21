import { describe, expect, it, vi } from "vitest";
import { postJsonWithTimeout, requestWithTimeout, RequestTimeoutError, REQUEST_TIMEOUT_MS } from "./request";

/** A fetch that never answers, and never rejects on its own. */
const neverAnswers: typeof fetch = (_input, init) =>
  new Promise((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
  });

const answersWith = (body: unknown, ok = true): typeof fetch =>
  (async () => new Response(JSON.stringify(body), { status: ok ? 200 : 500, headers: { "content-type": "application/json" } })) as typeof fetch;

describe("requestWithTimeout", () => {
  it("gives up on a server that never answers", async () => {
    // This is the hang: without a deadline the promise stays pending, the
    // catch that recovers the flow never runs, and the screen never leaves
    // the locked state.
    await expect(requestWithTimeout("/api/round/run", {}, { timeoutMs: 20, fetchImpl: neverAnswers })).rejects.toBeInstanceOf(RequestTimeoutError);
  });

  it("names the path and the deadline, so the error means something on screen", async () => {
    await expect(requestWithTimeout("/api/round/run", {}, { timeoutMs: 2000, fetchImpl: neverAnswers })).rejects.toThrow(
      "/api/round/run did not answer within 2 seconds",
    );
  });

  it("returns the response untouched so a caller can stream it", async () => {
    const { response, done } = await requestWithTimeout("/x", { a: 1 }, { fetchImpl: answersWith({ ok: true }) });
    expect(await response.json()).toEqual({ ok: true });
    done();
  });

  it("sends the body as JSON with the right method and header", async () => {
    const spy = vi.fn(answersWith({}));
    await requestWithTimeout("/x", { a: 1 }, { fetchImpl: spy as unknown as typeof fetch });
    const init = spy.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(init.body).toBe('{"a":1}');
    expect((init.headers as Record<string, string>)["content-type"]).toBe("application/json");
  });

  it("passes a caller's own abort through, distinct from the deadline", async () => {
    const outer = new AbortController();
    const p = requestWithTimeout("/x", {}, { timeoutMs: 60_000, fetchImpl: neverAnswers, signal: outer.signal });
    outer.abort();
    // Not a timeout: the caller asked, so the caller's error surfaces.
    await expect(p).rejects.not.toBeInstanceOf(RequestTimeoutError);
  });

  it("has a default deadline rather than relying on every call site to pass one", () => {
    expect(REQUEST_TIMEOUT_MS).toBeGreaterThan(0);
    expect(Number.isFinite(REQUEST_TIMEOUT_MS)).toBe(true);
  });
});

describe("postJsonWithTimeout", () => {
  it("returns the parsed body", async () => {
    await expect(postJsonWithTimeout("/x", {}, { fetchImpl: answersWith({ v: 7 }) })).resolves.toEqual({ v: 7 });
  });

  it("throws the server's own error message when it sends one", async () => {
    await expect(postJsonWithTimeout("/x", {}, { fetchImpl: answersWith({ error: "seed is not valid" }, false) })).rejects.toThrow("seed is not valid");
  });

  it("falls back to the status when the server sends no message", async () => {
    await expect(postJsonWithTimeout("/x", {}, { fetchImpl: answersWith({}, false) })).rejects.toThrow("HTTP 500");
  });

  it("times out rather than hanging", async () => {
    await expect(postJsonWithTimeout("/x", {}, { timeoutMs: 20, fetchImpl: neverAnswers })).rejects.toBeInstanceOf(RequestTimeoutError);
  });
});
