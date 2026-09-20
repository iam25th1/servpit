import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const root = process.cwd();
const EM_DASH = String.fromCharCode(0x2014);

function isIgnored(path: string): boolean {
  const r = spawnSync("git", ["check-ignore", "-q", path], { cwd: root });
  return r.status === 0;
}

describe("gitignore policy", () => {
  it("ignores zip archives", () => {
    expect(isIgnored("ninja-adventure.zip")).toBe(true);
  });

  it("ignores __MACOSX directories", () => {
    expect(isIgnored("__MACOSX/Faceset.png")).toBe(true);
    expect(isIgnored("staging/__MACOSX/x.png")).toBe(true);
  });

  it("does not ignore the lockfile", () => {
    expect(isIgnored("package-lock.json")).toBe(false);
  });

  it("does not ignore public assets", () => {
    expect(isIgnored("public/assets/manifest.json")).toBe(false);
    expect(isIgnored("public/assets/Knight/Faceset.png")).toBe(false);
  });
});

describe("em dash ban", () => {
  it("no tracked or new text file contains an em dash", () => {
    const listed = spawnSync(
      "git",
      ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
      { cwd: root, encoding: "utf8" },
    );
    const textExt = /\.(ts|tsx|mts|mjs|js|json|md|yml|yaml|css)$/;
    const offenders: string[] = [];
    for (const file of listed.stdout.split("\0")) {
      if (!file || !textExt.test(file)) continue;
      const path = `${root}/${file}`;
      if (!existsSync(path)) continue;
      const body = readFileSync(path, "utf8");
      if (body.includes(EM_DASH)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });
});
