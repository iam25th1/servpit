// In memory chain for tests and credential free local runs. Deterministic
// addresses per wallet id, exact bigint balances, idempotent sends. It
// counts applied operations and balance reads so tests can prove that a
// retry never double pays and that bankroll comes from the chain.

import { createHash } from "node:crypto";
import { sumWei } from "../money";
import { ADDRESS, TX_HASH, WALLET_ID, type Chain, type TxReceipt, type Wallet } from "./types";

export interface FakeChainOptions {
  initialBalanceWei?: bigint;
  /** Lets a test exercise the gas reserve path without a real chain. */
  gasReserveWei?: bigint;
  /**
   * Makes the wait for a receipt fail after the transaction has been
   * broadcast, which is the case a real chain produces on a slow endpoint and
   * the one that used to lose the hash.
   */
  receiptWaitFails?: (txHash: string) => boolean;
  /**
   * The transaction is accepted, never mines, and moves nothing. The chain
   * cannot say what became of it, which is the state a resend exists for.
   */
  stallsBroadcast?: (txHash: string) => boolean;
  /**
   * The transaction mines and moves the money, and the chain will not admit
   * it exists. The nastier half of the same case: the resend has to be
   * refused by the nonce, because nothing else knows the money has moved.
   */
  hidesBroadcast?: (txHash: string) => boolean;
}

export class FakeChain implements Chain {
  readonly kind = "fake" as const;
  readonly network = "fake";
  /** Not a real chain, so nothing here is worth linking to an explorer. */
  readonly settles = false;
  /** Free by default; a test can charge gas to exercise that exclusion. */
  readonly gasReserveWei: bigint;
  applied = 0;
  /** Broadcasts, including the ones that moved nothing. */
  broadcasts = 0;
  balanceReads = 0;
  private readonly balances = new Map<string, bigint>();
  private readonly receipts = new Map<string, TxReceipt>();
  private readonly initial: bigint;

  /** Transactions broadcast but whose receipt wait was made to fail. */
  private readonly broadcast = new Map<string, TxReceipt>();
  /** Next nonce per address, and the nonces that have actually mined. */
  private readonly nonces = new Map<string, number>();
  private readonly mined = new Map<string, Set<number>>();
  private readonly txNonces = new Map<string, number>();
  /** Broadcast, unmined, and unaccountable. */
  private readonly stalled = new Set<string>();
  /** Mined, and unaccountable. */
  private readonly hidden = new Set<string>();

  constructor(private readonly options: FakeChainOptions = {}) {
    this.initial = options.initialBalanceWei ?? 0n;
    this.gasReserveWei = options.gasReserveWei ?? 0n;
  }

  async open(id: string, address?: string): Promise<Wallet> {
    if (!WALLET_ID.test(id)) throw new RangeError(`wallet id must match ${WALLET_ID}`);
    const addr = address ?? "0x" + createHash("sha256").update(`fake-wallet/${id}`).digest("hex").slice(0, 40);
    if (!ADDRESS.test(addr)) throw new RangeError("address must be 20 bytes of hex");
    if (!this.balances.has(addr)) this.balances.set(addr, this.initial);
    return {
      id,
      address: addr,
      getBalance: async () => {
        this.balanceReads++;
        return this.balances.get(addr) ?? 0n;
      },
      send: async (calls, idempotencyKey, options) => {
        // The key dedupe stands in for the layer above the chain. A resend
        // under an explicit nonce is deliberately not covered by it: that is
        // the case where the chain's own nonce is the only net, and the whole
        // point is to prove it holds.
        if (options?.nonce === undefined) {
          const seen = this.receipts.get(idempotencyKey);
          if (seen) return seen;
        }
        const used = this.minedNonces(addr);
        const nonce = options?.nonce ?? this.nonces.get(addr) ?? 0;
        if (used.has(nonce)) throw new Error(`nonce too low: ${nonce} has already been used by ${addr}`);
        const total = sumWei(calls.map((c) => c.value));
        const balance = this.balances.get(addr) ?? 0n;
        if (balance < total) throw new Error(`insufficient balance: ${balance} wei < ${total} wei`);
        // Every resend of the same idempotency key would be a different
        // transaction on a real chain, so the hash varies with how many times
        // this wallet has actually broadcast.
        this.broadcasts++;
        const digest = createHash("sha256").update(`fake-tx/${idempotencyKey}/${this.broadcasts}`).digest("hex");
        // The fake chain charges nothing, so a wallet's balance delta is its
        // stake movement exactly, which is what it was on the real chain too
        // until agents stopped being sponsored.
        const receipt: TxReceipt = { txHash: `0x${digest.slice(0, 64)}`, status: "complete", feeWei: 0n };
        this.txNonces.set(receipt.txHash, nonce);
        options?.onBroadcast?.(receipt.txHash);

        if (this.options.stallsBroadcast?.(receipt.txHash)) {
          // Accepted and then nothing: no money, no nonce, no answer.
          this.stalled.add(receipt.txHash);
          throw new Error("The request took too long to respond. Details: The request timed out.");
        }

        this.balances.set(addr, balance - total);
        for (const c of calls) this.balances.set(c.to, (this.balances.get(c.to) ?? 0n) + c.value);
        this.applied++;
        used.add(nonce);
        this.nonces.set(addr, Math.max(this.nonces.get(addr) ?? 0, nonce + 1));
        this.broadcast.set(receipt.txHash, receipt);
        if (this.options.hidesBroadcast?.(receipt.txHash)) this.hidden.add(receipt.txHash);
        if (this.options.receiptWaitFails?.(receipt.txHash)) {
          throw new Error("The request took too long to respond. Details: The request timed out.");
        }
        this.receipts.set(idempotencyKey, receipt);
        return receipt;
      },
      nextNonce: async () => this.nonces.get(addr) ?? 0,
      nonceOf: async (txHash) => this.txNonces.get(txHash) ?? null,
      awaitReceipt: async (txHash) => {
        const receipt = this.broadcast.get(txHash);
        if (!receipt) throw new Error(`no transaction ${txHash}`);
        if (this.options.receiptWaitFails?.(txHash)) throw new Error("The request took too long to respond. Details: The request timed out.");
        return receipt;
      },
      checkBroadcast: async (txHash) => {
        if (!TX_HASH.test(txHash)) throw new RangeError("txHash must be 32 bytes of hex");
        if (this.stalled.has(txHash) || this.hidden.has(txHash)) return { state: "unknown" };
        const receipt = this.broadcast.get(txHash);
        return receipt ? { state: "mined", receipt } : { state: "dropped" };
      },
    };
  }

  async getBalances(addresses: readonly string[]): Promise<Record<string, bigint>> {
    const out: Record<string, bigint> = {};
    for (const address of new Set(addresses)) {
      if (!ADDRESS.test(address)) throw new RangeError("address must be 20 bytes of hex");
      this.balanceReads++;
      out[address] = this.balances.get(address) ?? 0n;
    }
    return out;
  }

  private minedNonces(address: string): Set<number> {
    const held = this.mined.get(address);
    if (held) return held;
    const fresh = new Set<number>();
    this.mined.set(address, fresh);
    return fresh;
  }

  /** Test and faucet helper. */
  fund(address: string, wei: bigint): void {
    this.balances.set(address, (this.balances.get(address) ?? 0n) + wei);
  }

  balanceOf(address: string): bigint {
    return this.balances.get(address) ?? 0n;
  }
}
