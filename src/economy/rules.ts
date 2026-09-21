// The rules of the economy, as pure functions.
//
// Nothing here reads a file, a clock, a chain or the environment. Every
// amount is an integer in minor units, bigint throughout, and every function
// returns new values rather than mutating what it was given. That is what
// makes the whole economy testable at its edges and simulatable for
// thousands of rounds without a network.
//
// The unit is deliberately not named. The running game counts in wei and the
// simulator counts in chips, and the rules are the same either way.

export interface EconomyConfig {
  /** Below this a loan is not worth writing. */
  minLoanWei: bigint;
  /** Most principal one agent may owe at once. */
  maxPrincipalWei: bigint;
  /** A single loan may not exceed this share of the treasury, in basis points. */
  maxTreasuryShareBps: number;
  /** Simple interest per round on outstanding principal, in basis points. */
  interestBps: number;
  /** Total debt above this wrecks the agent. */
  debtCeilingWei: bigint;
  /** What a seat costs. An agent holding less than this cannot play. */
  stakeWei: bigint;
  /** What a replacement agent is born owing. Zero means born clean. */
  replacementDebtWei: bigint;
}

export interface Debt {
  principalWei: bigint;
  interestWei: bigint;
}

export interface Agent {
  id: string;
  balanceWei: bigint;
  debt: Debt;
}

export const NO_DEBT: Debt = { principalWei: 0n, interestWei: 0n };

const assertMinor = (value: bigint, name: string): void => {
  if (typeof value !== "bigint" || value < 0n) throw new RangeError(`${name} must be a non negative bigint, got ${String(value)}`);
};

const assertBps = (value: number, name: string): void => {
  if (!Number.isInteger(value) || value < 0 || value > 10_000) throw new RangeError(`${name} must be an integer between 0 and 10000, got ${value}`);
};

const min = (a: bigint, b: bigint): bigint => (a < b ? a : b);

/** Interest plus principal. What the agent owes right now. */
export function totalDebt(debt: Debt): bigint {
  return debt.principalWei + debt.interestWei;
}

export type LoanDenial = "request not positive" | "at the principal ceiling" | "treasury cannot cover the minimum";

export type LoanOutcome =
  | { approved: true; amountWei: bigint; agent: Agent; treasuryWei: bigint }
  | { approved: false; reason: LoanDenial; agent: Agent; treasuryWei: bigint };

/**
 * Writes a loan, or says why it will not.
 *
 * The amount is whichever bound bites first: what was asked for, the room
 * left under the agent's principal ceiling, and the share of the treasury a
 * single loan may take. A bank cannot lend money it does not have, however
 * the rules are configured.
 *
 * Nothing is partially applied. A denial returns the agent and the treasury
 * exactly as they came in.
 */
export function originateLoan(config: EconomyConfig, treasuryWei: bigint, agent: Agent, requestWei: bigint): LoanOutcome {
  assertMinor(treasuryWei, "treasuryWei");
  assertMinor(agent.balanceWei, "balanceWei");
  assertMinor(agent.debt.principalWei, "principalWei");
  assertMinor(agent.debt.interestWei, "interestWei");
  assertBps(config.maxTreasuryShareBps, "maxTreasuryShareBps");

  const deny = (reason: LoanDenial): LoanOutcome => ({ approved: false, reason, agent, treasuryWei });
  if (requestWei <= 0n) return deny("request not positive");

  const headroomWei = config.maxPrincipalWei - agent.debt.principalWei;
  if (headroomWei <= 0n) return deny("at the principal ceiling");

  // The share cap is a fraction of the treasury and basis points top out at
  // 10000, so it is also the bank's hard limit: it can never exceed what the
  // treasury is holding.
  const shareCapWei = (treasuryWei * BigInt(config.maxTreasuryShareBps)) / 10_000n;
  const amountWei = min(min(requestWei, headroomWei), shareCapWei);
  if (amountWei < config.minLoanWei) return deny("treasury cannot cover the minimum");

  return {
    approved: true,
    amountWei,
    agent: { ...agent, balanceWei: agent.balanceWei + amountWei, debt: { ...agent.debt, principalWei: agent.debt.principalWei + amountWei } },
    treasuryWei: treasuryWei - amountWei,
  };
}

