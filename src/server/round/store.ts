// Round history: what each agent decided, why, and what its balance did.
// Feeds the reasoning surface and the next round's recent outcomes.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

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

interface FileShape {
  version: 1;
  rounds: StoredRound[];
}

const MAX_ROUNDS = 200;

export class RoundStore {
  private rounds: StoredRound[] = [];

  constructor(private readonly file: string) {
    if (existsSync(file)) {
      const parsed = JSON.parse(readFileSync(file, "utf8")) as Partial<FileShape>;
      if (Array.isArray(parsed.rounds)) this.rounds = parsed.rounds.filter((r) => r && typeof r.roundId === "string");
    }
  }

  get(roundId: string): StoredRound | undefined {
    return this.rounds.find((r) => r.roundId === roundId);
  }

  recent(limit = 20): StoredRound[] {
    return this.rounds.slice(-limit).reverse();
  }

  /** Outcomes for one agent, oldest first. */
  outcomesFor(agentId: string, limit = 5): Array<{ roundId: string; entered: boolean; netWei: bigint }> {
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
    const i = this.rounds.findIndex((r) => r.roundId === round.roundId);
    if (i >= 0) this.rounds[i] = round;
    else this.rounds.push(round);
    if (this.rounds.length > MAX_ROUNDS) this.rounds = this.rounds.slice(-MAX_ROUNDS);
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify({ version: 1, rounds: this.rounds } satisfies FileShape, null, 2) + "\n");
    renameSync(tmp, this.file);
  }
}
