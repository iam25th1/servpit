// A crowd claiming at the same moment, from separate processes.
//
// The rule being proved is the one a read then append cannot keep: a face
// belongs to one fighter, whoever asks and however many processes ask at
// once. Real processes, because appendFileSync is synchronous and a single
// process cannot interleave with itself.

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CLAIMABLE_FACES } from "@/config/fighters";
import { FighterStore } from "./log";

let dir: string;
let file: string;

const fixture = fileURLToPath(new URL("./claims.fixture.ts", import.meta.url));

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "servpit-claim-crowd-"));
  file = join(dir, "fighters-fake.ndjson");
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

const claimer = (prefix: string, count: number, face: string): Promise<string[]> =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", fixture, file, prefix, String(count), face], { stdio: ["ignore", "pipe", "ignore"] });
    let out = "";
    child.stdout.on("data", (chunk) => {
      out += String(chunk);
    });
    child.on("error", reject);
    child.on("exit", () => resolve(out.split("\n").filter((l) => l.length > 0)));
  });

describe("a crowd claiming at once", () => {
  it("gives one face to exactly one fighter", { timeout: 120_000 }, async () => {
    const prefixes = ["ash", "bo", "cy", "di", "el", "fi"];
    const each = 5;
    const answers = (await Promise.all(prefixes.map((prefix) => claimer(prefix, each, "Monk")))).flat();

    expect(answers).toHaveLength(prefixes.length * each);
    expect(answers.filter((a) => a === "claimed")).toHaveLength(1);
    expect(answers.filter((a) => a === "face taken")).toHaveLength(prefixes.length * each - 1);

    const store = new FighterStore(file, "fake");
    const claimed = store.all();
    expect(claimed).toHaveLength(1);
    expect(claimed[0]!.face).toBe("Monk");
    expect(store.freeFaces()).toHaveLength(CLAIMABLE_FACES.length - 1);

    // Every line whole, which is what the append lock is for: a head and the
    // one claim that won.
    const lines = readFileSync(file, "utf8").split("\n").filter((l) => l.length > 0);
    for (const line of lines) expect(() => JSON.parse(line)).not.toThrow();
    expect(lines).toHaveLength(2);
  });

  it("never seats the same handle twice, whoever is asking", { timeout: 120_000 }, async () => {
    // Six processes, all claiming under handles of their own, each taking a
    // different face. Nothing is lost and nothing is doubled.
    const faces = CLAIMABLE_FACES.slice(0, 6);
    await Promise.all(faces.map((face, i) => claimer(`p${i}`, 1, face)));

    const store = new FighterStore(file, "fake");
    const claimed = store.all();
    expect(claimed).toHaveLength(6);
    expect(new Set(claimed.map((f) => f.face)).size).toBe(6);
    expect(new Set(claimed.map((f) => f.handle)).size).toBe(6);
    expect(new Set(claimed.map((f) => f.entrantId)).size).toBe(6);
  });
});
