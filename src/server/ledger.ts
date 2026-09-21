// Transfer ledger: the first idempotency net. Every transfer is recorded
// under its deterministic key before it is sent. A complete record is
// returned without touching the chain; a pending or failed record is
// retried with the same key, and the chain (CDP or fake) dedupes on that
// key as the second net. A key can never be reused for a different amount,
// destination or party.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
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
   * Fee the sender paid, from the receipt. Absent on a record written before
   * fees were tracked, and zero on a chain that does not charge.
   */
  feeWei?: bigint;
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
}

// bigint has no JSON form, so both amounts persist as decimal strings.
type Stored = Omit<TransferRecord, "amountWei" | "feeWei"> & { amountWei: string; feeWei?: string };

interface FileShape {
  version: 1;
  transfers: Record<string, Stored>;
}

export class TransferLedger {
  private records = new Map<string, TransferRecord>();

  constructor(private readonly file: string) {
    if (existsSync(file)) {
      const parsed = JSON.parse(readFileSync(file, "utf8")) as Partial<FileShape>;
      for (const stored of Object.values(parsed.transfers ?? {})) {
        if (stored && typeof stored.key === "string" && /^\d+$/.test(stored.amountWei)) {
          this.records.set(stored.key, {
            ...stored,
            amountWei: BigInt(stored.amountWei),
            feeWei: stored.feeWei === undefined ? undefined : BigInt(stored.feeWei),
          });
        }
      }
    }
  }

  get(key: string): TransferRecord | undefined {
    const r = this.records.get(key);
    return r ? { ...r } : undefined;
  }

  forRound(roundId: string): TransferRecord[] {
    return [...this.records.values()].filter((r) => r.roundId === roundId).map((r) => ({ ...r }));
  }

  async transferOnce(input: TransferInput): Promise<TransferRecord> {
    assertWei(input.amountWei, "amountWei");
    if (input.amountWei === 0n) throw new RangeError("amountWei must be greater than zero");
    if (!ADDRESS.test(input.to)) throw new RangeError("to must be an address");

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
      createdAt: now,
      updatedAt: now,
    };
    record.status = "pending";
    record.error = undefined;
    record.updatedAt = now;
    this.records.set(record.key, record);
    this.flush();

    try {
      const receipt = await input.from.send([{ to: input.to, value: input.amountWei }], input.key, (txHash) => {
        // Written to disk the moment a node accepts it, before the wait. If
        // the process dies here the hash is still on file, which is the whole
        // point: a retry can ask the chain about it instead of guessing.
        record.status = "broadcast";
        record.txHash = txHash;
        record.updatedAt = new Date().toISOString();
        this.flush();
        log.info("transfer broadcast, waiting for its receipt", { key: record.key, kind: record.kind, from: record.from, to: record.to, txHash });
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
   * Returns the settled record when the answer is final, and undefined only
   * when the chain confirms the transaction is gone, which is the one case
   * where sending the same money again is safe.
   */
  private async settleBroadcast(record: TransferRecord, wallet: Wallet): Promise<TransferRecord | undefined> {
    const txHash = record.txHash!;
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

    if (state.state === "pending") {
      // Still in a mempool, so it can land at any moment. Wait for it rather
      // than replacing it: a replacement under a fresh nonce would leave both
      // able to mine.
      log.warn("transfer still pending, waiting rather than resending", { key: record.key, txHash });
      const receipt = await wallet.awaitReceipt(txHash);
      record.status = "complete";
      record.txHash = receipt.txHash;
      record.feeWei = receipt.feeWei;
      record.error = undefined;
      record.updatedAt = new Date().toISOString();
      this.flush();
      return { ...record };
    }

    if (state.state === "reverted") {
      // It is on chain and it moved nothing. Safe to say failed, and not safe
      // to send again without someone deciding to.
      record.status = "failed";
      record.error = `transaction ${txHash} reverted`;
      record.updatedAt = new Date().toISOString();
      this.flush();
      throw new Error(`transfer ${record.key} reverted on chain as ${txHash}`);
    }

    if (state.state === "unknown") {
      // The chain does not know this transaction and the sender still has work
      // queued, so ours may yet appear. Refusing is the only safe answer.
      record.status = "broadcast";
      record.updatedAt = new Date().toISOString();
      this.flush();
      throw new Error(`transfer ${record.key} was broadcast as ${txHash} and the chain cannot yet say what became of it. Refusing to send it again.`);
    }

    log.warn("transfer was dropped by the chain, sending again", { key: record.key, droppedTxHash: txHash });
    record.txHash = undefined;
    return undefined;
  }

  private flush(): void {
    mkdirSync(dirname(this.file), { recursive: true });
    const transfers: Record<string, Stored> = {};
    for (const [k, r] of this.records) {
      transfers[k] = { ...r, amountWei: r.amountWei.toString(), feeWei: r.feeWei === undefined ? undefined : r.feeWei.toString() };
    }
    const body: FileShape = { version: 1, transfers };
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(body, null, 2) + "\n");
    renameSync(tmp, this.file);
  }
}
