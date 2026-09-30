import { describe, expect, it, vi } from "vitest";
import type { ReconcileResult } from "../reconcile";
import { READBACK_ATTEMPTS, readBackUntilSettled } from "./settle";

const failed: ReconcileResult = { ok: false, checks: [{ name: "operator delta", ok: false, expected: "-1", actual: "0" }] };
const passed: ReconcileResult = { ok: true, checks: [{ name: "operator delta", ok: true, expected: "-1", actual: "-1" }] };
const noSleep = () => Promise.resolve();

describe("reading the chain back after a round", () => {
  it("reads again when a lagging node has not seen the last transfer yet", async () => {
    // The live failure: a refill that read back as never sent, then landed.
    const readBack = vi.fn().mockResolvedValueOnce(failed).mockResolvedValueOnce(passed);
    const retried = vi.fn();
    const result = await readBackUntilSettled(readBack, true, retried, noSleep);
    expect(result.ok).toBe(true);
    expect(readBack).toHaveBeenCalledTimes(2);
    expect(retried).toHaveBeenCalledWith(1, ["operator delta"]);
  });

  it("still fails a mismatch that survives every read", async () => {
    const readBack = vi.fn().mockResolvedValue(failed);
    const result = await readBackUntilSettled(readBack, true, () => {}, noSleep);
    expect(result.ok).toBe(false);
    expect(readBack).toHaveBeenCalledTimes(READBACK_ATTEMPTS);
  });

  it("does not read a chain that answers from memory twice", async () => {
    const readBack = vi.fn().mockResolvedValue(failed);
    const result = await readBackUntilSettled(readBack, false, () => {}, noSleep);
    expect(result.ok).toBe(false);
    expect(readBack).toHaveBeenCalledTimes(1);
  });

  it("reads once when the first read matches", async () => {
    const readBack = vi.fn().mockResolvedValue(passed);
    await readBackUntilSettled(readBack, true, () => {}, noSleep);
    expect(readBack).toHaveBeenCalledTimes(1);
  });
});
