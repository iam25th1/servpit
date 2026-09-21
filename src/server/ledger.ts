// Transfer ledger: the first idempotency net. Every transfer is recorded
// under its deterministic key before it is sent. A complete record is
// returned without touching the chain; a pending or failed record is
// retried with the same key, and the chain (CDP or fake) dedupes on that
// key as the second net. A key can never be reused for a different amount,
// destination or party.

import { StoreFile, UNKNOWN_NETWORK } from "./store/file";
import type { TransferKind } from "./idempotency";
import { log, redact } from "./log";
import { assertWei } from "./money";
import { ADDRESS, type Wallet } from "./wallets/types";

/**
 * pending   written before anything was sent
 * broadcast accepted by a node, receipt unknown. Its hash is recorded.
 * complete  receipt seen, money moved
 * failed    never reached a node, or the transaction reverted
 *
 * broadcast exists because a receipt wait can time out against a transaction
 * that is already in a block. Calling that failed and sending again under a
 * fresh nonce pays twice.
 */
export type TransferStatus = "pending" | "broadcast" | "complete" | "failed";

export interface TransferRecord {
  key: string;
  roundId: string;
  agentId: string;
  kind: TransferKind;
  from: string;
  to: string;
  amountWei: bigint;
  network: string;
  status: TransferStatus;
  /** Only set by records written before the wallet layer moved to plain accounts. */
  userOpHash?: string;
  txHash?: string;
  /**
   * The nonce this transfer was sent under, read before it was sent.
   *
   * What makes a resend safe. One transaction per nonce can ever mine, so
   * sending the same transfer again under the same nonce either replaces the
   * original or loses to it, and the money moves once either way. Absent on a
   * record written before nonces were kept, and on a transfer that never
   * reached the point of being sent.
   */
  nonce?: number;
  /**
   * Every hash this transfer has been broadcast as, oldest first.
   *
   * A resend under the same nonce produces a second hash, and either of them
   * can be the one that mines. Both have to be asked about.
   */
  hashes?: string[];
  /**
   * Fee the sender paid, from the receipt. Absent on a record written before
   * fees were tracked, and zero on a chain that does not charge.
   */
  feeWei?: bigint;
  /**
   * Interest per round on a loan, in basis points. Only on a loan record.
   *
   * The debt itself is the loan records: principal is the amount, and this is
   * what it costs to carry. Accruing and collecting it comes later, and this
   * is what that will read.
   */
  rateBps?: number;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TransferInput {
  key: string;
  roundId: string;
  agentId: string;
  kind: TransferKind;
  from: Wallet;
  to: string;
  amountWei: bigint;
  network: string;
  /** Interest per round on a loan, in basis points. Only on a loan. */
  rateBps?: number;
}

// bigint has no JSON form, so both amounts persist as decimal strings.
type Stored = Omit<TransferRecord, "amountWei" | "feeWei"> & { amountWei: string; feeWei?: string };

export class TransferLedger {
  private records = new Map<string, TransferRecord>();
  private readonly sync: StoreFile;

  constructor(file: string, network: string = UNKNOWN_NETWORK) {
    this.sync = new StoreFile(file, network, (body) => this.load(body));
    this.sync.read();
  }

  private load(body: Record<string, unknown> | null): void {
    this.records = new Map();
    const stored = (body?.transfers ?? {}) as Record<string, Stored>;
    for (const record of Object.values(stored)) {
      if (record && typeof record.key === "string" && /^\d+$/.test(record.amountWei)) {
        this.records.set(record.key, {
          ...record,
          amountWei: BigInt(record.amountWei),
          feeWei: record.feeWei === undefined ? undefined : BigInt(record.feeWei),
        });
      }
    }
  }

  get(key: string): TransferRecord | undefined {
    this.sync.read();
    const r = this.records.get(key);
    return r ? { ...r } : undefined;
  }

  forRound(roundId: string): TransferRecord[] {
    this.sync.read();
    return [...this.records.values()].filter((r) => r.roundId === roundId).map((r) => ({ ...r }));
  }

  /**
   * What an agent owes in principal, across every loan the bank has settled
   * to it.
   *
   * Read off the transfers themselves rather than a second record that could
   * drift from them. Interest and repayment are not in this phase, so this is
   * principal advanced and nothing has yet reduced it.
   */
  principalOwed(agentId: string): bigint {
    this.sync.read();
    let owed = 0n;
    for (const r of this.records.values()) {
      if (r.kind === "loan" && r.agentId === agentId && r.status === "complete") owed += r.amountWei;
    }
    return owed;
  }

