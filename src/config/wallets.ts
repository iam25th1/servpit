// Which wallets exist and which environment variable holds each key. Names
// only: no key material, so this file is safe to read anywhere on the server.
// A key is never stored in a tracked file, never in the manifest, and never
// in the wallet address registry.

import { NAMED_AGENTS, POT_WALLET_ID } from "./agents";

/** Every wallet the system holds, agents first, pot last. */
export const WALLET_IDS: readonly string[] = Object.freeze([...NAMED_AGENTS.map((a) => a.id), POT_WALLET_ID]);

/** Environment variable holding the private key for a wallet id. */
export function keyVarFor(walletId: string): string {
  return `SERVPIT_KEY_${walletId.toUpperCase()}`;
}

export const KEY_VARS: readonly string[] = Object.freeze(WALLET_IDS.map(keyVarFor));

/** The wallet funded first from a faucet, which then fans out to the rest. */
export const FUNDER_WALLET_ID = WALLET_IDS[0];
