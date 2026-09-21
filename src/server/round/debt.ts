// What each wallet's current occupant owes the bank.
//
// The ledger records loans as transfers, which is the right home for a
// disbursement, but a debt is more than the money that went out: it carries
// accrued interest, it is reduced by repayments, and it dies with the agent
// that owed it. None of that is a transfer, so none of it belongs on one.
//
// Debt is keyed by wallet and stamped with the identity that took it on. A
// wrecked agent's seat is refilled by a new identity in the same wallet, and
// the new one starts clean: it never inherits what the dead one owed.
//
// Integer minor units throughout. Chips are a display and prompt unit and
// never appear in this file.

import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { assertWei } from "../money";

export interface AgentDebt {
  /** Who owes it. A wallet outlives its occupants; a debt does not. */
  identityId: string;
  principalWei: bigint;
  interestWei: bigint;
  /** Interest per round on the principal, in basis points. */
  rateBps: number;
  /** The last round this debt was charged for, so a replay charges once. */
  lastAccruedRound: string | null;
  /** The round this identity took the seat. Null for the originals. */
  bornAtRound: string | null;
  /**
   * Everything the bank has advanced to this identity, and over how many
   * advances.
   *
   * Kept here rather than counted off the ledger's loan records, because
   * those are keyed by wallet and a wallet outlives its occupants. Counting
   * them would credit a replacement with the borrowings of the agent it
   * replaced, and a wreck record that says "borrowed 10" beside a principal
   * of 30 is a record that does not reconcile with itself.
   */
  borrowedWei: bigint;
  loanCount: number;
}

interface StoredDebt {
  identityId: string;
  principalWei: string;
  interestWei: string;
  rateBps: number;
  lastAccruedRound: string | null;
  bornAtRound?: string | null;
  borrowedWei?: string;
  loanCount?: number;
}

interface FileShape {
  version: 1;
  debts: Record<string, StoredDebt>;
  updatedAt: string;
}

export const NO_DEBT_FOR = (identityId: string, bornAtRound: string | null = null): AgentDebt => ({
  identityId,
  principalWei: 0n,
  interestWei: 0n,
  rateBps: 0,
  lastAccruedRound: null,
  bornAtRound,
  borrowedWei: 0n,
  loanCount: 0,
});

export const totalOwed = (debt: AgentDebt): bigint => debt.principalWei + debt.interestWei;

export class DebtStore {
  private readonly debts = new Map<string, AgentDebt>();
  /** The file as last read: modification time and size. Empty when absent. */
  private stamp = "";

  constructor(private readonly file: string) {
    this.reload();
  }

  /**
   * Rereads the file when it has changed since the last look.
   *
   * One process holds two of these. The plan route builds the server context
   * and the run route builds the settle context, each with its own store over
   * the same file, because the settle path may not import anything that can
   * reach a model. Read once at construction, the plan route's copy was a
   * snapshot of the moment the process started: it kept offering loans that
   * had been repaid, kept naming occupants who had been carried out, and the
   * lender's panel showed a book that no longer existed.
   *
   * Every mutation below flushes immediately, so there is never unwritten
   * state here to lose by rereading.
   */
  private reload(): void {
    const stat = statSync(this.file, { throwIfNoEntry: false });
    const now = stat ? `${stat.mtimeMs}:${stat.size}` : "";
    if (now === this.stamp) return;
    this.stamp = now;
    this.debts.clear();
    if (!stat) return;
    const parsed = JSON.parse(readFileSync(this.file, "utf8")) as Partial<FileShape>;
    for (const [walletId, stored] of Object.entries(parsed.debts ?? {})) {
      if (!stored || !/^\d+$/.test(stored.principalWei) || !/^\d+$/.test(stored.interestWei)) continue;
      this.debts.set(walletId, {
        identityId: stored.identityId,
        principalWei: BigInt(stored.principalWei),
        interestWei: BigInt(stored.interestWei),
        rateBps: stored.rateBps,
        lastAccruedRound: stored.lastAccruedRound,
        bornAtRound: stored.bornAtRound ?? null,
        borrowedWei: stored.borrowedWei !== undefined && /^\d+$/.test(stored.borrowedWei) ? BigInt(stored.borrowedWei) : BigInt(stored.principalWei),
        loanCount: stored.loanCount ?? 0,
      });
    }
  }

  /** What this wallet's current occupant owes. Never undefined. */
  get(walletId: string, identityId: string): AgentDebt {
    this.reload();
    const held = this.debts.get(walletId);
    // A debt stamped with a different identity belongs to somebody who is no
    // longer in this seat, so it is not this agent's to carry.
    if (!held || held.identityId !== identityId) return NO_DEBT_FOR(identityId);
    return { ...held };
  }