  /** Every loan settled to an agent, oldest first. */
  loansFor(agentId: string): TransferRecord[] {
    this.sync.read();
    return [...this.records.values()].filter((r) => r.kind === "loan" && r.agentId === agentId).map((r) => ({ ...r }));
  }

  async transferOnce(input: TransferInput): Promise<TransferRecord> {
    assertWei(input.amountWei, "amountWei");
    if (input.amountWei === 0n) throw new RangeError("amountWei must be greater than zero");
    if (!ADDRESS.test(input.to)) throw new RangeError("to must be an address");

    // Whatever is on file now. A settle in another process may have written
    // this very key, and resending money on a stale copy is the failure this
    // ledger exists to prevent.
    this.sync.read();
    const existing = this.records.get(input.key);
    if (existing) {
      const same =
        existing.from === input.from.address &&
        existing.to === input.to &&
        existing.amountWei === input.amountWei &&
        existing.kind === input.kind &&
        existing.roundId === input.roundId &&
        existing.agentId === input.agentId;
      if (!same) throw new Error(`idempotency key mismatch: ${input.key} already records a different transfer`);
      if (existing.status === "complete") {
        log.info("transfer already complete, not resending", { key: input.key, txHash: existing.txHash });
        return { ...existing };
      }
      // A recorded hash means a node accepted this transfer. Whether it landed
      // is a question for the chain, never an assumption: a receipt wait that
      // timed out says nothing about whether the money moved. Resending on
      // that alone is how a transfer gets paid twice.
      if (existing.txHash !== undefined) {
        const settled = await this.settleBroadcast(existing, input.from);
        if (settled) return settled;
      }
      log.warn("retrying transfer with the same idempotency key", { key: input.key, previousStatus: existing.status });
    }

    const now = new Date().toISOString();
    const record: TransferRecord = existing ?? {
      key: input.key,
      roundId: input.roundId,
      agentId: input.agentId,
      kind: input.kind,
      from: input.from.address,
      to: input.to,
      amountWei: input.amountWei,
      network: input.network,
      status: "pending",
      ...(input.rateBps === undefined ? {} : { rateBps: input.rateBps }),
      createdAt: now,
      updatedAt: now,
    };
    record.status = "pending";
    record.error = undefined;
    record.updatedAt = now;
    // The nonce this will go out under, read before anything is sent and
    // written down with the record. A resend needs it, and reading it after
    // the fact means a process that dies at the wrong moment can never
    // establish which slot the money is in.
    //
    // A record that already has one keeps it: this is the same transfer, and
    // going out under a second nonce is exactly the double payment the rest
    // of this file is built to prevent.
    if (record.nonce === undefined) {
      try {
        record.nonce = await input.from.nextNonce();
      } catch (e) {
        // Not fatal on its own. Without it a transfer whose fate the chain
        // will not give up cannot be resent, which is where this started.
        log.warn("could not read the nonce before sending", { key: record.key, error: redact(e instanceof Error ? e.message : String(e)) });
      }
    }
    const resending = record.nonce !== undefined && (record.hashes?.length ?? 0) > 0;
    this.records.set(record.key, record);
    this.flush();

    try {
      const receipt = await input.from.send([{ to: input.to, value: input.amountWei }], input.key, {
        // Only on a resend. A first send takes the next nonce itself, which is
        // the one just read, and asking for it explicitly would mean sending
        // through a path that exists for resends.
        ...(resending ? { nonce: record.nonce } : {}),
        onBroadcast: (txHash) => {
          // Written to disk the moment a node accepts it, before the wait. If
          // the process dies here the hash is still on file, which is the whole
          // point: a retry can ask the chain about it instead of guessing.
          record.status = "broadcast";
          record.txHash = txHash;
          record.hashes = [...(record.hashes ?? []), txHash];
          record.updatedAt = new Date().toISOString();
          this.flush();
          log.info("transfer broadcast, waiting for its receipt", { key: record.key, kind: record.kind, from: record.from, to: record.to, txHash, nonce: record.nonce ?? null });
        },
      });
      record.status = "complete";
      record.txHash = receipt.txHash;
      record.feeWei = receipt.feeWei;
      record.updatedAt = new Date().toISOString();
      this.flush();
      log.info("transfer complete", { key: record.key, kind: record.kind, from: record.from, to: record.to, amountWei: record.amountWei, txHash: record.txHash });
      return { ...record };
    } catch (e) {
      // A transfer that reached a node keeps its hash and stays broadcast. It
      // is not failed: nobody has established that it did not land, and the
      // retry above is what will establish it.
      record.status = record.txHash === undefined ? "failed" : "broadcast";
      record.error = redact(e instanceof Error ? e.message : String(e));
      record.updatedAt = new Date().toISOString();
      this.flush();
      log.error("transfer did not confirm", { key: record.key, kind: record.kind, status: record.status, txHash: record.txHash, error: record.error });
      throw e;
    }
  }

