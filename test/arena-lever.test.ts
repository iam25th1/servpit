// With the pit running itself there is one writer, and it is not the browser.
//
// Both lever routes have to refuse while arena mode is on, and both have to
// behave exactly as they did while it is off. The refusal is checked in the
// source rather than by starting Next, the same way the settle isolation walk
// reads the import graph: what matters is that the check is the first thing
// either route does, before a context is built, before a plan is made and
// before anything is paid for.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ARENA_RUNNING } from "@/server/arena/message";

const ROUTES = ["src/app/api/round/plan/route.ts", "src/app/api/round/run/route.ts"];
const source = (file: string): string => readFileSync(join(process.cwd(), file), "utf8");

describe("the lever, while the pit runs itself", () => {
  it("refuses in both routes", () => {
    for (const file of ROUTES) {
      const body = source(file);
      expect(body).toMatch(/if \(arenaMode\(\)\) return Response\.json\(/);
      expect(body).toMatch(/ARENA_RUNNING/);
    }
  });

  it("refuses before it builds a context or spends anything", () => {
    for (const file of ROUTES) {
      const body = source(file);
      const refusal = body.indexOf("if (arenaMode())");
      const context = body.search(/await get(Server|Settle)Context\(\)/);
      expect(refusal).toBeGreaterThan(0);
      expect(context).toBeGreaterThan(refusal);
    }
  });

  it("says one plain sentence, with nothing in it about workers or locks", () => {
    expect(ARENA_RUNNING).toBe("The pit is running itself right now. Watch the next round rather than starting one.");
    for (const word of ["worker", "lock", "flag", "SERVPIT", "process"]) {
      expect(ARENA_RUNNING.toLowerCase()).not.toContain(word.toLowerCase());
    }
  });

  it("is the only thing arena mode changes in either route", () => {
    // Everything else in the lever path stays as it was: one mention each, so
    // a future change cannot quietly branch the settle on it.
    for (const file of ROUTES) {
      expect(source(file).match(/arenaMode\(\)/g) ?? []).toHaveLength(1);
    }
  });
});
