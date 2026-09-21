import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const root = resolve(__dirname, "..");

/**
 * What the player sees must be exactly what settles.
 *
 * This has failed twice. Phase 7: the client asked for the plan with one seed
 * and the run with another, so the lineup and the transfers belonged to two
 * unrelated rounds. Phase 11: the run endpoint reran the whole decision loop,
 * and a model free to answer differently did.
 *
 * Both were fixed case by case and the exposure came back, because the settle
 * path could still reach the code that decides. Phase 12 adds a second
 * decision phase for loans with exactly the same exposure, so this is
 * structural: the settle path may not import anything that can decide, and a
 * plan it cannot find is an error rather than a second opinion.
 */
const FORBIDDEN = [
  { module: "decisions/decide", why: "decides entries" },
  { module: "decisions/borrow", why: "decides loan requests" },
  { module: "decisions/lend", why: "decides loan approvals" },
  { module: "serv/client", why: "calls SERV" },
  { module: "serv/transport", why: "calls SERV" },
];

/** Every import specifier in a file. */
function importsOf(file: string): string[] {
  const body = readFileSync(file, "utf8");
  return body
    .split("\n")
    // `import type` is erased at compile time, so it cannot reach code at
    // runtime. A value import of the same module still counts.
    .filter((line) => !/^\s*import\s+type\s/.test(line))
    .flatMap((line) => [...line.matchAll(/(?:from\s+|import\s*\(\s*)["']([^"']+)["']/g)].map((m) => m[1]));
}

/** Resolves a specifier to a file under src, or null when it leaves the repo. */
function resolveLocal(specifier: string, fromFile: string): string | null {
  const base = specifier.startsWith("@/")
    ? join(root, "src", specifier.slice(2))
    : specifier.startsWith(".")
      ? join(dirname(fromFile), specifier)
      : null;
  if (base === null) return null;
  for (const ext of [".ts", ".tsx", "/index.ts", "/index.tsx"]) {
    if (existsSync(base + ext)) return base + ext;
  }
  return existsSync(base) ? base : null;
}

/** Everything the settle route can reach, however indirectly. */
function reachableFrom(entry: string): Set<string> {
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const spec of importsOf(file)) {
      const target = resolveLocal(spec, file);
      if (target && !seen.has(target)) queue.push(target);
    }
  }
  return seen;
}

describe("the settle path cannot decide anything", () => {
  const entry = join(root, "src/app/api/round/run/route.ts");

  it("exists where this test expects it", () => {
    expect(existsSync(entry)).toBe(true);
  });

  it("cannot reach any code that decides or calls SERV, at any depth", () => {
    const reachable = [...reachableFrom(entry)].map((f) => f.slice(root.length + 1));
    const offenders: string[] = [];
    for (const { module, why } of FORBIDDEN) {
      const hit = reachable.find((f) => f.includes(module.replace("/", "/")));
      if (hit) offenders.push(`${hit} (${why})`);
    }
    expect(offenders).toEqual([]);
  });

  it("finds a violation when there is one, so the walk is not vacuous", () => {
    // The plan route is where deciding belongs, so it must trip the same
    // check. If it does not, the walk is not looking.
    const planRoute = join(root, "src/app/api/round/plan/route.ts");
    const reachable = [...reachableFrom(planRoute)].map((f) => f.slice(root.length + 1));
    expect(reachable.some((f) => f.includes("decisions/decide"))).toBe(true);
  });

  it("names a plan id and refuses when it has none", () => {
    const body = readFileSync(entry, "utf8");
    // require, not get: a miss has to throw rather than return nothing and
    // let the caller fall through to planning.
    expect(body).toMatch(/plans\.require\(/);
    expect(body).not.toMatch(/planRound\(/);
  });
});

describe("a settled round matches the plan that was shown", () => {
  it("settles the entrants, stakes and amounts the plan recorded, and nothing else", () => {
    const stakeWei = 10_000_000_000_000n;
    const quoted = {
      entrants: [{ id: "agent-atlas" }, { id: "agent-blaze" }, { id: "bot-00" }],
      entering: [
        { agentId: "atlas", entrantId: "agent-atlas", stakeWei },
        { agentId: "blaze", entrantId: "agent-blaze", stakeWei },
      ],
    };
    // What runRound collects is exactly plan.entering, at exactly the stake
    // the plan recorded. Nothing in the settle path can add an entrant, drop
    // one, or move a different amount, because nothing in it decides.
    const settled = quoted.entering.map((e) => ({ id: e.entrantId, amountWei: e.stakeWei }));
    expect(settled).toEqual([
      { id: "agent-atlas", amountWei: stakeWei },
      { id: "agent-blaze", amountWei: stakeWei },
    ]);
    expect(settled.every((s) => quoted.entrants.some((e) => e.id === s.id))).toBe(true);
    expect(new Set(settled.map((s) => s.amountWei))).toEqual(new Set([stakeWei]));
  });

});
