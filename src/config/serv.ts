// SERV Reasoning configuration. Feature toggles live here with the reason
// for each choice so they can be changed without touching code.
//
// Enabled:
//   promptGuard   Screens inbound requests for injection and outbound text
//                 for system prompt leakage. This loop feeds agent supplied
//                 state into a prompt whose output influences money, so the
//                 guard stays on. Declared as a tool, no parameters.
//   shadowAgent   A second model validates the draft against our criteria
//                 and regenerates when it fails. It is a net, never the
//                 only one: every field is re-validated locally afterwards.
//                 Declared as a tool with a natural language hint and
//                 max_iterations.
//   multipath     Model id suffix -serv-multipath. The prompt is a branching
//                 policy (balance bands, participation thresholds, recent
//                 outcomes), which is what Multipath is for. The reasoning
//                 prompt is generated once and cached per organisation.
//
// Disabled:
//   kronos        Model id suffix -serv-kronos. It audits and repairs the
//                 generated reasoning prompt, adding at least one extra
//                 audit call per cache miss. The brief says leave it off and
//                 the budget is one dollar, so it stays off.

export interface ServFeatures {
  promptGuard: boolean;
  shadowAgent: boolean;
  multipath: boolean;
  kronos: boolean;
}

export interface ServConfig {
  baseUrl: string;
  /** Base model id. Suffixes for enabled model features are appended at call time. */
  model: string;
  features: ServFeatures;
  /** Extra criteria for the Shadow Agent judge, in plain language. */
  shadowHint: string;
  /** Judge and revision cycles, 1 to 10. */
  shadowMaxIterations: number;
  temperature: number;
  maxCompletionTokens: number;
  /** Deadline for a single attempt. */
  timeoutMs: number;
  /**
   * Deadline for one agent's whole decision, across every attempt and the
   * backoff between them.
   *
   * The phase ends when the slowest of six concurrent agents finishes, so
   * without this one agent's retries set the length of the phase for
   * everybody. Measured: a healthy call is 6.1 to 11.9 s, and three attempts
   * at a 20 s timeout is 61.2 s of one agent holding the other five.
   *
   * An agent that runs out of budget falls back to the deterministic
   * heuristic, which is what a failed SERV call has always done.
   */
  deadlineMs: number;
  /** Attempts in total, including the first. */
  attempts: number;
  backoffMs: number;
  /** Price per million tokens in US cents, for the running cost estimate. */
  pricing: { inputCentsPerMillion: number; outputCentsPerMillion: number };
}

export const DEFAULT_SERV: ServConfig = {
  baseUrl: "https://inference-api.openserv.ai/v1",
  // Cheapest Claude on SERV: 1.25 dollars in, 6.50 dollars out per million.
  // Swap through SERV_MODEL for a demo recording, no code change.
  model: "claude-haiku-4.5",
  features: { promptGuard: true, shadowAgent: true, multipath: true, kronos: false },
  // Shadow Agent's criteria, in prose rather than schema syntax, which is
  // why they were unaffected by the validator rejecting numeric keywords in
  // response_format. They state the bound the schema can no longer carry,
  // including non negative outright rather than by implication.
  shadowHint:
    "The reply must be a single JSON object with exactly the keys enter, stake and reason. " +
    "stake must be a non negative whole number of chips: never below zero, exactly zero when enter is false, and never greater than the chips the operator holds. " +
    "reason must be ONE sentence of at most twenty words, in the operator's own speaking voice. " +
    "Reject and regenerate if reason contains any of these words: minor unit, minor units, wei, allocation, posture, working balance. " +
    "Reject and regenerate if reason contains any number longer than four digits.",
  shadowMaxIterations: 3,
  temperature: 0.2,
  // Measured across 36 live calls, a completion is about 33 tokens: one short
  // sentence and three small numbers. This was 400, and SERV bills its 402
  // against the estimated maximum cost rather than the actual one, so a
  // ceiling nothing ever reached was refusing requests on an account that
  // had the money for them. 120 is three and a half times the measured size.
  //
  // Lowering the Shadow Agent iteration count would cut the estimate further
  // and is deliberately not done. It is a safety net on a money surface, and
  // an empty account is not a reason to weaken one.
  maxCompletionTokens: 120,
  // 15 s per attempt against a measured healthy maximum of 11.9 s, and 25 s
  // for the agent in total. Worst case per agent was 61.2 s.
  timeoutMs: 15_000,
  deadlineMs: 25_000,
  attempts: 3,
  backoffMs: 400,
  pricing: { inputCentsPerMillion: 125, outputCentsPerMillion: 650 },
};

/** Model id with the suffixes for the enabled model level features. */
export function servModelId(config: ServConfig): string {
  let model = config.model;
  if (config.features.multipath) model += "-serv-multipath";
  if (config.features.kronos) model += "-serv-kronos";
  return model;
}
