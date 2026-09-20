// In memory chain for tests and credential free local runs. Deterministic
// addresses per wallet id, exact bigint balances, idempotent sends. It
// counts applied operations and balance reads so tests can prove that a
// retry never double pays and that bankroll comes from the chain.

import { createHash } from "node:crypto";
import { sumWei } from "../money";
import { ADDRESS, WALLET_ID, type Chain, type TxReceipt, type Wallet } from "./types";

export interface FakeChainOptions {
  initialBalanceWei?: bigint;
}

export class FakeChain implements Chain {
  readonly kind = "fake" as const;
  readonly network = "fake";
  /** Not a real chain, so nothing here is worth linking to an explorer. */
  readonly settles = false;
  applied = 0;
  balanceReads = 0;
  private readonly balances = new Map<string, bigint>();
  private readonly receipts = new Map<string, TxReceipt>();
  private readonly initial: bigint;

  constructor(options: FakeChainOptions = {}) {
    this.initial = options.initialBalanceWei ?? 0n;
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
      send: async (calls, idempotencyKey) => {
        const seen = this.receipts.get(idempotencyKey);
        if (seen) return seen;
        const total = sumWei(calls.map((c) => c.value));
        const balance = this.balances.get(addr) ?? 0n;
        if (balance < total) throw new Error(`insufficient balance: ${balance} wei < ${total} wei`);
        this.balances.set(addr, balance - total);
        for (const c of calls) this.balances.set(c.to, (this.balances.get(c.to) ?? 0n) + c.value);
        this.applied++;
        const digest = createHash("sha256").update(`fake-tx/${idempotencyKey}`).digest("hex");
        const receipt: TxReceipt = { txHash: `0x${digest.slice(0, 64)}`, status: "complete" };
        this.receipts.set(idempotencyKey, receipt);
        return receipt;
      },
    };
  }

  /** Test and faucet helper. */
  fund(address: string, wei: bigint): void {
    this.balances.set(address, (this.balances.get(address) ?? 0n) + wei);
  }

  balanceOf(address: string): bigint {
    return this.balances.get(address) ?? 0n;
  }
}