  /**
   * Records an advance.
   *
   * The rate follows the newest loan. Several loans at different rates would
   * need a schedule rather than a number, and the bank writes at most one
   * advance per agent per round, so the newest is the one being carried.
   */
  addLoan(walletId: string, identityId: string, principalWei: bigint, rateBps: number): AgentDebt {
    assertWei(principalWei, "principalWei");
    if (!Number.isInteger(rateBps) || rateBps < 0 || rateBps > 10_000) throw new RangeError(`rateBps must be basis points, got ${rateBps}`);
    const current = this.get(walletId, identityId);
    const next: AgentDebt = {
      ...current,
      principalWei: current.principalWei + principalWei,
      borrowedWei: current.borrowedWei + principalWei,
      loanCount: current.loanCount + 1,
      rateBps,
    };
    this.debts.set(walletId, next);
    this.flush();
    return { ...next };
  }

  /**
   * Charges one round of simple interest on outstanding principal.
   *
   * Idempotent by round id: settling the same round twice charges once. The
   * charge is on principal and never on interest already owed, so unpaid
   * interest does not earn interest of its own.
   */
  accrue(walletId: string, identityId: string, roundId: string): { debt: AgentDebt; chargedWei: bigint } {
    const current = this.get(walletId, identityId);
    if (current.lastAccruedRound === roundId || current.principalWei === 0n) {
      const stamped = { ...current, lastAccruedRound: roundId };
      this.debts.set(walletId, stamped);
      this.flush();
      return { debt: { ...stamped }, chargedWei: 0n };
    }
    const chargedWei = (current.principalWei * BigInt(current.rateBps)) / 10_000n;
    const next: AgentDebt = { ...current, interestWei: current.interestWei + chargedWei, lastAccruedRound: roundId };
    this.debts.set(walletId, next);
    this.flush();
    return { debt: { ...next }, chargedWei };
  }

  /** Applies a repayment that the rules module already split. */
  settle(walletId: string, identityId: string, principalWei: bigint, interestWei: bigint): AgentDebt {
    assertWei(principalWei, "principalWei");
    assertWei(interestWei, "interestWei");
    const current = this.get(walletId, identityId);
    if (principalWei > current.principalWei || interestWei > current.interestWei) {
      throw new RangeError(`cannot repay more than is owed for ${walletId}`);
    }
    const next: AgentDebt = { ...current, principalWei: current.principalWei - principalWei, interestWei: current.interestWei - interestWei };
    this.debts.set(walletId, next);
    this.flush();
    return { ...next };
  }

  /**
   * Closes a debt out and hands the seat to a new identity.
   *
   * What was not recovered is gone. The new occupant starts clean, which is
   * the whole reason a debt is stamped with an identity rather than a wallet.
   */
  clear(walletId: string, nextIdentityId: string, bornAtRound: string | null = null): void {
    this.debts.set(walletId, NO_DEBT_FOR(nextIdentityId, bornAtRound));
    this.flush();
  }

  /**
   * Who is currently in this seat.
   *
   * Generation one until somebody is wrecked out of it. The identity is what
   * a debt is stamped with, so this is the only thing that decides whether a
   * debt on file is still owed by whoever is sitting there.
   */
  currentIdentity(walletId: string): string {
    this.reload();
    return this.debts.get(walletId)?.identityId ?? `${walletId}-1`;
  }

  /** Every debt on file, for reconciliation and for the operator. */
  all(): Array<AgentDebt & { walletId: string }> {
    this.reload();
    return [...this.debts.entries()].map(([walletId, debt]) => ({ walletId, ...debt }));
  }

  private flush(): void {
    mkdirSync(dirname(this.file), { recursive: true });
    const debts: Record<string, StoredDebt> = {};
    for (const [walletId, d] of this.debts) {
      debts[walletId] = { identityId: d.identityId, principalWei: d.principalWei.toString(), interestWei: d.interestWei.toString(), rateBps: d.rateBps, lastAccruedRound: d.lastAccruedRound, bornAtRound: d.bornAtRound, borrowedWei: d.borrowedWei.toString(), loanCount: d.loanCount };
    }
    const body: FileShape = { version: 1, debts, updatedAt: new Date().toISOString() };
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(body, null, 2) + "\n");
    renameSync(tmp, this.file);
    // This store is now the file, so the next read has nothing to pick up.
    const stat = statSync(this.file, { throwIfNoEntry: false });
    this.stamp = stat ? `${stat.mtimeMs}:${stat.size}` : "";
  }
}
