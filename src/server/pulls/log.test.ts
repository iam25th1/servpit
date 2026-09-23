import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PULL_STALE_MS } from "@/config/pulls";
import { StoreNetworkMismatch } from "@/server/store/file";
import { PullStore } from "./log";

let dir: string;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

const store = (network = "fake"): PullStore => {
  dir = mkdtempSync(join(tmpdir(), "servpit-pulls-"));
  return new PullStore(join(dir, `pulls-${network}.ndjson`), network);
};

describe("asking for a round", () => {
  it("takes a request and reports it pending", () => {
    const log = store();
    expect(log.request("ash", "hash-ash").outcome).toBe("queued");
    const pending = log.pending();
    expect(pending?.handle).toBe("ash");
  });

  it("takes only one at a time, whoever is asking", () => {
    // A round is minutes of the operator's money. Two people wanting one at
    // the same moment want the same round, not two.
    const log = store();
    expect(log.request("ash", "hash-ash").outcome).toBe("queued");
    expect(log.request("ash", "hash-ash").outcome).toBe("already asked");
    expect(log.request("bee", "hash-bee").outcome).toBe("already asked");
    expect(log.pending()?.handle).toBe("ash");
  });

  it("lets the next one ask once the worker has taken the last", () => {
    const log = store();
    log.request("ash", "hash-ash");
    const pending = log.pending();
    log.start(pending!.id, "r-1");
    expect(log.pending()).toBeNull();
    expect(log.request("bee", "hash-bee").outcome).toBe("queued");
  });

  it("keeps a handle on the browser that claimed it", () => {
    const log = store();
    log.request("ash", "hash-ash");
    log.start(log.pending()!.id, "r-1");
    expect(log.request("ash", "another-browser").outcome).toBe("handle taken");
    expect(log.pending()).toBeNull();
  });

  it("forgets a request nobody played, rather than playing it much later", () => {
    // Someone asked, the worker was down, and they left. Playing that round
    // five minutes later is not what they asked for.
    let clock = 1_000;
    dir = mkdtempSync(join(tmpdir(), "servpit-pulls-"));
    const log = new PullStore(join(dir, "pulls-fake.ndjson"), "fake", () => clock);
    log.request("ash", "hash-ash");
    clock += PULL_STALE_MS + 1;
    expect(log.pending()).toBeNull();
    expect(log.request("bee", "hash-bee").outcome).toBe("queued");
  });

  it("says who asked for a round the worker took", () => {
    const log = store();
    log.request("ash", "hash-ash");
    const pending = log.pending()!;
    log.start(pending.id, "r-7");
    expect(log.pulledBy("r-7")).toBe("ash");
    expect(log.pulledBy("r-8")).toBeNull();
  });

  it("refuses to read a log from another network", () => {
    const log = store("fake");
    log.request("ash", "hash-ash");
    const other = new PullStore(join(dir, "pulls-fake.ndjson"), "base-sepolia");
    expect(() => other.pending()).toThrow(StoreNetworkMismatch);
  });

  it("reads around a line a crash cut in half", () => {
    const log = store();
    log.request("ash", "hash-ash");
    const file = join(dir, "pulls-fake.ndjson");
    writeFileSync(file, readFileSync(file, "utf8") + '{"k":"pull","id":"torn"', { flag: "a" });
    expect(log.pending()?.handle).toBe("ash");
  });
});
