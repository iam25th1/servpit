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
  /**
   * What the sender paid in fees, from the receipt. Zero on a chain that does
   * not charge. Reconciliation needs it because a plain account funds its own
   * gas, so a raw balance delta is the stake plus this.
   */
  feeWei: bigint;
}

/**
 * What the chain knows about a transaction this system broadcast.
 *
 * The distinction that matters is between "we do not know" and "it is gone".
 * Resending on the first is how a transfer gets paid twice.
 */
export type BroadcastState =
  | { state: "mined"; receipt: TxReceipt }
  | { state: "reverted"; txHash: string }
  /** In a mempool. It can still land, so it must not be replaced. */
  | { state: "pending" }
  /**
   * Not mined, not in any mempool this chain can see, and the sender has
   * nothing queued. As settled as an RPC can make it, and the only state in
   * which a resend is allowed.
   */
  | { state: "dropped" }
  /** Unknown to the chain while the sender still has work queued. Never resend. */
  | { state: "unknown" };

export interface SendOptions {
  /**
   * Fires with the hash the moment the transaction is accepted by the node,
   * before the wait for its receipt. A receipt wait that times out must not
   * lose the hash: without it the caller cannot tell a transfer that landed
   * from one that never left, and resending is a double payment.
   */
  onBroadcast?: (txHash: string) => void;
  /**
   * Send under this exact nonce rather than the next one.
   *
   * Only for resending a transfer the chain will not account for. One
   * transaction per nonce can ever mine, so a resend under the nonce the
   * original used replaces it or loses to it, and either way the money moves
   * once. Sending the same transfer under a fresh nonce is what pays twice.
   */
  nonce?: number;
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
  send(calls: readonly Call[], idempotencyKey: string, options?: SendOptions): Promise<TxReceipt>;
  /**
   * The nonce the next transaction from this wallet will use.
   *
   * Read before sending and recorded with the transfer, so a resend can be
   * made under the same one. It is only the nonce that will be used because
   * one settle runs at a time and nothing else holds this key.
   */
  nextNonce(): Promise<number>;
  /** The nonce a broadcast transaction used, or null when the chain cannot say. */
  nonceOf(txHash: string): Promise<number | null>;
  /** Waits again for a transaction already broadcast. */
  awaitReceipt(txHash: string): Promise<TxReceipt>;
  /** What became of a transaction this wallet broadcast. */
  checkBroadcast(txHash: string): Promise<BroadcastState>;
}

export interface Chain {
  readonly kind: "fake" | "viem";
  readonly network: string;
  /** True when this is a real chain, so transaction hashes are worth linking. */
  readonly settles: boolean;
  /**
   * Wei to keep back for gas. Zero where gas is free or sponsored; on a real
   * chain with plain accounts the agent pays its own, so a wallet that can
   * cover only the stake cannot actually enter.
   */
  readonly gasReserveWei: bigint;
  /** Opens the wallet for an id. With an address, loads that wallet; without, creates one. */
  open(id: string, address?: string): Promise<Wallet>;
  /**
   * Every balance in as few requests as the chain allows.
   *
   * A round reads seven wallets. One at a time that is seven round trips and
   * seven chances to time out; the real chain does it in a single eth_call.
   * Keyed by address, and an address the chain could not answer for is absent
   * rather than zero: a missing balance is not a balance of nothing.
   */
  getBalances(addresses: readonly string[]): Promise<Record<string, bigint>>;
}

export const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
export const TX_HASH = /^0x[0-9a-fA-F]{64}$/;
export const WALLET_ID = /^[A-Za-z0-9_-]{1,64}$/;
