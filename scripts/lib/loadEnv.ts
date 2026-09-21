// Loads .env.local for a script run directly under tsx.
//
// Next loads .env.local for the app, but tsx does not load anything, so a
// script run from the command line saw none of the keys and readEnv fell
// back to the fake chain. Silently: the script printed a plan, sent nothing
// real, and looked like it had worked.
//
// process.loadEnvFile is built into Node, so this costs no dependency. It is
// the same path generate-wallets writes to, including the SERVPIT_ENV_FILE
// override that lets a test run in a sandbox.

import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** The file the keys live in, honouring the same override generate-wallets uses. */
export function envFilePath(): string {
  return resolve(process.env.SERVPIT_ENV_FILE ?? join(repoRoot, ".env.local"));
}

/**
 * Loads the env file if it is there. Returns the path it loaded, or null.
 *
 * Values already in the environment win, which is what process.loadEnvFile
 * does: an explicit `WALLET_BACKEND=fake npm run round` is not overridden by
 * the file.
 */
export function loadLocalEnv(): string | null {
  const path = envFilePath();
  if (!existsSync(path)) return null;
  process.loadEnvFile(path);
  return path;
}
