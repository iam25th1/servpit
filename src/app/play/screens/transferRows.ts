// What the result screen shows for each transfer.
//
// This exists as a pure function because it is the seam between two phases
// that were never built against each other: the wallet layer produces the
// hashes and the links, and the interface decides how they read. Keeping the
// decision here means it can be tested without a browser, and it cannot be
// silently dropped again the next time the result screen is redrawn.

export interface TransferInput {
  kind: string;
  agentId: string;
  amountWei: string;
  txHash: string | null;
  /** A block explorer link, present only when the chain actually settles. */
  link: string | null;
}

export interface TransferRow {
  kind: string;
  /** Reads as a sentence rather than a raw column value. */
  label: string;
  amountWei: string;
  hashShort: string;
  link: string | null;
  /** True when there is somewhere to go and look. */
  explorable: boolean;
}

const shorten = (hash: string): string => `${hash.slice(0, 8)}...${hash.slice(-6)}`;

// One plain phrase per kind. The bank's movements read as what happened to
// the agent, not as the ledger's word for it, because "loan" beside a name
// does not say which way the chips went.
const VERBS: Record<string, string> = {
  entry: "paid in",
  payout: "paid out",
  retained: "won, prize kept in the pot",
  loan: "borrowed from Marrow",
  repayment: "repaid Marrow",
  seizure: "handed Marrow what was left",
  refill: "was staked by the operator",
};

export function transferRows(transfers: readonly TransferInput[]): TransferRow[] {
  // The round's own order: a loan lands before the entry it paid for, the
  // entries before whatever happened to the prize, and what the bank took
  // back after the prize arrived. A retention sorts where the payout would
  // have been, because it answers the same question: where the pot went.
  const ORDER: Record<string, number> = { loan: 0, entry: 1, payout: 2, retained: 2, repayment: 3, seizure: 4, refill: 5 };
  const order = (kind: string): number => ORDER[kind] ?? 1;
  return [...transfers]
    .sort((a, b) => order(a.kind) - order(b.kind))
    .map((t) => {
      const hash = typeof t.txHash === "string" && t.txHash.length > 0 ? t.txHash : null;
      const link = typeof t.link === "string" && t.link.length > 0 ? t.link : null;
      // A retention is not a transfer and never gets a hash, so it says so
      // rather than sitting on "pending" forever.
      const retained = t.kind === "retained";
      const verb = VERBS[t.kind] ?? "paid in";
      return {
        kind: t.kind,
        label: `${t.agentId} ${verb}`,
        amountWei: t.amountWei,
        hashShort: hash ? shorten(hash) : retained ? "no transfer" : "pending",
        link,
        explorable: link !== null,
      };
    });
}
