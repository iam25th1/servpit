// Persists wallet addresses per id so an agent keeps its identity across
// restarts. Addresses only: no keys, no secrets, nothing an attacker could
// use. Written atomically.

import { StoreFile, UNKNOWN_NETWORK } from "../store/file";
import { ADDRESS, WALLET_ID } from "./types";

export interface WalletRecord {
  address: string;
  network: string;
  createdAt?: string;
}

export class WalletRegistry {
  private wallets: Record<string, WalletRecord> = {};
  private readonly sync: StoreFile;

  /** Both contexts open wallets, so both write this file. */
  constructor(file: string, network: string = UNKNOWN_NETWORK) {
    this.sync = new StoreFile(file, network, (body) => this.load(body));
    this.sync.read();
  }

  private load(body: Record<string, unknown> | null): void {
    this.wallets = {};
    const stored = body?.wallets;
    if (!stored || typeof stored !== "object") return;
    for (const [id, rec] of Object.entries(stored as Record<string, WalletRecord>)) {
      if (WALLET_ID.test(id) && rec && ADDRESS.test(rec.address) && typeof rec.network === "string") this.wallets[id] = rec;
    }
  }

  get(id: string): WalletRecord | undefined {
    this.sync.read();
    return Object.prototype.hasOwnProperty.call(this.wallets, id) ? this.wallets[id] : undefined;
  }

  all(): Record<string, WalletRecord> {
    this.sync.read();
    return { ...this.wallets };
  }

  set(id: string, record: { address: string; network: string }): void {
    if (!WALLET_ID.test(id)) throw new RangeError(`wallet id must match ${WALLET_ID}`);
    if (!ADDRESS.test(record.address)) throw new RangeError("address must be 20 bytes of hex");
    if (typeof record.network !== "string" || record.network.length < 1) throw new RangeError("network must be a string");
    this.sync.read();
    this.wallets[id] = { address: record.address, network: record.network, createdAt: new Date().toISOString() };
    this.flush();
  }

  private flush(): void {
    this.sync.write({ version: 1, wallets: this.wallets });
  }
}
