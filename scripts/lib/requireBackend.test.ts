import { describe, expect, it } from "vitest";
import { requireDeclaredBackend } from "./requireBackend";

describe("requireDeclaredBackend", () => {
  it("allows a backend the environment named", () => {
    expect(() => requireDeclaredBackend({ walletBackend: "viem", backendSource: "declared" }, "/x/.env.local")).not.toThrow();
    expect(() => requireDeclaredBackend({ walletBackend: "fake", backendSource: "declared" }, null)).not.toThrow();
  });

  it("refuses a backend that was only inferred", () => {
    // The failure this prevents is silent success: a funding run against the
    // fake chain prints a plan, writes fake hashes and exits zero.
    expect(() => requireDeclaredBackend({ walletBackend: "fake", backendSource: "inferred" }, null)).toThrow(/WALLET_BACKEND is not set/);
  });

  it("says what it would have run against, so the mistake is obvious", () => {
    expect(() => requireDeclaredBackend({ walletBackend: "fake", backendSource: "inferred" }, null)).toThrow(/fake chain without saying so/);
  });

  it("names the file it looked in when there was one", () => {
    expect(() => requireDeclaredBackend({ walletBackend: "viem", backendSource: "inferred" }, "/repo/.env.local")).toThrow(/\/repo\/\.env\.local does not set it/);
    expect(() => requireDeclaredBackend({ walletBackend: "viem", backendSource: "inferred" }, null)).toThrow(/no \.env\.local was found/);
  });

  it("offers both ways out rather than only the real one", () => {
    expect(() => requireDeclaredBackend({ walletBackend: "fake", backendSource: "inferred" }, null)).toThrow(/WALLET_BACKEND=fake to run against the in memory chain on purpose/);
  });
});
