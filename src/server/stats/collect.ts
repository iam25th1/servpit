// Counting what is on file, and saying so when a thing is not on file.
//
// Two rules run through all of this. Every number is counted from a store
// rather than worked out from a rate, and a number that cannot be counted
// prints as not recorded with the reason, never as zero. A zero is a fact
// about the pit; an absence is a fact about the stores, and a report that
// prints them the same way is worse than no report.
//
// The reasons are worth reading, because several of them are the interesting
// part. The round store keeps the last two hundred rounds, so anything older
// than that is gone. A fight log is kept for the round on screen only, so
// eliminations across history are not countable from it and never will be
// from this store. A round record carries the reconciliation verdict as one
// boolean and not the checks behind it, so a failure can be counted and not
// explained.

import type { CareerRow, LogLine, RoundRow, Stores, TransferRow, WreckRow } from "./read";

/** One line of the report. */
export interface Stat {
  label: string;
  /** What to print, or null when the stores do not carry it. */
  text: string | null;
  /** Why it is not on file. Present only when text is null. */
  why?: string;
  /** The bare number behind the text, for the lines worth posting. */
  number?: number;
}

export interface Group {
  title: string;
  stats: Stat[];
}

export interface Report {
  network: string;
  dataDir: string;
  at: string;
  groups: Group[];
}

/** The rolling window the round store keeps, as MAX_ROUNDS in store.ts. */
export const ROUND_WINDOW = 200;

const WHY_WINDOW = `the round store keeps the last ${ROUND_WINDOW} rounds, so anything older is gone`;
const WHY_NO_LOG = "a fight log is kept for the round on screen only, not for the rounds behind it";
const WHY_NO_REELS = "a round record keeps the winning entrant id, not the characters the reels drew";

/**
 * A counted number.
 *
 * The third argument is a caveat about the label rather than a unit on the
 * value: "fights on file (one per round)" reads as a fact, and "200 one per
 * round" reads as a typo.
 */
const count = (label: string, value: number, caveat = ""): Stat => ({
  label: caveat ? `${label} (${caveat})` : label,
  text: value.toLocaleString("en-US"),
  number: value,
});

const said = (label: string, text: string, number?: number): Stat => ({ label, text, number });

const missing = (label: string, why: string): Stat => ({ label, text: null, why });

const big = (raw: string | undefined | null): bigint => {
  if (raw === undefined || raw === null || raw === "") return 0n;
  try {
    return BigInt(raw);
  } catch {
    return 0n;
  }
};

/**
 * Wei one chip is worth, taken from the arena file rather than the environment.
 *
 * The round the pit last published carries the rate it was played at, which is
 * the rate the numbers on file were written in. Reading it from the process
 * environment instead would report a live store in whatever units the machine
 * running the report happened to be configured with.
 */
export function chipRate(stores: Stores): bigint | null {
  const raw = stores.arena?.last?.weiPerChip ?? stores.arena?.round?.weiPerChip;
  const rate = big(raw);
  return rate > 0n ? rate : null;
}

/** Wei as chips at the rate on file, or null when nothing on file says the rate. */
function chips(wei: bigint, rate: bigint | null): string | null {
  if (rate === null) return null;
  return `${Number(wei / rate).toLocaleString("en-US")} chips`;
}

const money = (label: string, wei: bigint, rate: bigint | null): Stat =>
  rate === null
    ? { label, text: `${wei.toLocaleString("en-US")} wei`, number: Number(wei) }
    : { label, text: chips(wei, rate)!, number: Number(wei / rate) };

/** Wei as ETH, which needs no rate and no environment. */
function eth(wei: bigint): string {
  const whole = wei / 10n ** 18n;
  const rest = (wei % 10n ** 18n).toString().padStart(18, "0").slice(0, 6);
  return `${whole}.${rest} ETH`;
}

const kindsOf = (transfers: readonly TransferRow[]): Map<string, { n: number; wei: bigint }> => {
  const out = new Map<string, { n: number; wei: bigint }>();
  for (const t of transfers) {
    const kind = t.kind ?? "unknown";
    const held = out.get(kind) ?? { n: 0, wei: 0n };
    held.n += 1;
    held.wei += big(t.amountWei);
    out.set(kind, held);
  }
  return out;
};

