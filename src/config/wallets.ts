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

/**
 * The bank's wallet, which lends to agents and holds what it recovers.
 *
 * Optional, and separate from WALLET_IDS on purpose. Nothing in a round reads
 * it and the server runs perfectly without the key, so an existing install
 * that has never generated one is not broken by its existence. It is here so
 * a key can be generated and funded ahead of the lending that will use it.
 */
export const BANK_WALLET_ID = "bank";

/** Wallets the system uses when a key exists and runs fine without. */
export const OPTIONAL_WALLET_IDS: readonly string[] = Object.freeze([BANK_WALLET_ID]);

/** Every wallet a key can be generated for, required ones first. */
export const ALL_WALLET_IDS: readonly string[] = Object.freeze([...WALLET_IDS, ...OPTIONAL_WALLET_IDS]);

/** Every key variable, so all of them are registered as secrets. */
export const ALL_KEY_VARS: readonly string[] = Object.freeze(ALL_WALLET_IDS.map(keyVarFor));

/** The wallet funded first from a faucet, which then fans out to the rest. */
export const FUNDER_WALLET_ID = WALLET_IDS[0];
