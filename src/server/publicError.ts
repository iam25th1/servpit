// What a failure is allowed to look like from the browser.
//
// Nothing that came out of a library reaches a client response. viem quotes
// the full endpoint url in every transport error, and a keyed endpoint
// carries its credential in that url, so passing a transport error through
// would publish the operator's api key to every visitor who managed to make
// a round fail. It did exactly that with the public endpoint, which is how
// this was noticed:
//
//   The request took too long to respond.
//   URL: https://base-sepolia-rpc.publicnode.com
//   Request body: {"method":"eth_getBalance","params":["0x1aC1...","latest"]}
//   Details: The request timed out. Version: viem@2.38.3
//
// So the mapping is one way and closed: a known failure becomes one of the
// codes below with a sentence written for a player, and everything else
// becomes "internal" with a fixed sentence. The thrown error is never read
// for its text. Full detail goes to the server log, where redact masks the
// url before it is written.

import { ChainUnreachableError } from "./errors";
import { PlanNotQuoted } from "./round/planStore";

export type PublicErrorCode = "chain_unreachable" | "round_expired" | "bad_request" | "internal";

export interface PublicError {
  code: PublicErrorCode;
  /** One sentence, written for the player. Never derived from the thrown error. */
  message: string;
  /** Whether pulling again could plausibly work. */
  retryable: boolean;
}

/** Every message the client can ever be shown. Fixed strings, never built from an error. */
const MESSAGES: Record<PublicErrorCode, { message: string; retryable: boolean }> = {
  chain_unreachable: { message: "Can't reach the network right now. Try again in a moment.", retryable: true },
  round_expired: { message: "That round is no longer on the table. Start a new one.", retryable: true },
  bad_request: { message: "That request didn't make sense. Start a new round.", retryable: false },
  internal: { message: "Something went wrong on our side. Try again in a moment.", retryable: true },
};

export function publicErrorFor(code: PublicErrorCode): PublicError {
  return { code, ...MESSAGES[code] };
}

/**
 * Classifies a thrown error by its type, never by its text.
 *
 * By type because a route that decides what to show by matching on message
 * text is one reworded library string away from falling through to a branch
 * that echoes the thing it was trying to classify.
 */
/**
 * Codes our own errors declare on themselves. A whitelist, so a code that
 * came from somewhere else, a viem rpc error carries a numeric one, cannot
 * pick a branch.
 */
const DECLARED: Record<string, PublicErrorCode> = {
  chain_unreachable: "chain_unreachable",
  round_expired: "round_expired",
};

function declaredCode(e: unknown): string | undefined {
  if (e && typeof e === "object" && "code" in e) {
    const code = (e as { code: unknown }).code;
    if (typeof code === "string") return code;
  }
  return undefined;
}

export function publicError(e: unknown): PublicError {
  if (e instanceof ChainUnreachableError) return publicErrorFor("chain_unreachable");
  if (e instanceof PlanNotQuoted) return publicErrorFor("round_expired");
  // instanceof is not enough on its own. A bundler that loads a module twice
  // gives the same class two identities, and the branch below is then missed
  // silently, which is how a known failure would start reporting itself as an
  // internal one.
  const declared = declaredCode(e);
  if (declared !== undefined && declared in DECLARED) return publicErrorFor(DECLARED[declared]);
  return publicErrorFor("internal");
}

/** The full detail, for the log only. Never returned to a client. */
export function internalDetail(e: unknown): string {
  if (e instanceof Error) return `${e.name}: ${e.message}`;
  return String(e);
}
