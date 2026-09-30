// What a run of SERV calls cost.
//
// Its own module because the settle path reports cost and may not import
// anything that can reach the network. Arithmetic only.

/** What a call costs, in cents per million tokens. */
export interface Pricing {
  inputCentsPerMillion: number;
  outputCentsPerMillion: number;
}

/** Token usage as an OpenAI compatible response reports it. */
export interface Usage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

export interface Totals {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

/**
 * The meter as it stands, for measuring one round rather than one process.
 *
 * The meter counts a process. A round record that stored the meter's total
 * stored the process's spend on every round in it: on the live pit that put
 * the same 2,088,850 micro cents on all 200 rounds on file while every one of
 * them reported zero calls, which read as a $41.78 bill for rounds that never
 * asked anybody anything. So a round takes a reading before it decides and
 * subtracts, and what it records is its own.
 */
export interface Reading {
  calls: number;
  promptTokens: number;
  completionTokens: number;
  microCents: number;
}

/** What happened between two readings. Arithmetic, never negative in practice. */
export function spentSince(before: Reading, after: Reading): Reading {
  return {
    calls: after.calls - before.calls,
    promptTokens: after.promptTokens - before.promptTokens,
    completionTokens: after.completionTokens - before.completionTokens,
    microCents: after.microCents - before.microCents,
  };
}

/** One round's spend as a sentence, in the same shape the meter's summary uses. */
export function summaryOf(spent: Reading): string {
  const dollars = (spent.microCents / 100_000_000).toFixed(6);
  return `${spent.calls} call${spent.calls === 1 ? "" : "s"}, ${spent.promptTokens} in, ${spent.completionTokens} out, about $${dollars}`;
}

export class CostMeter {
  calls = 0;
  readonly totals: Totals = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

  constructor(private readonly pricing: { inputCentsPerMillion: number; outputCentsPerMillion: number }) {}

  record(usage: Usage | undefined): void {
    this.calls++;
    this.totals.promptTokens += usage?.prompt_tokens ?? 0;
    this.totals.completionTokens += usage?.completion_tokens ?? 0;
    this.totals.totalTokens += usage?.total_tokens ?? (usage?.prompt_tokens ?? 0) + (usage?.completion_tokens ?? 0);
  }

  /** Where the meter stands now, so a round can subtract and record its own. */
  reading(): Reading {
    return {
      calls: this.calls,
      promptTokens: this.totals.promptTokens,
      completionTokens: this.totals.completionTokens,
      microCents: this.estimatedMicroCents,
    };
  }

  /** Estimated spend in micro cents (one hundredth of a cent times 10,000). */
  get estimatedMicroCents(): number {
    return this.totals.promptTokens * this.pricing.inputCentsPerMillion + this.totals.completionTokens * this.pricing.outputCentsPerMillion;
  }

  get estimatedCents(): number {
    return Math.floor(this.estimatedMicroCents / 1_000_000);
  }

  summary(): string {
    const dollars = (this.estimatedMicroCents / 100_000_000).toFixed(6);
    return `${this.calls} call${this.calls === 1 ? "" : "s"}, ${this.totals.promptTokens} in, ${this.totals.completionTokens} out, about $${dollars}`;
  }
}
