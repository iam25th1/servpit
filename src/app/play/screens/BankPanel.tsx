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
  amount: number;
  rateBps: number;
  reason: string;
  source: string;
}

export interface RefusalShape {
  agentId: string;
  name: string;
  reason: string;
}

/** A rate reads as a percent a round, because basis points are not a player unit. */
export function ratePercent(rateBps: number): string {
  const percent = rateBps / 100;
  return Number.isInteger(percent) ? `${percent}` : percent.toFixed(1);
}

export function BankPanel({ bank, loans, refusals }: { bank: BankShape; loans: LoanShape[]; refusals: RefusalShape[] }) {
  const { portraitPath } = useUiKit();
  const face = portraitPath("Marrow");
  const decisionsRef = useRef<HTMLUListElement>(null);

  // Each ruling arrives on its own, in the order Marrow made them. The bank
  // decides one request at a time, so they land one at a time here too.
  useEffect(() => {
    const rows = decisionsRef.current ? [...decisionsRef.current.querySelectorAll<HTMLElement>("li")] : [];
    const latest = rows[rows.length - 1];
    if (latest) void staggerIn([latest]);
  }, [loans.length, refusals.length]);

  const rulings = [
    ...loans.map((l) => ({ key: `loan-${l.agentId}`, name: l.name, verdict: `lends ${l.amount} at ${ratePercent(l.rateBps)} percent a round`, lent: true, reason: l.reason })),
    ...refusals.map((r) => ({ key: `no-${r.agentId}`, name: r.name, verdict: "turned away", lent: false, reason: r.reason })),
  ];

  return (
    <NinePatch sprite="bg" data-anim="bank" className={styles.bank}>
      <div className={styles.bankHead}>
        {face && <img className={styles.bankFace} src={face} alt="" width={38} height={38} />}
        <div>
          <h2 className={styles.sideHead}>Marrow</h2>
          <p className={styles.bankTreasury}>
            holds <strong>{bank.treasury}</strong> chips
          </p>
        </div>
      </div>

      {bank.book.length > 0 ? (
        <ul className={styles.bookList} aria-label="who owes Marrow">
          {bank.book.map((row) => (
            <li key={row.agentId} className={styles.bookRow}>
              <span className={styles.bookName}>{row.name}</span>
              <span className={styles.bookOwed}>{row.owed} chips</span>
              <span className={styles.bookRate}>{ratePercent(row.rateBps)}% a round</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.sideNote}>Nobody owes Marrow anything. Yet.</p>
      )}

      {rulings.length > 0 && (
        <ul ref={decisionsRef} className={styles.rulings} aria-label="Marrow's rulings this round">
          {rulings.map((r) => (
            <li key={r.key} className={styles.ruling} data-lent={r.lent ? "true" : "false"}>
              <span className={styles.rulingLine}>
                <span className={styles.agentName}>{r.name}</span> <span className={r.lent ? styles.in : styles.agentVerdict}>{r.verdict}</span>
              </span>
              <span className={styles.rulingReason}>{r.reason}</span>
            </li>
          ))}
        </ul>
      )}
    </NinePatch>
  );
}
