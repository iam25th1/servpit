// Where a request came from, for the limits that a handle cannot carry.
//
// Every limit in this project is keyed by the hash of a device token, and a
// device token is made by the browser. That is the right key for "this handle
// belongs to that browser", and it is no key at all against somebody who
// mints a fresh one per request: a private window can produce an unlimited
// number of them, and a measured flood put 242 picks a second and 623 KB of
// log on the disk from one machine.
//
// So writes are also limited by where the request came from. The origin only
// ever sees the tunnel, so the address is the one Cloudflare puts on the
// request; a request that arrives without one is on the operator's own
// machine, where the limit is a formality.
//
// The address itself is never stored. It is hashed with a salt made when the
// process starts, so what the limiter holds is a key that cannot be turned
// back into an address and does not survive a restart. Nothing here is
// written to disk, and nothing here reaches a response.

import { createHash, randomBytes } from "node:crypto";

/** New every start, so the keys are not the same two runs running. */
const SALT = randomBytes(32);

/** What a request with nothing to key on is counted as. */
export const UNKNOWN_VISITOR = "direct";

/**
 * A stable key for the network this request came from.
 *
 * Cloudflare sets cf-connecting-ip on everything it forwards and overwrites
 * whatever the client sent, so it is the address to trust here. The first hop
 * of x-forwarded-for is the fallback for a deployment behind something else,
 * and it is worth what any forwarded header is worth: it raises the cost of a
 * flood from the public internet without pretending to be proof of anything.
 */
export function visitorKey(headers: Headers): string {
  const direct = headers.get("cf-connecting-ip")?.trim();
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const from = direct && direct.length > 0 ? direct : forwarded && forwarded.length > 0 ? forwarded : null;
  if (from === null) return UNKNOWN_VISITOR;
  return createHash("sha256").update(SALT).update(from).digest("hex");
}
