// Generates one private key per wallet and writes a .env.local template.
//
//   npm run generate-wallets            first run, writes the whole file
//   npm run generate-wallets -- --add   adds only the keys that are missing
//
// Keys are written to .env.local only, which is gitignored. Nothing is
// printed except addresses: a key that reaches a terminal is a key in a
// scrollback buffer, a screen recording and a shell history file.
//
// The file is written to a temporary staging path first and moved into place,
// so an interrupted run cannot leave a half written key file behind. The
// staging path is removed on every exit, successful or not.
//
// --add exists because the set of wallets grew after the keys were funded.
// It appends, and only appends: the existing bytes are written back as the
// exact prefix of the new file, so a key that holds funds cannot be rewritten
// by a run that was only meant to add one. It is a separate flag rather than
// the default for an existing file, so the bare command still refuses to
// touch a file it did not create.

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { ALL_WALLET_IDS, FUNDER_WALLET_ID, keyVarFor } from "../src/config/wallets";

const repoRoot = resolve(import.meta.dirname, "..");
// SERVPIT_ENV_FILE exists so tests can run this in a sandbox. It cannot be
// used to smuggle keys into the repository: the guard below refuses any path
// git would track.
const envPath = resolve(process.env.SERVPIT_ENV_FILE ?? join(repoRoot, ".env.local"));

/**
 * Refuses to write key material anywhere git would pick it up. A path outside
 * the repository is fine; a path inside it must be gitignored.
 */
function assertUntracked(target: string): void {
  const inRepo = target === repoRoot || target.startsWith(repoRoot + "/");
  if (!inRepo) return;
  const ignored = spawnSync("git", ["check-ignore", "-q", target], { cwd: repoRoot }).status === 0;
  if (!ignored) {
    throw new Error(`refusing to write keys to ${target}: it is inside the repository and not gitignored`);
  }
}

interface Generated {
  id: string;
  privateKey: `0x${string}`;
  address: string;
}

const generate = (id: string): Generated => {
  const privateKey = generatePrivateKey();
  return { id, privateKey, address: privateKeyToAccount(privateKey).address };
};

/** Every key variable the file already assigns, however it is spaced. */
function declaredIn(body: string): Set<string> {
  const declared = new Set<string>();
  for (const line of body.split("\n")) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
    if (match) declared.add(match[1]);
  }
  return declared;
}

/** Writes through a staging file, so an interrupted run leaves nothing partial. */
function writeAtomically(target: string, body: string): void {
  assertUntracked(target);
  const staging = mkdtempSync(join(tmpdir(), "servpit-keys-"));
  const stagedFile = join(staging, "env.local");
  try {
    writeFileSync(stagedFile, body, { mode: 0o600 });
    if (!existsSync(dirname(target))) throw new Error(`no such directory: ${dirname(target)}`);
    renameSync(stagedFile, target);
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

/**
 * Appends the keys that are not there yet, and nothing else.
 *
 * The existing bytes go back out unchanged as the prefix of the new file. A
 * key that already holds funds is never rewritten, reordered or reformatted,
 * which is the only property that makes this safe to run against a funded
 * install.
 */
function addMissing(): void {
  const existing = readFileSync(envPath, "utf8");
  const declared = declaredIn(existing);
  const missing = ALL_WALLET_IDS.filter((id) => !declared.has(keyVarFor(id)));

  if (missing.length === 0) {
    console.log(`${envPath} already has a key for every wallet. Nothing to add.`);
    return;
  }

  const added = missing.map(generate);
  // One line per key and nothing else. No banner, no dated comment: the file
  // grows by exactly what was asked for, so a diff against a backup is one
  // line per new wallet and trivially reviewable.
  const block = added.map((w) => `${keyVarFor(w.id)}=${w.privateKey}\n`).join("");
  writeAtomically(envPath, existing.endsWith("\n") || existing.length === 0 ? existing + block : `${existing}\n${block}`);

  console.log(`Added ${added.length} key${added.length === 1 ? "" : "s"} to ${envPath}. Nothing else in the file was touched.\n`);
  console.log("Addresses, which are the only part safe to share:");
  for (const w of added) console.log(`  ${w.id.padEnd(6)} ${w.address}`);
}

function main(): void {
  if (process.argv.includes("--add")) {
    if (!existsSync(envPath)) {
      console.error(`${envPath} does not exist. Run npm run generate-wallets without --add to create it.`);
      process.exitCode = 1;
      return;
    }
    addMissing();
    return;
  }

  if (existsSync(envPath) && !process.argv.includes("--force")) {
    console.error(`${envPath} already exists. Refusing to overwrite keys that may hold funds.`);
    console.error("To add only the keys that are missing, without touching the rest:\n");
    console.error("  npm run generate-wallets -- --add\n");
    console.error("Pass --force only if you are certain those wallets are empty.");
    process.exitCode = 1;
    return;
  }

  const wallets = ALL_WALLET_IDS.map(generate);

  const lines = [
    "# Generated by npm run generate-wallets. Private keys: never commit this file.",
    "# It is gitignored, and a test fails if that ever stops being true.",
    "",
    "WALLET_BACKEND=viem",
    "# Optional. Defaults to the public Base Sepolia endpoint, which is rate limited.",
    "# RPC_URL=https://sepolia.base.org",
    "",
    ...wallets.map((w) => `${keyVarFor(w.id)}=${w.privateKey}`),
    "",
  ];

  writeAtomically(envPath, lines.join("\n"));

  console.log(`Wrote ${ALL_WALLET_IDS.length} keys to ${envPath} (mode 600, gitignored).\n`);
  console.log("Addresses, which are the only part safe to share:");
  for (const w of wallets) console.log(`  ${w.id.padEnd(6)} ${w.address}`);

  const funder = wallets.find((w) => w.id === FUNDER_WALLET_ID)!;
  console.log(`\nFund this address first, from a Base Sepolia faucet:\n\n  ${funder.address}\n`);
  console.log("Suggested amount: 0.02 ETH, which covers the fan out and many rounds of gas.");
  console.log("Faucets: https://portal.cdp.coinbase.com/products/faucet or https://www.alchemy.com/faucets/base-sepolia");
  console.log("\nThen fan it out to the other six:\n\n  npm run fund-wallets\n");
}

main();
