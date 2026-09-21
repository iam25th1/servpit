// The six named agents and their strategy descriptors. Data only: the
// heuristic fallback reads the numbers, the SERV prompt reads the words.
// No secrets here; this file is safe for the client bundle.

export type StrategyId = "cautious" | "aggressive" | "streak-chaser" | "contrarian" | "steady" | "opportunist";

export interface AgentProfile {
  readonly id: string;
  readonly name: string;
  readonly strategy: StrategyId;
  /** One sentence the SERV prompt uses to describe the operator's posture. */
  readonly descriptor: string;
  /**
   * How this one talks. The input framing stays neutral resource management,
   * which is what the Playground test passed on; this only shapes the voice
   * the answer comes back in.
   */
  readonly voice: string;
  /** Heuristic fallback: enter only when balance covers this many stakes. */
  readonly minBankrollMultiple: number;
  /** Heuristic fallback: base chance to enter, integer percent. */
  readonly baseEnterChance: number;
  /** Heuristic fallback: how the last outcome shifts the chance, integer percent points. */
  readonly afterWinShift: number;
  readonly afterLossShift: number;
}

export const NAMED_AGENTS: readonly AgentProfile[] = Object.freeze([
  { voice: "Careful and a little dry. Weighs the downside first.", id: "atlas", name: "Atlas", strategy: "cautious", descriptor: "preserves capital first, commits only when the balance comfortably covers the allocation", minBankrollMultiple: 6, baseEnterChance: 45, afterWinShift: 5, afterLossShift: -20 },
  { voice: "Brash and short. Wants in, says so without hedging.", id: "blaze", name: "Blaze", strategy: "aggressive", descriptor: "commits whenever the balance allows, treats each opportunity as worth taking", minBankrollMultiple: 1, baseEnterChance: 90, afterWinShift: 5, afterLossShift: 0 },
  { voice: "Rides momentum. Talks about how the last few went.", id: "comet", name: "Comet", strategy: "streak-chaser", descriptor: "leans in after a good outcome and sits out after a poor one", minBankrollMultiple: 2, baseEnterChance: 60, afterWinShift: 30, afterLossShift: -30 },
  { voice: "Contrary. Does the opposite of the room and enjoys it.", id: "delta", name: "Delta", strategy: "contrarian", descriptor: "steps in after a poor outcome and eases off after a good one", minBankrollMultiple: 2, baseEnterChance: 55, afterWinShift: -25, afterLossShift: 25 },
  { voice: "Even and unbothered. Same answer whatever just happened.", id: "ember", name: "Ember", strategy: "steady", descriptor: "allocates at a constant cadence regardless of recent results", minBankrollMultiple: 3, baseEnterChance: 70, afterWinShift: 0, afterLossShift: 0 },
  { voice: "Reads the room. Cares about how many are in and how big the pot is.", id: "flint", name: "Flint", strategy: "opportunist", descriptor: "prefers larger pools with more participants and skips thin ones", minBankrollMultiple: 2, baseEnterChance: 50, afterWinShift: 10, afterLossShift: -10 },
]);

/** Wallet id used for the operator held pot. Not an agent, never reasons, never enters. */
export const POT_WALLET_ID = "pot";
