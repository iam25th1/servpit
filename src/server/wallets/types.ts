// Wallet abstraction the round flow talks to. Two implementations: the CDP
// smart wallet backend (real base-sepolia) and an in memory fake used by
// tests and by local runs without credentials. Balances are always read
// through getBalance, never cached inside the wallet.

export interface Call {
  to: string;
  value: bigint;
  data?: `0x${string}`;
}

export interface TxReceipt {
  txHash: string;
  status: "complete";
}

export interface Wallet {
  readonly id: string;
  readonly address: string;
  /** Current on chain balance in wei. */
  getBalance(): Promise<bigint>;
  /**
   * Sends the calls and resolves once they are on chain. A smart wallet could
   * batch them; an externally owned account sends them in order. The receipt
   * describes the last one.
   */
  send(calls: readonly Call[], idempotencyKey: string): Promise<TxReceipt>;
}

export interface Chain {
  readonly kind: "fake" | "viem";
  readonly network: string;
  /** True when this is a real chain, so transaction hashes are worth linking. */
  readonly settles: boolean;
  /** Opens the wallet for an id. With an address, loads that wallet; without, creates one. */
  open(id: string, address?: string): Promise<Wallet>;
}

export const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
export const WALLET_ID = /^[A-Za-z0-9_-]{1,64}$/;
