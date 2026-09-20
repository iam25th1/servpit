import { describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = process.cwd();

function filesUnder(dir: string, match: RegExp): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (match.test(p)) out.push(p);
    }
  };
  walk(dir);
  return out;
}

const isIgnored = (path: string): boolean => spawnSync("git", ["check-ignore", "-q", path], { cwd: root }).status === 0;

/** Every environment variable that can hold key material. */
const KEY_VARS = ["SERVPIT_KEY_ATLAS", "SERVPIT_KEY_BLAZE", "SERVPIT_KEY_COMET", "SERVPIT_KEY_DELTA", "SERVPIT_KEY_EMBER", "SERVPIT_KEY_FLINT", "SERVPIT_KEY_POT"];

describe("key material never reaches the repository", () => {
  it("gitignores .env.local and its variants", () => {
    expect(isIgnored(".env.local")).toBe(true);
    expect(isIgnored(".env.production.local")).toBe(true);
    expect(isIgnored("data/wallets-base-sepolia.json")).toBe(true);
  });

  it("no tracked file contains a private key literal", () => {
    const listed = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" }).split("\0").filter(Boolean);
    const offenders: string[] = [];
    for (const rel of listed) {
      if (!/\.(ts|tsx|json|md|yml|yaml|env|txt|mjs|js)$/.test(rel)) continue;
      if (rel === "test/env-safety.test.ts" || rel === "test/secrets.test.ts" || rel === "package-lock.json") continue;
      const body = readFileSync(join(root, rel), "utf8");
      if (/\b0x[0-9a-fA-F]{64}\b/.test(body)) offenders.push(`${rel}: 32 byte hex literal`);
    }
    expect(offenders).toEqual([]);
  });

  it("no key variable name appears in a built client bundle", () => {
    const staticDir = join(root, ".next", "static");
    if (!existsSync(staticDir)) return;
    const bundles = filesUnder(staticDir, /\.js$/);
    expect(bundles.length).toBeGreaterThan(0);
    const offenders: string[] = [];
    for (const file of bundles) {
      const body = readFileSync(file, "utf8");
      for (const name of [...KEY_VARS, "RPC_URL", "WALLET_BACKEND"]) {
        if (body.includes(name)) offenders.push(`${file} contains ${name}`);
      }
      // A real key from the environment must never appear either.
      for (const name of KEY_VARS) {
        const value = process.env[name];
        if (value && value.length >= 16 && body.includes(value)) offenders.push(`${file} contains the value of ${name}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("no client component reads a key variable", () => {
    const sources = filesUnder(join(root, "src"), /\.(ts|tsx)$/);
    const offenders: string[] = [];
    for (const file of sources) {
      const body = readFileSync(file, "utf8");
      if (!/^\s*["']use client["']/m.test(body)) continue;
      if (KEY_VARS.some((name) => body.includes(name)) || /SERVPIT_KEY|PRIVATE_KEY/.test(body)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  it("the key generator writes one key per wallet, readable only by the owner", () => {
    const dir = mkdtempSync(join(tmpdir(), "servpit-gen-"));
    try {
      const target = join(dir, ".env.local");
      const r = spawnSync("npx", ["tsx", "scripts/generate-wallets.ts"], { cwd: root, encoding: "utf8", env: { ...process.env, SERVPIT_ENV_FILE: target } });
      expect(r.status, r.stderr).toBe(0);
      const body = readFileSync(target, "utf8");
      for (const name of KEY_VARS) expect(body, name).toContain(`${name}=0x`);
      expect((statSync(target).mode & 0o077).toString(8)).toBe("0");
      // Addresses are printed, key material never is.
      expect(r.stdout).toMatch(/0x[0-9a-fA-F]{40}/);
      expect(r.stdout).not.toMatch(/0x[0-9a-fA-F]{64}/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it("the key generator refuses to write into a tracked path", () => {
    const r = spawnSync("npx", ["tsx", "scripts/generate-wallets.ts"], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, SERVPIT_ENV_FILE: join(root, "src", "keys.env") },
    });
    expect(r.status).not.toBe(0);
    expect(`${r.stdout}${r.stderr}`).toMatch(/not gitignored/);
    expect(existsSync(join(root, "src", "keys.env"))).toBe(false);
  }, 60_000);

  it("the key generator refuses to overwrite existing keys without --force", () => {
    const dir = mkdtempSync(join(tmpdir(), "servpit-gen2-"));
    try {
      const target = join(dir, ".env.local");
      writeFileSync(target, "SERVPIT_KEY_ATLAS=0xexisting\n");
      const r = spawnSync("npx", ["tsx", "scripts/generate-wallets.ts"], { cwd: root, encoding: "utf8", env: { ...process.env, SERVPIT_ENV_FILE: target } });
      expect(r.status).not.toBe(0);
      expect(readFileSync(target, "utf8")).toContain("0xexisting");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