const claimsIn = (log: LogLine[] | null): string[] =>
  (log ?? []).filter((line) => line.k === "claim").map((line) => String(line.handle ?? ""));

const maxBy = <T,>(rows: readonly T[], of: (row: T) => number): T | null =>
  rows.length === 0 ? null : rows.reduce((best, row) => (of(row) > of(best) ? row : best), rows[0]!);

const minBy = <T,>(rows: readonly T[], of: (row: T) => number): T | null =>
  rows.length === 0 ? null : rows.reduce((least, row) => (of(row) < of(least) ? row : least), rows[0]!);

const sum = (values: readonly number[]): number => values.reduce((a, b) => a + b, 0);

/** Which answer each round got, counted per round rather than per decision. */
export function sourcesOf(rounds: readonly RoundRow[]): { reasoned: number; learned: number; instinct: number; learnable: number } {
  let reasoned = 0;
  let learned = 0;
  let instinct = 0;
  let learnable = 0;
  for (const round of rounds) {
    const sources = (round.agents ?? []).map((a) => a.source);
    learnable += (round.agents ?? []).filter((a) => a.source === "serv" && a.situation).length;
    // A round counts as reasoned when any agent in it got a model's answer,
    // learned when none did and any answer was drawn from what SERV decided
    // before, and instinct when neither.
    if (sources.includes("serv")) reasoned += 1;
    else if (sources.includes("learned")) learned += 1;
    else instinct += 1;
  }
  return { reasoned, learned, instinct, learnable };
}

/**
 * Why the failures failed, counted by cause.
 *
 * A wallet check is named for the wallet it is about, so the names are
 * flattened: a breakdown of "wallet 0x317E delta: 1" per address tells nobody
 * anything. What is worth counting is which kind of check disagreed, and by
 * how much at worst.
 */
export function failureCauses(rounds: readonly RoundRow[]): { causes: Map<string, number>; undetailed: number; worstGap: bigint | null } {
  const causes = new Map<string, number>();
  let undetailed = 0;
  let worstGap: bigint | null = null;
  for (const round of rounds) {
    if (round.reconciled !== false) continue;
    const failed = round.reconciliation?.failed;
    if (failed === undefined || failed.length === 0) {
      undetailed += 1;
      continue;
    }
    for (const check of failed) {
      const cause = (check.name ?? "unnamed").replace(/^wallet 0x[0-9a-fA-F]+ /, "wallet ");
      causes.set(cause, (causes.get(cause) ?? 0) + 1);
      // Both figures are decimal wei on every check but "pot covers payout",
      // whose expected reads "at most N". A gap needs two numbers, so that one
      // contributes a cause and no gap.
      const expected = /^-?[0-9]+$/.test(check.expected ?? "") ? BigInt(check.expected!) : null;
      const actual = /^-?[0-9]+$/.test(check.actual ?? "") ? BigInt(check.actual!) : null;
      if (expected === null || actual === null) continue;
      const gap = actual > expected ? actual - expected : expected - actual;
      if (worstGap === null || gap > worstGap) worstGap = gap;
    }
  }
  return { causes, undetailed, worstGap };
}

