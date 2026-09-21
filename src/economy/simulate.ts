// Plays the economy out over many rounds, with no chain and no model.
//
// The resolver is the real one, so who wins is decided by the same fight the
// game runs. The decisions are the same heuristic the game falls back to when
// SERV is absent, so who enters is decided the same way. Everything about
// money goes through the rules module, so what this measures is the economy
// the game would actually run and not a second copy of it.
//
// Units are chips throughout: a funded wallet is 100 and a seat is 10, the
// same numbers the live game shows.

import { NAMED_AGENTS, type AgentProfile } from "@/config/agents";
import { DEFAULT_ROUND, type RoundConfig } from "@/config/round";
import type { Entrant } from "@/engine/resolveRound";
import { resolveRound } from "@/engine/resolveRound";
import { heuristicDecision } from "@/server/decisions/heuristic";
import type { RoundOutcome } from "@/server/decisions/types";
import { clampStake, splitCappedPrize } from "./prize";
import { accrueInterest, applyWinnings, originateLoan, replacementAgent, seize, totalDebt, wreckReason, type Agent, type EconomyConfig, type WreckReason } from "./rules";

export interface SimConfig {
  rounds: number;
  /** Seats in the fight. The rest of the field is house bots. */
  entrants: number;
  seed: string;
  /** Share of an unclaimed prize the bank takes, 0 to 1. */
  bankShare: number;
  /** What each agent starts with, and what a replacement is funded with. */
  startingBalance: bigint;
  /** What the bank starts with. */
  treasury: bigint;
  /** An agent that cannot afford a seat borrows up to this many stakes. */
  borrowToStakes: bigint;
  /** How many base stakes an agent may put on one seat. */
  maxStakeMultiple: number;
  economy: EconomyConfig;
}

export interface SimReport {
  config: SimConfig;
  /** First round any agent could not afford a seat. */
  firstBrokeRound: number | null;
  firstWreckRound: number | null;
  /** Round by which every one of the six original agents had been wrecked. */
  allWreckedByRound: number | null;
  wrecks: number;
  wrecksByReason: Record<WreckReason, number>;
  wrecksPer100Rounds: number;
  treasuryStart: bigint;
  treasuryEnd: bigint;
  treasuryMin: bigint;
  treasuryMax: bigint;
  /** One reading per round, for a shape rather than two endpoints. */
  treasurySeries: bigint[];
  /** Rounds where an agent asked for credit and the bank could not write it. */
  dryRounds: number;
  loans: number;
  lent: bigint;
  interestCollected: bigint;
  seized: bigint;
  writtenOff: bigint;
  /** Fresh money the operator had to put in to replace wrecked agents. */
  operatorInjected: bigint;
  /** What wrecked agents walked away holding, after the seizure took its due. */
  retired: bigint;
  /** What the agents are holding at the end. */
  agentBalances: bigint;
  /** Principal plus interest still owed to the bank at the end. */
  outstandingDebt: bigint;
  /** Rounds where the winner's stake, not the pool, decided the payout. */
  cappedRounds: number;
  /** What the agents gained or lost in total, net of what was injected. */
  agentNet: bigint;
  /** agentNet per agent per round, in chips. */
  evPerAgentPerRound: number;
  /**
   * What a round does to an agent's equity, split by whether it owed anything
   * when the round started.
   *
   * The aggregate above hides the thing that matters: an agent carrying debt
   * is supposed to be losing ground, and an agent that owes nothing is
   * supposed to be playing a roughly fair game. One number cannot say both.
   */
  evPerCleanRound: number;
  evPerIndebtedRound: number;
  cleanAgentRounds: number;
  indebtedAgentRounds: number;
  rolloverEnd: bigint;
  rake: bigint;
  flags: string[];
}

interface Seat {
  profile: AgentProfile;
  agent: Agent;
  recentOutcomes: RoundOutcome[];
  creditDenied: boolean;
  /** Bumped every time this seat's occupant is replaced. */
  generation: number;
  /** What this seat put up this round, between the base stake and the ceiling. */
  stakeWei: bigint;
}

const min = (a: bigint, b: bigint): bigint => (a < b ? a : b);
const max = (a: bigint, b: bigint): bigint => (a > b ? a : b);

