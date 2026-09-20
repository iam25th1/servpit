// Persists wallet addresses per id so an agent keeps its identity across
// restarts. Addresses only: no keys, no secrets, nothing an attacker could
// use. Written atomically.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { ADDRESS, WALLET_ID } from "./types";

export interface WalletRecord {
  address: string;
  network: string;
  createdAt?: string;
}

interface FileShape {
  version: 1;
  wallets: Record<string, WalletRecord>;
}

export class WalletRegistry {
  private wallets: Record<string, WalletRecord> = {};

  constructor(private readonly file: string) {
    if (existsSync(file)) {
      const parsed = JSON.parse(readFileSync(file, "utf8")) as Partial<FileShape>;
      if (parsed && typeof parsed === "object" && parsed.wallets && typeof parsed.wallets === "object") {
        for (const [id, rec] of Object.entries(parsed.wallets)) {
          if (WALLET_ID.test(id) && rec && ADDRESS.test(rec.address) && typeof rec.network === "string") this.wallets[id] = rec;
        }
      }
    }
  }

  get(id: string): WalletRecord | undefined {
    return Object.prototype.hasOwnProperty.call(this.wallets, id) ? this.wallets[id] : undefined;
  }

  all(): Record<string, WalletRecord> {
    return { ...this.wallets };
  }

  set(id: string, record: { address: string; network: string }): void {
    if (!WALLET_ID.test(id)) throw new RangeError(`wallet id must match ${WALLET_ID}`);
    if (!ADDRESS.test(record.address)) throw new RangeError("address must be 20 bytes of hex");
    if (typeof record.network !== "string" || record.network.length < 1) throw new RangeError("network must be a string");
    this.wallets[id] = { address: record.address, network: record.network, createdAt: new Date().toISOString() };
    this.flush();
  }

  private flush(): void {
    mkdirSync(dirname(this.file), { recursive: true });
    const body: FileShape = { version: 1, wallets: this.wallets };
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(body, null, 2) + "\n");
    renameSync(tmp, this.file);
  }
}
