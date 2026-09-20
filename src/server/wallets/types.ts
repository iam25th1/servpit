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
  userOpHash: string;
  txHash: string;
  status: "complete";
}

export interface Wallet {
  readonly id: string;
  readonly address: string;
  /** Current on chain balance in wei. */
  getBalance(): Promise<bigint>;
  /** Sends all calls as one user operation. The backend must dedupe on idempotencyKey. */
  send(calls: readonly Call[], idempotencyKey: string): Promise<TxReceipt>;
}

export interface Chain {
  readonly kind: "fake" | "cdp";
  readonly network: string;
  /** Opens the wallet for an id. With an address, loads that wallet; without, creates one. */
  open(id: string, address?: string): Promise<Wallet>;
}

export const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
export const WALLET_ID = /^[A-Za-z0-9_-]{1,64}$/;
