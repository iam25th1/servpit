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

export function transferRows(transfers: readonly TransferInput[]): TransferRow[] {
  // The entries first, then whatever happened to the prize. A retention
  // sorts where the payout would have been, because it answers the same
  // question: where the pot went.
  const order = (kind: string): number => (kind === "payout" || kind === "retained" ? 1 : 0);
  return [...transfers]
    .sort((a, b) => order(a.kind) - order(b.kind))
    .map((t) => {
      const hash = typeof t.txHash === "string" && t.txHash.length > 0 ? t.txHash : null;
      const link = typeof t.link === "string" && t.link.length > 0 ? t.link : null;
      // A retention is not a transfer and never gets a hash, so it says so
      // rather than sitting on "pending" forever.
      const retained = t.kind === "retained";
      const verb = retained ? "won, prize kept in the pot" : t.kind === "payout" ? "paid out" : "paid in";
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
