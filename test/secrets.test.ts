import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
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

const SECRET_NAMES = ["SERV_API_KEY", "CDP_API_KEY_SECRET", "CDP_WALLET_SECRET", "OPERATOR_TOKEN"];

/**
 * Names whose values must never be in a bundle either.
 *
 * A wallet key is the obvious one. An RPC url is the quiet one: a keyed
 * endpoint carries its credential in the path, so a url in a client bundle is
 * a paid endpoint anybody can spend, and it names the provider either way.
 */
const PRIVATE_VALUE_NAMES = [...SECRET_NAMES, "BASE_SEPOLIA_RPC_URL", "BASE_SEPOLIA_RPC_URLS", "SERVPIT_KEY_ATLAS", "SERVPIT_KEY_BLAZE", "SERVPIT_KEY_COMET", "SERVPIT_KEY_DELTA", "SERVPIT_KEY_EMBER", "SERVPIT_KEY_FLINT", "SERVPIT_KEY_POT", "SERVPIT_KEY_BANK", "SERVPIT_KEY_OPERATOR"];

describe("secrets never reach the client", () => {
  it("no source file exposes a secret through a NEXT_PUBLIC variable", () => {
    const sources = filesUnder(join(root, "src"), /\.(ts|tsx)$/);
    const offenders = sources.filter((f) => /NEXT_PUBLIC_[A-Z_]*(KEY|SECRET|TOKEN)/.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });

  it("no client component reads a secret from the environment", () => {
    const sources = filesUnder(join(root, "src"), /\.(ts|tsx)$/);
    const offenders: string[] = [];
    for (const file of sources) {
      const body = readFileSync(file, "utf8");
      const isClient = /^\s*["']use client["']/m.test(body);
      if (isClient && SECRET_NAMES.some((name) => body.includes(name))) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  it("no built client bundle carries a wallet key, an rpc endpoint or a stack trace", () => {
    const staticDir = join(root, ".next", "static");
    if (!existsSync(staticDir)) return;
    const offenders: string[] = [];
    for (const file of filesUnder(staticDir, /\.js$/)) {
      const body = readFileSync(file, "utf8");
      for (const name of PRIVATE_VALUE_NAMES) {
        const value = process.env[name];
        if (value && value.length >= 12 && body.includes(value)) offenders.push(`${file} contains the value of ${name}`);
      }
      // A 32 byte hex literal is the shape of a private key. The client has
      // no business holding one, whatever it came from.
      if (/\b0x[0-9a-fA-F]{64}\b/.test(body)) offenders.push(`${file}: 64 hex literal`);
      // An absolute path from the machine that built it is how a stack trace
      // and a directory layout reach a browser.
      if (/\/Users\/[a-z0-9]+\/|\/home\/[a-z0-9]+\//i.test(body)) offenders.push(`${file}: a path from the build machine`);
    }
    expect(offenders).toEqual([]);
  });

  it("no built client bundle contains a secret name or value", () => {
    const staticDir = join(root, ".next", "static");
    if (!existsSync(staticDir)) {
      // The build has not run in this working tree; CI runs it before this test.
      return;
    }
    const bundles = filesUnder(staticDir, /\.js$/);
    expect(bundles.length).toBeGreaterThan(0);
    const offenders: string[] = [];
    for (const file of bundles) {
      const body = readFileSync(file, "utf8");
      for (const name of SECRET_NAMES) {
        if (body.includes(name)) offenders.push(`${file} contains ${name}`);
      }
      for (const name of SECRET_NAMES) {
        const value = process.env[name];
        if (value && value.length >= 8 && body.includes(value)) offenders.push(`${file} contains the value of ${name}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("server only modules are never imported from a client component", () => {
    const clientFiles = filesUnder(join(root, "src"), /\.(ts|tsx)$/).filter((f) => /^\s*["']use client["']/m.test(readFileSync(f, "utf8")));
    const offenders: string[] = [];
    for (const file of clientFiles) {
      const body = readFileSync(file, "utf8");
      if (/from ["']@\/server\//.test(body) || /from ["'].*\/server\/(env|context|serv|wallets)/.test(body)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  /**
   * A transaction hash is 32 bytes of hex and so is a private key. A hash
   * inside a block explorer link is a public record, so those are removed
   * before scanning. A bare literal anywhere else still fails, which the
   * companion test in env-safety.test.ts proves directly.
   */
  const EXPLORER_TX = /https:\/\/[a-z.]*basescan\.org\/tx\/0x[0-9a-fA-F]{64}\b/g;

  it("no tracked file contains a private key, mnemonic or api key literal", () => {
    const listed = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" }).split("\0").filter(Boolean);
    const offenders: string[] = [];
    for (const rel of listed) {
      if (!/\.(ts|tsx|json|md|yml|yaml|env|txt)$/.test(rel)) continue;
      if (rel === "test/secrets.test.ts" || rel === "package-lock.json") continue;
      const path = join(root, rel);
      if (!existsSync(path)) continue;
      const body = readFileSync(path, "utf8").replace(EXPLORER_TX, "");
      if (/\b0x[0-9a-fA-F]{64}\b/.test(body)) offenders.push(`${rel}: 64 hex literal`);
      if (/\bsk-[A-Za-z0-9_-]{20,}\b/.test(body)) offenders.push(`${rel}: api key literal`);
    }
    expect(offenders).toEqual([]);
  });
});
