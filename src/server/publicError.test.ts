import { describe, expect, it } from "vitest";
import { ChainUnreachableError } from "./errors";
import { PlanNotQuoted } from "./round/planStore";
import { internalDetail, publicError, publicErrorFor } from "./publicError";

/** A real viem transport error, with a credential in the path. */
const viemError = (): Error => {
  const e = new Error("The request took too long to respond.\n\nURL: https://rpc.example.com/v2/SUPERSECRETKEY\nVersion: viem@2.38.3");
  e.name = "TimeoutError";
  return e;
};

describe("publicError", () => {
  it("names the chain failure so the player is told what to do about it", () => {
    const shown = publicError(new ChainUnreachableError("no agent balance could be read from the chain"));
    expect(shown.code).toBe("chain_unreachable");
    expect(shown.message).toBe("Can't reach the network right now. Try again in a moment.");
    expect(shown.retryable).toBe(true);
  });

  it("names an expired round", () => {
    expect(publicError(new PlanNotQuoted("r-1")).code).toBe("round_expired");
  });

  it("turns anything else into the generic sentence, whatever it said", () => {
    const shown = publicError(viemError());
    expect(shown.code).toBe("internal");
    expect(shown.message).toBe("Something went wrong on our side. Try again in a moment.");
    expect(JSON.stringify(shown)).not.toContain("SUPERSECRETKEY");
    expect(JSON.stringify(shown)).not.toContain("rpc.example.com");
    expect(JSON.stringify(shown)).not.toContain("viem@");
  });

  it("classifies by a declared code as well as by type", () => {
    // A bundler that loads a module twice gives the same class two
    // identities, and instanceof alone would quietly miss the branch.
    expect(publicError({ code: "chain_unreachable" }).code).toBe("chain_unreachable");
    expect(publicError({ code: "round_expired" }).code).toBe("round_expired");
  });

  it("will not let a code from somewhere else pick a branch", () => {
    // viem's rpc errors carry a numeric code, and nothing outside this
    // codebase gets to choose what the player is told.
    expect(publicError({ code: -32000 }).code).toBe("internal");
    expect(publicError({ code: "bad_request" }).code).toBe("internal");
    expect(publicError({ code: "chain_unreachable_please" }).code).toBe("internal");
  });

  it("never returns a message it was not given in this file", () => {
    const messages = new Set(["chain_unreachable", "round_expired", "bad_request", "internal"].map((c) => publicErrorFor(c as "internal").message));
    for (const thrown of [viemError(), new Error("anything"), "a string", null, 42, { message: "spoofed" }]) {
      expect(messages.has(publicError(thrown).message)).toBe(true);
    }
  });
});

describe("internalDetail", () => {
  it("keeps the full text, because the log is where it belongs", () => {
    expect(internalDetail(viemError())).toContain("viem@2.38.3");
  });

  it("handles something that is not an error at all", () => {
    expect(internalDetail("plain string")).toBe("plain string");
  });
});
