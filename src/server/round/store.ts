// Round history: what each agent decided, why, and what its balance did.
// Feeds the reasoning surface and the next round's recent outcomes.

import { StoreFile, UNKNOWN_NETWORK } from "../store/file";

export interface StoredAgentRound {
  agentId: string;
  name: string;
  strategy: string;
  address: string;
  entered: boolean;
  stake: number;
  reason: string;
  source: "serv" | "heuristic";
  rejection?: string;
  model?: string;
  balanceBeforeWei: string;
  balanceAfterWei: string;
  entryTxHash?: string;
  entryLink?: string | null;
  payoutTxHash?: string;
  payoutLink?: string | null;
}

export interface StoredRound {
  roundId: string;
  seed: string;
  createdAt: string;
  network: string;
  entrants: number;
  winner: string;
  potWei: string;
  rakeWei: string;
  agents: StoredAgentRound[];
  reconciled: boolean;
  servCalls: number;
  servMicroCents: number;
}

const MAX_ROUNDS = 200;

export class RoundStore {
  private rounds: StoredRound[] = [];
  private readonly sync: StoreFile;

  /**
   * Written by whichever context settles and read by the one that plans, so
   * it rereads rather than trusting the copy it opened with. An agent's
   * recent outcomes are what its next decision is built on, and a plan route
   * holding a snapshot from process start was deciding on a history that had
   * stopped moving.
   */
  constructor(file: string, network: string = UNKNOWN_NETWORK) {
    this.sync = new StoreFile(file, network, (body) => {
      const rounds = body?.rounds;
      this.rounds = Array.isArray(rounds) ? (rounds as StoredRound[]).filter((r) => r && typeof r.roundId === "string") : [];
    });
    this.sync.read();
  }

  get(roundId: string): StoredRound | undefined {
    this.sync.read();
    return this.rounds.find((r) => r.roundId === roundId);
  }

  recent(limit = 20): StoredRound[] {
    this.sync.read();
    return this.rounds.slice(-limit).reverse();
  }

  /** Outcomes for one agent, oldest first. */
  outcomesFor(agentId: string, limit = 5): Array<{ roundId: string; entered: boolean; netWei: bigint }> {
    this.sync.read();
    const out: Array<{ roundId: string; entered: boolean; netWei: bigint }> = [];
    for (const round of this.rounds.slice(-limit)) {
      const agent = round.agents.find((a) => a.agentId === agentId);
      if (!agent) continue;
      out.push({ roundId: round.roundId, entered: agent.entered, netWei: BigInt(agent.balanceAfterWei) - BigInt(agent.balanceBeforeWei) });
    }
    return out;
  }

  /**
   * What a wallet's occupant did, from the round it took the seat.
   *
   * Everything a wreck record needs that is not a balance or a debt: how hard
   * it was pushing, how far it fell from its best, and how long it lasted.
   * A null birth round means it has been there from the beginning.
   */
  historyFor(agentId: string, bornAtRound: string | null, baseStakeChips: number): { peakBalanceWei: bigint; recentStakeMultiples: number[]; roundsSurvived: number; wins: number } {
    this.sync.read();
    const from = bornAtRound === null ? 0 : Math.max(0, this.rounds.findIndex((r) => r.roundId === bornAtRound));
    let peakBalanceWei = 0n;
    const recentStakeMultiples: number[] = [];
    let roundsSurvived = 0;
    let wins = 0;
    for (const round of this.rounds.slice(from)) {
      const agent = round.agents.find((a) => a.agentId === agentId);
      if (!agent) continue;
      roundsSurvived += 1;
      for (const wei of [BigInt(agent.balanceBeforeWei), BigInt(agent.balanceAfterWei)]) {
        if (wei > peakBalanceWei) peakBalanceWei = wei;
      }
      // A multiple of the seat price, which is what says how hard it was
      // pushing. The raw number of chips says nothing without the seat.
      if (agent.entered && baseStakeChips > 0) recentStakeMultiples.push(agent.stake / baseStakeChips);
      if (round.winner === `agent-${agentId}`) wins += 1;
    }
    return { peakBalanceWei, recentStakeMultiples: recentStakeMultiples.slice(-5), roundsSurvived, wins };
  }

  save(round: StoredRound): void {
    this.sync.read();
    const i = this.rounds.findIndex((r) => r.roundId === round.roundId);
    if (i >= 0) this.rounds[i] = round;
    else this.rounds.push(round);
    if (this.rounds.length > MAX_ROUNDS) this.rounds = this.rounds.slice(-MAX_ROUNDS);
    this.sync.write({ version: 1, rounds: this.rounds });
  }
}
