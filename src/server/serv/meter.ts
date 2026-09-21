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
