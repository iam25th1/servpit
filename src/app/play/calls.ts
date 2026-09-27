// Calling the agents, from the viewer's side.
//
// Pure, so everything a viewer is told about their calls is testable without
// a browser and is worked out with the same scoring the server settles with.
// The seats come from the finished round on file: who sits in each one, what
// they hold and owe, and what they did last round, which is everything a
// visitor has to read an agent by.

import { NAMED_AGENTS } from "@/config/agents";
import { PERFECT_READ_BONUS, READ_POINTS, REASONED_READ_POINTS, readOutcome, scoreRead, type Calls, type ReadResult } from "@/config/reads";
import { REPLACEMENTS } from "@/config/replacements";
import type { ArenaFeedRound } from "./arenaScreens";

/** Every seat a visitor calls, in roster order. */
export const CALL_SEATS: readonly string[] = NAMED_AGENTS.map((agent) => agent.id);

export type LastRound = "won" | "lost" | "held" | "new";

/** A seat as the calls panel draws it. */
export interface CallSeat {
  agentId: string;
  name: string;
  /** Null for an original, which is drawn with its own fixed face. */
  face: string | null;
  strategy: string;
  /** What it holds going into the next round, or null when that is not known. */
  chips: number | null;
  owes: number;
  /** What it did in the round just played, or null when there was none. */
  last: LastRound | null;
}

/**
 * How an agent tends to play, in a line a visitor can read an agent by.
 *
 * Said plainly because it is the one thing a visitor needs to call an agent
 * well, and it is true of every one of them: it is the posture the model is
 * told to play and the rule the pit falls back on when it is not reasoning.
 */
const STYLE: Readonly<Record<string, string>> = {
  cautious: "Careful. Wants a cushion before it plays.",
  aggressive: "Brash. In nearly every round.",
  "streak-chaser": "Rides streaks. In after a win, out after a loss.",
  contrarian: "Contrary. Out after a win, in after a loss.",
  steady: "Steady. Same answer whatever happened.",
  opportunist: "Opportunist. Likes a full field and a fat pot.",
};

export function styleLine(strategy: string): string {
  return STYLE[strategy] ?? "Plays its own way.";
}

/** What a seat did last round, in a few words, or null when there is nothing to say. */
export function lastLine(last: LastRound | null): string | null {
  if (last === "won") return "won last round";
  if (last === "lost") return "lost last round";
  if (last === "held") return "sat out last round";
  if (last === "new") return "just sat down";
  return null;
}

/** The strategy of whoever sits in a seat, from its face when it is a replacement. */
function strategyOf(agentId: string, face: string | null | undefined): string {
  const replacement = face ? REPLACEMENTS.find((r) => r.face === face) : undefined;
  return replacement?.strategy ?? NAMED_AGENTS.find((a) => a.id === agentId)?.strategy ?? "steady";
}

/**
 * The seats the next round starts from.
 *
 * From the table the worker writes with every result. A round finished before
 * that table existed still has its decisions, the balances after its settle
 * and the lender's book, which say the same thing a little less exactly, so a
 * visitor arriving just after an upgrade can still make calls.
 */
export function callSeats(round: ArenaFeedRound | null): CallSeat[] {
  if (round?.table && round.table.length > 0) return round.table.map((seat) => ({ ...seat }));
  const perChip = (() => {
    try {
      return round?.weiPerChip ? BigInt(round.weiPerChip) : 0n;
    } catch {
      return 0n;
    }
  })();
  const result = (round?.result ?? null) as { agents?: Array<{ agentId: string; balanceAfterWei: string }>; winner?: string } | null;
  const winner = typeof result?.winner === "string" ? result.winner : null;
  return NAMED_AGENTS.map((profile) => {
    const decision = round?.decisions.find((d) => d.agentId === profile.id);
    const after = result?.agents?.find((a) => a.agentId === profile.id);
    let chips: number | null = decision?.balance ?? null;
    if (after && perChip > 0n) {
      try {
        chips = Number(BigInt(after.balanceAfterWei) / perChip);
      } catch {
        // A figure that does not parse is left as the balance the round started with.
      }
    }
    const owed = round?.bank?.book.find((row) => row.agentId === profile.id)?.owed ?? decision?.debt ?? 0;
    const last: LastRound | null = !decision || !result ? null : winner === `agent-${profile.id}` ? "won" : decision.enter ? "lost" : "held";
    return {
      agentId: profile.id,
      name: decision?.name ?? profile.name,
      face: decision?.face ?? null,
      strategy: strategyOf(profile.id, decision?.face),
      chips,
      owes: owed,
      last,
    };
  });
}

/**
 * How a visitor's calls went on a round, or null until it can be said.
 *
 * Only once the round has a result. By then its decisions are the final ones,
 * after the chain's own check, which is exactly what the server scores.
 */
export function roundRead(round: ArenaFeedRound | null, calls: Calls | null): ReadResult | null {
  if (!round?.result || !calls || Object.keys(calls).length === 0) return null;
  return scoreRead(calls, readOutcome(round.decisions, CALL_SEATS));
}

/** One seat's call beside its decision in the lineup. */
export interface SeatCall {
  call: boolean;
  /** Null until the seat has decided. */
  right: boolean | null;
}

export function seatCall(calls: Calls | null, agentId: string, decided: { enter: boolean } | null): SeatCall | null {
  if (!calls || typeof calls[agentId] !== "boolean") return null;
  const call = calls[agentId];
  return { call, right: decided ? call === decided.enter : null };
}

/** What a visitor has called so far, in one line. */
export function callsLine(calls: Calls, seats: number): string {
  const made = Object.values(calls);
  if (made.length === 0) return "Nothing called yet. Tap in or out for each agent.";
  const inCount = made.filter(Boolean).length;
  return `${made.length} of ${seats} called: ${inCount} in, ${made.length - inCount} out.`;
}

/** The terms, in one line, from the same constants the server scores with. */
export const CALL_TERMS = `A right call scores ${READ_POINTS}, or ${REASONED_READ_POINTS} when SERV made the decision. Call all six right for ${PERFECT_READ_BONUS} more.`;