/** Equity is what an agent would walk away with: balance less what it owes. */
const equity = (seat: Seat): bigint => seat.agent.balanceWei - totalDebt(seat.agent.debt);

export function simulate(config: SimConfig): SimReport {
  if (!Number.isInteger(config.rounds) || config.rounds < 1) throw new RangeError(`rounds must be a positive integer, got ${config.rounds}`);
  if (!Number.isInteger(config.entrants) || config.entrants < NAMED_AGENTS.length) throw new RangeError(`entrants must leave room for the named agents, got ${config.entrants}`);

  const stake = config.economy.stakeWei;
  const round: RoundConfig = { ...DEFAULT_ROUND, stakeTiers: { ...DEFAULT_ROUND.stakeTiers, [DEFAULT_ROUND.stakeTier]: Number(stake) } };

  const seats: Seat[] = NAMED_AGENTS.map((profile) => ({
    profile,
    agent: { id: profile.id, balanceWei: config.startingBalance, debt: { principalWei: 0n, interestWei: 0n } },
    recentOutcomes: [],
    creditDenied: false,
    generation: 0,
    stakeWei: config.economy.stakeWei,
  }));

  let treasury = config.treasury;
  let rollover = 0n;
  let rake = 0n;
  let operatorInjected = 0n;
  let lent = 0n;
  let loans = 0;
  let interestCollected = 0n;
  let seized = 0n;
  let writtenOff = 0n;
  let dryRounds = 0;
  let retired = 0n;
  let wrecks = 0;
  const wrecksByReason: Record<WreckReason, number> = { "debt above the ceiling": 0, "broke and denied credit": 0 };
  let firstBrokeRound: number | null = null;
  let firstWreckRound: number | null = null;
  let allWreckedByRound: number | null = null;
  const everWrecked = new Set<string>();
  const treasurySeries: bigint[] = [];
  let treasuryMin = treasury;
  let treasuryMax = treasury;
  let capped = 0;
  let cleanAgentRounds = 0;
  let indebtedAgentRounds = 0;
  let cleanDelta = 0n;
  let indebtedDelta = 0n;

  // Everything that exists at the start. Nothing may appear or vanish except
  // through the operator putting money in, so this is checked every round.
  const openingValue = config.treasury + config.startingBalance * BigInt(seats.length);

  for (let r = 0; r < config.rounds; r++) {
    const roundId = `${config.seed}-${r}`;
    // Equity at the top of the round, and who was carrying debt into it.
    const opened = new Map(seats.map((seat) => [seat.profile.id, { equity: equity(seat), indebted: totalDebt(seat.agent.debt) > 0n }]));

    // Interest first: a round costs the agent before it pays anything.
    for (const seat of seats) seat.agent = accrueInterest(config.economy, seat.agent);

    // Credit. An agent that cannot cover a seat asks the bank, whatever it
    // was going to decide: it needs capital before it needs an opinion.
    let askedAndRefused = false;
    for (const seat of seats) {
      seat.creditDenied = false;
      if (seat.agent.balanceWei >= stake) continue;
      if (firstBrokeRound === null) firstBrokeRound = r;
      const request = config.borrowToStakes * stake - seat.agent.balanceWei;
      const outcome = originateLoan(config.economy, treasury, seat.agent, request);
      if (outcome.approved) {
        seat.agent = outcome.agent;
        treasury = outcome.treasuryWei;
        lent += outcome.amountWei;
        loans += 1;
      } else {
        seat.creditDenied = true;
        if (outcome.reason === "treasury cannot cover the minimum") askedAndRefused = true;
      }
    }
    if (askedAndRefused) dryRounds += 1;

    // What each seat is willing to put up this round. Clamped to the bounds
    // whatever the policy asks for, so no decision can put an agent outside
    // them.
    for (const seat of seats) {
      seat.stakeWei = clampStake(stake, config.maxStakeMultiple, stake);
    }

    // Decisions, by the same heuristic the game falls back to.
    const entering: Seat[] = [];
    for (const seat of seats) {
      const decision = heuristicDecision(
        { profile: seat.profile, address: `0x${seat.profile.id}`, balanceWei: seat.agent.balanceWei, stakeWei: stake, recentOutcomes: seat.recentOutcomes },
        { roundId, participants: config.entrants, poolWei: stake * BigInt(config.entrants), stakeWei: stake },
      );
      // The balance decides, not the decision. Same gate the planner applies
      // before money moves.
      if (decision.enter && seat.agent.balanceWei >= seat.stakeWei) entering.push(seat);
    }

    let entries = 0n;
    for (const seat of entering) {
      seat.agent = { ...seat.agent, balanceWei: seat.agent.balanceWei - seat.stakeWei };
      entries += seat.stakeWei;
    }

    const botCount = Math.max(0, config.entrants - entering.length);
    const entrants: Entrant[] = [
      ...entering.map((seat) => ({ id: `agent-${seat.profile.id}` })),
      ...Array.from({ length: botCount }, (_, i) => ({ id: `bot-${String(i).padStart(2, "0")}` })),
    ];
    const result = resolveRound(roundId, entrants, round);
    const winnerId = result.placements[0];
    const winner = entering.find((seat) => `agent-${seat.profile.id}` === winnerId) ?? null;

    // The winner takes what its own stake bought, and the rest rolls over.
    // Without that cap a floor stake could sweep a pot that bigger stakers
    // and a long rollover built, and staking more would buy nothing.
    const prize = splitCappedPrize({
      poolWei: entries + rollover,
      rakeBps: round.rakeBps,
      winnerStakeWei: winner ? winner.stakeWei : null,
      entrants: config.entrants,
    });
    rake += prize.rakeWei;
    if (prize.capped) capped += 1;
    if (winner) {
      const applied = applyWinnings(winner.agent, prize.payoutWei);
      winner.agent = applied.agent;
      treasury += applied.toTreasuryWei;
      interestCollected += applied.repayment.interestPaidWei;
      rollover = prize.nextRolloverWei;
    } else {
      // The bank's share is of what nobody real claimed, which on a house win
      // is the whole prize.
      const ppm = BigInt(Math.round(config.bankShare * 1_000_000));
      const toBankWei = (prize.nextRolloverWei * ppm) / 1_000_000n;
      treasury += toBankWei;
      rollover = prize.nextRolloverWei - toBankWei;
    }

    for (const seat of seats) {
      const entered = entering.includes(seat);
      const net = seat === winner ? prize.payoutWei - seat.stakeWei : entered ? -seat.stakeWei : 0n;
      seat.recentOutcomes = [...seat.recentOutcomes, { roundId, entered, netWei: net }].slice(-10);
    }

    // Measured before the wreck block, so this is the agent's own result for
    // the round rather than the bank writing off what it could not recover.
    for (const seat of seats) {
      const open = opened.get(seat.profile.id)!;
      const delta = equity(seat) - open.equity;
      if (open.indebted) {
        indebtedAgentRounds += 1;
        indebtedDelta += delta;
      } else {
        cleanAgentRounds += 1;
        cleanDelta += delta;
      }
    }

    // Wrecks, seizures and replacements, after the round has paid out. An
    // agent that won its way back under the ceiling is not wrecked.
    for (const seat of seats) {
      const reason = wreckReason(config.economy, seat.agent, seat.creditDenied);
      if (!reason) continue;
      const closed = seize(seat.agent);
      treasury += closed.seizedWei;
      seized += closed.seizedWei;
      writtenOff += closed.writtenOffWei;
      wrecks += 1;
      wrecksByReason[reason] += 1;
      if (firstWreckRound === null) firstWreckRound = r;
      everWrecked.add(seat.profile.id);
      if (allWreckedByRound === null && everWrecked.size === seats.length) allWreckedByRound = r;

      // Whatever the seizure did not take is the departing agent's, and it
      // leaves with it. It is still value the agents realised, so it is
      // counted rather than quietly dropped.
      retired += closed.agent.balanceWei;

      // A replacement always takes the seat with a full bankroll. What the
      // setting changes is who paid for it: the bank lends up to the
      // replacement debt and the operator covers the rest, and the agent owes
      // the bank's part.
      //
      // Capital and debt are separate levers and tying them together measured
      // the wrong thing. Funding a replacement to only what it owed meant
      // turning the setting on also cut its bankroll, so a sweep across it
      // could not tell a credit effect from a capitalisation effect.
      const fromBank = min(config.economy.replacementDebtWei, treasury);
      treasury -= fromBank;
      operatorInjected += config.startingBalance - fromBank;
      seat.agent = replacementAgent({ ...config.economy, replacementDebtWei: fromBank }, seat.profile.id, config.startingBalance);
      seat.recentOutcomes = [];
      seat.generation += 1;
    }

    treasurySeries.push(treasury);
    treasuryMin = min(treasuryMin, treasury);
    treasuryMax = max(treasuryMax, treasury);

    // Nothing appears and nothing vanishes. A loan moves value from the bank
    // to an agent, an entry moves it to the pot, a payout moves it back, a
    // repayment or a seizure moves it to the bank, and the rake leaves. A
    // write off is unpaid debt, not money, so it does not appear here.
    const held = seats.reduce((sum, seat) => sum + seat.agent.balanceWei, 0n) + treasury + rollover + rake + retired;
    const expected = openingValue + operatorInjected;
    if (held !== expected) throw new Error(`round ${r} lost track of ${expected - held} chips: held ${held} against ${expected}`);
  }

  const agentNet = seats.reduce((sum, seat) => sum + equity(seat), 0n) + retired - config.startingBalance * BigInt(seats.length) - operatorInjected;
  const flags: string[] = [];
  if (treasuryEndIsDry(treasury, config.economy)) flags.push(`bank insolvent: it ended holding ${treasury} chips, under the ${config.economy.minLoanWei} chip minimum loan, so it can no longer lend at all`);
  else if (treasury < config.treasury && writtenOff > interestCollected) {
    // Not yet broke, but on the way: it is paying out more in bad debt than
    // it is earning, and the only thing holding it up is its opening balance.
    flags.push(`bank is not self funding: ${treasury} chips left of ${config.treasury}, ${writtenOff} written off against ${interestCollected} earned in interest`);
  }
  if (loans === 0 && dryRounds > 0) {
    // Holding money it structurally cannot lend: a quarter of a small
    // treasury is under the minimum loan, so every request is refused.
    flags.push(`bank never wrote a loan: ${(config.economy.maxTreasuryShareBps / 100).toFixed(0)}% of ${treasury} chips is under the ${config.economy.minLoanWei} chip minimum`);
  }
  if (wrecks === 0) flags.push("no agent is ever wrecked: the credit rules never bite");
  if (allWreckedByRound !== null && allWreckedByRound < 20) flags.push(`every agent wrecked by round ${allWreckedByRound}: the credit rules bite far too hard`);
  if (dryRounds * 4 > config.rounds) flags.push(`bank dry in ${dryRounds} of ${config.rounds} rounds: agents are asking for credit that is not there`);

  return {
    config,
    firstBrokeRound,
    firstWreckRound,
    allWreckedByRound,
    wrecks,
    wrecksByReason,
    wrecksPer100Rounds: (100 * wrecks) / config.rounds,
    treasuryStart: config.treasury,
    treasuryEnd: treasury,
    treasuryMin,
    treasuryMax,
    treasurySeries,
    dryRounds,
    loans,
    lent,
    interestCollected,
    seized,
    writtenOff,
    operatorInjected,
    retired,
    cappedRounds: capped,
    agentBalances: seats.reduce((sum, seat) => sum + seat.agent.balanceWei, 0n),
    outstandingDebt: seats.reduce((sum, seat) => sum + totalDebt(seat.agent.debt), 0n),
    agentNet,
    evPerAgentPerRound: Number(agentNet) / (seats.length * config.rounds),
    evPerCleanRound: cleanAgentRounds === 0 ? 0 : Number(cleanDelta) / cleanAgentRounds,
    evPerIndebtedRound: indebtedAgentRounds === 0 ? 0 : Number(indebtedDelta) / indebtedAgentRounds,
    cleanAgentRounds,
    indebtedAgentRounds,
    rolloverEnd: rollover,
    rake,
    flags,
  };
}

const treasuryEndIsDry = (treasury: bigint, economy: EconomyConfig): boolean => treasury < economy.minLoanWei;
