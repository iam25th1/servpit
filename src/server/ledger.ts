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

export type TransferStatus = "pending" | "complete" | "failed";

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

type Stored = Omit<TransferRecord, "amountWei"> & { amountWei: string };

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
          this.records.set(stored.key, { ...stored, amountWei: BigInt(stored.amountWei) });
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
      const receipt = await input.from.send([{ to: input.to, value: input.amountWei }], input.key);
      record.status = "complete";
      record.txHash = receipt.txHash;
      record.updatedAt = new Date().toISOString();
      this.flush();
      log.info("transfer complete", { key: record.key, kind: record.kind, from: record.from, to: record.to, amountWei: record.amountWei, txHash: record.txHash });
      return { ...record };
    } catch (e) {
      record.status = "failed";
      record.error = redact(e instanceof Error ? e.message : String(e));
      record.updatedAt = new Date().toISOString();
      this.flush();
      log.error("transfer failed", { key: record.key, kind: record.kind, error: record.error });
      throw e;
    }
  }

  private flush(): void {
    mkdirSync(dirname(this.file), { recursive: true });
    const transfers: Record<string, Stored> = {};
    for (const [k, r] of this.records) transfers[k] = { ...r, amountWei: r.amountWei.toString() };
    const body: FileShape = { version: 1, transfers };
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(body, null, 2) + "\n");
    renameSync(tmp, this.file);
  }
}
