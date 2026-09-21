// Refuses to run a money surface on a guessed wallet backend.
//
// readEnv works the backend out from which keys are present when
// WALLET_BACKEND is unset. That is a reasonable default for the app, and a
// hazard for a script that moves money: with no keys loaded it quietly
// selects the fake chain, prints a plan full of plausible numbers, writes
// fake transaction hashes and exits zero. It looks exactly like a successful
// run. That is how a funding run appeared to work while touching nothing.

import type { ServerEnv } from "../../src/server/env";

/**
 * Throws unless the backend was named outright. Returns nothing; the caller
 * carries on only if the environment said which chain it meant.
 */
export function requireDeclaredBackend(env: Pick<ServerEnv, "walletBackend" | "backendSource">, envFile: string | null): void {
  if (env.backendSource === "declared") return;
  const where = envFile === null ? "no .env.local was found" : `${envFile} does not set it`;
  throw new Error(
    [
      `WALLET_BACKEND is not set and ${where}.`,
      `This would have run against the ${env.walletBackend} chain without saying so.`,
      "Set WALLET_BACKEND=viem to settle on Base Sepolia, or WALLET_BACKEND=fake to run against the in memory chain on purpose.",
    ].join("\n"),
  );
}