function pit(stores: Stores, rate: bigint | null): Group {
  const rounds = stores.rounds;
  const stats: Stat[] = [];
  if (rounds === null) {
    stats.push(missing("rounds on file", "there is no round store for this network"));
  } else {
    stats.push(count("rounds on file", rounds.length));
    stats.push(missing("rounds played in total", WHY_WINDOW));
    const ok = rounds.filter((r) => r.reconciled === true).length;
    const failed = rounds.filter((r) => r.reconciled === false).length;
    stats.push(said("rounds reconciled", `${ok.toLocaleString("en-US")} of ${rounds.length.toLocaleString("en-US")} on file`, ok));
    stats.push(said("rounds that failed reconciliation", failed === 0 ? "none of the rounds on file" : `${failed.toLocaleString("en-US")} of ${rounds.length.toLocaleString("en-US")} on file`, failed));
    if (failed > 0) {
      const { causes, undetailed, worstGap } = failureCauses(rounds);
      const parts = [...causes].sort((a, b) => b[1] - a[1]).map(([cause, n]) => `${n} ${cause}`);
      if (undetailed > 0) parts.push(`${undetailed} from rounds stored before the checks were kept`);
      stats.push(said("why they failed", parts.join(", ")));
      stats.push(worstGap === null ? missing("worst disagreement", "no failure on file carries the two figures") : said("worst disagreement", `${worstGap.toLocaleString("en-US")} wei`, Number(worstGap)));
    }
    stats.push(count("fights on file", rounds.length, "one per round"));
    const pots = rounds.map((r) => big(r.potWei));
    const biggest = pots.reduce((a, b) => (b > a ? b : a), 0n);
    stats.push({ ...money("largest pot on file", biggest, rate), label: "largest pot on file" });
    const winners = new Map<string, number>();
    for (const round of rounds) {
      const kind = (round.winner ?? "").split("-")[0] || "unknown";
      winners.set(kind, (winners.get(kind) ?? 0) + 1);
    }
    stats.push(said("who won them", [...winners].map(([kind, n]) => `${n} ${kind}`).join(", ")));
    // How long the window on file covers, which is the one thing the round
    // record's timestamps can say exactly.
    const times = rounds.map((r) => Date.parse(r.createdAt ?? "")).filter((t) => Number.isFinite(t));
    if (times.length > 1) {
      const hours = (Math.max(...times) - Math.min(...times)) / 3_600_000;
      stats.push(said("what those rounds cover", `${hours.toFixed(1)} hours, ending ${new Date(Math.max(...times)).toISOString()}`, hours));
    }
  }

  if (stores.transfers === null) {
    stats.push(missing("rounds that moved money on chain", "there is no ledger for this network"));
  } else {
    const settled = new Set(stores.transfers.filter((t) => t.txHash && t.status === "complete").map((t) => t.roundId ?? ""));
    settled.delete("");
    stats.push(count("rounds that settled on chain", settled.size, "the ledger keeps every one"));
  }

  const fight = stores.arena?.last?.fight;
  const deaths = (fight?.log ?? []).filter((e) => e.type === "death").length;
  stats.push(missing("eliminations in total", WHY_NO_LOG));
  if (fight?.log) {
    stats.push(count("eliminations in the round on screen", deaths));
    stats.push(said("that round lasted", fight.durationMs ? `${(fight.durationMs / 1000).toFixed(1)} seconds` : "not recorded"));
  }
  stats.push(missing("longest and shortest round", "a round record carries when it was created, not how long it ran"));

  if (stores.transfers === null) {
    stats.push(missing("chips paid out", "there is no ledger for this network"));
  } else {
    const paid = stores.transfers.filter((t) => t.kind === "payout" && t.status === "complete").reduce((a, t) => a + big(t.amountWei), 0n);
    stats.push(money("chips paid out to winners", paid, rate));
  }
  return { title: "the pit", stats };
}

