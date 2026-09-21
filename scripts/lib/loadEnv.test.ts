import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { envFilePath, loadLocalEnv } from "./loadEnv";

const made: string[] = [];
const sandbox = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "servpit-env-"));
  made.push(dir);
  return dir;
};

afterEach(() => {
  delete process.env.SERVPIT_ENV_FILE;
  delete process.env.SERVPIT_TEST_ONLY_VALUE;
  for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("envFilePath", () => {
  it("is .env.local at the repo root by default", () => {
    expect(envFilePath().endsWith("/.env.local")).toBe(true);
  });

  it("honours the same override generate-wallets writes through", () => {
    const path = join(sandbox(), "custom.env");
    process.env.SERVPIT_ENV_FILE = path;
    expect(envFilePath()).toBe(path);
  });
});

describe("loadLocalEnv", () => {
  it("loads the file and reports the path", () => {
    const path = join(sandbox(), "custom.env");
    writeFileSync(path, "SERVPIT_TEST_ONLY_VALUE=from-file\n");
    process.env.SERVPIT_ENV_FILE = path;
    expect(loadLocalEnv()).toBe(path);
    expect(process.env.SERVPIT_TEST_ONLY_VALUE).toBe("from-file");
  });

  it("returns null when there is no file, rather than throwing", () => {
    process.env.SERVPIT_ENV_FILE = join(sandbox(), "absent.env");
    expect(loadLocalEnv()).toBeNull();
  });

  it("does not override a value already set in the environment", () => {
    // An explicit WALLET_BACKEND=fake on the command line has to win over
    // the file, or there is no way to force the fake chain.
    const path = join(sandbox(), "custom.env");
    writeFileSync(path, "SERVPIT_TEST_ONLY_VALUE=from-file\n");
    process.env.SERVPIT_ENV_FILE = path;
    process.env.SERVPIT_TEST_ONLY_VALUE = "from-shell";
    loadLocalEnv();
    expect(process.env.SERVPIT_TEST_ONLY_VALUE).toBe("from-shell");
  });
});
