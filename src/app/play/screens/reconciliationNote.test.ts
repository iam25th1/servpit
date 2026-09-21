import { describe, expect, it } from "vitest";
import { reconciliationNote } from "./reconciliationNote";

describe("reconciliationNote", () => {
  it("says it held when every check passed", () => {
    const note = reconciliationNote(true, [
      { name: "pot delta", ok: true, expected: "400", actual: "400" },
      { name: "conservation", ok: true, expected: "2400", actual: "retained 2400" },
    ]);
    expect(note.ok).toBe(true);
    expect(note.text).toBe("Reconciliation held against chain balances");
    expect(note.failed).toEqual([]);
  });

  it("names what failed rather than only saying that something did", () => {
    // A money surface that reports FAILED and nothing else leaves the
    // operator with no idea which wallet to look at.
    const note = reconciliationNote(false, [
      { name: "wallet 0xabc delta", ok: false, expected: "-100", actual: "-132252136528" },
      { name: "pot delta", ok: true, expected: "400", actual: "400" },
      { name: "conservation", ok: false, expected: "2400", actual: "2300" },
    ]);
    expect(note.ok).toBe(false);
    expect(note.text).toBe("Reconciliation FAILED on 2 of 3 checks");
    expect(note.failed).toEqual([
      "wallet 0xabc delta: expected -100, saw -132252136528",
      "conservation: expected 2400, saw 2300",
    ]);
  });

  it("uses the singular for a single failure", () => {
    const note = reconciliationNote(false, [
      { name: "pot delta", ok: false, expected: "400", actual: "300" },
      { name: "conservation", ok: true, expected: "2400", actual: "retained 2400" },
    ]);
    expect(note.text).toBe("Reconciliation FAILED on 1 of 2 checks");
  });

  it("trusts the flag over the list, so a failure is never hidden by a missing check", () => {
    // If the two ever disagree the screen reports the failure. Saying it
    // held when the run said otherwise is the one mistake worth ruling out.
    const note = reconciliationNote(false, []);
    expect(note.ok).toBe(false);
    expect(note.text).toBe("Reconciliation FAILED");
    expect(note.failed).toEqual([]);
  });

  it("reports a failure even when the checks are not available at all", () => {
    expect(reconciliationNote(false, undefined).ok).toBe(false);
    expect(reconciliationNote(true, undefined).text).toBe("Reconciliation held against chain balances");
  });
});
