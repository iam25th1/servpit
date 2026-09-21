import { spawn } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readStoreFile, StoreFile, storeStamp, StoreNetworkMismatch, writeStoreFile } from "./file";

let dir: string;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

const file = (): string => {
  dir = mkdtempSync(join(tmpdir(), "servpit-store-"));
  return join(dir, "store.json");
};

describe("writing a store", () => {
  it("writes the body with the network stamped on it", () => {
    const path = file();
    writeStoreFile(path, { version: 1, rows: [1, 2] }, "fake");
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ network: "fake", version: 1, rows: [1, 2] });
  });

  it("leaves no temporary file behind", () => {
    const path = file();
    writeStoreFile(path, { version: 1 }, "fake");
    writeStoreFile(path, { version: 1 }, "fake");
    expect(readdirSync(dir).filter((n) => n.endsWith(".tmp"))).toEqual([]);
  });

  it("names its temporary file per process and per write, so two writers cannot share one", () => {
    const path = file();
    const seen = new Set<string>();
    // The temporary name is internal, so this reads it from the one moment it
    // exists: a write whose rename is what the counter has to outlive.
    for (let i = 0; i < 3; i++) {
      const before = readdirSync(dir);
      writeStoreFile(path, { version: 1, i }, "fake");
      const after = readdirSync(dir);
      expect(after.filter((n) => !before.includes(n) && n.endsWith(".tmp"))).toEqual([]);
      seen.add(readFileSync(path, "utf8"));
    }
    expect(seen.size).toBe(3);
  });

  it("returns a stamp that changes with the file", () => {
    const path = file();
    const first = writeStoreFile(path, { version: 1, rows: [1] }, "fake");
    const second = writeStoreFile(path, { version: 1, rows: [1, 2, 3] }, "fake");
    expect(first).not.toBe(second);
    expect(second).toBe(storeStamp(path));
  });
});

describe("reading a store", () => {
  it("returns null when there is nothing on disk", () => {
    expect(readStoreFile(join(tmpdir(), "servpit-absent", "nope.json"), "fake")).toBeNull();
  });

  it("refuses a file that belongs to another chain", () => {
    const path = file();
    writeStoreFile(path, { version: 1, rows: ["fake money"] }, "fake");
    expect(() => readStoreFile(path, "base-sepolia")).toThrow(StoreNetworkMismatch);
    expect(() => readStoreFile(path, "base-sepolia")).toThrow(/holds fake data/);
  });

  it("adopts a file written before the stamp existed, so nothing on disk is lost", () => {
    const path = file();
    writeFileSync(path, JSON.stringify({ version: 1, rows: ["old"] }));
    expect(readStoreFile(path, "base-sepolia")).toEqual({ version: 1, rows: ["old"] });
  });
});

describe("StoreFile", () => {
  it("loads once and not again while the file is untouched", () => {
    const path = file();
    let loads = 0;
    const sync = new StoreFile(path, "fake", () => {
      loads++;
    });
    sync.read();
    sync.read();
    expect(loads).toBe(1);
  });

  it("loads again when another writer has been at the file", () => {
    const path = file();
    const seen: unknown[] = [];
    const reader = new StoreFile(path, "fake", (body) => seen.push(body));
    reader.read();
    writeStoreFile(path, { version: 1, rows: ["written elsewhere"] }, "fake");
    reader.read();
    expect(seen[0]).toBeNull();
    expect(seen[1]).toMatchObject({ rows: ["written elsewhere"] });
  });

  it("does not reread what it wrote itself", () => {
    const path = file();
    let loads = 0;
    const sync = new StoreFile(path, "fake", () => {
      loads++;
    });
    sync.read();
    sync.write({ version: 1, rows: [1] });
    sync.read();
    expect(loads).toBe(1);
  });
});

describe("a write interrupted by a crash", () => {
  // The point of the temporary file and the rename. A process killed in the
  // middle of a write must never leave a store that reads as half a store,
  // because the next process to open it would treat missing rows as rows that
  // never existed: forgotten debts, forgotten transfers.
  it("leaves a whole store on disk, never a truncated one", async () => {
    const path = file();
    const fixture = resolve(__dirname, "interruptedWrite.fixture.ts");

    for (let attempt = 0; attempt < 4; attempt++) {
      // node directly, not npx: a kill has to reach the process doing the
      // writing, and npx is a shim with the writer as its child.
      const child = spawn(process.execPath, ["--import", "tsx", fixture, path], { stdio: ["ignore", "pipe", "ignore"] });
      await new Promise<void>((done) => {
        let ready = false;
        child.stdout.on("data", () => {
          if (ready) return;
          ready = true;
          // Mid write, not between writes: the fixture never stops writing.
          setTimeout(() => child.kill("SIGKILL"), 4 + attempt * 3);
        });
        child.on("exit", () => done());
      });

      const body = JSON.parse(readFileSync(path, "utf8")) as { network: string; rows: unknown[] };
      expect(body.network).toBe("fake");
      expect(body.rows).toHaveLength(4_000);
    }
  }, 120_000);
});