function reasoning(stores: Stores): Group {
  const stats: Stat[] = [];
  const rounds = stores.rounds;
  if (rounds === null) return { title: "reasoning", stats: [missing("SERV calls", "there is no round store for this network")] };

  const calls = sum(rounds.map((r) => r.servCalls ?? 0));
  stats.push(count("SERV calls on file", calls));

  // A round whose cost is its own carries the tokens behind it. One stored
  // before that carries the meter's running total for the process it was
  // played in, stamped onto every round in that process, which is not this
  // round's spend and is not summable.
  const ownCost = rounds.filter((r) => r.servTokensIn !== undefined || r.servTokensOut !== undefined);
  const stamped = rounds.length - ownCost.length;
  if (ownCost.length === 0) {
    stats.push(missing("tokens in and out", `every round on file was stored before the tokens were recorded${stamped > 0 ? `, all ${stamped} of them` : ""}`));
    const values = new Set(rounds.filter((r) => (r.servMicroCents ?? 0) > 0).map((r) => r.servMicroCents));
    stats.push(
      missing(
        "spend on reasoning",
        values.size === 0
          ? "no round on file called SERV, so there is nothing to bill"
          : `every round on file carries the meter's running total rather than its own spend${values.size === 1 ? `, the same ${[...values][0]?.toLocaleString("en-US")} micro cents on all of them` : ""}, so it cannot be totalled`,
      ),
    );
  } else {
    stats.push(said("tokens in and out", `${sum(ownCost.map((r) => r.servTokensIn ?? 0)).toLocaleString("en-US")} in, ${sum(ownCost.map((r) => r.servTokensOut ?? 0)).toLocaleString("en-US")} out`, sum(ownCost.map((r) => (r.servTokensIn ?? 0) + (r.servTokensOut ?? 0)))));
    const micro = sum(ownCost.map((r) => r.servMicroCents ?? 0));
    stats.push(
      said(
        "spend on reasoning",
        `$${(micro / 100_000_000).toFixed(6)} across ${ownCost.length.toLocaleString("en-US")} rounds that record their own cost${stamped > 0 ? `, with ${stamped.toLocaleString("en-US")} older rounds left out because theirs is a meter total` : ""}`,
        micro,
      ),
    );
  }

  const { reasoned, learned, instinct, learnable } = sourcesOf(rounds);
  stats.push(count("rounds reasoned", reasoned));
  stats.push(count("rounds drawn from what it learned", learned));
  stats.push(count("rounds on instinct", instinct));
  stats.push(count("decisions the learning can draw on", learnable, "with the spot that produced them"));

  const latencies = (stores.plans ?? []).flatMap((p) => (p.plan?.decisions ?? []).map((d) => d.latencyMs)).filter((ms): ms is number => typeof ms === "number" && ms > 0);
  if (latencies.length === 0) {
    stats.push(missing("decision latency", "the plan store keeps the last few rounds, and none of them carries a latency"));
  } else {
    const sorted = [...latencies].sort((a, b) => a - b);
    stats.push(said("median decision latency", `${sorted[Math.floor(sorted.length / 2)]!.toLocaleString("en-US")} ms across ${latencies.length} decisions still in the plan store`));
  }
  return { title: "reasoning", stats };
}

function moneyGroup(stores: Stores, rate: bigint | null): Group {
  const transfers = stores.transfers;
  if (transfers === null) return { title: "the money", stats: [missing("transfers", "there is no ledger for this network")] };

  const kinds = kindsOf(transfers);
  const stats: Stat[] = [];
  for (const [label, kind] of [
    ["entries", "entry"],
    ["payouts", "payout"],
    ["loans", "loan"],
    ["repayments", "repayment"],
    ["seizures", "seizure"],
    ["operator refills", "refill"],
  ] as const) {
    const held = kinds.get(kind);
    stats.push(held === undefined ? count(label, 0) : count(label, held.n));
  }
  const onChain = transfers.filter((t) => t.txHash && t.status === "complete").length;
  stats.push(count("transactions on chain", onChain));
  const unfinished = transfers.filter((t) => t.status !== "complete");
  stats.push(said("transfers that did not complete", unfinished.length === 0 ? "none" : `${unfinished.length} (${[...new Set(unfinished.map((t) => `${t.kind} ${t.status}`))].join(", ")})`, unfinished.length));
  stats.push(money("moved in total", transfers.reduce((a, t) => a + big(t.amountWei), 0n), rate));
  stats.push(said("gas spent", eth(transfers.reduce((a, t) => a + big(t.feeWei), 0n))));

  const rounds = stores.rounds;
  if (rounds === null) stats.push(missing("has reconciliation ever failed", "there is no round store for this network"));
  else {
    const failed = rounds.filter((r) => r.reconciled === false).length;
    const { causes, undetailed } = failureCauses(rounds);
    const why = [...causes].sort((a, b) => b[1] - a[1]).map(([cause, n]) => `${n} ${cause}`);
    stats.push(
      said(
        "has reconciliation ever failed",
        failed === 0
          ? `not on any of the ${rounds.length} rounds on file`
          : why.length === 0
            ? `yes, on ${failed} of the ${rounds.length} rounds on file, all of them stored before the checks were kept, so the cause is not recorded`
            : `yes, on ${failed} of the ${rounds.length} rounds on file: ${why.join(", ")}${undetailed > 0 ? `, and ${undetailed} stored before the checks were kept` : ""}`,
        failed,
      ),
    );
  }
  return { title: "the money", stats };
}

