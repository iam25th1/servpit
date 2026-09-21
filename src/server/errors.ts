// Errors the round flow raises that a route has to tell apart.
//
// A class rather than a message match: a route that decides what to show the
// player by reading error text is one reworded string away from leaking the
// text it was trying to classify.

/**
 * Every endpoint refused or timed out, so not one balance could be read.
 *
 * A round can lose one agent to an unreadable wallet and still run. It cannot
 * run on no verified balances at all, because the alternative is entering
 * agents on numbers nobody read from the chain.
 */
export class ChainUnreachableError extends Error {
  readonly code = "chain_unreachable" as const;
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "ChainUnreachableError";
  }
}