/**
 * One round of simple interest on outstanding principal.
 *
 * Simple, not compound: the charge is always a share of principal, so unpaid
 * interest never earns interest of its own. An agent that cannot keep up
 * still reaches the ceiling, just linearly rather than explosively, which is
 * what makes the wreck rate something the operator can reason about.
 */
export function accrueInterest(config: EconomyConfig, agent: Agent): Agent {
  assertBps(config.interestBps, "interestBps");
  const chargeWei = (agent.debt.principalWei * BigInt(config.interestBps)) / 10_000n;
  if (chargeWei === 0n) return agent;
  return { ...agent, debt: { ...agent.debt, interestWei: agent.debt.interestWei + chargeWei } };
}

export interface Repayment {
  debt: Debt;
  interestPaidWei: bigint;
  principalPaidWei: bigint;
  /** What was left after the debt was cleared. Zero while anything is owed. */
  leftoverWei: bigint;
}

/**
 * Pays down a debt, interest before principal.
 *
 * Interest first is the rule that makes a small win feel like nothing: an
 * agent whose winnings do not cover the accrued interest pays it all to
 * interest and owes exactly as much principal as before.
 */
export function repay(debt: Debt, amountWei: bigint): Repayment {
  assertMinor(amountWei, "amountWei");
  const interestPaidWei = min(amountWei, debt.interestWei);
  const afterInterestWei = amountWei - interestPaidWei;
  const principalPaidWei = min(afterInterestWei, debt.principalWei);
  return {
    debt: { principalWei: debt.principalWei - principalPaidWei, interestWei: debt.interestWei - interestPaidWei },
    interestPaidWei,
    principalPaidWei,
    leftoverWei: afterInterestWei - principalPaidWei,
  };
}

/** Winnings go to the debt first and only what is left reaches the balance. */
export function applyWinnings(agent: Agent, winningsWei: bigint): { agent: Agent; toTreasuryWei: bigint; repayment: Repayment } {
  const repayment = repay(agent.debt, winningsWei);
  return {
    agent: { ...agent, balanceWei: agent.balanceWei + repayment.leftoverWei, debt: repayment.debt },
    toTreasuryWei: repayment.interestPaidWei + repayment.principalPaidWei,
    repayment,
  };
}

export type WreckReason = "debt above the ceiling" | "broke and denied credit";

/**
 * Why this agent is out, or null if it is not.
 *
 * Two conditions, and they are different failures. An agent can be wrecked
 * while holding money, because it owes more than the ceiling allows and will
 * never climb out. An agent can also be wrecked holding no debt at all,
 * because it cannot afford a seat and nobody will lend it one.
 */
export function wreckReason(config: EconomyConfig, agent: Agent, creditDenied: boolean): WreckReason | null {
  if (totalDebt(agent.debt) > config.debtCeilingWei) return "debt above the ceiling";
  if (agent.balanceWei < config.stakeWei && creditDenied) return "broke and denied credit";
  return null;
}

export interface Seizure {
  agent: Agent;
  /** Recovered from the balance and returned to the treasury. */
  seizedWei: bigint;
  /** Owed, unrecoverable, and gone. The bank's loss. */
  writtenOffWei: bigint;
}

/**
 * Closes out a wrecked agent.
 *
 * Takes what the balance can cover against what is owed, interest before
 * principal, and writes off the rest. Never takes more than the debt: a
 * wrecked agent that happens to be holding more than it owes keeps the
 * difference, because seizing it would be taking money nobody is owed.
 */
export function seize(agent: Agent): Seizure {
  const owedWei = totalDebt(agent.debt);
  const seizedWei = min(agent.balanceWei, owedWei);
  const repayment = repay(agent.debt, seizedWei);
  return {
    agent: { ...agent, balanceWei: agent.balanceWei - seizedWei, debt: NO_DEBT },
    seizedWei,
    writtenOffWei: totalDebt(repayment.debt),
  };
}

/**
 * The agent that takes a wrecked one's seat.
 *
 * Born in debt when replacementDebtWei is configured above zero, which is
 * what makes a seat cost something rather than the house handing out a fresh
 * bankroll every time somebody busts.
 */
export function replacementAgent(config: EconomyConfig, id: string, fundingWei: bigint): Agent {
  assertMinor(fundingWei, "fundingWei");
  assertMinor(config.replacementDebtWei, "replacementDebtWei");
  return { id, balanceWei: fundingWei, debt: { principalWei: config.replacementDebtWei, interestWei: 0n } };
}