function marrow(stores: Stores, rate: bigint | null): Group {
  const stats: Stat[] = [];
  const transfers = stores.transfers;
  if (transfers === null) {
    stats.push(missing("loans approved", "there is no ledger for this network"));
  } else {
    const loans = transfers.filter((t) => t.kind === "loan");
    stats.push(count("loans approved", loans.length));
    stats.push(money("lent in total", loans.reduce((a, t) => a + big(t.amountWei), 0n), rate));
    const biggest = loans.reduce((a, t) => (big(t.amountWei) > a ? big(t.amountWei) : a), 0n);
    stats.push(money("biggest single loan", biggest, rate));
    const repaid = transfers.filter((t) => t.kind === "repayment");
    stats.push(money("repaid in total", repaid.reduce((a, t) => a + big(t.amountWei), 0n), rate));
  }
  stats.push(missing("loans refused", "a refusal lives in the plan the player was shown, and the plan store keeps only the last few rounds"));
  stats.push(missing("interest earned", "a repayment records the amount that moved, not what part of it was interest"));

  const debts = stores.debts;
  if (debts === null) {
    stats.push(missing("owed to the bank now", "there is no debt store for this network"));
  } else {
    const rows = Object.values(debts);
    stats.push(money("principal on the book now", rows.reduce((a, d) => a + big(d.principalWei), 0n), rate));
    stats.push(money("interest on the book now", rows.reduce((a, d) => a + big(d.interestWei), 0n), rate));
    const rates = rows.map((d) => d.rateBps ?? 0).filter((bps) => bps > 0);
    stats.push(rates.length === 0 ? said("highest rate on the book now", "nothing is out on loan") : said("highest rate on the book now", `${(Math.max(...rates) / 100).toFixed(2)} percent a round`, Math.max(...rates)));
  }
  stats.push(missing("highest rate ever charged", "a wreck record keeps what was owed, not the rate it was owed at"));

  const wrecks = stores.wrecks;
  if (wrecks === null) stats.push(missing("written off", "there is no wreck store for this network"));
  else {
    stats.push(money("written off", wrecks.reduce((a, w) => a + big(w.writtenOffWei), 0n), rate));
    stats.push(money("seized", wrecks.reduce((a, w) => a + big(w.seizedWei), 0n), rate));
  }
  return { title: "marrow, the lender", stats };
}

function dead(stores: Stores, rate: bigint | null): Group {
  const wrecks = stores.wrecks;
  if (wrecks === null) return { title: "the dead", stats: [missing("agents wrecked", "there is no wreck store for this network")] };

  const stats: Stat[] = [count("agents wrecked", wrecks.length)];
  const triggers = new Map<string, number>();
  for (const w of wrecks) triggers.set(w.trigger ?? "not recorded", (triggers.get(w.trigger ?? "not recorded") ?? 0) + 1);
  stats.push(said("what finished them", [...triggers].map(([t, n]) => `${n} ${t}`).join(", ")));

  const longest = maxBy<WreckRow>(wrecks, (w) => w.roundsSurvived ?? 0);
  const shortest = minBy<WreckRow>(wrecks, (w) => w.roundsSurvived ?? 0);
  const career = (row: WreckRow): string => {
    const rounds = row.roundsSurvived ?? 0;
    return `${rounds} ${rounds === 1 ? "round" : "rounds"}, ${row.name ?? row.walletId ?? "unnamed"}`;
  };
  stats.push(longest === null ? missing("longest career", "no wreck on file") : said("longest career", career(longest), longest.roundsSurvived ?? 0));
  stats.push(shortest === null ? missing("shortest career", "no wreck on file") : said("shortest career", career(shortest), shortest.roundsSurvived ?? 0));
  stats.push(money("biggest peak balance", wrecks.reduce((a, w) => (big(w.peakBalanceWei) > a ? big(w.peakBalanceWei) : a), 0n), rate));
  stats.push(money("largest debt at death", wrecks.reduce((a, w) => (big(w.debtAtDeathWei) > a ? big(w.debtAtDeathWei) : a), 0n), rate));
  stats.push(count("wrecks that had ever won a round", wrecks.filter((w) => (w.wins ?? 0) > 0).length));
  return { title: "the dead", stats };
}

