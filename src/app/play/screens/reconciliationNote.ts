// What the result screen says about reconciliation.
//
// It used to say "held against chain balances" or "FAILED" and nothing else.
// On a money surface that is not enough: when four wallet checks failed on
// the first settled round, the screen gave the operator no way to tell which
// wallet, what was expected or what was seen.
//
// The flag is the source of truth for whether it held. The checks only fill
// in the detail, so a run that reported a failure can never be displayed as
// having held because a check went missing.

export interface ReconcileCheck {
  name: string;
  ok: boolean;
  expected: string;
  actual: string;
}

export interface ReconciliationNote {
  ok: boolean;
  text: string;
  /** One line per failing check, for the operator to act on. */
  failed: string[];
}

export function reconciliationNote(reconciled: boolean, checks: readonly ReconcileCheck[] | undefined): ReconciliationNote {
  if (reconciled) return { ok: true, text: "Reconciliation held against chain balances", failed: [] };

  const all = checks ?? [];
  const bad = all.filter((c) => !c.ok);
  const text = bad.length === 0 ? "Reconciliation FAILED" : `Reconciliation FAILED on ${bad.length} of ${all.length} checks`;
  return { ok: false, text, failed: bad.map((c) => `${c.name}: expected ${c.expected}, saw ${c.actual}`) };
}
