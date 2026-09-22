// What a public deployment exposes, and what it refuses.
//
// The keys of seven wallets sit on this server. The rule for going public is
// that a visitor can read the pit and write exactly one thing, a pick, and
// that everything else which writes or which exists to look at the machinery
// is closed rather than merely unreachable.
//
// This drives the real route handlers with NODE_ENV set to production, rather
// than reading the source and hoping, and it walks the route files so a route
// added later cannot quietly widen the surface without failing here.

import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { cspFor } from "@/proxy";
import { LEVER_CLOSED, NOT_HERE, inProduction } from "@/server/production";

const root = process.cwd();

/** Every route file, with the HTTP methods it exports. */
function routes(): Array<{ path: string; methods: string[] }> {
  const out: Array<{ path: string; methods: string[] }> = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name === "route.ts") {
        const body = readFileSync(p, "utf8");
        const methods = ["GET", "POST", "PUT", "PATCH", "DELETE"].filter((m) => new RegExp(`export async function ${m}\\b|export function ${m}\\b`).test(body));
        out.push({ path: p.slice(root.length + 1).replace(/\\/g, "/"), methods });
      }
    }
  };
  walk(join(root, "src/app/api"));
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

describe("the route inventory", () => {
  it("is the set of routes this deployment means to have", () => {
    expect(routes().map((r) => `${r.path} ${r.methods.join(",")}`)).toEqual([
      "src/app/api/agents/route.ts GET",
      "src/app/api/arena/route.ts GET",
      "src/app/api/arena/stream/route.ts GET",
      "src/app/api/backing/route.ts GET,POST",
      "src/app/api/graveyard/route.ts GET",
      "src/app/api/health/route.ts GET",
      "src/app/api/leaderboard/route.ts GET",
      "src/app/api/round/plan/route.ts POST",
      "src/app/api/round/run/route.ts POST",
    ]);
  });

  it("has exactly three routes that accept a write at all", () => {
    const writers = routes().filter((r) => r.methods.some((m) => m !== "GET"));
    expect(writers.map((r) => r.path)).toEqual(["src/app/api/backing/route.ts", "src/app/api/round/plan/route.ts", "src/app/api/round/run/route.ts"]);
  });

  it("closes both of the writing routes that are not picks, in their own source", () => {
    // Read rather than driven, because driving them imports the wallet stack.
    // Driven versions are below, where the guard returns before it.
    for (const path of ["src/app/api/round/plan/route.ts", "src/app/api/round/run/route.ts"]) {
      expect(readFileSync(join(root, path), "utf8"), path).toContain("inProduction()");
    }
  });
});

describe("in production", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "servpit-public-"));
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("WALLET_BACKEND", "fake");
    vi.stubEnv("SERVPIT_DATA_DIR", dir);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(dir, { recursive: true, force: true });
  });

  it("knows it is in production", () => {
    expect(inProduction()).toBe(true);
    expect(inProduction({ NODE_ENV: "development" } as NodeJS.ProcessEnv)).toBe(false);
  });

  it("does not serve the wallet view, which is every address and balance", async () => {
    const { GET } = await import("@/app/api/agents/route");
    const response = await GET();
    expect(response.status).toBe(404);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe(NOT_HERE);
    expect(JSON.stringify(body)).not.toMatch(/0x[0-9a-fA-F]{10}/);
  });

  it("refuses to plan a round, which spends an operator's credit", async () => {
    const { POST } = await import("@/app/api/round/plan/route");
    const response = await POST(new Request("http://localhost/api/round/plan", { method: "POST", body: JSON.stringify({ seed: "demo", entrants: 24 }) }));
    expect(response.status).toBe(403);
    expect(((await response.json()) as { error: string }).error).toBe(LEVER_CLOSED);
  });

  it("refuses to settle a round, which is the route that moves money", async () => {
    const { POST } = await import("@/app/api/round/run/route");
    const response = await POST(new Request("http://localhost/api/round/run", { method: "POST", body: JSON.stringify({ seed: "demo", entrants: 24 }) }));
    expect(response.status).toBe(403);
    expect(((await response.json()) as { error: string }).error).toBe(LEVER_CLOSED);
  });

  it("still answers the read only routes a viewer needs", async () => {
    const arena = await (await import("@/app/api/arena/route")).GET();
    expect(arena.status).toBe(200);
    const board = await (await import("@/app/api/leaderboard/route")).GET(new NextRequest("http://localhost/api/leaderboard"));
    expect(board.status).toBe(200);
  });

  it("says nothing internal in any of those answers", async () => {
    const bodies: string[] = [];
    bodies.push(await (await (await import("@/app/api/arena/route")).GET()).text());
    bodies.push(await (await (await import("@/app/api/leaderboard/route")).GET(new NextRequest("http://localhost/api/leaderboard"))).text());
    bodies.push(await (await (await import("@/app/api/graveyard/route")).GET()).text());
    bodies.push(await (await (await import("@/app/api/health/route")).GET()).text());
    for (const body of bodies) {
      // No key, no url with a credential in it, no path on the operator's
      // disk, no stack trace.
      expect(body).not.toMatch(/0x[0-9a-fA-F]{64}/);
      expect(body).not.toMatch(/https?:\/\/(?!localhost|sepolia\.basescan\.org|basescan\.org)/);
      expect(body).not.toMatch(/\/Users\/|\/home\/|node_modules/);
      expect(body).not.toMatch(/\bat [A-Za-z]+ \(/);
      expect(body).not.toMatch(/SERV_API_KEY|OPERATOR_TOKEN|SERVPIT_KEY_/);
    }
  });
});

describe("the content security policy", () => {
  it("allows this site and nothing else", () => {
    const policy = cspFor("n0nce", false);
    expect(policy).toContain("default-src 'self'");
    expect(policy).toContain("script-src 'self' 'nonce-n0nce' 'strict-dynamic'");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("connect-src 'self'");
    // No wildcard source anywhere, and no third party host.
    expect(policy).not.toMatch(/\*|https?:\/\//);
  });

  it("never allows an inline script, and never eval outside development", () => {
    const production = cspFor("n0nce", false);
    expect(production).not.toContain("'unsafe-eval'");
    const scripts = production.split("; ").find((line) => line.startsWith("script-src"))!;
    expect(scripts).not.toContain("'unsafe-inline'");
    // In development React rebuilds server stacks with eval, and only there.
    expect(cspFor("n0nce", true)).toContain("'unsafe-eval'");
  });

  it("loosens styles only, and says why in the file", () => {
    expect(cspFor("n0nce", false)).toContain("style-src 'self' 'unsafe-inline'");
    expect(readFileSync(join(root, "src/proxy.ts"), "utf8")).toMatch(/style attribute/);
  });
});

describe("the headers that do not change", () => {
  it("are sent for every path", async () => {
    const config = (await import("../next.config")).default;
    const rules = await config.headers!();
    expect(rules).toHaveLength(1);
    expect(rules[0]!.source).toBe("/:path*");
    const keys = rules[0]!.headers.map((h) => h.key);
    expect(keys).toEqual(
      expect.arrayContaining(["X-Content-Type-Options", "X-Frame-Options", "Referrer-Policy", "Permissions-Policy", "Strict-Transport-Security", "Cross-Origin-Opener-Policy"]),
    );
    expect(rules[0]!.headers.find((h) => h.key === "X-Frame-Options")?.value).toBe("DENY");
    expect(rules[0]!.headers.find((h) => h.key === "X-Content-Type-Options")?.value).toBe("nosniff");
  });
});