function roster(stores: Stores): Group {
  const stats: Stat[] = [
    missing("most and least successful character", WHY_NO_REELS),
    missing("rarest draw seen", WHY_NO_REELS),
    missing("three of a kind drawn", WHY_NO_REELS),
  ];
  const reels = stores.arena?.last?.fight?.characters ?? [];
  if (reels.length > 0) {
    const three = reels.filter((c) => c.combo === "threeOfAKind").length;
    const pairs = reels.filter((c) => c.combo === "pair").length;
    stats.push(said("in the round on screen", `${reels.length} draws, ${three} three of a kind, ${pairs} pairs`, three));
  }
  return { title: "the roster", stats };
}

function players(stores: Stores): Group {
  const stats: Stat[] = [];
  const handles = new Set([...claimsIn(stores.picks), ...claimsIn(stores.pulls), ...claimsIn(stores.fighters)].filter((h) => h.length > 0));
  stats.push(count("handles claimed", handles.size));

  const picks = (stores.picks ?? []).filter((line) => line.k === "pick").length;
  stats.push(stores.picks === null ? missing("picks made", "there is no pick log for this network") : count("picks made", picks));

  const board = stores.leaderboard;
  if (board === null) {
    stats.push(missing("correct picks", "there is no leaderboard for this network"));
  } else {
    stats.push(count("correct picks", sum(board.map((r) => r.correct ?? 0))));
    stats.push(count("points scored", sum(board.map((r) => r.points ?? 0))));
    const best = maxBy(board, (r) => r.best ?? 0);
    const streak = best?.best ?? 0;
    stats.push(
      best === null
        ? missing("best streak", "nobody on the board")
        : streak === 0
          ? said("best streak", "nobody has called two in a row yet", 0)
          : said("best streak", `${streak} in a row, ${best.handle ?? "unnamed"}`, streak),
    );
    const reads = sum(board.map((r) => r.reads ?? 0));
    stats.push(count("rounds called in full", reads));
    stats.push(count("full calls that were right", sum(board.map((r) => r.readsRight ?? 0))));
  }

  const claims = claimsIn(stores.fighters).length;
  const released = (stores.fighters ?? []).filter((line) => line.k === "release").length;
  stats.push(stores.fighters === null ? missing("fighters claimed", "there is no fighter log for this network") : said("fighters claimed", `${claims} ever, ${claims - released} held now`, claims));

  const careers = stores.careers;
  if (careers === null) {
    stats.push(missing("best fighter career", "there is no career store for this network"));
  } else {
    const best = maxBy<CareerRow>(careers, (r) => r.wins ?? 0);
    stats.push(
      best === null
        ? missing("best fighter career", "no fighter has been in a round yet")
        : said("best fighter career", `${best.name ?? best.handle ?? "unnamed"}, ${best.wins ?? 0} wins in ${(best.rounds ?? 0).toLocaleString("en-US")} rounds, ${(best.kills ?? 0).toLocaleString("en-US")} kills, longest run of ${best.longest ?? 0}`, best.wins ?? 0),
    );
    stats.push(count("kills recorded for claimed fighters", sum(careers.map((r) => r.kills ?? 0)), "the only kills any store keeps"));
    stats.push(count("rounds a claimed fighter has been in", Math.max(0, ...careers.map((r) => r.rounds ?? 0)), "a floor under rounds played"));
  }
  return { title: "the players", stats };
}

/** Every group, counted from the stores as they are. */
export function collect(stores: Stores, now: Date = new Date()): Report {
  const rate = chipRate(stores);
  return {
    network: stores.network,
    dataDir: stores.dataDir,
    at: now.toISOString(),
    groups: [pit(stores, rate), reasoning(stores), moneyGroup(stores, rate), marrow(stores, rate), dead(stores, rate), roster(stores), players(stores)],
  };
}
