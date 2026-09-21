// Marrow, on screen.
//
// The lender is an agent like the other six: it has a face, a voice and an
// opinion about everyone at the table. What it does not have is a seat, so it
// gets a panel of its own rather than a row in the lineup.
//
// Everything here is read from the plan rather than recomputed. The treasury
// is the figure every loan this round was bounded against, and the book is
// the debt interest will be charged on, so a number on screen is the number
// the money surface used.

import { useEffect, useRef } from "react";
import { NinePatch } from "@/ui/NinePatch";
import { useUiKit } from "@/ui/UiKit";
import { staggerIn } from "@/ui/transitions";
import styles from "./shell.module.css";

export interface BankShape {
  treasury: number;
  book: Array<{ agentId: string; name: string; owed: number; principal: number; rateBps: number }>;
}

export interface LoanShape {
  agentId: string;
  name: string;
  /** What the agent was short, which is what it asked for. */
  asked: number;
  /** Whether it asked because it wanted more or because it had nothing left. */
  tappedOut: boolean;
  amount: number;
  rateBps: number;
  reason: string;
  source: string;
}

export interface RefusalShape {
  agentId: string;
  name: string;
  asked: number;
  tappedOut: boolean;
  reason: string;
}

/** One line of the exchange between an agent and the lender. */
export interface Beat {
  key: string;
  /** The ask, then the ruling. Two beats to a decision. */
  kind: "ask" | "lend" | "refuse";
  line: string;
  aside: string | null;
}

/**
 * The round's lending, as it happened, in plain words.
 *
 * Two beats per decision, because a loan is an exchange and not an event. An
 * agent asks for a number it did not choose, since the shortfall is
 * arithmetic on its balance, and Marrow answers with one it did.
 */
export function loanBeats(loans: LoanShape[], refusals: RefusalShape[]): Beat[] {
  const beats: Beat[] = [];
  for (const l of loans) {
    beats.push({
      key: `ask-${l.agentId}`,
      kind: "ask",
      line: l.tappedOut ? `${l.name} is tapped out and asks Marrow for ${l.asked} chips.` : `${l.name} wants to go big and asks Marrow for ${l.asked} chips.`,
      aside: null,
    });
    beats.push({ key: `lend-${l.agentId}`, kind: "lend", line: `Marrow lends ${l.amount} at ${ratePercent(l.rateBps)} percent a round.`, aside: l.reason });
  }
  for (const r of refusals) {
    beats.push({
      key: `ask-${r.agentId}`,
      kind: "ask",
      line: r.tappedOut ? `${r.name} is tapped out and asks Marrow for ${r.asked} chips.` : `${r.name} wants to go big and asks Marrow for ${r.asked} chips.`,
      aside: null,
    });
    beats.push({ key: `refuse-${r.agentId}`, kind: "refuse", line: `Marrow turns ${r.name} down.`, aside: r.reason });
  }
  return beats;
}

/**
 * How many beats stay on screen. The panel is a feed, not a ledger.
 *
 * One, because the strip under the lever has room for a line and the stage
 * does not scroll. The whole exchange plays out in the buy in panel, where
 * the money actually moves and there is room to read it.
 */
export const MAX_BEATS = 1;

/** A rate reads as a percent a round, because basis points are not a player unit. */
export function ratePercent(rateBps: number): string {
  const percent = rateBps / 100;
  return Number.isInteger(percent) ? `${percent}` : percent.toFixed(1);
}

export function BankPanel({ bank, loans, refusals }: { bank: BankShape; loans: LoanShape[]; refusals: RefusalShape[] }) {
  const { portraitPath } = useUiKit();
  const face = portraitPath("Marrow");
  const decisionsRef = useRef<HTMLUListElement>(null);

  // The exchange lands as a sequence: ask, answer, ask, answer. Staggered
  // rather than appearing at once, because the bank decides one request at a
  // time and reading them in that order is the point.
  const beatCount = loans.length + refusals.length;
  useEffect(() => {
    const rows = decisionsRef.current ? [...decisionsRef.current.querySelectorAll<HTMLElement>("li")] : [];
    if (rows.length > 0) void staggerIn(rows);
  }, [beatCount]);


  // The latest exchanges, not every one of them. Six agents can produce
  // twelve beats, and a panel that grows with them pushes the cabinet off a
  // stage that does not scroll. A feed shows what just happened.
  const beats = loanBeats(loans, refusals).slice(-MAX_BEATS);

  // Who owes, as one line rather than a table. The cabinet column has about a
  // hundred and twenty pixels under the lever on a stage that does not
  // scroll, so the book summarises and the detail lives on the result screen
  // and in the graveyard.
  const owedTotal = bank.book.reduce((sum, row) => sum + row.owed, 0);
  const book =
    bank.book.length === 0
      ? "Nobody owes Marrow anything. Yet."
      : bank.book.length === 1
        ? `${bank.book[0].name} owes ${bank.book[0].owed} at ${ratePercent(bank.book[0].rateBps)} percent a round.`
        : `${bank.book.length} owe Marrow ${owedTotal} chips.`;

  return (
    <NinePatch sprite="bg" data-anim="bank" className={styles.bank}>
      <div className={styles.bankHead}>
        {face && <img className={styles.bankFace} src={face} alt="" width={28} height={28} />}
        <h2 className={styles.bankName}>Marrow</h2>
        <p className={styles.bankTreasury}>
          holds <strong>{bank.treasury}</strong> chips
        </p>
      </div>

      <p className={styles.bankBook}>{book}</p>

      {beats.length > 0 && (
        <ul ref={decisionsRef} className={styles.rulings} aria-label="what Marrow did this round">
          {beats.map((beat) => (
            <li key={beat.key} className={styles.ruling} data-beat={beat.kind}>
              <span className={styles.rulingLine}>{beat.line}</span>
            </li>
          ))}
        </ul>
      )}
    </NinePatch>
  );
}