  /**
   * Asks the chain what became of a transfer that was already broadcast.
   *
   * Returns the settled record when the answer is final, and undefined when
   * sending again is safe. Every hash this transfer has been broadcast as is
   * asked about, not only the latest: a resend produces a second hash and
   * either of them can be the one that mines.
   */
  private async settleBroadcast(record: TransferRecord, wallet: Wallet): Promise<TransferRecord | undefined> {
    const hashes = record.hashes && record.hashes.length > 0 ? record.hashes : [record.txHash!];
    let pendingHash: string | undefined;
    let unaccountable = false;

    for (const txHash of hashes) {
      const state = await wallet.checkBroadcast(txHash);

      if (state.state === "mined") {
        record.status = "complete";
        record.txHash = state.receipt.txHash;
        record.feeWei = state.receipt.feeWei;
        record.error = undefined;
        record.updatedAt = new Date().toISOString();
        this.flush();
        log.info("transfer had already landed, not resending", { key: record.key, txHash: record.txHash });
        return { ...record };
      }

      if (state.state === "reverted") {
        // It is on chain and it moved nothing. Safe to say failed, and not
        // safe to send again without someone deciding to.
        record.status = "failed";
        record.error = `transaction ${txHash} reverted`;
        record.updatedAt = new Date().toISOString();
        this.flush();
        throw new Error(`transfer ${record.key} reverted on chain as ${txHash}`);
      }

      if (state.state === "pending") pendingHash ??= txHash;
      if (state.state === "unknown") unaccountable = true;
    }

    if (pendingHash !== undefined) {
      // Still in a mempool, so it can land at any moment. Wait for it rather
      // than replacing it: a replacement under a fresh nonce would leave both
      // able to mine.
      log.warn("transfer still pending, waiting rather than resending", { key: record.key, txHash: pendingHash });
      const receipt = await wallet.awaitReceipt(pendingHash);
      record.status = "complete";
      record.txHash = receipt.txHash;
      record.feeWei = receipt.feeWei;
      record.error = undefined;
      record.updatedAt = new Date().toISOString();
      this.flush();
      return { ...record };
    }

    if (unaccountable) {
      // The chain will not say what became of it. Without a nonce there is
      // nothing to do but refuse: a fresh one would leave two transactions
      // able to mine and the money could move twice.
      if (record.nonce === undefined) {
        record.status = "broadcast";
        record.updatedAt = new Date().toISOString();
        this.flush();
        throw new Error(`transfer ${record.key} was broadcast as ${record.txHash} and the chain cannot yet say what became of it, and no nonce was recorded for it. Refusing to send it again.`);
      }
      // With one, it is safe. One transaction per nonce can ever mine, so
      // this either replaces what was sent or loses to it. Either way the
      // money moves once, and this stops being a transfer that can never be
      // resolved.
      log.warn("transfer unaccountable, sending again under the same nonce", { key: record.key, nonce: record.nonce, hashes: hashes.length });
      return undefined;
    }

    log.warn("transfer was dropped by the chain, sending again", { key: record.key, droppedTxHash: record.txHash });
    record.txHash = undefined;
    return undefined;
  }

  private flush(): void {
    const transfers: Record<string, Stored> = {};
    for (const [key, r] of this.records) {
      transfers[key] = { ...r, amountWei: r.amountWei.toString(), feeWei: r.feeWei === undefined ? undefined : r.feeWei.toString() };
    }
    this.sync.write({ version: 1, transfers });
  }
}
